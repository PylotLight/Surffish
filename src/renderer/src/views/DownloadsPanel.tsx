import { useEffect, useState } from 'react'
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

export default function DownloadsPanel({ mode, onShowAll, onClose }: DownloadsPanelProps): React.JSX.Element {
  const [items, setItems] = useState<DownloadEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')

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

  const visibleItems = mode === 'popup' ? items.slice(0, 6) : items
  const id = mode === 'popup' ? 'downloads-popup' : 'downloads-page'

  return (
    <section className={`downloads-panel downloads-panel-${mode}${mode === 'page' ? ' downloads-page' : ''}`} id={id} aria-label={mode === 'popup' ? 'Recent downloads' : 'Downloads'} role={mode === 'popup' ? 'dialog' : undefined}>
      {mode === 'popup' ? (
        <header className="downloads-popup-header">
          <div><strong>Downloads</strong><span>{items.length ? `${items.length} saved in this list` : 'Recent activity'}</span></div>
          <div className="downloads-popup-header-actions">
            {onShowAll && <button type="button" className="downloads-show-all" onClick={onShowAll}>Show all</button>}
            {onClose && <button type="button" className="downloads-close" onClick={onClose} aria-label="Close downloads" title="Close">×</button>}
          </div>
        </header>
      ) : (
        <header className="downloads-page-header">
          <div><h1>Downloads</h1><p>Recent files and transfers from this browser.</p></div>
          <span className="downloads-count">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        </header>
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
          <span className="downloads-empty-icon" aria-hidden="true">↓</span>
          <strong>No downloads yet</strong>
          <span>Files you download will appear here.</span>
        </div>
      ) : (
        <>
          <ul className="downloads-list" aria-label={mode === 'popup' ? 'Recent downloads list' : 'Download history'}>
            {visibleItems.map((entry) => <DownloadRow key={entry.id} entry={entry} onMessage={setActionMessage} />)}
          </ul>
          {mode === 'popup' && items.length > visibleItems.length && <p className="downloads-more-note">Showing the 6 most recent downloads.</p>}
          {mode === 'page' && <p className="downloads-history-note">Removing an item clears its history only; it never deletes the downloaded file.</p>}
          {actionMessage && <p className="downloads-action-message" role="status">{actionMessage}</p>}
        </>
      )}
    </section>
  )
}
