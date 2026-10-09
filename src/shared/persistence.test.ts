import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RESTORED_TABS,
  DEFAULT_TAB_SLEEP_MINUTES,
  normalizeBrowserSession,
  parseBrowserPreferences,
  parseBrowserSession
} from './persistence.ts'

test('normalizes a saved tab list and retains its selected tab', () => {
  assert.deepEqual(normalizeBrowserSession(['https://one.test/', 'https://two.test/'], 1), {
    urls: ['https://one.test/', 'https://two.test/'],
    activeIndex: 1
  })
})

test('drops unsafe URLs and adjusts the selected index', () => {
  assert.deepEqual(normalizeBrowserSession(['file:///etc/passwd', 'https://safe.test/'], 1), {
    urls: ['https://safe.test/'],
    activeIndex: 0
  })
})

test('rejects invalid session data and bounds restored tab count', () => {
  const urls = Array.from({ length: MAX_RESTORED_TABS + 5 }, (_, index) => `https://site${index}.test/`)
  const parsed = parseBrowserSession({ version: 1, tabs: urls, activeIndex: MAX_RESTORED_TABS + 3 })
  assert.equal(parsed.urls.length, MAX_RESTORED_TABS)
  assert.equal(parsed.activeIndex, 0)
  assert.deepEqual(parseBrowserSession({ version: 2, tabs: ['https://ignored.test/'] }), { urls: [], activeIndex: 0 })
})

test('falls back to the default search engine for invalid preferences', () => {
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google' }).searchEngine, 'google')
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'unknown' }).searchEngine, 'brave')
})

test('uses a validated default tab-sleep interval for new and older preferences', () => {
  assert.equal(parseBrowserPreferences(null).tabSleepMinutes, DEFAULT_TAB_SLEEP_MINUTES)
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google' }).tabSleepMinutes, DEFAULT_TAB_SLEEP_MINUTES)
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google', tabSleepMinutes: 15 }).tabSleepMinutes, 15)
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google', tabSleepMinutes: 10 }).tabSleepMinutes, DEFAULT_TAB_SLEEP_MINUTES)
})
