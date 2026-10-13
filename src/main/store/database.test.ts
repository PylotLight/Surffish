import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { StoreOpenError, SurffishDatabase } from './database.ts'
import { SCHEMA_VERSION } from './schema.ts'
import { FILE_DB_TEST_TIMEOUT_MS, storeTestDir } from './test-temp-dir.ts'

const tempDir = (): string => storeTestDir('surffish-db-')
// Every test here opens real files (see test-temp-dir.ts for why they can be slow on CI disks).
const fileDb = { timeout: FILE_DB_TEST_TIMEOUT_MS }

test('opens a fresh file in WAL mode with the schema, a device id and owner-only permissions', fileDb, () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'surffish.db')
    const db = SurffishDatabase.open({ path, platform: 'darwin', appVersion: '9.9.9' })
    assert.equal(db.get<{ journal_mode: string }>('PRAGMA journal_mode')!.journal_mode, 'wal')
    assert.equal(Number(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version), SCHEMA_VERSION)
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name)
    for (const table of ['meta', 'devices', 'oplog', 'sync_peers', 'settings', 'history_visits', 'bookmarks', 'spaces', 'session_windows', 'session_tabs', 'tab_groups', 'session_splits']) {
      assert.ok(tables.includes(table), `missing ${table}`)
    }
    const device = db.get<{ id: string; platform: string; app_version: string }>('SELECT id, platform, app_version FROM devices')!
    assert.equal(device.id, db.deviceId)
    assert.equal(device.platform, 'darwin')
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600)
    const deviceId = db.deviceId
    db.close()
    const again = SurffishDatabase.open({ path })
    assert.equal(again.deviceId, deviceId, 'device id is stable across opens')
    again.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the clock resumes past the last stamp after reopening', fileDb, () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'surffish.db')
    let now = 5_000_000
    const db = SurffishDatabase.open({ path, now: () => now })
    const before = db.stamp().hlc
    db.close()
    now = 1 // wall clock jumped back
    const again = SurffishDatabase.open({ path, now: () => now })
    assert.ok(again.stamp().hlc > before)
    again.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('refuses a database from a newer build and reports a corrupt file as corrupt', fileDb, () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'surffish.db')
    const db = SurffishDatabase.open({ path })
    db.exec('PRAGMA user_version = 999')
    db.close()
    assert.throws(() => SurffishDatabase.open({ path }), (error: unknown) => error instanceof StoreOpenError && error.kind === 'too-new')

    const junk = join(dir, 'junk.db')
    writeFileSync(junk, 'this is definitely not sqlite'.repeat(200))
    assert.throws(() => SurffishDatabase.open({ path: junk }), (error: unknown) => error instanceof StoreOpenError && error.kind === 'corrupt')
    const moved = SurffishDatabase.quarantine(junk, 42)
    assert.equal(moved, `${junk}.corrupt-42`)
    assert.ok(!existsSync(junk) && existsSync(moved!))
    SurffishDatabase.open({ path: junk }).close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migrations run in order, once, and a failing one rolls back', fileDb, () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'surffish.db')
    const extra = [{ version: SCHEMA_VERSION + 1, name: 'test table', sql: 'CREATE TABLE extra (id TEXT PRIMARY KEY)' }]
    SurffishDatabase.open({ path, migrations: extra }).close()
    const db = SurffishDatabase.open({ path, migrations: extra })
    assert.equal(Number(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version), SCHEMA_VERSION + 1)
    db.close()
    const broken = [...extra, { version: SCHEMA_VERSION + 2, name: 'broken', sql: 'CREATE TABLE half (id TEXT); THIS IS NOT SQL' }]
    assert.throws(() => SurffishDatabase.open({ path, migrations: broken }), StoreOpenError)
    const after = SurffishDatabase.open({ path, migrations: extra })
    assert.equal(after.get("SELECT name FROM sqlite_master WHERE name = 'half'"), undefined)
    after.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writes to synced tables land in the oplog, newest op per row, with the row as JSON', fileDb, () => {
  const db = SurffishDatabase.open({ path: ':memory:' })
  const insert = (key: string, value: string): void => {
    const { now, hlc, deviceId } = db.stamp()
    db.run('INSERT INTO settings (key, value, device_id, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, hlc = excluded.hlc', key, value, deviceId, now, now, hlc)
  }
  insert('searchEngine', '"duckduckgo"')
  insert('searchEngine', '"kagi"')
  insert('sidebarWidth', '280')
  const ops = db.changesSince(0)
  assert.equal(ops.length, 2)
  const search = ops.find((op) => op.entity_id === 'searchEngine')!
  assert.equal(search.entity, 'setting')
  assert.equal(search.op, 'upsert')
  assert.equal(JSON.parse(search.payload!).value, '"kagi"')
  assert.equal(db.changesSince(ops[1]!.seq).length, 0)

  db.transaction(() => {
    db.transaction(() => insert('nested', '1'))
  })
  assert.throws(() => db.transaction(() => { insert('rolledBack', '1'); throw new Error('boom') }))
  assert.equal(db.get("SELECT key FROM settings WHERE key = 'rolledBack'"), undefined)
  assert.ok(db.get("SELECT key FROM settings WHERE key = 'nested'"))
  db.close()
})
