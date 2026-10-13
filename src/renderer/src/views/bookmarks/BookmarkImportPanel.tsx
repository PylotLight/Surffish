import { useEffect, useState } from 'react'
import type { BookmarkImportSource, BookmarkImportSummary } from '../../../../shared/bookmark-import'
import { ipcErrorMessage } from './BookmarkParts'

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : many}`
}

export function describeImportSummary(summary: BookmarkImportSummary): string[] {
  const lines: string[] = []
  if (summary.bookmarks) {
    const { added, folders, duplicates, skipped, folderTitle } = summary.bookmarks
    const extras = [
      duplicates ? `${plural(duplicates, 'duplicate')} skipped` : '',
      skipped ? `${skipped.toLocaleString()} unsupported (not http/https) skipped` : ''
    ].filter(Boolean).join(', ')
    lines.push(added > 0
      ? `Added ${plural(added, 'bookmark')}${folders ? ` in ${plural(folders, 'folder')}` : ''} to “${folderTitle}”${extras ? ` (${extras})` : ''}.`
      : `No new bookmarks${extras ? ` (${extras})` : ''}.`)
  }
  if (summary.history) {
    lines.push(summary.history.found === 0
      ? 'No history found.'
      : `Added ${plural(summary.history.added, 'history entry', 'history entries')} of ${summary.history.found.toLocaleString()} found (Surffish keeps the newest 5,000).`)
  }
  return lines
}

/** Settings → General → Import, and the bookmark manager's Import… panel. */
export function BookmarkImportPanel({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const [sources, setSources] = useState<BookmarkImportSource[] | null>(null)
  const [selected, setSelected] = useState('')
  const [withBookmarks, setWithBookmarks] = useState(true)
  const [withHistory, setWithHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<BookmarkImportSummary | null>(null)
  const [error, setError] = useState('')

  async function refresh(): Promise<void> {
    try {
      const next = await window.api.browser.bookmarks.importSources()
      setSources(next)
      setSelected((current) => next.some((source) => source.id === current) ? current : next[0]?.id ?? '')
    } catch (caught) {
      setSources([])
      setError(ipcErrorMessage(caught))
    }
  }

  useEffect(() => { void refresh() }, [])

  const source = sources?.find((candidate) => candidate.id === selected)

  async function run(action: () => Promise<BookmarkImportSummary>): Promise<void> {
    setBusy(true)
    setError('')
    setSummary(null)
    try {
      const result = await action()
      if (!result.cancelled) setSummary(result)
    } catch (caught) {
      setError(ipcErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`bookmark-import${compact ? ' is-compact' : ''}`}>
      <div className="bookmark-import-row">
        <label className="settings-field settings-field-grow">
          <span>From</span>
          <select className="settings-select" value={selected} disabled={busy || !sources?.length} onChange={(event) => setSelected(event.target.value)} aria-label="Browser and profile to import from">
            {sources === null && <option value="">Looking for browsers…</option>}
            {sources?.length === 0 && <option value="">No other browsers found</option>}
            {sources?.map((candidate) => <option key={candidate.id} value={candidate.id}>{`${candidate.browserLabel} — ${candidate.profileName}`}</option>)}
          </select>
        </label>
        <button type="button" className="settings-action secondary" disabled={busy} onClick={() => void refresh()} title="Look for browser profiles again">Refresh</button>
      </div>
      <div className="bookmark-import-row">
        <label className="bookmark-import-check"><input type="checkbox" checked={withBookmarks} disabled={busy || source?.hasBookmarks === false} onChange={(event) => setWithBookmarks(event.target.checked)} /> Bookmarks</label>
        <label className="bookmark-import-check"><input type="checkbox" checked={withHistory} disabled={busy || source?.hasHistory === false} onChange={(event) => setWithHistory(event.target.checked)} /> History</label>
        <span className="bookmark-import-spacer" />
        <button type="button" className="settings-action secondary" disabled={busy} onClick={() => void run(() => window.api.browser.bookmarks.importHtml())}>HTML file…</button>
        <button
          type="button"
          className="settings-action primary"
          disabled={busy || !source || (!withBookmarks && !withHistory)}
          onClick={() => source && void run(() => window.api.browser.bookmarks.importFrom(source.id, { bookmarks: withBookmarks && source.hasBookmarks, history: withHistory && source.hasHistory }))}
        >{busy ? 'Importing…' : 'Import'}</button>
      </div>
      {summary && (
        <div className={`settings-message${summary.errors.length > 0 ? ' is-error' : ''}`} role="status">
          {describeImportSummary(summary).map((line) => <p key={line}>{line}</p>)}
          {summary.errors.map((line) => <p key={line}>{line}</p>)}
          {summary.needsFullDiskAccess && (
            <button type="button" className="settings-action secondary" onClick={() => void window.api.browser.bookmarks.openFullDiskAccess()}>Open Full Disk Access settings</button>
          )}
        </div>
      )}
      {error && <p className="settings-message is-error" role="alert">{error}</p>}
      <p className="settings-help">
        Imports go into an “Imported from …” folder; addresses you already have are skipped. History comes from a copy of the other browser's database
        {source?.browser === 'firefox' ? ' (quit Firefox first to include the last few minutes)' : ''}.
        {source?.browser === 'safari' ? ' Safari data needs Full Disk Access for Surffish.' : ''} Passwords are not imported; use Bramble for those.
      </p>
    </div>
  )
}
