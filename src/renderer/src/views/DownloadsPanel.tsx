import { useEffect, useRef, useState } from 'react'
import type { DownloadEntry } from '../../../shared/downloads'
import { formatDownloadSize, getDownloadProgress } from '../../../shared/downloads'
import './DownloadsPanel.css'

interface DownloadsPanelProps {
  mode: 'popup' | 'page'
  onShowAll?: () => void
  onClose?: () => void
}

function dateLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Date unavailable'
  const date = new Date(timestamp)
  if (Number.isNaN(date.valueOf())) return 'Date unavailable'
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })
}

function dateTimeValue(timestamp: number): string | undefined {
  const date = new Date(timestamp)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function stateLabel(entry: DownloadEntry): string {
  if (entry.state === 'completed') return 'Complete'
  if (entry.state === 'cancelled') return 'Cancelled'
  if (entry.state === 'failed') return 'Failed'
  if (entry.state === 'paused') return 'Paused'
  if (entry.state === 'interrupted') return entry.canResume ? 'Interrupted · can resume' : 'Interrupted'
  const progress = getDownloadProgress(entry.receivedBytes, entry.totalBytes)
  return progress === null ? 'Downloading' : `Downloading · ${progress}%`
}

function DownloadRow({ entry, onMessage }: { entry: DownloadEntry; onMessage: (message: string) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const canCancel = entry.state === 'progressing' || entry.state === 'paused' || entry.state === 'interrupted'
  const canResume = entry.state === 'paused' || (entry.state === 'interrupted' && entry.canResume)
  const canPause = entry.state === 'progressing'
  const progress = getDownloadProgress(entry.receivedBytes, entry.totalBytes)
  const timestamp = entry.completedAt ?? entry.startedAt
  const date = dateLabel(timestamp)

  async function run(action: (id: string) => Promise<boolean>, failureMessage: string): Promise<void> {
    setBusy(true)
    onMessage('')
    try {
      if (!await action(entry.id)) onMessage(failureMessage)
    } catch {
      onMessage(failureMessage)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`download-row is-${entry.state}`}>
      <span className="download-file-badge" aria-hidden="true">{/\.([a-z0-9]{1,4})$/i.exec(entry.filename)?.[1]?.toUpperCase() ?? 'FILE'}</span>
      <div className="download-row-main">
        <div className="download-row-title-line">
          <strong className="download-filename" title={entry.filename}>{entry.filename}</strong>
          <span className={`download-state is-${entry.state}`}>{stateLabel(entry)}</span>
        </div>
        <div className="download-row-meta">
          <span title={`Source: ${entry.source}`}>{entry.source}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={dateTimeValue(timestamp)}>{date}</time>
        </div>
        {(entry.state === 'progressing' || entry.state === 'paused' || entry.state === 'interrupted') && (
          <div className="download-progress-wrap">
            <progress aria-label={`Download progress for ${entry.filename}`} max={100} value={progress ?? undefined} />
            <span>{formatDownloadSize(entry.receivedBytes)} received{entry.totalBytes > 0 ? ` of ${formatDownloadSize(entry.totalBytes)}` : ' · size unknown'}</span>
          </div>
        )}
        {entry.state === 'completed' && <span className="download-complete-size">{formatDownloadSize(entry.totalBytes || entry.receivedBytes)}</span>}
        {(entry.state === 'failed' || entry.state === 'cancelled') && <p className="download-row-message">{entry.message ?? (entry.state === 'failed' ? 'The download failed.' : 'Cancelled.')}</p>}
        {entry.fileAvailable && <span className="download-file-note">Saved file is available on this device.</span>}
      </div>
      <div className="download-row-actions" role="group" aria-label={`Actions for ${entry.filename}`}>
        {canPause && <button type="button" disabled={busy} onClick={() => void run(window.api.browser.downloads.pause, 'Could not pause this download.')} aria-label={`Pause ${entry.filename}`} title="Pause">Pause</button>}
        {canResume && <button type="button" disabled={busy} onClick={() => void run(window.api.browser.downloads.resume, 'Could not resume this download.')} aria-label={`Resume ${entry.filename}`} title="Resume">Resume</button>}
        {canCancel && <button type="button" className="download-action-muted" disabled={busy} onClick={() => void run(window.api.browser.downloads.cancel, 'Could not cancel this download.')} aria-label={`Cancel ${entry.filename}`} title="Cancel">Cancel</button>}
        {entry.state === 'completed' && entry.fileAvailable && <button type="button" onClick={() => void run(window.api.browser.downloads.open, 'Could not open this file.')} aria-label={`Open ${entry.filename}`} title="Open file">Open</button>}
        {entry.fileAvailable && <button type="button" className="download-action-muted" onClick={() => void run(window.api.browser.downloads.reveal, 'Could not show this file in its folder.')} aria-label={`Show ${entry.filename} in folder`} title="Show in folder">Show in folder</button>}
        {!canCancel && <button type="button" className="download-action-remove" onClick={() => void run(window.api.browser.downloads.remove, 'Could not remove this download from the list.')} aria-label={`Remove ${entry.filename} from download history`} title="Remove from list">Remove</button>}
      </div>
    </li>
  )
}

const Icon = {
  folder: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m15.5 15.5 4 4" /></svg>,
  more: <svg viewBox="0 0 24 24" aria-hidden="true"><circle className="downloads-dot" cx="6" cy="12" r="1.3" /><circle className="downloads-dot" cx="12" cy="12" r="1.3" /><circle className="downloads-dot" cx="18" cy="12" r="1.3" /></svg>,
  close: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>,
  external: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5h5v5M18.5 5.5l-7 7M10 6.5H6.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V14" /></svg>,
  trash: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
}

function matches(entry: DownloadEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return entry.filename.toLowerCase().includes(q) || entry.source.toLowerCase().includes(q)
}

export default function DownloadsPanel({ mode, onShowAll, onClose }: DownloadsPanelProps): React.JSX.Element {
  const [items, setItems] = useState<DownloadEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [searchOpen, setSearchOpen] = useState(mode === 'page')
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let mounted = true
    let receivedUpdate = false
    const unsubscribe = window.api.browser.downloads.onChange((next) => {
      receivedUpdate = true
      if (mounted) {
        setItems(next)
        setLoading(false)
        setLoadError('')
      }
    })
    void window.api.browser.downloads.get().then((initial) => {
      if (mounted && !receivedUpdate) setItems(initial)
    }).catch(() => {
      if (mounted) setLoadError('Could not load download history. Try again.')
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutside = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    return () => window.removeEventListener('pointerdown', closeOnOutside)
  }, [menuOpen])

  const filtered = items.filter((entry) => matches(entry, query))
  const visibleItems = mode === 'popup' ? filtered.slice(0, 6) : filtered
  const id = mode === 'popup' ? 'downloads-popup' : 'downloads-page'
  const clearable = items.some((entry) => entry.state !== 'progressing' && entry.state !== 'paused' && !(entry.state === 'interrupted' && entry.canResume))

  const openFolder = (): void => {
    void window.api.browser.downloads.openFolder().then((ok) => { if (!ok) setActionMessage('Could not open the Downloads folder.') })
  }
  const clearAll = (): void => {
    setMenuOpen(false)
    void window.api.browser.downloads.clear()
  }

  const tools = (
    <div className="downloads-tools">
      <button type="button" className="downloads-icon-button" onClick={openFolder} aria-label="Open Downloads folder" title="Open Downloads folder">{Icon.folder}</button>
      {mode === 'popup' && (
        <button type="button" className={`downloads-icon-button${searchOpen ? ' is-active' : ''}`} onClick={() => { setSearchOpen((open) => !open); if (searchOpen) setQuery('') }} aria-label="Search downloads" aria-pressed={searchOpen} title="Search downloads">{Icon.search}</button>
      )}
      <div className="downloads-menu-control" ref={menuRef}>
        <button type="button" className={`downloads-icon-button${menuOpen ? ' is-active' : ''}`} onClick={() => setMenuOpen((open) => !open)} aria-label="More download options" aria-haspopup="menu" aria-expanded={menuOpen} title="More options">{Icon.more}</button>
        {menuOpen && (
          <div className="downloads-menu" role="menu">
            {mode === 'popup' && onShowAll && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onShowAll() }}>{Icon.external}<span>Open downloads page</span></button>}
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); openFolder() }}>{Icon.folder}<span>Open Downloads folder</span></button>
            <hr />
            <button type="button" role="menuitem" disabled={!clearable} onClick={clearAll}>{Icon.trash}<span>Clear all download history</span></button>
          </div>
        )}
      </div>
      {mode === 'page' && onClose && <button type="button" className="downloads-icon-button downloads-page-close" onClick={onClose} aria-label="Close downloads" title="Close (Esc)">{Icon.close}<span>Close</span></button>}
    </div>
  )

  return (
    <section className={`downloads-panel downloads-panel-${mode}${mode === 'page' ? ' downloads-page' : ''}`} id={id} aria-label={mode === 'popup' ? 'Recent downloads' : 'Downloads'} role={mode === 'popup' ? 'dialog' : undefined}>
      {mode === 'popup' ? (
        <header className="downloads-popup-header">
          <strong>Downloads</strong>
          {tools}
        </header>
      ) : (
        <header className="downloads-page-header">
          <div><h1>Downloads</h1><p>{items.length} {items.length === 1 ? 'item' : 'items'} · removing an item never deletes the file.</p></div>
          {tools}
        </header>
      )}
      {searchOpen && (
        <label className="downloads-search">
          {Icon.search}
          <input type="search" value={query} autoFocus={mode === 'popup'} placeholder="Search downloads" aria-label="Search downloads" onChange={(event) => setQuery(event.target.value)} />
        </label>
      )}

      {loading ? (
        <p className="downloads-state-message" role="status">Loading downloads…</p>
      ) : loadError ? (
        <div className="downloads-state-message is-error" role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => {
            setLoading(true)
            setLoadError('')
            void window.api.browser.downloads.get().then(setItems).catch(() => setLoadError('Could not load download history. Try again.')).finally(() => setLoading(false))
          }}>Retry</button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="downloads-empty" role="status">
          <span className="downloads-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5M5.5 19h13" /></svg></span>
          <strong>{query ? 'No matching downloads' : 'No downloads yet'}</strong>
          {!query && <span>Files you download will appear here.</span>}
        </div>
      ) : (
        <ul className="downloads-list" aria-label={mode === 'popup' ? 'Recent downloads list' : 'Download history'}>
          {visibleItems.map((entry) => <DownloadRow key={entry.id} entry={entry} onMessage={setActionMessage} />)}
        </ul>
      )}
      {actionMessage && <p className="downloads-action-message" role="status">{actionMessage}</p>}
      {mode === 'popup' && onShowAll && (
        <footer className="downloads-popup-footer">
          <button type="button" className="downloads-show-all" onClick={onShowAll}>{filtered.length > visibleItems.length ? `See all ${filtered.length}` : 'See all downloads'}</button>
        </footer>
      )}
    </section>
  )
}
