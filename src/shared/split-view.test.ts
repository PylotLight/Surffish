import { describe, expect, test } from 'bun:test'
import {
  MAX_SPLIT_PANES,
  MIN_SPLIT_PANE_PX,
  SPLIT_DIVIDER_WIDTH,
  SPLIT_PANE_INSET,
  createSplitGroup,
  encodeSessionSplits,
  groupTabEntries,
  noteRecentTab,
  normalizeSplitSizes,
  orderTabsForSplits,
  parseSessionSplits,
  pickLastUsedTab,
  remapSessionSplits,
  removeTabFromSplits,
  replaceSplitPane,
  resizeSplitAt,
  splitDividerAt,
  splitDropSide,
  splitGroupOf,
  splitInfoFor,
  splitPaneAt,
  splitMoveFocusId,
  splitPaneRects,
  swapSplitPanes
} from './split-view'
import { normalizeWindowsSession, parseWindowsSession, serializeWindowsSession } from './window-session'
import { parseBrowserSession } from './persistence'

const bounds = { x: 0, y: 40, width: 1208, height: 700 }
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)

describe('split groups', () => {
  test('create needs 2..max distinct tabs and starts with equal sizes', () => {
    expect(createSplitGroup('s', ['a'])).toBeNull()
    expect(createSplitGroup('s', ['a', 'a'])).toBeNull()
    expect(createSplitGroup('s', ['a', ''])).toBeNull()
    expect(createSplitGroup('s', Array.from({ length: MAX_SPLIT_PANES + 1 }, (_, index) => `t${index}`))).toBeNull()
    expect(createSplitGroup('s', ['a', 'b'])).toEqual({ id: 's', tabIds: ['a', 'b'], sizes: [0.5, 0.5] })
    expect(createSplitGroup('s', ['a', 'b', 'c'])?.sizes.every((size) => Math.abs(size - 1 / 3) < 1e-9)).toBe(true)
  })

  test('sizes are normalised, clamped to a minimum share and fall back to equal', () => {
    expect(normalizeSplitSizes([3, 1], 2)).toEqual([0.75, 0.25])
    expect(normalizeSplitSizes([1, 'x'], 2)).toEqual([0.5, 0.5])
    expect(normalizeSplitSizes([1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSplitSizes(null, 2)).toEqual([0.5, 0.5])
    const clamped = normalizeSplitSizes([0.99, 0.01], 2)
    expect(clamped[1]).toBeCloseTo(0.15, 6)
    expect(sum(clamped)).toBeCloseTo(1, 9)
  })

  test('lookup, split info and removal (the partner is left alone, the group dissolves)', () => {
    const group = createSplitGroup('s', ['a', 'b'])!
    expect(splitGroupOf([group], 'b')).toBe(group)
    expect(splitGroupOf([group], 'z')).toBeUndefined()
    expect(splitInfoFor([group], 'b')).toEqual({ id: 's', index: 1, count: 2 })
    expect(removeTabFromSplits([group], 'a')).toEqual({ groups: [], partners: ['b'] })
    expect(removeTabFromSplits([group], 'z')).toEqual({ groups: [group], partners: [] })
  })

  test('removing one pane of three gives its width to the pane that takes its place', () => {
    const group = createSplitGroup('s', ['a', 'b', 'c'], [0.5, 0.3, 0.2])!
    const { groups, partners } = removeTabFromSplits([group], 'b')
    expect(partners).toEqual(['a', 'c'])
    expect(groups[0]?.tabIds).toEqual(['a', 'c'])
    expect(groups[0]?.sizes[1]).toBeCloseTo(0.5, 6)
  })

  test('swap keeps the layout, replace swaps one tab', () => {
    const group = createSplitGroup('s', ['a', 'b'], [0.7, 0.3])!
    expect(swapSplitPanes(group)).toEqual({ id: 's', tabIds: ['b', 'a'], sizes: group.sizes })
    expect(swapSplitPanes(group, 0, 5)).toBe(group)
    expect(replaceSplitPane(group, 'b', 'c').tabIds).toEqual(['a', 'c'])
    expect(replaceSplitPane(group, 'b', 'a')).toBe(group)
  })
})

describe('split layout', () => {
  test('two equal panes fill the page with one divider between them', () => {
    const layout = splitPaneRects(bounds, [0.5, 0.5])
    expect(layout.cells).toEqual([
      { x: 0, y: 40, width: 600, height: 700 },
      { x: 608, y: 40, width: 600, height: 700 }
    ])
    expect(layout.dividers).toEqual([{ x: 600, y: 40, width: SPLIT_DIVIDER_WIDTH, height: 700 }])
    expect(layout.panes[0]).toEqual({ x: SPLIT_PANE_INSET, y: 40 + SPLIT_PANE_INSET, width: 600 - 2 * SPLIT_PANE_INSET, height: 700 - 2 * SPLIT_PANE_INSET })
    // The last pane ends exactly at the right edge.
    const last = layout.cells.at(-1)!
    expect(last.x + last.width).toBe(bounds.x + bounds.width)
  })

  test('odd widths and three panes still tile without gaps or overlap', () => {
    const odd = { x: 13, y: 0, width: 1001, height: 500 }
    const layout = splitPaneRects(odd, [0.33, 0.33, 0.34])
    let x = odd.x
    layout.cells.forEach((cell, index) => {
      expect(cell.x).toBe(x)
      x = cell.x + cell.width
      if (index < layout.dividers.length) {
        expect(layout.dividers[index]!.x).toBe(x)
        x += SPLIT_DIVIDER_WIDTH
      }
    })
    expect(x).toBe(odd.x + odd.width)
  })

  test('hit testing: divider (with slop), panes, nothing outside', () => {
    const layout = splitPaneRects(bounds, [0.5, 0.5])
    expect(splitDividerAt(layout, 604, 300)).toBe(0)
    expect(splitDividerAt(layout, 599, 300)).toBe(0)
    expect(splitDividerAt(layout, 500, 300)).toBe(-1)
    expect(splitPaneAt(layout, 10, 300)).toBe(0)
    expect(splitPaneAt(layout, 900, 300)).toBe(1)
    expect(splitPaneAt(layout, 604, 300)).toBe(-1)
    expect(splitPaneAt(layout, 900, 10)).toBe(-1)
  })

  test('dragging the divider moves it under the pointer and stops at the minimum width', () => {
    const at300 = resizeSplitAt(bounds, [0.5, 0.5], 0, 304)
    const layout = splitPaneRects(bounds, at300)
    expect(Math.abs(layout.dividers[0]!.x + SPLIT_DIVIDER_WIDTH / 2 - 304)).toBeLessThanOrEqual(1)
    const far = resizeSplitAt(bounds, [0.5, 0.5], 0, 5)
    const usable = bounds.width - SPLIT_DIVIDER_WIDTH
    expect(far[0]! * usable).toBeGreaterThanOrEqual(MIN_SPLIT_PANE_PX - 0.5)
    expect(sum(far)).toBeCloseTo(1, 9)
    expect(resizeSplitAt(bounds, [0.5, 0.5], 3, 300)).toEqual([0.5, 0.5])
    // Only the two panes either side of the divider change.
    const three = resizeSplitAt(bounds, [0.4, 0.3, 0.3], 1, 1000)
    expect(three[0]).toBeCloseTo(0.4, 9)
  })

  test('drop zones are the outer page edges', () => {
    expect(splitDropSide(bounds, 50, 300)).toBe('left')
    expect(splitDropSide(bounds, 1150, 300)).toBe('right')
    expect(splitDropSide(bounds, 604, 300)).toBeNull()
    expect(splitDropSide(bounds, 50, 10)).toBeNull()
    expect(splitDropSide({ x: 0, y: 0, width: 0, height: 0 }, 0, 0)).toBeNull()
  })
})

describe('tab order and sidebar entries', () => {
  test('split tabs are kept next to each other, in pane order, where the first one was', () => {
    const group = createSplitGroup('s', ['d', 'b'])!
    expect(orderTabsForSplits(['a', 'b', 'c', 'd', 'e'], [group])).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(orderTabsForSplits(['a', 'c'], [group])).toEqual(['a', 'c'])
  })

  test('sidebar groups a split run into one entry', () => {
    const tabs = [
      { id: 'a' },
      { id: 'b', split: { id: 's', index: 0, count: 2 } },
      { id: 'c', split: { id: 's', index: 1, count: 2 } },
      { id: 'd', split: { id: 't', index: 0, count: 2 } }
    ]
    const entries = groupTabEntries(tabs)
    expect(entries.map((entry) => entry.kind)).toEqual(['tab', 'split', 'tab'])
    expect(entries[1]).toMatchObject({ kind: 'split', key: 'b', splitId: 's' })
    expect(entries[1]?.kind === 'split' && entries[1].tabs.map((tab) => tab.id)).toEqual(['b', 'c'])
  })

  test('last used tab skips the current one and ineligible ones', () => {
    let recent: string[] = []
    for (const id of ['a', 'b', 'c', 'b']) recent = noteRecentTab(recent, id)
    expect(recent).toEqual(['b', 'c', 'a'])
    expect(pickLastUsedTab(recent, 'b', () => true)).toBe('c')
    expect(pickLastUsedTab(recent, 'b', (id) => id !== 'c')).toBe('a')
    expect(pickLastUsedTab(recent, 'b', () => false)).toBeNull()
    expect(noteRecentTab(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a'])
  })
})

describe('split move focus', () => {
  test('the pane you were on keeps focus when a split moves windows', () => {
    expect(splitMoveFocusId(['a', 'b'], 'b', 'a')).toBe('b')
    expect(splitMoveFocusId(['a', 'b'], 'a', 'b')).toBe('a')
  })
  test('falls back to the moved tab, then the last member', () => {
    expect(splitMoveFocusId(['a', 'b'], 'x', 'a')).toBe('a')
    expect(splitMoveFocusId(['a'], null, 'a')).toBe('a')
    expect(splitMoveFocusId(['b'], 'x', 'a')).toBe('b')
    expect(splitMoveFocusId([], 'x', 'a')).toBeNull()
  })
})

describe('split session', () => {
  test('encode keeps splits whose tabs are all saved', () => {
    const one = createSplitGroup('s', ['b', 'a'], [0.6, 0.4])!
    const unsaved = createSplitGroup('t', ['c', 'private'])!
    expect(encodeSessionSplits(['a', 'b', 'c'], [one, unsaved])).toEqual([{ tabs: [1, 0], sizes: [0.6, 0.4] }])
  })

  test('parse drops bad, pinned, overlapping and out-of-range splits', () => {
    expect(parseSessionSplits(null, 3)).toEqual([])
    expect(parseSessionSplits([{ tabs: [0, 1], sizes: [0.7, 0.3] }], 3)).toEqual([{ tabs: [0, 1], sizes: [0.7, 0.3] }])
    expect(parseSessionSplits([{ tabs: [0, 9] }], 3)).toEqual([])
    expect(parseSessionSplits([{ tabs: [0, 0] }], 3)).toEqual([])
    expect(parseSessionSplits([{ tabs: [0, 1.5] }], 3)).toEqual([])
    expect(parseSessionSplits([{ tabs: [0, 1] }], 3, [0])).toEqual([])
    expect(parseSessionSplits([{ tabs: [0, 1] }, { tabs: [1, 2] }], 3)).toEqual([{ tabs: [0, 1], sizes: [0.5, 0.5] }])
    expect(parseSessionSplits([{ tabs: [0, 1], sizes: 'wide' }], 3)).toEqual([{ tabs: [0, 1], sizes: [0.5, 0.5] }])
    expect(parseSessionSplits(['x', { tabs: 'no' }], 3)).toEqual([])
  })

  test('remap follows dropped tabs and loses splits that lost a tab', () => {
    const map = new Map([[0, 0], [2, 1], [3, 2]])
    expect(remapSessionSplits([{ tabs: [2, 3], sizes: [0.5, 0.5] }, { tabs: [0, 1], sizes: [0.5, 0.5] }], (index) => map.get(index) ?? -1))
      .toEqual([{ tabs: [1, 2], sizes: [0.5, 0.5] }])
  })

  test('round-trips through browser-session.json, re-pointed past dropped URLs', () => {
    const session = normalizeWindowsSession([{
      urls: ['https://a.example/', 'javascript:alert(1)', 'https://b.example/', 'https://c.example/'],
      activeIndex: 3,
      pinnedIndexes: [],
      geometry: null,
      splits: [{ tabs: [2, 3], sizes: [0.65, 0.35] }, { tabs: [0, 1], sizes: [0.5, 0.5] }]
    }], 0)
    expect(session.windows[0]?.splits).toEqual([{ tabs: [1, 2], sizes: [0.65, 0.35] }])
    const disk = JSON.parse(JSON.stringify(serializeWindowsSession(session)))
    expect(disk.windows[0].splits).toEqual([{ tabs: [1, 2], sizes: [0.65, 0.35] }])
    expect(parseWindowsSession(disk)).toEqual(session)
    // Older builds read the same file and simply ignore the splits.
    expect(parseBrowserSession(disk)).toEqual({ urls: ['https://a.example/', 'https://b.example/', 'https://c.example/'], activeIndex: 2, pinnedIndexes: [] })
  })

  test('files without splits (older builds) parse without a splits field, and garbage splits are ignored', () => {
    const plain = parseWindowsSession({ version: 1, tabs: ['https://a.example/'], activeIndex: 0, pinnedTabs: [], windows: [{ tabs: ['https://a.example/', 'https://b.example/'], activeIndex: 0, pinnedTabs: [] }] })
    expect(plain.windows[0]).toEqual({ urls: ['https://a.example/', 'https://b.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null })
    const junk = parseWindowsSession({ version: 1, tabs: [], windows: [{ tabs: ['https://a.example/', 'https://b.example/'], splits: [{ tabs: [0, 7] }, 'nope'] }] })
    expect(junk.windows[0]?.splits).toBeUndefined()
  })
})
