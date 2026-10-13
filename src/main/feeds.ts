import { randomUUID } from 'node:crypto'
import { Notification, powerMonitor } from 'electron'
import {
  FEED_MAX_BYTES,
  MAX_CONCURRENT_FEED_CHECKS,
  applyFeedFailure,
  applyFeedSuccess,
  createFeed,
  deferFeedCheck,
  describeFeedHttpError,
  discoverFeedLinks,
  dueFeeds,
  editFeed,
  effectiveIntervalMinutes,
  feedDisplayTitle,
  gitHubSuggestionsForPage,
  isFeedInterval,
  isGitHubApiUrl,
  listFeedItems,
  markFeedItemsRead,
  nextFeedWakeDelay,
  normalizeDiscoveredLinks,
  normalizeFeedAddress,
  parseFeed,
  parseFeedStore,
  redactFeedAddress,
  summarizeFeed,
  type DiscoveredFeed,
  type Feed,
  type FeedFetchSuccess,
  type FeedListItem,
  type FeedSettings,
  type FeedSummary,
  type StoredFeedItem
} from '../shared/feeds'
import { APP_NAME } from '../shared/config'
import { backgroundNetworkBlockedReason } from './background-network'
import { getActiveTabWebContents, openExternalBrowserTab } from './browser'
import { getBrowserSession } from './browser-session'
import { sendToMainWindowRenderers } from './browser-shell'
import { deferWrite } from './deferred-writes'
import { revealFeeds } from './feeds-ipc'
import { readUserJson, writeUserJson } from './user-json'

/**
 * Feeds: RSS / Atom / JSON Feed (and GitHub Actions runs from the public REST API) polled in main
 * with the browser session, so the SOCKS proxy applies and the proxy kill switch can veto a check
 * (it is retried later, never sent direct). Conditional GET (ETag / Last-Modified), exponential
 * backoff on errors, Retry-After and GitHub rate-limit resets honoured. One timer at most, and
 * none at all when no feed is followed. Stored in feeds.json (0600).
 */
const FILE = 'feeds.json'
const FETCH_TIMEOUT_MS = 20_000
/** The first checks wait until the app has settled (restored tabs come first). */
const STARTUP_DELAY_MS = 45_000
const DISCOVER_WORLD_ID = 1314
const MAX_NOTIFICATION_ITEMS = 3

let settings: FeedSettings = { intervalMinutes: 30 }
let feeds: Feed[] = []
let loaded = false
let timer: ReturnType<typeof setTimeout> | null = null
let startedAt = 0
let disposed = false
let resumeHooked = false
const running = new Set<string>()
const notifications = new Map<string, Notification>()

function load(): void {
  if (loaded) return
  loaded = true
  const store = parseFeedStore(readUserJson(FILE), Date.now())
  settings = store.settings
  feeds = store.feeds
}

function persist(): void {
  const snapshot = { version: 1, settings, feeds }
  deferWrite('feeds', () => { writeUserJson(FILE, snapshot) }, 1_500)
}

export interface FeedsSnapshot {
  settings: FeedSettings
  feeds: FeedSummary[]
  /** Ids being fetched right now. */
  running: string[]
  totalUnread: number
}

export function feedsSnapshot(): FeedsSnapshot {
  load()
  const summaries = feeds.map((feed) => summarizeFeed(feed, settings))
  return { settings, feeds: summaries, running: [...running], totalUnread: summaries.reduce((sum, feed) => sum + feed.unreadCount, 0) }
}

function publish(): void {
  try {
    sendToMainWindowRenderers('browser:feeds:changed', feedsSnapshot())
  } catch {
    // The window may be closing; the next list() call returns fresh state anyway.
  }
}

function replace(next: Feed): void {
  feeds = feeds.map((feed) => feed.id === next.id ? next : feed)
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (disposed || !startedAt) return
  const now = Date.now()
  const delay = nextFeedWakeDelay(feeds, now, running)
  if (delay === null) return
  const startupHold = Math.max(0, startedAt + STARTUP_DELAY_MS - now)
  timer = setTimeout(tick, Math.max(delay, startupHold))
  timer.unref?.()
}

function tick(): void {
  timer = null
  if (disposed) return
  const due = dueFeeds(feeds, Date.now(), running)
  for (const feed of due.slice(0, Math.max(0, MAX_CONCURRENT_FEED_CHECKS - running.size))) void runCheck(feed.id)
  schedule()
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const header = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  const declared = header ?? /^\s*<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 200)))?.[1]
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > FEED_MAX_BYTES) throw new Error('The feed is too large (over 5 MB).')
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > FEED_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('The feed is too large (over 5 MB).')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

type FetchOutcome =
  | { ok: true; result: FeedFetchSuccess; finalUrl: string }
  | { ok: false; error: string; retryAt: number | null; discovered?: DiscoveredFeed[] }

/** One fetch through the browser session (proxy). Never throws. */
async function fetchFeed(url: string, validators: { etag?: string; lastModified?: string } = {}): Promise<FetchOutcome> {
  const github = isGitHubApiUrl(url)
  const headers: Record<string, string> = github
    ? { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    : { Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.8, application/json;q=0.7, text/html;q=0.5, */*;q=0.1' }
  if (validators.etag) headers['If-None-Match'] = validators.etag
  if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified
  let response: Response
  try {
    response = await getBrowserSession().fetch(url, {
      headers,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/^net::/, '') : String(error)
    return { ok: false, error: /timed? ?out|abort/i.test(reason) ? 'The feed took too long to answer.' : `Could not reach the feed (${reason}).`, retryAt: null }
  }
  const finalUrl = response.url || url
  if (response.status === 304) {
    return { ok: true, finalUrl, result: { parsed: null, etag: response.headers.get('etag') ?? undefined, lastModified: response.headers.get('last-modified') ?? undefined } }
  }
  if (!response.ok) {
    const failure = describeFeedHttpError(response.status, url, (name) => response.headers.get(name), Date.now())
    await response.body?.cancel().catch(() => undefined)
    return { ok: false, error: failure.message, retryAt: failure.retryAt }
  }
  let body: string
  try {
    body = decodeBody(await readBounded(response), response.headers.get('content-type') ?? '')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), retryAt: null }
  }
  const parsed = parseFeed(body, finalUrl)
  if (!parsed.ok) return { ok: false, error: parsed.error, retryAt: null, discovered: parsed.html ? discoverFeedLinks(body, finalUrl) : undefined }
  return {
    ok: true,
    finalUrl,
    result: { parsed: parsed.feed, etag: response.headers.get('etag') ?? '', lastModified: response.headers.get('last-modified') ?? '' }
  }
}

function notifyNewItems(feed: Feed, items: readonly StoredFeedItem[]): void {
  if (!feed.notify || items.length === 0 || !Notification.isSupported()) return
  notifications.get(feed.id)?.close()
  const title = feedDisplayTitle(feed)
  const single = items.length === 1 ? items[0]! : null
  const notification = new Notification({
    title: single ? single.title : `${items.length} new in ${title}`,
    body: single ? `${title} · ${APP_NAME} feeds` : items.slice(0, MAX_NOTIFICATION_ITEMS).map((item) => `• ${item.title}`).join('\n'),
    silent: false
  })
  notification.on('click', () => {
    if (single?.link) void openFeedItem(feed.id, single.key)
    else revealFeeds({ feedId: feed.id })
  })
  notification.on('close', () => { if (notifications.get(feed.id) === notification) notifications.delete(feed.id) })
  notifications.set(feed.id, notification)
  notification.show()
}

async function runCheck(id: string): Promise<void> {
  const feed = feeds.find((candidate) => candidate.id === id)
  if (!feed || running.has(id) || disposed) return
  const blocked = backgroundNetworkBlockedReason()
  if (blocked) {
    replace(deferFeedCheck(feed, `Check skipped: ${blocked}`, Date.now()))
    persist()
    publish()
    schedule()
    return
  }
  running.add(id)
  publish()
  let outcome: FetchOutcome
  try {
    outcome = await fetchFeed(feed.url, { etag: feed.etag, lastModified: feed.lastModified })
  } finally {
    running.delete(id)
  }
  if (disposed) return
  // Removed (or re-pointed) while it ran: drop the result.
  const current = feeds.find((candidate) => candidate.id === id)
  if (!current || current.url !== feed.url) {
    publish()
    schedule()
    return
  }
  const now = Date.now()
  if (outcome.ok) {
    const checked = applyFeedSuccess(current, outcome.result, settings, now)
    replace(checked.feed)
    notifyNewItems(checked.feed, checked.notifiable)
  } else {
    console.warn(`[feeds] ${redactFeedAddress(current.url)}: ${outcome.error}`)
    const hint = outcome.discovered?.length ? ` It advertises a feed at ${outcome.discovered[0]!.url}.` : ''
    replace(applyFeedFailure(current, `${outcome.error}${hint}`, settings, now, outcome.retryAt))
  }
  persist()
  publish()
  schedule()
}

export type AddFeedResult = { ok: true; feed: FeedSummary; snapshot: FeedsSnapshot } | { ok: false; error: string; discovered?: DiscoveredFeed[] }

/**
 * Add by URL. The address is fetched first so a typo, a 404 or a web page is an inline error, not
 * a silently failing feed. A web page that advertises exactly one feed is followed through to it;
 * several are returned for the user to pick.
 */
export async function addFeed(input: unknown): Promise<AddFeedResult> {
  load()
  const record = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {}
  let url = normalizeFeedAddress(record.url)
  if (!url) return { ok: false, error: 'Enter an http(s) feed address.' }
  const probe = createFeed({ url, title: record.title, intervalMinutes: record.intervalMinutes, notify: record.notify }, feeds, 'probe', Date.now())
  if (!probe.ok) return probe
  const blocked = backgroundNetworkBlockedReason()
  if (blocked) return { ok: false, error: `Can't check the feed right now: ${blocked}` }
  let fetched = await fetchFeed(url)
  if (!fetched.ok && fetched.discovered?.length === 1) {
    url = fetched.discovered[0]!.url
    fetched = await fetchFeed(url)
  }
  if (!fetched.ok) {
    if (fetched.discovered && fetched.discovered.length > 1) return { ok: false, error: 'This page offers several feeds. Pick one below.', discovered: fetched.discovered }
    return { ok: false, error: fetched.error }
  }
  // Re-check after the await: the list may have changed, and the address may have moved.
  const created = createFeed({ url, title: record.title, intervalMinutes: record.intervalMinutes, notify: record.notify }, feeds, randomUUID(), Date.now())
  if (!created.ok) return created
  const checked = applyFeedSuccess(created.feed, fetched.result, settings, Date.now())
  feeds = [...feeds, checked.feed]
  persist()
  publish()
  schedule()
  return { ok: true, feed: summarizeFeed(checked.feed, settings), snapshot: feedsSnapshot() }
}

export function updateFeed(id: unknown, patch: unknown): { ok: true; snapshot: FeedsSnapshot } | { ok: false; error: string } {
  load()
  const feed = typeof id === 'string' ? feeds.find((candidate) => candidate.id === id) : undefined
  if (!feed) return { ok: false, error: 'That feed no longer exists.' }
  const result = editFeed(feed, patch, settings, Date.now())
  if (!result.ok) return result
  replace(result.feed)
  persist()
  publish()
  schedule()
  return { ok: true, snapshot: feedsSnapshot() }
}

export function removeFeed(id: unknown): { ok: true; snapshot: FeedsSnapshot } | { ok: false; error: string } {
  load()
  if (typeof id !== 'string' || !feeds.some((feed) => feed.id === id)) return { ok: false, error: 'That feed no longer exists.' }
  notifications.get(id)?.close()
  notifications.delete(id)
  feeds = feeds.filter((feed) => feed.id !== id)
  persist()
  publish()
  schedule()
  return { ok: true, snapshot: feedsSnapshot() }
}

/** Check one feed (id) or every feed (null) now, ignoring the schedule. Resolves when done. */
export async function refreshFeeds(id: unknown): Promise<{ ok: true; snapshot: FeedsSnapshot } | { ok: false; error: string }> {
  load()
  if (id !== null && id !== undefined && typeof id !== 'string') return { ok: false, error: 'Unknown feed.' }
  const targets = typeof id === 'string' ? feeds.filter((feed) => feed.id === id) : feeds.filter((feed) => !feed.paused)
  if (typeof id === 'string' && targets.length === 0) return { ok: false, error: 'That feed no longer exists.' }
  const queue = targets.filter((feed) => !running.has(feed.id)).map((feed) => feed.id)
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_FEED_CHECKS, queue.length) }, async () => {
    while (queue.length) await runCheck(queue.shift()!)
  })
  await Promise.all(workers)
  return { ok: true, snapshot: feedsSnapshot() }
}

/** Mark one item (itemKey), one feed (feedId, no key) or every feed (null) read. */
export function markRead(feedId: unknown, itemKey: unknown): { ok: true; snapshot: FeedsSnapshot } | { ok: false; error: string } {
  load()
  if (feedId !== null && feedId !== undefined && typeof feedId !== 'string') return { ok: false, error: 'Unknown feed.' }
  const key = typeof itemKey === 'string' ? itemKey : null
  let changed = false
  feeds = feeds.map((feed) => {
    if (typeof feedId === 'string' && feed.id !== feedId) return feed
    const next = markFeedItemsRead(feed, key)
    if (next !== feed) {
      changed = true
      if (key === null) notifications.get(feed.id)?.close()
    }
    return next
  })
  if (changed) {
    persist()
    publish()
  }
  return { ok: true, snapshot: feedsSnapshot() }
}

export async function openFeedItem(feedId: unknown, itemKey: unknown): Promise<{ ok: true; tabId: string | null } | { ok: false; error: string }> {
  load()
  const feed = typeof feedId === 'string' ? feeds.find((candidate) => candidate.id === feedId) : undefined
  const item = feed && typeof itemKey === 'string' ? feed.items.find((candidate) => candidate.key === itemKey) : undefined
  if (!feed || !item) return { ok: false, error: 'That item is no longer in the feed.' }
  if (!item.link) return { ok: false, error: 'This item has no link to open.' }
  const tabId = openExternalBrowserTab(item.link)
  markRead(feed.id, item.key)
  return { ok: true, tabId }
}

export function feedItems(feedId: unknown, options: unknown): FeedListItem[] {
  load()
  const record = typeof options === 'object' && options !== null ? options as Record<string, unknown> : {}
  return listFeedItems(feeds, typeof feedId === 'string' ? feedId : null, {
    unreadOnly: record.unreadOnly === true,
    limit: typeof record.limit === 'number' ? record.limit : undefined
  })
}

export function setFeedSettings(input: unknown): { ok: true; snapshot: FeedsSnapshot } | { ok: false; error: string } {
  load()
  const record = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null
  if (!record) return { ok: false, error: 'Feed settings must be an object.' }
  if (record.intervalMinutes !== undefined) {
    if (!isFeedInterval(record.intervalMinutes)) return { ok: false, error: 'Choose one of the listed check intervals.' }
    settings = { ...settings, intervalMinutes: record.intervalMinutes }
    // Feeds on the global interval follow the new pace from their last check.
    const now = Date.now()
    feeds = feeds.map((feed) => feed.intervalMinutes !== null || feed.consecutiveErrors > 0 || feed.lastCheckedAt === null
      ? feed
      : { ...feed, nextCheckAt: Math.max(now, feed.lastCheckedAt + effectiveIntervalMinutes(feed, settings) * 60_000) })
  }
  persist()
  publish()
  schedule()
  return { ok: true, snapshot: feedsSnapshot() }
}

const DISCOVER_SCRIPT = `(() => Array.from(document.querySelectorAll('link[rel~="alternate" i][href]')).slice(0, 50).map((link) => ({ rel: link.getAttribute('rel') || '', type: link.getAttribute('type') || '', href: link.href, title: link.getAttribute('title') || '' })))()`

export type DiscoverResult = { ok: true; pageUrl: string; pageTitle: string; feeds: Array<DiscoveredFeed & { followed: boolean }> } | { ok: false; error: string }

/** "Add feed from this site": feeds the active tab's page advertises, plus GitHub repo presets. */
export async function discoverFeedsOnActivePage(): Promise<DiscoverResult> {
  load()
  const contents = getActiveTabWebContents()
  if (!contents) return { ok: false, error: 'Open a web page first.' }
  const pageUrl = contents.getURL()
  if (!/^https?:\/\//i.test(pageUrl)) return { ok: false, error: 'Open a web page first.' }
  let advertised: DiscoveredFeed[] = []
  try {
    const raw = await contents.executeJavaScriptInIsolatedWorld(DISCOVER_WORLD_ID, [{ code: DISCOVER_SCRIPT }]) as unknown
    advertised = normalizeDiscoveredLinks(Array.isArray(raw) ? raw : [], pageUrl)
  } catch (error) {
    console.warn('[feeds] discovery script failed:', error)
  }
  const seen = new Set(advertised.map((feed) => feed.url))
  const found = [...advertised, ...gitHubSuggestionsForPage(pageUrl).filter((feed) => !seen.has(feed.url))]
  const followed = new Set(feeds.map((feed) => feed.url))
  return { ok: true, pageUrl, pageTitle: contents.getTitle(), feeds: found.map((feed) => ({ ...feed, followed: followed.has(feed.url) })) }
}

/** After the first paint. No feeds: no timer, nothing else. */
export function initializeFeeds(): void {
  load()
  disposed = false
  if (!startedAt) startedAt = Date.now()
  if (!resumeHooked) {
    resumeHooked = true
    // After sleep the timers are stale; look again.
    try { powerMonitor.on('resume', () => schedule()) } catch { /* not available in tests */ }
  }
  schedule()
}

export function disposeFeeds(): void {
  disposed = true
  if (timer) clearTimeout(timer)
  timer = null
  for (const notification of notifications.values()) notification.close()
  notifications.clear()
}
