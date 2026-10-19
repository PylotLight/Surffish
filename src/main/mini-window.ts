import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseWindow, Menu, WebContentsView, app, globalShortcut, ipcMain, nativeTheme, screen, systemPreferences, type Display, type IpcMainEvent, type WebContents } from 'electron'
import {
  MINI_WINDOW_CASCADE_STEP,
  MINI_WINDOW_GEOMETRY_FILE,
  MINI_WINDOW_HEADER_HEIGHT,
  MINI_WINDOW_MAX,
  MINI_WINDOW_MIN_SIZE,
  MINI_WINDOW_POPOUT_STRIP_HEIGHT,
  MINI_WINDOW_REVEAL_ZONE,
  cascadeMiniBounds,
  freeMiniSlot,
  inMiniRevealZone,
  initialMiniBounds,
  miniDisplayKey,
  miniHeaderHeight,
  miniHeaderUrl,
  miniMergeTarget,
  miniPageBounds,
  MINI_WINDOW_DEFAULT_SIZE,
  miniSplitBounds,
  parseMiniGeometry,
  parseMiniSlots,
  planMiniHeader,
  planMiniRegroup,
  snapMiniToCorner,
  unionMiniRect,
  withMiniSlot,
  type MiniHeaderLayout,
  type MiniRect,
  type MiniWindowGrouping,
  type MiniWindowHeaderPlacement,
  type MiniWindowHeaderState,
  type MiniWindowSettings
} from '../shared/mini-window'
import { dockArrow, dockedBounds, keepBelowTopEdge, type MiniDisplay, type MiniDock } from '../shared/mini-window-dock'
import {
  MINI_MENU_BAR_DEFAULT_SIZE,
  MINI_WINDOW_MENU_BAR_FILE,
  createMenuBarPopout,
  menuBarPageSize,
  menuBarPopoutBounds,
  menuBarWindowSize,
  parseMenuBarSaved,
  pickMenuBarMini,
  pickRestoredMenuBarTabs,
  type MenuBarPopout
} from '../shared/mini-window-menubar'
import { watchShellSurface } from './crash-guard'
import { createDockController, savedDockFor, setDockGrouping, type DockController } from './mini-window-dock'
import { menuBarTrayBounds, syncMenuBarTray, type MenuBarTrayEntry, type MenuBarTrayHost } from './mini-window-menubar'
import { motion, placeWindow } from './mini-window-motion'
import { createVelocityTracker, planGlide, releaseVelocity, runGlide, type ThrowVelocity, type VelocityTracker } from '../shared/mini-window-throw'
import { getMiniWindowHost, getMiniWindowSettings, openMiniWindowSettings, setMiniWindowGrouping, updateMiniWindowSettings, type MiniWindowHost, type MiniWindowTab, type MiniWindowTabAudio } from './mini-window-entry'
import { MINI_WINDOW_PAGE_HTML } from './mini-window-page'
import { changedHeaderFields, createHeaderStateGate, type HeaderStateGate } from '../shared/mini-window-header-sync'
import { miniReorderTarget, miniStepTarget, miniStripInsertIndex, resolveMiniChipDrop } from '../shared/mini-window-tab-drag'
import { isTabCrashed, recoverCrashedTabOnActivate } from './tab-health'
import { readUserJson, writeUserJson } from './user-json'
import { notifyBrowserWindowsChanged } from './window-scope'
import { isSpaceReorderHide, joinActiveSpace, makeFloatingPanel, setPanelDebugLog, showFloatingPanel } from './mac-panel'
import { headerDebug, miniHeaderDebugEnabled, onMiniHeaderDebugChange, traceHeaderContents, traceMiniWindow, untraceHeaderContents, untraceMiniWindow } from './mini-header-debug'

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
 *
 * Grouping (Settings → Mini window grouping, live): 'tabs' makes each window a collection with a tab
 * strip (pop out adds to the last used one; drag a tab out to split, drop a header on another
 * window's header or dock to an edge holding one to merge); 'stack' keeps windows apart but groups
 * the ones docked to one edge behind one handle (mini-window-dock.ts); 'separate' is one window per
 * tab. Switching regroups open windows by moving views only (no reloads). The cap counts tabs.
 *
 * Header placement (Settings → Mini window header, live): 'float' puts the header view in a panel of
 * its own (same level / Spaces behaviour as the window) attached just above the window, or below it
 * when there is no room above, so it never covers the page; it moves with the window, and pressing it
 * drags the window (main follows the pointer). 'push' keeps it in the window and moves the page down
 * while it shows; 'overlay' lays it over the page. The header view moves between the window and the
 * panel without reloading.
 *
 * Menu bar (shared/mini-window-menubar.ts; the Tray is mini-window-menubar.ts): a mini window (with
 * 'tabs', a collection; every menu bar mini merges into one) can live in the menu bar instead of
 * floating or being tucked: it hides, and the icon's click drops it in as a panel anchored under the
 * icon (shared frame loop), focused so Esc and a click elsewhere hide it again (unless pinned). It is
 * never docked or dragged there. Its header is not the auto-hiding one: whatever the placement, one
 * slim strip is always there above the page ('strip': tabs or the title, ⋯ / Pin / Close; the
 * strip adds to the window, so the page keeps the popout's size), so coming from the icon the pointer
 * never slides a header in over the page. Hidden is not closed. Which pages live there is saved (not private ones) and picked back out of the restored
 * tabs after a restart.
 */

interface Mini {
  window: BaseWindow
  /** Which remembered spot/dock it uses (the lowest free when it opened). */
  slot: number
  /** Last title the Window menu was told about. */
  menuTitle: string
  /** Last window title set (setTitle only when it changes). */
  windowTitle: string
  /**
   * What the header page last got (shared/mini-window-header-sync.ts): unchanged state is never
   * re-sent (a page's per-keystroke replaceState/title churn repainted the popout's glass strip).
   * `headerTimer`: the trailing push of a held title change.
   */
  headerGate: HeaderStateGate<NonNullable<ReturnType<typeof headerState>>>
  headerTimer: ReturnType<typeof setTimeout> | null
  /**
   * The header page's view, or null while released: its renderer (~20 MB PSS, ~80 MB RSS on Linux) is
   * made when the window opens, released once it has sat hidden with the pointer away for a while
   * (headerIdleReleaseMs, 30 s), and made again as soon as the pointer comes over the window (ensureHeader).
   */
  header: WebContentsView | null
  /** Header strip shown (the pointer is near the top of the window, or on the header). */
  revealed: boolean
  /** Pointer is on the header view itself. */
  hovered: boolean
  hideTimer: ReturnType<typeof setTimeout> | null
  /** A menu bar popout's blur held right after it opened, settled when this fires. */
  blurTimer: ReturnType<typeof setTimeout> | null
  /** While revealed: polls the cursor so leaving the window (no page event) hides the header. */
  pollTimer: ReturnType<typeof setInterval> | null
  geometryTimer: ReturnType<typeof setTimeout> | null
  /** The page contents this module listens to (re-wired when the tab's view changes). */
  page: WebContents | null
  pageListeners: Array<[string, (...args: never[]) => void]>
  /** Header loaded (it is attached only then, so it never takes keyboard focus from the page). Reading it makes the header again when it was released. */
  readonly headerReady: Promise<void>
  /** The current header view's load (headerReady without making one). */
  headerLoading: Promise<void>
  /** Hidden and idle: releases the header's renderer when it fires (scheduleHeaderRelease). */
  headerIdleTimer: ReturnType<typeof setTimeout> | null
  /** Docked to a screen edge / tucked away behind its handle. */
  dock: DockController
  /** Moves before this are ours (corner snap), not a user drop. */
  ownMoveUntil: number
  closed: boolean
  /** Header page loaded (it is attached only then). */
  headerLoaded: boolean
  /** Where the header view is attached: the window itself or the floating panel. */
  mount: 'window' | 'panel' | null
  /** 'float': the panel the header lives in (created on first need, closed with the window). */
  panel: BaseWindow | null
  /** Where the revealed header goes right now (planMiniHeader), kept current as the window moves. */
  plan: MiniHeaderLayout
  /** The page's top inside the window ('push' while revealed: under the header), and the window's content size. */
  pageTop: number
  size: { width: number; height: number }
  /** 'push': no reveal before this (just hidden), so the page never bounces under a resting pointer. */
  revealBlockedUntil: number
  /** Dragging the window by its floating header: main follows the pointer from where it was pressed. */
  headerDrag: { startCursor: { x: number; y: number }; startBounds: MiniRect; side: 'above' | 'below' | null; moved: boolean; startedAt: number; samples: VelocityTracker } | null
  /** Thrown (let go while moving): gliding to a stop on the frame loop (shared/mini-window-throw.ts). Its motion key, and the last few places it put the window. */
  glide: { key: object; placed: MiniRect[] } | null
  /** Native window drags (Windows: 'moved' says when it is let go): recent window positions for the throw. */
  moveSamples: VelocityTracker
  /** One of its strip chips is being dragged (the header stays up until it is let go or Esc). */
  tabDrag: { tabId: string; startedAt: number } | null
  /** Where its strip and chips are (header view coordinates), as the header page last reported them. */
  stripLayout: MiniStripLayout | null
  /** A tab dragged from elsewhere is over it: its strip slot is hinted (and its header kept up). */
  dropTarget: boolean
  /**
   * Lives in the menu bar: shown as a popout under the icon (null: floating or docked). `menuOpen` /
   * `menuClosedAt`: its ⋯ menu is up / went away then (the Esc that closes the menu never also hides the popout).
   */
  menuBar: { popout: MenuBarPopout; pinned: boolean; joinedAt: number; menuOpen: boolean; menuClosedAt: number } | null
}

const IS_MAC = process.platform === 'darwin'
const HEADER_READY_TIMEOUT_MS = 3000
/**
 * A header that has been hidden this long, with the pointer off the window, gives its renderer back; the
 * pointer coming over the window makes it again (a page load, well before it reaches the reveal zone
 * most of the time). The menu bar popout's strip is always up, so it keeps its header.
 * SURFFISH_MINI_HEADER_IDLE_MS overrides it (0: never release; read each time, so smokes can shorten it).
 */
function headerIdleReleaseMs(): number {
  const forced = process.env['SURFFISH_MINI_HEADER_IDLE_MS']
  const ms = forced ? Number(forced) : NaN
  return Number.isFinite(ms) && ms >= 0 ? ms : 30_000
}
const HIDE_DELAY_MS = 700
const POLL_MS = 300
const GEOMETRY_SAVE_DELAY_MS = 400
/** 'push': after hiding, reveals wait this long (no bounce while the page settles under the pointer). */
const PUSH_REVEAL_COOLDOWN_MS = 250
const HEADER_DRAG_MAX_MS = 15_000
/** Native window drags report when they are let go only on Windows ('moved' after WM_EXITSIZEMOVE; macOS sends it with every move, Linux never). */
const NATIVE_THROW = process.platform === 'win32'
const HEADER_DRAG_THRESHOLD = 3

/** Open mini windows, oldest first. */
const minis: Mini[] = []
/** The one most recently opened or focused (what the palette's Tuck command acts on; where 'tabs' adds a popped-out tab). */
let lastActive: Mini | null = null
let ipcRegistered = false
let appliedGrouping: MiniWindowGrouping = getMiniWindowSettings().grouping
const OWN_MOVE_GRACE_MS = 500

function grouping(): MiniWindowGrouping {
  return getMiniWindowSettings().grouping
}

function headerPlacement(): MiniWindowHeaderPlacement {
  return getMiniWindowSettings().headerPlacement
}

/** Where this window's header goes (the menu bar popout has its own always-on strip instead: updatePlan). */
function placementOf(m: Mini): MiniWindowHeaderPlacement {
  const placement = headerPlacement()
  return m.menuBar && placement === 'float' ? 'push' : placement
}
let appliedPlacement: MiniWindowHeaderPlacement = headerPlacement()
setDockGrouping(grouping)

function tabsOf(m: Mini): MiniWindowTab[] {
  return m.closed || m.window.isDestroyed() ? [] : host().tabs(m.window)
}

/** Tabs in every mini window (what the cap counts). */
function totalTabs(): number {
  return liveMinis().reduce((sum, m) => sum + tabsOf(m).length, 0)
}

function liveMinis(): Mini[] {
  return minis.filter((m) => !m.closed && !m.window.isDestroyed())
}

/** The mini window `window` is, if any. */
function miniOf(window: BaseWindow): Mini | null {
  return liveMinis().find((m) => m.window === window) ?? null
}

/** The mini window holding tab `tabId`, if any. */
function miniWithTab(tabId: string): Mini | null {
  return liveMinis().find((m) => tabsOf(m).some((tab) => tab.tabId === tabId)) ?? null
}

/** The palette's single-window commands act on the last one used (floating or docked; never one in the menu bar). */
function currentMini(): Mini | null {
  const open = liveMinis().filter((m) => !m.menuBar && host().header(m.window))
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

// ---------------------------------------------------------------------------
// SURFFISH_DEBUG_HEADER / ⌘K "Start Logging Mini Window Header Events" (mini-header-debug.ts).

/** The state each mini's header page last got, for the debug log's "which fields changed". */
const debugPushed = new WeakMap<Mini, object>()

// Panel diagnostics (native addon load failures, which Space a panel came up on) go to the same log.
setPanelDebugLog((kind, detail) => headerDebug(kind, detail))

function miniLabel(m: Mini): string {
  return `[mini ${m.slot}${m.menuBar ? ' popout' : ''}]`
}

function debugHost(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'data:' ? 'data:' : `${parsed.protocol}//${parsed.host}${parsed.pathname.length > 1 ? '/…' : ''}`
  } catch {
    return url.slice(0, 40)
  }
}

function traceMini(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  const name = (view: Electron.View): string => {
    if (view === m.header) return 'header'
    const contents = (view as Partial<WebContentsView>).webContents
    if (!contents || contents.isDestroyed()) return 'view'
    return contents === m.page || contents === host().pageContents(m.window) ? `page(${debugHost(contents.getURL())})` : `view(${debugHost(contents.getURL())})`
  }
  traceMiniWindow(m.window, () => miniLabel(m), name)
  if (m.panel && !m.panel.isDestroyed()) traceMiniWindow(m.panel, () => `${miniLabel(m)} floating-header-panel`, name)
  if (m.header && live(m.header.webContents)) traceHeaderContents(m.header.webContents, () => miniLabel(m))
}

let debugWired = false
function wireHeaderDebug(): void {
  if (debugWired) return
  debugWired = true
  headerDebug('debug', `logging on at launch (SURFFISH_DEBUG_HEADER=1; Surffish ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${process.arch})`)
  onMiniHeaderDebugChange((on) => {
    for (const m of liveMinis()) {
      if (on) traceMini(m)
      else {
        untraceMiniWindow(m.window)
        if (m.panel && !m.panel.isDestroyed()) untraceMiniWindow(m.panel)
        if (m.header && live(m.header.webContents)) untraceHeaderContents(m.header.webContents)
      }
      if (m.header && live(m.header.webContents) && m.headerLoaded) m.header.webContents.send('mini-window:debug', on)
      if (on) headerDebug('state', `${miniLabel(m)} mount=${m.mount} revealed=${m.revealed} plan=${m.plan.kind} pinned=${m.menuBar?.pinned === true} focused=${m.window.isFocused()} visible=${m.window.isVisible()} views=[${m.window.contentView.children.map((view) => (view === m.header ? 'header' : 'page/view')).join(', ')}]`)
    }
  })
  // The header page's own trace (DOM writes, class toggles, focus, hover, theme), batched.
  ipcMain.on('mini-window:debug-log', (event, lines: unknown) => {
    if (!miniHeaderDebugEnabled() || !Array.isArray(lines)) return
    const m = fromHeader(event)
    const label = m ? miniLabel(m) : '[header ?]'
    for (const line of lines.slice(0, 200)) if (typeof line === 'string') headerDebug('dom', `${label} ${line.slice(0, 300)}`)
  })
  nativeTheme.on('updated', () => headerDebug('theme', `dark=${nativeTheme.shouldUseDarkColors} reducedTransparency=${nativeTheme.prefersReducedTransparency} highContrast=${nativeTheme.shouldUseHighContrastColors}`))
}

function preloadPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../preload/mini-window.cjs')
  return existsSync(path) ? path : null
}

function fromHeader(event: IpcMainEvent): Mini | null {
  return liveMinis().find((m) => m.header?.webContents === event.sender) ?? null
}

// ---------------------------------------------------------------------------
// Geometry: one remembered rect per slot per display (keyed by its work area).

function readGeometry(): Array<Record<string, MiniRect>> {
  return parseMiniSlots(readUserJson(MINI_WINDOW_GEOMETRY_FILE), parseMiniGeometry)
}

function saveGeometry(m: Mini): void {
  // Tucked (off screen) or mid-slide: not a place to come back to. The menu bar's popout keeps its size only.
  if (m.closed || m.window.isDestroyed() || m.window.isMinimized() || m.dock.isTucked()) return
  if (m.menuBar) return
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
  if (snapped) {
    m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
    m.window.setBounds(snapped)
  }
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

function sameRect(a: MiniRect, b: MiniRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function miniDisplay(display: Display): MiniDisplay {
  return { bounds: display.bounds, workArea: display.workArea }
}

function allMiniDisplays(): MiniDisplay[] {
  return screen.getAllDisplays().map(miniDisplay)
}

/** `rect` with `top` px taken off its top (never below one px tall). */
function insetTop(rect: MiniRect, top: number): MiniRect {
  const cut = Math.max(0, Math.min(top, rect.height - 1))
  return { ...rect, y: rect.y + cut, height: rect.height - cut }
}

function within(point: { x: number; y: number }, rect: MiniRect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

function floats(plan: MiniHeaderLayout): plan is Extract<MiniHeaderLayout, { panel: MiniRect }> {
  return plan.kind === 'above' || plan.kind === 'below'
}

/** Where the revealed header goes for the window where it is now, or `at` where this frame puts it (the side kept while dragging by it). */
function updatePlan(m: Mini, at?: MiniRect): void {
  const bounds = at ?? m.window.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  // The menu bar popout: its strip, always there (never the auto-hiding header).
  m.plan = m.menuBar ? { kind: 'strip' } : planMiniHeader(placementOf(m), bounds, headerHeight(m), workArea, m.dock.state()?.dock.edge ?? null, m.headerDrag?.side ?? null)
}

/** The floating header's panel: frameless, never focused, at the window's level and on every Space like it. */
function ensurePanel(m: Mini): BaseWindow {
  if (m.panel && !m.panel.isDestroyed()) return m.panel
  const panel = new BaseWindow({
    width: Math.max(1, m.size.width),
    height: MINI_WINDOW_HEADER_HEIGHT,
    title: 'Mini Window Header',
    ...(IS_MAC ? { type: 'panel' } : {}),
    frame: false,
    transparent: true,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    acceptFirstMouse: true,
    backgroundColor: '#00000000'
  })
  makeFloatingPanel(panel)
  if (process.platform !== 'linux') panel.setOpacity(getMiniWindowSettings().opacity)
  panel.on('closed', () => {
    if (m.panel !== panel) return
    m.panel = null
    // Closed under us: the header goes back on the next layout (into a new panel or the window).
    if (m.mount === 'panel') m.mount = null
  })
  m.panel = panel
  if (miniHeaderDebugEnabled()) traceMini(m)
  return panel
}

function hidePanel(m: Mini): void {
  if (m.panel && !m.panel.isDestroyed() && m.panel.isVisible()) m.panel.hide()
}

/** The panel and the header view leave together (the header goes back into the window first when it is staying). */
function closePanel(m: Mini): void {
  const panel = m.panel
  if (!panel) return
  if (m.mount === 'panel') {
    if (!panel.isDestroyed() && m.header) panel.contentView.removeChildView(m.header)
    m.mount = null
  }
  m.panel = null
  if (!panel.isDestroyed()) panel.close()
}

/** Attach the header view to the window or the panel (moving the view; the header page never reloads). */
function mountHeader(m: Mini, where: 'window' | 'panel'): void {
  if (!m.header || !m.headerLoaded || m.mount === where || m.closed || m.window.isDestroyed()) return
  const from = m.mount === 'panel' ? m.panel : m.mount === 'window' ? m.window : null
  const to = where === 'panel' ? ensurePanel(m) : m.window
  if (from && !from.isDestroyed()) from.contentView.removeChildView(m.header)
  to.contentView.addChildView(m.header)
  m.mount = where
  sendHeaderState(m)
}

/** Floating and revealed: the panel sits on its side of the window (same x and width), shown without focus. */
function positionPanel(m: Mini): void {
  if (!floats(m.plan) || !m.revealed || m.mount !== 'panel' || !m.window.isVisible() || m.dock.isTucked()) return hidePanel(m)
  const panel = ensurePanel(m)
  // In a frame (a slide, a drag): commits in the same tick as the window.
  placeWindow(panel, m.plan.panel)
  if (!panel.isVisible()) {
    panel.showInactive()
    if (IS_MAC) {
      joinActiveSpace(panel, `${miniLabel(m)} header panel`)
      panel.setAlwaysOnTop(true, 'floating')
    }
  }
}

/** The window moved (dragged, slid along an edge, snapped), or is moving to `at` this frame: a revealed floating header follows it. */
function followPanel(m: Mini, at?: MiniRect): void {
  if (m.closed || m.window.isDestroyed()) return
  const before = m.plan.kind
  updatePlan(m, at)
  // Flipped across the window's edge (or between floating and push): lay it out again.
  if (m.revealed && floats(m.plan) !== (before === 'above' || before === 'below')) return layout(m)
  positionPanel(m)
}

function layout(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  const [width = 0, height = 0] = m.window.getContentSize()
  m.size = { width, height }
  updatePlan(m)
  // Showing (or the popout's strip, always up) while released: make it again; it lays out when loaded.
  if (!m.header && (m.revealed || m.plan.kind === 'strip')) void ensureHeader(m)
  const tall = headerHeight(m)
  // The page fills the window; 'push' moves it under the revealed header, 'overlay' runs it under it,
  // 'strip' (menu bar popout) keeps it under the strip at all times (no reflow on hover).
  // Revealed while a released header is still loading again: the page stays put until it is there.
  const page = miniPageBounds(m.plan.kind, m.revealed && m.headerLoaded, m.size, tall)
  m.pageTop = page.y
  host().setPageBounds(m.window, page)
  if (floats(m.plan)) {
    mountHeader(m, 'panel')
    m.header?.setBounds({ x: 0, y: 0, width, height: tall })
    positionPanel(m)
  } else {
    mountHeader(m, 'window')
    m.header?.setBounds({ x: 0, y: 0, width, height: m.revealed || m.plan.kind === 'strip' ? tall : 0 })
    hidePanel(m)
  }
  rewirePage(m)
}

/** The revealed header: its row, plus the tab strip for a collection of two or more ('tabs'); in the menu bar popout, its one strip (tabs and all). */
function headerHeight(m: Mini): number {
  if (m.menuBar) return MINI_WINDOW_POPOUT_STRIP_HEIGHT
  return miniHeaderHeight(tabsOf(m).length, grouping())
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
  // The popout's strip is never revealed (it is always there).
  if (m.closed || m.revealed === revealed || (revealed && m.menuBar)) return
  m.revealed = revealed
  cancelHide(m)
  if (revealed) {
    void ensureHeader(m)
    refreshHeaderOf(m)
    m.pollTimer ??= setInterval(() => pollPointer(m), POLL_MS)
  } else {
    stopPolling(m)
    stopHeaderDrag(m)
    m.hovered = false
    if (m.plan.kind === 'push') m.revealBlockedUntil = Date.now() + PUSH_REVEAL_COOLDOWN_MS
    scheduleHeaderRelease(m)
  }
  layout(m)
}

/** Nothing needs the header right now: hidden, not hovered or dragged, loaded, not the menu bar popout's strip. */
function headerIdle(m: Mini): boolean {
  if (headerIdleReleaseMs() <= 0 || m.closed || m.menuBar || m.revealed || m.hovered || m.headerDrag || m.tabDrag || m.dropTarget || !m.headerLoaded || !m.header) return false
  // Still has the keyboard (clicked, then the pointer left): keep it so the keys don't go nowhere.
  return !(live(m.header.webContents) && m.header.webContents.isFocused())
}

function cancelHeaderRelease(m: Mini): void {
  if (m.headerIdleTimer) clearTimeout(m.headerIdleTimer)
  m.headerIdleTimer = null
}

/** Release the header's renderer once it has been idle for headerIdleReleaseMs() (re-armed while the pointer is over the window). */
function scheduleHeaderRelease(m: Mini): void {
  cancelHeaderRelease(m)
  if (!headerIdle(m)) return
  m.headerIdleTimer = setTimeout(() => {
    m.headerIdleTimer = null
    if (!headerIdle(m) || m.window.isDestroyed()) return
    // Over the window (about to reveal it, most likely): keep it and look again later.
    if (m.window.isVisible() && within(screen.getCursorScreenPoint(), m.window.getBounds())) return scheduleHeaderRelease(m)
    releaseHeader(m)
  }, headerIdleReleaseMs())
  m.headerIdleTimer.unref?.()
}

/** Give the header's renderer back (it comes back through ensureHeader). */
function releaseHeader(m: Mini): void {
  cancelHeaderRelease(m)
  const view = m.header
  if (!view) return
  headerDebug('header', `${miniLabel(m)} header page released`)
  const from = m.mount === 'panel' ? m.panel : m.mount === 'window' ? m.window : null
  if (from && !from.isDestroyed()) from.contentView.removeChildView(view)
  m.header = null
  m.headerLoaded = false
  m.mount = null
  hidePanel(m)
  if (live(view.webContents)) view.webContents.close()
}

/** The header, made again if it was released; resolves once it has loaded (attached by then). */
function ensureHeader(m: Mini): Promise<void> {
  if (m.closed || m.window.isDestroyed()) return Promise.resolve()
  if (m.header && live(m.header.webContents)) return m.headerLoading
  if (m.header) releaseHeader(m)
  const header = createHeaderView()
  if (!header) return Promise.resolve()
  const { view } = header
  m.header = view
  m.headerLoaded = false
  m.mount = null
  const window = m.window
  const documentUrl = headerDocumentUrl()
  if (miniHeaderDebugEnabled()) {
    headerDebug('header', `${miniLabel(m)} header page created`)
    traceHeaderContents(view.webContents, () => miniLabel(m))
  }
  void view.webContents.loadURL(documentUrl).catch(() => undefined)
  // A crashed or hung header reloads like the browser's own surfaces (crash-guard.ts).
  watchShellSurface(view.webContents, () => view.webContents.loadURL(documentUrl).then(() => { m.headerGate.reset(); refreshHeaderOf(m) }), () => !m.closed && !window.isDestroyed() && m.header === view)
  // Keys pressed while the header has focus still run browser shortcuts for the mini tab.
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && host().handleShortcut(window, input)) event.preventDefault()
    else if (m.menuBar && isEscape(input) && !popoutMenuJustClosed(m)) hidePopout(m)
  })
  m.headerLoading = header.ready.then(() => {
    if (m.closed || window.isDestroyed() || m.header !== view) return
    m.headerLoaded = true
    // A new page (made again after a release) has seen nothing yet.
    m.headerGate.reset()
    if (miniHeaderDebugEnabled()) view.webContents.send('mini-window:debug', true)
    layout(m)
    refreshHeaderOf(m)
    scheduleHeaderRelease(m)
  })
  return m.headerLoading
}

function scheduleHide(m: Mini): void {
  if (!m.revealed || m.hovered || m.hideTimer || m.headerDrag || m.tabDrag || m.dropTarget) return
  m.hideTimer = setTimeout(() => {
    m.hideTimer = null
    if (!m.hovered && !m.headerDrag && !m.tabDrag && !m.dropTarget) setRevealed(m, false)
  }, HIDE_DELAY_MS)
}

/** The edge zone that reveals the header (the bottom edge when it floats below; the whole header while it is inside the window). */
function inRevealZone(m: Mini, y: number): boolean {
  const zone = floats(m.plan) ? MINI_WINDOW_REVEAL_ZONE : Math.max(MINI_WINDOW_REVEAL_ZONE, m.revealed ? headerHeight(m) : 0)
  return inMiniRevealZone(m.plan.kind, y, m.size.height, zone)
}

/** Pointer in the window's reveal zone, or on the floating header, keeps the header up. */
function pollPointer(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return stopPolling(m)
  const point = screen.getCursorScreenPoint()
  const bounds = m.window.getContentBounds()
  const onWindow = within(point, bounds) && inRevealZone(m, point.y - bounds.y)
  const onPanel = Boolean(m.panel && !m.panel.isDestroyed() && m.panel.isVisible() && within(point, m.panel.getBounds()))
  // The pointer position says whether it is on the header (its mouseleave can go missing, e.g. from a never-focused panel).
  m.hovered = m.mount === 'panel' ? onPanel : within(point, bounds) && point.y - bounds.y < headerHeight(m)
  if (onWindow || onPanel || m.headerDrag || m.tabDrag || m.dropTarget) cancelHide(m)
  else scheduleHide(m)
}

// ---------------------------------------------------------------------------
// Dragging the window by its floating header (the panel can't drag the window natively).

function stopHeaderDrag(m: Mini): void {
  if (m.headerDrag) motion.cancel(m.headerDrag)
  m.headerDrag = null
}

function startHeaderDrag(m: Mini): void {
  if (m.closed || m.window.isDestroyed() || m.mount !== 'panel') return
  stopHeaderDrag(m)
  // Grabbing it again stops a throw where it is.
  stopThrow(m)
  lastActive = m
  cancelHide(m)
  const drag: NonNullable<Mini['headerDrag']> = {
    startCursor: screen.getCursorScreenPoint(),
    startBounds: m.window.getBounds(),
    side: floats(m.plan) ? m.plan.kind : null,
    moved: false,
    startedAt: Date.now(),
    samples: createVelocityTracker()
  }
  // Once per frame (however fast the pointer reports): the window, its floating header, its handle and
  // ('stack') the rest of its group all move in this tick, one setBounds each.
  motion.run(drag, (now) => {
    if (m.headerDrag !== drag) return false
    if (m.closed || m.window.isDestroyed() || Date.now() - drag.startedAt > HEADER_DRAG_MAX_MS) {
      endHeaderDrag(m)
      return false
    }
    const cursor = screen.getCursorScreenPoint()
    // The pointer's path, for the throw when it is let go (read here: no extra IPC per move).
    drag.samples.add(now, cursor.x, cursor.y)
    const dx = cursor.x - drag.startCursor.x
    const dy = cursor.y - drag.startCursor.y
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < HEADER_DRAG_THRESHOLD) return true
    drag.moved = true
    // Never under the menu bar (macOS keeps a native drag out of it; this drag is ours): the header
    // floating above stays below the work area's top, where it can be grabbed again.
    const next = keepBelowTopEdge({ ...drag.startBounds, x: drag.startBounds.x + dx, y: drag.startBounds.y + dy }, drag.side === 'above' ? headerHeight(m) : 0, miniDisplay(screen.getDisplayNearestPoint(cursor)), allMiniDisplays())
    if (sameRect(m.window.getBounds(), next)) return true
    m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
    placeWindow(m.window, next)
    followPanel(m, next)
    // Docked: its handle follows ('stack': the rest of the group comes along the edge).
    m.dock.follow(next)
    scheduleGeometrySave(m)
    return true
  })
  m.headerDrag = drag
}

/** Let go: a drop like any window drag (merge onto a header, dock at an edge, snap to a corner), then the header may flip. */
function endHeaderDrag(m: Mini): void {
  const drag = m.headerDrag
  if (!drag) return
  stopHeaderDrag(m)
  if (!drag.moved || m.closed || m.window.isDestroyed()) return
  m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
  const cursor = screen.getCursorScreenPoint()
  const now = performance.now()
  drag.samples.add(now, cursor.x, cursor.y)
  releasedMini(m, cursor, drag.samples.velocity(now))
  if (!m.closed && !m.window.isDestroyed()) {
    layout(m)
    pollPointer(m)
  }
}

// ---------------------------------------------------------------------------
// Throwing (shared/mini-window-throw.ts): let go while moving and it glides on, slowing to a stop.

function stopThrow(m: Mini): void {
  if (m.glide) motion.cancel(m.glide.key)
  m.glide = null
}

/**
 * Let go of a drag (header or native) at `velocity`, the pointer at `point`. A drop that means something
 * right there wins (onto another collection's header, pushed past a screen edge); otherwise a throw
 * glides on (or flings it into a tuck) and the drop (dock, stay docked, corner snap) happens where it
 * stops. Too slow, stale, Reduce Motion or the setting off: an ordinary drop.
 */
function releasedMini(m: Mini, point: { x: number; y: number } | null, velocity: ThrowVelocity | null): void {
  if (m.closed || m.window.isDestroyed()) return
  const v = releaseVelocity({ enabled: getMiniWindowSettings().throwMomentum, reducedMotion: reducedMotion(), velocity })
  if (!v || m.menuBar || droppedOnSomething(m, point)) return droppedMini(m, point)
  if (throwMini(m, v)) return
  droppedMini(m, point)
}

/** Let go onto a merge target ('tabs') or pushed past a dockable edge: the drop happens right there, no throw. */
function droppedOnSomething(m: Mini, point: { x: number; y: number } | null): boolean {
  if (grouping() === 'tabs') {
    const above = headerPlacement() === 'float' ? MINI_WINDOW_HEADER_HEIGHT : 0
    if (miniMergeTarget(point ?? dropPoint(m), othersOnScreen(m), above)) return true
  }
  return m.dock.dropEdge() !== null
}

function throwMini(m: Mini, v: ThrowVelocity): boolean {
  stopThrow(m)
  const from = m.window.getBounds()
  // Flung hard at an edge it can tuck to: it tucks there, the slide carrying on at the throw's speed.
  if (m.dock.flingTuck(from, v)) {
    joinDockedCollection(m)
    scheduleGeometrySave(m)
    return true
  }
  // A header floating above the window stays below the top of the work area (not under the menu bar).
  const above = m.plan.kind === 'above' ? headerHeight(m) : 0
  const plan = planGlide(from, v, screen.getAllDisplays().map((display) => ({ workArea: insetTop(display.workArea, above) })))
  if (!plan) return false
  const glide: NonNullable<Mini['glide']> = { key: {}, placed: [from] }
  m.glide = glide
  // Each frame the window, its floating header, its handle and ('stack') the rest of its group move in
  // the same tick, like the drag it carries on from.
  runGlide(motion, glide.key, plan, (rect) => {
    if (m.glide !== glide) return false
    if (m.closed || m.window.isDestroyed() || m.headerDrag || m.menuBar || m.dock.moving() || !m.window.isVisible()) {
      m.glide = null
      return false
    }
    // A 'move' can report the frame before this one (Linux reports late): keep the last few.
    glide.placed.push(rect)
    if (glide.placed.length > 4) glide.placed.shift()
    m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
    placeWindow(m.window, rect)
    followPanel(m, rect)
    m.dock.follow(rect)
    return true
  }, () => {
    if (m.glide !== glide) return
    m.glide = null
    if (m.closed || m.window.isDestroyed()) return
    // Settled: the drop happens where it stopped (re-flush or undock from an edge, snap into a corner).
    // The pointer is somewhere else by now, so it never merges onto a header it happened to stop over.
    m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
    droppedMini(m, null, false)
    if (!m.closed && !m.window.isDestroyed()) layout(m)
  })
  return true
}

/** The window moved and it wasn't the glide: grabbed (a native drag), so the glide stops. */
function glideOverridden(m: Mini): boolean {
  const placed = m.glide?.placed
  if (!placed || m.window.isDestroyed()) return false
  const now = m.window.getBounds()
  return !placed.some((at) => Math.abs(now.x - at.x) <= 2 && Math.abs(now.y - at.y) <= 2)
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
    // A press on the page while it glides: caught, it stops there.
    if (input.type === 'mouseDown' && m.glide) stopThrow(m)
    if (input.type === 'mouseMove' || input.type === 'mouseEnter') {
      // The pointer is over the window: a released header loads again before it is asked for.
      if (!m.header) void ensureHeader(m)
      // In window coordinates ('push' moves the page under the header).
      if (inRevealZone(m, input.y + m.pageTop)) {
        if (m.revealed) cancelHide(m)
        else if (Date.now() >= m.revealBlockedUntil) setRevealed(m, true)
      } else {
        scheduleHide(m)
      }
    } else if (input.type === 'mouseLeave') {
      scheduleHide(m)
      if (!m.revealed) scheduleHeaderRelease(m)
    }
  })
  // SURFFISH_DEBUG_HEADER: what the page does while the header sits there (cheap no-ops while off).
  const pageDebug = (event: string, detail: () => unknown): void => { if (miniHeaderDebugEnabled()) headerDebug('page', `${miniLabel(m)} ${event} ${String(detail() ?? '')}`) }
  onPage(m, contents, 'did-start-loading', () => pageDebug('did-start-loading', () => `isLoading=${contents.isLoading()} mainFrame=${contents.isLoadingMainFrame()}`))
  onPage(m, contents, 'did-stop-loading', () => pageDebug('did-stop-loading', () => ''))
  onPage(m, contents, 'did-frame-navigate', (_event: Electron.Event, url: string, _code: number, _status: string, isMainFrame: boolean) => pageDebug('did-frame-navigate', () => `${isMainFrame ? 'main' : 'subframe'} ${debugHost(url)}`))
  onPage(m, contents, 'did-navigate-in-page', (_event: Electron.Event, url: string, isMainFrame: boolean) => pageDebug('did-navigate-in-page', () => `${isMainFrame ? 'main' : 'subframe'} ${debugHost(url)}`))
  onPage(m, contents, 'page-title-updated', (_event: Electron.Event, title: string) => pageDebug('page-title-updated', () => JSON.stringify(title)))
  onPage(m, contents, 'page-favicon-updated', (_event: Electron.Event, favicons: string[]) => pageDebug('page-favicon-updated', () => favicons.map((url) => url.slice(0, 60)).join(' ')))
  onPage(m, contents, 'focus', () => pageDebug('focus', () => ''))
  onPage(m, contents, 'blur', () => pageDebug('blur', () => ''))
  // In the menu bar's popout, Esc hides it (the page still gets the key).
  onPage(m, contents, 'before-input-event', (_event: Electron.Event, input: Electron.Input) => {
    if (m.menuBar && isEscape(input) && !popoutMenuJustClosed(m)) hidePopout(m)
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

function headerState(m: Mini): MiniWindowHeaderState & MiniWindowTabAudio & { tabId: string; crashed: boolean; floating: boolean; menuBar: { available: boolean; inMenuBar: boolean; pinned: boolean }; tuck: { arrow: string; label: string } | null; tabs: Array<{ tabId: string; title: string; faviconUrl: string | null; active: boolean } & MiniWindowTabAudio> } | null {
  const info = host().header(m.window)
  if (!info) return null
  const tuckEdge = m.dock.tuckEdge()
  const tabs = grouping() === 'tabs' ? tabsOf(m) : []
  return {
    tabs: tabs.length > 1 ? tabs.map((tab) => ({ tabId: tab.tabId, title: tab.title || miniHeaderUrl(tab.url) || 'Tab', faviconUrl: tab.faviconUrl, active: tab.active, audio: tab.audio, muted: tab.muted, volume: tab.volume })) : [],
    tuck: tuckEdge ? { arrow: dockArrow(tuckEdge, false), label: `Tuck to the ${tuckEdge} edge` } : null,
    title: info.title,
    url: miniHeaderUrl(info.url),
    faviconUrl: info.faviconUrl,
    loading: info.loading,
    canGoBack: info.canGoBack,
    private: info.private,
    crashed: isTabCrashed(m.page),
    floating: m.mount === 'panel',
    menuBar: { available: getMiniWindowSettings().menuBarIcon !== 'never', inMenuBar: m.menuBar !== null, pinned: m.menuBar?.pinned === true },
    // The header's own speaker (single tab; with a strip each chip has one).
    tabId: info.tabId,
    audio: info.audio,
    muted: info.muted,
    volume: info.volume
  }
}

/**
 * Anything outside the header's own state that should count as a change: the tabs as main knows them
 * (URLs: the saved menu bar pages; playing: the icon's ♪). Not their titles: the active one is the
 * header's title (throttled), and with a strip the chips carry them in the state.
 */
function headerExtraKey(m: Mini): string {
  return JSON.stringify(tabsOf(m).map(({ title: _title, ...tab }) => tab))
}

/** 'stack': a group's handle shows every member's favicon; otherwise just this one's. */
function refreshHandlesOf(m: Mini): void {
  if (grouping() === 'stack') for (const other of liveMinis()) other.dock.refreshHandle()
  else m.dock.refreshHandle()
}

function cancelHeaderPush(m: Mini): void {
  if (m.headerTimer) clearTimeout(m.headerTimer)
  m.headerTimer = null
}

/** The header page gets the state now, changed or not (just attached, or reloaded). */
function sendHeaderState(m: Mini): void {
  const contents = m.header?.webContents
  const state = live(contents) ? headerState(m) : null
  if (!contents || !state) return
  cancelHeaderPush(m)
  contents.send('mini-window:state', state)
  m.headerGate.sent(state, headerExtraKey(m))
  if (miniHeaderDebugEnabled()) {
    headerDebug('push', `${miniLabel(m)} full (header page attached / reloaded)`)
    debugPushed.set(m, state)
  }
}

function refreshHeaderOf(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  rewirePage(m)
  // A tab joined or left while the header is up: the strip comes or goes.
  if (m.revealed && m.header && m.header.getBounds().height !== headerHeight(m)) layout(m)
  let state = headerState(m)
  if (!state) return
  // Nothing the header shows changed (a page's replaceState per keystroke): no push, no repaint.
  // A same-document load blip never shows as loading; a title flipping per keystroke ("typing…")
  // lands at most every MINI_HEADER_TITLE_THROTTLE_MS (shared/mini-window-header-sync.ts).
  const extra = headerExtraKey(m)
  const plan = m.headerGate.plan(state, extra)
  if (plan.recheckMs === null) cancelHeaderPush(m)
  else {
    m.headerTimer ??= setTimeout(() => {
      m.headerTimer = null
      refreshHeaderOf(m)
    }, plan.recheckMs)
  }
  // The dock handle has its own state (dock side, the group's favicons); it diffs what it sends.
  if (!plan.send) {
    if (miniHeaderDebugEnabled()) headerDebug('update', `${miniLabel(m)} dropped (nothing shown changed${plan.recheckMs === null ? '' : `; recheck in ${plan.recheckMs}ms`}${state.loading ? '; page loading, not shown yet' : ''})`)
    return refreshHandlesOf(m)
  }
  state = plan.send
  m.headerGate.sent(state, extra)
  if (miniHeaderDebugEnabled()) {
    headerDebug('push', `${miniLabel(m)} ${changedHeaderFields(debugPushed.get(m) ?? null, state).join(' ') || '(extra key only: tab urls / audio)'}`)
    debugPushed.set(m, state)
  }
  const windowTitle = state.title ? `${state.title} — Mini Window` : 'Mini Window'
  if (windowTitle !== m.windowTitle) {
    m.windowTitle = windowTitle
    m.window.setTitle(windowTitle)
  }
  // The Window menu lists mini window tabs by title.
  const menuTitle = tabsOf(m).map((tab) => `${tab.tabId}\u0000${tab.title}`).join('\u0001')
  if (menuTitle !== m.menuTitle) {
    m.menuTitle = menuTitle
    notifyBrowserWindowsChanged()
  }
  const header = m.header?.webContents
  if (live(header)) header.send('mini-window:state', state)
  refreshHandlesOf(m)
  // In the menu bar: the icon's title/menu (count, playing) and the saved pages follow.
  if (m.menuBar) {
    syncTray()
    scheduleMenuBarSave()
  }
}

// ---------------------------------------------------------------------------
// The window.

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  wireHeaderDebug()
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
    if (m) returnTabOf(m)
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
  ipcMain.on('mini-window:activate-tab', (event, tabId: unknown) => {
    const m = fromHeader(event)
    if (!m || typeof tabId !== 'string' || !tabsOf(m).some((tab) => tab.tabId === tabId)) return
    host().activateTab(m.window, tabId)
    refreshHeaderOf(m)
  })
  ipcMain.on('mini-window:close-tab', (event, tabId: unknown) => {
    const m = fromHeader(event)
    if (m && typeof tabId === 'string' && tabsOf(m).some((tab) => tab.tabId === tabId)) host().closeTab(m.window, tabId)
  })
  // The speaker on the header / a strip chip: volume 0..1, click to mute.
  ipcMain.on('mini-window:set-volume', (event, tabId: unknown, volume: unknown) => {
    const m = fromHeader(event)
    if (!m || typeof tabId !== 'string' || typeof volume !== 'number' || !Number.isFinite(volume) || !tabsOf(m).some((tab) => tab.tabId === tabId)) return
    host().setTabVolume(m.window, tabId, volume)
  })
  ipcMain.on('mini-window:set-muted', (event, tabId: unknown, muted: unknown) => {
    const m = fromHeader(event)
    if (!m || typeof tabId !== 'string' || typeof muted !== 'boolean' || !tabsOf(m).some((tab) => tab.tabId === tabId)) return
    host().setTabMuted(m.window, tabId, muted)
  })
  ipcMain.on('mini-window:return-all', (event) => {
    const m = fromHeader(event)
    if (m) returnAllOf(m)
  })
  ipcMain.on('mini-window:tab-out', (event, tabId: unknown, x: unknown, y: unknown) => {
    const m = fromHeader(event)
    if (!m || typeof tabId !== 'string' || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return
    if (m.tabDrag) endTabDrag(m)
    void dropTabOutside(m, tabId, { x: Math.round(x), y: Math.round(y) })
  })
  // A strip chip drag: 'start' once it moves, 'move' as it goes (screen point), 'cancel' (Esc / lost).
  ipcMain.on('mini-window:tab-drag', (event, phase: unknown, tabId: unknown, x: unknown, y: unknown) => {
    const m = fromHeader(event)
    if (!m || typeof tabId !== 'string' || !tabsOf(m).some((tab) => tab.tabId === tabId)) return
    const point = typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null
    if (phase === 'start') startTabDrag(m, tabId)
    else if (phase === 'move' && point && m.tabDrag?.tabId === tabId) hintTabDrag(m, tabId, point)
    else if (phase === 'cancel') endTabDrag(m)
  })
  // Let go on its own strip before slot `slot` (or a keyboard step): the strip reorders.
  ipcMain.on('mini-window:move-tab', (event, tabId: unknown, slot: unknown) => {
    const m = fromHeader(event)
    if (m?.tabDrag) endTabDrag(m)
    if (!m || typeof tabId !== 'string' || typeof slot !== 'number' || !Number.isInteger(slot)) return
    reorderTab(m, tabId, miniReorderTarget(tabsOf(m).map((tab) => tab.tabId), tabId, slot))
  })
  ipcMain.on('mini-window:step-tab', (event, tabId: unknown, step: unknown) => {
    const m = fromHeader(event)
    if (!m || typeof tabId !== 'string' || (step !== -1 && step !== 1)) return
    reorderTab(m, tabId, miniStepTarget(tabsOf(m).map((tab) => tab.tabId), tabId, step))
  })
  ipcMain.on('mini-window:strip-layout', (event, layout: unknown) => {
    const m = fromHeader(event)
    if (m) m.stripLayout = parseStripLayout(layout)
  })
  ipcMain.on('mini-window:header-drag', (event, active: unknown) => {
    const m = fromHeader(event)
    if (!m) return
    if (active === true) startHeaderDrag(m)
    else endHeaderDrag(m)
  })
  ipcMain.on('mini-window:menubar', (event) => {
    const m = fromHeader(event)
    if (!m) return
    if (m.menuBar) leaveMenuBar(m, 'float')
    else sendToMenuBar(m)
  })
  // The popout strip's ⋯ button: its menu, under the button (header coordinates are the window's).
  ipcMain.on('mini-window:more', (event, x: unknown, y: unknown) => {
    const m = fromHeader(event)
    if (!m?.menuBar) return
    const at = typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null
    showPopoutMenu(m, at)
  })
  ipcMain.on('mini-window:pin', (event) => {
    const m = fromHeader(event)
    if (m) togglePin(m)
  })
  ipcMain.on('mini-window:menu', (event) => {
    const m = fromHeader(event)
    if (m) showMiniMenu(m, event.sender)
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
  if (process.platform !== 'linux') {
    m.window.setOpacity(settings.opacity)
    if (m.panel && !m.panel.isDestroyed()) m.panel.setOpacity(settings.opacity)
  }
  m.dock.applySettings()
}

/** Too many open (tabs across every mini window): say so in the browser window instead of opening another. */
function atCap(): boolean {
  if (totalTabs() < MINI_WINDOW_MAX) return false
  host().notify(`Up to ${MINI_WINDOW_MAX} mini windows at a time. Return one to the browser first.`)
  return true
}

/**
 * A new, empty mini window. `place`: open at these bounds (a tab split off under the pointer, or off
 * its collection when regrouping), docked like `place.dock` when given, instead of the remembered spot.
 */
function createMini(place: { bounds: MiniRect; dock: { dock: MiniDock; display: Display } | null } | null = null): Mini | null {
  registerIpc()
  const slot = freeMiniSlot(liveMinis().map((m) => m.slot))
  if (slot === null) return null
  const preload = preloadPath()
  if (!preload) {
    console.warn('[mini window] preload missing; mini window unavailable')
    return null
  }
  const opening = place?.bounds ?? openingBounds(slot)
  // Docked on this display last time: open against that edge again (out, with its handle).
  const display = place?.dock?.display ?? screen.getDisplayMatching(opening)
  const savedDock = !getMiniWindowSettings().tuckToEdge ? null : place ? place.dock?.dock ?? null : savedDockFor(slot, display, opening)
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
  // Never activating Surffish either: that would pull the user to the Space of a browser window.
  makeFloatingPanel(window)
  // Callbacks run later (m exists by then); `self` for any that could run while the controller is made.
  const self: { mini: Mini | null } = { mini: null }
  const dock = createDockController({
    window,
    slot,
    preload,
    faviconUrl: () => host().header(window)?.faviconUrl ?? null,
    tabCount: () => (window.isDestroyed() ? 0 : host().tabs(window).length),
    focusPage: () => {
      if (m.closed || window.isDestroyed()) return
      window.focus()
      host().pageContents(window)?.focus()
    },
    changed: () => refreshHeaderOf(m),
    moved: (rect) => followPanel(m, rect),
    // Never docked while in the menu bar.
    isTuckEnabled: () => getMiniWindowSettings().tuckToEdge && !self.mini?.menuBar,
    isPeekEnabled: () => getMiniWindowSettings().peekOnHover,
    isThrowEnabled: () => getMiniWindowSettings().throwMomentum,
    peekDelayMs: () => getMiniWindowSettings().peekDelayMs,
    peekRects: () => (m.panel && !m.panel.isDestroyed() && m.panel.isVisible() ? [m.panel.getBounds()] : []),
    peekContents: () => {
      const page = window.isDestroyed() ? null : host().pageContents(window)
      return [page, m.header?.webContents].filter((contents): contents is WebContents => Boolean(contents && !contents.isDestroyed()))
    },
    busy: () => liveMinis().some((other) => other.headerDrag !== null || other.glide !== null),
    menu: () => showMiniMenu(m, null)
  }, savedDock ? { dock: savedDock, display } : null)
  const m: Mini = {
    window,
    slot,
    menuTitle: '',
    windowTitle: '',
    headerGate: createHeaderStateGate({ now: () => performance.now() }),
    headerTimer: null,
    header: null,
    revealed: false,
    hovered: false,
    hideTimer: null,
    blurTimer: null,
    pollTimer: null,
    geometryTimer: null,
    page: null,
    pageListeners: [],
    get headerReady() { return ensureHeader(m) },
    headerLoading: Promise.resolve(),
    headerIdleTimer: null,
    dock,
    ownMoveUntil: 0,
    closed: false,
    headerLoaded: false,
    mount: null,
    panel: null,
    plan: { kind: 'overlay' },
    pageTop: 0,
    size: { width: bounds.width, height: bounds.height },
    revealBlockedUntil: 0,
    headerDrag: null,
    tabDrag: null,
    stripLayout: null,
    dropTarget: false,
    glide: null,
    moveSamples: createVelocityTracker(),
    menuBar: null
  }
  self.mini = m
  minis.push(m)
  lastActive = m
  if (miniHeaderDebugEnabled()) traceMini(m)
  window.on('focus', () => {
    m.menuBar?.popout.focused()
    lastActive = m
    // The Window menu checks the focused one.
    notifyBrowserWindowsChanged()
  })
  host().attachWindow(window)
  applyWindowSettings(m, getMiniWindowSettings())
  void ensureHeader(m)
  // Hidden (Show/Hide, tucked away): the header goes with it (and a menu bar popout counts as hidden).
  window.on('hide', () => {
    // A native Space fallback (mac-panel.ts) ordering it out and straight back in: not a hide.
    if (isSpaceReorderHide(window) && !window.isDestroyed()) {
      headerDebug('space', `${miniLabel(m)} hide from the active-Space reorder ignored`)
      return
    }
    setRevealed(m, false)
    if (m.menuBar?.popout.shown()) {
      m.menuBar.popout.close()
      syncTray()
    }
  })
  // In the menu bar: clicking anywhere else hides the popout, unless it is pinned. A blur right as it
  // opens (macOS moving the key window about while it comes up, a Space change) is held for a moment:
  // the focus coming back keeps it open, else it hides then.
  window.on('blur', () => {
    const bar = m.menuBar
    if (!bar) return
    if (bar.popout.blur(bar.pinned)) return syncTray()
    const wait = bar.popout.blurPendingMs()
    if (wait <= 0) return
    if (m.blurTimer) clearTimeout(m.blurTimer)
    m.blurTimer = setTimeout(() => {
      m.blurTimer = null
      if (m.closed || window.isDestroyed() || !m.menuBar) return
      if (window.isFocused()) m.menuBar.popout.focused()
      if (m.menuBar.popout.settle(m.menuBar.pinned)) syncTray()
    }, wait)
  })
  window.on('resize', () => {
    layout(m)
    // The popout remembers its size (a resize by the user, not one of ours), never a place.
    if (m.menuBar) {
      if (m.menuBar.popout.shown() && !m.menuBar.popout.animating() && Date.now() >= m.ownMoveUntil) rememberPopoutSize(m)
      return
    }
    if (m.dock.ignoringMoves()) return
    m.dock.follow()
    scheduleGeometrySave(m)
  })
  // macOS/Windows say when a drag ends ('moved'); Linux only streams 'move', so act after it settles.
  // Moves the dock makes itself (sliding, placing) are not drops.
  const dropped = (): void => {
    if (m.closed || window.isDestroyed() || m.menuBar || m.dock.ignoringMoves() || Date.now() < m.ownMoveUntil) return
    droppedMini(m, null)
  }
  if (process.platform === 'linux') {
    let settle: ReturnType<typeof setTimeout> | null = null
    window.on('move', () => {
      if (glideOverridden(m)) stopThrow(m)
      followPanel(m)
      if (m.menuBar || m.dock.ignoringMoves() || Date.now() < m.ownMoveUntil) return
      m.dock.follow()
      if (settle) clearTimeout(settle)
      settle = setTimeout(() => { settle = null; dropped() }, 350)
      scheduleGeometrySave(m)
    })
  } else {
    window.on('move', () => {
      // Grabbed mid-glide (a native drag): it stops there and the drag takes over.
      if (glideOverridden(m)) stopThrow(m)
      followPanel(m)
      if (m.menuBar || m.dock.ignoringMoves()) return
      if (NATIVE_THROW && !m.glide && Date.now() >= m.ownMoveUntil) {
        const bounds = window.getBounds()
        m.moveSamples.add(performance.now(), bounds.x, bounds.y)
      }
      m.dock.follow()
      scheduleGeometrySave(m)
    })
    window.on('moved', () => {
      if (!NATIVE_THROW) return dropped()
      // Windows: let go of a native drag. Thrown while moving, it glides on (the drop happens where it stops).
      const now = performance.now()
      const velocity = m.moveSamples.velocity(now)
      m.moveSamples.reset()
      if (m.closed || window.isDestroyed() || m.menuBar || m.glide || m.dock.ignoringMoves() || Date.now() < m.ownMoveUntil) return dropped()
      releasedMini(m, screen.getCursorScreenPoint(), velocity)
    })
  }
  window.on('closed', () => {
    m.closed = true
    cancelHeaderPush(m)
    cancelHide(m)
    stopPolling(m)
    stopHeaderDrag(m)
    stopThrow(m)
    if (m.tabDrag) endTabDrag(m)
    if (m.dropTarget) clearDropTarget(m)
    if (m.geometryTimer) {
      clearTimeout(m.geometryTimer)
      m.geometryTimer = null
    }
    if (m.blurTimer) {
      clearTimeout(m.blurTimer)
      m.blurTimer = null
    }
    unwirePage(m)
    m.dock.dispose()
    const wasInMenuBar = m.menuBar !== null
    m.menuBar?.popout.dispose()
    m.menuBar = null
    // A closed BaseWindow doesn't destroy its views' webContents.
    cancelHeaderRelease(m)
    const header = m.header?.webContents
    if (live(header)) header.close()
    // The floating header's panel goes with its window.
    closePanel(m)
    const index = minis.indexOf(m)
    if (index >= 0) minis.splice(index, 1)
    if (lastActive === m) lastActive = null
    if (lastMenuBar === m) lastMenuBar = null
    if (wasInMenuBar) {
      saveMenuBar()
      syncTray()
    }
    notifyBrowserWindowsChanged()
  })
  notifyBrowserWindowsChanged()
  return m
}

/** Bring the window up. `focus`: take the keyboard (shortcut/toggle); otherwise stay out of the way (pop out). */
function present(m: Mini, focus: boolean): void {
  if (m.closed || m.window.isDestroyed()) return
  // In the menu bar: drop in under the icon (focused: Esc and a click elsewhere hide it).
  if (m.menuBar) return showPopout(m, menuBarTrayBounds())
  // Tucked behind its handle: slide out instead.
  if (m.dock.isTucked()) return m.dock.slideOut(focus)
  // On the Space the user is on, without activating Surffish (it re-asserts the level too: some window
  // managers drop it while a window is hidden).
  showFloatingPanel(m.window, focus, miniLabel(m))
  if (focus) {
    const page = host().pageContents(m.window)
    if (page) page.focus()
  }
  if (m.panel && !m.panel.isDestroyed() && m.panel.isVisible()) m.panel.setAlwaysOnTop(true, IS_MAC ? 'floating' : undefined)
  // Docked: its handle shows with it.
  m.dock.follow()
}

/** Header loaded: show what the window holds and bring it up (`focus`: take the keyboard). */
async function finishOpen(m: Mini, focus: boolean): Promise<boolean> {
  layout(m)
  await m.headerReady
  if (m.closed) return false
  refreshHeaderOf(m)
  present(m, focus)
  return true
}

/**
 * Pop a tab out (already in one: bring that one up, showing the tab). Grouping 'tabs': into the last
 * used collection (a private tab never joins a normal one, so it gets its own); otherwise a new window.
 */
export async function popOutTab(tabId: string): Promise<boolean> {
  const existing = miniWithTab(tabId)
  if (existing?.menuBar) {
    // "Pop out" a tab living in the menu bar: it floats out of it.
    host().activateTab(existing.window, tabId)
    if (tabsOf(existing).length > 1) return Boolean(floatTabOut(existing, tabId))
    leaveMenuBar(existing, 'float')
    return true
  }
  if (existing) {
    host().activateTab(existing.window, tabId)
    present(existing, false)
    return true
  }
  if (atCap()) return false
  if (grouping() === 'tabs') {
    const target = currentMini()
    if (target && host().adoptTab(tabId, target.window)) {
      lastActive = target
      return finishOpen(target, false)
    }
  }
  const m = createMini()
  if (!m) return false
  if (!host().adoptTab(tabId, m.window)) {
    if (!host().header(m.window) && !m.window.isDestroyed()) m.window.close()
    return false
  }
  return finishOpen(m, false)
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
  return finishOpen(m, true)
}

// ---------------------------------------------------------------------------
// Grouping 'tabs': merge and split collections (views move; pages never reload).

/** Where a dragged window's header was let go: the pointer when it is on the window (a real drag), else the header's middle. */
function dropPoint(m: Mini): { x: number; y: number } {
  const bounds = m.window.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const onWindow = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + MINI_WINDOW_REVEAL_ZONE
  return onWindow ? cursor : { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + MINI_WINDOW_HEADER_HEIGHT / 2) }
}

/**
 * A window drag (its header) let go: on another collection's header it merges ('tabs'); against a
 * screen edge it docks and tucks away (into the collection already there, 'tabs'); near a corner it
 * snaps into it. `point`: where the floating header was let go (else where the pointer / header is).
 */
function droppedMini(m: Mini, point: { x: number; y: number } | null, merge = true): void {
  if (m.closed || m.window.isDestroyed()) return
  stopThrow(m)
  if (merge && grouping() === 'tabs') {
    // A floating header sits over the other windows' top edges: that band counts as their header too.
    const above = headerPlacement() === 'float' ? MINI_WINDOW_HEADER_HEIGHT : 0
    const target = miniMergeTarget(point ?? dropPoint(m), othersOnScreen(m), above)
    if (target && mergeInto(m, target.mini, true)) return
  }
  if (m.dock.afterDrop()) {
    if (joinDockedCollection(m)) return
  } else {
    snapToCorner(m)
  }
  scheduleGeometrySave(m)
}

/** Just docked to an edge another collection holds ('tabs'): its tabs join that one. True when merged. */
function joinDockedCollection(m: Mini): boolean {
  const key = grouping() === 'tabs' ? m.dock.groupKey() : null
  const peer = key ? liveMinis().find((other) => other !== m && host().header(other.window) && other.dock.groupKey() === key) : undefined
  return Boolean(peer && mergeInto(m, peer, false))
}

/** What a dragged tab let go "inside its own window" means: the window plus its floating header. */
function ownArea(m: Mini): MiniRect {
  const bounds = m.window.getBounds()
  return m.panel && !m.panel.isDestroyed() && m.panel.isVisible() ? unionMiniRect(bounds, m.panel.getBounds()) : bounds
}

/** The other mini windows on screen, with their bounds (merge targets). */
function othersOnScreen(m: Mini): Array<{ mini: Mini; bounds: MiniRect }> {
  return liveMinis().filter((other) => other !== m && showing(other) && host().header(other.window)).map((other) => ({ mini: other, bounds: other.window.getBounds() }))
}

/** The other mini windows on screen as tab drop targets: the window plus its floating header. */
function othersForTabDrop(m: Mini): Array<{ mini: Mini; bounds: MiniRect }> {
  return liveMinis().filter((other) => other !== m && showing(other) && host().header(other.window)).map((other) => ({ mini: other, bounds: ownArea(other) }))
}

/**
 * Move every tab of `from` into `into` (its active tab stays the active one); `from` closes with its
 * last tab. `show`: bring `into` up (a header dropped on it); a merge by docking leaves it as it was.
 */
function mergeInto(from: Mini, into: Mini, show: boolean): boolean {
  if (from === into || from.closed || into.closed) return false
  const tabs = tabsOf(from)
  const active = tabs.find((tab) => tab.active)
  unwirePage(from)
  let moved = false
  for (const tab of [...tabs.filter((candidate) => candidate !== active), ...(active ? [active] : [])]) moved = host().adoptTab(tab.tabId, into.window) || moved
  // Anything that couldn't come (a private tab and a normal collection) stays where it was.
  if (!from.closed && !from.window.isDestroyed() && tabsOf(from).length > 0) refreshHeaderOf(from)
  if (!moved) return false
  lastActive = into
  layout(into)
  refreshHeaderOf(into)
  if (show) present(into, true)
  return true
}

/**
 * A tab of `m` in a window of its own at `bounds` (docked like `dock` when given). The new window is
 * set up but not shown yet: the caller presents it (or tucks it).
 */
function splitOff(m: Mini, tabId: string, bounds: MiniRect, dock: { dock: MiniDock; display: Display } | null): Mini | null {
  const n = createMini({ bounds, dock })
  if (!n) return null
  const wasActive = tabsOf(m).find((tab) => tab.tabId === tabId)?.active === true
  if (wasActive) unwirePage(m)
  if (!host().adoptTab(tabId, n.window)) {
    if (!n.window.isDestroyed()) n.window.close()
    if (wasActive) rewirePage(m)
    return null
  }
  layout(n)
  refreshHeaderOf(m)
  return n
}

/**
 * A tab dragged out of `m`'s strip and let go at `point` (resolveMiniChipDrop): onto another mini
 * window it joins that collection at the strip slot under the pointer; onto a browser window it goes
 * back into its sidebar at the row under the pointer; anywhere else it splits off.
 */
async function dropTabOutside(m: Mini, tabId: string, point: { x: number; y: number }): Promise<void> {
  clearAllDropHints()
  if (!tabsOf(m).some((tab) => tab.tabId === tabId)) return
  const drop = resolveMiniChipDrop(point, { own: ownArea(m), ownStrip: stripOnScreen(m), tabCount: tabsOf(m).length, minis: othersForTabDrop(m), browsers: host().browserWindows() })
  if (drop.kind === 'merge') {
    moveTabInto(m, tabId, drop.into, slotAt(drop.into, point))
    return
  }
  if (drop.kind === 'return') {
    const active = tabsOf(m).find((tab) => tab.tabId === tabId)?.active === true
    if (active) unwirePage(m)
    await host().returnTabAt(m.window, tabId, drop.into, point)
    if (!m.closed && !m.window.isDestroyed()) {
      rewirePage(m)
      refreshHeaderOf(m)
    }
    return
  }
  if (drop.kind !== 'split') return
  const [width = 420, height = 620] = m.window.getSize()
  const n = splitOff(m, tabId, miniSplitBounds(point, { width, height }, screen.getDisplayNearestPoint(point).workArea), null)
  if (n) void finishOpen(n, true)
}

/** Move tab `tabId` of `from` into collection `into` before strip slot `slot` (its end when null), and show it there. */
function moveTabInto(from: Mini, tabId: string, into: Mini, slot: number | null): boolean {
  const beforeId = slot === null ? null : tabsOf(into)[slot]?.tabId ?? null
  if (tabsOf(from).find((tab) => tab.tabId === tabId)?.active) unwirePage(from)
  const moved = host().adoptTab(tabId, into.window, beforeId)
  if (moved) {
    lastActive = into
    layout(into)
    refreshHeaderOf(into)
    present(into, true)
  }
  if (!from.closed && !from.window.isDestroyed()) {
    if (!moved) rewirePage(from)
    refreshHeaderOf(from)
  }
  return moved
}

// ---------------------------------------------------------------------------
// Dragging tabs: strip chips (reorder / join another collection / back to the sidebar / split off),
// and sidebar tabs onto a mini window (shared/mini-window-tab-drag.ts has the rules).

/** A chip drag that never ends (pointer lost without an up or cancel) stops by itself. */
const TAB_DRAG_MAX_MS = 15_000
/** How often a sidebar drag outside its window checks which mini window is under the pointer. */
const FOREIGN_DRAG_POLL_MS = 50

interface MiniStripLayout { strip: MiniRect; chips: Array<{ id: string; left: number; width: number }> }

function parseStripLayout(value: unknown): MiniStripLayout | null {
  if (!value || typeof value !== 'object') return null
  const { strip, chips } = value as { strip?: unknown; chips?: unknown }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const rect = strip as Partial<MiniRect> | null
  if (!rect || !num(rect.x) || !num(rect.y) || !num(rect.width) || !num(rect.height) || !Array.isArray(chips)) return null
  const parsed = chips.flatMap((chip: unknown) => {
    const c = chip as { id?: unknown; left?: unknown; width?: unknown } | null
    return c && typeof c.id === 'string' && num(c.left) && num(c.width) ? [{ id: c.id, left: c.left, width: c.width }] : []
  })
  return { strip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, chips: parsed }
}

/** The header view's top-left on screen (null while it isn't on screen). */
function headerOrigin(m: Mini): { x: number; y: number } | null {
  if (m.closed || m.window.isDestroyed() || !m.window.isVisible()) return null
  const owner = m.mount === 'panel' ? m.panel : m.mount === 'window' ? m.window : null
  if (!owner || owner.isDestroyed() || !owner.isVisible()) return null
  if (!m.header) return null
  const view = m.header.getBounds()
  if (view.height <= 0 || view.width <= 0) return null
  const content = owner.getContentBounds()
  return { x: content.x + view.x, y: content.y + view.y }
}

/** `m`'s strip on screen, when it is showing (revealed with two or more tabs, or the popout's). */
function stripOnScreen(m: Mini): MiniRect | null {
  const origin = headerOrigin(m)
  const layout = m.stripLayout
  if (!origin || !layout || layout.chips.length === 0 || layout.strip.width <= 0) return null
  if (!m.header || layout.strip.y + layout.strip.height > m.header.getBounds().height) return null
  return { x: origin.x + layout.strip.x, y: origin.y + layout.strip.y, width: layout.strip.width, height: layout.strip.height }
}

/** The strip slot a drop at `point` takes in `m` (null: no strip on screen, so the end). */
function slotAt(m: Mini, point: { x: number; y: number }): number | null {
  const origin = headerOrigin(m)
  if (!origin || !stripOnScreen(m) || !m.stripLayout) return null
  return miniStripInsertIndex(point.x - origin.x, m.stripLayout.chips)
}

function reorderTab(m: Mini, tabId: string, index: number): void {
  if (index < 0 || !host().reorderTab(m.window, tabId, index)) return
  refreshHeaderOf(m)
}

/** Esc anywhere ends a drag (the header rarely has the keyboard: it never takes focus from the page). */
let escapeOwner: Mini | 'foreign' | null = null
function grabEscape(owner: Mini | 'foreign'): void {
  if (escapeOwner) {
    escapeOwner = owner
    return
  }
  try {
    if (globalShortcut.register('Escape', onDragEscape)) escapeOwner = owner
  } catch {
    // The page's own Esc handling in the header still cancels.
  }
}
function releaseEscape(owner: Mini | 'foreign'): void {
  if (escapeOwner !== owner) return
  escapeOwner = null
  try { globalShortcut.unregister('Escape') } catch { /* gone */ }
}
function onDragEscape(): void {
  const owner = escapeOwner
  if (owner && owner !== 'foreign') {
    const contents = owner.header?.webContents
    if (live(contents)) contents.send('mini-window:tab-drag-cancel')
    endTabDrag(owner)
  } else {
    releaseEscape('foreign')
  }
}

function startTabDrag(m: Mini, tabId: string): void {
  m.tabDrag = { tabId, startedAt: Date.now() }
  cancelHide(m)
  grabEscape(m)
}

function endTabDrag(m: Mini): void {
  m.tabDrag = null
  releaseEscape(m)
  clearAllDropHints()
  if (m.revealed) scheduleHide(m)
}

/** Hint what letting go of `m`'s chip at `point` would do: a slot in the collection under it, or a line in the sidebar. */
function hintTabDrag(m: Mini, tabId: string, point: { x: number; y: number }): void {
  if (m.tabDrag && Date.now() - m.tabDrag.startedAt > TAB_DRAG_MAX_MS) return endTabDrag(m)
  const drop = resolveMiniChipDrop(point, { own: ownArea(m), ownStrip: stripOnScreen(m), tabCount: tabsOf(m).length, minis: othersForTabDrop(m), browsers: host().browserWindows() })
  hintMini(drop.kind === 'merge' ? drop.into : null, point)
  if (drop.kind === 'return') void host().dropHintAt(drop.into, point, tabId)
  else host().clearDropHint()
}

/** Show `target`'s drop slot for `point` (revealing its header so the strip is there); every other mini clears. */
function hintMini(target: Mini | null, point: { x: number; y: number }): void {
  for (const other of liveMinis()) if (other !== target && other.dropTarget) clearDropTarget(other)
  if (!target) return
  if (!target.dropTarget) {
    target.dropTarget = true
    if (!target.menuBar) setRevealed(target, true)
  }
  const slot = slotAt(target, point)
  const contents = target.header?.webContents
  if (live(contents)) contents.send('mini-window:drop-hint', { slot })
}

function clearDropTarget(m: Mini): void {
  m.dropTarget = false
  const contents = m.header?.webContents
  if (live(contents)) contents.send('mini-window:drop-hint', null)
  if (m.revealed && !m.closed) scheduleHide(m)
}

function clearAllDropHints(): void {
  for (const m of liveMinis()) if (m.dropTarget) clearDropTarget(m)
  try { host().clearDropHint() } catch { /* host gone */ }
}

/** The mini window (a collection, on screen) under `point`, the floating header counting as part of it. */
function miniAt(point: { x: number; y: number }): Mini | null {
  return liveMinis().find((m) => showing(m) && host().header(m.window) && within(point, ownArea(m))) ?? null
}

let foreignDrag: { tabId: string; timer: ReturnType<typeof setInterval> } | null = null

/** A sidebar tab is dragged outside its window (null: back in, or let go): hint the mini window under the pointer. */
export function foreignTabDrag(tabId: string | null): void {
  if (foreignDrag) clearInterval(foreignDrag.timer)
  foreignDrag = null
  if (!tabId || !host().canPopOut(tabId)) {
    releaseEscape('foreign')
    for (const m of liveMinis()) if (m.dropTarget) clearDropTarget(m)
    return
  }
  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (Date.now() - startedAt > TAB_DRAG_MAX_MS) return foreignTabDrag(null)
    const point = screen.getCursorScreenPoint()
    const target = miniAt(point)
    hintMini(target && (grouping() === 'tabs' || tabsOf(target).length > 0) ? target : null, point)
  }, FOREIGN_DRAG_POLL_MS)
  foreignDrag = { tabId, timer }
}

/**
 * A sidebar tab let go at `point`: over a mini window, grouping 'tabs' adds it to that collection at
 * the strip slot under the pointer; the other groupings open it in a window of its own there. False
 * when no mini window is under the pointer (or it can't go: the cap, private vs normal).
 */
export function dropForeignTab(tabId: string, point: { x: number; y: number }): boolean {
  const target = miniAt(point)
  if (foreignDrag?.tabId === tabId) foreignTabDrag(null)
  for (const m of liveMinis()) if (m.dropTarget) clearDropTarget(m)
  if (!target || target.menuBar && !target.menuBar.popout.shown() || atCap()) return false
  if (grouping() === 'tabs') {
    const slot = slotAt(target, point)
    if (!host().adoptTab(tabId, target.window, slot === null ? null : tabsOf(target)[slot]?.tabId ?? null)) return false
    lastActive = target
    void finishOpen(target, true)
    return true
  }
  const n = createMini({ bounds: miniSplitBounds(point, MINI_WINDOW_DEFAULT_SIZE, screen.getDisplayNearestPoint(point).workArea), dock: null })
  if (!n) return false
  if (!host().adoptTab(tabId, n.window)) {
    if (!n.window.isDestroyed()) n.window.close()
    return false
  }
  void finishOpen(n, true)
  return true
}

// ---------------------------------------------------------------------------
// Keyboard (⌘K palette, and ⌥⇧←/→ on a focused strip chip): split, merge, move.

/** Palette "Split Tab Off Mini Window": the last used collection's tab on screen gets a window of its own beside it. */
export function splitCurrentTab(): boolean {
  const m = currentMini()
  const tabs = m ? tabsOf(m) : []
  const active = tabs.find((tab) => tab.active)
  if (!m || tabs.length < 2 || !active) return false
  const bounds = cascadeMiniBounds(m.window.getBounds(), liveMinis().map((other) => other.window.getBounds()), screen.getDisplayMatching(m.window.getBounds()).workArea)
  const n = splitOff(m, active.tabId, bounds, null)
  if (!n) return false
  void finishOpen(n, true)
  return true
}

/** Can the palette split the last used collection (grouping 'tabs', two or more tabs)? */
export function canSplitCurrentTab(): boolean {
  const m = currentMini()
  return grouping() === 'tabs' && Boolean(m && tabsOf(m).length > 1)
}

/** Floating collections that a merge can gather (not the menu bar's, which keeps its own). */
function mergeable(): Mini[] {
  return liveMinis().filter((m) => !m.menuBar && host().header(m.window))
}

/** Palette "Merge Mini Windows": every floating collection joins the last used one (grouping 'tabs'). */
export function mergeAllMinis(): boolean {
  if (grouping() !== 'tabs') return false
  const into = currentMini()
  if (!into) return false
  let any = false
  for (const m of mergeable()) if (m !== into) any = mergeInto(m, into, false) || any
  if (any) present(into, true)
  return any
}

export function canMergeMinis(): boolean {
  return grouping() === 'tabs' && mergeable().length > 1
}

/** Palette "Move Mini Window Tab Left/Right": the last used collection's tab on screen, one step. */
export function stepCurrentTab(step: -1 | 1): boolean {
  const m = currentMini()
  const active = m ? tabsOf(m).find((tab) => tab.active) : undefined
  if (!m || !active) return false
  const to = miniStepTarget(tabsOf(m).map((tab) => tab.tabId), active.tabId, step)
  if (to < 0 || !host().reorderTab(m.window, active.tabId, to)) return false
  refreshHeaderOf(m)
  return true
}

/** Palette "Move Tab to Mini Window: …": a browser tab (or another collection's) joins the collection holding `targetTabId`. */
export function moveTabToMini(tabId: string, targetTabId: string): boolean {
  const into = miniWithTab(targetTabId)
  if (!into || grouping() !== 'tabs' || miniWithTab(tabId) === into || atCap()) return false
  const from = miniWithTab(tabId)
  if (from) return moveTabInto(from, tabId, into, null)
  if (!host().adoptTab(tabId, into.window)) return false
  lastActive = into
  void finishOpen(into, true)
  return true
}

/** Settings → Mini window grouping changed: regroup what is open (planMiniRegroup). */
function regroup(next: MiniWindowGrouping): void {
  const open = liveMinis().filter((m) => host().header(m.window))
  const plan = planMiniRegroup(next, open.map((m, id) => ({ id, tabs: tabsOf(m).length, dockKey: m.dock.groupKey() })))
  for (const { into, from } of plan.merge) {
    const target = open[into]
    if (!target) continue
    for (const id of from) {
      const source = open[id]
      if (source) mergeInto(source, target, false)
    }
  }
  // 'tabs': every menu bar mini is one collection (a private one stays apart).
  if (next === 'tabs') {
    const [into, ...rest] = menuBarMinis()
    if (into) for (const from of rest) mergeInto(from, into, false)
  }
  for (const id of plan.split) {
    const m = open[id]
    if (!m) continue
    if (m.menuBar) {
      // Split out of a menu bar collection: each tab gets its own menu bar mini (hidden until picked).
      for (const tab of tabsOf(m).filter((candidate) => !candidate.active)) {
        const n = splitOff(m, tab.tabId, m.window.getBounds(), null)
        if (n) enterMenuBar(n, false)
      }
      continue
    }
    const state = m.dock.state()
    let previous = m.window.getBounds()
    for (const [index, tab] of tabsOf(m).filter((candidate) => !candidate.active).entries()) {
      // Docked: the new windows dock to the same edge, a step further along it ('stack' closes them up); else cascaded off it.
      const dock = state ? { dock: { ...state.dock, offset: state.dock.offset + (index + 1) * MINI_WINDOW_CASCADE_STEP }, display: state.display } : null
      const bounds = cascadeMiniBounds(previous, liveMinis().map((other) => other.window.getBounds()), screen.getDisplayMatching(previous).workArea)
      const n = splitOff(m, tab.tabId, bounds, dock)
      if (!n) continue
      previous = bounds
      if (state?.tucked) {
        void n.headerReady.then(() => refreshHeaderOf(n))
        n.dock.toggle(false)
      } else {
        void finishOpen(n, false)
      }
    }
  }
  for (const m of liveMinis()) {
    m.dock.regroup()
    refreshHeaderOf(m)
  }
}

// ---------------------------------------------------------------------------
// Showing, hiding, returning.

/** On screen right now: shown and not tucked away. */
function showing(m: Mini): boolean {
  return !m.closed && !m.window.isDestroyed() && !m.dock.isTucked() && m.window.isVisible() && !m.window.isMinimized()
}

/** Hide one: docked ones tuck behind their handle (with their group), the rest hide. */
function hideMini(m: Mini): void {
  setRevealed(m, false)
  if (m.menuBar) hidePopout(m)
  else if (m.dock.isDocked()) m.dock.tuckAway()
  else m.window.hide()
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
  // Menu bar minis stay up there (one popout at a time); with only those, the last shown drops in.
  const floating = open.filter((m) => !m.menuBar)
  if (floating.length === 0) {
    const pick = pickMenuBarMini(menuBarMinis(), lastMenuBar)
    if (pick) showPopout(pick, menuBarTrayBounds())
    return Boolean(pick)
  }
  const focused = currentMini()
  for (const m of floating) if (m !== focused) present(m, false)
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

/** Put one tab of `m` (default: its active one) back in the browser; its last tab closes the window. */
function returnTabOf(m: Mini, tabId?: string): boolean {
  if (m.closed || m.window.isDestroyed()) return false
  const active = !tabId || tabsOf(m).find((tab) => tab.tabId === tabId)?.active === true
  if (active) unwirePage(m)
  const moved = host().returnTab(m.window, tabId)
  if (!m.closed && !m.window.isDestroyed()) {
    rewirePage(m)
    refreshHeaderOf(m)
  }
  return moved
}

/** Every tab of `m` back in the browser (strip order). */
function returnAllOf(m: Mini): boolean {
  let any = false
  for (const tab of tabsOf(m)) any = returnTabOf(m, tab.tabId) || any
  return any
}

/** Put a mini window tab back in the browser: the active one of the window `window` is, or tab `tabId`. */
export function returnToBrowser(target: { window?: BaseWindow; tabId?: string }): boolean {
  if (target.window) {
    const m = miniOf(target.window)
    return m ? returnTabOf(m) : false
  }
  const m = target.tabId ? miniWithTab(target.tabId) : null
  return m ? returnTabOf(m, target.tabId) : false
}

/** Put every mini window tab back in the browser (oldest window first, so they land in that order). */
export function returnAll(): boolean {
  let any = false
  for (const m of liveMinis()) any = returnAllOf(m) || any
  return any
}

/** Bring the mini window holding `tabId` up with the keyboard, showing that tab (Window menu, palette). */
export function focusMini(tabId: string): boolean {
  const m = miniWithTab(tabId)
  if (!m) return false
  host().activateTab(m.window, tabId)
  present(m, true)
  return true
}

/** Open mini window tabs (a collection's in strip order), oldest window first, for the Window menu and the palette. */
export function list(): Array<{ tabId: string; title: string; tucked: boolean; focused: boolean; menuBar: boolean; active: boolean }> {
  return liveMinis().flatMap((m) => {
    const focused = m.window.isFocused()
    const tucked = m.dock.isTucked() || (m.menuBar !== null && !m.menuBar.popout.shown())
    return tabsOf(m).map((tab) => ({ tabId: tab.tabId, title: tab.title || miniHeaderUrl(tab.url) || 'Mini Window', tucked, focused: focused && tab.active, menuBar: m.menuBar !== null, active: tab.active }))
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
  // Menu bar icon 'never': what lived there floats out again.
  if (settings.menuBarIcon === 'never') for (const m of menuBarMinis()) leaveMenuBar(m, 'float')
  if (settings.grouping !== appliedGrouping) {
    appliedGrouping = settings.grouping
    regroup(settings.grouping)
  }
  if (settings.headerPlacement !== appliedPlacement) {
    appliedPlacement = settings.headerPlacement
    // The header moves between the window and its panel (no reload); a panel no longer needed closes.
    for (const m of liveMinis()) {
      setRevealed(m, false)
      layout(m)
      if (settings.headerPlacement !== 'float') closePanel(m)
      refreshHeaderOf(m)
    }
  }
  for (const m of liveMinis()) applyWindowSettings(m, settings)
  // Throwing turned off: a glide in flight stops where it is.
  if (!settings.throwMomentum) for (const m of liveMinis()) stopThrow(m)
  syncTray()
  for (const m of liveMinis()) refreshHeaderOf(m)
}

// ---------------------------------------------------------------------------
// Menu bar: minis that live behind the Tray icon and drop in as a popout under it.

/** The one a click on the icon shows (the last shown). */
let lastMenuBar: Mini | null = null
let menuBarJoins = 0
let menuBarSaveTimer: ReturnType<typeof setTimeout> | null = null
let menuBarSavedKey: string | null = null
/** Quitting: windows close one by one, which must not empty the saved list. */
let menuBarFrozen = false
app.once('before-quit', () => {
  if (menuBarSaveTimer) saveMenuBar()
  menuBarFrozen = true
})
const MENU_BAR_SAVE_DELAY_MS = 500

function isEscape(input: Electron.Input): boolean {
  return input.type === 'keyDown' && input.key === 'Escape' && !input.control && !input.meta && !input.alt && !input.shift
}

/** Minis in the menu bar (with a tab), in the order they went there. */
function menuBarMinis(): Mini[] {
  return liveMinis().filter((m) => m.menuBar && host().header(m.window)).sort((a, b) => (a.menuBar?.joinedAt ?? 0) - (b.menuBar?.joinedAt ?? 0))
}

function reducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return false
  }
}

/** The popout's page size (under its strip): the last one the user resized it to (read from the file once), else the default. */
let popoutSize: { width: number; height: number } | null | undefined
function menuBarSize(): { width: number; height: number } {
  if (popoutSize === undefined) popoutSize = parseMenuBarSaved(readUserJson(MINI_WINDOW_MENU_BAR_FILE)).size
  return popoutSize ?? MINI_MENU_BAR_DEFAULT_SIZE
}

function rememberPopoutSize(m: Mini): void {
  const [width = 0, height = 0] = m.window.getSize()
  if (width <= 0 || height <= 0) return
  // What is remembered is the page's size (the strip comes on top of it).
  popoutSize = menuBarPageSize({ width, height })
  scheduleMenuBarSave()
}

/** Write which pages live in the menu bar (never private ones) and the popout's size. */
function saveMenuBar(): void {
  if (menuBarSaveTimer) clearTimeout(menuBarSaveTimer)
  menuBarSaveTimer = null
  if (menuBarFrozen) return
  const urls = menuBarMinis().flatMap((m) => (host().header(m.window)?.private ? [] : tabsOf(m).map((tab) => tab.url)))
  menuBarSize()
  const next = { size: popoutSize ?? null, urls }
  const key = JSON.stringify(next)
  if (key === menuBarSavedKey) return
  // Nothing there and never was: no file at all.
  if (menuBarSavedKey === null && next.urls.length === 0 && !next.size && readUserJson(MINI_WINDOW_MENU_BAR_FILE) === null) return
  menuBarSavedKey = key
  writeUserJson(MINI_WINDOW_MENU_BAR_FILE, next)
}

/** A page navigated in a menu bar mini: save the new address once it settles. */
function scheduleMenuBarSave(): void {
  if (menuBarFrozen || menuBarSaveTimer) return
  menuBarSaveTimer = setTimeout(() => {
    menuBarSaveTimer = null
    saveMenuBar()
  }, MENU_BAR_SAVE_DELAY_MS)
}

const trayHost: MenuBarTrayHost = {
  mode: () => getMiniWindowSettings().menuBarIcon,
  entries: (): MenuBarTrayEntry[] => {
    const all = menuBarMinis()
    const current = pickMenuBarMini(all, lastMenuBar)
    return all.map((m) => {
      const info = host().header(m.window)
      const count = tabsOf(m).length
      const title = (info?.title || miniHeaderUrl(info?.url ?? '') || 'Mini Window') + (count > 1 ? ` (+${count - 1})` : '')
      return { key: m.slot, title, shown: m.menuBar?.popout.shown() === true, pinned: m.menuBar?.pinned === true, current: m === current }
    })
  },
  playing: () => menuBarMinis().some((m) => tabsOf(m).some((tab) => tab.playing)),
  click: (anchor) => trayClick(anchor),
  show: (key, anchor) => {
    const m = menuBarMinis().find((candidate) => candidate.slot === key)
    if (m) showPopout(m, anchor)
  },
  hide: (key) => {
    const m = menuBarMinis().find((candidate) => candidate.slot === key)
    if (m) hidePopout(m)
  },
  togglePin: (key) => {
    const m = menuBarMinis().find((candidate) => candidate.slot === key)
    if (m) togglePin(m)
  },
  returnToBrowser: (key) => {
    const m = menuBarMinis().find((candidate) => candidate.slot === key)
    if (m) returnAllOf(m)
  },
  moveToEdge: (key) => {
    const m = menuBarMinis().find((candidate) => candidate.slot === key)
    if (m) leaveMenuBar(m, 'edge')
  },
  canMoveToEdge: () => getMiniWindowSettings().tuckToEdge,
  sendCurrentTab: () => {
    const tabId = host().activeTabId()
    if (tabId) void popOutTabToMenuBar(tabId)
  },
  canSendCurrentTab: () => {
    const tabId = host().activeTabId()
    return Boolean(tabId && host().canPopOut(tabId))
  },
  openSettings: () => openMiniWindowSettings(),
  hideIcon: () => { updateMiniWindowSettings({ menuBarIcon: 'never' }) }
}

function syncTray(): void {
  syncMenuBarTray(trayHost)
}

/** The display the icon is on (the pointer's, when the icon has no bounds). */
function popoutPlacement(anchor: MiniRect | null, m: Mini): { bounds: MiniRect; side: 'below' | 'above' } {
  const cursor = screen.getCursorScreenPoint()
  const point = anchor ? { x: Math.round(anchor.x + anchor.width / 2), y: Math.round(anchor.y + anchor.height / 2) } : cursor
  const display = screen.getDisplayNearestPoint(point)
  const [width = 0, height = 0] = m.window.isVisible() ? m.window.getSize() : []
  // The strip adds to the remembered page size.
  const size = width > 0 && height > 0 ? { width, height } : menuBarWindowSize(menuBarSize())
  return menuBarPopoutBounds(anchor, cursor, size, { bounds: display.bounds, workArea: display.workArea })
}

/** Drop `m` in under the icon at `anchor` (one popout at a time; the others hide). */
function showPopout(m: Mini, anchor: MiniRect | null): void {
  if (!m.menuBar || m.closed || m.window.isDestroyed()) return
  for (const other of menuBarMinis()) if (other !== m) other.menuBar?.popout.close()
  lastMenuBar = m
  lastActive = m
  const { bounds, side } = popoutPlacement(anchor, m)
  m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
  m.menuBar.popout.open(bounds, side, true)
  syncTray()
}

function hidePopout(m: Mini): void {
  if (!m.menuBar?.popout.shown()) return
  setRevealed(m, false)
  m.menuBar.popout.close()
  syncTray()
}

/** A left click on the icon: hide what is shown, else drop in the last shown (not the click that just blurred it shut). */
function trayClick(anchor: MiniRect | null): void {
  const all = menuBarMinis()
  if (miniHeaderDebugEnabled()) headerDebug('tray', `click: ${all.length} menu bar mini(s), shown=${all.filter((m) => m.menuBar?.popout.shown()).map(miniLabel).join(', ') || 'none'}`)
  const shown = all.find((m) => m.menuBar?.popout.shown())
  if (shown) return hidePopout(shown)
  const pick = pickMenuBarMini(all, lastMenuBar)
  if (!pick?.menuBar) return
  if (pick.menuBar.popout.click() === 'show') showPopout(pick, anchor)
}

function togglePin(m: Mini): void {
  if (!m.menuBar) return
  m.menuBar.pinned = !m.menuBar.pinned
  refreshHeaderOf(m)
  syncTray()
}

/** Make `m` a menu bar mini: undocked (staying hidden), not movable, its header pushing instead of floating. `show`: drop it in under the icon. */
function enterMenuBar(m: Mini, show: boolean): void {
  if (m.menuBar || m.closed || m.window.isDestroyed()) return
  setRevealed(m, false)
  stopHeaderDrag(m)
  m.dock.release()
  const window = m.window
  m.menuBar = {
    pinned: false,
    menuOpen: false,
    menuClosedAt: Number.NEGATIVE_INFINITY,
    joinedAt: ++menuBarJoins,
    popout: createMenuBarPopout({
      now: () => performance.now(),
      loop: motion,
      place: (rect) => {
        m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
        placeWindow(window, rect)
      },
      setOpacity: process.platform === 'linux' ? null : (opacity) => { if (!window.isDestroyed()) window.setOpacity(opacity) },
      opacity: () => getMiniWindowSettings().opacity,
      show: (focus) => {
        if (window.isDestroyed()) return
        // Clicked on Space 1 with the browser on Space 2: it comes up here, and Surffish is never
        // activated for it (that would switch the user to the browser's Space).
        showFloatingPanel(window, focus, miniLabel(m))
        if (focus) host().pageContents(window)?.focus()
      },
      hide: () => { if (!window.isDestroyed() && window.isVisible()) window.hide() },
      reducedMotion
    })
  }
  if (window.isVisible()) window.hide()
  // Dragged around, the popout would leave the icon (resizing it is fine: the size is kept).
  window.setMovable(false)
  if (headerPlacement() === 'float') closePanel(m)
  layout(m)
  refreshHeaderOf(m)
  saveMenuBar()
  syncTray()
  if (show) void m.headerReady.then(() => showPopout(m, menuBarTrayBounds()))
}

/**
 * Put a mini window in the menu bar. 'tabs': into the menu bar collection when there is one (a
 * private page and a normal collection stay apart). Unavailable with the icon set to 'never'.
 */
function sendToMenuBar(m: Mini): boolean {
  if (m.closed || m.window.isDestroyed() || m.menuBar) return false
  if (getMiniWindowSettings().menuBarIcon === 'never') {
    host().notify('The menu bar icon is off (Settings → Mini window).')
    return false
  }
  if (grouping() === 'tabs') {
    const into = menuBarMinis().find((other) => other !== m)
    if (into && mergeInto(m, into, false)) {
      // Anything that couldn't come (private) gets a menu bar mini of its own.
      if (!m.closed && !m.window.isDestroyed() && tabsOf(m).length > 0) enterMenuBar(m, false)
      showPopout(into, menuBarTrayBounds())
      return true
    }
  }
  enterMenuBar(m, true)
  return true
}

/** One tab of a menu bar collection floats out into a window of its own. */
function floatTabOut(m: Mini, tabId: string): Mini | null {
  const n = splitOff(m, tabId, openingBounds(freeMiniSlot(liveMinis().map((other) => other.slot)) ?? 0), null)
  if (n) void finishOpen(n, true)
  return n
}

/** Out of the menu bar: back on screen as a floating mini ('float', where its slot was last), or tucked to the nearest edge ('edge'). */
function leaveMenuBar(m: Mini, how: 'float' | 'edge'): void {
  if (!m.menuBar || m.closed || m.window.isDestroyed()) return
  const window = m.window
  m.menuBar.popout.dispose()
  m.menuBar = null
  if (lastMenuBar === m) lastMenuBar = null
  setRevealed(m, false)
  window.setMovable(true)
  if (process.platform !== 'linux') window.setOpacity(getMiniWindowSettings().opacity)
  // Floating, the page fills the window again: without the popout's strip it keeps its size.
  const [windowWidth = 0, windowHeight = 0] = window.getSize()
  const { width, height } = menuBarPageSize({ width: windowWidth, height: windowHeight })
  const others = liveMinis().filter((other) => other !== m).map((other) => other.window.getBounds())
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const saved = readGeometry()[m.slot]?.[miniDisplayKey(display.workArea)]
  const bounds = cascadeMiniBounds(initialMiniBounds(display.workArea, saved ?? { ...window.getBounds(), width, height }), others, display.workArea)
  m.ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
  window.setBounds(bounds)
  layout(m)
  refreshHeaderOf(m)
  saveMenuBar()
  syncTray()
  if (how === 'edge' && getMiniWindowSettings().tuckToEdge) {
    // Docks to the nearest outer edge and slides in behind its handle (shown first so it slides from there).
    window.showInactive()
    if (IS_MAC) joinActiveSpace(window, miniLabel(m))
    m.dock.toggle(false)
  } else {
    present(m, true)
  }
}

/** A tab (from a browser window) straight into the menu bar ('tabs': into the menu bar collection). */
export async function popOutTabToMenuBar(tabId: string, options: { show?: boolean } = {}): Promise<boolean> {
  const show = options.show ?? true
  if (getMiniWindowSettings().menuBarIcon === 'never') {
    host().notify('The menu bar icon is off (Settings → Mini window).')
    return false
  }
  const existing = miniWithTab(tabId)
  if (existing) {
    host().activateTab(existing.window, tabId)
    if (existing.menuBar) {
      if (show) showPopout(existing, menuBarTrayBounds())
      return true
    }
    return sendToMenuBar(existing)
  }
  if (atCap()) return false
  if (grouping() === 'tabs') {
    const into = menuBarMinis().find((m) => host().adoptTab(tabId, m.window))
    if (into) {
      layout(into)
      refreshHeaderOf(into)
      if (show) showPopout(into, menuBarTrayBounds())
      return true
    }
  }
  const m = createMini()
  if (!m) return false
  if (!host().adoptTab(tabId, m.window)) {
    if (!host().header(m.window) && !m.window.isDestroyed()) m.window.close()
    return false
  }
  await m.headerReady
  if (m.closed) return false
  enterMenuBar(m, show)
  return true
}

/** Send the last used floating mini window to the menu bar (palette); false when there is none. */
export function sendCurrentToMenuBar(): boolean {
  const m = currentMini()
  return m ? sendToMenuBar(m) : false
}

/** After a restart: the pages that lived in the menu bar come back there (picked out of the restored tabs), and the icon shows when wanted. */
export async function startMenuBar(): Promise<void> {
  const { menuBarIcon } = getMiniWindowSettings()
  if (menuBarIcon !== 'never') {
    const { urls } = parseMenuBarSaved(readUserJson(MINI_WINDOW_MENU_BAR_FILE))
    for (const tabId of pickRestoredMenuBarTabs(urls, host().browserTabs())) await popOutTabToMenuBar(tabId, { show: false })
  }
  syncTray()
}

/** The Esc that closed the popout's ⋯ menu (or one right after it) closes only the menu, never the popout. */
function popoutMenuJustClosed(m: Mini): boolean {
  return Boolean(m.menuBar && (m.menuBar.menuOpen || Date.now() - m.menuBar.menuClosedAt < POPOUT_MENU_ESC_GRACE_MS))
}
const POPOUT_MENU_ESC_GRACE_MS = 250

/** The popout strip's ⋯ menu: everything the strip has no room for (a native menu: arrow keys, Esc closes it). */
function popoutMenuTemplate(m: Mini): Electron.MenuItemConstructorOptions[] {
  const page = host().pageContents(m.window)
  const many = tabsOf(m).length > 1
  const settings = getMiniWindowSettings()
  return [
    { label: 'Back', enabled: Boolean(page?.navigationHistory.canGoBack()), click: () => { if (page && !page.isDestroyed() && page.navigationHistory.canGoBack()) page.navigationHistory.goBack() } },
    { label: 'Reload', click: () => { if (page && !page.isDestroyed()) page.reload() } },
    { type: 'separator' },
    { label: 'Pin', type: 'checkbox', checked: m.menuBar?.pinned === true, click: () => togglePin(m) },
    { label: 'Float as Mini Window', click: () => leaveMenuBar(m, 'float') },
    { label: 'Move to Edge', enabled: settings.tuckToEdge, click: () => leaveMenuBar(m, 'edge') },
    { label: many ? 'Return All to Window' : 'Return to Window', click: () => { returnAllOf(m) } },
    {
      label: 'Grouping',
      submenu: ([['tabs', 'Tabs'], ['stack', 'Stack'], ['separate', 'Separate']] as const).map(([value, label]): Electron.MenuItemConstructorOptions => ({
        label, type: 'radio', checked: settings.grouping === value, click: () => { setMiniWindowGrouping(value) }
      }))
    },
    { type: 'separator' },
    { label: 'Mini Window Settings…', click: () => openMiniWindowSettings() }
  ]
}

let lastPopoutMenu: { template: Electron.MenuItemConstructorOptions[]; menu: Menu } | null = null

/** The ⋯ menu (or a right-click on the strip) at `at` in the window (the strip sits at its top left), else at the pointer. */
function showPopoutMenu(m: Mini, at: { x: number; y: number } | null): void {
  const bar = m.menuBar
  if (!bar || m.closed || m.window.isDestroyed()) return
  const template = popoutMenuTemplate(m)
  const menu = Menu.buildFromTemplate(template)
  lastPopoutMenu = { template, menu }
  bar.menuOpen = true
  const closed = (): void => {
    bar.menuOpen = false
    bar.menuClosedAt = Date.now()
    if (lastPopoutMenu?.menu === menu) lastPopoutMenu = null
    if (live(m.header?.webContents)) m.header?.webContents.send('mini-window:menu-closed')
  }
  menu.popup({ window: m.window, ...(at ? { x: at.x, y: at.y } : {}), callback: closed })
}

// Smokes can't drive a native menu under Xvfb: the ⋯ menu as it was built, and its items by label.
;(globalThis as { __surffishMiniPopoutMenu?: unknown }).__surffishMiniPopoutMenu = {
  open: () => lastPopoutMenu !== null,
  items: () => (lastPopoutMenu?.template ?? []).map((item) => ({ label: item.label ?? '', type: item.type ?? 'normal', checked: item.checked === true, enabled: item.enabled !== false, submenu: Array.isArray(item.submenu) ? item.submenu.map((sub) => sub.label ?? '') : [] })),
  click: (label: string): boolean => {
    const item = lastPopoutMenu?.template.find((candidate) => candidate.label === label)
    const menu = lastPopoutMenu?.menu
    if (!item?.click || item.enabled === false) return false
    menu?.closePopup()
    ;(item.click as () => void)()
    return true
  },
  close: (): void => { lastPopoutMenu?.menu.closePopup() }
}

/** The mini window's menu (right-click on its header or handle). */
function showMiniMenu(m: Mini, contents: WebContents | null): void {
  if (m.closed || m.window.isDestroyed()) return
  // In the menu bar popout, the strip's right-click is its ⋯ menu.
  if (m.menuBar && contents) return showPopoutMenu(m, null)
  const menuBarOn = getMiniWindowSettings().menuBarIcon !== 'never'
  const menu = Menu.buildFromTemplate([
    m.menuBar
      ? { label: 'Float as Mini Window', click: () => leaveMenuBar(m, 'float') }
      : { label: 'Send to Menu Bar', enabled: menuBarOn, click: () => { sendToMenuBar(m) } },
    ...(m.menuBar ? [{ label: 'Pin', type: 'checkbox' as const, checked: m.menuBar.pinned, click: () => togglePin(m) }, { label: 'Move to Edge', enabled: getMiniWindowSettings().tuckToEdge, click: () => leaveMenuBar(m, 'edge') }] : []),
    { type: 'separator' },
    { label: tabsOf(m).length > 1 ? 'Return All to Browser' : 'Return to Browser', click: () => { returnAllOf(m) } },
    { label: tabsOf(m).length > 1 ? 'Close Tab' : 'Close', click: () => host().closeTab(m.window) }
  ])
  const window = contents ? (m.mount === 'panel' && m.panel ? m.panel : m.window) : undefined
  menu.popup(window && !window.isDestroyed() ? { window } : {})
}
