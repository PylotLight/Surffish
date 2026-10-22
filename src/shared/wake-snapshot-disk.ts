/**
 * Wake snapshots on disk (main/wake-snapshot-disk.ts): the in-memory wake snapshot of a tab
 * (shared/wake-snapshot.ts) is also written to the profile, one JPEG per page URL, so the tabs of
 * a restored session show their last picture the first time they're opened after a restart
 * instead of a blank page while they load. Never for private tabs. Capped in total size and age,
 * pruned at start-up to the pages the restored session still has open, removed when its tab is
 * closed, and cleared with history or cache in Clear Browsing Data.
 *
 * Pure rules live here: the manifest format and what to keep.
 */

export const WAKE_SNAPSHOT_DISK_VERSION = 1;
/** Everything on disk together stays under this (oldest go first). */
export const WAKE_SNAPSHOT_DISK_MAX_TOTAL_BYTES = 48 * 1024 * 1024;
/** A picture older than this is not worth showing (the page has surely changed). */
export const WAKE_SNAPSHOT_DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Writes wait this long, so a run of tab switches writes each picture once. */
export const WAKE_SNAPSHOT_DISK_WRITE_DELAY_MS = 2000;

export interface WakeSnapshotDiskEntry {
  /** File name stem (hex digest of `wakeSnapshotUrlKey(url)`). */
  key: string;
  url: string;
  /** Page area (DIP) when it was taken. */
  width: number;
  height: number;
  bytes: number;
  savedAt: number;
}

const KEY_PATTERN = /^[a-f0-9]{32,64}$/;

/** What a picture is filed under: the http(s) URL without its fragment (as wakeSnapshotMatchesUrl compares). Null for anything else. */
export function wakeSnapshotUrlKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is WakeSnapshotDiskEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    KEY_PATTERN.test(entry.key) &&
    typeof entry.url === "string" &&
    wakeSnapshotUrlKey(entry.url) !== null &&
    typeof entry.width === "number" &&
    entry.width > 0 &&
    typeof entry.height === "number" &&
    entry.height > 0 &&
    typeof entry.bytes === "number" &&
    entry.bytes > 0 &&
    typeof entry.savedAt === "number" &&
    Number.isFinite(entry.savedAt)
  );
}

/** The manifest's entries, newest first; anything malformed or from another version reads as empty. */
export function parseWakeSnapshotManifest(
  raw: unknown,
): WakeSnapshotDiskEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const value = raw as Record<string, unknown>;
  if (
    value.version !== WAKE_SNAPSHOT_DISK_VERSION ||
    !Array.isArray(value.entries)
  )
    return [];
  const seen = new Set<string>();
  const entries: WakeSnapshotDiskEntry[] = [];
  for (const candidate of value.entries) {
    if (!isEntry(candidate) || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    entries.push({
      key: candidate.key,
      url: candidate.url,
      width: candidate.width,
      height: candidate.height,
      bytes: candidate.bytes,
      savedAt: candidate.savedAt,
    });
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export function serializeWakeSnapshotManifest(
  entries: readonly WakeSnapshotDiskEntry[],
): { version: number; entries: WakeSnapshotDiskEntry[] } {
  return {
    version: WAKE_SNAPSHOT_DISK_VERSION,
    entries: [...entries].sort((a, b) => b.savedAt - a.savedAt),
  };
}

export interface WakeSnapshotDiskPlanOptions {
  now: number;
  maxTotalBytes?: number;
  maxAgeMs?: number;
  /** Only entries with these file keys stay (the pages open somewhere); omit to keep any page. */
  keepKeys?: ReadonlySet<string>;
}

/** Which entries stay and which files go: newest first within the byte cap, nothing expired or from the future. */
export function planWakeSnapshotDisk(
  entries: readonly WakeSnapshotDiskEntry[],
  options: WakeSnapshotDiskPlanOptions,
): { keep: WakeSnapshotDiskEntry[]; drop: WakeSnapshotDiskEntry[] } {
  const maxTotal = options.maxTotalBytes ?? WAKE_SNAPSHOT_DISK_MAX_TOTAL_BYTES;
  const maxAge = options.maxAgeMs ?? WAKE_SNAPSHOT_DISK_MAX_AGE_MS;
  const keep: WakeSnapshotDiskEntry[] = [];
  const drop: WakeSnapshotDiskEntry[] = [];
  let total = 0;
  for (const entry of [...entries].sort((a, b) => b.savedAt - a.savedAt)) {
    const age = options.now - entry.savedAt;
    const wanted =
      wakeSnapshotUrlKey(entry.url) !== null &&
      (!options.keepKeys || options.keepKeys.has(entry.key));
    // A clock that went backwards by more than a minute makes the age meaningless: drop it.
    if (
      !wanted ||
      age > maxAge ||
      age < -60_000 ||
      total + entry.bytes > maxTotal
    ) {
      drop.push(entry);
      continue;
    }
    total += entry.bytes;
    keep.push(entry);
  }
  return { keep, drop };
}
