import { attachSidebarBackdrop } from './sidebar-backdrop'
import { BaseWindow, WebContentsView, app, nativeImage, screen, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { attachBrowserView, handleBrowserShortcutInput, setBrowserWindowFactory, syncBrowserBoundsToWindow, type BrowserWindowInit } from './browser'
import { loadBrowserWindowsSession } from './browser-persistence'
import { browserWindows, currentBrowserWindow, registerBrowserWindow, runInWindow } from './window-scope'
import { attachBrowserShell, detachBrowserShell, isFocusAddressShortcut, sendFocusAddressToVisibleRenderer } from './browser-shell'
import { isExpectedRendererDocument } from './renderer-security'
import { APP_NAME, WINDOW } from '../shared/config'
import { retryOnce } from '../shared/retry'
import { fitBoundsToDisplays, parseSavedWindowState, type Rect, type SavedWindowState } from '../shared/window-geometry'
import { createFileTextCache } from '../shared/write-skip'
import { watchShellSurface } from './crash-guard'

const WINDOW_STATE_FILE = 'window-state.json'
const SAVE_DELAY_MS = 400

function windowStatePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE)
}

/** window-state.json as last read or written: re-saving the same geometry (e.g. the move/resize events of a restore, or quit) is skipped. */
const lastWindowStateText = createFileTextCache()

function readWindowState(): SavedWindowState | null {
  try {
    const path = windowStatePath()
    if (!existsSync(path)) return null
    const text = readFileSync(path, 'utf8')
    lastWindowStateText.remember(path, text)
    return parseSavedWindowState(JSON.parse(text))
  } catch (error) {
    console.warn('Could not read window state:', error)
    return null
  }
}

function writeWindowState(state: SavedWindowState): void {
  try {
    const path = windowStatePath()
    const text = JSON.stringify(state)
    if (lastWindowStateText.isUnchanged(path, text, existsSync)) return
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(`${path}.tmp`, text, 'utf8')
    renameSync(`${path}.tmp`, path)
    lastWindowStateText.remember(path, text)
  } catch (error) {
    lastWindowStateText.forget(windowStatePath())
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
const appIconPath = join(mainDirectory, '../../src/resources/icons/surffish-512.png')
let onMainWindowClosed: () => void = () => {}

/**
 * The window "the window" means: the one whose renderer sent the IPC being handled, else the
 * focused, else the last focused (see window-scope.ts). Null with none open.
 */
export function getMainWindow(): BaseWindow | null {
  return currentBrowserWindow()
}

/** Runs when the last browser window has closed. */
export function setMainWindowCloseHandler(handler: () => void): void {
  onMainWindowClosed = handler
}

function resolvePreload(): string {
  const base = join(mainDirectory, '../preload/index')
  if (existsSync(`${base}.cjs`)) return `${base}.cjs`
  if (existsSync(`${base}.js`)) return `${base}.js`
  return `${base}.mjs`
}

function createRendererView(expectedDocumentUrl: string, owner: () => BaseWindow | null): WebContentsView {
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
    // Shortcuts typed in this window's surfaces act on this window.
    runInWindow(owner(), () => {
      if (isFocusAddressShortcut(inputEvent)) {
        event.preventDefault()
        sendFocusAddressToVisibleRenderer()
        return
      }
      if (handleBrowserShortcutInput(inputEvent)) event.preventDefault()
    })
  })
  return view
}

function expectedRendererDocumentUrl(surface: 'content' | 'toolbar' | 'sidebar'): string {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('surface', surface)
    return url.toString()
  }
  const url = pathToFileURL(rendererFile)
  url.searchParams.set('surface', surface)
  return url.toString()
}

/**
 * A surface load can fail under heavy CPU contention (ERR_FAILED while the renderer starts);
 * try once more before leaving the window without that surface.
 */
async function loadRenderer(view: WebContentsView, documentUrl: string, isLive: () => boolean): Promise<void> {
  await retryOnce(() => view.webContents.loadURL(documentUrl), {
    delayMs: 250,
    shouldRetry: () => isLive() && !view.webContents.isDestroyed(),
    onRetry: (error) => console.warn('A Surffish browser surface failed to load; retrying once:', error)
  })
}

export interface CreateWindowOptions extends BrowserWindowInit {
  /** Saved size/position; falls back to window-state.json (the last window moved or resized). */
  geometry?: SavedWindowState | null
  /** Top-left on screen (tearing a tab out under the pointer). */
  position?: { x: number; y: number }
  size?: { width: number; height: number }
}

function initialBounds(options: CreateWindowOptions, fallback: SavedWindowState | null): Partial<Rect> {
  if (options.position) {
    const size = options.size ?? { width: fallback?.bounds.width ?? WINDOW.width, height: fallback?.bounds.height ?? WINDOW.height }
    const fitted = fitBoundsToDisplays({ ...options.position, ...size }, screen.getAllDisplays().map((display) => display.workArea), {
      width: WINDOW.minWidth,
      height: WINDOW.minHeight
    })
    return fitted ?? size
  }
  const saved = options.geometry ?? fallback
  // A second window over the first one would hide it; cascade new windows a little.
  const bounds = restoredBounds(saved)
  if (!options.geometry && browserWindows().length > 0 && bounds.x !== undefined && bounds.y !== undefined) {
    const offset = 28 * browserWindows().length
    return { ...bounds, x: bounds.x + offset, y: bounds.y + offset }
  }
  return bounds
}

export function createWindow(options: CreateWindowOptions = {}): BaseWindow {
  // Registered here, not at import time: browser.ts and this module import each other.
  setBrowserWindowFactory((init) => createWindow(init))
  const savedState = readWindowState()
  const geometry = options.position ? null : options.geometry ?? (browserWindows().length === 0 ? savedState : null)
  const win = new BaseWindow({
    title: APP_NAME,
    icon: appIconPath,
    ...initialBounds(options, savedState),
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
  registerBrowserWindow(win)
  if (geometry?.maximized) win.maximize()
  trackWindowState(win, geometry ?? null)

  const rendererDocuments = {
    content: expectedRendererDocumentUrl('content'),
    toolbar: expectedRendererDocumentUrl('toolbar'),
    sidebar: expectedRendererDocumentUrl('sidebar')
  }
  const owner = (): BaseWindow | null => (win.isDestroyed() ? null : win)
  const contentView = createRendererView(rendererDocuments.content, owner)
  const toolbarView = createRendererView(rendererDocuments.toolbar, owner)
  const sidebarView = createRendererView(rendererDocuments.sidebar, owner)
  // Site WebContentsViews are inserted at index 0, so every trusted local layer stays above the page.
  win.contentView.addChildView(contentView)
  win.contentView.addChildView(toolbarView)
  win.contentView.addChildView(sidebarView)
  attachBrowserShell(win, { content: contentView, toolbar: toolbarView, sidebar: sidebarView }, rendererDocuments, syncBrowserBoundsToWindow)
  attachBrowserView(win, { private: options.private, session: options.session, adoptTabId: options.adoptTabId })
  attachSidebarBackdrop(win)

  // A crashed or hung toolbar/sidebar/content renderer reloads instead of leaving a dead window.
  for (const [view, documentUrl] of [[contentView, rendererDocuments.content], [toolbarView, rendererDocuments.toolbar], [sidebarView, rendererDocuments.sidebar]] as const) {
    watchShellSurface(view.webContents, () => loadRenderer(view, documentUrl, () => !win.isDestroyed()), () => !win.isDestroyed())
  }

  win.on('closed', () => {
    detachBrowserShell(win)
    // A closed BaseWindow doesn't destroy its views' web contents: without this every closed
    // window left its toolbar, sidebar and content renderers running (~100 MB) and still
    // calling into main ("available only to the app window" errors).
    for (const view of [contentView, toolbarView, sidebarView]) {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    if (browserWindows().length === 0) onMainWindowClosed()
  })

  void Promise.all([
    loadRenderer(contentView, rendererDocuments.content, () => !win.isDestroyed()),
    loadRenderer(toolbarView, rendererDocuments.toolbar, () => !win.isDestroyed()),
    loadRenderer(sidebarView, rendererDocuments.sidebar, () => !win.isDestroyed())
  ]).then(() => {
    showRestored(win, geometry ?? null)
  }).catch((error: unknown) => {
    // A window closed while its surfaces were still loading aborts them (ERR_FAILED); that's expected.
    if (win.isDestroyed()) return
    console.error('Could not load Surffish browser surfaces:', error)
    showRestored(win, geometry ?? null)
  })

  return win
}

/** Cmd+N / Cmd+Shift+N: a new (private) window with one New Tab. */
export function createBrowserWindow(isPrivate = false): BaseWindow {
  return createWindow({ private: isPrivate })
}

/** Start-up and dock reopen: every window from the saved session (an older single-window file becomes one window). */
export function restoreWindows(): BaseWindow[] {
  const session = loadBrowserWindowsSession(readWindowState())
  const order = session.windows.map((_window, index) => index).filter((index) => index !== session.focusedIndex)
  order.push(session.focusedIndex)
  const created: BaseWindow[] = []
  // The focused one is created last, so it is the last focused window and shows on top.
  for (const index of order) {
    const saved = session.windows[index]
    if (!saved) continue
    created.push(createWindow({ session: saved, geometry: saved.geometry }))
  }
  if (created.length === 0) created.push(createWindow())
  return created
}


function showRestored(win: BaseWindow, saved: SavedWindowState | null): void {
  if (win.isDestroyed()) return
  win.show()
  if (saved?.fullScreen) win.setFullScreen(true)
}

export function showWindow(): void {
  if (isMac) app.show()
  const win = getMainWindow()
  if (!win) {
    restoreWindows()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
