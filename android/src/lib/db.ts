/**
 * Local profile database (expo-sqlite), shaped like desktop's surffish.db
 * (src/main/store/schema.ts on feat/sqlite-store) so P2P sync can be bolted on later:
 * every synced row has id / device_id / created_at / updated_at / hlc (+ deleted_at tombstones),
 * and INSERT/UPDATE triggers keep an `oplog` with the newest op per row.
 *
 * Nothing syncs yet. See README "Sync (later)".
 */
import * as SQLite from 'expo-sqlite'
import { HybridLogicalClock, uuidv7 } from './sync-clock'

export interface HistoryVisit {
  id: string
  url: string
  title: string
  visitedAt: number
}

export interface Bookmark {
  id: string
  title: string
  url: string
  createdAt: number
}

export interface SessionTabRow {
  id: string
  url: string
  title: string
  position: number
  active: boolean
  state: string | null
  desktop: boolean
}

const SYNC_COLUMNS = `
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hlc TEXT NOT NULL`

const SYNCED: Record<string, { entity: string; key: string; columns: string[] }> = {
  history_visits: { entity: 'history_visit', key: 'id', columns: ['id', 'url', 'title', 'visited_at', 'favicon_url', 'transition', 'device_id', 'created_at', 'updated_at', 'hlc'] },
  bookmarks: { entity: 'bookmark', key: 'id', columns: ['id', 'parent_id', 'kind', 'title', 'url', 'position', 'favicon_url', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  settings: { entity: 'setting', key: 'key', columns: ['key', 'value', 'scope', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  session_windows: { entity: 'session_window', key: 'id', columns: ['id', 'position', 'focused', 'geometry', 'active_space_id', 'extra', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  session_tabs: { entity: 'session_tab', key: 'id', columns: ['id', 'window_id', 'position', 'url', 'title', 'favicon_url', 'pinned', 'active', 'space_id', 'group_id', 'last_active_at', 'extra', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] }
}

function triggers(table: string): string {
  const spec = SYNCED[table]!
  const payload = `json_object(${spec.columns.map((c) => `'${c}', NEW.${c}`).join(', ')})`
  return (['INSERT', 'UPDATE'] as const).map((event) => `
CREATE TRIGGER IF NOT EXISTS ${table}_oplog_${event.toLowerCase()} AFTER ${event} ON ${table}
BEGIN
  DELETE FROM oplog WHERE entity = '${spec.entity}' AND entity_id = NEW.${spec.key};
  INSERT INTO oplog (entity, entity_id, op, hlc, device_id, payload, created_at)
  VALUES ('${spec.entity}', NEW.${spec.key}, 'upsert', NEW.hlc, NEW.device_id, ${payload}, NEW.updated_at);
END;`).join('\n')
}

const V1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT, platform TEXT NOT NULL, app_version TEXT,
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS oplog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete', 'clear')),
  hlc TEXT NOT NULL, device_id TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oplog_entity ON oplog (entity, entity_id);
CREATE TABLE IF NOT EXISTS sync_peers (
  peer_device_id TEXT PRIMARY KEY, name TEXT, last_sent_seq INTEGER NOT NULL DEFAULT 0,
  last_received_hlc TEXT, paired_at INTEGER NOT NULL, last_sync_at INTEGER
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'synced' CHECK (scope IN ('synced', 'device')),
  ${SYNC_COLUMNS}, deleted_at INTEGER
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS history_visits (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', visited_at INTEGER NOT NULL,
  favicon_url TEXT, transition TEXT, ${SYNC_COLUMNS}
);
CREATE INDEX IF NOT EXISTS history_visits_visited_at ON history_visits (visited_at DESC);
CREATE INDEX IF NOT EXISTS history_visits_url ON history_visits (url, visited_at DESC);
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT NOT NULL CHECK (kind IN ('folder', 'url')),
  title TEXT NOT NULL DEFAULT '', url TEXT, position TEXT NOT NULL, favicon_url TEXT,
  ${SYNC_COLUMNS}, deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS bookmarks_parent ON bookmarks (parent_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bookmarks_url ON bookmarks (url) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS session_windows (
  id TEXT PRIMARY KEY, position INTEGER NOT NULL, focused INTEGER NOT NULL DEFAULT 0, geometry TEXT,
  active_space_id TEXT, extra TEXT, ${SYNC_COLUMNS}, deleted_at INTEGER
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS session_tabs (
  id TEXT PRIMARY KEY, window_id TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', favicon_url TEXT, pinned INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0, space_id TEXT, group_id TEXT, last_active_at INTEGER, extra TEXT,
  ${SYNC_COLUMNS}, deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS session_tabs_window ON session_tabs (window_id, position) WHERE deleted_at IS NULL;
CREATE TRIGGER IF NOT EXISTS history_visits_oplog_purge AFTER DELETE ON history_visits
BEGIN
  DELETE FROM oplog WHERE entity = 'history_visit' AND entity_id = OLD.id;
END;
${Object.keys(SYNCED).map(triggers).join('\n')}
`

/** Bookmarks bar folder id, fixed so it's the same on every device. */
const ROOT_FOLDER = 'mobile'

let db: SQLite.SQLiteDatabase | null = null
let clock: HybridLogicalClock | null = null
let deviceId = ''
let windowId = ''

function open(): SQLite.SQLiteDatabase {
  if (db) return db
  const handle = SQLite.openDatabaseSync('surffish.db')
  handle.execSync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;')
  const version = handle.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
  if (version < 1) {
    handle.withTransactionSync(() => {
      handle.execSync(V1)
      handle.execSync('PRAGMA user_version = 1')
    })
  }
  db = handle
  let id = handle.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'device_id'")?.value
  const now = Date.now()
  if (!id) {
    id = uuidv7()
    handle.runSync("INSERT INTO meta (key, value) VALUES ('device_id', ?)", [id])
    handle.runSync("INSERT OR REPLACE INTO devices (id, name, platform, app_version, created_at, last_seen_at) VALUES (?, 'Android', 'android', '0.1.0', ?, ?)", [id, now, now])
  }
  deviceId = id
  const lastHlc = handle.getFirstSync<{ hlc: string }>('SELECT hlc FROM oplog ORDER BY seq DESC LIMIT 1')?.hlc ?? null
  clock = new HybridLogicalClock(deviceId, lastHlc)
  let win = handle.getFirstSync<{ value: string }>("SELECT value FROM meta WHERE key = 'window_id'")?.value
  if (!win) {
    win = uuidv7()
    handle.runSync("INSERT INTO meta (key, value) VALUES ('window_id', ?)", [win])
    const stamp = clock.now()
    handle.runSync('INSERT INTO session_windows (id, position, focused, device_id, created_at, updated_at, hlc) VALUES (?, 0, 1, ?, ?, ?, ?)', [win, deviceId, now, now, stamp])
  }
  windowId = win
  return handle
}

function stamp() {
  open()
  return { now: Date.now(), hlc: clock!.now(), device: deviceId }
}

// ------------------------------------------------------------------ settings

export function getSetting<T>(key: string, fallback: T): T {
  const row = open().getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL', [key])
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown, scope: 'synced' | 'device' = 'synced'): void {
  const s = stamp()
  open().runSync(
    `INSERT INTO settings (key, value, scope, device_id, created_at, updated_at, hlc, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, scope = excluded.scope, device_id = excluded.device_id, updated_at = excluded.updated_at, hlc = excluded.hlc, deleted_at = NULL`,
    [key, JSON.stringify(value), scope, s.device, s.now, s.now, s.hlc]
  )
}

// ------------------------------------------------------------------ history

export function recordVisit(url: string, title: string): void {
  if (!/^https?:/i.test(url)) return
  const handle = open()
  // Collapse reloads / title updates of the same page within a minute into one visit.
  const last = handle.getFirstSync<{ id: string; url: string; visited_at: number }>('SELECT id, url, visited_at FROM history_visits ORDER BY visited_at DESC LIMIT 1')
  const s = stamp()
  if (last && last.url === url && s.now - last.visited_at < 60_000) {
    if (title) handle.runSync('UPDATE history_visits SET title = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ?', [title, s.now, s.hlc, s.device, last.id])
    return
  }
  handle.runSync(
    'INSERT INTO history_visits (id, url, title, visited_at, transition, device_id, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [uuidv7(s.now), url, title, s.now, 'link', s.device, s.now, s.now, s.hlc]
  )
}

export function updateVisitTitle(url: string, title: string): void {
  if (!title) return
  const handle = open()
  const last = handle.getFirstSync<{ id: string; title: string }>('SELECT id, title FROM history_visits WHERE url = ? ORDER BY visited_at DESC LIMIT 1', [url])
  if (!last || last.title === title) return
  const s = stamp()
  handle.runSync('UPDATE history_visits SET title = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ?', [title, s.now, s.hlc, s.device, last.id])
}

export function listHistory(query = '', limit = 300): HistoryVisit[] {
  const q = `%${query.trim()}%`
  return open().getAllSync<{ id: string; url: string; title: string; visited_at: number }>(
    query.trim()
      ? 'SELECT id, url, title, visited_at FROM history_visits WHERE url LIKE ? OR title LIKE ? ORDER BY visited_at DESC LIMIT ?'
      : 'SELECT id, url, title, visited_at FROM history_visits WHERE ? = ? ORDER BY visited_at DESC LIMIT ?',
    query.trim() ? [q, q, limit] : [1, 1, limit]
  ).map((r) => ({ id: r.id, url: r.url, title: r.title, visitedAt: r.visited_at }))
}

/** Distinct recent urls for autocomplete. */
export function historyForSuggestions(limit = 2000): { id: string; url: string; title: string; visitedAt: number }[] {
  return open().getAllSync<{ id: string; url: string; title: string; visited_at: number }>(
    'SELECT id, url, title, MAX(visited_at) AS visited_at FROM history_visits GROUP BY url ORDER BY COUNT(*) DESC, visited_at DESC LIMIT ?',
    [limit]
  ).map((r) => ({ id: r.id, url: r.url, title: r.title, visitedAt: r.visited_at }))
}

export function deleteVisit(id: string): void {
  open().runSync('DELETE FROM history_visits WHERE id = ?', [id])
  logDelete('history_visit', id)
}

export function clearHistory(): void {
  const handle = open()
  handle.runSync('DELETE FROM history_visits')
  const s = stamp()
  handle.runSync("INSERT INTO oplog (entity, entity_id, op, hlc, device_id, payload, created_at) VALUES ('history_visit', '*', 'clear', ?, ?, NULL, ?)", [s.hlc, s.device, s.now])
  handle.execSync('PRAGMA wal_checkpoint(TRUNCATE)')
}

function logDelete(entity: string, id: string) {
  const s = stamp()
  open().runSync("INSERT INTO oplog (entity, entity_id, op, hlc, device_id, payload, created_at) VALUES (?, ?, 'delete', ?, ?, NULL, ?)", [entity, id, s.hlc, s.device, s.now])
}

// ------------------------------------------------------------------ bookmarks

export function listBookmarks(query = ''): Bookmark[] {
  const q = `%${query.trim()}%`
  return open().getAllSync<{ id: string; title: string; url: string; created_at: number }>(
    "SELECT id, title, url, created_at FROM bookmarks WHERE deleted_at IS NULL AND kind = 'url' AND (title LIKE ? OR url LIKE ?) ORDER BY position DESC",
    [q, q]
  ).map((r) => ({ id: r.id, title: r.title, url: r.url, createdAt: r.created_at }))
}

export function findBookmark(url: string): Bookmark | null {
  const r = open().getFirstSync<{ id: string; title: string; url: string; created_at: number }>(
    "SELECT id, title, url, created_at FROM bookmarks WHERE deleted_at IS NULL AND kind = 'url' AND url = ?",
    [url]
  )
  return r ? { id: r.id, title: r.title, url: r.url, createdAt: r.created_at } : null
}

export function addBookmark(url: string, title: string): Bookmark {
  const existing = findBookmark(url)
  if (existing) return existing
  const s = stamp()
  const id = uuidv7(s.now)
  // Fractional-index-ish position: time-ordered string, newest sorts last.
  const position = `a${String(s.now).padStart(13, '0')}`
  open().runSync(
    "INSERT INTO bookmarks (id, parent_id, kind, title, url, position, device_id, created_at, updated_at, hlc) VALUES (?, ?, 'url', ?, ?, ?, ?, ?, ?, ?)",
    [id, ROOT_FOLDER, title || url, url, position, s.device, s.now, s.now, s.hlc]
  )
  return { id, title: title || url, url, createdAt: s.now }
}

export function renameBookmark(id: string, title: string): void {
  const s = stamp()
  open().runSync('UPDATE bookmarks SET title = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ?', [title, s.now, s.hlc, s.device, id])
}

export function removeBookmark(id: string): void {
  const s = stamp()
  open().runSync('UPDATE bookmarks SET deleted_at = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ?', [s.now, s.now, s.hlc, s.device, id])
}

// ------------------------------------------------------------------ session (open tabs)

export function loadSessionTabs(): SessionTabRow[] {
  const handle = open()
  return handle.getAllSync<{ id: string; url: string; title: string; position: number; active: number; extra: string | null }>(
    'SELECT id, url, title, position, active, extra FROM session_tabs WHERE window_id = ? AND device_id = ? AND deleted_at IS NULL ORDER BY position',
    [windowId, deviceId]
  ).map((r) => {
    let extra: { state?: string; desktop?: boolean } = {}
    try { extra = r.extra ? JSON.parse(r.extra) : {} } catch { /* ignore */ }
    return { id: r.id, url: r.url, title: r.title, position: r.position, active: r.active === 1, state: extra.state ?? null, desktop: extra.desktop === true }
  })
}

/** Replace the persisted tab list with the current (non-private) tabs. */
export function saveSessionTabs(tabs: SessionTabRow[]): void {
  const handle = open()
  const s = stamp()
  handle.withTransactionSync(() => {
    const keep = new Set(tabs.map((t) => t.id))
    const existing = handle.getAllSync<{ id: string; url: string; title: string; position: number; active: number; extra: string | null }>(
      'SELECT id, url, title, position, active, extra FROM session_tabs WHERE window_id = ? AND deleted_at IS NULL',
      [windowId]
    )
    const byId = new Map(existing.map((e) => [e.id, e]))
    for (const e of existing) {
      if (!keep.has(e.id)) handle.runSync('UPDATE session_tabs SET deleted_at = ?, updated_at = ?, hlc = ? WHERE id = ?', [s.now, s.now, s.hlc, e.id])
    }
    for (const t of tabs) {
      const extra = JSON.stringify({ state: t.state ?? undefined, desktop: t.desktop || undefined })
      const prev = byId.get(t.id)
      if (prev && prev.url === t.url && prev.title === t.title && prev.position === t.position && (prev.active === 1) === t.active && prev.extra === extra) continue
      handle.runSync(
        `INSERT INTO session_tabs (id, window_id, position, url, title, active, last_active_at, extra, device_id, created_at, updated_at, hlc, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET position = excluded.position, url = excluded.url, title = excluded.title, active = excluded.active,
           last_active_at = CASE WHEN excluded.active = 1 THEN excluded.last_active_at ELSE session_tabs.last_active_at END,
           extra = excluded.extra, updated_at = excluded.updated_at, hlc = excluded.hlc, deleted_at = NULL`,
        [t.id, windowId, t.position, t.url, t.title, t.active ? 1 : 0, s.now, extra, s.device, s.now, s.now, s.hlc]
      )
    }
  })
}
