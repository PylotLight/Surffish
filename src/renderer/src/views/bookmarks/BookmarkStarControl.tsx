import { useEffect, useRef, useState } from 'react'
import { FAVOURITES_FOLDER_ID, normalizeBookmarkUrl } from '../../../../shared/bookmarks'
import { BookmarkFolderSelect, ipcErrorMessage, StarGlyph } from './BookmarkParts'
import type { BookmarksState } from './useBookmarks'

/**
 * The omnibox star. Click (or Cmd+D, which main handles) bookmarks the page into Favourites and
 * opens a small popover to rename it or pick a folder; on an already bookmarked page it just
 * opens the popover. Changes save when the popover closes, like Chrome.
 */
export function BookmarkStarControl({ bookmarks, url, title, faviconUrl, isPrivate, onOpenChange, onShowManager }: {
  bookmarks: BookmarksState
  url: string
  title: string
  faviconUrl: string | null
  isPrivate: boolean
  onOpenChange?: (open: boolean) => void
  onShowManager: () => void
}): React.JSX.Element {
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState(false)
  const draftRef = useRef<{ title: string; parentId: string } | null>(null)
  const [error, setError] = useState('')
  const pageUrl = normalizeBookmarkUrl(url)
  const existing = pageUrl ? bookmarks.index.urls.get(pageUrl)?.[0] : undefined
  const editing = editingId ? bookmarks.index.byId.get(editingId) : undefined
  // Shown once the node is in the snapshot (Cmd+D's change broadcast can land a moment after the request).
  const open = Boolean(editing)

  useEffect(() => { onOpenChange?.(open) }, [open])

  useEffect(() => window.api.browser.bookmarks.onEditCurrent(({ id, created }) => {
    setError('')
    setJustAdded(created)
    setEditingId(id)
  }), [])

  // Navigating away closes the popover (saving what was typed).
  const urlRef = useRef(url)
  useEffect(() => {
    if (urlRef.current !== url && editingId) void close(true)
    urlRef.current = url
  }, [url])

  async function close(save: boolean): Promise<void> {
    const id = editingId
    setEditingId(null)
    if (!save || !id || !editing) return
    const draft = draftRef.current
    draftRef.current = null
    if (!draft) return
    const patch: { title?: string; parentId?: string } = {}
    if (draft.title.trim() && draft.title.trim() !== editing.title) patch.title = draft.title
    if (draft.parentId && draft.parentId !== editing.parentId) patch.parentId = draft.parentId
    if (Object.keys(patch).length === 0) return
    try {
      await window.api.browser.bookmarks.update(id, patch)
    } catch {
      // The bookmark may have been deleted elsewhere; nothing to save then.
    }
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!controlRef.current?.contains(event.target as Node)) void close(true)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void close(true)
      buttonRef.current?.focus()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  async function toggle(): Promise<void> {
    if (editingId) {
      await close(true)
      return
    }
    setError('')
    if (existing) {
      setJustAdded(false)
      setEditingId(existing.id)
      return
    }
    if (!pageUrl) return
    try {
      const node = await window.api.browser.bookmarks.create({
        url: pageUrl,
        title,
        parentId: FAVOURITES_FOLDER_ID,
        // Private tabs: the bookmark is an explicit choice, the favicon is not kept.
        ...(faviconUrl && !isPrivate ? { faviconUrl } : {})
      })
      setJustAdded(true)
      setEditingId(node.id)
    } catch (caught) {
      setError(ipcErrorMessage(caught))
    }
  }

  async function remove(): Promise<void> {
    const id = editingId
    setEditingId(null)
    if (id) await window.api.browser.bookmarks.remove([id]).catch(() => undefined)
  }

  const label = existing ? 'Edit bookmark' : 'Bookmark this page'
  return (
    <div className="bookmark-star-control" ref={controlRef}>
      <button
        ref={buttonRef}
        className={`toolbar-button favorite-button omnibox-favorite-button${existing ? ' is-favorite' : ''}${open ? ' is-open' : ''}`}
        type="button"
        aria-label={label}
        aria-pressed={Boolean(existing)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="bookmark-popover"
        title={`${label} (${window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'}D)`}
        disabled={!pageUrl}
        onClick={() => void toggle()}
      ><StarGlyph filled={Boolean(existing)} /></button>
      {error && !open && <span className="bookmark-star-error" role="alert">{error}</span>}
      {open && editing && (
        <div id="bookmark-popover" className="bookmark-popover" role="dialog" aria-label={justAdded ? 'Bookmark added' : 'Edit bookmark'}>
          <strong className="bookmark-popover-title">{justAdded ? 'Bookmark added' : 'Edit bookmark'}</strong>
          {isPrivate && justAdded && <p className="bookmark-popover-note">Saved from a private tab. The bookmark stays after the tab closes.</p>}
          <BookmarkPopoverFields
            key={editing.id}
            title={editing.title}
            parentId={editing.parentId ?? FAVOURITES_FOLDER_ID}
            bookmarks={bookmarks}
            onChange={(draft) => { draftRef.current = draft }}
            onSubmit={() => void close(true)}
          />
          <div className="bookmark-popover-actions">
            <button type="button" className="settings-action secondary" onClick={() => void remove()}>Remove</button>
            <button type="button" className="bookmark-popover-link" onClick={() => { void close(true); onShowManager() }}>All bookmarks…</button>
            <button type="button" className="settings-action primary" onClick={() => void close(true)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Name + folder fields, initialised from the node when the popover opens (keyed by node id). */
function BookmarkPopoverFields({ title, parentId, bookmarks, onChange, onSubmit }: {
  title: string
  parentId: string
  bookmarks: BookmarksState
  onChange: (draft: { title: string; parentId: string }) => void
  onSubmit: () => void
}): React.JSX.Element {
  const [draftTitle, setDraftTitle] = useState(title)
  const [draftFolder, setDraftFolder] = useState(parentId)
  useEffect(() => { onChange({ title: draftTitle, parentId: draftFolder }) }, [draftTitle, draftFolder])
  return (
    <>
      <label className="bookmark-popover-field">
        <span>Name</span>
        <input autoFocus type="text" value={draftTitle} spellCheck={false} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onChange({ title: event.currentTarget.value, parentId: draftFolder })
            onSubmit()
          }
        }} />
      </label>
      <label className="bookmark-popover-field">
        <span>Folder</span>
        <BookmarkFolderSelect index={bookmarks.index} value={draftFolder} onChange={setDraftFolder} />
      </label>
    </>
  )
}
