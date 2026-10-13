import { useLayoutEffect, useRef, useState } from 'react'
import type { BookmarkNode } from '../../../../shared/types'
import { FAVOURITES_FOLDER_ID } from '../../../../shared/bookmarks'
import { barItemsThatFit, bookmarkBarNodes } from '../../../../shared/bookmarks-menu'
import { BookmarkFavicon, FolderGlyph } from './BookmarkParts'
import { BookmarksMenuPanel, useDismiss } from './BookmarksMenu'
import { bookmarkHost, openBookmarkUrl, type BookmarksState } from './useBookmarks'

const OVERFLOW_BUTTON_WIDTH = 30

/**
 * Optional bar under the toolbar (off by default, ⌘⇧B): what's in Favourites, folders open as
 * dropdowns, whatever doesn't fit goes in a » menu.
 */
export function BookmarksBar({ bookmarks, cachedIcons, onShowManager, onOpenChange, onLayout }: {
  bookmarks: BookmarksState
  cachedIcons: Record<string, string>
  onShowManager: () => void
  onOpenChange?: (open: boolean) => void
  onLayout?: () => void
}): React.JSX.Element {
  const nodes = bookmarkBarNodes(bookmarks.index)
  const barRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(nodes.length)
  const [menu, setMenu] = useState<{ folderId: string; left: number; key: string } | null>(null)
  useDismiss(menu !== null, barRef, () => { setMenu(null); onOpenChange?.(false) })

  useLayoutEffect(() => {
    const bar = barRef.current
    const measure = measureRef.current
    if (!bar || !measure) return
    const update = (): void => {
      const widths = Array.from(measure.children).map((child) => (child as HTMLElement).getBoundingClientRect().width)
      setFit(barItemsThatFit(widths, bar.clientWidth - 12, OVERFLOW_BUTTON_WIDTH))
    }
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    update()
    return () => observer.disconnect()
  }, [nodes])

  function toggleMenu(key: string, folderId: string, button: HTMLElement): void {
    if (menu?.key === key) {
      setMenu(null)
      onOpenChange?.(false)
      return
    }
    const barLeft = barRef.current?.getBoundingClientRect().left ?? 0
    setMenu({ key, folderId, left: Math.min(button.getBoundingClientRect().left - barLeft, Math.max(0, window.innerWidth - 300)) })
    onOpenChange?.(true)
  }

  function item(node: BookmarkNode, measuring = false): React.JSX.Element {
    const isFolder = node.type === 'folder'
    return (
      <button
        key={node.id}
        type="button"
        className={`bookmarks-bar-item${isFolder ? ' is-folder' : ''}${menu?.key === node.id ? ' is-open' : ''}`}
        tabIndex={measuring ? -1 : undefined}
        title={isFolder ? node.title : `${node.title}\n${node.url}`}
        aria-haspopup={isFolder ? 'menu' : undefined}
        aria-expanded={isFolder ? menu?.key === node.id : undefined}
        onClick={measuring ? undefined : (event) => {
          if (isFolder) toggleMenu(node.id, node.id, event.currentTarget)
          else if (node.url) void openBookmarkUrl(node.url, event.metaKey || event.ctrlKey ? 'new-tab' : 'current')
        }}
        onAuxClick={measuring ? undefined : (event) => {
          if (event.button === 1 && node.url) { event.preventDefault(); void openBookmarkUrl(node.url, 'new-tab') }
        }}
      >
        {isFolder ? <FolderGlyph /> : <BookmarkFavicon node={node} cachedIcons={cachedIcons} />}
        <span>{node.title || bookmarkHost(node.url)}</span>
      </button>
    )
  }

  const visible = nodes.slice(0, fit)
  const hidden = nodes.length - visible.length
  return (
    <nav ref={barRef} className="bookmarks-bar" aria-label="Bookmarks bar">
      <div className="bookmarks-bar-measure" ref={measureRef} aria-hidden="true">{nodes.map((node) => item(node, true))}</div>
      {nodes.length === 0 && <span className="bookmarks-bar-empty">Bookmarks in Favourites show here.</span>}
      {visible.map((node) => item(node))}
      {hidden > 0 && (
        <button type="button" className={`bookmarks-bar-item bookmarks-bar-overflow${menu?.key === '»' ? ' is-open' : ''}`} aria-label={`${hidden} more bookmarks`} title="More bookmarks" aria-haspopup="menu" aria-expanded={menu?.key === '»'} onClick={(event) => toggleMenu('»', FAVOURITES_FOLDER_ID, event.currentTarget)}>»</button>
      )}
      {menu && (
        <BookmarksMenuPanel
          key={menu.key}
          id="bookmarks-bar-menu"
          className="bookmarks-bar-menu"
          style={{ left: menu.left }}
          bookmarks={menu.key === '»' ? { ...bookmarks, index: overflowIndex(bookmarks, fit) } : bookmarks}
          cachedIcons={cachedIcons}
          folderId={menu.folderId}
          onClose={() => { setMenu(null); onOpenChange?.(false) }}
          onShowManager={onShowManager}
          onLayout={onLayout}
          label={menu.key === '»' ? 'More bookmarks' : bookmarks.index.byId.get(menu.folderId)?.title ?? 'Folder'}
        />
      )}
    </nav>
  )
}

/** The » menu lists only the Favourites items that didn't fit. */
function overflowIndex(bookmarks: BookmarksState, fit: number): BookmarksState['index'] {
  const children = new Map(bookmarks.index.children)
  children.set(FAVOURITES_FOLDER_ID, (bookmarks.index.children.get(FAVOURITES_FOLDER_ID) ?? []).slice(fit))
  return { ...bookmarks.index, children }
}
