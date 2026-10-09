import { BrowserWindow, app, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { attachBrowserView } from './browser'
import { WINDOW } from '../shared/config'
import type { GlassState, VibrancyName } from '../shared/types'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
const DEFAULT_VIBRANCY: VibrancyName = 'fullscreen-ui'
let currentVibrancy: VibrancyName | null = isMac ? DEFAULT_VIBRANCY : null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function resolvePreload(): string {
  const base = join(__dirname, '../preload/index')
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    transparent: isMac,
    vibrancy: currentVibrancy ?? undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: isMac ? '#00000000' : '#101418',
    webPreferences: {
      preload: resolvePreload(),
      sandbox: false,
      contextIsolation: true
    }
  })
  mainWindow = win
  attachBrowserView(win)
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

export function showWindow(): void {
  if (isMac) app.show()
  const win = mainWindow
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function hideWindow(): void {
  mainWindow?.hide()
}

export function getGlassState(): GlassState {
  return { platform: process.platform, vibrancy: currentVibrancy, transparent: isMac }
}

export function setGlassVibrancy(name: VibrancyName | null): GlassState {
  currentVibrancy = isMac ? name : null
  mainWindow?.setVibrancy(currentVibrancy)
  return getGlassState()
}
