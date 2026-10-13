import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_FEED_SETTINGS,
  GITHUB_API_MIN_INTERVAL_MINUTES,
  MAX_FEED_BACKOFF_MS,
  applyFeedFailure,
  applyFeedSuccess,
  createFeed,
  deferFeedCheck,
  describeFeedHttpError,
  discoverFeedLinks,
  dueFeeds,
  editFeed,
  effectiveIntervalMinutes,
  feedBackoffDelayMs,
  gitHubFeedUrl,
  gitHubSuggestionsForPage,
  listFeedItems,
  markFeedItemsRead,
  mergeFeedItems,
  nextFeedWakeDelay,
  normalizeFeedAddress,
  parseFeed,
  parseFeedStore,
  parseGitHubApiRunsUrl,
  parseGitHubRepo,
  redactFeedAddress,
  summarizeFeed,
  type Feed,
  type ParsedFeed,
  type ParsedFeedItem
} from './feeds.ts'

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
const NOW = Date.parse('2026-10-14T00:00:00Z')

function parsed(body: string, url = ''): ParsedFeed {
  const result = parseFeed(body, url)
  assert.ok(result.ok, result.ok ? '' : result.error)
  return result.feed
}

function newFeed(url = 'https://example.com/feed.xml', extra: Partial<Feed> = {}): Feed {
  const result = createFeed({ url }, [], 'feed-1', NOW)
  assert.ok(result.ok)
  return { ...result.feed, ...extra }
}

const item = (key: string, publishedAt: number | null = null): ParsedFeedItem => ({ key, title: key, link: `https://example.com/${key}`, publishedAt, author: '', summary: '' })

test('parses RSS 2.0: CDATA, entities, relative links, guids, dates, plain-text summaries', () => {
  const feed = parsed(fixture('feeds/rss2.xml'), 'https://games.example.com/feed.xml')
  assert.equal(feed.format, 'rss')
  assert.equal(feed.title, 'Patch Notes & News')
  assert.equal(feed.siteUrl, 'https://games.example.com/')
  assert.equal(feed.items.length, 4)
  const [first, second, third] = feed.items
  assert.equal(first!.title, 'Season 4 patch 1.2 is live')
  assert.equal(first!.key, 'games-news-1002')
  assert.equal(first!.link, 'https://games.example.com/news/season-4')
  assert.equal(first!.publishedAt, Date.parse('2026-10-13T09:30:00Z'))
  assert.equal(first!.author, 'Dev Team')
  assert.equal(first!.summary, 'New maps, balance changes.')
  assert.equal(second!.link, 'https://games.example.com/news/maintenance', 'relative link resolved against the channel link')
  assert.equal(second!.summary, 'Down for two hours.', 'scripts are dropped')
  assert.equal(third!.title, 'An item with no title, link or guid')
  assert.equal(third!.publishedAt, null)
  assert.ok(third!.key.length > 0)
})

test('parses RSS 1.0 (RDF)', () => {
  const feed = parsed(fixture('feeds/rss1.rdf'))
  assert.equal(feed.title, 'Old School RDF')
  assert.equal(feed.items[0]!.key, 'https://old.example.net/posts/1')
  assert.equal(feed.items[0]!.publishedAt, Date.parse('2026-10-01T12:00:00Z'))
})

test('parses Atom: html titles, alternate links, relative hrefs, authors', () => {
  const feed = parsed(fixture('feeds/atom.xml'), 'https://tv.example.org/atom.xml')
  assert.equal(feed.format, 'atom')
  assert.equal(feed.title, 'TV Episode Tracker')
  assert.equal(feed.siteUrl, 'https://tv.example.org/')
  assert.equal(feed.items[0]!.title, 'S02E05 The Return airs tonight')
  assert.equal(feed.items[0]!.link, 'https://tv.example.org/shows/1/s02e05', 'enclosure link is not the item link')
  assert.equal(feed.items[0]!.publishedAt, Date.parse('2026-10-12T21:00:00Z'))
  assert.equal(feed.items[0]!.author, 'Tracker Bot')
  assert.equal(feed.items[0]!.summary, 'Episode 5 of season 2.')
  assert.equal(feed.items[1]!.link, 'https://tv.example.org/shows/1/s02e04')
})

test('parses the GitHub releases Atom fixture the update checker uses (no second Atom parser)', () => {
  const feed = parsed(fixture('surffish-releases.atom'))
  assert.equal(feed.format, 'atom')
  assert.ok(feed.items.length >= 3)
  assert.ok(feed.items.some((entry) => entry.link === 'https://github.com/PylotLight/Surffish/releases/tag/v0.1.1'))
})

test('parses JSON Feed and drops non-http links', () => {
  const feed = parsed(fixture('feeds/jsonfeed.json'))
  assert.equal(feed.format, 'json')
  assert.equal(feed.title, 'JSON Blog')
  assert.equal(feed.items.length, 2)
  assert.equal(feed.items[0]!.summary, 'Hello world')
  assert.equal(feed.items[0]!.author, 'Ana')
  assert.equal(feed.items[1]!.link, '')
  assert.equal(feed.items[1]!.title, 'Untitled note body')
})

test('parses GitHub Actions workflow runs: completed runs only, keyed by run + attempt', () => {
  const feed = parsed(fixture('feeds/github-actions-runs.json'), 'https://api.github.com/repos/PylotLight/Surffish/actions/runs?per_page=20')
  assert.equal(feed.format, 'github-actions')
  assert.equal(feed.title, 'PylotLight/Surffish · Actions runs')
  assert.equal(feed.siteUrl, 'https://github.com/PylotLight/Surffish/actions')
  assert.deepEqual(feed.items.map((run) => run.key), ['run:9002:2', 'run:9001:1'])
  assert.equal(feed.items[0]!.title, 'ci #119 (attempt 2) ❌ failed · main')
  assert.equal(feed.items[0]!.summary, 'fix: CI stability · push')
  assert.equal(feed.items[0]!.link, 'https://github.com/PylotLight/Surffish/actions/runs/9002')
})

test('bad input is a result, never a throw', () => {
  for (const body of ['', '   ', '{not json', '[]', '{"hello":1}', 'plain text', '<html><head></head><body>x</body></html>', '<?xml version="1.0"?><foo/>']) {
    const result = parseFeed(body)
    assert.equal(result.ok, false, body)
  }
  const html = parseFeed(fixture('feeds/page-with-feeds.html'))
  assert.ok(!html.ok && html.html, 'an HTML page is flagged so the caller can try discovery')
})

test('discovers feed links in a page: types, relative hrefs, dupes and junk dropped', () => {
  const found = discoverFeedLinks(fixture('feeds/page-with-feeds.html'), 'https://example.com/blog/')
  assert.deepEqual(found, [
    { url: 'https://example.com/feed.xml', title: 'Site & News', type: 'rss' },
    { url: 'https://example.com/atom.xml', title: 'Atom feed', type: 'atom' },
    { url: 'https://example.com/blog/feed.json', title: 'JSON', type: 'json' }
  ])
})

test('feed address normalization', () => {
  assert.equal(normalizeFeedAddress('example.com/feed'), 'https://example.com/feed')
  assert.equal(normalizeFeedAddress('feed://example.com/rss'), 'https://example.com/rss')
  assert.equal(normalizeFeedAddress('feed:https://example.com/rss'), 'https://example.com/rss')
  assert.equal(normalizeFeedAddress('http://example.com/rss#top'), 'http://example.com/rss')
  assert.equal(normalizeFeedAddress('file:///etc/passwd'), null)
  assert.equal(normalizeFeedAddress('javascript:alert(1)'), null)
  assert.equal(normalizeFeedAddress(42), null)
  assert.equal(normalizeFeedAddress(`https://example.com/${'a'.repeat(3000)}`), null)
  assert.equal(redactFeedAddress('https://user:pw@example.com/feed?token=x'), 'https://example.com/feed?…')
})

test('GitHub helpers', () => {
  assert.deepEqual(parseGitHubRepo('PylotLight/Surffish'), { owner: 'PylotLight', repo: 'Surffish' })
  assert.deepEqual(parseGitHubRepo('https://github.com/PylotLight/Surffish/pull/1'), { owner: 'PylotLight', repo: 'Surffish' })
  assert.deepEqual(parseGitHubRepo('github.com/a/b.git'), { owner: 'a', repo: 'b' })
  assert.equal(parseGitHubRepo('nope'), null)
  assert.equal(parseGitHubRepo('a/b/c'), null)
  assert.equal(parseGitHubRepo('a/..'), null)
  assert.equal(gitHubFeedUrl('o', 'r', 'releases'), 'https://github.com/o/r/releases.atom')
  assert.equal(gitHubFeedUrl('o', 'r', 'commits'), 'https://github.com/o/r/commits.atom')
  assert.equal(gitHubFeedUrl('o', 'r', 'commits', 'feat/x'), 'https://github.com/o/r/commits/feat/x.atom')
  assert.equal(gitHubFeedUrl('o', 'r', 'tags'), 'https://github.com/o/r/tags.atom')
  assert.equal(gitHubFeedUrl('o', 'r', 'actions'), 'https://api.github.com/repos/o/r/actions/runs?per_page=20')
  assert.equal(gitHubFeedUrl('o', 'r', 'actions', 'main'), 'https://api.github.com/repos/o/r/actions/runs?per_page=20&branch=main')
  assert.deepEqual(parseGitHubApiRunsUrl('https://api.github.com/repos/o/r/actions/runs?per_page=20'), { owner: 'o', repo: 'r' })
  assert.equal(parseGitHubApiRunsUrl('https://github.com/o/r'), null)
  assert.equal(gitHubSuggestionsForPage('https://github.com/PylotLight/Surffish/pulls').length, 4)
  assert.equal(gitHubSuggestionsForPage('https://github.com/settings/profile').length, 0)
  assert.equal(gitHubSuggestionsForPage('https://example.com/a/b').length, 0)
})

test('create and edit feeds: validation is a result', () => {
  assert.deepEqual(createFeed({ url: 'ftp://x' }, [], 'id', NOW), { ok: false, error: 'Enter an http(s) feed address.' })
  const feed = newFeed()
  assert.equal(createFeed({ url: 'https://example.com/feed.xml' }, [feed], 'id2', NOW).ok, false, 'duplicate')
  assert.equal(createFeed({ url: 'https://example.com/a', intervalMinutes: 7 }, [], 'id3', NOW).ok, false, 'bad interval')
  assert.equal(feed.notify, false, 'notifications are off by default')
  assert.equal(feed.nextCheckAt, NOW, 'a new feed is due right away')
  const renamed = editFeed(feed, { title: '  My   feed ', intervalMinutes: 60, notify: true }, DEFAULT_FEED_SETTINGS, NOW)
  assert.ok(renamed.ok)
  assert.equal(renamed.feed.customTitle, 'My feed')
  assert.equal(renamed.feed.intervalMinutes, 60)
  assert.equal(renamed.feed.notify, true)
  assert.equal(editFeed(feed, { intervalMinutes: 2 }, DEFAULT_FEED_SETTINGS, NOW).ok, false)
  assert.equal(editFeed(feed, { notify: 'yes' }, DEFAULT_FEED_SETTINGS, NOW).ok, false)
  assert.equal(editFeed(feed, null, DEFAULT_FEED_SETTINGS, NOW).ok, false)
})

test('intervals: global default, per-feed override, GitHub API floor', () => {
  const feed = newFeed()
  assert.equal(effectiveIntervalMinutes(feed, DEFAULT_FEED_SETTINGS), 30)
  assert.equal(effectiveIntervalMinutes({ ...feed, intervalMinutes: 5 }, DEFAULT_FEED_SETTINGS), 5)
  assert.equal(effectiveIntervalMinutes({ url: gitHubFeedUrl('o', 'r', 'actions'), intervalMinutes: 5 }, DEFAULT_FEED_SETTINGS), GITHUB_API_MIN_INTERVAL_MINUTES)
})

test('merge dedupes by key, keeps read state, sorts newest first, caps', () => {
  const first = mergeFeedItems([], [item('a', 3), item('b', 2), item('a', 3)], NOW)
  assert.deepEqual(first.items.map((entry) => entry.key), ['a', 'b'])
  assert.equal(first.added.length, 2)
  const read = first.items.map((entry) => entry.key === 'a' ? { ...entry, read: true } : entry)
  const second = mergeFeedItems(read, [item('c', 4), { ...item('a', 3), title: 'A renamed' }], NOW + 1)
  assert.deepEqual(second.items.map((entry) => entry.key), ['c', 'a', 'b'], 'items that left the feed are kept')
  assert.deepEqual(second.added.map((entry) => entry.key), ['c'])
  assert.equal(second.items[1]!.read, true)
  assert.equal(second.items[1]!.title, 'A renamed')
  const capped = mergeFeedItems(second.items, [item('d', 5)], NOW + 2, 2)
  assert.deepEqual(capped.items.map((entry) => entry.key), ['d', 'c'])
})

test('baseline fetch never notifies; later new items do (when the feed asks)', () => {
  const feed = newFeed()
  const baseline = applyFeedSuccess(feed, { parsed: { format: 'rss', title: 'T', siteUrl: '', items: [item('a', 1)] }, etag: '"v1"' }, DEFAULT_FEED_SETTINGS, NOW)
  assert.equal(baseline.notifiable.length, 0)
  assert.equal(baseline.feed.baselined, true)
  assert.equal(baseline.feed.etag, '"v1"')
  assert.equal(baseline.feed.feedTitle, 'T')
  assert.equal(baseline.feed.nextCheckAt, NOW + 30 * 60_000)
  const later = applyFeedSuccess(baseline.feed, { parsed: { format: 'rss', title: 'T', siteUrl: '', items: [item('b', 2), item('a', 1)] } }, DEFAULT_FEED_SETTINGS, NOW + 1000)
  assert.deepEqual(later.notifiable.map((entry) => entry.key), ['b'])
  assert.equal(later.feed.etag, '"v1"', 'validators kept when the response sends none')
  const notModified = applyFeedSuccess(later.feed, { parsed: null }, DEFAULT_FEED_SETTINGS, NOW + 2000)
  assert.equal(notModified.feed.items.length, 2)
  assert.equal(notModified.notifiable.length, 0)
})

test('errors back off (doubling, capped) and honour Retry-After / rate-limit reset', () => {
  assert.equal(feedBackoffDelayMs(30, 0), 30 * 60_000)
  assert.equal(feedBackoffDelayMs(30, 1), 30 * 60_000)
  assert.equal(feedBackoffDelayMs(30, 2), 60 * 60_000)
  assert.equal(feedBackoffDelayMs(30, 30), MAX_FEED_BACKOFF_MS)
  const feed = newFeed()
  const failed = applyFeedFailure(applyFeedFailure(feed, 'x', DEFAULT_FEED_SETTINGS, NOW), 'HTTP 500', DEFAULT_FEED_SETTINGS, NOW)
  assert.equal(failed.consecutiveErrors, 2)
  assert.equal(failed.lastError, 'HTTP 500')
  assert.equal(failed.nextCheckAt, NOW + 60 * 60_000)
  const retry = applyFeedFailure(feed, 'x', DEFAULT_FEED_SETTINGS, NOW, NOW + 5 * 60 * 60_000)
  assert.equal(retry.nextCheckAt, NOW + 5 * 60 * 60_000)
  const recovered = applyFeedSuccess(failed, { parsed: null }, DEFAULT_FEED_SETTINGS, NOW)
  assert.equal(recovered.feed.consecutiveErrors, 0)
  assert.equal(recovered.feed.lastError, null)
  const deferred = deferFeedCheck(feed, 'kill switch', NOW)
  assert.equal(deferred.consecutiveErrors, 0)
  assert.equal(deferred.lastError, 'kill switch')
})

test('HTTP error descriptions', () => {
  const none = (): null => null
  assert.match(describeFeedHttpError(404, 'https://example.com/f', none, NOW).message, /not found/i)
  assert.match(describeFeedHttpError(403, 'https://example.com/f', none, NOW).message, /sign-in/)
  const limited = describeFeedHttpError(403, 'https://api.github.com/repos/o/r/actions/runs', (name) => ({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) } as Record<string, string>)[name] ?? null, NOW)
  assert.match(limited.message, /rate limit/)
  assert.equal(limited.retryAt, NOW + 600_000)
  assert.equal(describeFeedHttpError(429, 'https://example.com/f', (name) => name === 'retry-after' ? '120' : null, NOW).retryAt, NOW + 120_000)
})

test('scheduling: nothing to do means no timer; paused and running feeds are skipped', () => {
  assert.equal(nextFeedWakeDelay([], NOW), null)
  const a = newFeed('https://a.example/f', { id: 'a', nextCheckAt: NOW - 10 })
  const b = newFeed('https://b.example/f', { id: 'b', nextCheckAt: NOW + 60_000 })
  const c = newFeed('https://c.example/f', { id: 'c', nextCheckAt: NOW - 100, paused: true })
  assert.deepEqual(dueFeeds([a, b, c], NOW).map((feed) => feed.id), ['a'])
  assert.deepEqual(dueFeeds([a, b, c], NOW, new Set(['a'])).map((feed) => feed.id), [])
  assert.equal(nextFeedWakeDelay([b, c], NOW), 60_000)
  assert.equal(nextFeedWakeDelay([c], NOW), null)
})

test('read state and item listing', () => {
  let feed = applyFeedSuccess(newFeed(), { parsed: { format: 'rss', title: 'T', siteUrl: '', items: [item('a', 1), item('b', 2)] } }, DEFAULT_FEED_SETTINGS, NOW).feed
  assert.equal(summarizeFeed(feed, DEFAULT_FEED_SETTINGS).unreadCount, 2)
  feed = markFeedItemsRead(feed, 'b')
  assert.equal(summarizeFeed(feed, DEFAULT_FEED_SETTINGS).unreadCount, 1)
  assert.equal(markFeedItemsRead(feed, 'b'), feed, 'no-op returns the same record')
  assert.deepEqual(listFeedItems([feed], null, { unreadOnly: true }).map((row) => row.key), ['a'])
  feed = markFeedItemsRead(feed, null)
  assert.equal(summarizeFeed(feed, DEFAULT_FEED_SETTINGS).unreadCount, 0)
  const rows = listFeedItems([feed], feed.id)
  assert.deepEqual(rows.map((row) => row.key), ['b', 'a'])
  assert.equal(rows[0]!.feedTitle, 'T')
})

test('store parsing survives junk and drops duplicates', () => {
  assert.deepEqual(parseFeedStore(null, NOW), { settings: { intervalMinutes: 30 }, feeds: [] })
  const feed = newFeed()
  const store = parseFeedStore({ settings: { intervalMinutes: 60 }, feeds: [feed, { ...feed, id: 'other' }, { id: 'x', url: 'file:///x' }, 'junk', { ...feed, id: 'z', url: 'https://z.example/', nextCheckAt: NOW + 10 * 365 * 86_400_000 }] }, NOW)
  assert.equal(store.settings.intervalMinutes, 60)
  assert.deepEqual(store.feeds.map((entry) => entry.id), ['feed-1', 'z'])
  assert.ok(store.feeds[1]!.nextCheckAt <= NOW + MAX_FEED_BACKOFF_MS)
})
