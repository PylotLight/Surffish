import { describe, expect, test } from 'bun:test'
import { miniReorderTarget, miniReturnBeforeId, miniStepTarget, miniStripInsertIndex, miniTabOrigin, moveTabId, resolveMiniChipDrop, sidebarDropBeforeId } from './mini-window-tab-drag'

const chips = [{ left: 6, width: 100 }, { left: 108, width: 100 }, { left: 210, width: 100 }]

describe('miniStripInsertIndex', () => {
  test('left half of a chip goes before it, right half after', () => {
    expect(miniStripInsertIndex(0, chips)).toBe(0)
    expect(miniStripInsertIndex(55, chips)).toBe(0)
    expect(miniStripInsertIndex(57, chips)).toBe(1)
    expect(miniStripInsertIndex(200, chips)).toBe(2)
    expect(miniStripInsertIndex(300, chips)).toBe(3)
    expect(miniStripInsertIndex(900, chips)).toBe(3)
  })
  test('no chips: the end', () => {
    expect(miniStripInsertIndex(10, [])).toBe(0)
  })
})

describe('miniReorderTarget / moveTabId', () => {
  const ids = ['a', 'b', 'c']
  test('slots on either side of itself leave it in place', () => {
    expect(miniReorderTarget(ids, 'b', 1)).toBe(1)
    expect(miniReorderTarget(ids, 'b', 2)).toBe(1)
  })
  test('moves left and right', () => {
    expect(miniReorderTarget(ids, 'c', 0)).toBe(0)
    expect(moveTabId(ids, 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(miniReorderTarget(ids, 'a', 3)).toBe(2)
    expect(moveTabId(ids, 'a', 2)).toEqual(['b', 'c', 'a'])
  })
  test('unknown tab', () => {
    expect(miniReorderTarget(ids, 'x', 0)).toBe(-1)
    expect(moveTabId(ids, 'x', 0)).toEqual(ids)
  })
  test('clamps', () => {
    expect(miniReorderTarget(ids, 'a', 99)).toBe(2)
    expect(moveTabId(ids, 'a', 99)).toEqual(['b', 'c', 'a'])
  })
})

describe('miniStepTarget', () => {
  test('one step, never past the ends', () => {
    expect(miniStepTarget(['a', 'b'], 'a', 1)).toBe(1)
    expect(miniStepTarget(['a', 'b'], 'a', -1)).toBe(-1)
    expect(miniStepTarget(['a', 'b'], 'b', 1)).toBe(-1)
    expect(miniStepTarget(['a', 'b'], 'z', 1)).toBe(-1)
  })
})

describe('resolveMiniChipDrop', () => {
  const own = { x: 1000, y: 100, width: 400, height: 500 }
  const ownStrip = { x: 1000, y: 136, width: 400, height: 28 }
  const minis = [{ mini: 'm2', bounds: { x: 200, y: 600, width: 300, height: 300 } }]
  const browsers = [{ window: 'b1', bounds: { x: 0, y: 0, width: 900, height: 800 } }]
  const input = { own, ownStrip, tabCount: 2, minis, browsers }
  test('on its own strip: reorder', () => {
    expect(resolveMiniChipDrop({ x: 1100, y: 150 }, input)).toEqual({ kind: 'reorder' })
  })
  test('elsewhere in its own window: nothing', () => {
    expect(resolveMiniChipDrop({ x: 1100, y: 400 }, input)).toEqual({ kind: 'none' })
  })
  test('a mini window over a browser window wins', () => {
    expect(resolveMiniChipDrop({ x: 300, y: 700 }, input)).toEqual({ kind: 'merge', into: 'm2' })
  })
  test('a browser window: return there', () => {
    expect(resolveMiniChipDrop({ x: 100, y: 100 }, input)).toEqual({ kind: 'return', into: 'b1' })
  })
  test('open desktop: split, unless it is the last tab', () => {
    expect(resolveMiniChipDrop({ x: 1500, y: 900 }, input)).toEqual({ kind: 'split' })
    expect(resolveMiniChipDrop({ x: 1500, y: 900 }, { ...input, tabCount: 1 })).toEqual({ kind: 'none' })
  })
  test('a single tab still returns or merges', () => {
    expect(resolveMiniChipDrop({ x: 100, y: 100 }, { ...input, tabCount: 1, ownStrip: null })).toEqual({ kind: 'return', into: 'b1' })
  })
})

describe('origin / return position', () => {
  test('records the neighbours', () => {
    expect(miniTabOrigin(['a', 'b', 'c'], 'b')).toEqual({ prevId: 'a', nextId: 'c' })
    expect(miniTabOrigin(['a', 'b', 'c'], 'a')).toEqual({ prevId: null, nextId: 'b' })
    expect(miniTabOrigin(['a'], 'z')).toBeNull()
  })
  test('goes back before its right neighbour', () => {
    expect(miniReturnBeforeId({ prevId: 'a', nextId: 'c' }, ['a', 'c', 'd'])).toBe('c')
  })
  test('right neighbour gone: after the left one', () => {
    expect(miniReturnBeforeId({ prevId: 'a', nextId: 'c' }, ['a', 'd'])).toBe('d')
    expect(miniReturnBeforeId({ prevId: 'a', nextId: 'c' }, ['x', 'a'])).toBeNull()
  })
  test('both gone or unknown: the end', () => {
    expect(miniReturnBeforeId({ prevId: 'a', nextId: 'c' }, ['x'])).toBeNull()
    expect(miniReturnBeforeId(null, ['x'])).toBeNull()
  })
  test('was first: before the old second', () => {
    expect(miniReturnBeforeId({ prevId: null, nextId: 'b' }, ['b', 'c'])).toBe('b')
  })
})

describe('sidebarDropBeforeId', () => {
  const ids = ['a', 'b', 'c']
  test('upper half: before the row, lower half: before the next', () => {
    expect(sidebarDropBeforeId({ id: 'b', after: false }, ids, 'm')).toBe('b')
    expect(sidebarDropBeforeId({ id: 'b', after: true }, ids, 'm')).toBe('c')
    expect(sidebarDropBeforeId({ id: 'c', after: true }, ids, 'm')).toBeNull()
  })
  test('no row: the end', () => {
    expect(sidebarDropBeforeId(null, ids, 'm')).toBeNull()
  })
})
