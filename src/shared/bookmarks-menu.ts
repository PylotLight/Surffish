import type { BookmarkNode } from './types'
import { BOOKMARKS_ROOT_ID, FAVOURITES_FOLDER_ID, type BookmarkIndex } from './bookmarks'

/** Rows one bookmarks dropdown level shows before "N more in the bookmark manager…". */
export const MAX_BOOKMARK_MENU_ROWS = 60

export type BookmarkMenuRow =
  | { kind: 'node'; node: BookmarkNode }
  | { kind: 'separator'; key: string }
  | { kind: 'more'; count: number }

function capped(nodes: readonly BookmarkNode[], max: number): BookmarkMenuRow[] {
  const rows: BookmarkMenuRow[] = nodes.slice(0, max).map((node) => ({ kind: 'node', node }))
  if (nodes.length > max) rows.push({ kind: 'more', count: nodes.length - max })
  return rows
}

/**
 * Rows for one level of the toolbar's bookmarks dropdown. The top level puts what's in
 * Favourites first (where the star saves, so that's where most bookmarks are), then the other
 * top-level folders and bookmarks. Any other folder lists its own children.
 */
export function bookmarkMenuRows(index: BookmarkIndex, folderId: string = BOOKMARKS_ROOT_ID, max = MAX_BOOKMARK_MENU_ROWS): BookmarkMenuRow[] {
  if (folderId !== BOOKMARKS_ROOT_ID) return capped(index.children.get(folderId) ?? [], max)
  const favourites = index.children.get(FAVOURITES_FOLDER_ID) ?? []
  const others = (index.children.get(BOOKMARKS_ROOT_ID) ?? []).filter((node) => node.id !== FAVOURITES_FOLDER_ID)
  const rows = capped(favourites, max)
  if (others.length > 0) {
    if (rows.length > 0) rows.push({ kind: 'separator', key: 'favourites-end' })
    rows.push(...capped(others, max))
  }
  return rows
}

/** Bookmarks bar items: the Favourites folder, like Chrome's "Bookmarks bar" folder. */
export function bookmarkBarNodes(index: BookmarkIndex): BookmarkNode[] {
  return index.children.get(FAVOURITES_FOLDER_ID) ?? []
}

/** Open a submenu to the right of its row unless that runs off the window, then to the left. */
export function submenuSide(rowRight: number, rowLeft: number, menuWidth: number, viewportWidth: number): 'right' | 'left' {
  if (rowRight + menuWidth <= viewportWidth - 4) return 'right'
  return rowLeft - menuWidth >= 4 ? 'left' : 'right'
}

/** How many bar items fit in `available` px given each item's width and the overflow button's. */
export function barItemsThatFit(widths: readonly number[], available: number, overflowWidth: number, gap = 2): number {
  let used = 0
  for (let index = 0; index < widths.length; index++) {
    const next = used + (index > 0 ? gap : 0) + widths[index]!
    const remaining = widths.length - index - 1
    if (next + (remaining > 0 ? gap + overflowWidth : 0) > available) return index
    used = next
  }
  return widths.length
}
