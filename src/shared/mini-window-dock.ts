/**
 * Mini window docking ("tuck to screen edge"). Dropped against an outer edge of a display (or sent
 * there with the header's tuck button / the toggle shortcut), the mini window slides off that edge
 * and leaves a small half-round handle tab sticking out of it. The handle slides the window back
 * out; tuck again (handle, button, shortcut) and it slides away. The handle always rides on the
 * window's inner edge, so when tucked it sits on the screen edge and when out it sits on the
 * window's free side, pointing back at the edge.
 * Pure geometry only; main/mini-window-dock.ts does the windows.
 */
import type { MiniRect } from './mini-window'

/** Where the mini window's state for docking is remembered (per display, keyed like its geometry). */
export const MINI_WINDOW_DOCK_FILE = 'mini-window-dock.json'

export type MiniDockEdge = 'left' | 'right' | 'top' | 'bottom'
export const MINI_DOCK_EDGES: readonly MiniDockEdge[] = ['left', 'right', 'top', 'bottom']

/** Docked to `edge` of a display's work area; `offset` is the window's start along that edge (y for left/right, x for top/bottom), from the work area's start. */
export interface MiniDock {
  edge: MiniDockEdge
  offset: number
}

/** A display as far as docking cares: its full bounds and its work area (menu bar, Dock, taskbar excluded). */
export interface MiniDisplay {
  bounds: MiniRect
  workArea: MiniRect
}

/** Handle tab: how far it sticks out from the edge, and how long it is along the edge. */
export const MINI_DOCK_HANDLE_THICKNESS = 20
export const MINI_DOCK_HANDLE_LENGTH = 64
/** Dropped with this much of the window pushed past a work-area edge, it docks there. */
export const MINI_DOCK_OVERSHOOT = 24
/** Or dropped with the pointer pressed this close to the display's own edge (macOS won't let a window past the menu bar). */
export const MINI_DOCK_POINTER_PRESS = 3
/** Dragged out (while docked) further than this from its edge, the window undocks. */
export const MINI_DOCK_RELEASE_DISTANCE = 48
/** Slide animation length (none with reduced motion). */
export const MINI_DOCK_SLIDE_MS = 180

function isHorizontalEdge(edge: MiniDockEdge): boolean {
  return edge === 'top' || edge === 'bottom'
}

/** A rect's span along an edge: [start, end) on the axis the edge runs along. */
function spanAlong(rect: MiniRect, edge: MiniDockEdge): [number, number] {
  return isHorizontalEdge(edge) ? [rect.x, rect.x + rect.width] : [rect.y, rect.y + rect.height]
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1]
}

/**
 * Is `edge` of `display` an outer edge where `span` (a range along it; default its whole length) is,
 * i.e. no other display continues past it there? A window tucked over an edge shared with another
 * monitor would just show up on that monitor, so those edges don't dock.
 */
export function isOuterEdge(display: MiniDisplay, edge: MiniDockEdge, displays: readonly MiniDisplay[], span?: [number, number]): boolean {
  const b = display.bounds
  const range = span ?? spanAlong(b, edge)
  return !displays.some((other) => {
    const o = other.bounds
    if (o.x === b.x && o.y === b.y && o.width === b.width && o.height === b.height) return false
    const touches = edge === 'left' ? Math.abs(o.x + o.width - b.x) <= 1
      : edge === 'right' ? Math.abs(o.x - (b.x + b.width)) <= 1
      : edge === 'top' ? Math.abs(o.y + o.height - b.y) <= 1
      : Math.abs(o.y - (b.y + b.height)) <= 1
    return touches && overlaps(range, spanAlong(o, edge))
  })
}

/**
 * The edge a window dropped at `rect` (pointer at `cursor`) docks to, or null. It docks when pushed
 * at least MINI_DOCK_OVERSHOOT past an edge of its display's work area, or when the pointer is pressed
 * against the display's edge right where the window is (the only way to reach a top edge on macOS).
 * Only outer edges count; the deepest overshoot wins.
 */
export function dockEdgeForDrop(rect: MiniRect, cursor: { x: number; y: number } | null, display: MiniDisplay, displays: readonly MiniDisplay[]): MiniDockEdge | null {
  const wa = display.workArea
  const b = display.bounds
  const depth: Record<MiniDockEdge, number> = {
    left: wa.x - rect.x,
    right: rect.x + rect.width - (wa.x + wa.width),
    top: wa.y - rect.y,
    bottom: rect.y + rect.height - (wa.y + wa.height)
  }
  if (cursor) {
    const inX = cursor.x >= rect.x && cursor.x < rect.x + rect.width
    const inY = cursor.y >= rect.y && cursor.y < rect.y + rect.height
    if (inY && cursor.x <= b.x + MINI_DOCK_POINTER_PRESS) depth.left = Math.max(depth.left, MINI_DOCK_OVERSHOOT)
    if (inY && cursor.x >= b.x + b.width - 1 - MINI_DOCK_POINTER_PRESS) depth.right = Math.max(depth.right, MINI_DOCK_OVERSHOOT)
    if (inX && cursor.y <= b.y + MINI_DOCK_POINTER_PRESS) depth.top = Math.max(depth.top, MINI_DOCK_OVERSHOOT)
    if (inX && cursor.y >= b.y + b.height - 1 - MINI_DOCK_POINTER_PRESS) depth.bottom = Math.max(depth.bottom, MINI_DOCK_OVERSHOOT)
  }
  let best: MiniDockEdge | null = null
  for (const edge of MINI_DOCK_EDGES) {
    if (depth[edge] < MINI_DOCK_OVERSHOOT) continue
    if (!isOuterEdge(display, edge, displays, spanAlong(rect, edge))) continue
    if (!best || depth[edge] > depth[best]) best = edge
  }
  return best
}

/** The outer edge of its display closest to `rect` (what the tuck button and shortcut use), or null when none. */
export function nearestDockEdge(rect: MiniRect, display: MiniDisplay, displays: readonly MiniDisplay[]): MiniDockEdge | null {
  const wa = display.workArea
  const distance: Record<MiniDockEdge, number> = {
    left: rect.x - wa.x,
    right: wa.x + wa.width - (rect.x + rect.width),
    top: rect.y - wa.y,
    bottom: wa.y + wa.height - (rect.y + rect.height)
  }
  let best: MiniDockEdge | null = null
  // Ties go to the sides first (left/right): a side tab is the familiar drawer.
  for (const edge of ['right', 'left', 'bottom', 'top'] as const) {
    if (!isOuterEdge(display, edge, displays, spanAlong(rect, edge))) continue
    if (!best || distance[edge] < distance[best]) best = edge
  }
  return best
}

/** Keep the window's start along the edge inside the work area. */
export function clampDockOffset(offset: number, length: number, edge: MiniDockEdge, workArea: MiniRect): number {
  const room = (isHorizontalEdge(edge) ? workArea.width : workArea.height) - length
  return Math.round(Math.min(Math.max(offset, 0), Math.max(0, room)))
}

/** The dock for a window at `rect` docking to `edge`: its current place along the edge, clamped. */
export function dockFor(rect: MiniRect, edge: MiniDockEdge, workArea: MiniRect): MiniDock {
  const horizontal = isHorizontalEdge(edge)
  const offset = horizontal ? rect.x - workArea.x : rect.y - workArea.y
  return { edge, offset: clampDockOffset(offset, horizontal ? rect.width : rect.height, edge, workArea) }
}

/**
 * Where the window goes when docked: `tucked` fully past the edge (just off the work area), else
 * flush against it. Size is the window's own, shrunk to fit the work area.
 */
export function dockedBounds(size: { width: number; height: number }, dock: MiniDock, workArea: MiniRect, tucked: boolean): MiniRect {
  const width = Math.min(Math.round(size.width), workArea.width)
  const height = Math.min(Math.round(size.height), workArea.height)
  const horizontal = isHorizontalEdge(dock.edge)
  const offset = clampDockOffset(dock.offset, horizontal ? width : height, dock.edge, workArea)
  const along = horizontal ? workArea.x + offset : workArea.y + offset
  switch (dock.edge) {
    case 'left': return { x: tucked ? workArea.x - width : workArea.x, y: along, width, height }
    case 'right': return { x: tucked ? workArea.x + workArea.width : workArea.x + workArea.width - width, y: along, width, height }
    case 'top': return { x: along, y: tucked ? workArea.y - height : workArea.y, width, height }
    case 'bottom': return { x: along, y: tucked ? workArea.y + workArea.height : workArea.y + workArea.height - height, width, height }
  }
}

/**
 * The handle tab for a window at `rect` docked to `edge`: on the window's inner edge (the side facing
 * the screen), centred along it. Tucked, that inner edge is the screen edge itself.
 */
export function dockHandleBounds(rect: MiniRect, edge: MiniDockEdge): MiniRect {
  const t = MINI_DOCK_HANDLE_THICKNESS
  const l = MINI_DOCK_HANDLE_LENGTH
  const midX = Math.round(rect.x + rect.width / 2 - l / 2)
  const midY = Math.round(rect.y + rect.height / 2 - l / 2)
  switch (edge) {
    case 'left': return { x: rect.x + rect.width, y: midY, width: t, height: l }
    case 'right': return { x: rect.x - t, y: midY, width: t, height: l }
    case 'top': return { x: midX, y: rect.y + rect.height, width: l, height: t }
    case 'bottom': return { x: midX, y: rect.y - t, width: l, height: t }
  }
}

/** Distance from the window to its docked edge (0 when flush, negative when pushed past it). */
export function distanceFromDockEdge(rect: MiniRect, edge: MiniDockEdge, workArea: MiniRect): number {
  switch (edge) {
    case 'left': return rect.x - workArea.x
    case 'right': return workArea.x + workArea.width - (rect.x + rect.width)
    case 'top': return rect.y - workArea.y
    case 'bottom': return workArea.y + workArea.height - (rect.y + rect.height)
  }
}

/** Moving the handle along the edge by `delta` px moves the window's start by the same, clamped. */
export function dragDockOffset(start: number, delta: number, length: number, edge: MiniDockEdge, workArea: MiniRect): number {
  return clampDockOffset(start + delta, length, edge, workArea)
}

/** One frame of the slide: ease-out cubic from `from` to `to` at t in 0..1. */
export function slideFrame(from: MiniRect, to: MiniRect, t: number): MiniRect {
  const p = Math.min(1, Math.max(0, t))
  const e = 1 - (1 - p) ** 3
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * e)
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height) }
}

/** Saved docks by display key (miniDisplayKey). Unreadable entries are dropped. */
export function parseMiniDocks(value: unknown): Record<string, MiniDock> {
  const out: Record<string, MiniDock> = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [key, dock] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
    if (typeof dock !== 'object' || dock === null) continue
    const { edge, offset } = dock as Record<string, unknown>
    if (typeof edge !== 'string' || !(MINI_DOCK_EDGES as readonly string[]).includes(edge)) continue
    if (typeof offset !== 'number' || !Number.isFinite(offset)) continue
    out[key] = { edge: edge as MiniDockEdge, offset: Math.max(0, Math.round(offset)) }
  }
  return out
}

/**
 * After displays change: a dock that still fits, else the nearest outer edge of `display` (keeping
 * the place along the edge where it can), else null (undock and show the window).
 * `size` is the window's size.
 */
export function reconcileDock(dock: MiniDock, size: { width: number; height: number }, display: MiniDisplay, displays: readonly MiniDisplay[]): MiniDock | null {
  const wa = display.workArea
  const out = dockedBounds(size, dock, wa, false)
  if (isOuterEdge(display, dock.edge, displays, spanAlong(out, dock.edge))) return { edge: dock.edge, offset: dockFor(out, dock.edge, wa).offset }
  const edge = nearestDockEdge(out, display, displays)
  if (!edge) return null
  return dockFor(out, edge, wa)
}

export type MiniDockArrow = 'left' | 'right' | 'up' | 'down'

/** The chevron the handle and the header's tuck button show: which way the window will move. */
export function dockArrow(edge: MiniDockEdge, tucked: boolean): MiniDockArrow {
  const towardEdge = { left: 'left', right: 'right', top: 'up', bottom: 'down' } as const
  const awayFromEdge = { left: 'right', right: 'left', top: 'down', bottom: 'up' } as const
  return tucked ? awayFromEdge[edge] : towardEdge[edge]
}

/** Space kept between two handles on the same edge. */
export const MINI_DOCK_HANDLE_GAP = 6

/**
 * Handles of several windows tucked to the same edge: each wants to start at `desired[i]` (along the
 * edge, centred on its window); the result keeps their order by desired place (ties: input order),
 * at least `length + gap` apart, inside [min, max - length] where they fit. Same order as `desired`.
 */
export function spreadDockHandles(desired: readonly number[], min: number, max: number, length = MINI_DOCK_HANDLE_LENGTH, gap = MINI_DOCK_HANDLE_GAP): number[] {
  const order = desired.map((_, index) => index).sort((a, b) => (desired[a] ?? 0) - (desired[b] ?? 0) || a - b)
  const step = length + gap
  const pos = desired.map((value) => Math.round(Math.min(Math.max(value, min), max - length)))
  let previous = Number.NEGATIVE_INFINITY
  for (const i of order) {
    pos[i] = Math.max(pos[i] ?? 0, previous + step)
    previous = pos[i] ?? 0
  }
  let next = Number.POSITIVE_INFINITY
  for (const i of [...order].reverse()) {
    pos[i] = Math.min(pos[i] ?? 0, next - step, max - length)
    next = pos[i] ?? 0
  }
  // Too many to fit: the last pass keeps them from running past the start (they may run past the end).
  previous = Number.NEGATIVE_INFINITY
  for (const i of order) {
    pos[i] = Math.max(pos[i] ?? 0, min, previous + step)
    previous = pos[i] ?? 0
  }
  return pos.map((value) => Math.round(value))
}

/** The handle's place along its edge for a window at `rect`: centred on the window (x for top/bottom, y for left/right). */
export function dockHandleAlong(rect: MiniRect, edge: MiniDockEdge): number {
  const bounds = dockHandleBounds(rect, edge)
  return isHorizontalEdge(edge) ? bounds.x : bounds.y
}

/** The handle bounds with its place along the edge moved to `along`. */
export function dockHandleAt(rect: MiniRect, edge: MiniDockEdge, along: number): MiniRect {
  const bounds = dockHandleBounds(rect, edge)
  return isHorizontalEdge(edge) ? { ...bounds, x: along } : { ...bounds, y: along }
}

/** The span [start, end) a work area offers handles on `edge`. */
export function dockEdgeSpan(workArea: MiniRect, edge: MiniDockEdge): [number, number] {
  return spanAlong(workArea, edge)
}

/**
 * Grouping 'stack': windows docked to one edge slide out one after another along it. `lengths` are
 * their sizes along the edge (in group order), `start` where the first wants to begin (its dock
 * offset) and `room` the work area's length along the edge. They keep `start` where they all fit
 * (moved back from the far end as needed); when they don't fit they overlap evenly, the first at 0
 * and the last ending at `room`. Returns each window's dock offset.
 */
export function stackDockOffsets(lengths: readonly number[], start: number, room: number): number[] {
  if (lengths.length === 0) return []
  const total = lengths.reduce((sum, length) => sum + Math.max(0, length), 0)
  if (total <= room) {
    let at = Math.round(Math.min(Math.max(start, 0), room - total))
    return lengths.map((length) => {
      const offset = at
      at += Math.max(0, length)
      return offset
    })
  }
  const last = Math.min(room, Math.max(0, lengths[lengths.length - 1] ?? 0))
  if (lengths.length === 1) return [0]
  const step = Math.max(0, room - last) / (lengths.length - 1)
  return lengths.map((_, index) => Math.round(index * step))
}

/** A docked window's group key: same display and same edge. */
export function dockGroupKey(displayId: number, edge: MiniDockEdge): string {
  return `${displayId}:${edge}`
}
