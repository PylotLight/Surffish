import { useEffect, useMemo, useState } from 'react'
import type { BookmarkNode } from '../../../../shared/types'
import { formatArchivedAge, searchArchivedTabs, type ArchivedTab } from '../../../../shared/tab-archive'
import { useStoredState } from '../../lib/stored-state'
import { BookmarkFavicon } from '../bookmarks/BookmarkParts'
import { useTabArchive } from './useTabArchive'
import './tab-archive.css'

const MAX_ROWS = 200

function asNode(tab: ArchivedTab): BookmarkNode {
  return { id: tab.id, type: 'bookmark', title: tab.title, url: tab.url, faviconUrl: tab.faviconUrl ?? undefined, parentId: null, index: 0, dateAdded: tab.archivedAt }
}

/**
 * "Archived" section under the bookmarks: tabs auto-archive (or Archive Tab) closed. Click restores,
 * × deletes; search, Restore all and Clear in the header. Hidden while the archive is empty.
 */
export function ArchivedTabsSidebar({ cachedIcons, onOpened }: { cachedIcons: Record<string, string>; onOpened: () => void }): React.JSX.Element | null {
  const archive = useTabArchive()
  const [sectionOpen, setSectionOpen] = useStoredState('surffish.tab-archive.sidebar.open', false)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!sectionOpen) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [sectionOpen, archive.tabs])
  const results = useMemo(() => searchArchivedTabs(archive.tabs, query), [archive.tabs, query])
  if (archive.tabs.length === 0) return null

  function restore(tab: ArchivedTab): void {
    void window.api.browser.tabArchive.restore(tab.id).then((id) => { if (id) onOpened() }).catch(() => undefined)
  }

  function restoreAll(): void {
    const ids = query.trim() ? results.map((tab) => tab.id) : undefined
    const count = ids?.length ?? archive.tabs.length
    if (count > 15 && !window.confirm(`Restore ${count} archived tabs?`)) return
    void window.api.browser.tabArchive.restoreAll(ids).then(onOpened).catch(() => undefined)
  }

  function clear(): void {
    if (!window.confirm(`Clear all ${archive.tabs.length} archived tabs? This can't be undone.`)) return
    void window.api.browser.tabArchive.clear().catch(() => undefined)
  }

  return (
    <section className={`sidebar-bookmarks sidebar-archived${sectionOpen ? ' is-open' : ''}`} aria-label="Archived tabs">
      <div className="sidebar-bookmarks-header">
        <button type="button" className="sidebar-bookmarks-toggle" aria-expanded={sectionOpen} onClick={() => setSectionOpen(!sectionOpen)}>
          <span className={`bookmark-chevron${sectionOpen ? ' is-open' : ''}`} aria-hidden="true">›</span>
          <span>Archived</span>
          <span className="sidebar-archived-count">{archive.tabs.length}</span>
        </button>
        {sectionOpen && <>
          <button type="button" className="sidebar-icon-button" aria-label={query.trim() ? 'Restore matching archived tabs' : 'Restore all archived tabs'} title={query.trim() ? 'Restore matching' : 'Restore all'} disabled={results.length === 0} onClick={restoreAll}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4.5v4h4" /></svg>
          </button>
          <button type="button" className="sidebar-icon-button" aria-label="Clear archived tabs" title="Clear archive" onClick={clear}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
          </button>
        </>}
      </div>
      {sectionOpen && (
        <div className="sidebar-bookmarks-tree sidebar-archived-list" role="list" aria-label="Archived tabs">
          <label className="sidebar-archived-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archived tabs" aria-label="Search archived tabs" spellCheck={false} />
          </label>
          {results.slice(0, MAX_ROWS).map((tab) => (
            <div
              key={tab.id}
              className="bookmark-row sidebar-archived-row"
              role="listitem"
              tabIndex={0}
              title={`${tab.title}\n${tab.url}\nArchived ${new Date(tab.archivedAt).toLocaleString()}${tab.reason === 'auto' ? ' (auto)' : ''}${tab.spaceName ? ` · from ${tab.spaceName}` : ''} · click to restore`}
              onClick={() => restore(tab)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); restore(tab) }
                else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void window.api.browser.tabArchive.remove([tab.id]) }
              }}
            >
              <BookmarkFavicon node={asNode(tab)} cachedIcons={cachedIcons} />
              <span className="sidebar-archived-title">{tab.title}</span>
              <span className="sidebar-archived-age">{formatArchivedAge(tab.archivedAt, now)}</span>
              <button
                type="button"
                className="sidebar-archived-delete"
                aria-label={`Delete ${tab.title} from the archive`}
                title="Delete"
                onClick={(event) => { event.stopPropagation(); void window.api.browser.tabArchive.remove([tab.id]) }}
              >×</button>
            </div>
          ))}
          {results.length > MAX_ROWS && <p className="bookmark-row-empty">{results.length - MAX_ROWS} more · search to narrow</p>}
          {results.length === 0 && <p className="bookmark-row-empty">No archived tabs match</p>}
        </div>
      )}
    </section>
  )
}
