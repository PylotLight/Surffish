import { describe, expect, test } from 'bun:test'
import {
  MINI_DOCK_HANDLE_GAP,
  MINI_DOCK_HANDLE_LENGTH,
  MINI_DOCK_HANDLE_THICKNESS,
  MINI_DOCK_OVERSHOOT,
  clampDockOffset,
  distanceFromDockEdge,
  dockArrow,
  dockEdgeForDrop,
  dockFor,
  dockEdgeSpan,
  dockHandleAlong,
  dockHandleAt,
  dockHandleBounds,
  dockedBounds,
  dragDockOffset,
  isOuterEdge,
  nearestDockEdge,
  parseMiniDocks,
  reconcileDock,
  slideFrame,
  spreadDockHandles,
  stackDockOffsets,
  dockGroupKey,
  type MiniDisplay
} from './mini-window-dock'

// A MacBook-ish display with a menu bar, and a second monitor to its right.
const laptop: MiniDisplay = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } }
const right: MiniDisplay = { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
const alone = [laptop]
const pair = [laptop, right]
const size = { width: 420, height: 620 }

describe('outer edges', () => {
  test('a lone display: every edge is outer', () => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) expect(isOuterEdge(laptop, edge, alone)).toBe(true)
  })

  test('the edge shared with another monitor is not', () => {
    expect(isOuterEdge(laptop, 'right', pair)).toBe(false)
    expect(isOuterEdge(right, 'left', pair)).toBe(false)
    expect(isOuterEdge(right, 'right', pair)).toBe(true)
  })

  test('only where the neighbour actually is along the edge', () => {
    const short: MiniDisplay = { bounds: { x: 1440, y: 0, width: 800, height: 400 }, workArea: { x: 1440, y: 0, width: 800, height: 400 } }
    expect(isOuterEdge(laptop, 'right', [laptop, short], [100, 300])).toBe(false)
    expect(isOuterEdge(laptop, 'right', [laptop, short], [500, 800])).toBe(true)
  })
})

describe('dock on drop', () => {
  test('pushed past a side docks there', () => {
    expect(dockEdgeForDrop({ x: -40, y: 200, ...size }, null, laptop, alone)).toBe('left')
    expect(dockEdgeForDrop({ x: 1440 - 420 + 30, y: 200, ...size }, null, laptop, alone)).toBe('right')
    expect(dockEdgeForDrop({ x: 300, y: 900 - 620 + 40, ...size }, null, laptop, alone)).toBe('bottom')
  })

  test('just touching or slightly past does not (that is corner snap / a nudge)', () => {
    expect(dockEdgeForDrop({ x: 0, y: 200, ...size }, null, laptop, alone)).toBeNull()
    expect(dockEdgeForDrop({ x: -(MINI_DOCK_OVERSHOOT - 1), y: 200, ...size }, null, laptop, alone)).toBeNull()
  })

  test('the pointer pressed against the top of the screen docks to the top (macOS stops windows at the menu bar)', () => {
    expect(dockEdgeForDrop({ x: 300, y: 25, ...size }, { x: 500, y: 1 }, laptop, alone)).toBe('top')
    // Pointer at the top but not over the window: no.
    expect(dockEdgeForDrop({ x: 300, y: 25, ...size }, { x: 100, y: 1 }, laptop, alone)).toBeNull()
  })

  test('never onto an edge shared with another display', () => {
    expect(dockEdgeForDrop({ x: 1440 - 420 + 200, y: 200, ...size }, null, laptop, pair)).toBeNull()
    expect(dockEdgeForDrop({ x: 1440 - 420 + 200, y: 900 - 620 + 60, ...size }, null, laptop, pair)).toBe('bottom')
  })

  test('the deepest overshoot wins in a corner', () => {
    expect(dockEdgeForDrop({ x: -100, y: 900 - 620 + 30, ...size }, null, laptop, alone)).toBe('left')
  })
})

describe('nearest edge (tuck button)', () => {
  test('closest outer edge, sides first on ties', () => {
    expect(nearestDockEdge({ x: 1000, y: 260, ...size }, laptop, alone)).toBe('right')
    expect(nearestDockEdge({ x: 20, y: 260, ...size }, laptop, alone)).toBe('left')
    expect(nearestDockEdge({ x: 500, y: 25, width: 420, height: 300 }, laptop, alone)).toBe('top')
  })

  test('skips the shared edge', () => {
    expect(nearestDockEdge({ x: 1440 - 420, y: 140, ...size }, laptop, pair)).not.toBe('right')
  })
})

describe('docked bounds and handle', () => {
  const wa = laptop.workArea
  test('out: flush with the edge; tucked: just past it', () => {
    expect(dockedBounds(size, { edge: 'left', offset: 100 }, wa, false)).toEqual({ x: 0, y: 125, ...size })
    expect(dockedBounds(size, { edge: 'left', offset: 100 }, wa, true)).toEqual({ x: -420, y: 125, ...size })
    expect(dockedBounds(size, { edge: 'right', offset: 0 }, wa, false)).toEqual({ x: 1020, y: 25, ...size })
    expect(dockedBounds(size, { edge: 'right', offset: 0 }, wa, true)).toEqual({ x: 1440, y: 25, ...size })
    expect(dockedBounds(size, { edge: 'top', offset: 10 }, wa, true)).toEqual({ x: 10, y: 25 - 620, ...size })
    expect(dockedBounds(size, { edge: 'bottom', offset: 10 }, wa, false)).toEqual({ x: 10, y: 900 - 620, ...size })
  })

  test('offset is clamped into the work area, and a too-big window shrinks to fit', () => {
    expect(dockedBounds(size, { edge: 'left', offset: 5000 }, wa, false).y).toBe(25 + 875 - 620)
    expect(dockedBounds({ width: 3000, height: 3000 }, { edge: 'left', offset: 0 }, wa, false)).toEqual({ x: 0, y: 25, width: 1440, height: 875 })
    expect(clampDockOffset(-50, 100, 'top', wa)).toBe(0)
  })

  test('the handle rides the inner edge, centred; tucked it sits on the screen edge', () => {
    const tucked = dockedBounds(size, { edge: 'right', offset: 0 }, wa, true)
    const handle = dockHandleBounds(tucked, 'right')
    expect(handle).toEqual({ x: 1440 - MINI_DOCK_HANDLE_THICKNESS, y: 25 + 310 - MINI_DOCK_HANDLE_LENGTH / 2, width: MINI_DOCK_HANDLE_THICKNESS, height: MINI_DOCK_HANDLE_LENGTH })
    const leftOut = dockHandleBounds(dockedBounds(size, { edge: 'left', offset: 0 }, wa, false), 'left')
    expect(leftOut.x).toBe(420)
    const topTucked = dockHandleBounds(dockedBounds(size, { edge: 'top', offset: 0 }, wa, true), 'top')
    expect(topTucked).toMatchObject({ y: 25, width: MINI_DOCK_HANDLE_LENGTH, height: MINI_DOCK_HANDLE_THICKNESS })
    const bottomTucked = dockHandleBounds(dockedBounds(size, { edge: 'bottom', offset: 0 }, wa, true), 'bottom')
    expect(bottomTucked.y + bottomTucked.height).toBe(900)
  })

  test('dockFor keeps the place along the edge; distance tells flush from dragged away', () => {
    expect(dockFor({ x: -60, y: 200, ...size }, 'left', wa)).toEqual({ edge: 'left', offset: 175 })
    expect(dockFor({ x: -60, y: 600, ...size }, 'left', wa).offset).toBe(875 - 620)
    expect(distanceFromDockEdge({ x: 0, y: 300, ...size }, 'left', wa)).toBe(0)
    expect(distanceFromDockEdge({ x: 200, y: 300, ...size }, 'left', wa)).toBe(200)
  })

  test('dragging the handle moves the window along the edge, within the work area', () => {
    expect(dragDockOffset(100, 50, 620, 'left', wa)).toBe(150)
    expect(dragDockOffset(100, 5000, 620, 'left', wa)).toBe(875 - 620)
    expect(dragDockOffset(100, -500, 620, 'left', wa)).toBe(0)
  })
})

describe('slide', () => {
  test('eases from start to end', () => {
    const from = { x: 0, y: 0, width: 100, height: 100 }
    const to = { x: -100, y: 0, width: 100, height: 100 }
    expect(slideFrame(from, to, 0)).toEqual(from)
    expect(slideFrame(from, to, 1)).toEqual(to)
    expect(slideFrame(from, to, 0.5).x).toBeLessThan(-50)
  })
})

describe('saved docks and display changes', () => {
  test('parse keeps valid entries only', () => {
    expect(parseMiniDocks({ a: { edge: 'left', offset: 12.4 }, b: { edge: 'middle', offset: 1 }, c: { edge: 'top', offset: 'x' }, d: null })).toEqual({ a: { edge: 'left', offset: 12 } })
    expect(parseMiniDocks('nope')).toEqual({})
  })

  test('a dock that still fits stays', () => {
    expect(reconcileDock({ edge: 'left', offset: 100 }, size, laptop, pair)).toEqual({ edge: 'left', offset: 100 })
  })

  test('an edge that became shared moves to the nearest outer edge', () => {
    const moved = reconcileDock({ edge: 'right', offset: 100 }, size, laptop, pair)
    expect(moved).not.toBeNull()
    expect(moved?.edge).not.toBe('right')
  })

  test('the offset is re-clamped to a smaller work area', () => {
    const small: MiniDisplay = { bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 25, width: 1280, height: 695 } }
    expect(reconcileDock({ edge: 'left', offset: 400 }, size, small, [small])).toEqual({ edge: 'left', offset: 695 - 620 })
  })

  test('arrows point where the window will go', () => {
    expect(dockArrow('right', true)).toBe('left')
    expect(dockArrow('right', false)).toBe('right')
    expect(dockArrow('top', true)).toBe('down')
    expect(dockArrow('bottom', false)).toBe('down')
  })
})

describe('several handles on one edge', () => {
  const step = MINI_DOCK_HANDLE_LENGTH + MINI_DOCK_HANDLE_GAP
  const noOverlap = (positions: number[]): boolean => {
    const sorted = [...positions].sort((a, b) => a - b)
    return sorted.every((value, index) => index === 0 || value - (sorted[index - 1] ?? 0) >= step)
  }

  test('apart already: left where they are', () => {
    expect(spreadDockHandles([100, 300, 600], 25, 900)).toEqual([100, 300, 600])
  })

  test('same spot: spread apart, order kept by input', () => {
    const out = spreadDockHandles([400, 400, 400], 25, 900)
    expect(noOverlap(out)).toBe(true)
    expect(out[0]).toBeLessThan(out[1] ?? 0)
    expect(out[1]).toBeLessThan(out[2] ?? 0)
  })

  test('order follows the desired place (dragging one past another swaps them)', () => {
    const before = spreadDockHandles([300, 320], 25, 900)
    expect(before[0]).toBeLessThan(before[1] ?? 0)
    const after = spreadDockHandles([340, 320], 25, 900)
    expect(after[0]).toBeGreaterThan(after[1] ?? 0)
    expect(noOverlap(after)).toBe(true)
  })

  test('crowded at an end: pushed back inside the edge', () => {
    const out = spreadDockHandles([880, 880, 880], 25, 900)
    expect(noOverlap(out)).toBe(true)
    expect(Math.max(...out) + MINI_DOCK_HANDLE_LENGTH).toBeLessThanOrEqual(900)
    const start = spreadDockHandles([0, 0], 25, 900)
    expect(Math.min(...start)).toBe(25)
    expect(noOverlap(start)).toBe(true)
  })

  test('six handles fit on a short edge without overlapping', () => {
    const out = spreadDockHandles([500, 500, 500, 500, 500, 500], 25, 900)
    expect(noOverlap(out)).toBe(true)
    for (const value of out) expect(value >= 25 && value + MINI_DOCK_HANDLE_LENGTH <= 900).toBe(true)
  })

  test('handle placement helpers', () => {
    const rect = dockedBounds(size, { edge: 'right', offset: 100 }, laptop.workArea, true)
    expect(dockHandleAlong(rect, 'right')).toBe(dockHandleBounds(rect, 'right').y)
    expect(dockHandleAt(rect, 'right', 500)).toEqual({ ...dockHandleBounds(rect, 'right'), y: 500 })
    const bottom = dockedBounds(size, { edge: 'bottom', offset: 100 }, laptop.workArea, true)
    expect(dockHandleAt(bottom, 'bottom', 700)).toEqual({ ...dockHandleBounds(bottom, 'bottom'), x: 700 })
    expect(dockEdgeSpan(laptop.workArea, 'right')).toEqual([25, 900])
    expect(dockEdgeSpan(laptop.workArea, 'top')).toEqual([0, 1440])
  })
})

describe('stacked groups', () => {
  test('windows stack one after another from the first one\'s offset', () => {
    expect(stackDockOffsets([300, 200, 100], 50, 875)).toEqual([50, 350, 550])
  })

  test('moved back from the far end so the whole stack fits', () => {
    expect(stackDockOffsets([300, 300], 500, 875)).toEqual([275, 575])
    expect(stackDockOffsets([300], -20, 875)).toEqual([0])
  })

  test('too long for the edge: they overlap evenly, first at 0, last ending at the end', () => {
    expect(stackDockOffsets([620, 620, 620], 100, 875)).toEqual([0, 128, 255])
    expect(stackDockOffsets([], 0, 875)).toEqual([])
  })

  test('group key: display and edge', () => {
    expect(dockGroupKey(7, 'right')).toBe('7:right')
  })
})
