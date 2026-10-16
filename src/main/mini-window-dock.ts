import { BaseWindow, WebContentsView, ipcMain, screen, systemPreferences, type Display, type IpcMainEvent, type WebContents } from 'electron'
import { clampMiniBounds, miniDisplayKey, parseMiniSlots, withMiniSlot, type MiniRect, type MiniWindowGrouping } from '../shared/mini-window'
import {
  MINI_DOCK_HANDLE_LENGTH,
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
  isOuterEdge,
  nearestDockEdge,
  parseMiniDocks,
  reconcileDock,
  spreadDockHandles,
  stackDockOffsets,
  type MiniDisplay,
  type MiniDock,
  type MiniDockEdge
} from '../shared/mini-window-dock'
import { createPeekDriver, type PeekDriver, type PeekPoint } from '../shared/mini-window-peek'
import { frameClock, lerpRect, motionDuration } from '../shared/mini-window-motion'
import { createVelocityTracker, flingAlong, flingSlideMs, flingTuckEdge, glideAxisAt, planEdgeGlide, releaseVelocity, type ThrowVelocity, type VelocityTracker } from '../shared/mini-window-throw'
import { MINI_WINDOW_HANDLE_HTML } from './mini-window-handle-page'
import { motion, placeWindow } from './mini-window-motion'
import { readUserJson, writeUserJson } from './user-json'
import { makeFloatingPanel } from './mac-panel'

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
/** A handle making room for another on its edge glides there (shorter moves take proportionally less). */
const HANDLE_GLIDE_MS = 160
/** Window moves for this long after we placed it ourselves are ours (Linux reports them late), not a user drop. */
const OWN_MOVE_GRACE_MS = 500
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
  /** The dock is moving the window to `rect` this frame (slide, handle drag, following its leader): the floating header follows in the same tick. */
  moved(rect: MiniRect): void
  isTuckEnabled(): boolean
  isPeekEnabled(): boolean
  /** Throw with momentum (Settings): a handle let go while moving glides on along the edge. */
  isThrowEnabled(): boolean
  /** Hover delay before a tucked handle peeks (Settings). */
  peekDelayMs(): number
  /** Extra on-screen parts that keep a peek out (the floating header panel while it shows). */
  peekRects(): MiniRect[]
  /** The window's web contents (page, header): a click or key in any of them pins a peek out. */
  peekContents(): WebContents[]
  /** Something is being dragged (a mini window by its floating header): no peek starts. */
  busy(): boolean
  /** Right-click on the handle: the mini window's menu (Send to Menu Bar, Return, Close). */
  menu(): void
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
  /** The edge a drop right now would dock to (pushed past it / pointer pressed against it), else null. */
  dropEdge(): MiniDockEdge | null
  /**
   * Thrown at `velocity` from `from` (shared/mini-window-throw.ts): fast and aimed at an outer edge it
   * would fly past, it docks there and tucks (its tuck slide starting at the throw's speed). True when it did.
   */
  flingTuck(from: MiniRect, velocity: ThrowVelocity): boolean
  /** The dock is moving this window itself (sliding, handle drag or its glide) or it is tucked: a glide over it stops. */
  moving(): boolean
  /** The window moved or resized (the handle follows when out; 'stack' followers come along). With `rect` (moving it this frame) at once, else coalesced to the next frame. */
  follow(rect?: MiniRect): void
  /** Settings changed (tuck turned off undocks). */
  applySettings(): void
  /** Undock and stay hidden (the window is moving into the menu bar). */
  release(): void
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

/** macOS Reduce Motion (prefers-reduced-motion): slides jump to their end, throws don't glide. */
export function reducedMotion(): boolean {
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
  /** The view's size (set only when it changes, not per frame). */
  size: { width: number; height: number } | null
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
  onMenu: () => void
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
  ipcMain.on('mini-window:handle-menu', (event) => from(event)?.onMenu())
}

/** Dock state for one mini window. `initial`: open already docked (out) to this remembered edge. */
export function createDockController(host: DockHost, initial: { dock: MiniDock; display: Display } | null): DockController {
  registerIpc()
  const win = host.window
  let dock: MiniDock | null = initial?.dock ?? null
  let displayId: number | null = initial?.display.id ?? null
  let tucked = false
  let handle: Handle | null = null
  /** Frame-loop keys (mini-window-motion.ts): this window's slide, handle drag, handle glide and coalesced follow. */
  const slideKey = {}
  const dragKey = {}
  const glideKey = {}
  const followKey = {}
  let sliding = false
  let ownMoveUntil = 0
  /** A handle drag, and (`gliding`) the throw that carries on after it is let go (still a drag to everything else). */
  let drag: { startCursor: { x: number; y: number }; startOffset: number; startedAt: number; samples: VelocityTracker; gliding: boolean } | null = null
  /** The next slide continues a fling: it starts at this speed toward the edge (px/ms). */
  let flingSpeed: number | null = null
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

  /**
   * Where the window goes docked to `d` on `display`: flush with the work area's edge when out; tucked,
   * past the display's own edge too (never left in the menu bar / Dock / taskbar band).
   */
  function dockedRect(d: MiniDock, isTucked: boolean, display: Display = dockDisplay()): MiniRect {
    return dockedBounds(size(), d, display.workArea, isTucked, display.bounds)
  }

  /** Place the window ourselves (not a user drop): in a frame it commits with everything else that moves. */
  function setOwnBounds(rect: MiniRect): void {
    ownMoveUntil = Date.now() + OWN_MOVE_GRACE_MS
    placeWindow(win, rect)
    host.moved(rect)
  }

  /** Where the window is now, or where this frame is putting it (mid-slide). */
  function currentRect(): MiniRect {
    return win.getBounds()
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

  /** What the handle page last got (it is only sent again when something changed, never per frame). */
  let sentState = ''
  function sendHandleState(): void {
    const state = handleState()
    if (!state || !handle?.ready || handle.view.webContents.isDestroyed()) return
    const json = JSON.stringify(state)
    if (json === sentState) return
    sentState = json
    handle.view.webContents.send('mini-window:handle-state', state)
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
    // On every Space, and never activating Surffish: a click on the handle (it never takes focus) would
    // otherwise activate the app and macOS would switch to the Space holding a browser window.
    makeFloatingPanel(window)
    const view = new WebContentsView({
      webPreferences: { preload: host.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, transparent: true, disableWakeLocks: true }
    })
    view.setBackgroundColor('#00000000')
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    window.contentView.addChildView(view)
    const created: Handle = { window, view, ready: false, size: null }
    view.webContents.once('did-finish-load', () => {
      created.ready = true
      sentState = ''
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

  /**
   * Put the handle on the inner edge of a window at `rect`, and show it. `moving` (a slide or drag
   * frame): only its bounds change, in the same tick as the window. `glide`: settling beside other
   * handles on its edge, it eases there instead of jumping.
   */
  function placeHandle(rect: MiniRect, mode: 'moving' | 'glide' | 'exact' = 'exact'): void {
    if (!dock) return
    // 'stack': the group shares its leader's handle.
    if (isFollower(registration)) return closeHandle()
    const h = ensureHandle()
    // Settled on the screen edge beside other tucked handles: at its spread-out place along it.
    // Kept inside the work area: a window tucked past the menu bar leaves its handle just under it.
    const wa = dockDisplay().workArea
    const bounds = tucked && along !== null && !sliding && !drag ? dockHandleAt(rect, dock.edge, along, wa) : dockHandleBounds(rect, dock.edge, wa)
    if (!h.size || h.size.width !== bounds.width || h.size.height !== bounds.height) {
      h.size = { width: bounds.width, height: bounds.height }
      h.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
    }
    const shown = h.window.isVisible()
    if (mode === 'glide' && shown) glideHandle(h, bounds)
    else {
      motion.cancel(glideKey)
      placeWindow(h.window, bounds)
    }
    if (!shown) {
      h.window.showInactive()
      // Some window managers drop the level while a window is hidden.
      if (IS_MAC) h.window.setAlwaysOnTop(true, 'floating')
    }
    if (mode !== 'moving') sendHandleState()
  }

  /** Ease the handle from where it is to `to` (making room on its edge, or settling after a slide). */
  function glideHandle(h: Handle, to: MiniRect): void {
    const from = h.window.getBounds()
    const duration = reducedMotion() ? 0 : motionDuration(from, to, 2 * MINI_DOCK_HANDLE_LENGTH, HANDLE_GLIDE_MS)
    if (duration === 0) {
      motion.cancel(glideKey)
      return placeWindow(h.window, to)
    }
    const elapsed = frameClock(motion)
    motion.run(glideKey, (now) => {
      if (h.window.isDestroyed() || handle !== h) return false
      const t = elapsed(now) / duration
      placeWindow(h.window, t >= 1 ? to : lerpRect(from, to, t))
      return t < 1
    })
  }

  // --- Sliding.

  function stopSlide(): void {
    motion.cancel(slideKey)
    sliding = false
  }

  /**
   * Slide from `from` to `to` on the shared frame loop (display refresh rate, ease-out, time based so a
   * slow frame never slows it down). The handle, the floating header and the rest of a 'stack' group
   * (each sliding on the same loop) move in the same tick. Interrupted, the next slide starts from where
   * this one got to (no snap) and takes time in proportion to the distance left.
   */
  function slide(from: MiniRect, to: MiniRect, done: () => void): void {
    stopSlide()
    ownMoveUntil = Number.POSITIVE_INFINITY
    const finish = (): void => {
      stopSlide()
      if (!alive()) return
      setOwnBounds(to)
      placeHandle(to, 'glide')
      done()
    }
    const full = dock?.edge === 'left' || dock?.edge === 'right' ? to.width : to.height
    const normal = motionDuration(from, to, full, MINI_DOCK_SLIDE_MS)
    // Continuing a fling: as long as it takes to leave at the throw's speed (the throw carries on, no restart).
    const speed = flingSpeed
    flingSpeed = null
    const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
    const duration = reducedMotion() ? 0 : speed !== null && normal > 0 ? flingSlideMs(distance, speed, normal) : normal
    if (duration === 0) return finish()
    // Timed from its first frame: a 'stack' group's windows all start in the same tick, however long
    // showing the others took after this one was queued.
    const elapsed = frameClock(motion)
    sliding = true
    motion.run(slideKey, (now) => {
      if (!alive()) {
        sliding = false
        return false
      }
      const t = elapsed(now) / duration
      if (t >= 1) {
        finish()
        return false
      }
      const frame = lerpRect(from, to, t)
      placeWindow(win, frame)
      placeHandle(frame, 'moving')
      host.moved(frame)
      return true
    })
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
    const from = win.isVisible() ? currentRect() : dockedRect(current, true)
    slide(from, dockedRect(current, true), () => {
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
    if (offset !== undefined && offset !== dock.offset) {
      dock = { ...dock, offset }
      remember()
    }
    const target = dockedRect(dock, false)
    if (!tucked && win.isVisible() && !sliding && sameRect(win.getBounds(), target)) {
      if (focus) host.focusPage()
      return
    }
    tucked = false
    const shown = win.isVisible()
    const from = shown ? currentRect() : dockedRect(dock, true)
    if (!shown) {
      setOwnBounds(from)
      win.showInactive()
      // The level can drop while hidden; set once when it shows, not per frame.
      if (IS_MAC) win.setAlwaysOnTop(true, 'floating')
      else win.setAlwaysOnTop(true)
    }
    along = null
    relayoutHandles()
    slide(from, target, () => {
      if (focus && !tucked) host.focusPage()
      host.changed()
    })
    host.changed()
  }

  function undock(show = true): void {
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
    if (wasTucked && show && alive()) {
      // Bring it back on screen where it was along the edge.
      setOwnBounds(clampMiniBounds(win.getBounds(), display.workArea))
      win.showInactive()
    }
    host.changed()
  }

  // --- Handle input.

  function stopDrag(): void {
    motion.cancel(dragKey)
    drag = null
  }

  /** Done dragging (and gliding): keep the place, settle beside the other handles on this edge (in its new order). */
  function finishDrag(): void {
    stopDrag()
    remember()
    relayoutHandles()
  }

  /** The handle drag (or its glide) puts the window `offset` along the edge: window + handle move together. */
  function moveAlong(offset: number): void {
    if (!dock || offset === dock.offset) return
    dock = { ...dock, offset }
    const rect = dockedRect(dock, tucked)
    setOwnBounds(rect)
    placeHandle(rect, 'moving')
    // The others on this edge make room (and swap places as it passes them).
    if (tucked) relayoutHandles()
    // A stack that is out moves with its leader.
    else followLeader(registration, offset)
  }

  /** Let go while moving along the edge: glide on (exponential friction), easing into the end of the edge. */
  function throwAlong(state: NonNullable<typeof drag>): boolean {
    if (!dock) return false
    const now = performance.now()
    const cursor = screen.getCursorScreenPoint()
    state.samples.add(now, cursor.x, cursor.y)
    const velocity = releaseVelocity({ enabled: host.isThrowEnabled(), reducedMotion: reducedMotion(), velocity: state.samples.velocity(now) })
    if (!velocity) return false
    const horizontal = dock.edge === 'top' || dock.edge === 'bottom'
    const { width, height } = size()
    const wa = dockDisplay().workArea
    const room = Math.max(0, (horizontal ? wa.width : wa.height) - (horizontal ? width : height))
    const glide = planEdgeGlide(dock.offset, horizontal ? velocity.vx : velocity.vy, 0, room)
    if (!glide) return false
    const from = dock.offset
    state.gliding = true
    const elapsed = frameClock(motion)
    motion.run(dragKey, (tick) => {
      if (drag !== state) return false
      if (!alive() || !dock) {
        finishDrag()
        return false
      }
      const t = elapsed(tick)
      const last = t >= glide.duration
      moveAlong(last ? glide.to : Math.round(from + glideAxisAt(glide.axis, t)))
      if (!last) return true
      finishDrag()
      return false
    })
    return true
  }

  function onDrag(active: boolean): void {
    if (!alive() || !dock) return
    if (!active) {
      const state = drag
      // Let go again (a blur after pointerup) while it glides: the glide carries on.
      if (state?.gliding) return
      if (state && throwAlong(state)) return
      finishDrag()
      return
    }
    // Grabbing it again stops a glide where it is.
    stopDrag()
    stopPeek()
    const state: NonNullable<typeof drag> = { startCursor: screen.getCursorScreenPoint(), startOffset: dock.offset, startedAt: Date.now(), samples: createVelocityTracker(), gliding: false }
    drag = state
    // Once per frame (however fast the pointer reports): read the cursor, move window + handle together.
    motion.run(dragKey, (now) => {
      if (drag !== state) return false
      if (!alive() || !dock || Date.now() - state.startedAt > DRAG_MAX_MS) {
        onDrag(false)
        return false
      }
      const cursor = screen.getCursorScreenPoint()
      state.samples.add(now, cursor.x, cursor.y)
      const horizontal = dock.edge === 'top' || dock.edge === 'bottom'
      const delta = horizontal ? cursor.x - state.startCursor.x : cursor.y - state.startCursor.y
      const { width, height } = size()
      const wa = dockDisplay().workArea
      moveAlong(dragDockOffset(state.startOffset, delta, horizontal ? width : height, dock.edge, wa))
      return true
    })
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
    if (sliding || drag) return sendHandleState()
    if (tucked) placeHandle(dockedRect(dock, true))
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
      if (!alive() || !dock || tucked || sliding || drag) return
      dock = { ...dock, offset }
      const rect = dockedRect(dock, false)
      // In the leader's frame: same tick as the leader (and its header).
      setOwnBounds(rect)
      placeHandle(rect, 'moving')
    },
    bounds: () => (alive() ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 }),
    syncRole,
    handleContents: () => (handle && !handle.view.webContents.isDestroyed() ? handle.view.webContents : null),
    onClick,
    onDrag,
    onHover,
    onMenu: () => { if (alive()) host.menu() },
    sliding: () => sliding,
    peekRects: () => (alive() && win.isVisible() ? [win.getBounds(), ...host.peekRects()] : []),
    peekContents: () => (alive() ? host.peekContents() : []),
    pinPeek: () => { if (peek?.phase() === 'out') peek.pin() },
    onEdge: () => {
      if (!alive() || !dock || !tucked || sliding) return null
      const display = dockDisplay()
      const rect = dockedRect(dock, true, display)
      // The one being dragged stays under the pointer; the rest arrange around it.
      return { key: `${display.id}:${dock.edge}`, edge: dock.edge, desired: dockHandleAlong(rect, dock.edge), workArea: display.workArea }
    },
    setAlong: (next) => {
      const settled = next === null || drag ? null : next
      if (settled === along) return
      along = settled
      if (alive() && dock && tucked && !sliding && handle && !handle.window.isDestroyed()) placeHandle(dockedRect(dock, true), 'glide')
    }
  }
  controllers.add(registration)

  // Focusing the window (a click inside it) pins a peek out ('stack': the group's peek, run by its leader).
  const onFocus = (): void => { for (const member of groupOf(registration)) member.pinPeek() }
  win.on('focus', onFocus)
  // Shown while docked and out (pop out, shortcut): the handle comes with it.
  const onShow = (): void => {
    if (dock && !tucked && !sliding) placeHandle(win.getBounds())
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
    const rect = dockedRect(dock, tucked, display)
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
    ignoringMoves: () => tucked || sliding || drag !== null || Date.now() < ownMoveUntil,
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
    dropEdge: () => {
      if (!alive() || tucked || sliding || !host.isTuckEnabled()) return null
      const bounds = win.getBounds()
      return dockEdgeForDrop(bounds, screen.getCursorScreenPoint(), displayInfo(screen.getDisplayMatching(bounds)), allDisplays())
    },
    flingTuck: (from, velocity) => {
      if (!alive() || tucked || sliding || drag || !host.isTuckEnabled()) return false
      const display = screen.getDisplayMatching(from)
      const wa = display.workArea
      const displays = allDisplays()
      const edge = flingTuckEdge(from, velocity, wa, (candidate) => isOuterEdge(displayInfo(display), candidate, displays, candidate === 'top' || candidate === 'bottom' ? [from.x, from.x + from.width] : [from.y, from.y + from.height]))
      if (!edge) return false
      // Docks where the glide along that edge would have taken it.
      const target = flingAlong(from, velocity, edge, wa)
      const before = groupKey()
      dock = dockFor(target, edge, wa)
      displayId = display.id
      if (groupKey() !== before) joinedAt = ++joinCounter
      remember()
      // 'stack': joining a group that is out comes out with it (like a drop at that edge).
      const others = groupOf(registration).filter((member) => member !== registration)
      if (others.length > 0 && others.every((member) => member.out())) {
        slideOut(false)
        return true
      }
      flingSpeed = edge === 'left' ? -velocity.vx : edge === 'right' ? velocity.vx : edge === 'top' ? -velocity.vy : velocity.vy
      const tuckedNow = tuckGroup(registration)
      flingSpeed = null
      return tuckedNow
    },
    moving: () => tucked || sliding || drag !== null,
    afterDrop: () => {
      if (!alive() || tucked || sliding) return false
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
        const rect = dockedRect(dock, false, home)
        setOwnBounds(rect)
        placeHandle(rect)
        // 'stack': the group closes up behind its leader (a follower nudged out of line goes back into it).
        if (groupOf(registration).length > 1) slideOut(false)
        return true
      }
      undock()
      return false
    },
    follow: (rect) => {
      const now = (bounds: MiniRect): void => {
        if (!alive() || !dock || tucked || sliding || drag || !win.isVisible()) return
        placeHandle(bounds, 'moving')
        // 'stack': the leader dragged by its header; the rest of the group comes along the edge.
        followLeader(registration, alongEdge(bounds))
      }
      if (rect) return now(rect)
      // A native move/resize event: coalesced to one follow per frame, in that frame's tick.
      motion.once(followKey, () => now(win.getBounds()))
    },
    applySettings: () => {
      if (!host.isTuckEnabled()) undock()
      else if (!host.isPeekEnabled()) stopPeek()
      host.changed()
    },
    release: () => undock(false),
    refreshHandle: sendHandleState,
    dispose: () => {
      if (disposed) return
      stopSlide()
      stopDrag()
      stopPeek()
      unwatchPins()
      motion.cancel(glideKey)
      motion.cancel(followKey)
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
