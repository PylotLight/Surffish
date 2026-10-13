import { describe, expect, test } from 'bun:test'
import type { BookmarkNode } from './types'
import { BOOKMARKS_ROOT_ID, FAVOURITES_FOLDER_ID, indexBookmarks } from './bookmarks'
import { barItemsThatFit, bookmarkBarNodes, bookmarkMenuRows, submenuSide } from './bookmarks-menu'

function node(id: string, parentId: string, index: number, type: 'bookmark' | 'folder' = 'bookmark'): BookmarkNode {
  return { id, type, title: id, parentId, index, dateAdded: 0, ...(type === 'bookmark' ? { url: `https://${id}.test/` } : {}) }
}

// Snapshots don't include the invisible root itself.
const nodes = [
  node(FAVOURITES_FOLDER_ID, BOOKMARKS_ROOT_ID, 0, 'folder'),
  node('fav-a', FAVOURITES_FOLDER_ID, 0),
  node('fav-folder', FAVOURITES_FOLDER_ID, 1, 'folder'),
  node('nested', 'fav-folder', 0),
  node('work', BOOKMARKS_ROOT_ID, 1, 'folder'),
  node('loose', BOOKMARKS_ROOT_ID, 2)
]

describe('bookmarks dropdown rows', () => {
  const index = indexBookmarks(nodes)

  test('top level: Favourites contents first, then the other top-level items', () => {
    const rows = bookmarkMenuRows(index)
    expect(rows.map((row) => row.kind === 'node' ? row.node.id : row.kind)).toEqual(['fav-a', 'fav-folder', 'separator', 'work', 'loose'])
  })

  test('a folder lists its own children', () => {
    expect(bookmarkMenuRows(index, 'fav-folder').map((row) => row.kind === 'node' ? row.node.id : row.kind)).toEqual(['nested'])
    expect(bookmarkMenuRows(index, 'work')).toEqual([])
  })

  test('long folders are capped with a "more" row', () => {
    const many = [nodes[0]!, ...Array.from({ length: 5 }, (_, i) => node(`b${i}`, FAVOURITES_FOLDER_ID, i))]
    const rows = bookmarkMenuRows(indexBookmarks(many), BOOKMARKS_ROOT_ID, 3)
    expect(rows.at(-1)).toEqual({ kind: 'more', count: 2 })
    expect(rows.filter((row) => row.kind === 'node')).toHaveLength(3)
  })

  test('the bar shows Favourites', () => {
    expect(bookmarkBarNodes(index).map((item) => item.id)).toEqual(['fav-a', 'fav-folder'])
  })
})

describe('layout helpers', () => {
  test('submenus flip left near the right edge', () => {
    expect(submenuSide(500, 300, 260, 1400)).toBe('right')
    expect(submenuSide(1300, 1100, 260, 1400)).toBe('left')
    expect(submenuSide(300, 100, 260, 400)).toBe('right')
  })

  test('bar overflow keeps room for the » button', () => {
    expect(barItemsThatFit([100, 100, 100], 400, 30)).toBe(3)
    expect(barItemsThatFit([100, 100, 100], 250, 30, 0)).toBe(2)
    expect(barItemsThatFit([100, 100, 100], 120, 30, 0)).toBe(0)
    expect(barItemsThatFit([], 120, 30)).toBe(0)
  })
})
