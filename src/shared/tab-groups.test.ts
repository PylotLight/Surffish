import { describe, expect, test } from 'bun:test'
import {
  createTabGroup,
  dropTargetGroup,
  encodeSessionTabGroups,
  nextTabGroupColor,
  normalizeTabGroupName,
  normalizeTabGroups,
  parseSavedTabGroups,
  remapSavedTabGroups,
  tabGroupInfoFor,
  tabGroupLabel,
  updateTabGroup,
  withGroupHeaders,
  type GroupableTab,
  type TabGroup
} from './tab-groups'
import { normalizeWindowsSession, parseWindowsSession, serializeWindowsSession } from './window-session'
import { sanitizeArchivedTab } from './tab-archive'

const g = (id: string, extra: Partial<TabGroup> = {}): TabGroup => ({ id, name: id.toUpperCase(), color: 'blue', collapsed: false, ...extra })
const t = (id: string, groupId: string | null = null, extra: Partial<GroupableTab> = {}): GroupableTab => ({ id, groupId, pinned: false, spaceId: 'default', splitId: null, ...extra })

describe('tab group model', () => {
  test('create picks a free colour; names are cleaned; labels fall back to the colour', () => {
    const first = createTabGroup('a', [])
    expect(first).toEqual({ id: 'a', name: '', color: 'blue', collapsed: false })
    expect(nextTabGroupColor([first])).toBe('red')
    expect(createTabGroup('b', [first], { name: '  Work   stuff ', color: 'green' })).toMatchObject({ name: 'Work stuff', color: 'green' })
    expect(normalizeTabGroupName('x'.repeat(80))).toHaveLength(40)
    expect(tabGroupLabel(first)).toBe('Blue group')
    expect(tabGroupLabel({ name: 'Work', color: 'red' })).toBe('Work')
  })

  test('update renames, recolours, collapses and ignores junk', () => {
    const group = g('a')
    expect(updateTabGroup(group, { name: 'News', color: 'pink', collapsed: true })).toEqual({ id: 'a', name: 'News', color: 'pink', collapsed: true })
    expect(updateTabGroup(group, { color: 'chartreuse', collapsed: 'yes' })).toEqual(group)
  })

  test('normalize gathers a group into one run at its first tab', () => {
    const result = normalizeTabGroups([t('1', 'a'), t('2'), t('3', 'a'), t('4')], [g('a')])
    expect(result.order).toEqual(['1', '3', '2', '4'])
    expect(result.groups.map((group) => group.id)).toEqual(['a'])
  })

  test('pinned tabs, unknown groups and other Spaces leave; empty groups go', () => {
    const result = normalizeTabGroups([
      t('1', 'a', { pinned: true }),
      t('2', 'a'),
      t('3', 'gone'),
      t('4', 'a', { spaceId: 'work' })
    ], [g('a'), g('empty')])
    expect(Object.fromEntries(result.groupOf)).toEqual({ 1: null, 2: 'a', 3: null, 4: null })
    expect(result.groups.map((group) => group.id)).toEqual(['a'])
  })

  test('a split stays inside one group (its first pane decides)', () => {
    const result = normalizeTabGroups([t('1', 'a', { splitId: 's' }), t('2', null, { splitId: 's' }), t('3', 'b', { splitId: 'x' }), t('4', 'a', { splitId: 'x' })], [g('a'), g('b')])
    expect(result.groupOf.get('2')).toBe('a')
    expect(result.groupOf.get('4')).toBe('b')
  })

  test('sidebar info and headers; collapsed runs are hidden', () => {
    expect(tabGroupInfoFor(g('a'), ['1', '2'], '2')).toEqual({ id: 'a', name: 'A', color: 'blue', collapsed: false, index: 1, count: 2 })
    const info = (id: string, collapsed = false) => ({ id, name: '', color: 'blue' as const, collapsed, index: 0, count: 2 })
    const entries = [{ key: '1' }, { key: '2', group: info('a') }, { key: '3', group: info('a') }, { key: '4', group: info('b', true) }, { key: '5', group: info('b', true) }, { key: '6' }]
    expect(withGroupHeaders(entries, (entry) => entry.group).map((entry) => entry.key)).toEqual(['1', 'group:a', '2', '3', 'group:b', '6'])
  })

  test('drop target: under a header or between two of its tabs joins; edges and collapsed headers stay out', () => {
    const groupOf = (key: string): string | null => ({ 1: 'a', 2: 'a', 3: null } as Record<string, string | null>)[key] ?? null
    const collapsed = (id: string): boolean => id === 'c'
    expect(dropTargetGroup(['group:a', 'x', '1', '2', '3'], 'x', groupOf, collapsed)).toBe('a')
    expect(dropTargetGroup(['group:a', '1', 'x', '2', '3'], 'x', groupOf, collapsed)).toBe('a')
    expect(dropTargetGroup(['group:a', '1', '2', 'x', '3'], 'x', groupOf, collapsed)).toBeNull()
    expect(dropTargetGroup(['x', 'group:a', '1', '2'], 'x', groupOf, collapsed)).toBeNull()
    expect(dropTargetGroup(['group:c', 'x', '3'], 'x', groupOf, collapsed)).toBeNull()
    expect(dropTargetGroup(['1', '2', 'x'], 'x', groupOf, collapsed)).toBeNull()
  })
})

describe('tab group session', () => {
  const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/', 'https://d.example/']

  test('encode → save → parse round-trips', () => {
    const groups = encodeSessionTabGroups(['1', '2', '3', '4'], (id) => (id === '2' || id === '3' ? 'a' : null), [g('a', { name: 'News', color: 'green', collapsed: true })])
    expect(groups).toEqual([{ tabs: [1, 2], name: 'News', color: 'green', collapsed: true }])
    const session = normalizeWindowsSession([{ urls, activeIndex: 0, pinnedIndexes: [], geometry: null, groups }], 0)
    const parsed = parseWindowsSession(JSON.parse(JSON.stringify(serializeWindowsSession(session))))
    expect(parsed.windows[0]!.groups).toEqual(groups)
  })

  test('older sessions have no groups and nothing extra is written without groups', () => {
    const session = parseWindowsSession({ version: 1, tabs: urls, activeIndex: 0, pinnedTabs: [] })
    expect(session.windows[0]!.groups).toBeUndefined()
    expect(JSON.stringify(serializeWindowsSession(session))).not.toContain('groups')
  })

  test('re-points groups when unsafe tabs are dropped', () => {
    const session = normalizeWindowsSession([{ urls: ['https://a.example/', 'javascript:x', 'https://c.example/', 'https://d.example/'], activeIndex: 0, pinnedIndexes: [], geometry: null, groups: [{ tabs: [1, 2, 3], name: 'G', color: 'red', collapsed: false }] }], 0)
    expect(session.windows[0]!.groups).toEqual([{ tabs: [1, 2], name: 'G', color: 'red', collapsed: false }])
  })

  test('untrusted groups: out of range, overlapping, pinned or non-contiguous are dropped', () => {
    expect(parseSavedTabGroups([
      { tabs: [0, 1], name: 'ok', color: 'blue' },
      { tabs: [1, 2], name: 'overlap' },
      { tabs: [3], name: 'pinned' },
      { tabs: [9] },
      { tabs: [2, 4], name: 'gap' },
      'junk'
    ], 5, [3])).toEqual([{ tabs: [0, 1], name: 'ok', color: 'blue', collapsed: false }])
    expect(remapSavedTabGroups([{ tabs: [0, 1], name: '', color: 'grey', collapsed: false }], (index) => index === 0 ? -1 : 0)).toEqual([{ tabs: [0], name: '', color: 'grey', collapsed: false }])
  })

  test('the archive keeps a tab\'s group label', () => {
    const entry = sanitizeArchivedTab({ id: 'x1', url: 'https://a.example/', title: 'A', archivedAt: 5, groupName: 'News', groupColor: 'green' })
    expect(entry).toMatchObject({ groupName: 'News', groupColor: 'green' })
    expect(sanitizeArchivedTab({ id: 'x1', url: 'https://a.example/', title: 'A', archivedAt: 5, groupName: 'News', groupColor: '<b>' })?.groupName).toBeUndefined()
  })
})
