import { describe, expect, test } from 'bun:test'
import {
  EMPTY_TAB_SELECTION,
  clickTabSelection,
  normalizeSelectedTabIds,
  pruneTabSelection,
  selectedTabIds,
  selectionMenuPlan,
  selectionMenuTarget,
  selectionModifiers,
  type TabSelection
} from './tab-selection'
import { createTabGroup, normalizeTabGroups, type GroupableTab } from './tab-groups'

const order = ['a', 'group:g1', 'b', 'c', 'd', 'e']
const plain = { toggle: false, range: false }
const cmd = { toggle: true, range: false }
const shift = { toggle: false, range: true }
const cmdShift = { toggle: true, range: true }
const sel = (keys: string[], anchor: string | null = null): TabSelection => ({ keys, anchor })

describe('tab multi-select', () => {
  test('modifiers: Cmd toggles on macOS (Ctrl-click is a right-click there); Ctrl elsewhere', () => {
    expect(selectionModifiers({ metaKey: true, ctrlKey: false, shiftKey: false }, true)).toEqual({ toggle: true, range: false })
    expect(selectionModifiers({ metaKey: false, ctrlKey: true, shiftKey: false }, true)).toEqual({ toggle: false, range: false })
    expect(selectionModifiers({ metaKey: false, ctrlKey: true, shiftKey: true }, false)).toEqual({ toggle: true, range: true })
    expect(selectionModifiers({ metaKey: true, ctrlKey: false, shiftKey: false }, false)).toEqual({ toggle: false, range: false })
  })

  test('Cmd-click starts a selection with the active tab and does not open the tab', () => {
    const result = clickTabSelection(EMPTY_TAB_SELECTION, order, 'c', cmd, 'a')
    expect(result).toEqual({ selection: sel(['a', 'c'], 'c'), activate: false })
    const more = clickTabSelection(result.selection, order, 'e', cmd, 'a')
    expect(more.selection).toEqual(sel(['a', 'c', 'e'], 'e'))
    // Toggling off again.
    expect(clickTabSelection(more.selection, order, 'c', cmd, 'a').selection).toEqual(sel(['a', 'e'], 'c'))
  })

  test('a selection that is just the active tab collapses to none', () => {
    expect(clickTabSelection(sel(['a', 'c'], 'c'), order, 'c', cmd, 'a').selection.keys).toEqual([])
    expect(clickTabSelection(EMPTY_TAB_SELECTION, order, 'a', cmd, 'a').selection.keys).toEqual([])
    // Without an active tab in the list a single Cmd-clicked tab is a selection.
    expect(clickTabSelection(EMPTY_TAB_SELECTION, order, 'c', cmd, null).selection.keys).toEqual(['c'])
  })

  test('Shift-click selects the range from the anchor, skipping group headers', () => {
    expect(clickTabSelection(EMPTY_TAB_SELECTION, order, 'c', shift, 'a')).toEqual({ selection: sel(['a', 'b', 'c'], 'a'), activate: false })
    // From the last Cmd-clicked tab, upwards too; Shift alone replaces the selection.
    expect(clickTabSelection(sel(['a', 'e'], 'e'), order, 'c', shift, 'a').selection).toEqual(sel(['c', 'd', 'e'], 'e'))
    // Cmd+Shift adds the range.
    expect(clickTabSelection(sel(['a', 'e'], 'e'), order, 'c', cmdShift, 'a').selection).toEqual(sel(['a', 'c', 'd', 'e'], 'e'))
  })

  test('a plain click clears the selection and opens the tab', () => {
    expect(clickTabSelection(sel(['a', 'c'], 'c'), order, 'd', plain, 'a')).toEqual({ selection: EMPTY_TAB_SELECTION, activate: true })
  })

  test('header keys and unknown keys are ignored', () => {
    const before = sel(['a', 'c'], 'c')
    expect(clickTabSelection(before, order, 'group:g1', cmd, 'a')).toEqual({ selection: before, activate: false })
    expect(clickTabSelection(before, order, 'zzz', shift, 'a')).toEqual({ selection: before, activate: false })
  })

  test('prune drops entries that left the list and keeps identity when nothing changed', () => {
    const before = sel(['a', 'c', 'e'], 'e')
    expect(pruneTabSelection(before, order, 'a')).toBe(before)
    expect(pruneTabSelection(before, ['a', 'b', 'c'], 'a')).toEqual(sel(['a', 'c'], null))
    // Only the active tab left: nothing selected.
    expect(pruneTabSelection(before, ['a', 'b'], 'a').keys).toEqual([])
    expect(pruneTabSelection(EMPTY_TAB_SELECTION, order)).toBe(EMPTY_TAB_SELECTION)
  })

  test('selected ids expand a split entry to all its panes, deduped', () => {
    const panes: Record<string, string[]> = { a: ['a'], s1: ['s1', 's2'], c: ['c'] }
    expect(selectedTabIds(sel(['a', 's1', 'c']), (key) => panes[key] ?? [key])).toEqual(['a', 's1', 's2', 'c'])
    expect(selectedTabIds(sel(['s1', 's1']), (key) => panes[key] ?? [key])).toEqual(['s1', 's2'])
  })

  test('renderer ids are sanitised', () => {
    expect(normalizeSelectedTabIds(['a', 'a', 3, '', null, 'b'])).toEqual(['a', 'b'])
    expect(normalizeSelectedTabIds('a')).toEqual([])
    expect(normalizeSelectedTabIds(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })

  test('the multi menu only takes over when the clicked tab is part of a 2+ selection', () => {
    expect(selectionMenuTarget(['a', 'b'], 'b')).toEqual(['a', 'b'])
    expect(selectionMenuTarget(['a', 'b'], 'c')).toBeNull()
    expect(selectionMenuTarget(['a'], 'a')).toBeNull()
  })

  test('menu plan: group / add-to-group targets / bulk actions', () => {
    const groups = [{ id: 'g1', label: 'Work', count: 2 }, { id: 'g2', label: 'Blue group', count: 1 }]
    const plan = selectionMenuPlan([{ id: 'a', pinned: false, groupId: null }, { id: 'b', pinned: false, groupId: 'g1' }, { id: 'c', pinned: false, groupId: null }], groups, 5)
    expect(plan).toMatchObject({ count: 3, groupLabel: 'Group 3 Tabs', canGroup: true, canUngroup: true, closeLabel: 'Close 3 Tabs', pinLabel: 'Pin 3 Tabs', canMoveToNewWindow: true })
    expect(plan.addTargets.map((group) => group.id)).toEqual(['g1', 'g2'])
    // Already all in g1: g1 isn't offered again.
    const inOne = selectionMenuPlan([{ id: 'a', pinned: false, groupId: 'g1' }, { id: 'b', pinned: false, groupId: 'g1' }], groups, 2)
    expect(inOne.addTargets.map((group) => group.id)).toEqual(['g2'])
    // Every tab of the window selected: nothing would stay behind.
    expect(inOne.canMoveToNewWindow).toBe(false)
    // Pinned tabs never group (the tab-groups rule).
    const pinned = selectionMenuPlan([{ id: 'p', pinned: true, groupId: null }, { id: 'a', pinned: false, groupId: null }], groups, 4)
    expect(pinned).toMatchObject({ groupLabel: 'Group 1 Tab', canGroup: true, closeLabel: 'Close 2 Tabs', canUngroup: false })
    const allPinned = selectionMenuPlan([{ id: 'p', pinned: true, groupId: null }, { id: 'q', pinned: true, groupId: 'g1' }], groups, 4)
    expect(allPinned).toMatchObject({ canGroup: false, canPin: false, addTargets: [] })
  })

  test('grouping a selection that spans groups and a split keeps the tab-group rules', () => {
    // a | [g1: b c] | split s(d,e) | f — select b, d (a split pane) and f, then group them as "new".
    const tabs: GroupableTab[] = [
      { id: 'a', groupId: null, pinned: false, spaceId: 'x', splitId: null },
      { id: 'b', groupId: 'new', pinned: false, spaceId: 'x', splitId: null },
      { id: 'c', groupId: 'g1', pinned: false, spaceId: 'x', splitId: null },
      { id: 'd', groupId: 'new', pinned: false, spaceId: 'x', splitId: 's' },
      { id: 'e', groupId: null, pinned: false, spaceId: 'x', splitId: 's' },
      { id: 'f', groupId: 'new', pinned: false, spaceId: 'x', splitId: null }
    ]
    const result = normalizeTabGroups(tabs, [createTabGroup('g1', []), createTabGroup('new', [])])
    // The split's partner follows its first pane into the new group; the group is one run.
    expect(result.groupOf.get('e')).toBe('new')
    expect(result.order).toEqual(['a', 'b', 'd', 'e', 'f', 'c'])
  })
})
