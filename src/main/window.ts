import { BaseWindow, WebContentsView, app, nativeImage, screen, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { attachBrowserView, handleBrowserShortcutInput, syncBrowserBoundsToWindow } from './browser'
import { attachBrowserShell, detachBrowserShell } from './browser-shell'
import { isExpectedRendererDocument } from './renderer-security'
import { APP_NAME, WINDOW } from '../shared/config'
import { fitBoundsToDisplays, parseSavedWindowState, type Rect, type SavedWindowState } from '../shared/window-geometry'

const WINDOW_STATE_FILE = 'window-state.json'
const SAVE_DELAY_MS = 400

function windowStatePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE)
}

function readWindowState(): SavedWindowState | null {
  try {
    const path = windowStatePath()
    if (!existsSync(path)) return null
    return parseSavedWindowState(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    console.warn('Could not read window state:', error)
    return null
  }
}

function writeWindowState(state: SavedWindowState): void {
  try {
    const path = windowStatePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(`${path}.tmp`, JSON.stringify(state), 'utf8')
    renameSync(`${path}.tmp`, path)
  } catch (error) {
    console.warn('Could not save window state:', error)
  }
}

function restoredBounds(saved: SavedWindowState | null): Partial<Rect> {
  if (!saved) return { width: WINDOW.width, height: WINDOW.height }
  const fitted = fitBoundsToDisplays(saved.bounds, screen.getAllDisplays().map((display) => display.workArea), {
    width: WINDOW.minWidth,
    height: WINDOW.minHeight
  })
  return fitted ?? { width: saved.bounds.width, height: saved.bounds.height }
}

/** Remember size, position, maximized and full screen across launches. */
function trackWindowState(win: BaseWindow, initial: SavedWindowState | null): void {
  // getNormalBounds keeps the pre-maximize size, so un-maximizing after a relaunch still lands somewhere sensible.
  let last: SavedWindowState | null = initial
  let timer: NodeJS.Timeout | null = null
  const capture = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    last = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
  }
  const schedule = (): void => {
    capture()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (last) writeWindowState(last)
    }, SAVE_DELAY_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  win.on('close', () => {
    capture()
    if (timer) clearTimeout(timer)
    timer = null
    if (last) writeWindowState(last)
  })
}

const isMac = process.platform === 'darwin'
const mainDirectory = dirname(fileURLToPath(import.meta.url))
const rendererFile = join(mainDirectory, '../renderer/index.html')
const appIconPath = join(mainDirectory, '../../resources/icons/surffish-512.png')
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
  if (existsSync(`${base}.cjs`)) return `${base}.cjs`
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}

function createRendererView(expectedDocumentUrl: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: resolvePreload(),
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
      transparent: true,
      backgroundThrottling: false
    }
  })
  view.setBackgroundColor('#00000000')
  const blockUntrustedNavigation = (event: Electron.Event, targetUrl: string): void => {
    if (!isExpectedRendererDocument(targetUrl, expectedDocumentUrl)) event.preventDefault()
  }
  view.webContents.on('will-navigate', blockUntrustedNavigation)
  view.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) blockUntrustedNavigation(details, details.url)
  })
  view.webContents.on('will-redirect', blockUntrustedNavigation)
  view.webContents.setWindowOpenHandler((details) => {
    try {
      const target = new URL(details.url)
      if (target.protocol === 'https:' && !target.username && !target.password) {
        void shell.openExternal(target.toString()).catch((error: unknown) => console.warn('Could not open external link:', error))
      }
    } catch {
      // Invalid window-open targets are denied.
    }
    return { action: 'deny' }
  })
  view.webContents.on('before-input-event', (event, inputEvent) => {
    if (handleBrowserShortcutInput(inputEvent)) event.preventDefault()
  })
  return view
}

function expectedRendererDocumentUrl(surface: 'content' | 'toolbar' | 'sidebar'): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('surface', surface)
    return url.toString()
  }
  const url = pathToFileURL(rendererFile)
  url.searchParams.set('surface', surface)
  return url.toString()
}

async function loadRenderer(view: WebContentsView, documentUrl: string): Promise<void> {
  await view.webContents.loadURL(documentUrl)
}

export function createWindow(): BaseWindow {
  const savedState = readWindowState()
  const win = new BaseWindow({
    title: APP_NAME,
    icon: appIconPath,
    ...restoredBounds(savedState),
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
  if (isMac) app.dock?.setIcon(nativeImage.createFromPath(appIconPath))
  mainWindow = win
  if (savedState?.maximized) win.maximize()
  trackWindowState(win, savedState)

  const rendererDocuments = {
    content: expectedRendererDocumentUrl('content'),
    toolbar: expectedRendererDocumentUrl('toolbar'),
    sidebar: expectedRendererDocumentUrl('sidebar')
  }
  const contentView = createRendererView(rendererDocuments.content)
  const toolbarView = createRendererView(rendererDocuments.toolbar)
  const sidebarView = createRendererView(rendererDocuments.sidebar)
  // Site WebContentsViews are inserted at index 0, so every trusted local layer stays above the page.
  win.contentView.addChildView(contentView)
  win.contentView.addChildView(toolbarView)
  win.contentView.addChildView(sidebarView)
  attachBrowserShell(win, { content: contentView, toolbar: toolbarView, sidebar: sidebarView }, rendererDocuments, syncBrowserBoundsToWindow)
  attachBrowserView(win)

  const close = (): void => {
    if (mainWindow !== win) return
    mainWindow = null
    detachBrowserShell()
    onMainWindowClosed()
  }
  win.on('closed', close)

  void Promise.all([
    loadRenderer(contentView, rendererDocuments.content),
    loadRenderer(toolbarView, rendererDocuments.toolbar),
    loadRenderer(sidebarView, rendererDocuments.sidebar)
  ]).then(() => {
    showRestored(win, savedState)
  }).catch((error: unknown) => {
    console.error('Could not load Surffish browser surfaces:', error)
    showRestored(win, savedState)
  })

  return win
}

function showRestored(win: BaseWindow, saved: SavedWindowState | null): void {
  if (win.isDestroyed()) return
  win.show()
  if (saved?.fullScreen) win.setFullScreen(true)
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
