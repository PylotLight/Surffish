import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, openSync, rmSync, writeSync, closeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openSqliteCopy,
  readChromiumHistory,
  readFirefoxBookmarks,
  readFirefoxHistory,
  readSafariHistory,
} from "./bookmark-import-db.ts";
import { buildFirefoxBookmarkTree } from "../shared/bookmark-import.ts";

const directory = mkdtempSync(join(tmpdir(), "surffish-import-db-test-"));
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
let fixtures = 0;
const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_600_000;
const day = (n: number): number => Date.UTC(2024, 0, n);

/** A database file built from `statements` (what the importer opens: its own copy of the browser's file). */
function fixture(statements: string): string {
  const path = join(directory, `fixture-${fixtures++}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec(statements);
  db.close();
  return path;
}

/** Mark a file as a live WAL database (header bytes 18/19 = 2), as Firefox/Safari leave theirs. */
function markWal(path: string): void {
  const fd = openSync(path, "r+");
  try {
    writeSync(fd, Buffer.from([2, 2]), 0, 2, 18);
  } finally {
    closeSync(fd);
  }
}

// Each of these builds and copies a real SQLite file; slow CI pods have taken 4-6 s (5 s default).
test(
  "reads Chromium History (urls table), newest first, http(s) and visible only",
  { timeout: 30_000 },
  () => {
    const chrome = (ms: number): string =>
      String((ms + WINDOWS_EPOCH_OFFSET_MS) * 1000);
    const path = fixture(`
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
    INSERT INTO urls (url, title, last_visit_time, hidden) VALUES
      ('https://old.test/', 'Old', ${chrome(day(1))}, 0),
      ('https://new.test/', 'New', ${chrome(day(5))}, 0),
      ('chrome://settings/', 'Settings', ${chrome(day(6))}, 0),
      ('https://hidden.test/', 'Hidden', ${chrome(day(7))}, 1),
      ('http://plain.test/', NULL, ${chrome(day(3))}, 0);
  `);
    const db = openSqliteCopy(path);
    assert.deepEqual(readChromiumHistory(db), [
      { url: "https://new.test/", title: "New", visitedAt: day(5) },
      { url: "http://plain.test/", title: "", visitedAt: day(3) },
      { url: "https://old.test/", title: "Old", visitedAt: day(1) },
    ]);
    assert.equal(readChromiumHistory(db, 1).length, 1);
    db.close();
  },
);

// WAL setup + copy hit the 5 s default timeout on a slow CI runner.
test(
  "reads Firefox places.sqlite bookmarks and history, even from a WAL-mode file",
  { timeout: 30_000 },
  () => {
    const pr = (ms: number): number => ms * 1000;
    const path = fixture(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, last_visit_date INTEGER, hidden INTEGER DEFAULT 0 NOT NULL);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER DEFAULT NULL, parent INTEGER, position INTEGER, title LONGVARCHAR, dateAdded INTEGER, guid TEXT);
    INSERT INTO moz_places VALUES (1, 'https://firefox.test/', 'Firefox test', ${pr(day(2))}, 0), (2, 'https://unvisited.test/', 'Never', NULL, 0), (3, 'place:sort=8', 'Query', ${pr(day(9))}, 0);
    INSERT INTO moz_bookmarks VALUES
      (1, 2, NULL, 0, 0, '', ${pr(day(1))}, 'root________'),
      (2, 2, NULL, 1, 0, 'toolbar', ${pr(day(1))}, 'toolbar_____'),
      (3, 1, 1, 2, 0, 'FF', ${pr(day(1))}, 'aaaaaaaaaaaa'),
      (4, 1, 2, 2, 1, 'Unvisited', ${pr(day(1))}, 'bbbbbbbbbbbb');
  `);
    // A real WAL-mode file keeps 2/2 in its header after close; set it explicitly in case the runtime didn't.
    markWal(path);
    const db = openSqliteCopy(path);
    assert.deepEqual(buildFirefoxBookmarkTree(readFirefoxBookmarks(db)), [
      {
        title: "Bookmarks Toolbar",
        dateAdded: day(1),
        children: [
          { title: "FF", url: "https://firefox.test/", dateAdded: day(1) },
          {
            title: "Unvisited",
            url: "https://unvisited.test/",
            dateAdded: day(1),
          },
        ],
      },
    ]);
    assert.deepEqual(readFirefoxHistory(db), [
      {
        url: "https://firefox.test/",
        title: "Firefox test",
        visitedAt: day(2),
      },
    ]);
    db.close();
  },
);

test(
  "reads Safari History.db with the latest visit title per item",
  { timeout: 30_000 },
  () => {
    const mac = (ms: number): number => (ms - Date.UTC(2001, 0, 1)) / 1000;
    const path = fixture(`
    CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, visit_count INTEGER);
    CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER NOT NULL, visit_time REAL NOT NULL, title TEXT);
    INSERT INTO history_items VALUES (1, 'https://apple.test/', 2), (2, 'https://swift.test/', 1), (3, 'file:///Users/x', 1);
    INSERT INTO history_visits VALUES (1, 1, ${mac(day(1))}, 'Apple (old title)'), (2, 1, ${mac(day(4))}, 'Apple'), (3, 2, ${mac(day(2))}, 'Swift'), (4, 3, ${mac(day(8))}, 'Local');
  `);
    const db = openSqliteCopy(path);
    assert.deepEqual(readSafariHistory(db), [
      { url: "https://apple.test/", title: "Apple", visitedAt: day(4) },
      { url: "https://swift.test/", title: "Swift", visitedAt: day(2) },
    ]);
    db.close();
  },
);
