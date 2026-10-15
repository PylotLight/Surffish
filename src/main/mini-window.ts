import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseWindow, WebContentsView, ipcMain, screen, type IpcMainEvent, type WebContents } from 'electron'
import {
  MINI_WINDOW_GEOMETRY_FILE,
  MINI_WINDOW_HEADER_HEIGHT,
  MINI_WINDOW_MAX,
  MINI_WINDOW_MIN_SIZE,
  MINI_WINDOW_REVEAL_ZONE,
  cascadeMiniBounds,
  freeMiniSlot,
  initialMiniBounds,
  miniDisplayKey,
  miniHeaderUrl,
  parseMiniGeometry,
  parseMiniSlots,
  snapMiniToCorner,
  withMiniSlot,
  type MiniRect,
  type MiniWindowHeaderState,
  type MiniWindowSettings
} from '../shared/mini-window'
import { dockArrow, dockedBounds } from '../shared/mini-window-dock'
import { watchShellSurface } from './crash-guard'
import { createDockController, savedDockFor, type DockController } from './mini-window-dock'
import { getMiniWindowHost, getMiniWindowSettings, type MiniWindowHost } from './mini-window-entry'
import { MINI_WINDOW_PAGE_HTML } from './mini-window-page'
import { isTabCrashed, recoverCrashedTabOnActivate } from './tab-health'
import { readUserJson, writeUserJson } from './user-json'
import { notifyBrowserWindowsChanged } from './window-scope'

/**
 * Mini windows: small frameless windows that float above other apps, each holding one tab's live
 * page (up to MINI_WINDOW_MAX at once; each new one cascades off the last). Lazy chunk (mini-window-entry.ts imports it on first use). The tab itself stays in
 * browser.ts's registry (a BrowserWindowState flagged `mini`), so its page never reloads on the way
 * in or out and keeps every tab behaviour. This module owns the window: placement (per display,
 * corner snap), the auto-hiding header strip, always-on-top / all-Spaces, opacity, show/hide.
 *
 * macOS: an NSPanel (type 'panel') at the floating level, on every Space and over full-screen apps,
 * shown without taking focus when a tab pops out. Elsewhere: an always-on-top frameless window.
 * Tuck to screen edge (slide away behind a handle tab) lives in mini-window-dock.ts.
 */

interface Mini {
  window: BaseWindow
  /** Which remembered spot/dock it uses (the lowest free when it opened). */
  slot: number
  /** Last title the Window menu was told about. */
  menuTitle: string
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
  /** Docked to a screen edge / tucked away behind its handle. */
  dock: DockController
  closed: boolean
}

const IS_MAC = process.platform === 'darwin'
const HEADER_READY_TIMEOUT_MS = 3000
const HIDE_DELAY_MS = 700
const POLL_MS = 300
const GEOMETRY_SAVE_DELAY_MS = 400

/** Open mini windows, oldest first. */
const minis: Mini[] = []
/** The one most recently opened or focused (what the palette's Tuck command acts on). */
let lastActive: Mini | null = null
let ipcRegistered = false

function liveMinis(): Mini[] {
  return minis.filter((m) => !m.closed && !m.window.isDestroyed())
}

/** The mini window `window` is, if any. */
function miniOf(window: BaseWindow): Mini | null {
  return liveMinis().find((m) => m.window === window) ?? null
}

/** The mini window holding tab `tabId`, if any. */
function miniWithTab(tabId: string): Mini | null {
  return liveMinis().find((m) => host().header(m.window)?.tabId === tabId) ?? null
}

/** The palette's single-window commands act on the last one used. */
function currentMini(): Mini | null {
  const open = liveMinis().filter((m) => host().header(m.window))
  return lastActive && open.includes(lastActive) ? lastActive : open.at(-1) ?? null
}

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
  return liveMinis().find((m) => m.header.webContents === event.sender) ?? null
}

// ---------------------------------------------------------------------------
// Geometry: one remembered rect per slot per display (keyed by its work area).

function readGeometry(): Array<Record<string, MiniRect>> {
  return parseMiniSlots(readUserJson(MINI_WINDOW_GEOMETRY_FILE), parseMiniGeometry)
}

function saveGeometry(m: Mini): void {
  // Tucked (off screen) or mid-slide: not a place to come back to.
  if (m.closed || m.window.isDestroyed() || m.window.isMinimized() || m.dock.isTucked()) return
  const bounds = m.window.getBounds()
  const key = miniDisplayKey(screen.getDisplayMatching(bounds).workArea)
  const all = readGeometry()
  writeUserJson(MINI_WINDOW_GEOMETRY_FILE, withMiniSlot(all, m.slot, { ...all[m.slot], [key]: bounds }))
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

/**
 * Opens on the display under the pointer, where this slot's window was last on that display (else
 * off the newest open mini window there, else the bottom-right corner), stepped clear of any open one.
 */
function openingBounds(slot: number): MiniRect {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const others = liveMinis().map((m) => m.window.getBounds())
  const newestHere = liveMinis().filter((m) => !m.dock.isTucked() && screen.getDisplayMatching(m.window.getBounds()).id === display.id).at(-1)
  const saved = readGeometry()[slot]?.[miniDisplayKey(wa)] ?? newestHere?.window.getBounds()
  return cascadeMiniBounds(initialMiniBounds(wa, saved), others, wa)
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

function headerState(m: Mini): MiniWindowHeaderState & { crashed: boolean; tuck: { arrow: string; label: string } | null } | null {
  const info = host().header(m.window)
  if (!info) return null
  const tuckEdge = m.dock.tuckEdge()
  return {
    tuck: tuckEdge ? { arrow: dockArrow(tuckEdge, false), label: `Tuck to the ${tuckEdge} edge` } : null,
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
  // The Window menu lists mini windows by title.
  if (state.title !== m.menuTitle) {
    m.menuTitle = state.title
    notifyBrowserWindowsChanged()
  }
  if (live(m.header.webContents)) m.header.webContents.send('mini-window:state', state)
  m.dock.refreshHandle()
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
    const m = fromHeader(event)
    if (m) returnMini(m)
  })
  ipcMain.on('mini-window:close', (event) => {
    const m = fromHeader(event)
    if (m) host().closeTab(m.window)
  })
  ipcMain.on('mini-window:tuck', (event) => {
    const m = fromHeader(event)
    if (!m) return
    setRevealed(m, false)
    m.dock.toggle(true)
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
  m.dock.applySettings()
}

/** Too many open: say so in the browser window instead of opening another. */
function atCap(): boolean {
  if (liveMinis().length < MINI_WINDOW_MAX) return false
  host().notify(`Up to ${MINI_WINDOW_MAX} mini windows at a time. Return one to the browser first.`)
  return true
}

function createMini(): Mini | null {
  registerIpc()
  const slot = freeMiniSlot(liveMinis().map((m) => m.slot))
  if (slot === null) return null
  const header = createHeaderView()
  const preload = preloadPath()
  if (!header || !preload) return null
  const opening = openingBounds(slot)
  // Docked on this display last time: open against that edge again (out, with its handle).
  const display = screen.getDisplayMatching(opening)
  const savedDock = getMiniWindowSettings().tuckToEdge ? savedDockFor(slot, display, opening) : null
  const bounds = savedDock ? dockedBounds(opening, savedDock, display.workArea, false) : opening
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
  // Callbacks run later (m exists by then).
  const dock = createDockController({
    window,
    slot,
    preload,
    faviconUrl: () => host().header(window)?.faviconUrl ?? null,
    focusPage: () => {
      if (m.closed || window.isDestroyed()) return
      window.focus()
      host().pageContents(window)?.focus()
    },
    changed: () => refreshHeaderOf(m),
    isTuckEnabled: () => getMiniWindowSettings().tuckToEdge,
    isPeekEnabled: () => getMiniWindowSettings().peekOnHover
  }, savedDock ? { dock: savedDock, display } : null)
  const m: Mini = {
    window,
    slot,
    menuTitle: '',
    header: header.view,
    revealed: false,
    hovered: false,
    hideTimer: null,
    pollTimer: null,
    geometryTimer: null,
    page: null,
    pageListeners: [],
    headerReady: header.ready,
    dock,
    closed: false
  }
  minis.push(m)
  lastActive = m
  window.on('focus', () => {
    lastActive = m
    // The Window menu checks the focused one.
    notifyBrowserWindowsChanged()
  })
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
    if (m.dock.ignoringMoves()) return
    m.dock.follow()
    scheduleGeometrySave(m)
  })
  // Dropped: against a screen edge it docks and tucks away, near a corner it snaps into it.
  const dropped = (): void => {
    if (m.closed || window.isDestroyed() || m.dock.ignoringMoves()) return
    if (!m.dock.afterDrop()) snapToCorner(m)
    scheduleGeometrySave(m)
  }
  // macOS/Windows say when a drag ends ('moved'); Linux only streams 'move', so act after it settles.
  // Moves the dock makes itself (sliding, placing) are not drops.
  if (process.platform === 'linux') {
    let settle: ReturnType<typeof setTimeout> | null = null
    window.on('move', () => {
      if (m.dock.ignoringMoves()) return
      m.dock.follow()
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => { settle = null; dropped() }, 350)
      scheduleGeometrySave(m)
    })
  } else {
    window.on('move', () => {
      if (m.dock.ignoringMoves()) return
      m.dock.follow()
      scheduleGeometrySave(m)
    })
    window.on('moved', dropped)
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
    m.dock.dispose()
    // A closed BaseWindow doesn't destroy its views' webContents.
    if (live(header.view.webContents)) header.view.webContents.close()
    const index = minis.indexOf(m)
    if (index >= 0) minis.splice(index, 1)
    if (lastActive === m) lastActive = null
    notifyBrowserWindowsChanged()
  })
  notifyBrowserWindowsChanged()
  return m
}

/** Bring the window up. `focus`: take the keyboard (shortcut/toggle); otherwise stay out of the way (pop out). */
function present(m: Mini, focus: boolean): void {
  if (m.closed || m.window.isDestroyed()) return
  // Tucked behind its handle: slide out instead.
  if (m.dock.isTucked()) return m.dock.slideOut(focus)
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
  // Docked: its handle shows with it.
  m.dock.follow()
}

/** Pop a tab out into a new mini window of its own (already in one: bring that one up). */
export async function popOutTab(tabId: string): Promise<boolean> {
  const existing = miniWithTab(tabId)
  if (existing) {
    present(existing, false)
    return true
  }
  if (atCap()) return false
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

/** The toggle shortcut with no mini window open: open the pinned page in a new one. */
export async function openPinnedPage(url: string): Promise<boolean> {
  if (atCap()) return false
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

/** On screen right now: shown and not tucked away. */
function showing(m: Mini): boolean {
  return !m.closed && !m.window.isDestroyed() && !m.dock.isTucked() && m.window.isVisible() && !m.window.isMinimized()
}

/** Hide one: docked ones tuck behind their handle, the rest hide. */
function hideMini(m: Mini): void {
  setRevealed(m, false)
  if (m.dock.isDocked()) {
    if (!m.dock.isTucked()) m.dock.toggle(false)
  } else {
    m.window.hide()
  }
}

/**
 * Show or hide every mini window together: any on screen → all hide (docked ones tuck away);
 * none on screen → all come back (docked ones slide out), the last used one focused.
 */
export function toggleVisible(): boolean {
  const open = liveMinis().filter((m) => host().header(m.window))
  if (open.length === 0) return false
  if (open.some(showing)) {
    for (const m of open) hideMini(m)
    return true
  }
  const focused = currentMini()
  for (const m of open) if (m !== focused) present(m, false)
  if (focused) present(focused, true)
  return true
}

/** Tuck the last used mini window to its nearest screen edge, or slide it back out when tucked. */
export function toggleTuck(tabId?: string): boolean {
  const m = tabId ? miniWithTab(tabId) : currentMini()
  if (!m || !host().header(m.window)) return false
  setRevealed(m, false)
  return m.dock.toggle(true)
}

/** Is the last used mini window (or the one holding `tabId`) tucked away behind its handle? */
export function isTucked(tabId?: string): boolean {
  const m = tabId ? miniWithTab(tabId) : currentMini()
  return Boolean(m?.dock.isTucked())
}

function returnMini(m: Mini): boolean {
  if (m.closed || m.window.isDestroyed()) return false
  unwirePage(m)
  const moved = host().returnTab(m.window)
  if (!moved) rewirePage(m)
  return moved
}

/** Put one mini window's tab back in the browser: the one `window` is, or the one holding `tabId`. */
export function returnToBrowser(target: { window?: BaseWindow; tabId?: string }): boolean {
  const m = target.window ? miniOf(target.window) : target.tabId ? miniWithTab(target.tabId) : null
  return m ? returnMini(m) : false
}

/** Put every mini window's tab back in the browser (oldest first, so they land in that order). */
export function returnAll(): boolean {
  let any = false
  for (const m of liveMinis()) any = returnMini(m) || any
  return any
}

/** Bring one mini window up with the keyboard (Window menu, palette). */
export function focusMini(tabId: string): boolean {
  const m = miniWithTab(tabId)
  if (!m) return false
  present(m, true)
  return true
}

/** Open mini windows, oldest first, for the Window menu and the palette. */
export function list(): Array<{ tabId: string; title: string; tucked: boolean; focused: boolean }> {
  return liveMinis().flatMap((m) => {
    const info = host().header(m.window)
    return info ? [{ tabId: info.tabId, title: info.title || miniHeaderUrl(info.url) || 'Mini Window', tucked: m.dock.isTucked(), focused: m.window.isFocused() }] : []
  })
}

export function isOpen(): boolean {
  return liveMinis().some((m) => host().header(m.window))
}

export function refreshHeader(window: BaseWindow): void {
  const m = miniOf(window)
  if (m) refreshHeaderOf(m)
}

export function applySettings(settings: MiniWindowSettings): void {
  for (const m of liveMinis()) applyWindowSettings(m, settings)
}
