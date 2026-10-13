import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_FEED_INTERVAL,
  FEED_INTERVALS,
  GITHUB_FEED_KINDS,
  MAX_FEEDS,
  feedIntervalLabel,
  gitHubFeedTitle,
  gitHubFeedUrl,
  parseGitHubRepo,
  type DiscoveredFeed,
  type FeedIntervalMinutes,
  type FeedListItem,
  type FeedSummary,
  type GitHubFeedKind
} from '../../../../shared/feeds'
import { SettingsGroup, SettingsRow } from './SettingsControls'
import { useFeeds } from './useFeeds'
import './PageWatchers.css'
import './Feeds.css'

type Message = { text: string; error: boolean } | null

function relativeTime(timestamp: number | null, now: number): string {
  if (timestamp === null) return 'never'
  const seconds = Math.round((now - timestamp) / 1000)
  if (seconds < -30) {
    const ahead = -seconds
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))} min`
    if (ahead < 86_400) return `in ${Math.round(ahead / 3600)} h`
    return `in ${Math.round(ahead / 86_400)} d`
  }
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86_400)} d ago`
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Something went wrong.'
}

function IntervalSelect({ value, onChange, label, allowDefault, defaultMinutes }: { value: FeedIntervalMinutes | null; onChange: (value: FeedIntervalMinutes | null) => void; label: string; allowDefault: boolean; defaultMinutes?: number }): React.JSX.Element {
  return (
    <select className="settings-select" value={value ?? ''} aria-label={label} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value) as FeedIntervalMinutes)}>
      {allowDefault && <option value="">Default ({feedIntervalLabel(defaultMinutes ?? DEFAULT_FEED_INTERVAL).toLowerCase()})</option>}
      {FEED_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{feedIntervalLabel(minutes)}</option>)}
    </select>
  )
}

function DiscoveredList({ feeds, onAdd }: { feeds: Array<DiscoveredFeed & { followed?: boolean }>; onAdd: (feed: DiscoveredFeed) => void }): React.JSX.Element {
  return (
    <ul className="feed-discovered">
      {feeds.map((feed) => (
        <li key={feed.url}>
          <span className="feed-discovered-copy">
            <span className="feed-discovered-title">{feed.title}</span>
            <small>{feed.url}</small>
          </span>
          <button className="settings-action secondary" type="button" disabled={feed.followed} onClick={() => onAdd(feed)}>{feed.followed ? 'Following' : 'Add'}</button>
        </li>
      ))}
    </ul>
  )
}

function AddFeed({ full, discoverNonce }: { full: boolean; discoverNonce: number }): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [repo, setRepo] = useState('')
  const [kind, setKind] = useState<GitHubFeedKind>('releases')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [choices, setChoices] = useState<Array<DiscoveredFeed & { followed?: boolean }> | null>(null)

  const add = useCallback(async (target: string, title?: string): Promise<boolean> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.api.browser.feeds.add({ url: target, title })
      if (result.ok) {
        setMessage({ text: `Following ${result.feed.title}${result.feed.unreadCount ? ` · ${result.feed.unreadCount} items` : ''}.`, error: false })
        setChoices((current) => current?.map((choice) => choice.url === target ? { ...choice, followed: true } : choice) ?? null)
        return true
      }
      setMessage({ text: result.error, error: true })
      if ('discovered' in result && result.discovered?.length) setChoices(result.discovered)
      return false
    } catch (caught) {
      setMessage({ text: errorText(caught), error: true })
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const discover = useCallback(async (): Promise<void> => {
    setMessage(null)
    setChoices(null)
    try {
      const result = await window.api.browser.feeds.discover()
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      if (result.feeds.length === 0) setMessage({ text: `${result.pageTitle || 'This page'} doesn’t advertise a feed. Try its address anyway, or look for an RSS link on the site.`, error: true })
      else setChoices(result.feeds)
    } catch (caught) {
      setMessage({ text: errorText(caught), error: true })
    }
  }, [])

  useEffect(() => {
    if (discoverNonce > 0) void discover()
  }, [discoverNonce, discover])

  const parsedRepo = parseGitHubRepo(repo)

  return (
    <SettingsGroup title="Add a feed" className="feed-add-group">
      <form className="watcher-add feed-add" onSubmit={(event) => { event.preventDefault(); void add(url).then((ok) => { if (ok) setUrl('') }) }}>
        <label className="settings-field settings-field-grow">
          <span>Feed or site address</span>
          <input type="text" value={url} placeholder="https://example.com/feed.xml" spellCheck={false} autoCapitalize="none" onChange={(event) => setUrl(event.target.value)} />
        </label>
        <button className="settings-action primary" type="submit" disabled={!url.trim() || full || busy}>{busy ? 'Adding…' : 'Add'}</button>
        <button className="settings-action secondary feed-discover-button" type="button" disabled={full} onClick={() => void discover()}>Add feed from this site</button>
      </form>
      <form className="watcher-add feed-add feed-github" onSubmit={(event) => {
        event.preventDefault()
        if (!parsedRepo) return
        void add(gitHubFeedUrl(parsedRepo.owner, parsedRepo.repo, kind), gitHubFeedTitle(parsedRepo.owner, parsedRepo.repo, kind)).then((ok) => { if (ok) setRepo('') })
      }}>
        <label className="settings-field settings-field-grow">
          <span>GitHub repository</span>
          <input type="text" value={repo} placeholder="owner/repo" spellCheck={false} autoCapitalize="none" onChange={(event) => setRepo(event.target.value)} />
        </label>
        <select className="settings-select" value={kind} aria-label="GitHub feed type" onChange={(event) => setKind(event.target.value as GitHubFeedKind)}>
          {GITHUB_FEED_KINDS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
        </select>
        <button className="settings-action secondary" type="submit" disabled={!parsedRepo || full || busy}>Add</button>
      </form>
      {kind === 'actions' && <p className="settings-help">Actions runs come from GitHub’s public API without sign-in (public repos only, 60 requests an hour shared by everything on your network), so they’re checked at most every 15 minutes. Only finished runs are listed.</p>}
      {choices && choices.length > 0 && <DiscoveredList feeds={choices} onAdd={(feed) => void add(feed.url, feed.type === 'github' ? feed.title : undefined)} />}
      {message && <p className={`settings-message${message.error ? ' is-error' : ''}`} role="status">{message.text}</p>}
      <p className="settings-help">Works with RSS, Atom and JSON Feed: news sites, blogs, YouTube channels, Reddit, podcasts, game patch notes, TV trackers, GitHub releases and commits.</p>
    </SettingsGroup>
  )
}

function EditFeed({ feed, defaultMinutes, onDone }: { feed: FeedSummary; defaultMinutes: number; onDone: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(feed.customTitle || feed.title)
  const [interval, setIntervalMinutes] = useState<FeedIntervalMinutes | null>(feed.intervalMinutes)
  const [error, setError] = useState<string | null>(null)
  async function save(): Promise<void> {
    setError(null)
    try {
      const result = await window.api.browser.feeds.update(feed.id, { title: title.trim() === feed.feedTitle ? '' : title, intervalMinutes: interval })
      if (result.ok) onDone()
      else setError(result.error)
    } catch (caught) {
      setError(errorText(caught))
    }
  }
  return (
    <form className="watcher-edit" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="settings-field">
        <span>Name</span>
        <input type="text" value={title} placeholder={feed.feedTitle} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="watcher-edit-row">
        <IntervalSelect value={interval} onChange={setIntervalMinutes} label="Check interval" allowDefault defaultMinutes={defaultMinutes} />
      </div>
      <small className="feed-url">{feed.url}</small>
      <div className="settings-actions">
        <button className="settings-action secondary" type="button" onClick={onDone}>Cancel</button>
        <button className="settings-action primary" type="submit">Save</button>
      </div>
      {error && <p className="settings-message is-error" role="status">{error}</p>}
    </form>
  )
}

function FeedRow({ feed, running, now, selected, defaultMinutes, onSelect }: { feed: FeedSummary; running: boolean; now: number; selected: boolean; defaultMinutes: number; onSelect: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const failing = feed.consecutiveErrors > 0
  const status = running
    ? 'Checking…'
    : feed.paused
    ? 'Paused'
    : failing
    ? `Error: ${feed.lastError} · retrying ${relativeTime(feed.nextCheckAt, now)}`
    : feed.lastError
    ? `${feed.lastError} · retrying ${relativeTime(feed.nextCheckAt, now)}`
    : `Checked ${relativeTime(feed.lastCheckedAt, now)} · next ${relativeTime(feed.nextCheckAt, now)} · ${feedIntervalLabel(feed.effectiveIntervalMinutes).toLowerCase()}`
  return (
    <li className={`watcher-item feed-row${selected ? ' is-selected' : ''}${feed.paused ? ' is-paused' : ''}${failing ? ' is-failing' : ''}`}>
      <div className="watcher-summary">
        <button type="button" className="feed-row-select" aria-pressed={selected} onClick={onSelect}>
          <span className="watcher-title">
            {feed.title}
            {feed.unreadCount > 0 && <span className="watcher-badge feed-unread" aria-label={`${feed.unreadCount} unread`}>{feed.unreadCount}</span>}
          </span>
          <small className={`watcher-status${failing ? ' is-error' : ''}`}>{status}</small>
        </button>
        <div className="watcher-actions">
          <button className="settings-action secondary" type="button" disabled={running || feed.paused} onClick={() => void window.api.browser.feeds.refresh(feed.id)}>Refresh</button>
          <button className="settings-action secondary" type="button" disabled={feed.unreadCount === 0} onClick={() => void window.api.browser.feeds.markRead(feed.id)}>Mark read</button>
          <label className="feed-notify" title="Desktop notification for new items">
            <input type="checkbox" checked={feed.notify} onChange={(event) => void window.api.browser.feeds.update(feed.id, { notify: event.target.checked })} />
            <span>Notify</span>
          </label>
          <button className="settings-action secondary" type="button" onClick={() => void window.api.browser.feeds.update(feed.id, { paused: !feed.paused })}>{feed.paused ? 'Resume' : 'Pause'}</button>
          <button className="settings-action secondary" type="button" aria-pressed={editing} onClick={() => setEditing(!editing)}>Edit</button>
          <button className="privacy-icon-button" type="button" title="Remove feed" aria-label={`Remove feed ${feed.title}`} onClick={() => void window.api.browser.feeds.remove(feed.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      {editing && <EditFeed feed={feed} defaultMinutes={defaultMinutes} onDone={() => setEditing(false)} />}
    </li>
  )
}

function ItemList({ items, now, showSource }: { items: FeedListItem[]; now: number; showSource: boolean }): React.JSX.Element {
  return (
    <ul className="feed-items">
      {items.map((item) => (
        <li key={`${item.feedId}:${item.key}`} className={item.read ? 'is-read' : 'is-unread'}>
          <button
            type="button"
            className="feed-item"
            disabled={!item.link}
            title={item.link || 'This item has no link'}
            onClick={() => void window.api.browser.feeds.openItem(item.feedId, item.key)}
          >
            <span className="feed-item-title">{!item.read && <span className="feed-item-dot" aria-label="Unread" />}{item.title}</span>
            <small className="feed-item-meta">
              {showSource && <>{item.feedTitle} · </>}
              {relativeTime(item.publishedAt ?? item.firstSeenAt, now)}
              {item.author && <> · {item.author}</>}
              {item.summary && <> · <span className="feed-item-summary">{item.summary}</span></>}
            </small>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function FeedsSettings(): React.JSX.Element {
  const snapshot = useFeeds()
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [items, setItems] = useState<FeedListItem[] | null>(null)
  const [discoverNonce, setDiscoverNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const itemsRequest = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    const off = window.api.browser.feeds.onReveal((request) => {
      if (request.discover) setDiscoverNonce((value) => value + 1)
      if (request.feedId) setSelected(request.feedId)
    })
    return () => {
      window.clearInterval(timer)
      off()
    }
  }, [])

  // Items follow the snapshot (new fetches, read state) and the filter.
  useEffect(() => {
    setNow(Date.now())
    const request = ++itemsRequest.current
    void window.api.browser.feeds.items(selected, { unreadOnly, limit: 300 })
      .then((rows) => { if (request === itemsRequest.current && Array.isArray(rows)) setItems(rows) })
      .catch(() => undefined)
  }, [snapshot, selected, unreadOnly])

  const feeds = snapshot?.feeds ?? []
  const running = new Set(snapshot?.running ?? [])
  const defaultMinutes = snapshot?.settings.intervalMinutes ?? DEFAULT_FEED_INTERVAL
  const selectedFeed = selected ? feeds.find((feed) => feed.id === selected) ?? null : null
  useEffect(() => {
    if (selected && snapshot && !snapshot.feeds.some((feed) => feed.id === selected)) setSelected(null)
  }, [selected, snapshot])
  const failing = feeds.filter((feed) => feed.consecutiveErrors > 0).length
  const unread = selectedFeed ? selectedFeed.unreadCount : snapshot?.totalUnread ?? 0

  return (
    <>
        <p className="settings-help feeds-intro">Follow RSS, Atom and JSON feeds, GitHub releases and CI runs. Checked in the background through your proxy.</p>
        <SettingsGroup
          title={selectedFeed ? selectedFeed.title : 'Latest'}
          status={snapshot ? `${unread} unread` : undefined}
          statusOn={unread > 0}
          className="feed-items-group"
          aside={(
            <div className="feed-items-actions">
              {selectedFeed && <button className="settings-action secondary" type="button" onClick={() => setSelected(null)}>All feeds</button>}
              <label className="feed-notify"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} /><span>Unread only</span></label>
              <button className="settings-action secondary" type="button" disabled={refreshing || feeds.length === 0} onClick={() => {
                setRefreshing(true)
                void window.api.browser.feeds.refresh(selected).finally(() => setRefreshing(false))
              }}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
              <button className="settings-action secondary feed-mark-all" type="button" disabled={unread === 0} onClick={() => void window.api.browser.feeds.markRead(selected)}>Mark all read</button>
            </div>
          )}
        >
          {!snapshot || !items ? <p className="settings-help">Loading…</p> : feeds.length === 0 ? (
            <p className="settings-help">No feeds yet. Add one below, or open a site and use <strong>Add feed from this site</strong>.</p>
          ) : items.length === 0 ? (
            <p className="settings-help">{unreadOnly ? 'All caught up.' : 'Nothing here yet.'}</p>
          ) : <ItemList items={items} now={now} showSource={!selectedFeed} />}
        </SettingsGroup>
        <AddFeed full={feeds.length >= MAX_FEEDS} discoverNonce={discoverNonce} />
        <SettingsGroup title="Following" status={snapshot ? `${feeds.length} of ${MAX_FEEDS}${failing ? ` · ${failing} failing` : ''}` : undefined} statusOn={failing > 0}>
          {feeds.length === 0 ? <p className="settings-help">Nothing followed yet.</p> : (
            <ul className="watcher-list feed-list">
              {feeds.map((feed) => (
                <FeedRow key={feed.id} feed={feed} running={running.has(feed.id)} now={now} selected={feed.id === selected} defaultMinutes={defaultMinutes} onSelect={() => setSelected(feed.id === selected ? null : feed.id)} />
              ))}
            </ul>
          )}
        </SettingsGroup>
        <SettingsGroup title="How checks work">
          <SettingsRow label="Default check interval" hint="Feeds without their own interval use this. Failed checks retry later and later (up to once a day) until the feed works again.">
            <IntervalSelect value={defaultMinutes as FeedIntervalMinutes} allowDefault={false} label="Default check interval" onChange={(value) => { if (value) void window.api.browser.feeds.setSettings({ intervalMinutes: value }) }} />
          </SettingsRow>
          <p className="settings-help">Feeds are fetched without cookies through your browser session and proxy; the proxy kill switch pauses checks while it blocks traffic. Unchanged feeds cost almost nothing (ETag / Last-Modified). Notifications are off until you turn them on per feed.</p>
        </SettingsGroup>
    </>
  )
}
