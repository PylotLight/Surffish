import { app, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  DEFAULT_UPDATE_FEED_URL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FEED_MAX_BYTES,
  UPDATE_INITIAL_DELAY_MS,
  UPDATE_REMIND_LATER_MS,
  decideUpdate,
  describeFeedHttpFailure,
  effectiveFeedUrl,
  normalizeFeedUrl,
  parseReleaseFeed,
  parseUpdatePreferences,
  pickLatestRelease,
  redactFeedUrl,
  releaseAssetCandidates,
  toReleaseInfo,
  type UpdateCheckStatus,
  type UpdateDownloadState,
  type UpdatePreferences,
  type UpdateReleaseInfo,
  type UpdateState
} from '../shared/update-feed'
import { APP_NAME } from '../shared/config'
import { getBrowserSession } from './browser-session'
import { isMainWindowRenderer, sendToMainWindowRenderers, setBrowserChromeState } from './browser-shell'
import { getActiveTabWebContents, openExternalBrowserTab } from './browser'
import { getMainWindow } from './window'

/**
 * Update notifications from the releases Atom feed. Main process only: renderers never fetch.
 * No auto-install (no signed update feed): we tell the user, and download through the browser's
 * own download manager. All network goes through the browser session, so the SOCKS proxy applies.
 */

const PREFERENCES_FILE = 'update-preferences.json'
const FETCH_TIMEOUT_MS = 15_000
const ASSET_PROBE_TIMEOUT_MS = 8_000

let preferences: UpdatePreferences = parseUpdatePreferences(null)
let status: UpdateCheckStatus = 'idle'
let message: string | null = null
let latest: UpdateReleaseInfo | null = null
let checkTimer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<UpdateState> | null = null
let initialized = false
let download: UpdateDownloadState = { state: 'none', filename: null, canOpenInstaller: false, canReveal: false }
/** Original (pre-redirect) asset URL we asked the download manager for; matched in will-download. */
let pendingAssetUrl: string | null = null
let downloadedPath: string | null = null
let activeNotification: Notification | null = null

/**
 * Optional network gate (e.g. a proxy kill switch): return a reason to block update checks, or
 * null to allow. A blocked check is reported in Settings and never falls back to a direct fetch.
 */
type UpdateNetworkGuard = () => string | null
let networkGuard: UpdateNetworkGuard = () => null
export function setUpdateNetworkGuard(guard: UpdateNetworkGuard): void {
  networkGuard = guard
}

function preferencesPath(): string {
  return join(app.getPath('userData'), PREFERENCES_FILE)
}

function loadPreferences(): void {
  try {
    const path = preferencesPath()
    preferences = parseUpdatePreferences(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null)
  } catch (error) {
    console.warn(`Could not read ${PREFERENCES_FILE}:`, error)
    preferences = parseUpdatePreferences(null)
  }
}

/** 0600: a custom feed URL may carry a token. */
function savePreferences(): void {
  const directory = app.getPath('userData')
  const path = join(directory, PREFERENCES_FILE)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporary, JSON.stringify(preferences), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } catch (error) {
    try { rmSync(temporary, { force: true }) } catch { /* best-effort cleanup */ }
    console.error(`Could not save ${PREFERENCES_FILE}:`, error)
  }
}

function currentVersion(): string {
  return app.getVersion()
}

export function getUpdateState(): UpdateState {
  const decision = decideUpdate(latest?.version ?? null, currentVersion(), preferences, Date.now())
  return {
    currentVersion: currentVersion(),
    status,
    message,
    latest,
    showBadge: decision.showBadge,
    updateAvailable: decision.updateAvailable,
    skippedVersion: preferences.skippedVersion,
    lastChecked: preferences.lastChecked,
    feedUrl: preferences.feedUrl,
    defaultFeedUrl: DEFAULT_UPDATE_FEED_URL,
    betaChannel: preferences.betaChannel,
    download: { ...download }
  }
}

function publish(): UpdateState {
  const state = getUpdateState()
  try {
    sendToMainWindowRenderers('browser:updates:changed', state)
  } catch {
    // The window may be closing; the next get() call returns fresh state anyway.
  }
  return state
}

/** Show Settings → General (where About & updates lives) and scroll it into view. */
export function revealUpdateSettings(): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  setBrowserChromeState({ sidebarMode: 'settings' })
  // Let the settings view mount before asking it to scroll.
  setTimeout(() => {
    try { sendToMainWindowRenderers('browser:updates:reveal') } catch { /* window closing */ }
  }, 150)
}

function showUpdateNotification(release: UpdateReleaseInfo): void {
  if (!Notification.isSupported()) return
  activeNotification?.close()
  const notification = new Notification({
    title: `${APP_NAME} ${release.version} is available`,
    body: `You have ${currentVersion()}. Open Settings to see what's new and download it.`,
    silent: false
  })
  notification.on('click', () => revealUpdateSettings())
  notification.on('close', () => { if (activeNotification === notification) activeNotification = null })
  activeNotification = notification
  notification.show()
}

async function readCappedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > UPDATE_FEED_MAX_BYTES) throw new Error('The update feed is too large.')
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > UPDATE_FEED_MAX_BYTES) throw new Error('The update feed is too large.')
  return new TextDecoder().decode(buffer)
}

async function runCheck(manual: boolean): Promise<UpdateState> {
  const feedUrl = effectiveFeedUrl(preferences)
  const blocked = networkGuard()
  if (blocked) {
    status = 'error'
    message = `Update check skipped: ${blocked}`
    return publish()
  }
  status = 'checking'
  message = null
  publish()
  try {
    // Browser session = the user's SOCKS proxy. If the proxy is down this fails; we never go direct.
    const response = await getBrowserSession().fetch(feedUrl, {
      headers: { Accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    preferences = { ...preferences, lastChecked: Date.now() }
    if (!response.ok) {
      const failure = describeFeedHttpFailure(response.status, feedUrl)
      console.warn(`Update check: HTTP ${response.status} from ${redactFeedUrl(feedUrl)} (${failure.message}).`)
      status = failure.status
      message = failure.message
      latest = null
      return publish()
    }
    const entries = parseReleaseFeed(await readCappedText(response))
    const best = pickLatestRelease(entries, { includePrereleases: preferences.betaChannel })
    latest = best ? toReleaseInfo(best) : null
    const decision = decideUpdate(latest?.version ?? null, currentVersion(), preferences, Date.now())
    status = decision.updateAvailable ? 'available' : 'up-to-date'
    message = !latest
      ? 'No releases found in the feed.'
      : decision.skipped
        ? `${latest.version} is available (skipped).`
        : decision.snoozed
          ? `${latest.version} is available (reminder snoozed).`
          : decision.updateAvailable ? `${latest.version} is available.` : `You're on the latest version.`
    if (decision.notify && latest) {
      showUpdateNotification(latest)
      preferences = { ...preferences, notifiedVersion: latest.version, remindLaterVersion: null, remindAfter: null }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`Update check failed for ${redactFeedUrl(feedUrl)}: ${reason}`)
    status = 'error'
    message = /timed? ?out|abort/i.test(reason)
      ? 'Update check timed out. Check your connection or proxy.'
      : manual ? `Update check failed: ${reason}` : 'Update check failed; will retry later.'
  } finally {
    savePreferences()
  }
  return publish()
}

export function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!inFlight) {
    inFlight = runCheck(manual).finally(() => { inFlight = null })
  }
  return inFlight
}

function scheduleNextCheck(delayMs: number): void {
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = setTimeout(() => {
    checkTimer = null
    void checkForUpdates(false).finally(() => scheduleNextCheck(UPDATE_CHECK_INTERVAL_MS))
  }, delayMs)
}

/** Menu item: check now and bring the result up in Settings. */
export function checkForUpdatesFromMenu(): void {
  revealUpdateSettings()
  void checkForUpdates(true)
}

export function skipUpdateVersion(version: unknown): UpdateState {
  if (typeof version === 'string' && latest && version === latest.version) {
    preferences = { ...preferences, skippedVersion: latest.version }
    activeNotification?.close()
    savePreferences()
  }
  return publish()
}

export function remindUpdateLater(): UpdateState {
  if (latest) {
    preferences = { ...preferences, remindLaterVersion: latest.version, remindAfter: Date.now() + UPDATE_REMIND_LATER_MS }
    activeNotification?.close()
    savePreferences()
  }
  return publish()
}

export interface UpdateSettingsInput {
  feedUrl?: unknown
  betaChannel?: unknown
}

export async function setUpdateSettings(input: unknown): Promise<UpdateState> {
  if (typeof input !== 'object' || input === null) throw new Error('Update settings must be an object.')
  const patch = input as UpdateSettingsInput
  const next = { ...preferences }
  if (patch.feedUrl !== undefined) {
    const feedUrl = normalizeFeedUrl(patch.feedUrl)
    if (feedUrl === null) throw new Error('Enter an http(s) feed URL, or leave it blank for the default GitHub releases feed.')
    next.feedUrl = feedUrl
  }
  if (typeof patch.betaChannel === 'boolean') next.betaChannel = patch.betaChannel
  const changed = next.feedUrl !== preferences.feedUrl || next.betaChannel !== preferences.betaChannel
  preferences = next
  savePreferences()
  if (!changed) return publish()
  latest = null
  return checkForUpdates(true)
}

/** Probe direct asset URLs (HEAD, through the proxy); null when none exists or the probe fails. */
async function findDownloadAsset(release: UpdateReleaseInfo): Promise<string | null> {
  for (const candidate of releaseAssetCandidates(release.link, release.version, process.platform, process.arch, APP_NAME)) {
    try {
      const response = await getBrowserSession().fetch(candidate, { method: 'HEAD', redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(ASSET_PROBE_TIMEOUT_MS) })
      if (response.ok) return candidate
    } catch {
      // Try the next candidate; the release page still opens.
    }
  }
  return null
}

/**
 * "Download": open the release page in a tab and, when a matching .dmg/.zip asset exists, start it
 * from that tab so it lands in the regular download manager (and its Downloads panel).
 */
export async function downloadUpdate(): Promise<UpdateState> {
  const release = latest
  if (!release?.link) return publish()
  const asset = await findDownloadAsset(release)
  const tabId = openExternalBrowserTab(release.link)
  if (asset && tabId) {
    const contents = getActiveTabWebContents()
    if (contents) {
      pendingAssetUrl = asset
      downloadedPath = null
      download = { state: 'downloading', filename: asset.split('/').at(-1) ?? null, canOpenInstaller: false, canReveal: false }
      contents.downloadURL(asset)
    }
  }
  return publish()
}

function trackUpdateDownload(item: Electron.DownloadItem): void {
  if (!pendingAssetUrl) return
  const chain = (() => { try { return item.getURLChain() } catch { return [item.getURL()] } })()
  if (!chain.includes(pendingAssetUrl) && item.getURL() !== pendingAssetUrl) return
  pendingAssetUrl = null
  download = { state: 'downloading', filename: item.getFilename(), canOpenInstaller: false, canReveal: false }
  publish()
  item.once('done', (_event, state) => {
    if (state !== 'completed') {
      download = { state: 'failed', filename: item.getFilename(), canOpenInstaller: false, canReveal: false }
      publish()
      return
    }
    downloadedPath = item.getSavePath()
    const isDmg = /\.dmg$/i.test(downloadedPath)
    download = {
      state: 'completed',
      filename: item.getFilename(),
      canOpenInstaller: process.platform === 'darwin' && isDmg,
      canReveal: Boolean(downloadedPath)
    }
    publish()
  })
}

export async function openUpdateInstaller(): Promise<boolean> {
  if (!downloadedPath || !download.canOpenInstaller || !existsSync(downloadedPath)) return false
  const error = await shell.openPath(downloadedPath)
  return error === ''
}

export function revealUpdateDownload(): boolean {
  if (!downloadedPath || !existsSync(downloadedPath)) return false
  shell.showItemInFolder(downloadedPath)
  return true
}

/** Call once after the window exists. First check after ~30s, then every 6h. */
export function initializeUpdates(): void {
  if (initialized) return
  initialized = true
  loadPreferences()
  getBrowserSession().on('will-download', (_event, item) => trackUpdateDownload(item))
  scheduleNextCheck(UPDATE_INITIAL_DELAY_MS)
}

export function disposeUpdates(): void {
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = null
  activeNotification?.close()
  activeNotification = null
}

function assertAppWindow(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error('Update controls are available only to the app window.')
  }
}

/** IPC for Settings → About & updates and the sidebar badge (app window renderers only). */
export function registerUpdateIpc(): void {
  ipcMain.handle('browser:updates:get', (event) => { assertAppWindow(event); return getUpdateState() })
  ipcMain.handle('browser:updates:check', (event) => { assertAppWindow(event); return checkForUpdates(true) })
  ipcMain.handle('browser:updates:skip', (event, version: unknown) => { assertAppWindow(event); return skipUpdateVersion(version) })
  ipcMain.handle('browser:updates:remind-later', (event) => { assertAppWindow(event); return remindUpdateLater() })
  ipcMain.handle('browser:updates:settings:set', (event, input: unknown) => { assertAppWindow(event); return setUpdateSettings(input) })
  ipcMain.handle('browser:updates:download', (event) => { assertAppWindow(event); return downloadUpdate() })
  ipcMain.handle('browser:updates:open-installer', (event) => { assertAppWindow(event); return openUpdateInstaller() })
  ipcMain.handle('browser:updates:reveal-download', (event) => { assertAppWindow(event); return revealUpdateDownload() })
  ipcMain.handle('browser:updates:reveal-settings', (event) => { assertAppWindow(event); revealUpdateSettings() })
}
