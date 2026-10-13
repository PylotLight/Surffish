import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAddressSuggestions } from './autocomplete.ts'
import type { BrowserTabSummary, BrowsingHistoryEntry, PinnedSite } from './types'

const pins: PinnedSite[] = [{ title: 'GitHub', url: 'https://github.com/' }]
const tabs: BrowserTabSummary[] = [
  { id: 'tab-1', title: 'GitHub · Surffish', url: 'https://github.com/PylotLight/Surffish', faviconUrl: null, active: true, pinned: false, loading: false, sleeping: false, audible: false, muted: false, private: false },
  { id: 'tab-2', title: 'Example', url: 'https://example.org/', faviconUrl: null, active: false, pinned: false, loading: false, sleeping: false, audible: false, muted: false, private: false }
]
const history: BrowsingHistoryEntry[] = [
  { id: 'history-1', title: 'GitHub docs', url: 'https://docs.github.com/', visitedAt: 3 },
  { id: 'history-2', title: 'Unsafe', url: 'javascript:alert(1)', visitedAt: 2 }
]

test('ranks pinned sites before open tabs and history without remote suggestions', () => {
  const results = buildAddressSuggestions('github', pins, tabs, history)
  assert.deepEqual(results.map((result) => result.source), ['Pinned site', 'Open tab', 'History'])
  assert.deepEqual(results.map((result) => result.url), [
    'https://github.com/',
    'https://github.com/PylotLight/Surffish',
    'https://docs.github.com/'
  ])
})

test('matches hostnames and titles case-insensitively and removes duplicate URLs', () => {
  const duplicateHistory: BrowsingHistoryEntry[] = [
    { id: 'history-duplicate', title: 'Duplicate GitHub tab', url: 'https://github.com/PylotLight/Surffish', visitedAt: 4 },
    ...history
  ]
  const results = buildAddressSuggestions('  GITHUB.COM  ', pins, tabs, duplicateHistory)
  assert.equal(results.length, 3)
  assert.equal(results[0]?.source, 'Pinned site')
  assert.equal(results.filter((result) => result.url === 'https://github.com/PylotLight/Surffish').length, 1)
})

test('returns no suggestions for a blank query or unsafe local data', () => {
  assert.deepEqual(buildAddressSuggestions(' ', pins, tabs, history), [])
  assert.deepEqual(buildAddressSuggestions('alert', [], [], history), [])
})

test('respects the result limit', () => {
  assert.equal(buildAddressSuggestions('github', pins, tabs, history, 2).length, 2)
})

test('bookmarks rank above open tabs and history, after pinned sites', () => {
  const results = buildAddressSuggestions('github', pins, tabs, history, 7, [
    { title: 'GitHub', url: 'https://github.com/' },
    { title: 'Surffish repo', url: 'https://github.com/PylotLight/Surffish' },
    { title: 'Docs', url: 'https://docs.github.com/' }
  ])
  assert.deepEqual(results.map((result) => [result.source, result.url]), [
    ['Pinned site', 'https://github.com/'],
    ['Bookmark', 'https://github.com/PylotLight/Surffish'],
    ['Bookmark', 'https://docs.github.com/']
  ])
})
