import { closeSync, openSync, readSync, writeSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  chromiumTimeToMs,
  macAbsoluteTimeToMs,
  prTimeToMs,
  type FirefoxBookmarkRow,
  type ImportedHistoryEntry,
} from "../shared/bookmark-import";
import { loadSqlite } from "./store/database";

/**
 * SQLite readers for other browsers' history/bookmark databases, run with the built-in node:sqlite
 * (Electron 44's main process is Node 24; Bun implements the same API for tests). Callers always
 * hand in a *copy* of the database file: the browser may hold the live one locked.
 */

export const MAX_IMPORTED_HISTORY = 5000;

export type ImportDatabase = DatabaseSync;

/**
 * Open a copied database file read-only. WAL-mode files (Firefox, Safari) are flipped to the legacy
 * journal format in the copy's header first: a read-only WAL open needs the -shm/-wal sidecars, and
 * the main file is complete without them (minus whatever the browser hasn't checkpointed yet).
 */
export function openSqliteCopy(path: string): ImportDatabase {
  const sqlite = loadSqlite();
  if (!sqlite) throw new Error("node:sqlite is not available in this runtime");
  useLegacyJournalHeader(path);
  return new sqlite.DatabaseSync(path, { readOnly: true });
}

function useLegacyJournalHeader(path: string): void {
  const fd = openSync(path, "r+");
  try {
    const header = Buffer.alloc(20);
    if (
      readSync(fd, header, 0, 20, 0) < 20 ||
      header.toString("latin1", 0, 15) !== "SQLite format 3"
    )
      return;
    if (header[18] !== 2 && header[19] !== 2) return;
    const versions = Buffer.from([
      header[18] === 2 ? 1 : header[18]!,
      header[19] === 2 ? 1 : header[19]!,
    ]);
    writeSync(fd, versions, 0, 2, 18);
  } finally {
    closeSync(fd);
  }
}

function rows<T>(
  db: ImportDatabase,
  sql: string,
  params: Array<string | number> = [],
): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function historyEntries(
  raw: Array<{ url: unknown; title: unknown; visited: unknown }>,
  toMs: (value: unknown) => number | undefined,
): ImportedHistoryEntry[] {
  const entries: ImportedHistoryEntry[] = [];
  for (const row of raw) {
    if (typeof row.url !== "string" || !/^https?:\/\//i.test(row.url)) continue;
    const visitedAt = toMs(row.visited);
    if (!visitedAt) continue;
    entries.push({
      url: row.url,
      title: typeof row.title === "string" ? row.title : "",
      visitedAt,
    });
  }
  return entries;
}

/** Chromium `History`: one entry per URL at its last visit time. */
export function readChromiumHistory(
  db: ImportDatabase,
  limit = MAX_IMPORTED_HISTORY,
): ImportedHistoryEntry[] {
  return historyEntries(
    rows(
      db,
      `
    SELECT url, title, CAST(last_visit_time AS TEXT) AS visited FROM urls
    WHERE hidden = 0 AND last_visit_time > 0 AND (url LIKE 'http://%' OR url LIKE 'https://%')
    ORDER BY last_visit_time DESC LIMIT ?`,
      [limit],
    ),
    chromiumTimeToMs,
  );
}

/** Firefox `places.sqlite` bookmarks (folders, bookmarks; separators and tags are dropped later). */
export function readFirefoxBookmarks(db: ImportDatabase): FirefoxBookmarkRow[] {
  return rows<FirefoxBookmarkRow>(
    db,
    `
    SELECT b.id AS id, b.type AS type, b.parent AS parent, b.position AS position, b.title AS title,
           b.guid AS guid, p.url AS url, b.dateAdded AS dateAdded
    FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk`,
  );
}

export function readFirefoxHistory(
  db: ImportDatabase,
  limit = MAX_IMPORTED_HISTORY,
): ImportedHistoryEntry[] {
  return historyEntries(
    rows(
      db,
      `
    SELECT url, title, last_visit_date AS visited FROM moz_places
    WHERE last_visit_date IS NOT NULL AND hidden = 0 AND (url LIKE 'http://%' OR url LIKE 'https://%')
    ORDER BY last_visit_date DESC LIMIT ?`,
      [limit],
    ),
    prTimeToMs,
  );
}

/** Safari `History.db`: latest visit per item, with that visit's title. */
export function readSafariHistory(
  db: ImportDatabase,
  limit = MAX_IMPORTED_HISTORY,
): ImportedHistoryEntry[] {
  return historyEntries(
    rows(
      db,
      `
    SELECT i.url AS url, (SELECT v2.title FROM history_visits v2 WHERE v2.history_item = i.id ORDER BY v2.visit_time DESC LIMIT 1) AS title,
           MAX(v.visit_time) AS visited
    FROM history_items i JOIN history_visits v ON v.history_item = i.id
    WHERE i.url LIKE 'http://%' OR i.url LIKE 'https://%'
    GROUP BY i.id ORDER BY visited DESC LIMIT ?`,
      [limit],
    ),
    macAbsoluteTimeToMs,
  );
}
