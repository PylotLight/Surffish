import type { DragEvent } from 'react'
import type { BookmarkNode } from '../../../../shared/types'
import { BOOKMARKS_ROOT_ID, FAVOURITES_FOLDER_ID, type BookmarkIndex } from '../../../../shared/bookmarks'

export const BOOKMARK_DRAG_TYPE = 'application/x-surffish-bookmarks'

export type DropPlacement = 'before' | 'after' | 'inside'

function isInside(index: BookmarkIndex, id: string, ancestorId: string): boolean {
  let current: string | null = id
  let guard = 0
  while (current && guard++ < 256) {
    if (current === ancestorId) return true
    current = index.byId.get(current)?.parentId ?? null
  }
  return false
}

/**
 * Where a drag over `node` would land: folders take the middle half as "inside", everything
 * else splits top/bottom. Returns null when the drop would move a folder into itself or move
 * something next to the fixed top-level Favourites slot in a way that isn't allowed.
 */
export function dropPlacement(event: DragEvent<HTMLElement>, node: BookmarkNode, index: BookmarkIndex, draggedIds: string | readonly string[]): DropPlacement | null {
  const ids = typeof draggedIds === 'string' ? [draggedIds] : draggedIds
  if (ids.includes(node.id)) return null
  const rect = event.currentTarget.getBoundingClientRect()
  const offset = (event.clientY - rect.top) / Math.max(1, rect.height)
  let placement: DropPlacement
  if (node.type === 'folder') placement = offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside'
  else placement = offset < 0.5 ? 'before' : 'after'
  const targetParent = placement === 'inside' ? node.id : node.parentId ?? BOOKMARKS_ROOT_ID
  if (ids.some((id) => isInside(index, targetParent, id))) return null
  // Favourites stays the first top-level folder.
  if (node.id === FAVOURITES_FOLDER_ID && placement === 'before') return null
  return placement
}

/** Folder + slot (in the folder's current order) for a drop; main adjusts for the moved items. */
export function dropTargetFor(node: BookmarkNode, placement: DropPlacement): { parentId: string; index?: number } {
  if (placement === 'inside') return { parentId: node.id }
  return { parentId: node.parentId ?? BOOKMARKS_ROOT_ID, index: placement === 'before' ? node.index : node.index + 1 }
}
