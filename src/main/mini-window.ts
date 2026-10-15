import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseWindow, WebContentsView, ipcMain, screen, type IpcMainEvent, type WebContents } from 'electron'
import {
  MINI_WINDOW_GEOMETRY_FILE,
  MINI_WINDOW_HEADER_HEIGHT,
  MINI_WINDOW_MIN_SIZE,
  MINI_WINDOW_REVEAL_ZONE,
  initialMiniBounds,
  miniDisplayKey,
  miniHeaderUrl,
  parseMiniGeometry,
  snapMiniToCorner,
  type MiniRect,
  type MiniWindowHeaderState,
  type MiniWindowSettings
} from '../shared/mini-window'
import { watchShellSurface } from './crash-guard'
import { getMiniWindowHost, getMiniWindowSettings, type MiniWindowHost } from './mini-window-entry'
import { MINI_WINDOW_PAGE_HTML } from './mini-window-page'
import { isTabCrashed, recoverCrashedTabOnActivate } from './tab-health'
import { readUserJson, writeUserJson } from './user-json'

/**
 * The mini window: a small frameless window that floats above other apps and holds one tab's live
 * page. Lazy chunk (mini-window-entry.ts imports it on first use). The tab itself stays in
 * browser.ts's registry (a BrowserWindowState flagged `mini`), so its page never reloads on the way
 * in or out and keeps every tab behaviour. This module owns the window: placement (per display,
 * corner snap), the auto-hiding header strip, always-on-top / all-Spaces, opacity, show/hide.
 *
 * macOS: an NSPanel (type 'panel') at the floating level, on every Space and over full-screen apps,
 * shown without taking focus when a tab pops out. Elsewhere: an always-on-top frameless window.
 */

interface Mini {
  window: BaseWindow
  header: WebContentsView
  /** Header strip shown (the pointer is near the top of the window, or on the header). */
  revealed: boolean
  /** Pointer is on the header view itself. */
  hovered: boolean
  hideTimer: ReturnType<typeof setTimeout> | null
  /** While revealed: polls the cursor so leaving the window (no page event) hides the header. */
  pollTimer: ReturnType<typeof setInterval> | null
  geometryTimer: ReturnType<typeof setTimeout> | null
  /** The page contents this module listens to (re-wired when the tab's view changes). */
  page: WebContents | null
  pageListeners: Array<[string, (...args: never[]) => void]>
  /** Header loaded (it is attached only then, so it never takes keyboard focus from the page). */
  headerReady: Promise<void>
  closed: boolean
}

const IS_MAC = process.platform === 'darwin'
const HEADER_READY_TIMEOUT_MS = 3000
const HIDE_DELAY_MS = 700
const POLL_MS = 300
const GEOMETRY_SAVE_DELAY_MS = 400

let mini: Mini | null = null
let ipcRegistered = false

function host(): MiniWindowHost {
  const current = getMiniWindowHost()
  if (!current) throw new Error('Mini window host is not registered')
  return current
}

function live(contents: WebContents | null | undefined): contents is WebContents {
  return Boolean(contents && !contents.isDestroyed())
}

function preloadPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../preload/mini-window.cjs')
  return existsSync(path) ? path : null
}

function fromHeader(event: IpcMainEvent): Mini | null {
  return mini && !mini.closed && mini.header.webContents === event.sender ? mini : null
}

// ---------------------------------------------------------------------------
// Geometry: one remembered rect per display (keyed by its work area).

function readGeometry(): Record<string, MiniRect> {
  return parseMiniGeometry(readUserJson(MINI_WINDOW_GEOMETRY_FILE))
}

function saveGeometry(m: Mini): void {
  if (m.closed || m.window.isDestroyed() || m.window.isMinimized()) return
  const bounds = m.window.getBounds()
  const key = miniDisplayKey(screen.getDisplayMatching(bounds).workArea)
  const all = readGeometry()
  all[key] = bounds
  writeUserJson(MINI_WINDOW_GEOMETRY_FILE, all)
}

function scheduleGeometrySave(m: Mini): void {
  if (m.geometryTimer) clearTimeout(m.geometryTimer)
  m.geometryTimer = setTimeout(() => {
    m.geometryTimer = null
    saveGeometry(m)
  }, GEOMETRY_SAVE_DELAY_MS)
}

/** Dropped near a corner of its display: settle into it. */
function snapToCorner(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  const bounds = m.window.getBounds()
  const snapped = snapMiniToCorner(bounds, screen.getDisplayMatching(bounds).workArea)
  if (snapped) m.window.setBounds(snapped)
}

/** Opens on the display under the pointer, where it was last on that display (else its bottom-right corner). */
function openingBounds(): MiniRect {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return initialMiniBounds(display.workArea, readGeometry()[miniDisplayKey(display.workArea)])
}

// ---------------------------------------------------------------------------
// Layout and the auto-hiding header.

function layout(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  const [width = 0, height = 0] = m.window.getContentSize()
  // The page fills the window; the header overlays its top while revealed.
  host().setPageBounds(m.window, { x: 0, y: 0, width, height })
  m.header.setBounds({ x: 0, y: 0, width, height: m.revealed ? MINI_WINDOW_HEADER_HEIGHT : 0 })
  rewirePage(m)
}

function stopPolling(m: Mini): void {
  if (m.pollTimer) clearInterval(m.pollTimer)
  m.pollTimer = null
}

function cancelHide(m: Mini): void {
  if (m.hideTimer) clearTimeout(m.hideTimer)
  m.hideTimer = null
}

function setRevealed(m: Mini, revealed: boolean): void {
  if (m.closed || m.revealed === revealed) return
  m.revealed = revealed
  cancelHide(m)
  if (revealed) {
    refreshHeaderOf(m)
    m.pollTimer ??= setInterval(() => pollPointer(m), POLL_MS)
  } else {
    stopPolling(m)
    m.hovered = false
  }
  layout(m)
}

function scheduleHide(m: Mini): void {
  if (!m.revealed || m.hovered || m.hideTimer) return
  m.hideTimer = setTimeout(() => {
    m.hideTimer = null
    if (!m.hovered) setRevealed(m, false)
  }, HIDE_DELAY_MS)
}

/** Pointer position relative to the window's content: inside the reveal zone keeps the header up. */
function pollPointer(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return stopPolling(m)
  const point = screen.getCursorScreenPoint()
  const bounds = m.window.getContentBounds()
  const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height
  if (inside && point.y - bounds.y <= MINI_WINDOW_REVEAL_ZONE) cancelHide(m)
  else scheduleHide(m)
}

function onPage<T extends unknown[]>(m: Mini, contents: WebContents, event: string, listener: (...args: T) => void): void {
  ;(contents.on as (name: string, fn: (...args: T) => void) => WebContents)(event, listener)
  m.pageListeners.push([event, listener as unknown as (...args: never[]) => void])
}

function unwirePage(m: Mini): void {
  const contents = m.page
  if (live(contents)) for (const [event, listener] of m.pageListeners) contents.removeListener(event as 'destroyed', listener as () => void)
  m.pageListeners = []
  m.page = null
}

/** Listen to the tab's page: the pointer near the top reveals the header; a crash reloads it. */
function rewirePage(m: Mini): void {
  const contents = host().pageContents(m.window)
  if (contents === m.page) return
  unwirePage(m)
  if (!contents) return
  m.page = contents
  onPage(m, contents, 'before-mouse-event', (_event: Electron.Event, input: Electron.MouseInputEvent) => {
    if (input.type === 'mouseMove' || input.type === 'mouseEnter') {
      if (input.y <= MINI_WINDOW_REVEAL_ZONE) setRevealed(m, true)
      else scheduleHide(m)
    } else if (input.type === 'mouseLeave') {
      scheduleHide(m)
    }
  })
  // There is no crash screen here (the browser window's content surface draws it): reload the page
  // once, under tab-health's auto-reload budget, and show "Page crashed" in the header otherwise.
  onPage(m, contents, 'render-process-gone', (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
    if (details.reason === 'clean-exit') return
    refreshHeaderOf(m)
    setTimeout(() => {
      if (live(contents) && m.page === contents) recoverCrashedTabOnActivate(contents)
      refreshHeaderOf(m)
    }, 400)
  })
}

function headerState(m: Mini): MiniWindowHeaderState & { crashed: boolean } | null {
  const info = host().header(m.window)
  if (!info) return null
  return {
    title: info.title,
    url: miniHeaderUrl(info.url),
    faviconUrl: info.faviconUrl,
    loading: info.loading,
    canGoBack: info.canGoBack,
    private: info.private,
    crashed: isTabCrashed(m.page)
  }
}

function refreshHeaderOf(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  rewirePage(m)
  const state = headerState(m)
  if (!state) return
  m.window.setTitle(state.title ? `${state.title} — Mini Window` : 'Mini Window')
  if (live(m.header.webContents)) m.header.webContents.send('mini-window:state', state)
}

// ---------------------------------------------------------------------------
// The window.

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('mini-window:back', (event) => {
    const m = fromHeader(event)
    const page = m ? host().pageContents(m.window) : null
    if (page?.navigationHistory.canGoBack()) page.navigationHistory.goBack()
  })
  ipcMain.on('mini-window:reload', (event) => {
    const m = fromHeader(event)
    const page = m ? host().pageContents(m.window) : null
    if (page) page.reload()
  })
  ipcMain.on('mini-window:return', (event) => {
    if (fromHeader(event)) returnToBrowser()
  })
  ipcMain.on('mini-window:close', (event) => {
    const m = fromHeader(event)
    if (m) host().closeTab(m.window)
  })
  ipcMain.on('mini-window:hover', (event, inside: unknown) => {
    const m = fromHeader(event)
    if (!m) return
    m.hovered = inside === true
    if (m.hovered) cancelHide(m)
    else scheduleHide(m)
  })
}

function createHeaderView(): { view: WebContentsView; ready: Promise<void> } | null {
  const preload = preloadPath()
  if (!preload) {
    console.warn('[mini window] preload missing; mini window unavailable')
    return null
  }
  const view = new WebContentsView({
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, transparent: true, backgroundThrottling: false, disableWakeLocks: true }
  })
  view.setBackgroundColor('#00000000')
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event) => event.preventDefault())
  const ready = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, HEADER_READY_TIMEOUT_MS)
    view.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
    view.webContents.once('destroyed', () => { clearTimeout(timer); resolve() })
  })
  return { view, ready }
}

function headerDocumentUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(MINI_WINDOW_PAGE_HTML)}`
}

function applyWindowSettings(m: Mini, settings: MiniWindowSettings): void {
  if (m.closed || m.window.isDestroyed()) return
  // Linux has no window opacity; macOS and Windows do.
  if (process.platform !== 'linux') m.window.setOpacity(settings.opacity)
}

function createMini(): Mini | null {
  registerIpc()
  const header = createHeaderView()
  if (!header) return null
  const bounds = openingBounds()
  const window = new BaseWindow({
    ...bounds,
    title: 'Mini Window',
    // An NSPanel floats over other apps' windows and full-screen Spaces without activating Surffish.
    ...(IS_MAC ? { type: 'panel' } : {}),
    frame: false,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: true,
    minWidth: MINI_WINDOW_MIN_SIZE.width,
    minHeight: MINI_WINDOW_MIN_SIZE.height,
    backgroundColor: '#ffffff'
  })
  // Above normal windows ('floating' is NSFloatingWindowLevel), and on every Space and over full-screen
  // apps. The panel type does that without turning Surffish into an accessory app (no Dock flicker).
  if (IS_MAC) {
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  } else {
    window.setAlwaysOnTop(true)
  }
  const m: Mini = {
    window,
    header: header.view,
    revealed: false,
    hovered: false,
    hideTimer: null,
    pollTimer: null,
    geometryTimer: null,
    page: null,
    pageListeners: [],
    headerReady: header.ready,
    closed: false
  }
  mini = m
  host().attachWindow(window)
  applyWindowSettings(m, getMiniWindowSettings())
  const documentUrl = headerDocumentUrl()
  void header.view.webContents.loadURL(documentUrl).catch(() => undefined)
  // A crashed or hung header reloads like the browser's own surfaces (crash-guard.ts).
  watchShellSurface(header.view.webContents, () => header.view.webContents.loadURL(documentUrl).then(() => refreshHeaderOf(m)), () => !m.closed && !window.isDestroyed())
  // Keys pressed while the header has focus still run browser shortcuts for the mini tab.
  header.view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && host().handleShortcut(window, input)) event.preventDefault()
  })
  void header.ready.then(() => {
    if (m.closed || window.isDestroyed()) return
    window.contentView.addChildView(header.view)
    layout(m)
    refreshHeaderOf(m)
  })
  window.on('resize', () => {
    layout(m)
    scheduleGeometrySave(m)
  })
  // macOS/Windows say when a drag ends ('moved'); Linux only streams 'move', so snap after it settles.
  if (process.platform === 'linux') {
    let settle: ReturnType<typeof setTimeout> | null = null
    window.on('move', () => {
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => { settle = null; snapToCorner(m) }, 350)
      scheduleGeometrySave(m)
    })
  } else {
    window.on('move', () => scheduleGeometrySave(m))
    window.on('moved', () => snapToCorner(m))
  }
  window.on('closed', () => {
    m.closed = true
    cancelHide(m)
    stopPolling(m)
    if (m.geometryTimer) {
      clearTimeout(m.geometryTimer)
      m.geometryTimer = null
    }
    unwirePage(m)
    // A closed BaseWindow doesn't destroy its views' webContents.
    if (live(header.view.webContents)) header.view.webContents.close()
    if (mini === m) mini = null
  })
  return m
}

/** Bring the window up. `focus`: take the keyboard (shortcut/toggle); otherwise stay out of the way (pop out). */
function present(m: Mini, focus: boolean): void {
  if (m.closed || m.window.isDestroyed()) return
  if (focus) {
    m.window.show()
    m.window.focus()
    const page = host().pageContents(m.window)
    if (page) page.focus()
  } else if (!m.window.isVisible()) {
    m.window.showInactive()
  }
  // Re-assert the level: some window managers drop it while a window is hidden.
  if (IS_MAC) m.window.setAlwaysOnTop(true, 'floating')
  else m.window.setAlwaysOnTop(true)
}

/** Pop a tab out. One mini window at a time: a tab already in it goes back to the browser first. */
export async function popOutTab(tabId: string): Promise<boolean> {
  if (mini && !mini.closed && host().header(mini.window)?.tabId === tabId) {
    present(mini, false)
    return true
  }
  // The old window closes on its own once its tab has moved out (detachTabFromWindow); a new one opens.
  if (mini && !mini.closed) returnToBrowser()
  const m = createMini()
  if (!m) return false
  if (!host().adoptTab(tabId, m.window)) {
    if (!host().header(m.window) && !m.window.isDestroyed()) m.window.close()
    return false
  }
  layout(m)
  await m.headerReady
  if (m.closed) return false
  refreshHeaderOf(m)
  present(m, false)
  return true
}

/** The toggle shortcut with nothing in the mini window: open the pinned page in it. */
export async function openPinnedPage(url: string): Promise<boolean> {
  if (mini && !mini.closed && host().header(mini.window)) return toggleVisible()
  const m = createMini()
  if (!m) return false
  if (!host().openUrl(url, m.window)) {
    if (!m.window.isDestroyed()) m.window.close()
    return false
  }
  layout(m)
  await m.headerReady
  if (m.closed) return false
  refreshHeaderOf(m)
  present(m, true)
  return true
}

/** Show the mini window (focused) when hidden or behind; hide it when it is showing. */
export function toggleVisible(): boolean {
  const m = mini
  if (!m || m.closed || m.window.isDestroyed()) return false
  if (m.window.isVisible() && !m.window.isMinimized()) {
    setRevealed(m, false)
    m.window.hide()
  } else {
    present(m, true)
  }
  return true
}

export function returnToBrowser(): boolean {
  const m = mini
  if (!m || m.closed || m.window.isDestroyed()) return false
  unwirePage(m)
  const moved = host().returnTab(m.window)
  if (!moved) rewirePage(m)
  return moved
}

export function isOpen(): boolean {
  return Boolean(mini && !mini.closed && !mini.window.isDestroyed() && host().header(mini.window))
}

export function refreshHeader(window: BaseWindow): void {
  if (mini && mini.window === window) refreshHeaderOf(mini)
}

export function applySettings(settings: MiniWindowSettings): void {
  if (mini) applyWindowSettings(mini, settings)
}
