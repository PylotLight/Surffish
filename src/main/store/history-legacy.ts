import type { BrowsingHistoryEntry } from "../../shared/types";
import { normalizeFaviconUrl } from "../../shared/persistence";
import type { SurffishDatabase } from "./database";
import type { HistoryStore } from "./history-store";
import {
  legacyFileNeedsImport,
  markLegacyFileImported,
  readLegacyJson,
  writeLegacyJson,
} from "./legacy-json";

/** browsing-history.json: a newest-first array of visits (the pre-SQLite history store). */
export const LEGACY_HISTORY_FILE = "browsing-history.json";

export function normalizeHistoryEntry(
  value: unknown,
): BrowsingHistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Partial<BrowsingHistoryEntry>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.url !== "string" ||
    !/^https?:\/\//i.test(entry.url) ||
    typeof entry.title !== "string" ||
    typeof entry.visitedAt !== "number" ||
    !Number.isFinite(entry.visitedAt)
  )
    return null;
  const faviconUrl = normalizeFaviconUrl(entry.faviconUrl);
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    visitedAt: entry.visitedAt,
    ...(faviconUrl ? { faviconUrl } : {}),
  };
}

export function parseLegacyHistory(
  value: unknown,
  limit = Number.POSITIVE_INFINITY,
): BrowsingHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeHistoryEntry)
    .filter((entry): entry is BrowsingHistoryEntry => entry !== null)
    .slice(0, limit);
}

/**
 * Import browsing-history.json into the database when it is new or changed since the last import.
 * Idempotent: visits are merged by id (and exact url+time). Returns how many visits were added.
 */
export function importLegacyHistory(
  db: SurffishDatabase,
  store: HistoryStore,
  path: string,
): number {
  if (!legacyFileNeedsImport(db, LEGACY_HISTORY_FILE, path)) return 0;
  const entries = parseLegacyHistory(readLegacyJson(path));
  // Oldest first, so if the cap bites, the newest survive.
  const added = store.addMany([...entries].reverse());
  markLegacyFileImported(db, LEGACY_HISTORY_FILE, path, {
    visits: entries.length,
    added: added.length,
  });
  return added.length;
}

/**
 * Apply a privacy delete to the legacy JSON copy too, so clearing history in the database doesn't
 * leave the same pages readable in browsing-history.json. `predicate` null = remove everything.
 */
export function scrubLegacyHistory(
  db: SurffishDatabase | null,
  path: string,
  predicate: ((entry: BrowsingHistoryEntry) => boolean) | null,
): void {
  const raw = readLegacyJson(path);
  if (raw === null) return;
  const entries = parseLegacyHistory(raw);
  const kept = predicate ? entries.filter((entry) => !predicate(entry)) : [];
  if (Array.isArray(raw) && kept.length === raw.length) return;
  if (writeLegacyJson(path, kept) && db)
    markLegacyFileImported(db, LEGACY_HISTORY_FILE, path, { scrubbed: true });
}
