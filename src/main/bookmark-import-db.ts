import type { Database, SqlJsStatic } from 'sql.js'
import { chromiumTimeToMs, macAbsoluteTimeToMs, prTimeToMs, type FirefoxBookmarkRow, type ImportedHistoryEntry } from '../shared/bookmark-import'

/**
 * SQLite readers for other browsers' history/bookmark databases, run with sql.js (wasm) so
 * packaged builds need no native module. Callers always hand in a *copy* of the database file:
 * the browser may hold the live one locked.
 */

export const MAX_IMPORTED_HISTORY = 5000

/**
 * Open database bytes in memory. WAL-mode files (Firefox, Safari) are flipped to the legacy
 * journal format in the header first: sql.js has no shared memory for WAL, and the main file
 * is complete without the -wal sidecar (minus whatever the browser hasn't checkpointed yet).
 */
export function openSqliteBytes(SQL: SqlJsStatic, bytes: Uint8Array): Database {
  const copy = new Uint8Array(bytes)
  if (copy.length >= 100 && new TextDecoder().decode(copy.subarray(0, 15)) === 'SQLite format 3') {
    if (copy[18] === 2) copy[18] = 1
    if (copy[19] === 2) copy[19] = 1
  }
  return new SQL.Database(copy)
}

function rows<T>(db: Database, sql: string, params: Array<string | number> = []): T[] {
  const statement = db.prepare(sql)
  try {
    statement.bind(params)
    const result: T[] = []
    while (statement.step()) result.push(statement.getAsObject() as T)
    return result
  } finally {
    statement.free()
  }
}

function historyEntries(raw: Array<{ url: unknown; title: unknown; visited: unknown }>, toMs: (value: unknown) => number | undefined): ImportedHistoryEntry[] {
  const entries: ImportedHistoryEntry[] = []
  for (const row of raw) {
    if (typeof row.url !== 'string' || !/^https?:\/\//i.test(row.url)) continue
    const visitedAt = toMs(row.visited)
    if (!visitedAt) continue
    entries.push({ url: row.url, title: typeof row.title === 'string' ? row.title : '', visitedAt })
  }
  return entries
}

/** Chromium `History`: one entry per URL at its last visit time. */
export function readChromiumHistory(db: Database, limit = MAX_IMPORTED_HISTORY): ImportedHistoryEntry[] {
  return historyEntries(rows(db, `
    SELECT url, title, last_visit_time AS visited FROM urls
    WHERE hidden = 0 AND last_visit_time > 0 AND (url LIKE 'http://%' OR url LIKE 'https://%')
    ORDER BY last_visit_time DESC LIMIT ?`, [limit]), (value) => chromiumTimeToMs(typeof value === 'number' ? String(Math.trunc(value)) : value))
}

/** Firefox `places.sqlite` bookmarks (folders, bookmarks; separators and tags are dropped later). */
export function readFirefoxBookmarks(db: Database): FirefoxBookmarkRow[] {
  return rows<FirefoxBookmarkRow>(db, `
    SELECT b.id AS id, b.type AS type, b.parent AS parent, b.position AS position, b.title AS title,
           b.guid AS guid, p.url AS url, b.dateAdded AS dateAdded
    FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk`)
}

export function readFirefoxHistory(db: Database, limit = MAX_IMPORTED_HISTORY): ImportedHistoryEntry[] {
  return historyEntries(rows(db, `
    SELECT url, title, last_visit_date AS visited FROM moz_places
    WHERE last_visit_date IS NOT NULL AND hidden = 0 AND (url LIKE 'http://%' OR url LIKE 'https://%')
    ORDER BY last_visit_date DESC LIMIT ?`, [limit]), prTimeToMs)
}

/** Safari `History.db`: latest visit per item, with that visit's title. */
export function readSafariHistory(db: Database, limit = MAX_IMPORTED_HISTORY): ImportedHistoryEntry[] {
  return historyEntries(rows(db, `
    SELECT i.url AS url, (SELECT v2.title FROM history_visits v2 WHERE v2.history_item = i.id ORDER BY v2.visit_time DESC LIMIT 1) AS title,
           MAX(v.visit_time) AS visited
    FROM history_items i JOIN history_visits v ON v.history_item = i.id
    WHERE i.url LIKE 'http://%' OR i.url LIKE 'https://%'
    GROUP BY i.id ORDER BY visited DESC LIMIT ?`, [limit]), macAbsoluteTimeToMs)
}
