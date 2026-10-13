import { useEffect, useRef, useState } from 'react'
import {
  changeSummary,
  DEFAULT_WATCH_INTERVAL,
  MAX_WATCHERS,
  WATCH_INTERVALS,
  watchIntervalLabel,
  type PageWatcherSummary,
  type WatchIntervalMinutes
} from '../../../../shared/page-watchers'
import { SettingsGroup, SettingsRow } from './SettingsControls'
import './PageWatchers.css'
import { useWatchers } from './useWatchers'

export { useUnseenWatcherCount } from './useWatchers'

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

function IntervalSelect({ value, onChange, label }: { value: WatchIntervalMinutes; onChange: (value: WatchIntervalMinutes) => void; label: string }): React.JSX.Element {
  return (
    <select className="settings-select" value={value} aria-label={label} onChange={(event) => onChange(Number(event.target.value) as WatchIntervalMinutes)}>
      {WATCH_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{watchIntervalLabel(minutes)}</option>)}
    </select>
  )
}

function DiffView({ watcher }: { watcher: PageWatcherSummary }): React.JSX.Element {
  const diff = watcher.lastDiff
  if (!diff) return <p className="settings-help">No changes since the watcher started{watcher.lastCheckedAt ? '' : ' (waiting for the first check)'}.</p>
  return (
    <div className="watcher-diff" aria-label="Last change">
      <p className="watcher-diff-heading">{changeSummary(diff)} · {new Date(diff.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
      <ol className="watcher-diff-lines">
        {diff.lines.map((line, index) => (
          <li key={index} className={`is-${line.type}`}>
            <span className="watcher-diff-sign" aria-label={line.type === 'added' ? 'Added' : line.type === 'removed' ? 'Removed' : 'Unchanged'}>{line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}</span>
            <span className="watcher-diff-text">{line.text}</span>
          </li>
        ))}
      </ol>
      {diff.truncated && <p className="settings-help">Only the first {diff.lines.length} lines of the change are shown.</p>}
    </div>
  )
}

function EditForm({ watcher, onDone }: { watcher: PageWatcherSummary; onDone: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(watcher.title)
  const [selector, setSelector] = useState(watcher.selector ?? '')
  const [interval, setIntervalMinutes] = useState<WatchIntervalMinutes>(watcher.intervalMinutes)
  const [renderJs, setRenderJs] = useState(watcher.renderJs)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.browser.watchers.update(watcher.id, { title, selector: selector.trim() || null, intervalMinutes: interval, renderJs })
      if (result.ok) onDone()
      else setError(result.error)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="watcher-edit" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="settings-field">
        <span>Name</span>
        <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Watch (CSS selector)</span>
        <input type="text" value={selector} placeholder="Empty: the page’s main text" spellCheck={false} onChange={(event) => setSelector(event.target.value)} />
      </label>
      <div className="watcher-edit-row">
        <IntervalSelect value={interval} onChange={setIntervalMinutes} label="Check interval" />
        <label className="watcher-check">
          <input type="checkbox" checked={renderJs} onChange={(event) => setRenderJs(event.target.checked)} />
          <span>Render JavaScript<small>For pages that build their content with scripts. Slower; loads the page in a hidden window.</small></span>
        </label>
      </div>
      {(selector.trim() !== (watcher.selector ?? '') || renderJs !== watcher.renderJs) && <p className="settings-help">Changing what is watched starts a new baseline.</p>}
      <div className="settings-actions">
        <button className="settings-action secondary" type="button" onClick={onDone}>Cancel</button>
        <button className="settings-action primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {error && <p className="settings-message is-error" role="status">{error}</p>}
    </form>
  )
}

type FocusRequest = { id: string; nonce: number; mode: 'edit' | 'diff' }

function WatcherItem({ watcher, running, now, focus }: { watcher: PageWatcherSummary; running: boolean; now: number; focus: FocusRequest | null }): React.JSX.Element {
  const [mode, setMode] = useState<'edit' | 'diff' | null>(focus?.mode ?? null)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!focus) return
    setMode(focus.mode)
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])
  // Opening the diff is what clears the badge.
  useEffect(() => {
    if (mode === 'diff' && watcher.unseen) void window.api.browser.watchers.update(watcher.id, { seen: true })
  }, [mode, watcher.unseen, watcher.id])

  const host = (() => { try { return new URL(watcher.url).host } catch { return watcher.url } })()
  const status = running
    ? 'Checking…'
    : watcher.paused
    ? 'Paused'
    : watcher.lastError && watcher.consecutiveErrors > 0
    ? `Error: ${watcher.lastError} · retrying ${relativeTime(watcher.nextCheckAt, now)}`
    : watcher.lastError
    ? `${watcher.lastError} · retrying ${relativeTime(watcher.nextCheckAt, now)}`
    : `Checked ${relativeTime(watcher.lastCheckedAt, now)} · changed ${relativeTime(watcher.lastChangedAt, now)} · next ${relativeTime(watcher.nextCheckAt, now)}`

  return (
    <li ref={ref} className={`watcher-item${watcher.unseen ? ' is-unseen' : ''}${watcher.paused ? ' is-paused' : ''}`}>
      <div className="watcher-summary">
        <div className="watcher-copy">
          <span className="watcher-title">
            {watcher.title}
            {watcher.unseen && <span className="watcher-badge">Changed</span>}
          </span>
          <small className="watcher-target">{host}{watcher.selector ? <> · <code>{watcher.selector}</code></> : ' · main text'}{watcher.renderJs ? ' · JavaScript' : ''} · {watchIntervalLabel(watcher.intervalMinutes).toLowerCase()}</small>
          <small className={`watcher-status${watcher.lastError && watcher.consecutiveErrors > 0 ? ' is-error' : ''}`}>{status}</small>
        </div>
        <div className="watcher-actions">
          <button className="settings-action secondary" type="button" aria-pressed={mode === 'diff'} onClick={() => setMode(mode === 'diff' ? null : 'diff')}>Changes</button>
          <button className="settings-action secondary" type="button" disabled={running || watcher.paused} onClick={() => void window.api.browser.watchers.checkNow(watcher.id)}>Check now</button>
          <button className="settings-action secondary" type="button" onClick={() => void window.api.browser.watchers.update(watcher.id, { paused: !watcher.paused })}>{watcher.paused ? 'Resume' : 'Pause'}</button>
          <button className="settings-action secondary" type="button" aria-pressed={mode === 'edit'} onClick={() => setMode(mode === 'edit' ? null : 'edit')}>Edit</button>
          <button className="privacy-icon-button" type="button" title="Delete watcher" aria-label={`Delete watcher for ${watcher.title}`} onClick={() => void window.api.browser.watchers.remove(watcher.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      {mode === 'diff' && <DiffView watcher={watcher} />}
      {mode === 'edit' && <EditForm watcher={watcher} onDone={() => setMode(null)} />}
    </li>
  )
}

function AddWatcher({ full }: { full: boolean }): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [interval, setIntervalMinutes] = useState<WatchIntervalMinutes>(DEFAULT_WATCH_INTERVAL)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function add(): Promise<void> {
    setMessage(null)
    const target = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
    const result = await window.api.browser.watchers.add({ url: target, intervalMinutes: interval })
    if (result.ok) {
      setUrl('')
      setMessage({ text: `Watching ${result.watcher.title}. The first check sets the baseline.`, error: false })
    } else {
      setMessage({ text: result.error, error: true })
    }
  }

  return (
    <SettingsGroup title="Add a page">
      <p className="settings-help">Or right-click any page: <strong>Watch This Page for Changes…</strong> for its main text, or <strong>Watch Part of This Page…</strong> and click the element to watch. Private tabs are never watched.</p>
      <form className="watcher-add" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <label className="settings-field settings-field-grow">
          <span>Address</span>
          <input type="text" value={url} placeholder="https://example.com/changelog" spellCheck={false} autoCapitalize="none" onChange={(event) => setUrl(event.target.value)} />
        </label>
        <IntervalSelect value={interval} onChange={setIntervalMinutes} label="Check interval for the new watcher" />
        <button className="settings-action primary" type="submit" disabled={!url.trim() || full}>Watch</button>
      </form>
      {message && <p className={`settings-message${message.error ? ' is-error' : ''}`} role="status">{message.text}</p>}
    </SettingsGroup>
  )
}

export function PageWatchersSettings(): React.JSX.Element {
  const snapshot = useWatchers()
  const [now, setNow] = useState(() => Date.now())
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    // From a change notification (open its diff) or a new watcher (open its settings).
    const off = window.api.browser.watchers.onFocus((request) => setFocus({ id: request.id, mode: request.mode === 'edit' ? 'edit' : 'diff', nonce: Date.now() }))
    return () => {
      window.clearInterval(timer)
      off()
    }
  }, [])
  useEffect(() => { setNow(Date.now()) }, [snapshot])
  const watchers = snapshot?.watchers ?? []
  const running = new Set(snapshot?.running ?? [])
  const unseen = watchers.filter((watcher) => watcher.unseen).length

  return (
    <div className="settings-view settings-view-watchers">
      <header className="settings-page-header">
        <div className="settings-page-heading-copy">
          <h1>Watchers</h1>
          <p>Get a notification when a page, or one part of it, changes.</p>
        </div>
      </header>
      <div className="settings-content">
        <AddWatcher full={watchers.length >= MAX_WATCHERS} />
        <SettingsGroup title="Watching" status={snapshot ? `${watchers.length} of ${MAX_WATCHERS}${unseen ? ` · ${unseen} changed` : ''}` : undefined} statusOn={unseen > 0}>
          {!snapshot ? <p className="settings-help">Loading…</p> : watchers.length === 0 ? (
            <p className="settings-help">Nothing yet. Watched pages are checked in the background through your proxy; the proxy kill switch pauses checks while it blocks traffic.</p>
          ) : (
            <ul className="watcher-list">
              {watchers.map((watcher) => (
                <WatcherItem
                  key={watcher.id}
                  watcher={watcher}
                  running={running.has(watcher.id)}
                  now={now}
                  focus={focus?.id === watcher.id ? focus : null}
                />
              ))}
            </ul>
          )}
        </SettingsGroup>
        <SettingsGroup title="How checks work">
          <SettingsRow label="Plain fetch (default)" hint="Downloads the page’s HTML with your browser session and proxy, and compares its text. Nothing on the page runs.">
            <span className="settings-status">Fast</span>
          </SettingsRow>
          <SettingsRow label="Render JavaScript" hint="Loads the page in a hidden window so script-built content appears. Turn it on per watcher in Edit.">
            <span className="settings-status">Slower</span>
          </SettingsRow>
          <p className="settings-help">Failed checks retry later and later (up to every two days) until the page works again.</p>
        </SettingsGroup>
      </div>
    </div>
  )
}
