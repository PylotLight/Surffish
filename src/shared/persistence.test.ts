import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_NEW_TAB_PAGE,
  DEFAULT_BROWSER_PROXY_SETTINGS,
  MAX_PINNED_SITES,
  MAX_RESTORED_TABS,
  DEFAULT_TAB_SLEEP_MINUTES,
  normalizeBrowserSession,
  normalizePinnedSites,
  parseBrowserProxySettings,
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

test('defaults fresh profiles to direct browsing while preserving valid saved SOCKS choices', () => {
  assert.deepEqual(DEFAULT_BROWSER_PROXY_SETTINGS, { enabled: false, host: '127.0.0.1', port: 1080 })
  assert.deepEqual(parseBrowserProxySettings(null), DEFAULT_BROWSER_PROXY_SETTINGS)
  assert.deepEqual(parseBrowserProxySettings({ enabled: true, host: 'localhost', port: 1080 }), {
    enabled: true, host: 'localhost', port: 1080
  })
  assert.deepEqual(parseBrowserProxySettings({ enabled: true, host: 'proxy.example', port: 1080 }), DEFAULT_BROWSER_PROXY_SETTINGS)
})

test('uses a validated default tab-sleep interval for new and older preferences', () => {
  assert.equal(parseBrowserPreferences(null).tabSleepMinutes, DEFAULT_TAB_SLEEP_MINUTES)
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google' }).tabSleepMinutes, DEFAULT_TAB_SLEEP_MINUTES)
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google', tabSleepMinutes: 15 }).tabSleepMinutes, 15)
  assert.equal(parseBrowserPreferences({ version: 1, searchEngine: 'google', tabSleepMinutes: 10 }).tabSleepMinutes, DEFAULT_TAB_SLEEP_MINUTES)
})

test('defaults older preference files to Bonjourr without losing existing settings', () => {
  const parsed = parseBrowserPreferences({ version: 1, searchEngine: 'google', tabSleepMinutes: 15 })
  assert.equal(parsed.newTabPage, DEFAULT_NEW_TAB_PAGE)
  assert.equal(parsed.searchEngine, 'google')
  assert.equal(parsed.tabSleepMinutes, 15)
  assert.deepEqual(parsed.pinnedSites, [])
  assert.deepEqual(parsed.siteSettings, {})
})

test('normalizes pins and rejects unsafe, credential-bearing, duplicate, or excessive URLs', () => {
  const pins = normalizePinnedSites([
    { title: '  GitHub  ', url: 'https://github.com' },
    { title: 'duplicate', url: 'https://github.com/' },
    { title: 'javascript', url: 'javascript:alert(1)' },
    { title: 'credentials', url: 'https://user:pass@example.test/' },
    ...Array.from({ length: MAX_PINNED_SITES + 2 }, (_, index) => ({ title: `Site ${index}`, url: `https://site${index}.test/` }))
  ])
  assert.equal(pins.length, MAX_PINNED_SITES)
  assert.deepEqual(pins[0], { title: 'GitHub', url: 'https://github.com/' })
  assert.ok(pins.every((pin) => pin.url.startsWith('https://')))
})

test('accepts only HTTP(S) site settings and defaults each site to blocking and denying permissions', () => {
  const parsed = parseBrowserPreferences({
    version: 1,
    newTabPage: 'search',
    pinnedSites: [{ title: '', url: 'https://example.test/path' }],
    siteSettings: {
      'https://example.test/path': { blockAds: false, allowMedia: true, allowNotifications: true },
      'file:///private': { blockAds: false },
      'https://credential:secret@invalid.test/': { allowGeolocation: true }
    }
  })
  assert.equal(parsed.newTabPage, 'search')
  assert.deepEqual(parsed.pinnedSites, [{ title: 'example.test', url: 'https://example.test/path' }])
  assert.deepEqual(parsed.siteSettings['https://example.test'], {
    origin: 'https://example.test', blockAds: false, openPopupsInTabs: false,
    allowMedia: true, allowGeolocation: false, allowNotifications: true
  })
  assert.equal(Object.keys(parsed.siteSettings).length, 1)
})
