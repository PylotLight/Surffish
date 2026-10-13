import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { BookmarkNode } from '../../../../shared/types'
import { BOOKMARKS_ROOT_ID } from '../../../../shared/bookmarks'
import { bookmarkMenuRows, submenuSide } from '../../../../shared/bookmarks-menu'
import { BookmarkFavicon, FolderGlyph } from './BookmarkParts'
import { usePopoverDismiss } from '../../lib/popover-dismiss'
import { bookmarkHost, bookmarksBelow, openBookmarkUrl, openBookmarksInTabs, type BookmarksState } from './useBookmarks'

const SUBMENU_WIDTH = 280
const HOVER_OPEN_MS = 140

/** Ask the bookmark manager (content surface) to open with its Import… panel showing. */
export const BOOKMARK_IMPORT_REQUEST_KEY = 'surffish.bookmarks.importRequest'
export function requestBookmarkImport(): void {
  localStorage.setItem(BOOKMARK_IMPORT_REQUEST_KEY, JSON.stringify(Date.now()))
}

interface MenuProps {
  bookmarks: BookmarksState
  cachedIcons: Record<string, string>
  folderId: string
  onClose: () => void
  onShowManager: () => void
  onLayout?: () => void
  /** Root menu only: the footer actions. */
  footer?: React.ReactNode
  id?: string
  className?: string
  style?: React.CSSProperties
  label: string
}

/**
 * One level of the bookmarks dropdown. Folders open a submenu beside their row (hover, click,
 * or →); bookmarks open here, ⌘/Ctrl-click or middle-click opens a new tab.
 */
export function BookmarksMenuPanel({ bookmarks, cachedIcons, folderId, onClose, onShowManager, onLayout, footer, id, className = '', style, label }: MenuProps): React.JSX.Element {
  const { index } = bookmarks
  const rows = bookmarkMenuRows(index, folderId)
  const [openFolder, setOpenFolder] = useState<{ id: string; top: number; side: 'left' | 'right' } | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])
  useLayoutEffect(() => { onLayout?.() }, [openFolder?.id, rows.length])

  function showFolder(node: BookmarkNode, row: HTMLElement): void {
    const rect = row.getBoundingClientRect()
    const panel = panelRef.current?.getBoundingClientRect()
    setOpenFolder({ id: node.id, top: rect.top - (panel?.top ?? 0) - 6, side: submenuSide(rect.right, rect.left, SUBMENU_WIDTH, window.innerWidth) })
  }

  function open(node: BookmarkNode, event: ReactMouseEvent | React.KeyboardEvent): void {
    if (!node.url) return
    const newTab = event.metaKey || event.ctrlKey || ('button' in event && event.button === 1)
    void openBookmarkUrl(node.url, newTab ? 'new-tab' : 'current')
    onClose()
  }

  const folderBookmarks = folderId !== BOOKMARKS_ROOT_ID ? bookmarksBelow(index, folderId) : []
  return (
    <div ref={panelRef} id={id} className={`bookmarks-menu-panel ${className}`.trim()} role="menu" aria-label={label} style={style}>
      <div className="bookmarks-menu-scroll">
        {rows.length === 0 && <p className="bookmarks-menu-empty">{folderId === BOOKMARKS_ROOT_ID ? 'No bookmarks yet. Click the star in the address bar to add one.' : 'Empty folder'}</p>}
        {rows.map((row) => {
          if (row.kind === 'separator') return <div key={row.key} className="bookmarks-menu-separator" role="separator" />
          if (row.kind === 'more') return <button key="more" type="button" role="menuitem" className="bookmarks-menu-item is-more" onClick={() => { onShowManager(); onClose() }}>{row.count} more in the bookmark manager…</button>
          const node = row.node
          const isFolder = node.type === 'folder'
          const isOpen = openFolder?.id === node.id
          return (
            <button
              key={node.id}
              type="button"
              role="menuitem"
              className={`bookmarks-menu-item${isFolder ? ' is-folder' : ''}${isOpen ? ' is-open' : ''}`}
              aria-haspopup={isFolder ? 'menu' : undefined}
              aria-expanded={isFolder ? isOpen : undefined}
              title={isFolder ? node.title : `${node.title}\n${node.url}`}
              data-bookmark-id={node.id}
              onMouseEnter={(event) => {
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
                const row = event.currentTarget
                hoverTimer.current = setTimeout(() => {
                  if (isFolder) showFolder(node, row)
                  else setOpenFolder(null)
                }, HOVER_OPEN_MS)
              }}
              onClick={(event) => {
                if (isFolder) {
                  if (isOpen) setOpenFolder(null)
                  else showFolder(node, event.currentTarget)
                } else open(node, event)
              }}
              onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
              onAuxClick={(event) => { if (event.button === 1 && !isFolder) { event.preventDefault(); open(node, event) } }}
              onKeyDown={(event) => {
                if (isFolder && (event.key === 'ArrowRight' || event.key === 'Enter')) {
                  event.preventDefault()
                  showFolder(node, event.currentTarget)
                  requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('.bookmarks-menu-submenu .bookmarks-menu-item')?.focus())
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const items = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > .bookmarks-menu-item') ?? [])
                  const at = items.indexOf(event.currentTarget)
                  items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
                }
              }}
            >
              {isFolder ? <FolderGlyph open={isOpen} /> : <BookmarkFavicon node={node} cachedIcons={cachedIcons} />}
              <span className="bookmarks-menu-title">{node.title || bookmarkHost(node.url)}</span>
              {isFolder && <span className="bookmarks-menu-chevron" aria-hidden="true">›</span>}
            </button>
          )
        })}
        {folderBookmarks.length > 1 && <>
          <div className="bookmarks-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="bookmarks-menu-item is-action" onClick={() => { void openBookmarksInTabs(folderBookmarks); onClose() }}>Open all ({folderBookmarks.length})</button>
        </>}
      </div>
      {footer}
      {openFolder && (
        <BookmarksMenuPanel
          key={openFolder.id}
          bookmarks={bookmarks}
          cachedIcons={cachedIcons}
          folderId={openFolder.id}
          onClose={onClose}
          onShowManager={onShowManager}
          onLayout={onLayout}
          className={`bookmarks-menu-submenu is-${openFolder.side}`}
          style={{ top: Math.max(0, openFolder.top), width: SUBMENU_WIDTH }}
          label={bookmarks.index.byId.get(openFolder.id)?.title ?? 'Folder'}
        />
      )}
    </div>
  )
}

/** Close a menu on outside click, Escape, focus leaving, or a press on the page (usePopoverDismiss). */
export function useDismiss(open: boolean, containerRef: React.RefObject<HTMLElement | null>, close: () => void, returnFocus?: React.RefObject<HTMLElement | null>): void {
  usePopoverDismiss(open, containerRef, close, { returnFocusRef: returnFocus, preventEscapeDefault: true })
}

/** The toolbar's bookmarks button (next to the address bar): the whole tree as a dropdown. */
export function BookmarksMenuButton({ bookmarks, cachedIcons, barVisible, onToggleBar, onShowManager, onOpenChange, onLayout }: {
  bookmarks: BookmarksState
  cachedIcons: Record<string, string>
  barVisible: boolean
  onToggleBar: () => void
  onShowManager: () => void
  onOpenChange?: (open: boolean) => void
  onLayout?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { onOpenChange?.(open) }, [open])
  useDismiss(open, controlRef, () => setOpen(false), buttonRef)
  const isMac = window.api.platform === 'darwin'
  return (
    <div className="bookmarks-menu-control" ref={controlRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`omnibox-action-button bookmarks-menu-button${open ? ' is-current' : ''}`}
        aria-label="Bookmarks"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="bookmarks-menu"
        title="Bookmarks"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a1 1 0 0 1 1 1v14l-6-3.6-6 3.6v-14a1 1 0 0 1 1-1Z" /></svg>
      </button>
      {open && (
        <BookmarksMenuPanel
          id="bookmarks-menu"
          className="bookmarks-menu-root"
          bookmarks={bookmarks}
          cachedIcons={cachedIcons}
          folderId={BOOKMARKS_ROOT_ID}
          onClose={() => setOpen(false)}
          onShowManager={onShowManager}
          onLayout={onLayout}
          label="Bookmarks"
          footer={(
            <div className="bookmarks-menu-footer">
              <div className="bookmarks-menu-separator" role="separator" />
              <button type="button" role="menuitem" className="bookmarks-menu-item is-action" onClick={() => { setOpen(false); onShowManager() }}>
                <span className="bookmarks-menu-title">Bookmark manager…</span>
                <kbd>{isMac ? '⌥⌘B' : 'Ctrl+Alt+B'}</kbd>
              </button>
              <button type="button" role="menuitem" className="bookmarks-menu-item is-action" onClick={() => { setOpen(false); requestBookmarkImport(); onShowManager() }}>
                <span className="bookmarks-menu-title">Import…</span>
              </button>
              <button type="button" role="menuitemcheckbox" aria-checked={barVisible} className="bookmarks-menu-item is-action" onClick={() => { setOpen(false); onToggleBar() }}>
                <span className="bookmarks-menu-title">{barVisible ? 'Hide bookmarks bar' : 'Show bookmarks bar'}</span>
                <kbd>{isMac ? '⇧⌘B' : 'Ctrl+Shift+B'}</kbd>
              </button>
            </div>
          )}
        />
      )}
    </div>
  )
}
