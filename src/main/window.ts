import { BaseWindow, WebContentsView, app, shell } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { attachBrowserView, handleBrowserShortcut, syncBrowserBoundsToWindow } from './browser'
import { attachBrowserShell, detachBrowserShell } from './browser-shell'
import { APP_NAME, WINDOW } from '../shared/config'

const isMac = process.platform === 'darwin'
const mainDirectory = dirname(fileURLToPath(import.meta.url))
const rendererFile = join(mainDirectory, '../renderer/index.html')
let mainWindow: BaseWindow | null = null
let onMainWindowClosed: () => void = () => {}

export function getMainWindow(): BaseWindow | null {
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

function createRendererView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: resolvePreload(),
      nodeIntegration: false,
      sandbox: false,
      contextIsolation: true,
      transparent: true,
      backgroundThrottling: false
    }
  })
  view.setBackgroundColor('#00000000')
  view.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  view.webContents.on('before-input-event', (event, inputEvent) => {
    if (inputEvent.type !== 'keyDown' || (!inputEvent.control && !inputEvent.meta)) return
    if (handleBrowserShortcut(inputEvent.key.toLowerCase(), inputEvent.shift)) event.preventDefault()
  })
  return view
}

async function loadRenderer(view: WebContentsView, surface: 'content' | 'toolbar' | 'sidebar'): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('surface', surface)
    await view.webContents.loadURL(url.toString())
  } else {
    await view.webContents.loadFile(rendererFile, { query: { surface } })
  }
}

export function createWindow(): BaseWindow {
  const win = new BaseWindow({
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
    backgroundColor: isMac ? '#00000000' : '#101418'
  })
  mainWindow = win

  const contentView = createRendererView()
  const toolbarView = createRendererView()
  const sidebarView = createRendererView()
  // Site WebContentsViews are inserted at index 0, so every trusted local layer stays above the page.
  win.contentView.addChildView(contentView)
  win.contentView.addChildView(toolbarView)
  win.contentView.addChildView(sidebarView)
  attachBrowserShell(win, { content: contentView, toolbar: toolbarView, sidebar: sidebarView }, syncBrowserBoundsToWindow)
  attachBrowserView(win)

  const close = (): void => {
    if (mainWindow !== win) return
    mainWindow = null
    detachBrowserShell()
    onMainWindowClosed()
  }
  win.on('closed', close)

  void Promise.all([
    loadRenderer(contentView, 'content'),
    loadRenderer(toolbarView, 'toolbar'),
    loadRenderer(sidebarView, 'sidebar')
  ]).then(() => {
    if (!win.isDestroyed()) win.show()
  }).catch((error: unknown) => {
    console.error('Could not load Sockfish browser surfaces:', error)
    if (!win.isDestroyed()) win.show()
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
