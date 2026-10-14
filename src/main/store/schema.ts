/**
 * The Surffish profile database schema (surffish.db in userData).
 *
 * Every synced table carries the same bookkeeping columns:
 *   id          TEXT  stable UUID (v7 for rows we create; imported rows keep their old id)
 *   device_id   TEXT  device that last wrote the row
 *   created_at  INTEGER ms
 *   updated_at  INTEGER ms (wall clock, for display)
 *   hlc         TEXT  hybrid logical clock stamp of the last write (merge order, see sync-clock.ts)
 *   deleted_at  INTEGER ms tombstone (NULL = live). Rows are soft-deleted so the delete can sync.
 *
 * History visits are the exception: they are hard-deleted (a cleared visit must not linger on
 * disk), and the delete is recorded as a content-free `delete`/`clear` op in the oplog instead.
 *
 * `oplog` is the change log sync will read: INSERT/UPDATE triggers append one op per row write
 * (with the row as JSON), and keep only the newest op per row, so it stays about as big as the
 * data. A sync peer sends everything after the last `seq` it acknowledged.
 *
 * Migrations are append-only: never edit one that has shipped; add the next version instead.
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

const SYNC_COLUMNS = `
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hlc TEXT NOT NULL`

/** Columns copied into the oplog payload, per synced table. */
export const SYNCED_TABLES: Record<string, { entity: string; columns: readonly string[] }> = {
  history_visits: { entity: 'history_visit', columns: ['id', 'url', 'title', 'visited_at', 'favicon_url', 'transition', 'device_id', 'created_at', 'updated_at', 'hlc'] },
  bookmarks: { entity: 'bookmark', columns: ['id', 'parent_id', 'kind', 'title', 'url', 'position', 'favicon_url', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  settings: { entity: 'setting', columns: ['key', 'value', 'scope', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  spaces: { entity: 'space', columns: ['id', 'name', 'icon', 'color', 'position', 'separate_storage', 'proxy', 'extra', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  session_windows: { entity: 'session_window', columns: ['id', 'position', 'focused', 'geometry', 'active_space_id', 'extra', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  session_tabs: { entity: 'session_tab', columns: ['id', 'window_id', 'position', 'url', 'title', 'favicon_url', 'pinned', 'active', 'space_id', 'group_id', 'last_active_at', 'extra', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  tab_groups: { entity: 'tab_group', columns: ['id', 'window_id', 'name', 'color', 'collapsed', 'position', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  session_splits: { entity: 'session_split', columns: ['id', 'window_id', 'tab_ids', 'sizes', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] },
  // v2. `snapshot`/`snapshot_at` are left out on purpose: the saved Reader copy is a per-device cache
  // (it can be large), so it never rides the change log; a peer re-captures its own.
  reading_list: { entity: 'reading_item', columns: ['id', 'url', 'title', 'favicon_url', 'site_name', 'excerpt', 'added_at', 'read_at', 'device_id', 'created_at', 'updated_at', 'hlc', 'deleted_at'] }
}

/** Tables whose change-log triggers v1 created (a later table's triggers ship with its own migration). */
const V1_SYNCED_TABLES = ['history_visits', 'bookmarks', 'settings', 'spaces', 'session_windows', 'session_tabs', 'tab_groups', 'session_splits'] as const

function oplogTriggers(table: string): string {
  const spec = SYNCED_TABLES[table]!
  const key = table === 'settings' ? 'key' : 'id'
  const payload = `json_object(${spec.columns.map((column) => `'${column}', NEW.${column}`).join(', ')})`
  const body = (event: 'INSERT' | 'UPDATE'): string => `
CREATE TRIGGER ${table}_oplog_${event.toLowerCase()} AFTER ${event} ON ${table}
BEGIN
  DELETE FROM oplog WHERE entity = '${spec.entity}' AND entity_id = NEW.${key};
  INSERT INTO oplog (entity, entity_id, op, hlc, device_id, payload, created_at)
  VALUES ('${spec.entity}', NEW.${key}, 'upsert', NEW.hlc, NEW.device_id, ${payload}, NEW.updated_at);
END;`
  return body('INSERT') + body('UPDATE')
}

const V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT,
  platform TEXT NOT NULL,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Change log for sync. op: upsert (payload = row JSON), delete (payload NULL), clear (whole entity
-- wiped up to this hlc, entity_id '*'). Newest op per row only (triggers prune older ones).
CREATE TABLE oplog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete', 'clear')),
  hlc TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX oplog_entity ON oplog (entity, entity_id);

-- One row per paired device: how far each side has got.
CREATE TABLE sync_peers (
  peer_device_id TEXT PRIMARY KEY,
  name TEXT,
  last_sent_seq INTEGER NOT NULL DEFAULT 0,
  last_received_hlc TEXT,
  paired_at INTEGER NOT NULL,
  last_sync_at INTEGER
) WITHOUT ROWID;

-- Preferences as JSON values. scope 'device' never leaves this machine (window geometry, sidebar width).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'synced' CHECK (scope IN ('synced', 'device')),
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;

CREATE TABLE history_visits (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  visited_at INTEGER NOT NULL,
  favicon_url TEXT,
  transition TEXT,
  ${SYNC_COLUMNS}
);
CREATE INDEX history_visits_visited_at ON history_visits (visited_at DESC);
CREATE INDEX history_visits_url ON history_visits (url, visited_at DESC);

-- Folder/URL tree. position is a fractional index string so concurrent moves on two devices merge
-- without renumbering siblings. No FK on parent_id: sync can deliver a child before its folder.
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'url')),
  title TEXT NOT NULL DEFAULT '',
  url TEXT,
  position TEXT NOT NULL,
  favicon_url TEXT,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX bookmarks_parent ON bookmarks (parent_id, position) WHERE deleted_at IS NULL;
CREATE INDEX bookmarks_url ON bookmarks (url) WHERE deleted_at IS NULL;

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  position TEXT NOT NULL,
  separate_storage INTEGER NOT NULL DEFAULT 0,
  proxy TEXT,
  extra TEXT,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;

-- Open windows/tabs. extra is JSON for per-window/per-tab state that doesn't need its own
-- column (e.g. each Space's last active tab). Rows belong to the device in device_id; another device's rows are its
-- "tabs on other devices". Closing a window/tab tombstones it (deleted_at) instead of deleting.
CREATE TABLE session_windows (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  focused INTEGER NOT NULL DEFAULT 0,
  geometry TEXT,
  active_space_id TEXT,
  extra TEXT,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX session_windows_device ON session_windows (device_id, position) WHERE deleted_at IS NULL;

CREATE TABLE session_tabs (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  favicon_url TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  space_id TEXT,
  group_id TEXT,
  last_active_at INTEGER,
  extra TEXT,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX session_tabs_window ON session_tabs (window_id, position) WHERE deleted_at IS NULL;

CREATE TABLE tab_groups (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX tab_groups_window ON tab_groups (window_id) WHERE deleted_at IS NULL;

CREATE TABLE session_splits (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  tab_ids TEXT NOT NULL,
  sizes TEXT NOT NULL,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX session_splits_window ON session_splits (window_id) WHERE deleted_at IS NULL;

-- A cleared/forgotten visit must not survive in the change log either.
CREATE TRIGGER history_visits_oplog_purge AFTER DELETE ON history_visits
BEGIN
  DELETE FROM oplog WHERE entity = 'history_visit' AND entity_id = OLD.id;
END;
${V1_SYNCED_TABLES.map(oplogTriggers).join('\n')}
`

/**
 * v2: the Reading List (save for later; not bookmarks). One row per saved page, keyed by a UUIDv7.
 * `added_at` is when the user saved it (re-saving the same page moves it back to the top and marks
 * it unread), `read_at` NULL = unread. A removed item is a tombstone with url/title/excerpt blanked
 * and the snapshot dropped. No unique index on url: two devices can save the same page before they
 * sync, and the app de-duplicates on read instead of failing the merge.
 */
const V2 = `
CREATE TABLE reading_list (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  favicon_url TEXT,
  site_name TEXT,
  excerpt TEXT,
  added_at INTEGER NOT NULL,
  read_at INTEGER,
  snapshot TEXT,
  snapshot_at INTEGER,
  ${SYNC_COLUMNS},
  deleted_at INTEGER
) WITHOUT ROWID;
CREATE INDEX reading_list_added ON reading_list (added_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX reading_list_url ON reading_list (url) WHERE deleted_at IS NULL;
${oplogTriggers('reading_list')}
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema: meta, devices, oplog, settings, history, bookmarks, spaces, session', sql: V1 },
  { version: 2, name: 'reading list', sql: V2 }
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version
