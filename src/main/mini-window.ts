import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BaseWindow, Menu, WebContentsView, app, ipcMain, screen, systemPreferences, type Display, type IpcMainEvent, type WebContents } from 'electron'
import {
  MINI_WINDOW_CASCADE_STEP,
  MINI_WINDOW_GEOMETRY_FILE,
  MINI_WINDOW_HEADER_HEIGHT,
  MINI_WINDOW_MAX,
  MINI_WINDOW_MIN_SIZE,
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
  miniSplitBounds,
  miniTabDrop,
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
  menuBarPopoutBounds,
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
import { getMiniWindowHost, getMiniWindowSettings, openMiniWindowSettings, updateMiniWindowSettings, type MiniWindowHost, type MiniWindowTab, type MiniWindowTabAudio } from './mini-window-entry'
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
 * never docked or dragged there; 'float' headers push instead (no room above the menu bar). Hidden is
 * not closed. Which pages live there is saved (not private ones) and picked back out of the restored
 * tabs after a restart.
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
  /** Lives in the menu bar: shown as a popout under the icon (null: floating or docked). */
  menuBar: { popout: MenuBarPopout; pinned: boolean; joinedAt: number } | null
}

const IS_MAC = process.platform === 'darwin'
const HEADER_READY_TIMEOUT_MS = 3000
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

/** Where this window's header goes: in the menu bar's popout there is no room above it, so 'float' pushes. */
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
  m.plan = planMiniHeader(placementOf(m), bounds, headerHeight(m), workArea, m.dock.state()?.dock.edge ?? null, m.headerDrag?.side ?? null)
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
  if (IS_MAC) {
    panel.setAlwaysOnTop(true, 'floating')
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  } else {
    panel.setAlwaysOnTop(true)
  }
  if (process.platform !== 'linux') panel.setOpacity(getMiniWindowSettings().opacity)
  panel.on('closed', () => {
    if (m.panel !== panel) return
    m.panel = null
    // Closed under us: the header goes back on the next layout (into a new panel or the window).
    if (m.mount === 'panel') m.mount = null
  })
  m.panel = panel
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
    if (!panel.isDestroyed()) panel.contentView.removeChildView(m.header)
    m.mount = null
  }
  m.panel = null
  if (!panel.isDestroyed()) panel.close()
}

/** Attach the header view to the window or the panel (moving the view; the header page never reloads). */
function mountHeader(m: Mini, where: 'window' | 'panel'): void {
  if (!m.headerLoaded || m.mount === where || m.closed || m.window.isDestroyed()) return
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
    if (IS_MAC) panel.setAlwaysOnTop(true, 'floating')
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
  const tall = headerHeight(m)
  // The page fills the window; 'push' moves it under the revealed header, 'overlay' runs it under it.
  const page = miniPageBounds(m.plan.kind, m.revealed, m.size, tall)
  m.pageTop = page.y
  host().setPageBounds(m.window, page)
  if (floats(m.plan)) {
    mountHeader(m, 'panel')
    m.header.setBounds({ x: 0, y: 0, width, height: tall })
    positionPanel(m)
  } else {
    mountHeader(m, 'window')
    m.header.setBounds({ x: 0, y: 0, width, height: m.revealed ? tall : 0 })
    hidePanel(m)
  }
  rewirePage(m)
}

/** The revealed header: its row, plus the tab strip for a collection of two or more ('tabs'). */
function headerHeight(m: Mini): number {
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
  if (m.closed || m.revealed === revealed) return
  m.revealed = revealed
  cancelHide(m)
  if (revealed) {
    refreshHeaderOf(m)
    m.pollTimer ??= setInterval(() => pollPointer(m), POLL_MS)
  } else {
    stopPolling(m)
    stopHeaderDrag(m)
    m.hovered = false
    if (m.plan.kind === 'push') m.revealBlockedUntil = Date.now() + PUSH_REVEAL_COOLDOWN_MS
  }
  layout(m)
}

function scheduleHide(m: Mini): void {
  if (!m.revealed || m.hovered || m.hideTimer || m.headerDrag) return
  m.hideTimer = setTimeout(() => {
    m.hideTimer = null
    if (!m.hovered && !m.headerDrag) setRevealed(m, false)
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
  if (onWindow || onPanel || m.headerDrag) cancelHide(m)
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
      // In window coordinates ('push' moves the page under the header).
      if (inRevealZone(m, input.y + m.pageTop)) {
        if (m.revealed) cancelHide(m)
        else if (Date.now() >= m.revealBlockedUntil) setRevealed(m, true)
      } else {
        scheduleHide(m)
      }
    } else if (input.type === 'mouseLeave') {
      scheduleHide(m)
    }
  })
  // In the menu bar's popout, Esc hides it (the page still gets the key).
  onPage(m, contents, 'before-input-event', (_event: Electron.Event, input: Electron.Input) => {
    if (m.menuBar && isEscape(input)) hidePopout(m)
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

function sendHeaderState(m: Mini): void {
  const state = live(m.header.webContents) ? headerState(m) : null
  if (state) m.header.webContents.send('mini-window:state', state)
}

function refreshHeaderOf(m: Mini): void {
  if (m.closed || m.window.isDestroyed()) return
  rewirePage(m)
  const state = headerState(m)
  if (!state) return
  m.window.setTitle(state.title ? `${state.title} — Mini Window` : 'Mini Window')
  // The Window menu lists mini window tabs by title.
  const menuTitle = tabsOf(m).map((tab) => `${tab.tabId}\u0000${tab.title}`).join('\u0001')
  if (menuTitle !== m.menuTitle) {
    m.menuTitle = menuTitle
    notifyBrowserWindowsChanged()
  }
  // A tab joined or left while the header is up: the strip comes or goes.
  if (m.revealed && m.header.getBounds().height !== headerHeight(m)) layout(m)
  if (live(m.header.webContents)) m.header.webContents.send('mini-window:state', state)
  // 'stack': a group's handle shows every member's favicon.
  if (grouping() === 'stack') for (const other of liveMinis()) other.dock.refreshHandle()
  else m.dock.refreshHandle()
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
    dropTabOutside(m, tabId, { x: Math.round(x), y: Math.round(y) })
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
  ipcMain.on('mini-window:pin', (event) => {
    const m = fromHeader(event)
    if (m) togglePin(m)
  })
  ipcMain.on('mini-window:menu', (event) => {
    const m = fromHeader(event)
    if (m) showMiniMenu(m, m.header.webContents)
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
  const header = createHeaderView()
  const preload = preloadPath()
  if (!header || !preload) return null
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
  if (IS_MAC) {
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  } else {
    window.setAlwaysOnTop(true)
  }
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
      return [page, m.header.webContents].filter((contents): contents is WebContents => Boolean(contents && !contents.isDestroyed()))
    },
    busy: () => liveMinis().some((other) => other.headerDrag !== null || other.glide !== null),
    menu: () => showMiniMenu(m, null)
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
    glide: null,
    moveSamples: createVelocityTracker(),
    menuBar: null
  }
  self.mini = m
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
    else if (m.menuBar && isEscape(input)) hidePopout(m)
  })
  void header.ready.then(() => {
    if (m.closed || window.isDestroyed()) return
    m.headerLoaded = true
    layout(m)
    refreshHeaderOf(m)
  })
  // Hidden (Show/Hide, tucked away): the header goes with it (and a menu bar popout counts as hidden).
  window.on('hide', () => {
    setRevealed(m, false)
    if (m.menuBar?.popout.shown()) {
      m.menuBar.popout.close()
      syncTray()
    }
  })
  // In the menu bar: clicking anywhere else hides the popout, unless it is pinned.
  window.on('blur', () => {
    if (m.menuBar?.popout.blur(m.menuBar.pinned)) syncTray()
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
    cancelHide(m)
    stopPolling(m)
    stopHeaderDrag(m)
    stopThrow(m)
    if (m.geometryTimer) {
      clearTimeout(m.geometryTimer)
      m.geometryTimer = null
    }
    unwirePage(m)
    m.dock.dispose()
    const wasInMenuBar = m.menuBar !== null
    m.menuBar?.popout.dispose()
    m.menuBar = null
    // A closed BaseWindow doesn't destroy its views' webContents.
    if (live(header.view.webContents)) header.view.webContents.close()
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

/** A tab dragged out of `m`'s strip and let go at `point`: onto another window it moves there, elsewhere it splits off. */
function dropTabOutside(m: Mini, tabId: string, point: { x: number; y: number }): void {
  if (!tabsOf(m).some((tab) => tab.tabId === tabId)) return
  const drop = miniTabDrop(point, ownArea(m), tabsOf(m).length, othersOnScreen(m))
  if (drop.kind === 'merge') {
    if (tabsOf(m).find((tab) => tab.tabId === tabId)?.active) unwirePage(m)
    if (host().adoptTab(tabId, drop.into.mini.window)) {
      lastActive = drop.into.mini
      layout(drop.into.mini)
      refreshHeaderOf(drop.into.mini)
      present(drop.into.mini, true)
    }
    if (!m.closed && !m.window.isDestroyed()) refreshHeaderOf(m)
    return
  }
  if (drop.kind !== 'split') return
  const [width = 420, height = 620] = m.window.getSize()
  const n = splitOff(m, tabId, miniSplitBounds(point, { width, height }, screen.getDisplayNearestPoint(point).workArea), null)
  if (n) void finishOpen(n, true)
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
export function list(): Array<{ tabId: string; title: string; tucked: boolean; focused: boolean; menuBar: boolean }> {
  return liveMinis().flatMap((m) => {
    const focused = m.window.isFocused()
    const tucked = m.dock.isTucked() || (m.menuBar !== null && !m.menuBar.popout.shown())
    return tabsOf(m).map((tab) => ({ tabId: tab.tabId, title: tab.title || miniHeaderUrl(tab.url) || 'Mini Window', tucked, focused: focused && tab.active, menuBar: m.menuBar !== null }))
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

/** The popout's size: the last one the user resized it to (read from the file once), else the default. */
let popoutSize: { width: number; height: number } | null | undefined
function menuBarSize(): { width: number; height: number } {
  if (popoutSize === undefined) popoutSize = parseMenuBarSaved(readUserJson(MINI_WINDOW_MENU_BAR_FILE)).size
  return popoutSize ?? MINI_MENU_BAR_DEFAULT_SIZE
}

function rememberPopoutSize(m: Mini): void {
  const [width = 0, height = 0] = m.window.getSize()
  if (width <= 0 || height <= 0) return
  popoutSize = { width, height }
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
  const size = width > 0 && height > 0 ? { width, height } : menuBarSize()
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
        if (focus) {
          window.show()
          window.focus()
          host().pageContents(window)?.focus()
        } else {
          window.showInactive()
        }
        if (IS_MAC) window.setAlwaysOnTop(true, 'floating')
        else window.setAlwaysOnTop(true)
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
  const [width = 0, height = 0] = window.getSize()
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

/** The mini window's menu (right-click on its header or handle). */
function showMiniMenu(m: Mini, contents: WebContents | null): void {
  if (m.closed || m.window.isDestroyed()) return
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
