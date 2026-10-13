import assert from 'node:assert/strict'
import test from 'node:test'
import { SurffishDatabase } from './database.ts'
import { BookmarkTable } from './bookmark-store.ts'
import {
  addBookmark,
  addBookmarkFolder,
  createBookmarkStore,
  FAVOURITES_FOLDER_ID,
  moveBookmarkNode,
  parseBookmarkStore,
  removeBookmarkNodes,
  serializeBookmarkStore,
  updateBookmarkNode,
  type BookmarkStore
} from '../../shared/bookmarks.ts'

let counter = 0
const makeId = () => `bm-${++counter}`

function sampleStore(): BookmarkStore {
  const store = createBookmarkStore(1_000)
  addBookmark(store, { parentId: FAVOURITES_FOLDER_ID, title: 'A', url: 'https://a.test/', faviconUrl: 'https://a.test/icon.png' }, makeId, 2_000)
  addBookmark(store, { parentId: FAVOURITES_FOLDER_ID, title: 'B', url: 'https://b.test/' }, makeId, 3_000)
  const folder = addBookmarkFolder(store, { title: 'Reading' }, makeId, 4_000)
  for (let index = 0; index < 5; index += 1) addBookmark(store, { parentId: folder.id, title: `R${index}`, url: `https://r${index}.test/` }, makeId, 5_000 + index)
  return store
}

function oplogCount(db: SurffishDatabase): number {
  return Number(db.get<{ n: number }>("SELECT count(*) AS n FROM oplog WHERE entity = 'bookmark'")!.n)
}

test('round-trips the tree (order, folders, favicons, dateAdded)', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new BookmarkTable(db)
  assert.equal(table.hasSavedTree(), false)
  assert.equal(table.load(), null)
  const store = sampleStore()
  const result = table.save(store)
  assert.equal(result.upserted, store.nodes.size - 1, 'every node but the root is a row')
  const loaded = parseBookmarkStore(new BookmarkTable(db).load())!
  assert.deepEqual(serializeBookmarkStore(loaded), serializeBookmarkStore(store))
  assert.equal(oplogCount(db), store.nodes.size - 1, 'one change-log op per row')
})

test('edits write only the rows that changed', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new BookmarkTable(db)
  const store = sampleStore()
  table.save(store)
  assert.deepEqual(table.save(store), { upserted: 0, tombstoned: 0, deleted: 0 }, 'an unchanged tree writes nothing')

  const reading = [...store.nodes.values()].find((node) => node.title === 'Reading')!
  const children = store.children.get(reading.id)!
  moveBookmarkNode(store, children[4]!, reading.id, 1)
  assert.deepEqual(table.save(store), { upserted: 1, tombstoned: 0, deleted: 0 }, 'a move rewrites one row')

  updateBookmarkNode(store, children[0]!, { title: 'Renamed' })
  assert.equal(table.save(store).upserted, 1, 'a rename rewrites one row')

  addBookmark(store, { parentId: reading.id, title: 'New', url: 'https://new.test/', index: 2 }, makeId)
  assert.equal(table.save(store).upserted, 1, 'an insert writes one row')

  const loaded = parseBookmarkStore(new BookmarkTable(db).load())!
  assert.deepEqual(serializeBookmarkStore(loaded).nodes.map((node) => node.title), serializeBookmarkStore(store).nodes.map((node) => node.title))
})

test('a fresh table instance (restart) diffs against what is on disk', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const store = sampleStore()
  new BookmarkTable(db).save(store)
  const restarted = new BookmarkTable(db)
  const loaded = parseBookmarkStore(restarted.load())!
  assert.equal(restarted.save(loaded).upserted, 0, 'reloading and saving the same tree writes nothing')
})

test('deletes are tombstones that keep no title, URL or favicon', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new BookmarkTable(db)
  const store = sampleStore()
  table.save(store)
  const reading = [...store.nodes.values()].find((node) => node.title === 'Reading')!
  const removedIds = [reading.id, ...store.children.get(reading.id)!]
  removeBookmarkNodes(store, [reading.id])
  const result = table.save(store)
  assert.equal(result.tombstoned, removedIds.length, 'the folder and its children are tombstoned')
  const rows = db.all<{ title: string; url: string | null; favicon_url: string | null; deleted_at: number | null }>(`SELECT title, url, favicon_url, deleted_at FROM bookmarks WHERE id IN (${removedIds.map(() => '?').join(',')})`, ...removedIds)
  assert.ok(rows.every((row) => row.deleted_at !== null && row.title === '' && row.url === null && row.favicon_url === null))
  const ops = JSON.stringify(db.all("SELECT payload FROM oplog WHERE entity = 'bookmark'"))
  assert.ok(!ops.includes('r3.test'), 'the change log keeps no deleted URL')
  assert.ok(!ops.includes('Reading'), 'or title')
  const loaded = parseBookmarkStore(new BookmarkTable(db).load())!
  assert.equal(loaded.nodes.has(reading.id), false)
})

test('changes are in the change log for sync with hlc order', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new BookmarkTable(db)
  const store = sampleStore()
  table.save(store)
  const seq = Number(db.get<{ seq: number }>('SELECT max(seq) AS seq FROM oplog')!.seq)
  updateBookmarkNode(store, [...store.nodes.values()].find((node) => node.title === 'B')!.id, { title: 'Bee' })
  table.save(store)
  const changes = db.changesSince(seq)
  assert.equal(changes.length, 1)
  assert.equal(changes[0]!.entity, 'bookmark')
  assert.equal(JSON.parse(changes[0]!.payload!).title, 'Bee')
})

test('positions stay short for large folders', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new BookmarkTable(db)
  const store = createBookmarkStore(1)
  for (let index = 0; index < 3_000; index += 1) addBookmark(store, { parentId: FAVOURITES_FOLDER_ID, title: `S${index}`, url: `https://s${index}.test/` }, makeId, 10)
  table.save(store)
  const longest = Number(db.get<{ n: number }>('SELECT max(length(position)) AS n FROM bookmarks')!.n)
  assert.ok(longest <= 4, `positions are at most 4 characters (got ${longest})`)
})
