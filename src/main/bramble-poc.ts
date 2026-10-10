import { app, BrowserWindow, dialog, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BramblePopupAnchor, BramblePocState } from '../shared/types'
import { getBrowserSession } from './browser-session'
import {
  adaptBrambleFirefoxManifest,
  isRecord,
  stageBrambleFirefoxBuild
} from './bramble-poc-adapter'
import { getMainWindow } from './window'

const CONFIG_FILENAME = 'bramble-firefox-poc.json'
const STAGING_DIRECTORY = 'bramble-firefox-poc/extension'
const BRAMBLE_POPUP_WIDTH = 500
const BRAMBLE_POPUP_HEIGHT = 550
const BRAMBLE_OPTIONS_WIDTH = 860
const BRAMBLE_OPTIONS_HEIGHT = 720
const mainDirectory = dirname(fileURLToPath(import.meta.url))

interface LoadedBrambleExtension {
  id: string
  name: string
  version: string
  url: string
}

const state: BramblePocState = {
  installed: false,
  loading: false,
  version: null,
  popupOpen: false,
  error: null
}
let loadedExtension: LoadedBrambleExtension | null = null
let popupWindow: BrowserWindow | null = null
let setupWindow: BrowserWindow | null = null
let offscreenWindow: BrowserWindow | null = null

function resolveBramblePreload(): string {
  const base = join(mainDirectory, '../preload/bramble-poc')
  if (existsSync(`${base}.cjs`)) return `${base}.cjs`
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}

function launcherBounds(anchor: BramblePopupAnchor | undefined, owner: BrowserWindow | undefined): { x: number; y: number; width: number; height: number } {
  const display = owner ? screen.getDisplayMatching(owner.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  const content = owner?.getContentBounds() ?? area
  const width = Math.min(BRAMBLE_POPUP_WIDTH, Math.max(1, area.width - 16))
  const height = Math.min(BRAMBLE_POPUP_HEIGHT, Math.max(1, area.height - 16))
  const cursor = screen.getCursorScreenPoint()
  const left = content.x + (anchor?.x ?? cursor.x - content.x)
  const top = content.y + (anchor?.y ?? cursor.y - content.y)
  const x = Math.max(area.x, Math.min(left, area.x + area.width - width))
  let y = top + (anchor?.height ?? 0) + 6
  if (y + height > area.y + area.height) y = top - height - 6
  y = Math.max(area.y, Math.min(y, area.y + area.height - height))
  return { x, y, width, height }
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
  const maxHeight = Math.max(560, workArea.height - 72)
  const width = Math.min(maxWidth, Math.max(760, bounds.width || BRAMBLE_OPTIONS_WIDTH))
  const height = Math.min(maxHeight, Math.max(640, Math.min(bounds.height || BRAMBLE_OPTIONS_HEIGHT, 900)))
  win.setContentSize(width, height)
}

function mainWindow(): BrowserWindow | undefined {
  const win = getMainWindow()
  return win && !win.isDestroyed() ? win : undefined
}

function publishState(): void {
  const win = mainWindow()
  if (win) win.webContents.send('browser:bramble:changed', { ...state })
}

function updateState(patch: Partial<BramblePocState>): void {
  Object.assign(state, patch)
  publishState()
}

export function getBramblePocState(): BramblePocState {
  return { ...state }
}

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

function readSavedSourceDirectory(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'))
    if (!isRecord(parsed) || typeof parsed.sourceDirectory !== 'string') return null
    return resolve(parsed.sourceDirectory)
  } catch {
    return null
  }
}

function saveSourceDirectory(sourceDirectory: string): void {
  writeFileSync(configPath(), `${JSON.stringify({ sourceDirectory }, null, 2)}\n`, { mode: 0o600 })
}

function stageBrambleBuild(sourceDirectory: string): { stagedDirectory: string; version: string } {
  return stageBrambleFirefoxBuild(sourceDirectory, join(app.getPath('userData'), STAGING_DIRECTORY))
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
    title: 'Bramble offscreen host (POC)',
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

async function loadFromDirectory(sourceDirectory: string, persistPath: boolean): Promise<void> {
  updateState({ loading: true, error: null })
  disposePopup()
  disposeSetupWindow()
  disposeOffscreen()
  try {
    const staged = stageBrambleBuild(sourceDirectory)
    const browserSession = getBrowserSession()
    if (loadedExtension) {
      browserSession.extensions.removeExtension(loadedExtension.id)
      loadedExtension = null
    }
    const extension = await browserSession.extensions.loadExtension(staged.stagedDirectory)
    loadedExtension = {
      id: extension.id,
      name: extension.name,
      version: extension.version,
      url: extension.url
    }
    await ensureOffscreenDocument()
    if (persistPath) saveSourceDirectory(resolve(sourceDirectory))
    updateState({ installed: true, loading: false, version: extension.version, error: null })
  } catch (error) {
    disposePopup()
    disposeOffscreen()
    if (loadedExtension) {
      try {
        getBrowserSession().extensions.removeExtension(loadedExtension.id)
      } catch {
        // The extension may already have been removed by a failed load.
      }
      loadedExtension = null
    }
    updateState({ installed: false, loading: false, version: null, error: error instanceof Error ? error.message : String(error) })
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
    popupWindow.setBounds(bounds)
    if (popupWindow.isMinimized()) popupWindow.restore()
    popupWindow.show()
    popupWindow.focus()
    updateState({ popupOpen: true, error: null })
    return
  }

  const popup = new BrowserWindow({
    title: 'Bramble vault (POC)',
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
    // Keep Bramble pages inside the extension origin; do not turn its UI into a generic browser.
    if (url.startsWith(loadedExtension!.url)) return { action: 'allow' }
    return { action: 'deny' }
  })
  popup.once('ready-to-show', () => {
    if (!popup.isDestroyed()) popup.show()
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
    title: 'Bramble Setup / Restore (POC)',
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

async function chooseAndLoadBramble(): Promise<void> {
  const owner = mainWindow()
  const selectionOptions = {
    title: 'Select Bramble’s unpacked Firefox build',
    buttonLabel: 'Select build',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const selection = owner
    ? await dialog.showOpenDialog(owner, selectionOptions)
    : await dialog.showOpenDialog(selectionOptions)
  if (selection.canceled || !selection.filePaths[0]) return

  const sourceDirectory = resolve(selection.filePaths[0])
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(sourceDirectory, 'manifest.json'), 'utf8'))
    adaptBrambleFirefoxManifest(manifest)
  } catch (error) {
    updateState({ error: error instanceof Error ? error.message : String(error) })
    return
  }
  const hostPatterns = isRecord(manifest) && Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []
  const permissions = isRecord(manifest) && Array.isArray(manifest.permissions) ? manifest.permissions : []
  const confirmationOptions = {
    type: 'warning' as const,
    title: 'Load Bramble Firefox build for this POC?',
    message: 'Bramble will run as an experimental browser extension in Sockfish.',
    detail: [
      'This build requests host access to <all_urls> and installs content scripts on matching pages for autofill and its Firefox passkey bridge.',
      `Declared extension permissions: ${permissions.filter((permission) => typeof permission === 'string').join(', ') || 'none'}.`,
      `Host access: ${hostPatterns.filter((pattern) => typeof pattern === 'string').join(', ') || 'none'}.`,
      'The POC adapts a private copy of the Firefox build. Local vault storage and unlock are the target; Bramble’s identity/OAuth backup flow is not supported by Electron. Sockfish does not read, log, or store your vault password.'
    ].join('\n\n'),
    buttons: ['Cancel', 'Load Bramble POC'],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  }
  const confirmation = owner
    ? await dialog.showMessageBox(owner, confirmationOptions)
    : await dialog.showMessageBox(confirmationOptions)
  if (confirmation.response !== 1) return

  await loadFromDirectory(sourceDirectory, true)
}

export async function initializeBramblePoc(): Promise<void> {
  const developmentSource = process.env.SOCKFISH_BRAMBLE_POC_DEV_AUTOLOAD === '1'
    ? process.env.SOCKFISH_BRAMBLE_EXTENSION_DIR
    : undefined
  if (!app.isPackaged && developmentSource) {
    await loadFromDirectory(developmentSource, false)
    return
  }

  const sourceDirectory = readSavedSourceDirectory()
  if (!sourceDirectory) return
  if (!existsSync(sourceDirectory)) {
    updateState({ error: 'The saved Bramble Firefox build folder is no longer available. Use the Bramble toolbar button to select it again.' })
    return
  }
  await loadFromDirectory(sourceDirectory, false)
}

export async function openBramblePoc(anchor?: BramblePopupAnchor): Promise<BramblePocState> {
  if (state.loading) return getBramblePocState()
  if (!loadedExtension) await chooseAndLoadBramble()
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

export async function openBrambleSetup(): Promise<BramblePocState> {
  if (state.loading) return getBramblePocState()
  if (!loadedExtension) await chooseAndLoadBramble()
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

export function isBrambleUiWindow(win: BrowserWindow | null): boolean {
  return !!win && (win === popupWindow || win === setupWindow)
}

export function disposeBramblePoc(): void {
  disposePopup()
  disposeSetupWindow()
  disposeOffscreen()
}
