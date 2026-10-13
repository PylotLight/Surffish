import { useEffect, useMemo, useState } from 'react'
import type { BookmarkNode, BookmarksSnapshot } from '../../../../shared/types'
import { BOOKMARKS_ROOT_ID, indexBookmarks, type BookmarkIndex } from '../../../../shared/bookmarks'

export type BookmarkOpenTarget = 'current' | 'new-tab' | 'private'

export interface BookmarksState {
  nodes: BookmarkNode[]
  index: BookmarkIndex
  loaded: boolean
}

const EMPTY: BookmarksSnapshot = { nodes: [] }

/** The bookmark tree, kept in sync with main (every surface gets the same change broadcast). */
export function useBookmarks(): BookmarksState {
  const [snapshot, setSnapshot] = useState<BookmarksSnapshot>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let mounted = true
    let received = false
    const unsubscribe = window.api.browser.bookmarks.onChange((next) => {
      received = true
      if (!mounted) return
      setSnapshot(next)
      setLoaded(true)
    })
    void window.api.browser.bookmarks.get().then((initial) => {
      if (!mounted || received) return
      setSnapshot(initial)
      setLoaded(true)
    }).catch(() => undefined)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])
  const index = useMemo(() => indexBookmarks(snapshot.nodes), [snapshot])
  return { nodes: snapshot.nodes, index, loaded }
}

export function childrenOf(index: BookmarkIndex, parentId: string = BOOKMARKS_ROOT_ID): BookmarkNode[] {
  return index.children.get(parentId) ?? []
}

/** Every bookmark below a folder, in order (for "Open all"). */
export function bookmarksBelow(index: BookmarkIndex, folderId: string): BookmarkNode[] {
  const result: BookmarkNode[] = []
  const visit = (id: string): void => {
    for (const child of index.children.get(id) ?? []) {
      if (child.type === 'bookmark') result.push(child)
      else visit(child.id)
    }
  }
  visit(folderId)
  return result
}

export function countBelow(index: BookmarkIndex, folderId: string): number {
  let count = 0
  const visit = (id: string): void => {
    for (const child of index.children.get(id) ?? []) {
      count++
      if (child.type === 'folder') visit(child.id)
    }
  }
  visit(folderId)
  return count
}

export function bookmarkOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

export function bookmarkHost(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/** Open a bookmark the way the user asked: here, in a new tab, or in a new private tab. */
export async function openBookmarkUrl(url: string, target: BookmarkOpenTarget): Promise<void> {
  if (target === 'private') await window.api.browser.tabs.createPrivate(url)
  else if (target === 'new-tab') await window.api.browser.tabs.create(url)
  else await window.api.browser.navigate(url)
}

/** Opening many tabs at once is easy to do by accident; ask past a dozen. */
export async function openBookmarksInTabs(nodes: readonly BookmarkNode[], target: Exclude<BookmarkOpenTarget, 'current'> = 'new-tab'): Promise<void> {
  const urls = nodes.flatMap((node) => node.url ? [node.url] : [])
  if (urls.length === 0) return
  if (urls.length > 12 && !window.confirm(`Open ${urls.length} tabs?`)) return
  for (const url of urls.slice(0, 100)) await openBookmarkUrl(url, target)
}

export function confirmDelete(index: BookmarkIndex, ids: readonly string[]): boolean {
  const nodes = ids.map((id) => index.byId.get(id)).filter((node): node is BookmarkNode => Boolean(node))
  const nested = nodes.reduce((total, node) => total + (node.type === 'folder' ? countBelow(index, node.id) : 0), 0)
  if (nested === 0 && nodes.length <= 1) return true
  const what = nodes.length === 1 ? `“${nodes[0]!.title}”` : `${nodes.length} items`
  return window.confirm(nested > 0 ? `Delete ${what} and the ${nested} item${nested === 1 ? '' : 's'} inside?` : `Delete ${what}?`)
}
