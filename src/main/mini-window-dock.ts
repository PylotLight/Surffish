import { BaseWindow, WebContentsView, ipcMain, screen, systemPreferences, type Display, type IpcMainEvent, type WebContents } from 'electron'
import { clampMiniBounds, miniDisplayKey, parseMiniSlots, withMiniSlot, type MiniRect, type MiniWindowGrouping } from '../shared/mini-window'
import {
  MINI_DOCK_RELEASE_DISTANCE,
  MINI_DOCK_SLIDE_MS,
  MINI_WINDOW_DOCK_FILE,
  distanceFromDockEdge,
  dockArrow,
  dockEdgeForDrop,
  dockEdgeSpan,
  dockFor,
  dockGroupKey,
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
  stackDockOffsets,
  type MiniDisplay,
  type MiniDock,
  type MiniDockEdge
} from '../shared/mini-window-dock'
import { createPeekDriver, type PeekDriver, type PeekPoint } from '../shared/mini-window-peek'
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
 *
 * Grouping 'stack' (setDockGrouping): windows docked to the same edge of the same display form a
 * group in the order they docked there. Only the first one (the leader) shows a handle, with the
 * group's favicons and count; its click / the shortcut / the header button tucks or slides out the
 * whole group, stacked along the edge (stackDockOffsets); dragging the leader along the edge moves
 * the others with it. Dragging one away undocks it (it leaves the group); docking one to that edge
 * joins it. With 'tabs' or 'separate' each window is its own group of one (as before).
 */

const IS_MAC = process.platform === 'darwin'
const FRAME_MS = 16
/** Window moves for this long after we placed it ourselves are ours (Linux reports them late), not a user drop. */
const OWN_MOVE_GRACE_MS = 500
const DRAG_POLL_MS = 16
const DRAG_MAX_MS = 15_000

export interface DockHost {
  window: BaseWindow
  /** Which remembered dock (per display) this window uses (mini-window.ts gives each open window its own). */
  slot: number
  preload: string
  /** The tab's favicon, shown on the handle. */
  faviconUrl(): string | null
  /** How many tabs the window holds (grouping 'tabs': the handle's count badge). */
  tabCount(): number
  /** Give the page the keyboard (after sliding out from a click or the shortcut). */
  focusPage(): void
  /** Docked/tucked changed: refresh the header's tuck button. */
  changed(): void
  isTuckEnabled(): boolean
  isPeekEnabled(): boolean
  /** Hover delay before a tucked handle peeks (Settings). */
  peekDelayMs(): number
  /** Extra on-screen parts that keep a peek out (the floating header panel while it shows). */
  peekRects(): MiniRect[]
  /** The window's web contents (page, header): a click or key in any of them pins a peek out. */
  peekContents(): WebContents[]
  /** Something is being dragged (a mini window by its floating header): no peek starts. */
  busy(): boolean
}

export interface DockController {
  isDocked(): boolean
  isTucked(): boolean
  /** The edge the header's tuck button would use: the docked edge, else the nearest outer edge. */
  tuckEdge(): MiniDockEdge | null
  /** Window moves right now are ours (sliding/placing) or the window is tucked away: not a user drop. */
  ignoringMoves(): boolean
  /** Tuck (docking to the nearest edge first) or, when tucked, slide out (its whole group, with 'stack'). */
  toggle(focus: boolean): boolean
  /** Slide out (its whole group, stacked, with 'stack'). */
  slideOut(focus: boolean): void
  /** Docked and out: tuck away (its whole group with 'stack'); otherwise nothing. */
  tuckAway(): void
  /** Docked: `displayId:edge` (the group it belongs to with 'stack'; the edge a collection holds with 'tabs'), else null. */
  groupKey(): string | null
  /** Where it is docked, for a window that should join it (a tab split off a docked collection). */
  state(): { dock: MiniDock; display: Display; tucked: boolean } | null
  /** Grouping changed: regroup handles; a group that is out re-stacks. */
  regroup(): void
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

interface HandleListener {
  /** Joined its current edge (group order with 'stack': the first one leads). */
  joinedAt: () => number
  key: () => string | null
  tucked: () => boolean
  /** Docked and on screen (out). */
  out: () => boolean
  /** Window length along its docked edge, and the work area's. */
  length: () => number
  room: () => number
  offset: () => number
  favicon: () => string | null
  tuckOne: () => boolean
  /** Slide out (to `offset` along the edge when given), or move there when already out. */
  slideOutOne: (focus: boolean, offset?: number) => void
  /** Out: jump to `offset` along the edge (following its leader being dragged). */
  placeOut: (offset: number) => void
  bounds: () => MiniRect
  /** The group's handle is this one's (leader / alone), or none (a follower). */
  syncRole: () => void
  handleContents: () => Electron.WebContents | null
  onClick: () => void
  onDrag: (active: boolean) => void
  onHover: (inside: boolean) => void
  /** Sliding right now (a 'stack' group peeks only once all of it has settled). */
  sliding: () => boolean
  /** What keeps a peek out: its window and floating header while out. */
  peekRects: () => MiniRect[]
  peekContents: () => WebContents[]
  /** A click/key inside one of the group's windows: the group's peek (run by its leader) stays out. */
  pinPeek: () => void
  /** Tucked and settled: its handle sits on the screen edge. Which display/edge, where it wants to be along it, and the work area. */
  onEdge: () => { key: string; edge: MiniDockEdge; desired: number; workArea: MiniRect } | null
  /** Move the handle along the edge (null: centred on its window again). */
  setAlong: (along: number | null) => void
}

const controllers = new Set<HandleListener>()
let ipcRegistered = false
let dockGrouping: () => MiniWindowGrouping = () => 'separate'
let joinCounter = 0

/** mini-window.ts: where the grouping setting comes from. */
export function setDockGrouping(source: () => MiniWindowGrouping): void {
  dockGrouping = source
}

/** Its 'stack' group (docked to the same display edge) in the order they joined; alone otherwise. */
function groupOf(member: HandleListener): HandleListener[] {
  const key = member.key()
  if (!key || dockGrouping() !== 'stack') return [member]
  return [...controllers].filter((other) => other.key() === key).sort((a, b) => a.joinedAt() - b.joinedAt())
}

function isFollower(member: HandleListener): boolean {
  return groupOf(member)[0] !== member
}

function tuckGroup(member: HandleListener): boolean {
  let any = false
  for (const other of groupOf(member)) any = other.tuckOne() || any
  return any
}

/** Slide the group out stacked along its edge from the leader's place; `focus` goes to `member`. */
function slideOutGroup(member: HandleListener, focus: boolean): void {
  const group = groupOf(member)
  const leader = group[0]
  if (group.length < 2 || !leader) return member.slideOutOne(focus)
  const offsets = stackDockOffsets(group.map((other) => other.length()), leader.offset(), leader.room())
  group.forEach((other, index) => other.slideOutOne(focus && other === member, offsets[index]))
}

/** The leader moved (dragged by its header or handle) while out: the rest of its group follows along the edge. */
function followLeader(leader: HandleListener, start: number): void {
  const group = groupOf(leader)
  if (group.length < 2 || group[0] !== leader) return
  const offsets = stackDockOffsets(group.map((other) => other.length()), start, leader.room())
  group.forEach((other, index) => { if (other !== leader && other.out()) other.placeOut(offsets[index] ?? 0) })
}

/**
 * Spread the handles tucked on each display edge so they never overlap: each keeps its order by where
 * its window sits along the edge. Runs whenever a window tucks, slides out, moves along the edge,
 * undocks or closes, or the displays change.
 */
function relayoutHandles(): void {
  // Who shows a handle ('stack': one per group) first, then spread what's on each edge.
  for (const controller of controllers) controller.syncRole()
  const groups = new Map<string, Array<{ controller: HandleListener; desired: number; edge: MiniDockEdge; workArea: MiniRect }>>()
  for (const controller of controllers) {
    const spot = isFollower(controller) ? null : controller.onEdge()
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
  /** Hover peek (shared/mini-window-peek.ts): dwell on the tucked handle, slide out, tuck after the pointer leaves. */
  let peek: PeekDriver | null = null
  /** While peeked: input listeners on the group's contents that pin it out. */
  let pinWatch: Array<{ contents: WebContents; listener: (event: Electron.Event, input: Electron.InputEvent) => void }> = []
  /** Tucked next to other handles on the same edge: its handle's place along the edge (relayoutHandles). */
  let along: number | null = null
  let disposed = false
  /** When it docked to its current edge ('stack' group order). */
  let joinedAt = initial ? ++joinCounter : 0

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

  function handleState(): { edge: MiniDockEdge; arrow: string; label: string; faviconUrl: string | null; favicons: Array<string | null>; count: number; stacked: boolean } | null {
    if (!dock) return null
    const group = groupOf(registration)
    const stacked = group.length > 1
    // 'stack': the group's windows; 'tabs': the collection's tabs; otherwise just this one.
    const count = stacked ? group.length : Math.max(1, host.tabCount())
    const what = stacked ? `${count} Mini Windows` : count > 1 ? `Mini Window (${count} tabs)` : 'Mini Window'
    return {
      edge: dock.edge,
      arrow: dockArrow(dock.edge, tucked),
      label: tucked ? `Show ${what}` : `Tuck ${what} Away`,
      faviconUrl: host.faviconUrl(),
      favicons: stacked ? group.slice(0, 3).map((member) => member.favicon()) : [host.faviconUrl()],
      count,
      stacked
    }
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
    // 'stack': the group shares its leader's handle.
    if (isFollower(registration)) return closeHandle()
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
    const before = groupKey()
    dock = dockFor(win.getBounds(), edge, display.workArea)
    displayId = display.id
    if (groupKey() !== before) joinedAt = ++joinCounter
    remember()
  }

  function groupKey(): string | null {
    return dock ? dockGroupKey(displayId ?? dockDisplay().id, dock.edge) : null
  }

  function alongEdge(rect: MiniRect): number {
    if (!dock) return 0
    const wa = dockDisplay().workArea
    return dock.edge === 'top' || dock.edge === 'bottom' ? rect.x - wa.x : rect.y - wa.y
  }

  /** Dock to the nearest edge if needed, then tuck (with its group). */
  function tuck(): boolean {
    if (!alive() || !host.isTuckEnabled()) return false
    if (!dock) {
      const bounds = win.getBounds()
      const display = screen.getDisplayMatching(bounds)
      const edge = nearestDockEdge(bounds, displayInfo(display), allDisplays())
      if (!edge) return false
      dockTo(edge, display)
    }
    return tuckGroup(registration)
  }

  function tuckOne(): boolean {
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
    slideOutGroup(registration, focus)
  }

  function slideOutOne(focus: boolean, offset?: number): void {
    if (!alive() || !dock) return
    const wa = dockDisplay().workArea
    if (offset !== undefined && offset !== dock.offset) {
      dock = { ...dock, offset }
      remember()
    }
    const target = dockedBounds(size(), dock, wa, false)
    if (!tucked && win.isVisible() && !slideTimer && sameRect(win.getBounds(), target)) {
      if (focus) host.focusPage()
      return
    }
    tucked = false
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
        // A stack that is out moves with its leader.
        else followLeader(registration, offset)
      }, DRAG_POLL_MS)
    }
  }

  function onClick(): void {
    if (!alive() || !dock) return
    if (peek?.phase() === 'out') {
      // Peeking out and clicked: keep it out.
      peek.pin()
      host.focusPage()
      return
    }
    stopPeek()
    if (tucked) slideOut(true)
    else tuckGroup(registration)
  }

  function stopPeek(): void {
    peek?.cancel()
  }

  function within(point: PeekPoint, r: MiniRect): boolean {
    return point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height
  }

  function handleRect(): MiniRect | null {
    return handle && !handle.window.isDestroyed() && handle.window.isVisible() ? handle.window.getBounds() : null
  }

  function unwatchPins(): void {
    for (const { contents, listener } of pinWatch) if (!contents.isDestroyed()) contents.removeListener('input-event', listener)
    pinWatch = []
  }

  /** Peeked out: a click or key press in any window of the group pins it (focus does too, see onFocus). */
  function watchPins(): void {
    unwatchPins()
    const listener = (_event: Electron.Event, input: Electron.InputEvent): void => {
      if (input.type === 'mouseDown' || input.type === 'keyDown' || input.type === 'rawKeyDown') peek?.pin()
    }
    for (const member of groupOf(registration)) {
      for (const contents of member.peekContents()) {
        if (contents.isDestroyed()) continue
        contents.on('input-event', listener)
        pinWatch.push({ contents, listener })
      }
    }
  }

  function ensurePeek(): PeekDriver {
    if (peek) return peek
    peek = createPeekDriver({
      now: () => Date.now(),
      cursor: () => screen.getCursorScreenPoint(),
      overHandle: (point) => {
        const rect = handleRect()
        return Boolean(rect && within(point, rect))
      },
      // 'stack': any window of the group (or its floating header) keeps it out.
      overWindow: (point) => groupOf(registration).some((member) => member.peekRects().some((rect) => within(point, rect))),
      blocked: () => !alive() || !dock || !tucked || drag !== null || host.busy() || groupOf(registration).some((member) => member.sliding()),
      enabled: () => alive() && dock !== null && host.isTuckEnabled() && host.isPeekEnabled(),
      delayMs: () => host.peekDelayMs(),
      slideOut: () => {
        if (!alive() || !tucked) return
        slideOut(false)
        watchPins()
      },
      tuck: () => {
        if (alive() && dock && !tucked) tuckGroup(registration)
      },
      ended: unwatchPins,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>)
    })
    return peek
  }

  function onHover(inside: boolean): void {
    if (!alive() || !dock) return
    if (!inside) return peek?.leave()
    // Only a settled, tucked handle peeks (not mid-drag; a held button never reports inside).
    if (!tucked || drag || !host.isPeekEnabled()) return
    ensurePeek().enter()
  }

  function syncRole(): void {
    if (!alive() || !dock) return
    if (isFollower(registration)) return closeHandle()
    if (slideTimer || drag) return sendHandleState()
    if (tucked) placeHandle(dockedBounds(size(), dock, dockDisplay().workArea, true))
    else if (win.isVisible()) placeHandle(win.getBounds())
  }

  const registration: HandleListener = {
    joinedAt: () => joinedAt,
    key: groupKey,
    tucked: () => dock !== null && tucked,
    out: () => alive() && dock !== null && !tucked && win.isVisible(),
    length: () => {
      const { width, height } = size()
      return dock?.edge === 'top' || dock?.edge === 'bottom' ? width : height
    },
    room: () => {
      const wa = dockDisplay().workArea
      return dock?.edge === 'top' || dock?.edge === 'bottom' ? wa.width : wa.height
    },
    offset: () => dock?.offset ?? 0,
    favicon: () => host.faviconUrl(),
    tuckOne: () => tuckOne(),
    slideOutOne: (focus, offset) => slideOutOne(focus, offset),
    placeOut: (offset) => {
      if (!alive() || !dock || tucked || slideTimer || drag) return
      dock = { ...dock, offset }
      const rect = dockedBounds(size(), dock, dockDisplay().workArea, false)
      setOwnBounds(rect)
      placeHandle(rect)
    },
    bounds: () => (alive() ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 }),
    syncRole,
    handleContents: () => (handle && !handle.view.webContents.isDestroyed() ? handle.view.webContents : null),
    onClick,
    onDrag,
    onHover,
    sliding: () => slideTimer !== null,
    peekRects: () => (alive() && win.isVisible() ? [win.getBounds(), ...host.peekRects()] : []),
    peekContents: () => (alive() ? host.peekContents() : []),
    pinPeek: () => { if (peek?.phase() === 'out') peek.pin() },
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

  // Focusing the window (a click inside it) pins a peek out ('stack': the group's peek, run by its leader).
  const onFocus = (): void => { for (const member of groupOf(registration)) member.pinPeek() }
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
    const before = groupKey()
    dock = next
    displayId = display.id
    if (groupKey() !== before) joinedAt = ++joinCounter
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
    tuckAway: () => {
      if (alive() && dock && !tucked) tuckGroup(registration)
    },
    groupKey,
    state: () => (alive() && dock ? { dock: { ...dock }, display: dockDisplay(), tucked } : null),
    regroup: () => {
      relayoutHandles()
      // A 'stack' group that is out closes up along its edge.
      if (alive() && dock && !tucked && dockGrouping() === 'stack' && !isFollower(registration) && groupOf(registration).length > 1) slideOut(false)
    },
    afterDrop: () => {
      if (!alive() || tucked || slideTimer) return false
      if (!host.isTuckEnabled()) return false
      const bounds = win.getBounds()
      const display = screen.getDisplayMatching(bounds)
      const edge = dockEdgeForDrop(bounds, screen.getCursorScreenPoint(), displayInfo(display), allDisplays())
      if (edge) {
        dockTo(edge, display)
        // 'stack': it joins the group on that edge (out with it when the group is out).
        const others = groupOf(registration).filter((member) => member !== registration)
        if (others.length > 0 && others.every((member) => member.out())) slideOut(false)
        else tuck()
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
        // 'stack': the group closes up behind its leader (a follower nudged out of line goes back into it).
        if (groupOf(registration).length > 1) slideOut(false)
        return true
      }
      undock()
      return false
    },
    follow: () => {
      if (!alive() || !dock || tucked || slideTimer || drag) return
      if (!win.isVisible()) return
      const bounds = win.getBounds()
      placeHandle(bounds)
      // 'stack': the leader dragged by its header; the rest of the group comes along the edge.
      followLeader(registration, alongEdge(bounds))
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
      unwatchPins()
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
