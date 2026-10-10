import { app, BrowserWindow, dialog } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BramblePocState } from '../shared/types'
import { getBrowserSession } from './browser-session'
import {
  adaptBrambleFirefoxManifest,
  isRecord,
  stageBrambleFirefoxBuild
} from './bramble-poc-adapter'
import { getMainWindow } from './window'

const CONFIG_FILENAME = 'bramble-firefox-poc.json'
const STAGING_DIRECTORY = 'bramble-firefox-poc/extension'
const BRAMBLE_WINDOW_WIDTH = 720
const BRAMBLE_WINDOW_HEIGHT = 780

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
let offscreenWindow: BrowserWindow | null = null

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

function showBramblePage(page: 'popup.html' | 'options.html'): void {
  if (!loadedExtension) throw new Error('Bramble has not been loaded yet.')
  const pageUrl = `${loadedExtension.url}${page}`
  if (popupWindow && !popupWindow.isDestroyed()) {
    if (popupWindow.webContents.getURL() !== pageUrl) {
      void popupWindow.loadURL(pageUrl).catch((error: unknown) => {
        updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
      })
    }
    if (popupWindow.isMinimized()) popupWindow.restore()
    popupWindow.show()
    popupWindow.focus()
    updateState({ popupOpen: true, error: null })
    return
  }

  const popup = new BrowserWindow({
    title: 'Bramble vault (POC)',
    width: BRAMBLE_WINDOW_WIDTH,
    height: BRAMBLE_WINDOW_HEIGHT,
    minWidth: 520,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    parent: mainWindow(),
    webPreferences: {
      session: getBrowserSession(),
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
  void popup.loadURL(pageUrl).catch((error: unknown) => {
    updateState({ error: `Could not open Bramble’s UI: ${error instanceof Error ? error.message : String(error)}` })
    if (!popup.isDestroyed()) popup.close()
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

export async function openBramblePoc(): Promise<BramblePocState> {
  if (state.loading) return getBramblePocState()
  if (!loadedExtension) await chooseAndLoadBramble()
  if (loadedExtension) {
    try {
      await ensureOffscreenDocument()
      showBramblePage('popup.html')
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
      showBramblePage('options.html')
    } catch (error) {
      updateState({ error: error instanceof Error ? error.message : String(error) })
    }
  }
  return getBramblePocState()
}

export function disposeBramblePoc(): void {
  disposePopup()
  disposeOffscreen()
}
