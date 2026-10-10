import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAddressSuggestions } from './autocomplete.ts'
import type { BrowserTabSummary, BrowsingHistoryEntry, PinnedSite } from './types'

const pins: PinnedSite[] = [{ title: 'GitHub', url: 'https://github.com/' }]
const tabs: BrowserTabSummary[] = [
  { id: 'tab-1', title: 'GitHub · Sockfish', url: 'https://github.com/PylotLight/Sockfish', active: true, loading: false, sleeping: false },
  { id: 'tab-2', title: 'Example', url: 'https://example.org/', active: false, loading: false, sleeping: false }
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
    'https://github.com/PylotLight/Sockfish',
    'https://docs.github.com/'
  ])
})

test('matches hostnames and titles case-insensitively and removes duplicate URLs', () => {
  const duplicateHistory: BrowsingHistoryEntry[] = [
    { id: 'history-duplicate', title: 'Duplicate GitHub tab', url: 'https://github.com/PylotLight/Sockfish', visitedAt: 4 },
    ...history
  ]
  const results = buildAddressSuggestions('  GITHUB.COM  ', pins, tabs, duplicateHistory)
  assert.equal(results.length, 3)
  assert.equal(results[0]?.source, 'Pinned site')
  assert.equal(results.filter((result) => result.url === 'https://github.com/PylotLight/Sockfish').length, 1)
})

test('returns no suggestions for a blank query or unsafe local data', () => {
  assert.deepEqual(buildAddressSuggestions(' ', pins, tabs, history), [])
  assert.deepEqual(buildAddressSuggestions('alert', [], [], history), [])
})

test('respects the result limit', () => {
  assert.equal(buildAddressSuggestions('github', pins, tabs, history, 2).length, 2)
})
