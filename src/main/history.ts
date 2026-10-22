import { app } from "electron";
import { cancelDeferredWrite, deferWrite } from "./deferred-writes";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowsingHistoryEntry } from "../shared/types";
import { normalizeFaviconUrl } from "../shared/persistence";
import { getProfileDatabase, reportStoreWriteError } from "./store";
import { HistoryStore } from "./store/history-store";
import {
  importLegacyHistory,
  LEGACY_HISTORY_FILE,
  parseLegacyHistory,
  scrubLegacyHistory,
} from "./store/history-legacy";
import { readLegacyJson } from "./store/legacy-json";

/**
 * Browsing history. Stored in the profile database (surffish.db, history_visits) when it opens;
 * otherwise in browsing-history.json exactly as before (safe fallback). `entries` is an in-memory
 * cache of the newest MAX_HISTORY_ENTRIES visits either way, which is what the UI reads.
 *
 * With SQLite every visit is one indexed insert (no 5,000-entry file rewrite), and up to
 * MAX_STORED_VISITS stay on disk. If a database write fails mid-run, history drops to the JSON
 * file for the rest of the run, and the next start merges that file back in.
 */

const MAX_HISTORY_ENTRIES = 5000;
let loaded = false;
let entries: BrowsingHistoryEntry[] = [];
let sqlStore: HistoryStore | null | undefined;

function historyPath(): string {
  return join(app.getPath("userData"), LEGACY_HISTORY_FILE);
}

function store(): HistoryStore | null {
  if (sqlStore !== undefined) return sqlStore;
  const db = getProfileDatabase();
  if (!db) return (sqlStore = null);
  try {
    const candidate = new HistoryStore(db);
    importLegacyHistory(db, candidate, historyPath());
    sqlStore = candidate;
  } catch (error) {
    console.error(
      "History database unavailable; using browsing-history.json:",
      error,
    );
    sqlStore = null;
  }
  return sqlStore;
}

/** Run a database write; on failure fall back to the JSON file for the rest of this run. */
function write(run: (target: HistoryStore) => void): void {
  const target = store();
  if (!target) {
    persistHistory();
    return;
  }
  try {
    run(target);
  } catch (error) {
    reportStoreWriteError(
      "History database write failed; falling back to browsing-history.json:",
      error,
    );
    sqlStore = null;
    persistHistory();
  }
}

function loadHistory(): void {
  if (loaded) return;
  loaded = true;
  const target = store();
  if (target) {
    try {
      entries = target.recent(MAX_HISTORY_ENTRIES);
      return;
    } catch (error) {
      console.error("Could not read history from the database:", error);
      sqlStore = null;
    }
  }
  entries = parseLegacyHistory(
    readLegacyJson(historyPath()),
    MAX_HISTORY_ENTRIES,
  );
}

function persistHistory(): void {
  deferWrite("history", writeHistory, 1500);
}

function writeHistory(): void {
  const path = historyPath();
  const directory = app.getPath("userData");
  const temporaryPath = `${path}.tmp`;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporaryPath, JSON.stringify(entries), "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    console.error("Could not save browsing history:", error);
  }
}

export function getBrowsingHistory(): BrowsingHistoryEntry[] {
  loadHistory();
  return entries.map((entry) => ({ ...entry }));
}

export function recordBrowsingVisit(url: string, title: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  loadHistory();
  const entry: BrowsingHistoryEntry = {
    id: randomUUID(),
    url,
    title: title.trim() || url,
    visitedAt: Date.now(),
  };
  entries.unshift(entry);
  entries = entries.slice(0, MAX_HISTORY_ENTRIES);
  write((target) => {
    target.add(entry);
  });
}

export function updateLatestVisitTitle(url: string, title: string): void {
  if (!url || !title.trim()) return;
  loadHistory();
  const entry = entries.find((candidate) => candidate.url === url);
  if (!entry || entry.title === title) return;
  entry.title = title;
  write((target) => target.setTitle(entry.id, title));
}

export function updateLatestVisitFavicon(
  url: string,
  faviconUrl: string,
): void {
  if (!url) return;
  const normalizedFaviconUrl = normalizeFaviconUrl(faviconUrl);
  if (!normalizedFaviconUrl) return;
  loadHistory();
  const entry = entries.find((candidate) => candidate.url === url);
  if (!entry || entry.faviconUrl === normalizedFaviconUrl) return;
  entry.faviconUrl = normalizedFaviconUrl;
  write((target) => target.setFavicon(entry.id, normalizedFaviconUrl));
}

export function clearBrowsingHistory(): void {
  loadHistory();
  entries = [];
  // Clearing is a privacy action: hit the disk now rather than in a second, in both stores.
  cancelDeferredWrite("history");
  const target = store();
  if (target) {
    try {
      target.clear();
    } catch (error) {
      console.error("Could not clear history in the database:", error);
    }
    scrubLegacyHistory(getProfileDatabase(), historyPath(), null);
  } else {
    writeHistory();
  }
}

/** Remove entries matching `predicate` (Clear browsing data, Forget this site). Returns how many went. */
export function removeBrowsingHistory(
  predicate: (entry: BrowsingHistoryEntry) => boolean,
): number {
  loadHistory();
  const before = entries.length;
  entries = entries.filter((entry) => !predicate(entry));
  let removed = before - entries.length;
  const target = store();
  if (target) {
    try {
      // The database may hold older visits than the cache, so count what it removed.
      removed = Math.max(removed, target.removeWhere(predicate));
    } catch (error) {
      console.error("Could not remove history from the database:", error);
    }
    scrubLegacyHistory(getProfileDatabase(), historyPath(), predicate);
  } else if (removed > 0) {
    cancelDeferredWrite("history");
    writeHistory();
  }
  return removed;
}

/**
 * Merge visits imported from another browser. Exact (url, time) repeats are skipped, the list
 * stays newest-first and capped, so a huge import only keeps the most recent visits.
 */
export function importBrowsingHistory(
  imported: ReadonlyArray<{ url: string; title: string; visitedAt: number }>,
): number {
  loadHistory();
  const seen = new Set(
    entries.map((entry) => `${entry.visitedAt}\n${entry.url}`),
  );
  const added: BrowsingHistoryEntry[] = [];
  for (const visit of imported) {
    if (!/^https?:\/\//i.test(visit.url) || !Number.isFinite(visit.visitedAt))
      continue;
    const key = `${visit.visitedAt}\n${visit.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      id: randomUUID(),
      url: visit.url,
      title: visit.title.trim() || visit.url,
      visitedAt: visit.visitedAt,
    });
  }
  if (added.length === 0) return 0;
  const addedIds = new Set(added.map((entry) => entry.id));
  entries = [...entries, ...added]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_HISTORY_ENTRIES);
  write((target) => {
    target.addMany(added);
  });
  return entries.reduce(
    (count, entry) => count + (addedIds.has(entry.id) ? 1 : 0),
    0,
  );
}
