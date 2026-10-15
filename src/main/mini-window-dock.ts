import { BaseWindow, WebContentsView, ipcMain, screen, systemPreferences, type Display, type IpcMainEvent } from 'electron'
import { clampMiniBounds, miniDisplayKey, parseMiniSlots, withMiniSlot, type MiniRect } from '../shared/mini-window'
import {
  MINI_DOCK_RELEASE_DISTANCE,
  MINI_DOCK_SLIDE_MS,
  MINI_WINDOW_DOCK_FILE,
  distanceFromDockEdge,
  dockArrow,
  dockEdgeForDrop,
  dockEdgeSpan,
  dockFor,
  dockHandleAlong,
  dockHandleAt,
  dockHandleBounds,
  dockedBounds,
  dragDockOffset,
  nearestDockEdge,
  parseMiniDocks,
  reconcileDock,
  slideFrame,
  spreadDockHandles,
  type MiniDisplay,
  type MiniDock,
  type MiniDockEdge
} from '../shared/mini-window-dock'
import { MINI_WINDOW_HANDLE_HTML } from './mini-window-handle-page'
import { readUserJson, writeUserJson } from './user-json'

/**
 * Tuck to screen edge (part of the lazy mini-window chunk). Docked, the mini window sits flush with an
 * outer edge of its display; tucked, it slides past that edge and is hidden, leaving a small handle
 * tab: its own frameless, transparent, never-focused window (an NSPanel at the floating level on
 * every Space on macOS, always-on-top elsewhere). Clicking the handle slides the window back out;
 * dragging it moves both along the edge. Hiding a tucked window keeps its tab exactly as before
 * (still its window's active tab, so never slept/discarded/archived); only painting stops, and media
 * keeps playing.
 *
 * Several mini windows can dock at once, each with its own controller and handle. Handles tucked on
 * the same edge of the same display are spread along it so they never overlap (relayoutHandles), and
 * each window's dock is remembered in its own slot.
 */

const IS_MAC = process.platform === 'darwin'
const FRAME_MS = 16
/** Window moves for this long after we placed it ourselves are ours (Linux reports them late), not a user drop. */
const OWN_MOVE_GRACE_MS = 500
const DRAG_POLL_MS = 16
const DRAG_MAX_MS = 15_000
const PEEK_DELAY_MS = 250
const PEEK_POLL_MS = 200
const PEEK_LEAVE_MS = 600

export interface DockHost {
  window: BaseWindow
  /** Which remembered dock (per display) this window uses (mini-window.ts gives each open window its own). */
  slot: number
  preload: string
  /** The tab's favicon, shown on the handle. */
  faviconUrl(): string | null
  /** Give the page the keyboard (after sliding out from a click or the shortcut). */
  focusPage(): void
  /** Docked/tucked changed: refresh the header's tuck button. */
  changed(): void
  isTuckEnabled(): boolean
  isPeekEnabled(): boolean
}

export interface DockController {
  isDocked(): boolean
  isTucked(): boolean
  /** The edge the header's tuck button would use: the docked edge, else the nearest outer edge. */
  tuckEdge(): MiniDockEdge | null
  /** Window moves right now are ours (sliding/placing) or the window is tucked away: not a user drop. */
  ignoringMoves(): boolean
  /** Tuck (docking to the nearest edge first) or, when tucked, slide out. */
  toggle(focus: boolean): boolean
  slideOut(focus: boolean): void
  /** The user dropped the window: dock/tuck at an edge, re-flush, or undock. True when handled (skip corner snap). */
  afterDrop(): boolean
  /** The window moved or resized (the handle follows when out). */
  follow(): void
  /** Settings changed (tuck turned off undocks). */
  applySettings(): void
  refreshHandle(): void
  dispose(): void
}

function displayInfo(display: Display): MiniDisplay {
  return { bounds: display.bounds, workArea: display.workArea }
}

function allDisplays(): MiniDisplay[] {
  return screen.getAllDisplays().map(displayInfo)
}

function readDocks(): Array<Record<string, MiniDock>> {
  return parseMiniSlots(readUserJson(MINI_WINDOW_DOCK_FILE), parseMiniDocks)
}

function writeDock(slot: number, display: Display, dock: MiniDock | null): void {
  const all = readDocks()
  const record = { ...all[slot] }
  const key = miniDisplayKey(display.workArea)
  if (dock) record[key] = dock
  else if (key in record) delete record[key]
  else return
  writeUserJson(MINI_WINDOW_DOCK_FILE, withMiniSlot(all, slot, record))
}

/** The dock remembered for `slot` on `display`, still valid for a window of `size` there; null when none. */
export function savedDockFor(slot: number, display: Display, size: { width: number; height: number }): MiniDock | null {
  const saved = readDocks()[slot]?.[miniDisplayKey(display.workArea)]
  return saved ? reconcileDock(saved, size, displayInfo(display), allDisplays()) : null
}

function reducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return false
  }
}

function sameRect(a: MiniRect, b: MiniRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

interface Handle {
  window: BaseWindow
  view: WebContentsView
  ready: boolean
}

/** Peeking: the pointer rested on the handle (delay), then the window slid out until the pointer leaves it (poll). */
interface Peek {
  delay: ReturnType<typeof setTimeout> | null
  poll: ReturnType<typeof setInterval> | null
  lastInside: number
  out: boolean
}

interface HandleListener {
  handleContents: () => Electron.WebContents | null
  onClick: () => void
  onDrag: (active: boolean) => void
  onHover: (inside: boolean) => void
  /** Tucked and settled: its handle sits on the screen edge. Which display/edge, where it wants to be along it, and the work area. */
  onEdge: () => { key: string; edge: MiniDockEdge; desired: number; workArea: MiniRect } | null
  /** Move the handle along the edge (null: centred on its window again). */
  setAlong: (along: number | null) => void
}

const controllers = new Set<HandleListener>()
let ipcRegistered = false

/**
 * Spread the handles tucked on each display edge so they never overlap: each keeps its order by where
 * its window sits along the edge. Runs whenever a window tucks, slides out, moves along the edge,
 * undocks or closes, or the displays change.
 */
function relayoutHandles(): void {
  const groups = new Map<string, Array<{ controller: HandleListener; desired: number; edge: MiniDockEdge; workArea: MiniRect }>>()
  for (const controller of controllers) {
    const spot = controller.onEdge()
    if (!spot) {
      controller.setAlong(null)
      continue
    }
    const group = groups.get(spot.key) ?? []
    group.push({ controller, desired: spot.desired, edge: spot.edge, workArea: spot.workArea })
    groups.set(spot.key, group)
  }
  for (const group of groups.values()) {
    const first = group[0]
    if (!first) continue
    const [min, max] = dockEdgeSpan(first.workArea, first.edge)
    const positions = spreadDockHandles(group.map((entry) => entry.desired), min, max)
    group.forEach((entry, index) => entry.controller.setAlong(group.length > 1 ? positions[index] ?? null : null))
  }
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  const from = (event: IpcMainEvent): HandleListener | undefined => [...controllers].find((controller) => controller.handleContents() === event.sender)
  ipcMain.on('mini-window:handle-click', (event) => from(event)?.onClick())
  ipcMain.on('mini-window:handle-drag', (event, active: unknown) => from(event)?.onDrag(active === true))
  ipcMain.on('mini-window:handle-hover', (event, inside: unknown) => from(event)?.onHover(inside === true))
}

/** Dock state for one mini window. `initial`: open already docked (out) to this remembered edge. */
export function createDockController(host: DockHost, initial: { dock: MiniDock; display: Display } | null): DockController {
  registerIpc()
  const win = host.window
  let dock: MiniDock | null = initial?.dock ?? null
  let displayId: number | null = initial?.display.id ?? null
  let tucked = false
  let handle: Handle | null = null
  let slideTimer: ReturnType<typeof setInterval> | null = null
  let ownMoveUntil = 0
  let drag: { timer: ReturnType<typeof setInterval>; startCursor: { x: number; y: number }; startOffset: number; startedAt: number } | null = null
  let peek: Peek | null = null
  /** Tucked next to other handles on the same edge: its handle's place along the edge (relayoutHandles). */
  let along: number | null = null
  let disposed = false

  const alive = (): boolean => !disposed && !win.isDestroyed()

  function dockDisplay(): Display {
    const displays = screen.getAllDisplays()
    const byId = displays.find((display) => display.id === displayId)
    if (byId) return byId
    const bounds = win.getBounds()
    return screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) })
  }

  function size(): { width: number; height: number } {
    const [width = 420, height = 620] = win.getSize()
    return { width, height }
  }

  function setOwnBounds(rect: MiniRect): void {
    ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
    if (!sameRect(win.getBounds(), rect)) win.setBounds(rect)
  }

  // --- The handle window.

  function handleState(): { edge: MiniDockEdge; arrow: string; label: string; faviconUrl: string | null } | null {
    if (!dock) return null
    return { edge: dock.edge, arrow: dockArrow(dock.edge, tucked), label: tucked ? 'Show Mini Window' : 'Tuck Mini Window Away', faviconUrl: host.faviconUrl() }
  }

  function sendHandleState(): void {
    const state = handleState()
    if (state && handle?.ready && !handle.view.webContents.isDestroyed()) handle.view.webContents.send('mini-window:handle-state', state)
  }

  function ensureHandle(): Handle {
    if (handle && !handle.window.isDestroyed()) return handle
    const window = new BaseWindow({
      width: 20,
      height: 64,
      title: 'Mini Window Handle',
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
      window.setAlwaysOnTop(true, 'floating')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    } else {
      window.setAlwaysOnTop(true)
    }
    const view = new WebContentsView({
      webPreferences: { preload: host.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, transparent: true, disableWakeLocks: true }
    })
    view.setBackgroundColor('#00000000')
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    window.contentView.addChildView(view)
    const created: Handle = { window, view, ready: false }
    view.webContents.once('did-finish-load', () => {
      created.ready = true
      sendHandleState()
    })
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(MINI_WINDOW_HANDLE_HTML)}`).catch(() => undefined)
    window.on('closed', () => {
      if (!view.webContents.isDestroyed()) view.webContents.close()
      if (handle === created) handle = null
    })
    handle = created
    return created
  }

  function closeHandle(): void {
    const current = handle
    handle = null
    if (current && !current.window.isDestroyed()) current.window.close()
  }

  /** Put the handle on the inner edge of a window at `rect`, and show it. */
  function placeHandle(rect: MiniRect): void {
    if (!dock) return
    const h = ensureHandle()
    // Settled on the screen edge beside other tucked handles: at its spread-out place along it.
    const bounds = tucked && along !== null && !slideTimer && !drag ? dockHandleAt(rect, dock.edge, along) : dockHandleBounds(rect, dock.edge)
    h.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    if (!sameRect(h.window.getBounds(), bounds)) h.window.setBounds(bounds)
    if (!h.window.isVisible()) h.window.showInactive()
    // Some window managers drop the level while a window is hidden.
    if (IS_MAC) h.window.setAlwaysOnTop(true, 'floating')
    sendHandleState()
  }

  // --- Sliding.

  function stopSlide(): void {
    if (slideTimer) clearInterval(slideTimer)
    slideTimer = null
  }

  function slide(from: MiniRect, to: MiniRect, done: () => void): void {
    stopSlide()
    ownMoveUntil = Number.POSITIVE_INFINITY
    const finish = (): void => {
      stopSlide()
      if (!alive()) return
      setOwnBounds(to)
      placeHandle(to)
      done()
    }
    if (reducedMotion() || sameRect(from, to)) return finish()
    const start = Date.now()
    slideTimer = setInterval(() => {
      if (!alive()) return stopSlide()
      const t = (Date.now() - start) / MINI_DOCK_SLIDE_MS
      if (t >= 1) return finish()
      const frame = slideFrame(from, to, t)
      win.setBounds(frame)
      placeHandle(frame)
    }, FRAME_MS)
  }

  function remember(): void {
    if (dock) writeDock(host.slot, dockDisplay(), dock)
  }

  function dockTo(edge: MiniDockEdge, display: Display): void {
    dock = dockFor(win.getBounds(), edge, display.workArea)
    displayId = display.id
    remember()
  }

  function tuck(): boolean {
    if (!alive() || !host.isTuckEnabled()) return false
    if (!dock) {
      const bounds = win.getBounds()
      const display = screen.getDisplayMatching(bounds)
      const edge = nearestDockEdge(bounds, displayInfo(display), allDisplays())
      if (!edge) return false
      dockTo(edge, display)
    }
    stopPeek()
    const current = dock
    if (!current) return false
    tucked = true
    const wa = dockDisplay().workArea
    const from = win.isVisible() ? win.getBounds() : dockedBounds(size(), current, wa, true)
    slide(from, dockedBounds(size(), current, wa, true), () => {
      // Off-screen and hidden: no painting, no stray pixels on a neighbouring display. The tab stays put.
      if (tucked && win.isVisible()) win.hide()
      relayoutHandles()
      host.changed()
    })
    host.changed()
    return true
  }

  function slideOut(focus: boolean): void {
    if (!alive() || !dock) return
    if (!tucked && win.isVisible() && !slideTimer) {
      if (focus) host.focusPage()
      return
    }
    tucked = false
    const wa = dockDisplay().workArea
    const target = dockedBounds(size(), dock, wa, false)
    const from = win.isVisible() ? win.getBounds() : dockedBounds(size(), dock, wa, true)
    if (!win.isVisible()) {
      setOwnBounds(from)
      win.showInactive()
    }
    if (IS_MAC) win.setAlwaysOnTop(true, 'floating')
    else win.setAlwaysOnTop(true)
    along = null
    relayoutHandles()
    slide(from, target, () => {
      if (focus && !tucked) host.focusPage()
      host.changed()
    })
    host.changed()
  }

  function undock(): void {
    if (!dock) return
    const display = dockDisplay()
    stopPeek()
    stopDrag()
    stopSlide()
    const wasTucked = tucked
    tucked = false
    writeDock(host.slot, display, null)
    dock = null
    displayId = null
    closeHandle()
    relayoutHandles()
    if (wasTucked && alive()) {
      // Bring it back on screen where it was along the edge.
      setOwnBounds(clampMiniBounds(win.getBounds(), display.workArea))
      win.showInactive()
    }
    host.changed()
  }

  // --- Handle input.

  function stopDrag(): void {
    if (drag) clearInterval(drag.timer)
    drag = null
  }

  function onDrag(active: boolean): void {
    if (!alive() || !dock) return
    if (!active) {
      stopDrag()
      remember()
      // Dropped: settle beside the other handles on this edge (in its new order).
      relayoutHandles()
      return
    }
    stopDrag()
    stopPeek()
    const startedAt = Date.now()
    drag = {
      startCursor: screen.getCursorScreenPoint(),
      startOffset: dock.offset,
      startedAt,
      timer: setInterval(() => {
        if (!alive() || !dock || !drag || Date.now() - drag.startedAt > DRAG_MAX_MS) return onDrag(false)
        const cursor = screen.getCursorScreenPoint()
        const horizontal = dock.edge === 'top' || dock.edge === 'bottom'
        const delta = horizontal ? cursor.x - drag.startCursor.x : cursor.y - drag.startCursor.y
        const { width, height } = size()
        const wa = dockDisplay().workArea
        const offset = dragDockOffset(drag.startOffset, delta, horizontal ? width : height, dock.edge, wa)
        if (offset === dock.offset) return
        dock = { ...dock, offset }
        const rect = dockedBounds(size(), dock, wa, tucked)
        setOwnBounds(rect)
        placeHandle(rect)
        // The others on this edge make room (and swap places as it passes them).
        if (tucked) relayoutHandles()
      }, DRAG_POLL_MS)
    }
  }

  function onClick(): void {
    if (!alive() || !dock) return
    if (peek?.out) {
      // Peeking out and clicked: keep it out.
      stopPeek()
      host.focusPage()
      return
    }
    if (tucked) slideOut(true)
    else tuck()
  }

  function stopPeek(): void {
    if (peek?.delay) clearTimeout(peek.delay)
    if (peek?.poll) clearInterval(peek.poll)
    peek = null
  }

  function onHover(inside: boolean): void {
    if (!alive() || !dock || !host.isPeekEnabled()) return
    if (!inside) {
      if (peek && !peek.out) stopPeek()
      return
    }
    if (!tucked || peek || drag) return
    const state: Peek = { delay: null, poll: null, lastInside: Date.now(), out: false }
    peek = state
    state.delay = setTimeout(() => {
      state.delay = null
      if (peek !== state || !tucked) return
      state.out = true
      slideOut(false)
      state.poll = setInterval(() => {
        if (peek !== state || !alive()) return
        const point = screen.getCursorScreenPoint()
        const inRect = (r: MiniRect): boolean => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height
        const handleRect = handle && !handle.window.isDestroyed() ? handle.window.getBounds() : null
        if (inRect(win.getBounds()) || (handleRect && inRect(handleRect))) state.lastInside = Date.now()
        else if (Date.now() - state.lastInside > PEEK_LEAVE_MS) tuck()
      }, PEEK_POLL_MS)
    }, PEEK_DELAY_MS)
  }

  const registration: HandleListener = {
    handleContents: () => (handle && !handle.view.webContents.isDestroyed() ? handle.view.webContents : null),
    onClick,
    onDrag,
    onHover,
    onEdge: () => {
      if (!alive() || !dock || !tucked || slideTimer) return null
      const display = dockDisplay()
      const rect = dockedBounds(size(), dock, display.workArea, true)
      // The one being dragged stays under the pointer; the rest arrange around it.
      return { key: `${display.id}:${dock.edge}`, edge: dock.edge, desired: dockHandleAlong(rect, dock.edge), workArea: display.workArea }
    },
    setAlong: (next) => {
      const settled = next === null || drag ? null : next
      if (settled === along) return
      along = settled
      if (alive() && dock && tucked && !slideTimer && handle && !handle.window.isDestroyed()) placeHandle(dockedBounds(size(), dock, dockDisplay().workArea, true))
    }
  }
  controllers.add(registration)

  // Focusing the window (a click inside it) ends a peek: it stays out.
  const onFocus = (): void => { if (peek?.out) stopPeek() }
  win.on('focus', onFocus)
  // Shown while docked and out (pop out, shortcut): the handle comes with it.
  const onShow = (): void => {
    if (dock && !tucked && !slideTimer) placeHandle(win.getBounds())
  }
  win.on('show', onShow)

  // --- Displays changing under a docked window: re-clamp to a valid edge, or undock.
  const onDisplays = (): void => {
    if (!alive() || !dock) return
    stopDrag()
    stopSlide()
    const display = dockDisplay()
    const next = reconcileDock(dock, size(), displayInfo(display), allDisplays())
    if (!next) return undock()
    dock = next
    displayId = display.id
    const rect = dockedBounds(size(), dock, display.workArea, tucked)
    setOwnBounds(rect)
    placeHandle(rect)
    remember()
    relayoutHandles()
  }
  screen.on('display-added', onDisplays)
  screen.on('display-removed', onDisplays)
  screen.on('display-metrics-changed', onDisplays)

  return {
    isDocked: () => dock !== null,
    isTucked: () => dock !== null && tucked,
    tuckEdge: () => {
      if (!alive() || !host.isTuckEnabled()) return null
      if (dock) return dock.edge
      const bounds = win.getBounds()
      return nearestDockEdge(bounds, displayInfo(screen.getDisplayMatching(bounds)), allDisplays())
    },
    ignoringMoves: () => tucked || slideTimer !== null || drag !== null || Date.now() < ownMoveUntil,
    toggle: (focus) => {
      if (dock && tucked) {
        slideOut(focus)
        return true
      }
      return tuck()
    },
    slideOut,
    afterDrop: () => {
      if (!alive() || tucked || slideTimer) return false
      if (!host.isTuckEnabled()) return false
      const bounds = win.getBounds()
      const display = screen.getDisplayMatching(bounds)
      const edge = dockEdgeForDrop(bounds, screen.getCursorScreenPoint(), displayInfo(display), allDisplays())
      if (edge) {
        dockTo(edge, display)
        tuck()
        return true
      }
      if (!dock) return false
      const home = dockDisplay()
      if (home.id === display.id && distanceFromDockEdge(bounds, dock.edge, home.workArea) <= MINI_DOCK_RELEASE_DISTANCE) {
        // Nudged along the edge: stay docked there.
        dockTo(dock.edge, home)
        const rect = dockedBounds(size(), dock, home.workArea, false)
        setOwnBounds(rect)
        placeHandle(rect)
        return true
      }
      undock()
      return false
    },
    follow: () => {
      if (!alive() || !dock || tucked || slideTimer || drag) return
      if (win.isVisible()) placeHandle(win.getBounds())
    },
    applySettings: () => {
      if (!host.isTuckEnabled()) undock()
      else if (!host.isPeekEnabled()) stopPeek()
      host.changed()
    },
    refreshHandle: sendHandleState,
    dispose: () => {
      if (disposed) return
      stopSlide()
      stopDrag()
      stopPeek()
      disposed = true
      controllers.delete(registration)
      relayoutHandles()
      screen.removeListener('display-added', onDisplays)
      screen.removeListener('display-removed', onDisplays)
      screen.removeListener('display-metrics-changed', onDisplays)
      if (!win.isDestroyed()) {
        win.removeListener('focus', onFocus)
        win.removeListener('show', onShow)
      }
      closeHandle()
    }
  }
}
