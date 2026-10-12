import { app, BrowserWindow, clipboard, dialog, screen, type BaseWindow, type WebContents } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrambleExtensionState, BramblePopupAnchor } from '../shared/types'
import { getBrowserSession } from './browser-session'
import { closeBrambleExtensionTabs, isBrambleExtensionTab, openBrambleExtensionTab } from './browser'
import {
  adaptBrambleFirefoxManifest,
  BRAMBLE_BROWSER_ALIAS_FILE,
  BRAMBLE_BROWSER_ALIAS_SOURCE,
  isBrambleExtensionUrl,
  isRecord,
  stageBrambleFirefoxBuild
} from './bramble-poc-adapter'
import {
  compareBrambleVersions,
  downloadVerifiedBrambleFirefoxRelease,
  extractBrambleFirefoxArchive,
  fetchLatestBrambleFirefoxRelease,
  sha256Hex
} from './bramble-release'
import { getMainWindow } from './window'
import { anchoredPopupBounds, centredPopupAnchor } from '../shared/window-geometry'
import { sendToMainWindowRenderers } from './browser-shell'
import { createRestrictedFetch } from './restricted-fetch'
import { activateStagedDirectory, assertExtensionIdentity, extensionWorkerStamp, loadExtensionWithFreshWorker, writeJsonAtomic, type StagedActivation } from './extension-staging'

const CONFIG_FILENAME = 'bramble-firefox-poc.json'
const BRAMBLE_DATA_DIRECTORY = 'bramble-firefox-poc'
const STAGING_DIRECTORY = 'bramble-firefox-poc/extension'
const RELEASE_DIRECTORY = 'bramble-firefox-poc/releases'
const BRAMBLE_POPUP_WIDTH = 500
const BRAMBLE_POPUP_HEIGHT = 550
const BRAMBLE_RELEASE_REQUEST_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com'
])
const MAX_BRAMBLE_RELEASE_RESPONSE_BYTES = 40 * 1024 * 1024
const mainDirectory = dirname(fileURLToPath(import.meta.url))

interface LoadedBrambleExtension {
  id: string
  name: string
  version: string
  url: string
}

const state: BrambleExtensionState = {
  installed: false,
  loading: false,
  version: null,
  latestVersion: null,
  updateAvailable: false,
  popupOpen: false,
  error: null,
  notice: null,
  permissions: [],
  hostPermissions: [],
  iconDataUrl: null
}
let loadedExtension: LoadedBrambleExtension | null = null
let popupWindow: BrowserWindow | null = null
let offscreenWindow: BrowserWindow | null = null

function isAllowedBrambleReleaseUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && BRAMBLE_RELEASE_REQUEST_HOSTS.has(url.hostname)
}

const fetchBrambleRelease = createRestrictedFetch({
  label: 'GitHub release',
  isAllowedUrl: isAllowedBrambleReleaseUrl,
  maxResponseBytes: MAX_BRAMBLE_RELEASE_RESPONSE_BYTES,
  getSession: getBrowserSession
})

function resolveBramblePreload(): string {
  const base = join(mainDirectory, '../preload/bramble-poc')
  if (existsSync(`${base}.cjs`)) return `${base}.cjs`
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}

let toolbarAnchor: BramblePopupAnchor | undefined

export function setBrambleToolbarAnchor(anchor: BramblePopupAnchor | undefined): void {
  toolbarAnchor = anchor
}

/** A zero-height anchor above the centre of the window content, so the popup lands centred. */
function centredAnchor(owner: BaseWindow | undefined): BramblePopupAnchor | undefined {
  if (!owner) return undefined
  const content = owner.getContentBounds()
  return centredPopupAnchor(content, { width: BRAMBLE_POPUP_WIDTH, height: BRAMBLE_POPUP_HEIGHT })
}

function launcherBounds(anchor: BramblePopupAnchor | undefined, owner: BaseWindow | undefined): { x: number; y: number; width: number; height: number } {
  const display = owner ? screen.getDisplayMatching(owner.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  const content = owner?.getContentBounds() ?? area
  return anchoredPopupBounds(anchor, content, area, { width: BRAMBLE_POPUP_WIDTH, height: BRAMBLE_POPUP_HEIGHT }, screen.getCursorScreenPoint())
}

function mainWindow(): BaseWindow | undefined {
  const win = getMainWindow()
  return win && !win.isDestroyed() ? win : undefined
}

function publishState(): void {
  try {
    sendToMainWindowRenderers('browser:bramble:changed', { ...state })
  } catch {
    // A renderer closing during an extension update must not break the main process.
  }
}

function updateState(patch: Partial<BrambleExtensionState>): void {
  Object.assign(state, patch)
  publishState()
}

export function getBramblePocState(): BrambleExtensionState {
  return { ...state }
}

interface SavedBrambleConfig {
  sourceDirectory?: string
  releaseVersion?: string
  releaseSha256?: string
}

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

function readSavedBrambleConfig(): SavedBrambleConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'))
    if (!isRecord(parsed)) return null
    const config: SavedBrambleConfig = {}
    if (typeof parsed.sourceDirectory === 'string') config.sourceDirectory = resolve(parsed.sourceDirectory)
    if (typeof parsed.releaseVersion === 'string' && /^\d+\.\d+\.\d+$/.test(parsed.releaseVersion)) config.releaseVersion = parsed.releaseVersion
    if (typeof parsed.releaseSha256 === 'string' && /^[a-f\d]{64}$/i.test(parsed.releaseSha256)) config.releaseSha256 = parsed.releaseSha256.toLowerCase()
    return Object.keys(config).length > 0 ? config : null
  } catch {
    return null
  }
}

function saveBrambleConfig(config: SavedBrambleConfig): void {
  writeJsonAtomic(configPath(), config)
}

function brambleDirectory(relativePath: string): string {
  return join(app.getPath('userData'), relativePath)
}

function stageBrambleBuild(sourceDirectory: string, targetDirectory = brambleDirectory(STAGING_DIRECTORY)): { stagedDirectory: string; version: string } {
  return stageBrambleFirefoxBuild(sourceDirectory, targetDirectory)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function extensionDetails(directory: string): Pick<BrambleExtensionState, 'permissions' | 'hostPermissions' | 'iconDataUrl'> {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as unknown
  if (!isRecord(manifest)) throw new Error('Bramble’s staged manifest is not valid.')
  const optionalPermissions = stringList(manifest.optional_permissions).map((permission) => `Optional: ${permission}`)
  const optionalHosts = stringList(manifest.optional_host_permissions).map((permission) => `Optional: ${permission}`)
  const permissions = [...stringList(manifest.permissions), ...optionalPermissions]
  const hostPermissions = [...stringList(manifest.host_permissions), ...optionalHosts]
  const action = isRecord(manifest.action) ? manifest.action : {}
  const actionIcons = isRecord(action.default_icon) ? action.default_icon : {}
  const icons = isRecord(manifest.icons) ? manifest.icons : {}
  const iconPath = [actionIcons['32'], actionIcons['16'], icons['32'], icons['48']].find((candidate) => typeof candidate === 'string')
  let iconDataUrl: string | null = null
  if (typeof iconPath === 'string') {
    const root = resolve(directory)
    const candidate = resolve(root, iconPath)
    if (candidate.startsWith(`${root}${sep}`) && existsSync(candidate)) {
      const extension = candidate.toLowerCase().split('.').at(-1)
      const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null
    if (mime && statSync(candidate).isFile() && statSync(candidate).size <= 65_536) {
      iconDataUrl = `data:${mime};base64,${readFileSync(candidate).toString('base64')}`
    }
    }
  }
  return { permissions: [...new Set(permissions)], hostPermissions: [...new Set(hostPermissions)], iconDataUrl }
}

function disposePopup(): void {
  const current = popupWindow
  popupWindow = null
  if (current && !current.isDestroyed()) current.close()
  updateState({ popupOpen: false })
}

function disposeOffscreen(): void {
  const current = offscreenWindow
  offscreenWindow = null
  if (current && !current.isDestroyed()) current.close()
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!loadedExtension) throw new Error('Bramble has not been loaded yet.')
  const extension = loadedExtension
  const offscreenUrl = `${extension.url}offscreen.html`
  if (offscreenWindow && !offscreenWindow.isDestroyed() && offscreenWindow.webContents.getURL() === offscreenUrl) return
  disposeOffscreen()

  const host = new BrowserWindow({
    title: 'Bramble background services',
    width: 320,
    height: 480,
    show: false,
    skipTaskbar: true,
    parent: mainWindow(),
    webPreferences: {
      session: getBrowserSession(),
      preload: resolveBramblePreload(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  offscreenWindow = host
  host.on('closed', () => {
    if (offscreenWindow === host) offscreenWindow = null
  })
  try {
    await host.loadURL(offscreenUrl)
    if (host.isDestroyed()) throw new Error('Bramble offscreen host window closed while loading.')
  } catch (error) {
    if (offscreenWindow === host) offscreenWindow = null
    if (!host.isDestroyed()) host.close()
    throw new Error(`Could not start Bramble's offscreen crypto host: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function replaceStagedBrambleBuild(stagedDirectory: string, configToSave?: SavedBrambleConfig): Promise<void> {
  const finalDirectory = brambleDirectory(STAGING_DIRECTORY)
  const previousExtension = loadedExtension
  const previousState = { ...state }
  let activation: StagedActivation | null = null
  const browserSession = getBrowserSession()

  disposePopup()
  closeBrambleExtensionTabs()
  disposeOffscreen()
  try {
    if (previousExtension) {
      browserSession.extensions.removeExtension(previousExtension.id)
      loadedExtension = null
    }
    activation = activateStagedDirectory(stagedDirectory, finalDirectory)
    const extension = await loadBrambleExtension(finalDirectory)
    loadedExtension = { id: extension.id, name: extension.name, version: extension.version, url: extension.url }
    if (previousExtension) assertExtensionIdentity(previousExtension.id, extension.id, 'Bramble update (vault copy)')
    await ensureOffscreenDocument()
    const details = extensionDetails(finalDirectory)
    if (configToSave) saveBrambleConfig(configToSave)
    updateState({
      installed: true,
      loading: false,
      version: extension.version,
      updateAvailable: state.latestVersion ? compareBrambleVersions(state.latestVersion, extension.version) > 0 : false,
      popupOpen: false,
      error: null,
      permissions: details.permissions,
      hostPermissions: details.hostPermissions,
      iconDataUrl: details.iconDataUrl
    })
    activation.commit()
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error)
    disposePopup()
    closeBrambleExtensionTabs()
    disposeOffscreen()
    if (loadedExtension) {
      try {
        browserSession.extensions.removeExtension(loadedExtension.id)
      } catch {
        // The extension may already have been removed as part of a failed load.
      }
      loadedExtension = null
    }
    activation?.rollback()
    let rollbackError = ''
    if (previousExtension && existsSync(finalDirectory)) {
      try {
        const restored = await loadBrambleExtension(finalDirectory)
        if (restored.id !== previousExtension.id) throw new Error('the restored extension identity did not match')
        loadedExtension = { id: restored.id, name: restored.name, version: restored.version, url: restored.url }
        await ensureOffscreenDocument()
      } catch (restoreError) {
        rollbackError = ` Rollback could not reload the previous Bramble build: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}.`
        loadedExtension = null
      }
    }
    updateState({
      ...previousState,
      installed: loadedExtension !== null,
      version: loadedExtension ? previousExtension?.version ?? previousState.version : null,
      loading: false,
      permissions: loadedExtension ? previousState.permissions : [],
      hostPermissions: loadedExtension ? previousState.hostPermissions : [],
      iconDataUrl: loadedExtension ? previousState.iconDataUrl : null,
      error: `${originalMessage}${rollbackError}`
    })
    throw new Error(`${originalMessage}${rollbackError}`)
  }
}

async function loadFromDirectory(sourceDirectory: string, persistPath: boolean): Promise<void> {
  updateState({ loading: true, error: null, notice: null })
  const dataDirectory = brambleDirectory(BRAMBLE_DATA_DIRECTORY)
  mkdirSync(dataDirectory, { recursive: true })
  const temporaryRoot = mkdtempSync(join(dataDirectory, 'stage-'))
  try {
    const staged = stageBrambleBuild(sourceDirectory, join(temporaryRoot, 'extension'))
    await replaceStagedBrambleBuild(staged.stagedDirectory, persistPath ? { sourceDirectory: resolve(sourceDirectory) } : undefined)
  } catch (error) {
    updateState({ loading: false, error: error instanceof Error ? error.message : String(error) })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function showBrambleExtensionPage(pageUrl: string): void {
  const extension = loadedExtension
  if (!extension || !isBrambleExtensionUrl(pageUrl, extension.url)) {
    throw new Error('Only Bramble extension pages can open in Surffish tabs.')
  }
  const tabId = openBrambleExtensionTab(pageUrl, extension.url, resolveBramblePreload())
  if (!tabId) throw new Error('Could not open Bramble’s page in a Surffish tab.')
  disposePopup()
  updateState({ popupOpen: false, error: null })
}

function showBrambleLauncher(anchor?: BramblePopupAnchor, requestedPageUrl?: string): void {
  if (!loadedExtension) throw new Error('Bramble has not been loaded yet.')
  const pageUrl = requestedPageUrl ?? `${loadedExtension.url}popup.html`
  const owner = mainWindow()
  const bounds = launcherBounds(anchor, owner)
  if (popupWindow && !popupWindow.isDestroyed()) {
    if (popupWindow.webContents.getURL() !== pageUrl) {
      void popupWindow.loadURL(pageUrl).catch((error: unknown) => {
        updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
      })
    }
    popupWindow.setTitle('Bramble')
    popupWindow.setResizable(false)
    popupWindow.setBounds(bounds)
    if (popupWindow.isMinimized()) popupWindow.restore()
    popupWindow.show()
    popupWindow.focus()
    updateState({ popupOpen: true, error: null })
    return
  }

  const popup = new BrowserWindow({
    title: 'Bramble',
    ...bounds,
    useContentSize: true,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    parent: owner,
    webPreferences: {
      session: getBrowserSession(),
      preload: resolveBramblePreload(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  popupWindow = popup
  popup.on('closed', () => {
    if (popupWindow === popup) popupWindow = null
    updateState({ popupOpen: false })
  })
  popup.webContents.setWindowOpenHandler(({ url }) => {
    // Route trusted extension pages into Surffish tabs instead of separate windows.
    const extension = loadedExtension
    if (extension && isBrambleExtensionUrl(url, extension.url)) {
      try {
        showBrambleExtensionPage(url)
      } catch (error) {
        updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    return { action: 'deny' }
  })
  popup.once('ready-to-show', () => {
    if (popup.isDestroyed()) return
    popup.setBounds(bounds)
    popup.show()
    updateState({ popupOpen: true })
  })
  popup.on('blur', () => {
    if (!popup.isDestroyed() && popup.isVisible()) popup.close()
  })
  popup.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      if (!popup.isDestroyed()) popup.close()
    }
  })
  void popup.loadURL(pageUrl).catch((error: unknown) => {
    updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
    if (!popup.isDestroyed()) popup.close()
  })
}

function releaseArchivePath(version: string, sha256: string): string {
  return join(brambleDirectory(RELEASE_DIRECTORY), `bramble_firefox_${version}_${sha256}.zip`)
}

const BRAMBLE_WORKER_STAMP_FILE = 'worker-stamp'

const BRAMBLE_WORKER_FILES = ['surffish-bramble-background.js', BRAMBLE_BROWSER_ALIAS_FILE, 'background.js'] as const

/** Fingerprint of every script Bramble's background worker loads, to spot a stale registration. */
export function brambleWorkerStamp(directory: string): string {
  return extensionWorkerStamp(directory, BRAMBLE_WORKER_FILES)
}

/** Load Bramble with a fresh service worker whenever its worker scripts changed (see extension-staging). */
async function loadBrambleExtension(directory: string): Promise<Electron.Extension> {
  const stampPath = join(brambleDirectory(BRAMBLE_DATA_DIRECTORY), BRAMBLE_WORKER_STAMP_FILE)
  return loadExtensionWithFreshWorker(getBrowserSession(), directory, stampPath, BRAMBLE_WORKER_FILES)
}

async function loadExistingStagedBuild(directory: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as unknown
  const background = isRecord(manifest) && isRecord(manifest.background) ? manifest.background : {}
  const worker = typeof background.service_worker === 'string' ? background.service_worker : ''
  if (!isRecord(manifest) || manifest.name !== 'Bramble' || typeof manifest.version !== 'string' ||
      worker !== 'surffish-bramble-background.js' || !existsSync(join(directory, worker)) ||
      !existsSync(join(directory, 'surffish-bramble-browser-alias.js')) || !existsSync(join(directory, 'popup.html'))) {
    throw new Error('The saved Bramble install is incomplete. Use Settings → Bramble to install a verified release.')
  }
  // Refresh Surffish's own compatibility shim so fixes reach builds staged by an older Surffish.
  writeFileSync(join(directory, BRAMBLE_BROWSER_ALIAS_FILE), BRAMBLE_BROWSER_ALIAS_SOURCE)
  try {
    const extension = await loadBrambleExtension(directory)
    loadedExtension = { id: extension.id, name: extension.name, version: extension.version, url: extension.url }
    await ensureOffscreenDocument()
    const details = extensionDetails(directory)
    updateState({ installed: true, loading: false, version: extension.version, popupOpen: false, error: null, permissions: details.permissions, hostPermissions: details.hostPermissions, iconDataUrl: details.iconDataUrl })
  } catch (error) {
    disposeOffscreen()
    if (loadedExtension) {
      try { getBrowserSession().extensions.removeExtension(loadedExtension.id) } catch {}
      loadedExtension = null
    }
    throw error
  }
}

async function loadSavedRelease(config: SavedBrambleConfig): Promise<void> {
  if (!config.releaseVersion || !config.releaseSha256) throw new Error('The saved Bramble release metadata is incomplete. Install a fresh verified release from Settings.')
  const archivePath = releaseArchivePath(config.releaseVersion, config.releaseSha256)
  const archive = readFileSync(archivePath)
  if (sha256Hex(archive) !== config.releaseSha256) throw new Error('The saved Bramble release archive failed its SHA-256 integrity check. Reinstall Bramble from Settings.')
  const temporaryRoot = mkdtempSync(join(brambleDirectory(BRAMBLE_DATA_DIRECTORY), 'load-'))
  try {
    const sourceDirectory = join(temporaryRoot, 'source')
    extractBrambleFirefoxArchive(archive, sourceDirectory)
    const manifest = JSON.parse(readFileSync(join(sourceDirectory, 'manifest.json'), 'utf8')) as unknown
    if (!isRecord(manifest) || manifest.version !== config.releaseVersion) throw new Error('The saved Bramble version did not match its release record.')
    const staged = stageBrambleBuild(sourceDirectory, join(temporaryRoot, 'extension'))
    await replaceStagedBrambleBuild(staged.stagedDirectory)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export async function initializeBramblePoc(): Promise<void> {
  const developmentSource = process.env.SURFFISH_BRAMBLE_POC_DEV_AUTOLOAD === '1'
    ? process.env.SURFFISH_BRAMBLE_EXTENSION_DIR
    : undefined
  if (!app.isPackaged && developmentSource) {
    await loadFromDirectory(developmentSource, false)
    return
  }

  const savedConfig = readSavedBrambleConfig()
  if (!savedConfig) {
    if (existsSync(configPath())) updateState({ error: 'Surffish could not read the saved Bramble configuration. Reinstall Bramble from Settings.' })
    else if (existsSync(brambleDirectory(STAGING_DIRECTORY))) {
      updateState({ error: 'Bramble files exist in this Surffish profile, but its verified install record is missing. Reinstall from Settings → Bramble to restore it safely.' })
    }
    return
  }
  updateState({ loading: true, error: null })
  try {
    if (savedConfig.releaseVersion || savedConfig.releaseSha256) {
      await loadSavedRelease(savedConfig)
      return
    }
    const sourceDirectory = savedConfig.sourceDirectory
    if (sourceDirectory && existsSync(sourceDirectory)) {
      await loadFromDirectory(sourceDirectory, false)
      return
    }
    const stagedDirectory = brambleDirectory(STAGING_DIRECTORY)
    if (existsSync(stagedDirectory)) {
      await loadExistingStagedBuild(stagedDirectory)
      return
    }
    updateState({ loading: false, error: 'The saved Bramble build is unavailable. Open Settings → Bramble to install the latest verified release.' })
  } catch (error) {
    updateState({ loading: false, installed: false, version: null, error: error instanceof Error ? error.message : String(error) })
  }
}

export async function checkForBrambleUpdates(): Promise<BrambleExtensionState> {
  if (state.loading) return getBramblePocState()
  updateState({ loading: true, error: null, notice: null })
  try {
    const release = await fetchLatestBrambleFirefoxRelease(fetchBrambleRelease)
    const updateAvailable = state.installed && state.version !== null && compareBrambleVersions(release.version, state.version) > 0
    updateState({
      loading: false,
      latestVersion: release.version,
      updateAvailable,
      error: null,
      notice: state.installed
        ? updateAvailable ? `Bramble ${release.version} is available.` : `Bramble ${state.version} is up to date.`
        : `Bramble ${release.version} is ready to install.`
    })
  } catch (error) {
    updateState({ loading: false, error: error instanceof Error ? error.message : String(error) })
  }
  return getBramblePocState()
}

export async function installLatestBramble(): Promise<BrambleExtensionState> {
  if (state.loading) return getBramblePocState()
  updateState({ loading: true, error: null, notice: null })
  let temporaryRoot: string | null = null
  let writtenArchivePath: string | null = null
  try {
    const release = await fetchLatestBrambleFirefoxRelease(fetchBrambleRelease)
    const updateAvailable = state.installed && state.version !== null && compareBrambleVersions(release.version, state.version) > 0
    updateState({ latestVersion: release.version, updateAvailable })
    if (state.installed && state.version === release.version) {
      updateState({ loading: false, updateAvailable: false, notice: `Bramble ${release.version} is already installed.` })
      return getBramblePocState()
    }

    const verified = await downloadVerifiedBrambleFirefoxRelease(fetchBrambleRelease, release)
    const dataDirectory = brambleDirectory(BRAMBLE_DATA_DIRECTORY)
    mkdirSync(dataDirectory, { recursive: true })
    temporaryRoot = mkdtempSync(join(dataDirectory, 'install-'))
    const sourceDirectory = join(temporaryRoot, 'source')
    extractBrambleFirefoxArchive(verified.archive, sourceDirectory)
    const sourceManifest = JSON.parse(readFileSync(join(sourceDirectory, 'manifest.json'), 'utf8')) as unknown
    const adaptedManifest = adaptBrambleFirefoxManifest(sourceManifest)
    if (!isRecord(sourceManifest) || sourceManifest.version !== release.version || adaptedManifest.name !== 'Bramble') {
      throw new Error('The downloaded Bramble manifest did not match the selected Firefox release.')
    }
    const requestedPermissions = [...stringList(sourceManifest.permissions), ...stringList(sourceManifest.optional_permissions).map((permission) => `Optional: ${permission}`)]
    const requestedHosts = [...stringList(sourceManifest.host_permissions), ...stringList(sourceManifest.optional_host_permissions).map((permission) => `Optional: ${permission}`)]
    const confirmationOptions = {
      type: 'warning' as const,
      title: `${state.installed ? 'Update' : 'Install'} Bramble ${release.version}?`,
      message: 'Surffish will load Bramble’s Firefox extension build from its GitHub release.',
      detail: [
        `Integrity: the ZIP matches the release’s SHA256SUMS file${release.githubDigest ? ' and GitHub’s asset SHA-256 digest' : ''}. This Firefox release does not publish a detached maintainer signature.`,
        `Requested extension permissions: ${requestedPermissions.join(', ') || 'none'}.`,
        `Requested site access: ${requestedHosts.join(', ') || 'none'}.`,
        'Bramble requests access to all websites for autofill and its passkey bridge. The Firefox-only identity permission is removed by Surffish; Bramble’s Google Drive/OAuth backup is unsupported here.',
        '“Create your vault” from the toolbar and Setup / customize in Integrations open Bramble’s options page in a regular Surffish browser tab. Updating replaces extension files but keeps the existing browser profile and vault storage.'
      ].join('\n\n'),
      buttons: ['Cancel', `${state.installed ? 'Update' : 'Install'} Bramble`],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    }
    const owner = mainWindow()
    const confirmation = owner
      ? await dialog.showMessageBox(owner, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions)
    if (confirmation.response !== 1) {
      updateState({ loading: false, notice: 'Bramble installation was cancelled.' })
      return getBramblePocState()
    }

    const staged = stageBrambleBuild(sourceDirectory, join(temporaryRoot, 'extension'))
    const archivePath = releaseArchivePath(release.version, verified.sha256)
    mkdirSync(dirname(archivePath), { recursive: true })
    if (!existsSync(archivePath)) {
      writeFileSync(archivePath, verified.archive, { mode: 0o600, flag: 'wx' })
      writtenArchivePath = archivePath
    } else if (sha256Hex(readFileSync(archivePath)) !== verified.sha256) {
      throw new Error('A different Bramble archive already occupies the verified release path.')
    }
    await replaceStagedBrambleBuild(staged.stagedDirectory, { releaseVersion: release.version, releaseSha256: verified.sha256 })
    updateState({ latestVersion: release.version, updateAvailable: false, notice: `Bramble ${release.version} installed and verified.` })
  } catch (error) {
    if (writtenArchivePath) rmSync(writtenArchivePath, { force: true })
    updateState({ loading: false, error: error instanceof Error ? error.message : String(error) })
  } finally {
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
  }
  return getBramblePocState()
}

export async function openBramblePoc(anchor?: BramblePopupAnchor): Promise<BrambleExtensionState> {
  if (state.loading) return getBramblePocState()
  if (!loadedExtension) {
    updateState({ error: 'Bramble is not installed in this Surffish profile. Use the Bramble toolbar icon or Settings → Bramble to install the verified release.' })
    return getBramblePocState()
  }
  if (loadedExtension) {
    try {
      await ensureOffscreenDocument()
      showBrambleLauncher(anchor)
    } catch (error) {
      updateState({ error: error instanceof Error ? error.message : String(error) })
    }
  }
  return getBramblePocState()
}

export async function openBrambleSetup(): Promise<BrambleExtensionState> {
  if (state.loading) return getBramblePocState()
  if (!loadedExtension) {
    updateState({ error: 'Install Bramble from Settings before opening Bramble setup.' })
    return getBramblePocState()
  }
  if (loadedExtension) {
    try {
      await ensureOffscreenDocument()
      showBrambleExtensionPage(`${loadedExtension.url}options.html`)
    } catch (error) {
      updateState({ error: error instanceof Error ? error.message : String(error) })
    }
  }
  return getBramblePocState()
}

export async function openBrambleOptionsFromUi(sourceWindow: BrowserWindow | null, sourceContents: WebContents): Promise<void> {
  const isPopup = !!sourceWindow && sourceWindow === popupWindow && !sourceWindow.isDestroyed()
  if (!isPopup && !isBrambleExtensionTab(sourceContents)) {
    throw new Error('Only a Bramble UI page can open Bramble Setup / Restore.')
  }
  await openBrambleSetup()
}

/** True for Bramble's hidden offscreen host, the only page allowed to ask for the pop-out. */
export function isBrambleOffscreenSource(win: BrowserWindow | null, contents: WebContents): boolean {
  return !!loadedExtension && !!win && win === offscreenWindow && !contents.isDestroyed() &&
    isBrambleExtensionUrl(contents.getURL(), loadedExtension.url)
}

/**
 * Open Bramble's popup for a background windows.create (the autofill "Vault locked" row, passkey
 * unlock). Electron has no chrome.windows, so this reuses the toolbar launcher, anchored like it.
 */
export async function openBramblePopoutFromBackground(requestedUrl: string): Promise<void> {
  const extension = loadedExtension
  if (!extension) throw new Error('Bramble has not been loaded yet.')
  // Show the same compact popup the toolbar opens (not Bramble's 500x600 detached layout);
  // the unlock reason travels in Bramble's session storage, not the URL.
  if (requestedUrl && !isBrambleExtensionUrl(requestedUrl, extension.url)) throw new Error('Bramble can only open its own pages.')
  const pageUrl = `${extension.url}popup.html`
  const owner = mainWindow()
  if (owner && !owner.isDestroyed() && owner.isMinimized()) owner.restore()
  // Attach to the toolbar's Bramble button like a toolbar click; with no button on screen,
  // centre over the window instead of dropping it wherever the cursor happens to be.
  showBrambleLauncher(toolbarAnchor ?? centredAnchor(owner), pageUrl)
}

export function closeBramblePopoutFromBackground(): void {
  disposePopup()
}

export function isBrambleUiWindow(win: BrowserWindow | null): boolean {
  return !!win && win === popupWindow
}

/** Allow clipboard writes only from Bramble's popup, hidden clear-clipboard host, or extension tabs. */
export function isBrambleClipboardSource(win: BrowserWindow | null, contents: WebContents): boolean {
  if (!loadedExtension || contents.isDestroyed() || !isBrambleExtensionUrl(contents.getURL(), loadedExtension.url)) return false
  return win === popupWindow || win === offscreenWindow || isBrambleExtensionTab(contents)
}

export function writeBrambleClipboardText(text: string): void {
  clipboard.writeText(text)
}

export function disposeBramblePoc(): void {
  disposePopup()
  disposeOffscreen()
}

// ---------------------------------------------------------------------------
// Login bridge for the native Google sign-in window.
//
// Bramble's background answers AUTOFILL_FIND (summaries for a hostname) and
// AUTOFILL_FETCH (one entry's secret) only for extension-origin senders, so
// the request is sent from Bramble's own offscreen page. Surffish only
// fetches ids that the latest FIND for that hostname returned, keeping the
// fill scoped to the hostname even though FETCH itself is unscoped.

export interface BrambleLoginSummary { id: string; label: string }
export type BrambleLoginList = { status: 'ok'; logins: BrambleLoginSummary[] } | { status: 'locked' | 'unavailable' }
export interface BrambleLoginSecret { username: string; password: string; totp: string }

interface BrambleEnvelope { ok: boolean; data?: unknown; error?: string }

const BRAMBLE_OFFERED_TTL_MS = 2 * 60 * 1000
let offeredLogins: { hostname: string; ids: Set<string>; at: number } | null = null

async function sendBrambleBackgroundMessage(message: Record<string, unknown>): Promise<BrambleEnvelope> {
  await ensureOffscreenDocument()
  const host = offscreenWindow
  if (!host || host.isDestroyed()) throw new Error('Bramble offscreen page is not running.')
  const script = `new Promise((resolve) => {
    const runtime = globalThis.chrome?.runtime ?? globalThis.browser?.runtime
    if (!runtime) return resolve({ ok: false, error: 'no runtime' })
    runtime.sendMessage(${JSON.stringify(message)}, (response) => {
      const error = globalThis.chrome?.runtime?.lastError
      resolve(response ?? { ok: false, error: error?.message ?? 'no response' })
    })
  })`
  const response = (await host.webContents.executeJavaScript(script, true)) as unknown
  return response && typeof response === 'object' ? (response as BrambleEnvelope) : { ok: false, error: 'bad response' }
}

export async function findBrambleLogins(hostname: string): Promise<BrambleLoginList> {
  offeredLogins = null
  if (!loadedExtension) return { status: 'unavailable' }
  try {
    const response = await sendBrambleBackgroundMessage({ type: 'AUTOFILL_FIND', payload: { hostname, hasLogin: true } })
    if (!response.ok || !isRecord(response.data)) return { status: 'unavailable' }
    if (response.data.locked === true) {
      try {
        app.focus({ steal: true })
        await openBramblePoc()
      } catch { /* the helper tells the user to unlock */ }
      return { status: 'locked' }
    }
    const logins = (Array.isArray(response.data.logins) ? response.data.logins : [])
      .filter(isRecord)
      .filter((entry) => typeof entry.id === 'string')
      .map((entry) => {
        const name = typeof entry.name === 'string' ? entry.name : 'Google'
        const user = typeof entry.secondary === 'string' && entry.secondary ? entry.secondary : ''
        return { id: entry.id as string, label: user ? `${user} — ${name}` : name }
      })
    offeredLogins = { hostname, ids: new Set(logins.map((login) => login.id)), at: Date.now() }
    return { status: 'ok', logins }
  } catch (error) {
    console.warn('[bramble] login lookup for the sign-in window failed:', error instanceof Error ? error.message : String(error))
    return { status: 'unavailable' }
  }
}

export async function fetchBrambleLogin(hostname: string, id: string): Promise<BrambleLoginSecret | null> {
  const offered = offeredLogins
  if (!offered || offered.hostname !== hostname || !offered.ids.has(id) || Date.now() - offered.at > BRAMBLE_OFFERED_TTL_MS) return null
  try {
    const response = await sendBrambleBackgroundMessage({ type: 'AUTOFILL_FETCH', payload: { entryId: id } })
    if (!response.ok || !isRecord(response.data) || response.data.kind !== 'login') return null
    const { username, password, totp } = response.data
    return {
      username: typeof username === 'string' ? username : '',
      password: typeof password === 'string' ? password : '',
      totp: typeof totp === 'string' ? totp : ''
    }
  } catch {
    return null
  }
}
