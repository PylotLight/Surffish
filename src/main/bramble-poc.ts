import { app, BrowserWindow, dialog, net, screen, type BaseWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrambleExtensionState, BramblePopupAnchor } from '../shared/types'
import { getBrowserSession } from './browser-session'
import {
  adaptBrambleFirefoxManifest,
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
import { anchoredPopupBounds } from '../shared/window-geometry'
import { sendToMainWindowRenderers } from './browser-shell'

const CONFIG_FILENAME = 'bramble-firefox-poc.json'
const BRAMBLE_DATA_DIRECTORY = 'bramble-firefox-poc'
const STAGING_DIRECTORY = 'bramble-firefox-poc/extension'
const RELEASE_DIRECTORY = 'bramble-firefox-poc/releases'
const BRAMBLE_POPUP_WIDTH = 500
const BRAMBLE_POPUP_HEIGHT = 550
const BRAMBLE_OPTIONS_WIDTH = 860
const BRAMBLE_OPTIONS_HEIGHT = 720
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
let setupWindow: BrowserWindow | null = null
let offscreenWindow: BrowserWindow | null = null

function isAllowedBrambleReleaseUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && BRAMBLE_RELEASE_REQUEST_HOSTS.has(url.hostname)
}

// Session.fetch cancels redirect:'manual' in Electron instead of exposing the 3xx response; net.request preserves the configured session/proxy while leaving each redirect hop inspectable.
function fetchBrambleReleaseOnce(url: URL, method: string, headers: Headers, signal?: AbortSignal | null): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url: url.toString(), method, session: getBrowserSession() })
    headers.forEach((value, name) => request.setHeader(name, value))
    let settled = false
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    const resolveOnce = (response: Response): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }
    const rejectOnce = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const onAbort = (): void => {
      rejectOnce(signal?.reason ?? new DOMException('The request was aborted.', 'AbortError'))
      request.abort()
    }

    request.on('error', rejectOnce)
    request.on('redirect', (statusCode, _redirectMethod, _redirectUrl, responseHeaders) => {
      const location = Object.entries(responseHeaders).find(([name]) => name.toLowerCase() === 'location')?.[1]?.[0]
      if (!location) {
        rejectOnce(new Error('The GitHub release download returned a redirect without a destination.'))
      } else {
        const headers = new Headers()
        headers.set('location', location)
        resolveOnce(new Response(null, { status: statusCode, headers }))
      }
      request.abort()
    })
    request.on('response', (response) => {
      const responseHeaders = new Headers()
      for (const [name, rawValue] of Object.entries(response.headers)) {
        if (rawValue === undefined) continue
        for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) responseHeaders.append(name, value)
      }
      const rawLength = responseHeaders.get('content-length')
      if (rawLength && Number(rawLength) > MAX_BRAMBLE_RELEASE_RESPONSE_BYTES) {
        rejectOnce(new Error('The GitHub release response exceeds the allowed download size.'))
        request.abort()
        return
      }
      const chunks: Buffer[] = []
      let totalBytes = 0
      response.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += bytes.length
        if (totalBytes > MAX_BRAMBLE_RELEASE_RESPONSE_BYTES) {
          rejectOnce(new Error('The GitHub release response exceeds the allowed download size.'))
          request.abort()
          return
        }
        chunks.push(bytes)
      })
      response.on('aborted', () => rejectOnce(new Error('The GitHub release response ended unexpectedly.')))
      response.on('error', rejectOnce)
      response.on('end', () => {
        if (settled) return
        const status = response.statusCode ?? 200
        const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks, totalBytes)
        resolveOnce(new Response(body, { status, headers: responseHeaders }))
      })
    })
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
    }
    request.end()
  })
}

async function fetchBrambleRelease(input: string | URL | Request, init?: RequestInit, redirects = 0): Promise<Response> {
  const requestInput = input instanceof Request ? input : null
  const url = new URL(requestInput?.url ?? String(input))
  if (!isAllowedBrambleReleaseUrl(url)) throw new Error('The Bramble release request URL is not an approved GitHub host.')
  const method = init?.method ?? requestInput?.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') throw new Error('Bramble release requests must use GET or HEAD.')
  if (init?.body || requestInput?.body) throw new Error('Bramble release requests cannot send a request body.')
  const headers = new Headers(requestInput?.headers)
  if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value))
  const redirectMode = init?.redirect ?? requestInput?.redirect ?? 'follow'
  const response = await fetchBrambleReleaseOnce(url, method, headers, init?.signal ?? requestInput?.signal)
  if (response.status < 300 || response.status >= 400) return response
  if (redirectMode === 'manual') return response
  if (redirectMode === 'error') throw new Error('The GitHub release endpoint redirected unexpectedly.')
  if (redirects >= 4) throw new Error('The GitHub release request exceeded the redirect limit.')
  const location = response.headers.get('location')
  if (!location) throw new Error('The GitHub release request returned an invalid redirect.')
  const nextUrl = new URL(location, url)
  if (!isAllowedBrambleReleaseUrl(nextUrl)) throw new Error('The GitHub release request redirected outside the approved GitHub hosts.')
  return fetchBrambleRelease(nextUrl, init, redirects + 1)
}

function resolveBramblePreload(): string {
  const base = join(mainDirectory, '../preload/bramble-poc')
  if (existsSync(`${base}.cjs`)) return `${base}.cjs`
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}

function launcherBounds(anchor: BramblePopupAnchor | undefined, owner: BaseWindow | undefined): { x: number; y: number; width: number; height: number } {
  const display = owner ? screen.getDisplayMatching(owner.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  const content = owner?.getContentBounds() ?? area
  return anchoredPopupBounds(anchor, content, area, { width: BRAMBLE_POPUP_WIDTH, height: BRAMBLE_POPUP_HEIGHT }, screen.getCursorScreenPoint())
}

async function fitOptionsWindowToDocument(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  const workArea = screen.getDisplayMatching(win.getBounds()).workArea
  const bounds = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = document.querySelector('#root');
      const documentElement = document.documentElement;
      resolve({
        width: Math.max(documentElement.scrollWidth, root?.scrollWidth ?? 0),
        height: Math.max(documentElement.scrollHeight, root?.scrollHeight ?? 0)
      });
    }));
  })`) as { width?: number; height?: number }
  if (win.isDestroyed()) return
  const maxWidth = Math.max(640, workArea.width - 48)
  const maxHeight = Math.max(560, workArea.height - 48)
  const width = Math.min(maxWidth, Math.max(760, bounds.width || BRAMBLE_OPTIONS_WIDTH))
  const height = Math.min(maxHeight, Math.max(680, Math.min(bounds.height || BRAMBLE_OPTIONS_HEIGHT, 900)))
  win.setContentSize(width, height)
}

async function showBramblePopupPage(popup: BrowserWindow, pageUrl: string): Promise<void> {
  const extension = loadedExtension
  if (!extension || !isBrambleExtensionUrl(pageUrl, extension.url)) {
    throw new Error('Only Bramble extension pages can open in the Bramble popup.')
  }
  if (popup.webContents.getURL() !== pageUrl) await popup.loadURL(pageUrl)
  if (popup.isDestroyed()) return

  const requested = new URL(pageUrl)
  const optionsPath = new URL(`${extension.url}options.html`).pathname
  popup.setResizable(false)
  if (requested.pathname === optionsPath) {
    await fitOptionsWindowToDocument(popup)
    if (popup.isDestroyed()) return
    const [width = BRAMBLE_OPTIONS_WIDTH, height = BRAMBLE_OPTIONS_HEIGHT] = popup.getContentSize()
    const workArea = screen.getDisplayMatching(popup.getBounds()).workArea
    const x = Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, Math.round(workArea.x + (workArea.width - width) / 2)))
    const y = Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, Math.round(workArea.y + (workArea.height - height) / 2)))
    popup.setBounds({ x, y, width, height })
    popup.setTitle('Bramble Setup / Restore')
  } else {
    popup.setBounds(launcherBounds(undefined, mainWindow()))
    popup.setTitle('Bramble')
  }
  if (popup.isMinimized()) popup.restore()
  popup.show()
  popup.focus()
  updateState({ popupOpen: true, error: null })
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
  mkdirSync(dirname(configPath()), { recursive: true })
  const targetPath = configPath()
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  const backupPath = `${targetPath}.${randomUUID()}.backup`
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  let backedUp = false
  try {
    if (existsSync(targetPath)) {
      renameSync(targetPath, backupPath)
      backedUp = true
    }
    renameSync(temporaryPath, targetPath)
  } catch (error) {
    if (backedUp && !existsSync(targetPath) && existsSync(backupPath)) renameSync(backupPath, targetPath)
    rmSync(temporaryPath, { force: true })
    throw error
  }
  if (backedUp) {
    try {
      rmSync(backupPath, { force: true })
    } catch {
      // The verified new config is already active; a stale backup is harmless.
    }
  }
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

function disposeSetupWindow(): void {
  const current = setupWindow
  setupWindow = null
  if (current && !current.isDestroyed()) current.close()
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
  const backupDirectory = `${finalDirectory}.backup-${randomUUID()}`
  const previousExtension = loadedExtension
  const previousState = { ...state }
  let backedUp = false
  let activated = false
  const browserSession = getBrowserSession()

  disposePopup()
  disposeSetupWindow()
  disposeOffscreen()
  try {
    if (previousExtension) {
      browserSession.extensions.removeExtension(previousExtension.id)
      loadedExtension = null
    }
    if (existsSync(finalDirectory)) {
      renameSync(finalDirectory, backupDirectory)
      backedUp = true
    }
    renameSync(stagedDirectory, finalDirectory)
    activated = true
    const extension = await browserSession.extensions.loadExtension(finalDirectory)
    loadedExtension = { id: extension.id, name: extension.name, version: extension.version, url: extension.url }
    if (previousExtension && extension.id !== previousExtension.id) {
      throw new Error('The update would change Bramble’s extension identity. The existing vault copy was left in place.')
    }
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
    if (backedUp) {
      try {
        rmSync(backupDirectory, { recursive: true, force: true })
      } catch {
        // Keep the successful install; an unreferenced backup can be cleaned up later.
      }
    }
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error)
    disposePopup()
    disposeSetupWindow()
    disposeOffscreen()
    if (loadedExtension) {
      try {
        browserSession.extensions.removeExtension(loadedExtension.id)
      } catch {
        // The extension may already have been removed as part of a failed load.
      }
      loadedExtension = null
    }
    if (activated && existsSync(finalDirectory)) rmSync(finalDirectory, { recursive: true, force: true })
    if (backedUp && existsSync(backupDirectory)) renameSync(backupDirectory, finalDirectory)
    let rollbackError = ''
    if (previousExtension && existsSync(finalDirectory)) {
      try {
        const restored = await browserSession.extensions.loadExtension(finalDirectory)
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

function showBrambleLauncher(anchor?: BramblePopupAnchor): void {
  if (!loadedExtension) throw new Error('Bramble has not been loaded yet.')
  const pageUrl = `${loadedExtension.url}popup.html`
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
    // Route trusted extension pages into this popup instead of creating a detached window.
    const extension = loadedExtension
    if (extension && isBrambleExtensionUrl(url, extension.url)) {
      void showBramblePopupPage(popup, url).catch((error: unknown) => {
        updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
      })
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

function showBrambleSetupWindow(): void {
  if (!loadedExtension) throw new Error('Bramble has not been loaded yet.')
  const pageUrl = `${loadedExtension.url}options.html`
  if (setupWindow && !setupWindow.isDestroyed()) {
    if (setupWindow.webContents.getURL() !== pageUrl) {
      void setupWindow.loadURL(pageUrl).catch((error: unknown) => {
        updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
      })
    }
    if (setupWindow.isMinimized()) setupWindow.restore()
    setupWindow.show()
    setupWindow.focus()
    disposePopup()
    updateState({ popupOpen: false, error: null })
    return
  }

  const owner = mainWindow()
  const display = owner ? screen.getDisplayMatching(owner.getBounds()) : screen.getPrimaryDisplay()
  const width = Math.min(BRAMBLE_OPTIONS_WIDTH, Math.max(640, display.workArea.width - 48))
  const height = Math.min(BRAMBLE_OPTIONS_HEIGHT, Math.max(560, display.workArea.height - 72))
  const setup = new BrowserWindow({
    title: 'Bramble Setup / Restore',
    width,
    height,
    minWidth: Math.min(760, width),
    minHeight: Math.min(640, height),
    useContentSize: true,
    show: false,
    resizable: true,
    fullscreenable: false,
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
  setupWindow = setup
  setup.on('closed', () => {
    if (setupWindow === setup) setupWindow = null
  })
  setup.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(loadedExtension!.url)) return { action: 'allow' }
    return { action: 'deny' }
  })
  setup.once('ready-to-show', () => {
    void fitOptionsWindowToDocument(setup).then(() => {
      if (!setup.isDestroyed()) {
        setup.show()
        setup.focus()
        disposePopup()
      }
    }).catch((error: unknown) => {
      updateState({ error: `Could not size Bramble’s setup window: ${error instanceof Error ? error.message : String(error)}` })
      if (!setup.isDestroyed()) {
        setup.show()
        setup.focus()
        disposePopup()
      }
    })
    updateState({ popupOpen: false, error: null })
  })
  void setup.loadURL(pageUrl).catch((error: unknown) => {
    updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
    if (!setup.isDestroyed()) setup.close()
  })
}

function releaseArchivePath(version: string, sha256: string): string {
  return join(brambleDirectory(RELEASE_DIRECTORY), `bramble_firefox_${version}_${sha256}.zip`)
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
  try {
    const extension = await getBrowserSession().extensions.loadExtension(directory)
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
        'The “Create your vault” flow from the toolbar stays in the popup. Setup / customize in Integrations opens the larger setup window. Updating replaces extension files but keeps the existing browser profile and vault storage.'
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
      showBrambleSetupWindow()
    } catch (error) {
      updateState({ error: error instanceof Error ? error.message : String(error) })
    }
  }
  return getBramblePocState()
}

export async function openBrambleOptionsFromUi(sourceWindow: BrowserWindow | null): Promise<void> {
  if (sourceWindow && sourceWindow === popupWindow && !sourceWindow.isDestroyed()) {
    if (!loadedExtension) {
      updateState({ error: 'Bramble has not been loaded yet.' })
      return
    }
    try {
      await showBramblePopupPage(sourceWindow, `${loadedExtension.url}options.html`)
    } catch (error) {
      updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
    }
    return
  }
  await openBrambleSetup()
}

export function isBrambleUiWindow(win: BrowserWindow | null): boolean {
  return !!win && (win === popupWindow || win === setupWindow)
}

export function disposeBramblePoc(): void {
  disposePopup()
  disposeSetupWindow()
  disposeOffscreen()
}
