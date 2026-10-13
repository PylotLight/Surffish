import { useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { BookmarkNode } from '../../../../shared/types'
import { BOOKMARKS_ROOT_ID, isFixedBookmarkFolder } from '../../../../shared/bookmarks'
import { useStoredState } from '../../lib/stored-state'
import { BookmarkFavicon, BookmarkInlineEditor, FolderGlyph, ipcErrorMessage } from './BookmarkParts'
import { bookmarkHost, bookmarksBelow, childrenOf, confirmDelete, openBookmarkUrl, openBookmarksInTabs, type BookmarksState } from './useBookmarks'
import { BOOKMARK_DRAG_TYPE, dropPlacement, dropTargetFor, type DropPlacement } from './bookmark-drag'

const MAX_ROWS_PER_FOLDER = 300

type EditState = { mode: 'edit'; id: string } | { mode: 'new-folder'; parentId: string; index?: number } | null

/** Collapsible bookmark tree in the sidebar (below the tabs): open, drag to reorder/move, right-click. */
export function BookmarksSidebar({ bookmarks, cachedIcons, onOpened, onShowManager }: {
  bookmarks: BookmarksState
  cachedIcons: Record<string, string>
  onOpened: () => void
  onShowManager: () => void
}): React.JSX.Element {
  const [sectionOpen, setSectionOpen] = useStoredState('surffish.bookmarks.sidebar.open', true)
  const [expanded, setExpanded] = useStoredState<string[]>('surffish.bookmarks.sidebar.expanded', [])
  const [edit, setEdit] = useState<EditState>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; placement: DropPlacement } | null>(null)
  const [error, setError] = useState('')
  const { index } = bookmarks
  const expandedSet = new Set(expanded)

  function toggleFolder(id: string, open?: boolean): void {
    const next = new Set(expandedSet)
    if (open ?? !next.has(id)) next.add(id)
    else next.delete(id)
    setExpanded([...next].slice(-500))
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      setError('')
      await action()
    } catch (caught) {
      setError(ipcErrorMessage(caught))
    }
  }

  function open(node: BookmarkNode, event?: ReactMouseEvent): void {
    if (!node.url) return
    const newTab = Boolean(event && (event.metaKey || event.ctrlKey || event.button === 1))
    void openBookmarkUrl(node.url, newTab ? 'new-tab' : 'current')
    if (!newTab) onOpened()
  }

  async function showMenu(node: BookmarkNode): Promise<void> {
    const action = await window.api.browser.bookmarks.contextMenu({
      type: node.type,
      fixed: isFixedBookmarkFolder(node.id),
      childCount: node.type === 'folder' ? bookmarksBelow(index, node.id).length : 0
    })
    if (!action) return
    if (action === 'open' && node.url) open(node)
    else if (action === 'open-new-tab' && node.url) void openBookmarkUrl(node.url, 'new-tab')
    else if (action === 'open-private' && node.url) void openBookmarkUrl(node.url, 'private')
    else if (action === 'open-all') void openBookmarksInTabs(bookmarksBelow(index, node.id))
    else if (action === 'edit') setEdit({ mode: 'edit', id: node.id })
    else if (action === 'new-folder') {
      if (node.type === 'folder') {
        toggleFolder(node.id, true)
        setEdit({ mode: 'new-folder', parentId: node.id })
      } else {
        setEdit({ mode: 'new-folder', parentId: node.parentId ?? BOOKMARKS_ROOT_ID, index: node.index + 1 })
      }
    } else if (action === 'delete' && confirmDelete(index, [node.id])) void run(() => window.api.browser.bookmarks.remove([node.id]))
  }

  function onDragOver(event: DragEvent<HTMLElement>, node: BookmarkNode): void {
    if (!dragId || !event.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return
    const placement = dropPlacement(event, node, index, dragId)
    if (!placement) {
      setDrop(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (drop?.id !== node.id || drop.placement !== placement) setDrop({ id: node.id, placement })
  }

  function onDrop(event: DragEvent<HTMLElement>, node: BookmarkNode): void {
    event.preventDefault()
    const id = event.dataTransfer.getData(BOOKMARK_DRAG_TYPE) || dragId
    const placement = drop?.id === node.id ? drop.placement : null
    setDrop(null)
    setDragId(null)
    if (!id || !placement) return
    const target = dropTargetFor(node, placement)
    if (placement === 'inside') toggleFolder(node.id, true)
    void run(() => window.api.browser.bookmarks.move([id], target.parentId, target.index))
  }

  function renderEditor(node: BookmarkNode): React.JSX.Element {
    return (
      <BookmarkInlineEditor
        key={`edit:${node.id}`}
        initialTitle={node.title}
        initialUrl={node.url}
        showUrl={node.type === 'bookmark'}
        onCancel={() => setEdit(null)}
        onSubmit={async (title, url) => {
          await window.api.browser.bookmarks.update(node.id, node.type === 'bookmark' ? { title, url } : isFixedBookmarkFolder(node.id) ? {} : { title })
          setEdit(null)
        }}
      />
    )
  }

  function renderNewFolder(parentId: string): React.JSX.Element {
    return (
      <BookmarkInlineEditor
        key={`new:${parentId}`}
        initialTitle="New folder"
        showUrl={false}
        submitLabel="Create"
        onCancel={() => setEdit(null)}
        onSubmit={async (title) => {
          const folderIndex = edit?.mode === 'new-folder' ? edit.index : undefined
          await window.api.browser.bookmarks.createFolder({ parentId, title, ...(folderIndex !== undefined ? { index: folderIndex } : {}) })
          setEdit(null)
        }}
      />
    )
  }

  function renderNodes(parentId: string, depth: number): React.JSX.Element[] {
    const children = childrenOf(index, parentId)
    const rows: React.JSX.Element[] = []
    children.slice(0, MAX_ROWS_PER_FOLDER).forEach((node) => {
      if (edit?.mode === 'new-folder' && edit.parentId === parentId && edit.index === node.index) rows.push(<div key={`new-before:${node.id}`} style={{ paddingLeft: depth * 14 }}>{renderNewFolder(parentId)}</div>)
      const isFolder = node.type === 'folder'
      const isOpen = isFolder && expandedSet.has(node.id)
      const dropClass = drop?.id === node.id ? ` is-drop-${drop.placement}` : ''
      if (edit?.mode === 'edit' && edit.id === node.id) {
        rows.push(<div key={node.id} style={{ paddingLeft: depth * 14 }}>{renderEditor(node)}</div>)
      } else {
        rows.push(
          <div
            key={node.id}
            className={`bookmark-row${isFolder ? ' is-folder' : ''}${dragId === node.id ? ' is-dragging' : ''}${dropClass}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            role="treeitem"
            aria-expanded={isFolder ? isOpen : undefined}
            aria-level={depth + 1}
            tabIndex={0}
            title={isFolder ? node.title : `${node.title}\n${node.url}`}
            draggable={!isFixedBookmarkFolder(node.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, node.id)
              if (node.url) event.dataTransfer.setData('text/uri-list', node.url)
              event.dataTransfer.effectAllowed = 'move'
              setDragId(node.id)
            }}
            onDragEnd={() => { setDragId(null); setDrop(null) }}
            onDragOver={(event) => onDragOver(event, node)}
            onDragLeave={() => { if (drop?.id === node.id) setDrop(null) }}
            onDrop={(event) => onDrop(event, node)}
            onClick={(event) => isFolder ? toggleFolder(node.id) : open(node, event)}
            onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
            onAuxClick={(event) => {
              if (event.button !== 1 || isFolder) return
              event.preventDefault()
              open(node, event)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              void showMenu(node)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (isFolder) toggleFolder(node.id)
                else if (node.url) void openBookmarkUrl(node.url, event.metaKey || event.ctrlKey ? 'new-tab' : 'current')
              } else if (event.key === 'ArrowRight' && isFolder) toggleFolder(node.id, true)
              else if (event.key === 'ArrowLeft' && isFolder) toggleFolder(node.id, false)
              else if ((event.key === 'Delete' || event.key === 'Backspace') && !isFixedBookmarkFolder(node.id) && confirmDelete(index, [node.id])) void run(() => window.api.browser.bookmarks.remove([node.id]))
              else if (event.key === 'F2') setEdit({ mode: 'edit', id: node.id })
            }}
          >
            {isFolder
              ? <><span className={`bookmark-chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true">›</span><FolderGlyph open={isOpen} /></>
              : <BookmarkFavicon node={node} cachedIcons={cachedIcons} />}
            <span className="bookmark-row-title">{node.title || bookmarkHost(node.url)}</span>
            {isFolder && <span className="bookmark-row-count">{childrenOf(index, node.id).length || ''}</span>}
          </div>
        )
      }
      if (isOpen) {
        rows.push(...renderNodes(node.id, depth + 1))
        if (childrenOf(index, node.id).length === 0 && !(edit?.mode === 'new-folder' && edit.parentId === node.id)) {
          rows.push(<p key={`empty:${node.id}`} className="bookmark-row-empty" style={{ paddingLeft: 26 + (depth + 1) * 14 }}>Empty</p>)
        }
      }
    })
    if (children.length > MAX_ROWS_PER_FOLDER) {
      rows.push(<button key={`more:${parentId}`} type="button" className="bookmark-row-more" style={{ paddingLeft: 26 + depth * 14 }} onClick={onShowManager}>{children.length - MAX_ROWS_PER_FOLDER} more in the bookmark manager…</button>)
    }
    if (edit?.mode === 'new-folder' && edit.parentId === parentId && (edit.index === undefined || edit.index >= children.length)) {
      rows.push(<div key={`new:${parentId}`} style={{ paddingLeft: depth * 14 }}>{renderNewFolder(parentId)}</div>)
    }
    return rows
  }

  return (
    <section className={`sidebar-bookmarks${sectionOpen ? ' is-open' : ''}`} aria-label="Bookmarks">
      <div className="sidebar-bookmarks-header">
        <button type="button" className="sidebar-bookmarks-toggle" aria-expanded={sectionOpen} onClick={() => setSectionOpen(!sectionOpen)}>
          <span className={`bookmark-chevron${sectionOpen ? ' is-open' : ''}`} aria-hidden="true">›</span>
          <span>Bookmarks</span>
        </button>
        {sectionOpen && <>
          <button type="button" className="sidebar-icon-button" aria-label="New bookmark folder" title="New folder" onClick={() => setEdit({ mode: 'new-folder', parentId: BOOKMARKS_ROOT_ID })}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" /><path d="M12 10.5v5M9.5 13h5" /></svg>
          </button>
          <button type="button" className="sidebar-icon-button" aria-label="Open the bookmark manager" title={`Bookmark manager (${window.api.platform === 'darwin' ? '⌥⌘B' : 'Ctrl+Alt+B'})`} onClick={onShowManager}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14M5 12h14M5 18.5h9" /></svg>
          </button>
        </>}
      </div>
      {sectionOpen && (
        <div
          className="sidebar-bookmarks-tree"
          role="tree"
          aria-label="Bookmark folders"
          onDragOver={(event) => {
            // Dropping on the empty area below the tree moves to the end of the top level.
            if (dragId && event.target === event.currentTarget) event.preventDefault()
          }}
          onDrop={(event) => {
            if (event.target !== event.currentTarget || !dragId) return
            event.preventDefault()
            const id = dragId
            setDragId(null)
            setDrop(null)
            void run(() => window.api.browser.bookmarks.move([id], BOOKMARKS_ROOT_ID))
          }}
        >
          {renderNodes(BOOKMARKS_ROOT_ID, 0)}
          {error && <p className="bookmark-inline-error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  )
}
