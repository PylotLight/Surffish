import { normalizeSessionUrl } from "./persistence";

/**
 * Each tab's back/forward list in the saved session, so a restart keeps Back/Forward (and the
 * hold-Back menu) working on restored tabs, as Chrome's session restore does. A restored tab wakes
 * through navigationHistory.restore() with these entries, so its scroll position and form values
 * (each entry's Chromium page state) come back too.
 *
 * Only what can be loaded again is kept: http(s) entries with the same credential/secret scrubbing
 * as the tab URLs (normalizeSessionUrl), never blob:/data:/file: or internal pages. Private tabs
 * never get here (main skips them, like their URLs).
 */

/** Chromium's own back/forward cap (NavigationController's default max entry count). */
export const MAX_SAVED_HISTORY_ENTRIES = 50;
/** Forward entries kept when the list is over the cap (the rest of the room goes to Back). */
export const MAX_SAVED_FORWARD_ENTRIES = 10;
/** A page state over this (a huge form, a page stuffing history.state) is dropped; the entry stays. */
export const MAX_SAVED_PAGE_STATE_CHARS = 64 * 1024;
const MAX_SAVED_TITLE_CHARS = 300;
/**
 * Every tab's history together (JSON chars). Over it, page states go first (largest tabs first),
 * then whole lists; the tab URLs themselves are never affected.
 */
export const MAX_SAVED_SESSION_HISTORY_CHARS = 2 * 1024 * 1024;

export interface SavedHistoryEntry {
  url: string;
  title: string;
  /** Chromium page state (scroll position, form values) for exactly this URL. */
  pageState?: string;
}

export interface SavedTabHistory {
  entries: SavedHistoryEntry[];
  index: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanTitle(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, MAX_SAVED_TITLE_CHARS)
    : "";
}

/**
 * A tab's back/forward list as saved: restorable entries only, at most MAX_SAVED_HISTORY_ENTRIES
 * around the current one, oversized page states stripped. Null when there is nothing worth saving
 * (no list, the current entry can't be restored or isn't `tabUrl`, or a single entry with no state:
 * a plain load does the same). Reads untrusted input (the session file) as well as live captures.
 */
export function normalizeTabHistory(
  value: unknown,
  tabUrl: string,
): SavedTabHistory | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.entries) ||
    typeof value.index !== "number" ||
    !Number.isInteger(value.index)
  )
    return null;
  const raw = value.entries;
  if (value.index < 0 || value.index >= raw.length) return null;
  // Look at a bounded slice only (Chromium never has more than 50; an edited file might).
  const from = Math.max(0, value.index - MAX_SAVED_HISTORY_ENTRIES);
  const to = Math.min(raw.length, value.index + MAX_SAVED_HISTORY_ENTRIES + 1);
  const entries: SavedHistoryEntry[] = [];
  let index = -1;
  for (let at = from; at < to; at += 1) {
    const item: unknown = raw[at];
    const isCurrent = at === value.index;
    const record = isRecord(item) ? item : null;
    const url = record ? normalizeSessionUrl(record.url) : null;
    if (!url || !record) {
      if (isCurrent) return null;
      continue;
    }
    const entry: SavedHistoryEntry = { url, title: cleanTitle(record.title) };
    // Page state belongs to the exact URL it was recorded for; a scrubbed URL drops it.
    if (
      typeof record.pageState === "string" &&
      record.pageState.length > 0 &&
      record.pageState.length <= MAX_SAVED_PAGE_STATE_CHARS &&
      url === record.url
    )
      entry.pageState = record.pageState;
    const last = entries[entries.length - 1];
    // Entries that differed only in a #fragment (or a scrubbed secret) are one page now: keep one,
    // the current one if it's either, else the newer.
    if (last && last.url === url) {
      if (index === entries.length - 1) continue;
      entries[entries.length - 1] = entry;
    } else {
      entries.push(entry);
    }
    if (isCurrent) index = entries.length - 1;
  }
  if (index < 0 || entries[index]!.url !== tabUrl) return null;
  const forward = Math.min(
    entries.length - 1 - index,
    MAX_SAVED_FORWARD_ENTRIES,
  );
  const start = Math.max(0, index - (MAX_SAVED_HISTORY_ENTRIES - 1 - forward));
  const kept = entries.slice(
    start,
    Math.min(entries.length, start + MAX_SAVED_HISTORY_ENTRIES),
  );
  if (kept.length < 2 && !kept[0]?.pageState) return null;
  return { entries: kept, index: index - start };
}

function historyChars(history: SavedTabHistory | null | undefined): number {
  return history ? JSON.stringify(history).length : 0;
}

function withoutPageStates(
  history: SavedTabHistory,
  keepCurrent: boolean,
): SavedTabHistory {
  return {
    index: history.index,
    entries: history.entries.map((entry, at) =>
      keepCurrent && at === history.index && entry.pageState !== undefined
        ? { ...entry }
        : { url: entry.url, title: entry.title },
    ),
  };
}

/**
 * Keep every tab's history together under `maxChars`: strip the back/forward entries' page states
 * (largest lists first), then the current entries' too, then drop whole lists, largest first.
 * Same order and length out as in; untouched lists are passed through as they are.
 */
export function capSessionHistories(
  histories: ReadonlyArray<SavedTabHistory | null>,
  maxChars = MAX_SAVED_SESSION_HISTORY_CHARS,
): Array<SavedTabHistory | null> {
  const out = histories.slice();
  const sizes = out.map(historyChars);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= maxChars) return out;
  const largestFirst = out
    .map((_history, at) => at)
    .filter((at) => out[at])
    .sort((a, b) => sizes[b]! - sizes[a]!);
  const pass = (
    shrink: (history: SavedTabHistory) => SavedTabHistory | null,
  ): void => {
    for (const at of largestFirst) {
      if (total <= maxChars) return;
      const history = out[at];
      if (!history) continue;
      const next = shrink(history);
      const size = historyChars(next);
      total += size - sizes[at]!;
      sizes[at] = size;
      out[at] = next;
    }
  };
  pass((history) => withoutPageStates(history, true));
  pass((history) => withoutPageStates(history, false));
  pass(() => null);
  return out;
}

/**
 * What a history clear takes out of open tabs' back/forward lists (Clear browsing data → History,
 * History → Clear, Forget This Site with history), as Chrome's navigation entry remover does:
 * 'all' for every entry, else the entries whose URL the test matches. The current entry always
 * stays (Chrome can't delete it either), so the tab keeps showing its page.
 */
export type TabHistoryForget = "all" | ((url: string) => boolean);

/** Indexes to remove from a live tab's list (navigationHistory.removeEntryAtIndex), highest first so earlier ones don't shift. */
export function forgottenEntryIndexes(
  urls: readonly string[],
  activeIndex: number,
  forget: TabHistoryForget,
): number[] {
  const out: number[] = [];
  for (let at = urls.length - 1; at >= 0; at -= 1) {
    if (at === activeIndex) continue;
    if (forget === "all" || forget(urls[at]!)) out.push(at);
  }
  return out;
}

/**
 * A saved list (sleeping or restored tab, not loaded yet) with the forgotten entries removed and
 * the index moved to follow the current one. Null when there was no list or its index is bad.
 */
export function forgetTabHistoryEntries<T extends { url: string }>(
  history: { entries: readonly T[]; index: number } | null | undefined,
  forget: TabHistoryForget,
): { entries: T[]; index: number } | null {
  if (
    !history ||
    !Number.isInteger(history.index) ||
    history.index < 0 ||
    history.index >= history.entries.length
  )
    return null;
  const drop = new Set(
    forgottenEntryIndexes(
      history.entries.map((entry) => entry.url),
      history.index,
      forget,
    ),
  );
  if (drop.size === 0)
    return { entries: history.entries.slice(), index: history.index };
  const entries: T[] = [];
  let index = 0;
  history.entries.forEach((entry, at) => {
    if (drop.has(at)) return;
    if (at === history.index) index = entries.length;
    entries.push(entry);
  });
  return { entries, index };
}

function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

/** Matches back/forward entries for the visits a time-range clear removed (by URL, ignoring #fragments). */
export function visitedUrlMatcher(
  urls: Iterable<string>,
): (url: string) => boolean {
  const set = new Set<string>();
  for (const url of urls) if (url) set.add(withoutFragment(url));
  return (url) => set.has(withoutFragment(url));
}

/** Matches back/forward entries on one host (Forget This Site), like its history removal. */
export function hostUrlMatcher(host: string): (url: string) => boolean {
  const wanted = host.toLowerCase();
  return (url) => {
    try {
      return new URL(url).hostname.toLowerCase() === wanted;
    } catch {
      return false;
    }
  };
}
