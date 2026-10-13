import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addArchivedTabs,
  applyTabArchiveSettingsPatch,
  archiveAfterMs,
  archiveBlocker,
  DEFAULT_TAB_ARCHIVE_SETTINGS,
  duplicateKey,
  findDuplicateTabs,
  findOpenTabForUrl,
  formatArchivedAge,
  MAX_ARCHIVED_TABS,
  MAX_ARCHIVED_WITH_PAGE_STATE,
  parseArchivedTabs,
  parseTabActivity,
  parseTabArchiveSettings,
  restoredInactiveSince,
  sanitizeArchivedTab,
  searchArchivedTabs,
  selectTabsToArchive,
  tabActivitySnapshot,
  type ArchivedTab,
  type DuplicateCandidate,
  type TabArchiveCandidate
} from './tab-archive.ts'
import { buildPaletteItems, type PaletteSources } from './command-palette.ts'
import { DEFAULT_CUSTOM_SEARCH_ENGINES } from './search-keywords.ts'
import type { BrowserTabSummary } from './types.ts'

const HOUR = 60 * 60_000
const NOW = 1_800_000_000_000

const candidate = (id: string, extra: Partial<TabArchiveCandidate> = {}): TabArchiveCandidate => ({
  id, url: `https://example.com/${id}`, pinned: false, active: false, audible: false, private: false, extensionPage: false, unsavedPdfEdits: false, inactiveSince: NOW - 30 * HOUR, ...extra
})

const archived = (id: string, archivedAt: number, extra: Partial<ArchivedTab> = {}): ArchivedTab => ({
  id, url: `https://example.com/${id}`, title: `Page ${id}`, faviconUrl: null, archivedAt, reason: 'auto', ...extra
})

// ---------------------------------------------------------------------------
// Eligibility

test('auto-archive never takes pinned, active, audible, private, extension, unsaved PDF or non-web tabs', () => {
  assert.equal(archiveBlocker(candidate('a')), null)
  assert.equal(archiveBlocker(candidate('a', { pinned: true })), 'pinned')
  assert.equal(archiveBlocker(candidate('a', { active: true })), 'active')
  assert.equal(archiveBlocker(candidate('a', { audible: true })), 'audible')
  assert.equal(archiveBlocker(candidate('a', { private: true })), 'private')
  assert.equal(archiveBlocker(candidate('a', { extensionPage: true })), 'extension')
  assert.equal(archiveBlocker(candidate('a', { unsavedPdfEdits: true })), 'pdf-edits')
  assert.equal(archiveBlocker(candidate('a', { url: 'surffish://quick-links' })), 'not-web')
  assert.equal(archiveBlocker(candidate('a', { url: 'file:///tmp/a.pdf' })), 'not-web')
})

test('manual Archive Tab may take pinned, active and audible tabs but never private ones', () => {
  assert.equal(archiveBlocker(candidate('a', { pinned: true, active: true, audible: true }), true), null)
  assert.equal(archiveBlocker(candidate('a', { unsavedPdfEdits: true }), true), null)
  assert.equal(archiveBlocker(candidate('a', { private: true }), true), 'private')
  assert.equal(archiveBlocker(candidate('a', { extensionPage: true }), true), 'extension')
  assert.equal(archiveBlocker(candidate('a', { url: 'surffish://quick-links' }), true), 'not-web')
})

test('selects only eligible tabs idle for at least the threshold', () => {
  const tabs = [
    candidate('old', { inactiveSince: NOW - 25 * HOUR }),
    candidate('exact', { inactiveSince: NOW - 24 * HOUR }),
    candidate('recent', { inactiveSince: NOW - 23 * HOUR }),
    candidate('active', { active: true, inactiveSince: null }),
    candidate('pinned', { pinned: true }),
    candidate('playing', { audible: true }),
    candidate('private', { private: true }),
    candidate('pdf', { unsavedPdfEdits: true })
  ]
  assert.deepEqual(selectTabsToArchive(tabs, NOW, archiveAfterMs('24h')), ['old', 'exact'])
  assert.deepEqual(selectTabsToArchive(tabs, NOW, archiveAfterMs('12h')), ['old', 'exact', 'recent'])
  assert.deepEqual(selectTabsToArchive(tabs, NOW, archiveAfterMs('7d')), [])
  assert.deepEqual(selectTabsToArchive(tabs, NOW, archiveAfterMs('off')), [])
  assert.deepEqual(selectTabsToArchive(tabs, NOW, 0), [])
})

test('settings parse with safe defaults (off, not prompted) and patch only valid fields', () => {
  assert.deepEqual(parseTabArchiveSettings(null), DEFAULT_TAB_ARCHIVE_SETTINGS)
  assert.equal(DEFAULT_TAB_ARCHIVE_SETTINGS.archiveAfter, 'off')
  assert.deepEqual(parseTabArchiveSettings({ archiveAfter: '3h', prompted: 'yes', switchToOpenTab: true }), { archiveAfter: 'off', prompted: false, switchToOpenTab: true })
  const next = applyTabArchiveSettingsPatch(DEFAULT_TAB_ARCHIVE_SETTINGS, { archiveAfter: '7d', prompted: true, switchToOpenTab: 1 })
  assert.deepEqual(next, { archiveAfter: '7d', prompted: true, switchToOpenTab: false })
  assert.equal(applyTabArchiveSettingsPatch(next, 'nope'), next)
})

// ---------------------------------------------------------------------------
// Restart-safe activity

test('activity snapshot keeps the latest use per URL and skips private/non-web tabs', () => {
  const snapshot = tabActivitySnapshot([
    candidate('a', { url: 'https://a.test/#one', inactiveSince: NOW - 5 * HOUR }),
    candidate('b', { url: 'https://a.test/#two', inactiveSince: NOW - 2 * HOUR }),
    candidate('c', { url: 'https://c.test/', active: true, inactiveSince: null }),
    candidate('d', { url: 'https://d.test/', private: true }),
    candidate('e', { url: 'surffish://quick-links' })
  ], NOW)
  assert.deepEqual(snapshot, { 'https://a.test/': NOW - 2 * HOUR, 'https://c.test/': NOW })
  const activity = parseTabActivity({ ...snapshot, 'javascript:alert(1)': 5, 'https://bad.test/': 'x' })
  assert.equal(activity.size, 2)
  assert.equal(restoredInactiveSince(activity, 'https://a.test/#three', NOW + HOUR), NOW - 2 * HOUR)
  assert.equal(restoredInactiveSince(activity, 'https://unknown.test/', NOW + HOUR), NOW + HOUR)
  // A saved time in the future (clock change) falls back to now.
  assert.equal(restoredInactiveSince(activity, 'https://c.test/', NOW - HOUR), NOW - HOUR)
})

// ---------------------------------------------------------------------------
// The list: sanitizing, cap and eviction

test('sanitizes stored entries: strips credentials from URLs, drops invalid ones, caps titles', () => {
  assert.equal(sanitizeArchivedTab({ id: 'x', url: 'javascript:alert(1)', archivedAt: NOW }), null)
  assert.equal(sanitizeArchivedTab({ id: 'x', url: 'https://user:pw@a.test/', archivedAt: NOW }), null)
  assert.equal(sanitizeArchivedTab({ id: '../x', url: 'https://a.test/', archivedAt: NOW }), null)
  assert.equal(sanitizeArchivedTab({ id: 'x', url: 'https://a.test/', archivedAt: -1 }), null)
  const tab = sanitizeArchivedTab({ id: 'x', url: 'https://a.test/page?token=secret&q=1', title: `  ${'t'.repeat(500)} `, archivedAt: NOW, faviconUrl: 'javascript:1', reason: 'weird' })!
  assert.equal(tab.url, 'https://a.test/page?q=1')
  assert.equal(tab.title.length, 300)
  assert.equal(tab.faviconUrl, null)
  assert.equal(tab.reason, 'auto')
  assert.equal(sanitizeArchivedTab({ id: 'y', url: 'https://a.test/', archivedAt: NOW })!.title, 'a.test')
})

test('keeps a bounded back/forward list and page state only for the current, unmodified entry', () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({ url: `https://a.test/${index}`, title: `P${index}`, pageState: `state${index}` }))
  const tab = sanitizeArchivedTab({ id: 'x', url: 'https://a.test/25', archivedAt: NOW, history: { entries, index: 25 } })!
  assert.ok(tab.history)
  assert.equal(tab.history.entries.length, 10)
  assert.equal(tab.history.entries[tab.history.index]!.url, 'https://a.test/25')
  assert.equal(tab.history.entries[tab.history.index]!.pageState, 'state25')
  assert.equal(tab.history.entries.filter((entry) => entry.pageState).length, 1)
  // Oversized page state is dropped.
  const big = sanitizeArchivedTab({ id: 'x', url: 'https://a.test/1', archivedAt: NOW, history: { entries: [{ url: 'https://a.test/0', title: '' }, { url: 'https://a.test/1', title: '', pageState: 'x'.repeat(20_000) }], index: 1 } })!
  assert.equal(big.history!.entries[1]!.pageState, undefined)
  // A URL that had secrets stripped can't keep its page state.
  const stripped = sanitizeArchivedTab({ id: 'x', url: 'https://a.test/?token=1', archivedAt: NOW, history: { entries: [{ url: 'https://a.test/?token=1', title: '', pageState: 's' }], index: 0 } })!
  assert.equal(stripped.history, undefined)
  // History that doesn't end at the archived URL is ignored.
  assert.equal(sanitizeArchivedTab({ id: 'x', url: 'https://a.test/9', archivedAt: NOW, history: { entries: entries.slice(0, 3), index: 1 } })!.history, undefined)
})

test('adding moves re-archived URLs to the top and caps the list, evicting the oldest', () => {
  const start = Array.from({ length: MAX_ARCHIVED_TABS }, (_, index) => archived(`t${index}`, NOW - index * 1000))
  assert.equal(parseArchivedTabs(start).length, MAX_ARCHIVED_TABS)
  const next = addArchivedTabs(start, [archived('new', NOW + 1000), archived('again', NOW + 2000, { url: 'https://example.com/t3#frag' })])
  assert.equal(next.length, MAX_ARCHIVED_TABS)
  assert.deepEqual(next.slice(0, 3).map((tab) => tab.id), ['again', 'new', 't0'])
  assert.ok(!next.some((tab) => tab.id === 't3'), 'the older copy of a re-archived URL is gone')
  assert.ok(!next.some((tab) => tab.id === `t${MAX_ARCHIVED_TABS - 1}`), 'the oldest entry is evicted')
  assert.ok(next.some((tab) => tab.id === `t${MAX_ARCHIVED_TABS - 2}`))
})

test('only the newest entries keep page state', () => {
  const withState = (id: string, at: number): ArchivedTab => archived(id, at, { history: { entries: [{ url: `https://example.com/${id}`, title: id, pageState: 'scroll' }], index: 0 } })
  const list = addArchivedTabs([], Array.from({ length: MAX_ARCHIVED_WITH_PAGE_STATE + 5 }, (_, index) => withState(`s${index}`, NOW - index)))
  assert.equal(list[0]!.history!.entries[0]!.pageState, 'scroll')
  assert.equal(list[MAX_ARCHIVED_WITH_PAGE_STATE - 1]!.history!.entries[0]!.pageState, 'scroll')
  assert.equal(list[MAX_ARCHIVED_WITH_PAGE_STATE]!.history!.entries[0]!.pageState, undefined)
  assert.equal(list[MAX_ARCHIVED_WITH_PAGE_STATE]!.history!.entries[0]!.url, `https://example.com/s${MAX_ARCHIVED_WITH_PAGE_STATE}`)
})

test('parse ignores junk and duplicate ids', () => {
  const parsed = parseArchivedTabs([archived('a', NOW), null, 'x', archived('a', NOW - 5, { url: 'https://other.test/' }), { id: 'b' }])
  assert.deepEqual(parsed.map((tab) => tab.id), ['a'])
  assert.deepEqual(parseArchivedTabs({}), [])
})

test('search ranks title/host matches and returns everything for an empty query', () => {
  const list = [archived('a', NOW, { title: 'Rust book', url: 'https://doc.rust-lang.org/book/' }), archived('b', NOW - 1, { title: 'Weather', url: 'https://bom.gov.au/' })]
  assert.deepEqual(searchArchivedTabs(list, '').map((tab) => tab.id), ['a', 'b'])
  assert.deepEqual(searchArchivedTabs(list, 'rust').map((tab) => tab.id), ['a'])
  assert.deepEqual(searchArchivedTabs(list, 'bom').map((tab) => tab.id), ['b'])
  assert.deepEqual(searchArchivedTabs(list, 'zzzz'), [])
})

test('formats archive ages', () => {
  assert.equal(formatArchivedAge(NOW, NOW), 'just now')
  assert.equal(formatArchivedAge(NOW - 5 * 60_000, NOW), '5m ago')
  assert.equal(formatArchivedAge(NOW - 3 * HOUR, NOW), '3h ago')
  assert.equal(formatArchivedAge(NOW - 50 * HOUR, NOW), '2d ago')
})

// ---------------------------------------------------------------------------
// Duplicates

const open = (id: string, url: string, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({ id, url, active: false, pinned: false, private: false, ...extra })

test('duplicate key ignores the fragment only', () => {
  assert.equal(duplicateKey('https://a.test/x?q=1#top'), 'https://a.test/x?q=1')
  assert.equal(duplicateKey('https://A.test/x'), 'https://a.test/x')
  assert.notEqual(duplicateKey('https://a.test/x?q=1'), duplicateKey('https://a.test/x?q=2'))
  assert.notEqual(duplicateKey('http://a.test/'), duplicateKey('https://a.test/'))
})

test('finds duplicates, keeping the active, else pinned, else first tab; private and regular never merge', () => {
  const tabs = [
    open('1', 'https://a.test/'),
    open('2', 'https://a.test/#section'),
    open('3', 'https://a.test/', { active: true }),
    open('4', 'https://b.test/'),
    open('5', 'https://b.test/', { pinned: true }),
    open('6', 'https://c.test/'),
    open('7', 'https://c.test/'),
    open('8', 'https://c.test/', { private: true }),
    open('9', 'surffish://quick-links'),
    open('10', 'surffish://quick-links')
  ]
  assert.deepEqual(findDuplicateTabs(tabs).sort(), ['1', '2', '4', '7'])
  // Pinned duplicates are never closed.
  assert.deepEqual(findDuplicateTabs([open('1', 'https://a.test/', { pinned: true }), open('2', 'https://a.test/', { pinned: true })]), [])
  assert.deepEqual(findDuplicateTabs([]), [])
})

test('finds an open tab for an omnibox URL in the same private mode, excluding the current tab', () => {
  const tabs = [open('cur', 'https://a.test/', { active: true }), open('x', 'https://a.test/#y'), open('p', 'https://b.test/', { private: true })]
  assert.equal(findOpenTabForUrl(tabs, 'https://a.test/', { excludeId: 'cur' })?.id, 'x')
  assert.equal(findOpenTabForUrl(tabs, 'https://b.test/'), null)
  assert.equal(findOpenTabForUrl(tabs, 'https://b.test/', { private: true })?.id, 'p')
  assert.equal(findOpenTabForUrl(tabs, 'surffish://quick-links'), null)
})

// ---------------------------------------------------------------------------
// Palette integration

const summary = (id: string, title: string, url: string, extra: Partial<BrowserTabSummary> = {}): BrowserTabSummary => ({ id, title, url, faviconUrl: null, loading: false, active: false, pinned: false, sleeping: false, audible: false, muted: false, private: false, ...extra })

const paletteSources = (patch: Partial<PaletteSources>): PaletteSources => ({
  query: '', mode: 'all', commands: [], recentCommandIds: [], tabs: [], pinnedSites: [], history: [],
  searchEngines: DEFAULT_CUSTOM_SEARCH_ENGINES, defaultSearchLabel: 'Brave Search', platform: 'darwin', now: NOW, ...patch
})

test('palette tab search lists archived tabs as a group after open tabs, skipping open URLs', () => {
  // Newest first, as main keeps them.
  const archivedTabs = [
    archived('o', NOW - HOUR, { title: 'Rust playground', url: 'https://play.rust-lang.org/' }),
    archived('r', NOW - 3 * HOUR, { title: 'Rust book', url: 'https://doc.rust-lang.org/book/' })
  ]
  const tabs = [summary('t', 'Rust blog', 'https://blog.rust-lang.org/'), summary('u', 'Rust playground', 'https://play.rust-lang.org/#x')]
  const items = buildPaletteItems(paletteSources({ mode: 'tabs', query: 'rust', tabs, archivedTabs }))
  assert.deepEqual(items.map((item) => item.kind), ['tab', 'tab', 'archived'])
  const last = items[2]!
  assert.equal(last.kind === 'archived' && last.archivedId, 'r')
  assert.match(last.subtitle, /^Archived 3h ago · doc\.rust-lang\.org$/)
  // Empty query: open tabs, then the newest archived ones.
  const browse = buildPaletteItems(paletteSources({ mode: 'tabs', tabs: [], archivedTabs }))
  assert.deepEqual(browse.map((item) => item.key), ['archived:o', 'archived:r'])
})

test('palette "all" mode mixes archived results in ahead of the same page in history', () => {
  const archivedTabs = [archived('r', NOW, { title: 'Rust book', url: 'https://doc.rust-lang.org/book/' })]
  const history = [{ id: 'h', url: 'https://doc.rust-lang.org/book/', title: 'Rust book', visitedAt: NOW }]
  const items = buildPaletteItems(paletteSources({ query: 'rust book', archivedTabs, history }))
  assert.deepEqual(items.filter((item) => item.kind !== 'search').map((item) => item.key), ['archived:r'])
  // Without archived tabs the palette behaves as before.
  assert.deepEqual(buildPaletteItems(paletteSources({ query: 'rust book', history })).filter((item) => item.kind !== 'search').map((item) => item.key), ['history:https://doc.rust-lang.org/book/'])
})
