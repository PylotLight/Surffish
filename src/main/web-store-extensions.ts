/**
 * Chrome Web Store extension support: install from a store URL or ID, compatibility gate, staging
 * with Surffish's shims, enable/disable, uninstall, update, toolbar popups, and options pages.
 *
 * Layout under userData/extensions/:
 *   installed.json            the installed list (atomic writes)
 *   <id>/<version>/           the adapted, unpacked extension Electron loads
 *   <id>/worker-stamp         fingerprint of the staged worker scripts (fresh-worker reloads)
 */
import { app, BrowserWindow, dialog, screen, type BaseWindow, type WebContents } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BramblePopupAnchor, WebStoreExtensionsState, WebStoreExtensionSummary } from '../shared/types'
import {
  chromeWebStoreCrxUrl,
  compareExtensionVersions,
  isAllowedChromeWebStoreDownloadUrl,
  isChromeExtensionId,
  parseChromeWebStoreInput
} from '../shared/chrome-web-store'
import { analyzeExtensionCompatibility, compatibilityLabel, type ExtensionCompatibility } from '../shared/extension-compat'
import { filterTabsForQuery, isAllowedExtensionTabUrl, toChromeTab, type ExtensionAccess } from '../shared/extension-tabs'
import { anchoredPopupBounds } from '../shared/window-geometry'
import { getBrowserSession } from './browser-session'
import {
  closeExtensionPageTabs,
  createExtensionTab,
  getExtensionTab,
  isExtensionPageTab,
  listExtensionTabs,
  openExtensionPageTab,
  reloadExtensionTab,
  removeExtensionTabs,
  updateExtensionTab
} from './browser'
import { sendToMainWindowRenderers } from './browser-shell'
import { getMainWindow } from './window'
import { parseCrx } from './crx'
import { extractExtensionZip } from './bramble-release'
import { createRestrictedFetch } from './restricted-fetch'
import { activateStagedDirectory, assertExtensionIdentity, loadExtensionWithFreshWorker, writeJsonAtomic, type StagedActivation } from './extension-staging'
import { setExtensionAdblockExemptHosts } from './extension-adblock-exemptions'
import {
  collectExtensionSources,
  extensionWorkerFiles,
  manifestOptionsPath,
  manifestPopupPath,
  readExtensionIconDataUrl,
  resolveManifestMessage,
  stageWebStoreExtension,
  writeExtensionShimFiles
} from './web-store-extension-adapter'

const EXTENSIONS_DIRECTORY = 'extensions'
const RECORDS_FILE = 'installed.json'
const MAX_CRX_BYTES = 64 * 1024 * 1024
const POPUP_MIN = { width: 25, height: 25 }
const POPUP_MAX = { width: 800, height: 600 }
const mainDirectory = dirname(fileURLToPath(import.meta.url))

type JsonRecord = Record<string, unknown>

interface InstalledRecord {
  id: string
  version: string
  name: string
  enabled: boolean
  installedAt: number
  updatedAt: number
  compatibility: ExtensionCompatibility['level']
  gaps: string[]
  shimmed: string[]
}

interface LoadedEntry {
  extension: Electron.Extension
  directory: string
  manifest: JsonRecord
}

const records = new Map<string, InstalledRecord>()
const loaded = new Map<string, LoadedEntry>()
const loadErrors = new Map<string, string>()
const state = { busy: false, busyId: null as string | null, notice: null as string | null, error: null as string | null }
let popup: { window: BrowserWindow; id: string } | null = null
let storePreloadRegistered = false

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function rootDirectory(): string {
  return join(app.getPath('userData'), EXTENSIONS_DIRECTORY)
}

function extensionDirectory(id: string, version: string): string {
  return join(rootDirectory(), id, version)
}

function stampPath(id: string): string {
  return join(rootDirectory(), id, 'worker-stamp')
}

function resolvePreload(name: string): string {
  return join(mainDirectory, '../preload', name)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Persistence

function parseRecord(value: unknown): InstalledRecord | null {
  if (!isRecord(value) || !isChromeExtensionId(value.id) || typeof value.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(value.version)) return null
  const level = value.compatibility === 'supported' || value.compatibility === 'partial' ? value.compatibility : 'partial'
  return {
    id: value.id,
    version: value.version,
    name: typeof value.name === 'string' ? value.name : value.id,
    enabled: value.enabled !== false,
    installedAt: typeof value.installedAt === 'number' ? value.installedAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    compatibility: level,
    gaps: stringList(value.gaps),
    shimmed: stringList(value.shimmed)
  }
}

function readRecords(): void {
  records.clear()
  try {
    const parsed = JSON.parse(readFileSync(join(rootDirectory(), RECORDS_FILE), 'utf8')) as unknown
    const list = isRecord(parsed) && Array.isArray(parsed.extensions) ? parsed.extensions : []
    for (const entry of list) {
      const record = parseRecord(entry)
      if (record) records.set(record.id, record)
    }
  } catch {
    // No installed extensions yet (or an unreadable list, which starts empty).
  }
}

function saveRecords(): void {
  writeJsonAtomic(join(rootDirectory(), RECORDS_FILE), { version: 1, extensions: [...records.values()] })
}

// ---------------------------------------------------------------------------
// State

function summary(record: InstalledRecord): WebStoreExtensionSummary {
  const entry = loaded.get(record.id)
  const directory = entry?.directory ?? extensionDirectory(record.id, record.version)
  let manifest: JsonRecord = entry?.manifest ?? {}
  if (!entry) {
    try {
      const parsed = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as unknown
      if (isRecord(parsed)) manifest = parsed
    } catch {
      manifest = {}
    }
  }
  return {
    id: record.id,
    name: resolveManifestMessage(directory, manifest, manifest.name) || record.name,
    description: resolveManifestMessage(directory, manifest, manifest.description),
    version: record.version,
    enabled: record.enabled,
    loaded: loaded.has(record.id),
    iconDataUrl: existsSync(directory) ? readExtensionIconDataUrl(directory, manifest) : null,
    hasPopup: manifestPopupPath(manifest) !== null,
    hasOptions: manifestOptionsPath(manifest) !== null,
    compatibility: record.compatibility,
    gaps: [...record.gaps],
    shimmed: [...record.shimmed],
    permissions: stringList(manifest.permissions).filter((entry) => !entry.includes('://') && entry !== '<all_urls>'),
    hostPermissions: [...stringList(manifest.host_permissions), ...stringList(manifest.permissions).filter((entry) => entry.includes('://') || entry === '<all_urls>')],
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    error: loadErrors.get(record.id) ?? null
  }
}

export function getWebStoreExtensionsState(): WebStoreExtensionsState {
  return {
    extensions: [...records.values()].sort((a, b) => a.installedAt - b.installedAt).map(summary),
    busy: state.busy,
    busyId: state.busyId,
    popupOpenId: popup && !popup.window.isDestroyed() ? popup.id : null,
    notice: state.notice,
    error: state.error
  }
}

function publish(): void {
  try {
    sendToMainWindowRenderers('browser:extensions:changed', getWebStoreExtensionsState())
  } catch {
    // A renderer closing mid-install must not break the main process.
  }
}

function setStatus(patch: Partial<typeof state>): void {
  Object.assign(state, patch)
  publish()
}

/** Ad-block exemptions: hosts a loaded extension's content scripts or code rely on. */
function refreshAdblockExemptions(): void {
  const hosts = new Set<string>()
  for (const entry of loaded.values()) {
    const scripts = Array.isArray(entry.manifest.content_scripts) ? entry.manifest.content_scripts.filter(isRecord) : []
    const matches = scripts.flatMap((script) => stringList(script.matches))
    const usesExtPay = matches.some((pattern) => /extensionpay\.com/i.test(pattern)) || existsSync(join(entry.directory, 'ExtPay.js'))
    if (usesExtPay) hosts.add('extensionpay.com')
  }
  setExtensionAdblockExemptHosts(hosts)
}

// ---------------------------------------------------------------------------
// Loading

async function loadInstalled(record: InstalledRecord): Promise<LoadedEntry> {
  const directory = extensionDirectory(record.id, record.version)
  if (!existsSync(join(directory, 'manifest.json'))) throw new Error(`The files for ${record.name} ${record.version} are missing. Reinstall it from the Chrome Web Store.`)
  // Refresh Surffish's shim so fixes reach extensions staged by an older Surffish.
  writeExtensionShimFiles(directory)
  const browserSession = getBrowserSession()
  const extension = await loadExtensionWithFreshWorker(browserSession, directory, stampPath(record.id), extensionWorkerFiles(directory))
  try {
    assertExtensionIdentity(record.id, extension.id, `${record.name} install`)
  } catch (error) {
    browserSession.extensions.removeExtension(extension.id)
    throw error
  }
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as JsonRecord
  const entry = { extension, directory, manifest }
  loaded.set(record.id, entry)
  loadErrors.delete(record.id)
  refreshAdblockExemptions()
  return entry
}

function unloadExtension(id: string): void {
  const entry = loaded.get(id)
  if (popup?.id === id) disposePopup()
  if (!entry) return
  closeExtensionPageTabs(entry.extension.url)
  try {
    getBrowserSession().extensions.removeExtension(entry.extension.id)
  } catch {
    // Already removed.
  }
  loaded.delete(id)
  refreshAdblockExemptions()
}

function registerStorePagePreload(): void {
  if (storePreloadRegistered) return
  const path = resolvePreload('web-store-page.cjs')
  if (!existsSync(path)) return
  try {
    getBrowserSession().registerPreloadScript({ type: 'frame', filePath: path })
    storePreloadRegistered = true
  } catch (error) {
    console.warn('[extensions] could not register the Chrome Web Store page hook:', errorMessage(error))
  }
}

/** Load every enabled installed extension. Call once after app ready, before tabs load pages. */
export async function initializeWebStoreExtensions(): Promise<void> {
  registerStorePagePreload()
  readRecords()
  for (const record of records.values()) {
    if (!record.enabled) continue
    try {
      await loadInstalled(record)
    } catch (error) {
      loadErrors.set(record.id, errorMessage(error))
      console.warn(`[extensions] could not load ${record.name}:`, errorMessage(error))
    }
  }
  publish()
}

// ---------------------------------------------------------------------------
// Download, gate, stage, activate

const webStoreFetch = createRestrictedFetch({
  label: 'Chrome Web Store',
  isAllowedUrl: (url) => isAllowedChromeWebStoreDownloadUrl(url),
  maxResponseBytes: MAX_CRX_BYTES,
  getSession: getBrowserSession,
  maxRedirects: 5
})

interface PreparedPackage {
  id: string
  temporaryRoot: string
  sourceDirectory: string
  manifest: JsonRecord
  name: string
  version: string
  compatibility: ExtensionCompatibility
  publicKey: string
}

async function downloadPackage(id: string): Promise<PreparedPackage> {
  const response = await webStoreFetch(chromeWebStoreCrxUrl(id, process.versions.chrome))
  if (response.status === 204 || response.status === 404) throw new Error('That extension was not found on the Chrome Web Store, or it is not offered for this Chrome version.')
  if (!response.ok) throw new Error(`The Chrome Web Store download failed (HTTP ${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error('That extension was not found on the Chrome Web Store.')
  const crx = parseCrx(bytes)
  if (crx.extensionId !== id) throw new Error(`The downloaded package belongs to a different extension (${crx.extensionId}).`)
  if (!crx.signatureVerified) throw new Error('The downloaded package failed its publisher signature check.')

  mkdirSync(rootDirectory(), { recursive: true })
  const temporaryRoot = mkdtempSync(join(rootDirectory(), 'stage-'))
  try {
    const sourceDirectory = join(temporaryRoot, 'source')
    extractExtensionZip(crx.archive, sourceDirectory, {
      label: 'extension package',
      maxArchiveBytes: MAX_CRX_BYTES,
      skip: (path) => path === '_metadata' || path.startsWith('_metadata/')
    })
    const manifest = JSON.parse(readFileSync(join(sourceDirectory, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')) as unknown
    if (!isRecord(manifest)) throw new Error('The extension manifest is not a JSON object.')
    const version = typeof manifest.version === 'string' ? manifest.version : ''
    return {
      id,
      temporaryRoot,
      sourceDirectory,
      manifest,
      name: resolveManifestMessage(sourceDirectory, manifest, manifest.name) || id,
      version,
      compatibility: analyzeExtensionCompatibility(manifest, collectExtensionSources(sourceDirectory)),
      publicKey: crx.publicKey.toString('base64')
    }
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

function mainWindow(): BaseWindow | undefined {
  const win = getMainWindow()
  return win && !win.isDestroyed() ? win : undefined
}

async function showDialog(options: Electron.MessageBoxOptions): Promise<number> {
  if (process.env.SURFFISH_EXTENSIONS_AUTO_CONFIRM === '1' && !app.isPackaged) return typeof options.defaultId === 'number' ? options.defaultId : 0
  const owner = mainWindow()
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  return result.response
}

async function confirmInstall(prepared: PreparedPackage, updatingFrom: string | null): Promise<boolean> {
  const { compatibility, manifest } = prepared
  const label = compatibilityLabel(compatibility.level)
  const permissions = stringList(manifest.permissions).filter((entry) => !entry.includes('://') && entry !== '<all_urls>')
  const hosts = [...stringList(manifest.host_permissions), ...stringList(manifest.permissions).filter((entry) => entry.includes('://') || entry === '<all_urls>')]
  if (compatibility.level === 'unsupported') {
    await showDialog({
      type: 'error',
      title: `${prepared.name} can’t run in Surffish`,
      message: `${prepared.name} ${prepared.version} is not compatible with Surffish.`,
      detail: compatibility.blockers.map((blocker) => `• ${blocker}`).join('\n'),
      buttons: ['OK'],
      defaultId: 0,
      noLink: true
    })
    return false
  }
  const detail = [
    `Compatibility: ${label}.`,
    compatibility.gaps.length > 0 ? `Won’t work in Surffish:\n${compatibility.gaps.map((gap) => `• ${gap}`).join('\n')}` : '',
    compatibility.shimmed.length > 0 ? `Provided by Surffish’s compatibility layer:\n${compatibility.shimmed.map((entry) => `• ${entry}`).join('\n')}` : '',
    `Permissions: ${permissions.join(', ') || 'none'}.`,
    `Site access: ${hosts.join(', ') || 'none'}.`,
    `Downloaded from the Chrome Web Store; the package signature matches extension ID ${prepared.id}.`
  ].filter(Boolean).join('\n\n')
  const verb = updatingFrom ? 'Update' : 'Add'
  const response = await showDialog({
    type: compatibility.level === 'partial' ? 'warning' : 'question',
    title: `${verb} ${prepared.name}?`,
    message: updatingFrom
      ? `Update ${prepared.name} from ${updatingFrom} to ${prepared.version}?`
      : `Add ${prepared.name} ${prepared.version} to Surffish?`,
    detail,
    buttons: ['Cancel', `${verb} extension`],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  })
  return response === 1
}

async function activatePrepared(prepared: PreparedPackage): Promise<void> {
  const { id } = prepared
  const previousRecord = records.get(id) ?? null
  const previousEntry = loaded.get(id) ?? null
  const finalDirectory = extensionDirectory(id, prepared.version)
  const staged = stageWebStoreExtension(prepared.sourceDirectory, join(prepared.temporaryRoot, 'extension'), prepared.publicKey)
  let activation: StagedActivation | null = null
  const browserSession = getBrowserSession()
  unloadExtension(id)
  try {
    activation = activateStagedDirectory(staged.stagedDirectory, finalDirectory)
    const extension = await loadExtensionWithFreshWorker(browserSession, finalDirectory, stampPath(id), extensionWorkerFiles(finalDirectory))
    try {
      assertExtensionIdentity(id, extension.id, 'Chrome Web Store package')
    } catch (error) {
      browserSession.extensions.removeExtension(extension.id)
      throw error
    }
    loaded.set(id, { extension, directory: finalDirectory, manifest: staged.manifest })
    loadErrors.delete(id)
    activation.commit()
    const now = Date.now()
    records.set(id, {
      id,
      version: prepared.version,
      name: prepared.name,
      enabled: true,
      installedAt: previousRecord?.installedAt ?? now,
      updatedAt: now,
      compatibility: prepared.compatibility.level === 'supported' ? 'supported' : 'partial',
      gaps: prepared.compatibility.gaps,
      shimmed: prepared.compatibility.shimmed
    })
    saveRecords()
    if (previousRecord && previousRecord.version !== prepared.version) {
      rmSync(extensionDirectory(id, previousRecord.version), { recursive: true, force: true })
    }
    refreshAdblockExemptions()
  } catch (error) {
    const message = errorMessage(error)
    if (loaded.has(id)) unloadExtension(id)
    activation?.rollback()
    let rollbackNote = ''
    if (previousRecord && previousEntry) {
      try {
        await loadInstalled(previousRecord)
      } catch (restoreError) {
        rollbackNote = ` The previous version could not be reloaded: ${errorMessage(restoreError)}`
      }
    }
    throw new Error(`${message}${rollbackNote}`)
  }
}

async function runExclusive(id: string | null, task: () => Promise<void>): Promise<WebStoreExtensionsState> {
  if (state.busy) {
    setStatus({ notice: 'Another extension change is still running.' })
    return getWebStoreExtensionsState()
  }
  setStatus({ busy: true, busyId: id, notice: null, error: null })
  try {
    await task()
  } catch (error) {
    state.error = errorMessage(error)
  } finally {
    state.busy = false
    state.busyId = null
    publish()
  }
  return getWebStoreExtensionsState()
}

async function installOrUpdate(id: string, mode: 'install' | 'update'): Promise<void> {
  const existing = records.get(id)
  const prepared = await downloadPackage(id)
  try {
    if (existing && compareExtensionVersions(prepared.version, existing.version) <= 0) {
      if (mode === 'update') {
        state.notice = `${existing.name} ${existing.version} is up to date.`
        return
      }
      if (loaded.has(id) || !existing.enabled) {
        state.notice = `${existing.name} ${existing.version} is already installed.`
        return
      }
    }
    if (!(await confirmInstall(prepared, existing && loaded.has(id) ? existing.version : null))) {
      state.notice = prepared.compatibility.level === 'unsupported'
        ? `${prepared.name} was not installed: it is not compatible with Surffish.`
        : `${prepared.name} was not ${existing ? 'updated' : 'installed'}.`
      return
    }
    await activatePrepared(prepared)
    state.notice = prepared.compatibility.level === 'partial'
      ? `${prepared.name} ${prepared.version} installed with partial support (${prepared.compatibility.gaps.length} feature${prepared.compatibility.gaps.length === 1 ? '' : 's'} unavailable).`
      : `${prepared.name} ${prepared.version} installed.`
  } finally {
    rmSync(prepared.temporaryRoot, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Public operations (renderer IPC)

export function installWebStoreExtension(input: unknown): Promise<WebStoreExtensionsState> {
  const id = parseChromeWebStoreInput(input)
  if (!id) {
    setStatus({ error: 'Paste a Chrome Web Store link (chromewebstore.google.com/detail/…) or a 32-letter extension ID.', notice: null })
    return Promise.resolve(getWebStoreExtensionsState())
  }
  return runExclusive(id, () => installOrUpdate(id, 'install'))
}

export function checkWebStoreExtensionUpdate(id: unknown): Promise<WebStoreExtensionsState> {
  if (!isChromeExtensionId(id) || !records.has(id)) return Promise.resolve(getWebStoreExtensionsState())
  return runExclusive(id, () => installOrUpdate(id, 'update'))
}

export function setWebStoreExtensionEnabled(id: unknown, enabled: unknown): Promise<WebStoreExtensionsState> {
  if (!isChromeExtensionId(id) || typeof enabled !== 'boolean') return Promise.resolve(getWebStoreExtensionsState())
  const record = records.get(id)
  if (!record) return Promise.resolve(getWebStoreExtensionsState())
  return runExclusive(id, async () => {
    if (enabled) {
      record.enabled = true
      saveRecords()
      if (!loaded.has(id)) {
        try {
          await loadInstalled(record)
        } catch (error) {
          loadErrors.set(id, errorMessage(error))
          throw error
        }
      }
      state.notice = `${record.name} is on. Reload open pages to apply it.`
    } else {
      unloadExtension(id)
      record.enabled = false
      saveRecords()
      state.notice = `${record.name} is off. Reload open pages to remove its changes.`
    }
  })
}

export function uninstallWebStoreExtension(id: unknown): Promise<WebStoreExtensionsState> {
  if (!isChromeExtensionId(id)) return Promise.resolve(getWebStoreExtensionsState())
  const record = records.get(id)
  if (!record) return Promise.resolve(getWebStoreExtensionsState())
  return runExclusive(id, async () => {
    const response = await showDialog({
      type: 'warning',
      title: `Remove ${record.name}?`,
      message: `Remove ${record.name} from Surffish?`,
      detail: 'Its settings and saved data in this Surffish profile are deleted too.',
      buttons: ['Cancel', 'Remove'],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    })
    if (response !== 1) return
    const origin = loaded.get(id)?.extension.url.replace(/\/$/, '') ?? `chrome-extension://${id}`
    unloadExtension(id)
    try {
      await getBrowserSession().clearStorageData({ origin })
    } catch {
      // Storage cleanup is best effort; the files are still removed.
    }
    records.delete(id)
    loadErrors.delete(id)
    saveRecords()
    rmSync(join(rootDirectory(), id), { recursive: true, force: true })
    state.notice = `${record.name} was removed.`
  })
}

export function openWebStoreExtensionOptions(id: unknown): WebStoreExtensionsState {
  const entry = isChromeExtensionId(id) ? loaded.get(id) : undefined
  const optionsPath = entry ? manifestOptionsPath(entry.manifest) : null
  if (!entry || !optionsPath) {
    setStatus({ error: 'This extension has no options page, or it is turned off.' })
    return getWebStoreExtensionsState()
  }
  disposePopup()
  if (!openExtensionPageTab(`${entry.extension.url}${optionsPath}`, entry.extension.url, resolvePreload('extension-host.cjs'), 'web-store')) {
    setStatus({ error: 'Could not open the extension’s options page.' })
  }
  return getWebStoreExtensionsState()
}

// ---------------------------------------------------------------------------
// Toolbar popup

function disposePopup(): void {
  const current = popup
  popup = null
  if (current && !current.window.isDestroyed()) current.window.close()
  publish()
}

function popupBounds(anchor: BramblePopupAnchor | undefined, size: { width: number; height: number }): Electron.Rectangle {
  const owner = mainWindow()
  const display = owner ? screen.getDisplayMatching(owner.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  const content = owner?.getContentBounds() ?? area
  return anchoredPopupBounds(anchor, content, area, size, screen.getCursorScreenPoint())
}

/**
 * Chrome-style preferred size: an explicit html/body width wins; otherwise shrink-to-fit the body
 * within the current (800px max) viewport. Height is the laid-out content height.
 */
const MEASURE_POPUP_SCRIPT = `(() => {
  const root = document.documentElement;
  const body = document.body;
  const viewport = window.innerWidth;
  const style = body ? getComputedStyle(body) : null;
  const marginX = style ? (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0) : 0;
  const marginBottom = style ? parseFloat(style.marginBottom) || 0 : 0;
  let width = root.getBoundingClientRect().width;
  if (width >= viewport - 1 && body) {
    const bodyWidth = body.getBoundingClientRect().width + marginX;
    if (bodyWidth < viewport - 1) {
      width = bodyWidth;
    } else {
      const previous = body.style.display;
      body.style.display = 'inline-block';
      width = body.getBoundingClientRect().width + marginX;
      body.style.display = previous;
    }
  }
  const height = Math.max(root.getBoundingClientRect().height, body ? body.getBoundingClientRect().bottom + marginBottom : 0);
  return { width: Math.ceil(width), height: Math.ceil(height) };
})()`

function clampPopupSize(value: unknown): { width: number; height: number } {
  const size = isRecord(value) ? value : {}
  const width = typeof size.width === 'number' && Number.isFinite(size.width) ? size.width : 360
  const height = typeof size.height === 'number' && Number.isFinite(size.height) ? size.height : 240
  return {
    width: Math.round(Math.min(POPUP_MAX.width, Math.max(POPUP_MIN.width, width))),
    height: Math.round(Math.min(POPUP_MAX.height, Math.max(POPUP_MIN.height, height)))
  }
}

export function openWebStoreExtensionPopup(id: unknown, anchor?: BramblePopupAnchor): WebStoreExtensionsState {
  const entry = isChromeExtensionId(id) ? loaded.get(id) : undefined
  if (!entry) {
    setStatus({ error: 'That extension is not loaded. Turn it on in Settings → Integrations.' })
    return getWebStoreExtensionsState()
  }
  if (popup && popup.id === entry.extension.id && !popup.window.isDestroyed()) {
    disposePopup()
    return getWebStoreExtensionsState()
  }
  disposePopup()
  const popupPath = manifestPopupPath(entry.manifest)
  if (!popupPath) {
    if (manifestOptionsPath(entry.manifest)) return openWebStoreExtensionOptions(entry.extension.id)
    setStatus({ notice: `${entry.extension.name} has no popup or options page; it works on matching sites automatically.` })
    return getWebStoreExtensionsState()
  }
  const extensionUrl = entry.extension.url
  const pageUrl = `${extensionUrl}${popupPath}`
  const window = new BrowserWindow({
    title: entry.extension.name,
    ...popupBounds(anchor, POPUP_MAX),
    useContentSize: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    autoHideMenuBar: true,
    roundedCorners: true,
    parent: mainWindow(),
    webPreferences: {
      session: getBrowserSession(),
      preload: resolvePreload('extension-host.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })
  popup = { window, id: entry.extension.id }
  const contents = window.webContents
  window.on('closed', () => {
    if (popup?.window === window) {
      popup = null
      publish()
    }
  })
  window.on('blur', () => {
    if (!window.isDestroyed() && window.isVisible()) window.close()
  })
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      if (!window.isDestroyed()) window.close()
    }
  })
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedExtensionTabUrl(url, entry.extension.id) || !url.startsWith(extensionUrl)) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(extensionUrl)) {
      openExtensionPageTab(url, extensionUrl, resolvePreload('extension-host.cjs'), 'web-store')
    } else if (/^https?:\/\//i.test(url)) {
      createExtensionTab(url, true)
    }
    return { action: 'deny' }
  })
  const fit = async (): Promise<void> => {
    if (window.isDestroyed()) return
    const size = clampPopupSize(await contents.executeJavaScript(MEASURE_POPUP_SCRIPT, true).catch(() => null))
    if (window.isDestroyed()) return
    window.setBounds(popupBounds(anchor, size))
  }
  contents.once('did-finish-load', () => {
    void fit().then(() => {
      if (window.isDestroyed()) return
      window.show()
      window.focus()
      publish()
      // Late layout (fonts, async rendering): fit once more.
      setTimeout(() => { void fit() }, 250)
    })
  })
  void window.loadURL(pageUrl).catch((error: unknown) => {
    setStatus({ error: `Could not open ${entry.extension.name}’s popup: ${errorMessage(error)}` })
    if (!window.isDestroyed()) window.close()
  })
  return getWebStoreExtensionsState()
}

// ---------------------------------------------------------------------------
// Extension-page bridge (chrome.tabs + openOptionsPage shims)

/** The loaded Web Store extension whose own popup/options page sent this IPC, or null. */
export function webStoreExtensionForSender(sender: WebContents, senderFrame: Electron.WebFrameMain | null): LoadedEntry | null {
  if (!senderFrame || senderFrame !== sender.mainFrame) return null
  let url: URL
  try {
    url = new URL(senderFrame.url)
  } catch {
    return null
  }
  if (url.protocol !== 'chrome-extension:') return null
  const entry = loaded.get(url.hostname)
  if (!entry) return null
  const fromPopup = popup?.id === url.hostname && !popup.window.isDestroyed() && popup.window.webContents === sender
  if (!fromPopup && !isExtensionPageTab(sender, entry.extension.url, 'web-store')) return null
  return entry
}

function accessFor(entry: LoadedEntry): ExtensionAccess {
  return {
    permissions: stringList(entry.manifest.permissions),
    hostPermissions: stringList(entry.manifest.host_permissions)
  }
}

export function handleExtensionTabsCall(entry: LoadedEntry, op: unknown, payloadInput: unknown): unknown {
  const payload = isRecord(payloadInput) ? payloadInput : {}
  const access = accessFor(entry)
  const id = entry.extension.id
  const tabId = typeof payload.tabId === 'number' && Number.isSafeInteger(payload.tabId) ? payload.tabId : undefined
  const checkedUrl = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (!isAllowedExtensionTabUrl(value, id)) throw new Error('Extensions can only open web pages or their own pages in Surffish.')
    return value
  }
  switch (op) {
    case 'query':
      return filterTabsForQuery(listExtensionTabs(), payload).map((tab) => toChromeTab(tab, access))
    case 'get': {
      const tab = tabId === undefined ? null : getExtensionTab(tabId)
      if (!tab) throw new Error(`No tab with id: ${String(payload.tabId)}.`)
      return toChromeTab(tab, access)
    }
    case 'create': {
      const url = checkedUrl(payload.url)
      const active = payload.active !== false
      const tab = url !== undefined && url.startsWith(entry.extension.url)
        ? createExtensionTab(url, active, { extensionUrl: entry.extension.url, preloadPath: resolvePreload('extension-host.cjs'), owner: 'web-store' })
        : createExtensionTab(url, active)
      if (!tab) throw new Error('Could not open a tab.')
      return toChromeTab(tab, access)
    }
    case 'update': {
      const url = checkedUrl(payload.url)
      if (url?.startsWith('chrome-extension:')) throw new Error('Open extension pages with tabs.create.')
      const tab = updateExtensionTab(tabId, {
        url,
        active: typeof payload.active === 'boolean' ? payload.active : undefined,
        pinned: typeof payload.pinned === 'boolean' ? payload.pinned : undefined
      })
      if (!tab) throw new Error(`No tab with id: ${String(payload.tabId)}.`)
      return toChromeTab(tab, access)
    }
    case 'reload':
      if (!reloadExtensionTab(tabId, payload.bypassCache === true)) throw new Error(`No tab with id: ${String(payload.tabId)}.`)
      return undefined
    case 'remove': {
      const ids = Array.isArray(payload.tabIds) ? payload.tabIds.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value)) : []
      removeExtensionTabs(ids)
      return undefined
    }
    default:
      throw new Error('Unsupported tabs operation.')
  }
}

export function openOptionsFromExtensionPage(entry: LoadedEntry): boolean {
  openWebStoreExtensionOptions(entry.extension.id)
  return true
}

/** "Add to Surffish" clicked on a Web Store page: the ID comes from the frame's own URL. */
export async function installFromStorePage(sender: WebContents, senderFrame: Electron.WebFrameMain | null): Promise<void> {
  if (!senderFrame || senderFrame !== sender.mainFrame || sender.session !== getBrowserSession()) return
  let url: URL
  try {
    url = new URL(senderFrame.url)
  } catch {
    return
  }
  if (url.protocol !== 'https:' || url.hostname !== 'chromewebstore.google.com') return
  const id = parseChromeWebStoreInput(url.toString())
  if (!id) return
  await installWebStoreExtension(id)
}

export function disposeWebStoreExtensions(): void {
  disposePopup()
}
