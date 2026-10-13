import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SurffishDatabase } from './database.ts'
import { HISTORY_ENTITY, HistoryStore } from './history-store.ts'
import { importLegacyHistory, scrubLegacyHistory } from './history-legacy.ts'
import { FILE_DB_TEST_TIMEOUT_MS, storeTestDir } from './test-temp-dir.ts'

function memoryStore(max?: number): { db: SurffishDatabase; history: HistoryStore } {
  const db = SurffishDatabase.open({ path: ':memory:' })
  return { db, history: new HistoryStore(db, max) }
}

test('records visits newest first and updates title/favicon in place', () => {
  const { db, history } = memoryStore()
  const a = history.add({ url: 'https://a.test/', title: 'A', visitedAt: 1000 })
  history.add({ url: 'https://b.test/', title: 'B', visitedAt: 2000 })
  history.setTitle(a, 'A page')
  history.setFavicon(a, 'https://a.test/favicon.ico')
  const recent = history.recent(10)
  assert.deepEqual(recent.map((entry) => entry.url), ['https://b.test/', 'https://a.test/'])
  assert.equal(recent[1]!.title, 'A page')
  assert.equal(recent[1]!.faviconUrl, 'https://a.test/favicon.ico')
  assert.equal(history.recent(1).length, 1)
  const op = db.changesSince(0).find((entry) => entry.entity_id === a)!
  assert.equal(op.entity, HISTORY_ENTITY)
  assert.equal(JSON.parse(op.payload!).title, 'A page')
  db.close()
})

test('removing visits purges their oplog payloads and leaves content-free delete ops', () => {
  const { db, history } = memoryStore()
  history.add({ url: 'https://secret.test/page', title: 'Secret', visitedAt: 1 })
  history.add({ url: 'https://keep.test/', title: 'Keep', visitedAt: 2 })
  assert.equal(history.removeWhere((entry) => entry.url.includes('secret')), 1)
  assert.deepEqual(history.recent(10).map((entry) => entry.url), ['https://keep.test/'])
  const log = JSON.stringify(db.all('SELECT * FROM oplog'))
  assert.ok(!log.includes('secret'), 'no trace of the removed URL in the change log')
  assert.equal(db.all("SELECT * FROM oplog WHERE op = 'delete'").length, 1)

  assert.equal(history.clear(), 1)
  assert.equal(history.count(), 0)
  const ops = db.changesSince(0)
  assert.deepEqual(ops.map((op) => [op.op, op.entity_id]), [['clear', '*']])
  db.close()
})

test('bulk add skips known ids and exact url+time repeats, and prune keeps the newest', () => {
  const { db, history } = memoryStore(3)
  const inserted = history.addMany([
    { id: 'x1', url: 'https://1.test/', title: '1', visitedAt: 1 },
    { id: 'x1', url: 'https://1.test/', title: '1', visitedAt: 1 },
    { url: 'https://1.test/', title: 'dup time', visitedAt: 1 },
    { url: 'https://2.test/', title: '2', visitedAt: 2 },
    { url: 'https://3.test/', title: '3', visitedAt: 3 },
    { url: 'https://4.test/', title: '4', visitedAt: 4 }
  ])
  assert.equal(inserted.length, 4)
  assert.deepEqual(history.recent(10).map((entry) => entry.visitedAt), [4, 3, 2])
  db.close()
})

test('imports browsing-history.json once, re-imports only when the file changes, and scrubs it on clear', { timeout: FILE_DB_TEST_TIMEOUT_MS }, () => {
  const dir = storeTestDir('surffish-hist-')
  try {
    const path = join(dir, 'browsing-history.json')
    writeFileSync(path, JSON.stringify([
      { id: 'n2', url: 'https://new.test/', title: 'New', visitedAt: 20, faviconUrl: 'https://new.test/f.png' },
      { id: 'n1', url: 'https://old.test/', title: 'Old', visitedAt: 10 },
      { id: 'bad', url: 'javascript:alert(1)', title: 'x', visitedAt: 5 }
    ]))
    const db = SurffishDatabase.open({ path: join(dir, 'surffish.db') })
    const history = new HistoryStore(db)
    assert.equal(importLegacyHistory(db, history, path), 2)
    assert.equal(importLegacyHistory(db, history, path), 0, 'unchanged file is not read again')
    assert.deepEqual(history.recent(10).map((entry) => entry.id), ['n2', 'n1'])
    assert.equal(history.recent(10)[0]!.faviconUrl, 'https://new.test/f.png')

    // A fallback run (database unavailable) appended to the JSON file: merged by id next time.
    writeFileSync(path, JSON.stringify([
      { id: 'n3', url: 'https://fallback.test/', title: 'Fallback', visitedAt: 30 },
      { id: 'n2', url: 'https://new.test/', title: 'New', visitedAt: 20 },
      { id: 'n1', url: 'https://old.test/', title: 'Old', visitedAt: 10 }
    ]))
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    assert.equal(importLegacyHistory(db, history, path), 1)
    assert.equal(history.count(), 3)

    scrubLegacyHistory(db, path, (entry) => entry.url.includes('old.test'))
    assert.ok(!readFileSync(path, 'utf8').includes('old.test'))
    assert.equal(importLegacyHistory(db, history, path), 0, 'scrubbing is not mistaken for a fallback write')
    scrubLegacyHistory(db, path, null)
    assert.equal(readFileSync(path, 'utf8'), '[]')
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
