import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { SurffishDatabase } from './database.ts'
import { ReadingListTable } from './reading-list-table.ts'
import { MIGRATIONS } from './schema.ts'
import { FILE_DB_TEST_TIMEOUT_MS, storeTestDir } from './test-temp-dir.ts'
import { READING_LIST_TOMBSTONE_TTL_MS, sanitizeReadingListInput } from '../../shared/reading-list.ts'

const input = (url: string, extra: Record<string, unknown> = {}) => sanitizeReadingListInput({ url, ...extra })!

function ops(db: SurffishDatabase): Array<{ entity_id: string; payload: string | null }> {
  return db.all("SELECT entity_id, payload FROM oplog WHERE entity = 'reading_item' ORDER BY seq")
}

test('save, list newest first, and one change-log op per item', () => {
  let now = 1_000
  const db = SurffishDatabase.open({ path: ':memory:', now: () => now })
  const table = new ReadingListTable(db)
  assert.deepEqual(table.list(), [])
  const first = table.add(input('https://example.com/a', { title: 'A', siteName: 'Example', excerpt: 'About A' }))
  now = 2_000
  const second = table.add(input('https://example.com/b', { title: 'B' }))
  assert.equal(first.created, true)
  assert.equal(second.created, true)
  assert.deepEqual(table.list().map((item) => item.title), ['B', 'A'])
  assert.deepEqual({ ...table.list()[1]!, id: '' }, { id: '', url: 'https://example.com/a', title: 'A', faviconUrl: null, siteName: 'Example', excerpt: 'About A', addedAt: 1_000, readAt: null, hasSnapshot: false })
  assert.equal(ops(db).length, 2)
  assert.match(first.item.id, /^[0-9a-f-]{36}$/)
})

test('saving the same page again moves it to the top as unread, keeping details it did not resend', () => {
  let now = 1_000
  const db = SurffishDatabase.open({ path: ':memory:', now: () => now })
  const table = new ReadingListTable(db)
  const { item } = table.add(input('https://example.com/a', { title: 'Old title', excerpt: 'Kept' }))
  now = 2_000
  table.add(input('https://example.com/b'))
  table.setRead(item.id, true)
  now = 3_000
  const again = table.add(input('https://www.example.com/a/#section', { title: 'New title' }))
  assert.equal(again.created, false)
  assert.equal(again.item.id, item.id)
  assert.deepEqual([again.item.title, again.item.excerpt, again.item.readAt, again.item.addedAt], ['New title', 'Kept', null, 3_000])
  assert.equal(table.list().length, 2)
  assert.equal(table.list()[0]!.id, item.id)
})

test('mark read / unread writes only on a change', () => {
  let now = 1_000
  const db = SurffishDatabase.open({ path: ':memory:', now: () => now })
  const table = new ReadingListTable(db)
  const { item } = table.add(input('https://example.com/a'))
  const before = db.get<{ seq: number }>('SELECT max(seq) AS seq FROM oplog')!.seq
  now = 5_000
  assert.equal(table.setRead(item.id, true)!.readAt, 5_000)
  assert.equal(table.setRead(item.id, true)!.readAt, 5_000)
  const after = db.get<{ seq: number }>('SELECT max(seq) AS seq FROM oplog')!.seq
  assert.equal(after - before, 1, 'the second mark-read was a no-op')
  assert.equal(table.setRead(item.id, false)!.readAt, null)
  assert.equal(table.setRead('missing', true), null)
})

test('remove tombstones the row with nothing about the page left, in the table or the change log', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new ReadingListTable(db)
  const { item } = table.add(input('https://secret.example/private-story', { title: 'Secret story', excerpt: 'Hidden' }))
  assert.ok(table.setSnapshot(item.id, JSON.stringify({ content: '<p>body</p>' })))
  assert.equal(table.remove(item.id), true)
  assert.equal(table.remove(item.id), false)
  assert.deepEqual(table.list(), [])
  const row = db.get<Record<string, unknown>>('SELECT url, title, excerpt, snapshot, deleted_at FROM reading_list WHERE id = ?', item.id)!
  assert.equal(row.url, '')
  assert.equal(row.title, '')
  assert.equal(row.excerpt, null)
  assert.equal(row.snapshot, null)
  assert.ok(row.deleted_at !== null)
  assert.ok(!JSON.stringify(ops(db)).includes('secret'), 'no URL in the change log')
})

test('the offline copy stays on this device: not in the change log, not a user edit', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new ReadingListTable(db)
  const { item } = table.add(input('https://example.com/a'))
  const hlc = db.get<{ hlc: string }>('SELECT hlc FROM reading_list WHERE id = ?', item.id)!.hlc
  const opsBefore = ops(db).length
  assert.equal(table.getSnapshot(item.id), null)
  assert.ok(table.setSnapshot(item.id, '{"content":"<p>offline article body</p>"}'))
  assert.equal(table.getSnapshot(item.id), '{"content":"<p>offline article body</p>"}')
  assert.equal(table.list()[0]!.hasSnapshot, true)
  assert.equal(db.get<{ hlc: string }>('SELECT hlc FROM reading_list WHERE id = ?', item.id)!.hlc, hlc)
  assert.equal(ops(db).length, opsBefore)
  assert.ok(!JSON.stringify(db.all('SELECT payload FROM oplog')).includes('offline article body'))
})

test('clear read removes only read items', () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const table = new ReadingListTable(db)
  const a = table.add(input('https://example.com/a')).item
  table.add(input('https://example.com/b'))
  const c = table.add(input('https://example.com/c')).item
  table.setRead(a.id, true)
  table.setRead(c.id, true)
  assert.equal(table.clearRead(), 2)
  assert.deepEqual(table.list().map((item) => item.url), ['https://example.com/b'])
})

test('old tombstones are purged when the list is first read', () => {
  let now = 1_000
  const db = SurffishDatabase.open({ path: ':memory:', now: () => now })
  const table = new ReadingListTable(db)
  const { item } = table.add(input('https://example.com/a'))
  table.remove(item.id)
  db.run('UPDATE reading_list SET deleted_at = ? WHERE id = ?', Date.now() - READING_LIST_TOMBSTONE_TTL_MS - 1, item.id)
  now = 2_000
  new ReadingListTable(db).list()
  assert.equal(db.get('SELECT id FROM reading_list WHERE id = ?', item.id), undefined)
})

test('a v1 profile migrates to v2 with its data intact and gains the reading_list table', { timeout: FILE_DB_TEST_TIMEOUT_MS }, () => {
  const dir = storeTestDir('surffish-reading-list-')
  try {
    const path = join(dir, 'surffish.db')
    // Build a v1 database exactly as the previous release did.
    const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
    const raw = new sqlite.DatabaseSync(path)
    raw.exec(MIGRATIONS[0]!.sql)
    raw.exec('PRAGMA user_version = 1')
    raw.exec("INSERT INTO meta (key, value) VALUES ('device_id', 'dev-1')")
    raw.exec("INSERT INTO devices (id, platform, created_at, last_seen_at) VALUES ('dev-1', 'darwin', 1, 1)")
    raw.exec("INSERT INTO bookmarks (id, parent_id, kind, title, url, position, device_id, created_at, updated_at, hlc) VALUES ('b1', NULL, 'url', 'Kept', 'https://kept.example/', 'a0', 'dev-1', 1, 1, '0000000000001-0000-dev-1')")
    raw.close()
    const db = SurffishDatabase.open({ path })
    assert.equal(Number(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version), 2)
    assert.equal(db.deviceId, 'dev-1')
    assert.equal(db.get<{ title: string }>("SELECT title FROM bookmarks WHERE id = 'b1'")!.title, 'Kept')
    const table = new ReadingListTable(db)
    table.add(input('https://example.com/later'))
    assert.equal(table.list().length, 1)
    assert.equal(ops(db).length, 1)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
