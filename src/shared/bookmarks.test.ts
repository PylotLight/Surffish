import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addBookmark,
  addBookmarkFolder,
  applyFavouriteSites,
  BOOKMARKS_ROOT_ID,
  bookmarksSnapshot,
  createBookmarkStore,
  FAVOURITES_FOLDER_ID,
  favouriteSites,
  findBookmarksByUrl,
  getBookmarkChildren,
  importBookmarkTree,
  indexBookmarks,
  listBookmarkFolders,
  migratePinnedSitesToBookmarks,
  moveBookmarkNode,
  moveBookmarkNodes,
  parseBookmarkStore,
  removeBookmarkNode,
  removeBookmarkNodes,
  searchBookmarkNodes,
  serializeBookmarkStore,
  updateBookmarkFavicons,
  updateBookmarkNode,
  type BookmarkStore
} from './bookmarks.ts'

function ids(): () => string {
  let next = 0
  return () => `n${++next}`
}

function titles(store: BookmarkStore, parentId: string): string[] {
  return getBookmarkChildren(store, parentId).map((node) => node.title)
}

function sample(): { store: BookmarkStore; makeId: () => string } {
  const makeId = ids()
  const store = createBookmarkStore(1000)
  addBookmark(store, { title: 'A', url: 'https://a.test/' }, makeId, 1000) // n1 in Favourites
  addBookmark(store, { title: 'B', url: 'https://b.test/' }, makeId, 1000) // n2
  const work = addBookmarkFolder(store, { title: 'Work' }, makeId, 1000) // n3 at root
  addBookmark(store, { parentId: work.id, title: 'C', url: 'https://c.test/x?y=1#z' }, makeId, 1000) // n4
  const nested = addBookmarkFolder(store, { parentId: work.id, title: 'Nested' }, makeId, 1000) // n5
  addBookmark(store, { parentId: nested.id, title: 'D', url: 'https://d.test/' }, makeId, 1000) // n6
  return { store, makeId }
}

test('a new store has only the fixed Favourites folder at the top level', () => {
  const store = createBookmarkStore(5)
  assert.deepEqual(getBookmarkChildren(store, BOOKMARKS_ROOT_ID).map((node) => [node.id, node.title, node.index]), [[FAVOURITES_FOLDER_ID, 'Favourites', 0]])
  assert.throws(() => removeBookmarkNode(store, FAVOURITES_FOLDER_ID))
  assert.throws(() => moveBookmarkNode(store, FAVOURITES_FOLDER_ID, BOOKMARKS_ROOT_ID, 0))
  assert.throws(() => updateBookmarkNode(store, FAVOURITES_FOLDER_ID, { title: 'Renamed' }))
})

test('adds bookmarks with exact URLs, default titles and contiguous indexes', () => {
  const { store } = sample()
  assert.deepEqual(titles(store, FAVOURITES_FOLDER_ID), ['A', 'B'])
  assert.deepEqual(getBookmarkChildren(store, 'n3').map((node) => [node.title, node.index, node.parentId]), [['C', 0, 'n3'], ['Nested', 1, 'n3']])
  assert.equal(findBookmarksByUrl(store, 'https://c.test/x?y=1#z')[0]?.id, 'n4')
  const untitled = addBookmark(store, { url: 'https://www.untitled.test/page' }, () => 'u1')
  assert.equal(untitled.title, 'untitled.test')
  assert.throws(() => addBookmark(store, { url: 'javascript:alert(1)' }))
  assert.throws(() => addBookmark(store, { url: 'https://user:pass@x.test/' }))
  assert.throws(() => addBookmark(store, { parentId: 'n1', url: 'https://x.test/' }), /folder/)
})

test('reorders within a folder and moves across folders', () => {
  const { store } = sample()
  moveBookmarkNode(store, 'n2', FAVOURITES_FOLDER_ID, 0)
  assert.deepEqual(titles(store, FAVOURITES_FOLDER_ID), ['B', 'A'])
  moveBookmarkNode(store, 'n1', 'n5', 0)
  assert.deepEqual(titles(store, FAVOURITES_FOLDER_ID), ['B'])
  assert.deepEqual(titles(store, 'n5'), ['A', 'D'])
  // Out-of-range index appends.
  moveBookmarkNode(store, 'n2', 'n5', 99)
  assert.deepEqual(titles(store, 'n5'), ['A', 'D', 'B'])
  assert.deepEqual(getBookmarkChildren(store, 'n5').map((node) => node.index), [0, 1, 2])
})

test('refuses to move a folder into itself or a descendant', () => {
  const { store } = sample()
  assert.throws(() => moveBookmarkNode(store, 'n3', 'n3'), /itself/)
  assert.throws(() => moveBookmarkNode(store, 'n3', 'n5'), /itself/)
  moveBookmarkNode(store, 'n5', BOOKMARKS_ROOT_ID, 0)
  assert.deepEqual(titles(store, BOOKMARKS_ROOT_ID), ['Nested', 'Favourites', 'Work'])
})

test('moves several nodes in tree order and skips ones riding along with a moved folder', () => {
  const { store } = sample()
  const target = addBookmarkFolder(store, { title: 'Target' }, () => 't1')
  const moved = moveBookmarkNodes(store, ['n6', 'n2', 'n5', 'n1'], target.id)
  assert.equal(moved, 3)
  assert.deepEqual(titles(store, target.id), ['A', 'B', 'Nested'])
  assert.deepEqual(titles(store, 'n5'), ['D'])
  // Moving within the same folder to the front keeps relative order.
  moveBookmarkNodes(store, ['n5', 'n2'], target.id, 0)
  assert.deepEqual(titles(store, target.id), ['B', 'Nested', 'A'])
})

test('deleting a folder removes its whole subtree', () => {
  const { store } = sample()
  assert.equal(removeBookmarkNode(store, 'n3'), 4)
  assert.equal(store.nodes.has('n6'), false)
  assert.equal(store.children.has('n5'), false)
  assert.deepEqual(titles(store, BOOKMARKS_ROOT_ID), ['Favourites'])
  assert.equal(removeBookmarkNode(store, 'missing'), 0)
  const again = sample().store
  assert.equal(removeBookmarkNodes(again, ['n5', 'n6', 'n1', FAVOURITES_FOLDER_ID]), 3)
  assert.deepEqual(titles(again, FAVOURITES_FOLDER_ID), ['B'])
})

test('edits titles and URLs, dropping the favicon when the URL changes', () => {
  const { store } = sample()
  updateBookmarkFavicons(store, 'https://a.test/', 'https://a.test/icon.png')
  assert.equal(store.nodes.get('n1')?.faviconUrl, 'https://a.test/icon.png')
  updateBookmarkNode(store, 'n1', { title: '  Alpha   site ' })
  assert.equal(store.nodes.get('n1')?.title, 'Alpha site')
  updateBookmarkNode(store, 'n1', { url: 'https://alpha.test/' })
  assert.equal(store.nodes.get('n1')?.url, 'https://alpha.test/')
  assert.equal(store.nodes.get('n1')?.faviconUrl, undefined)
  assert.throws(() => updateBookmarkNode(store, 'n1', { url: 'file:///etc/passwd' }))
})

test('favicons follow the exact page or the bookmarked site root', () => {
  const { store } = sample()
  assert.equal(updateBookmarkFavicons(store, 'https://a.test/some/page', 'https://a.test/f.ico'), true)
  assert.equal(store.nodes.get('n1')?.faviconUrl, 'https://a.test/f.ico')
  assert.equal(updateBookmarkFavicons(store, 'https://c.test/other', 'https://c.test/f.ico'), false)
  assert.equal(updateBookmarkFavicons(store, 'https://a.test/', 'data:image/png;base64,AAAA'), false)
})

test('serialises and parses back the same tree', () => {
  const { store } = sample()
  const json = JSON.parse(JSON.stringify(serializeBookmarkStore(store))) as unknown
  const parsed = parseBookmarkStore(json, 1)!
  assert.deepEqual(bookmarksSnapshot(parsed), bookmarksSnapshot(store))
})

test('parsing repairs orphans, cycles, bad URLs and a missing Favourites folder', () => {
  const parsed = parseBookmarkStore({
    version: 1,
    nodes: [
      { id: 'f1', type: 'folder', title: 'Loop A', parentId: 'f2', index: 0, dateAdded: 1 },
      { id: 'f2', type: 'folder', title: 'Loop B', parentId: 'f1', index: 0, dateAdded: 1 },
      { id: 'b1', type: 'bookmark', title: 'Orphan', url: 'https://orphan.test/', parentId: 'gone', index: 0, dateAdded: 1 },
      { id: 'b2', type: 'bookmark', title: 'Bad', url: 'javascript:void(0)', parentId: 'root', index: 1, dateAdded: 1 },
      { id: 'b3', type: 'bookmark', title: 'Under bookmark', url: 'https://x.test/', parentId: 'b1', index: 0, dateAdded: 1 },
      { id: 'b1', type: 'bookmark', title: 'Duplicate id', url: 'https://dupe.test/', parentId: 'root', index: 0, dateAdded: 1 }
    ]
  }, 1)!
  const top = getBookmarkChildren(parsed, BOOKMARKS_ROOT_ID).map((node) => node.id)
  assert.equal(top[0], FAVOURITES_FOLDER_ID)
  assert.ok(top.includes('b1') && top.includes('b3'))
  assert.equal(parsed.nodes.has('b2'), false)
  assert.equal(parsed.nodes.get('b1')?.title, 'Orphan')
  // The cycle is broken: both folders reach the root again.
  const all = bookmarksSnapshot(parsed).nodes.map((node) => node.id)
  assert.ok(all.includes('f1') && all.includes('f2'))
  assert.equal(parseBookmarkStore({ version: 2, nodes: [] }), null)
  assert.equal(parseBookmarkStore(null), null)
})

test('migrates the old pinned-site strip into Favourites in order', () => {
  const store = migratePinnedSitesToBookmarks([
    { title: 'GitHub', url: 'https://github.com/', faviconUrl: 'https://github.com/favicon.ico' },
    { title: 'Dupe', url: 'https://github.com/' },
    { title: 'Bad', url: 'ftp://x.test/' },
    { title: '', url: 'https://news.ycombinator.com' }
  ], ids(), 42)
  const favourites = getBookmarkChildren(store, FAVOURITES_FOLDER_ID)
  assert.deepEqual(favourites.map((node) => [node.title, node.url, node.dateAdded]), [
    ['GitHub', 'https://github.com/', 42],
    ['news.ycombinator.com', 'https://news.ycombinator.com/', 42]
  ])
  assert.equal(favourites[0]?.faviconUrl, 'https://github.com/favicon.ico')
  assert.deepEqual(favouriteSites(store, 12), [
    { title: 'GitHub', url: 'https://github.com/', faviconUrl: 'https://github.com/favicon.ico' },
    { title: 'news.ycombinator.com', url: 'https://news.ycombinator.com/' }
  ])
})

test('the strip shows the first N Favourites and strip edits leave the rest alone', () => {
  const makeId = ids()
  const store = createBookmarkStore(1)
  for (const name of ['a', 'b', 'c', 'd']) addBookmark(store, { title: name, url: `https://${name}.test/` }, makeId)
  addBookmarkFolder(store, { parentId: FAVOURITES_FOLDER_ID, title: 'Sub', index: 0 }, makeId)
  assert.deepEqual(favouriteSites(store, 3).map((site) => site.title), ['a', 'b', 'c'])
  // Remove "b", add "e", reorder: d (beyond the strip) keeps its place after the visible ones.
  applyFavouriteSites(store, [{ title: 'c', url: 'https://c.test/' }, { title: 'a', url: 'https://a.test/' }, { title: 'e', url: 'https://e.test/' }], 3, makeId)
  assert.deepEqual(titles(store, FAVOURITES_FOLDER_ID), ['c', 'a', 'e', 'Sub', 'd'])
  assert.deepEqual(favouriteSites(store, 3).map((site) => site.title), ['c', 'a', 'e'])
})

test('imports into an "Imported from X" folder, skipping duplicates, unsafe URLs and empty folders', () => {
  const { store, makeId } = sample()
  const result = importBookmarkTree(store, 'Chrome', [
    { title: 'Bookmarks bar', children: [
      { title: 'A again', url: 'https://a.test/' },
      { title: 'New', url: 'https://new.test/', dateAdded: 1_700_000_000_000 },
      { title: 'Empty', children: [{ title: 'js', url: 'javascript:1' }] },
      { title: 'Deep', children: [{ title: 'New twice', url: 'https://new.test/' }, { title: 'Other', url: 'https://other.test/' }] }
    ] },
    { title: 'Nothing', children: [] }
  ], makeId, 9)
  assert.deepEqual({ ...result, folderId: typeof result.folderId }, { folderId: 'string', folderTitle: 'Imported from Chrome', added: 2, folders: 2, duplicates: 2, skipped: 1 })
  const imported = getBookmarkChildren(store, result.folderId!)
  assert.deepEqual(imported.map((node) => node.title), ['Bookmarks bar'])
  assert.deepEqual(titles(store, imported[0]!.id), ['New', 'Deep'])
  assert.equal(getBookmarkChildren(store, imported[0]!.id)[0]?.dateAdded, 1_700_000_000_000)
  // Importing the same thing again adds nothing and leaves no empty folder behind.
  const again = importBookmarkTree(store, 'Chrome', [{ title: 'x', url: 'https://new.test/' }], makeId)
  assert.equal(again.folderId, null)
  assert.equal(again.duplicates, 1)
  assert.equal(titles(store, BOOKMARKS_ROOT_ID).filter((title) => title === 'Imported from Chrome').length, 1)
})

test('snapshot helpers index, search and list folders', () => {
  const { store } = sample()
  const snapshot = bookmarksSnapshot(store)
  const index = indexBookmarks(snapshot.nodes)
  assert.deepEqual(index.children.get('n3')?.map((node) => node.title), ['C', 'Nested'])
  assert.equal(index.urls.get('https://d.test/')?.[0]?.id, 'n6')
  assert.deepEqual(searchBookmarkNodes(snapshot.nodes, 'C.TEST y=1').map((node) => node.id), ['n4'])
  assert.deepEqual(searchBookmarkNodes(snapshot.nodes, '  '), [])
  assert.deepEqual(listBookmarkFolders(index).map((folder) => [folder.title, folder.depth]), [['Favourites', 0], ['Work', 0], ['Nested', 1]])
})
