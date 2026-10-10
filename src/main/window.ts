import { BrowserWindow, app, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { attachBrowserView } from './browser'
import { APP_NAME, WINDOW } from '../shared/config'

const isMac = process.platform === 'darwin'
const mainDirectory = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let onMainWindowClosed: () => void = () => {}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
export function setMainWindowCloseHandler(handler: () => void): void {
  onMainWindowClosed = handler
}
function resolvePreload(): string {
  const base = join(mainDirectory, '../preload/index')
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}
export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    transparent: isMac,
    vibrancy: isMac ? 'fullscreen-ui' : undefined,
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
    void win.loadFile(join(mainDirectory, '../renderer/index.html'))
  }
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      onMainWindowClosed()
    }
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
