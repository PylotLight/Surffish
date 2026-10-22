import { displayHost } from "./url-host";

/**
 * Reading List: pages saved to look at later. Not bookmarks: an item is something to get through
 * (unread → read), it sits in one flat list newest first, and saving a page you already saved moves
 * it back to the top as unread instead of making a second copy (Safari/Orion behaviour).
 *
 * Pure helpers shared by main (store, IPC validation) and the toolbar popover. No Electron here.
 */

export interface ReadingListItem {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  /** og:site_name or similar when the page gave one; the popover falls back to the host. */
  siteName: string | null;
  excerpt: string | null;
  /** ms when the user saved it (or last re-saved it). */
  addedAt: number;
  /** ms when it was opened / marked read; null = unread. */
  readAt: number | null;
  /** A Reader copy is saved on this device (open it offline). */
  hasSnapshot: boolean;
}

export interface ReadingListSnapshot {
  items: ReadingListItem[];
  unread: number;
}

export interface ReadingListInput {
  url: string;
  title?: string;
  faviconUrl?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
}

export type ReadingListFilter = "unread" | "all";

export const READING_LIST_MAX_ITEMS = 5_000;
export const READING_LIST_TITLE_MAX = 500;
export const READING_LIST_EXCERPT_MAX = 400;
export const READING_LIST_SITE_MAX = 120;
export const READING_LIST_URL_MAX = 8_192;
/** A removed item's tombstone is kept this long so the delete can reach a sync peer. */
export const READING_LIST_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The page address to save, or null when it isn't a web page (about:, file:, data:, the New Tab…). */
export function normalizeReadingListUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > READING_LIST_URL_MAX) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    // Credentials in a saved link would sit in the database (and sync) in plain text.
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Two addresses are "the same page" when they differ only in the fragment or a trailing slash on
 * the path, or http vs https. Used for de-duplication, never stored.
 */
export function readingListKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function cleanFavicon(value: unknown): string | null {
  if (typeof value !== "string" || value.length > READING_LIST_URL_MAX)
    return null;
  // data: favicons are fine to keep (small, no tracking); anything else must be http(s).
  if (
    /^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml);/i.test(
      value,
    )
  )
    return value.length <= 64_000 ? value : null;
  return normalizeReadingListUrl(value);
}

export type SanitizedReadingListInput = {
  url: string;
  title: string;
  faviconUrl: string | null;
  siteName: string | null;
  excerpt: string | null;
};

/** Validate untrusted input (IPC, a page's metadata). Null when there's nothing saveable. */
export function sanitizeReadingListInput(
  input: unknown,
): SanitizedReadingListInput | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  const url = normalizeReadingListUrl(record.url);
  if (!url) return null;
  return {
    url,
    title: cleanText(record.title, READING_LIST_TITLE_MAX) ?? "",
    faviconUrl: cleanFavicon(record.faviconUrl),
    siteName: cleanText(record.siteName, READING_LIST_SITE_MAX),
    excerpt: cleanText(record.excerpt, READING_LIST_EXCERPT_MAX),
  };
}

/** Newest first; ties by id so the order is stable across devices. */
export function compareReadingListItems(
  a: Pick<ReadingListItem, "addedAt" | "id">,
  b: Pick<ReadingListItem, "addedAt" | "id">,
): number {
  if (a.addedAt !== b.addedAt) return b.addedAt - a.addedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The list as shown: newest first, one entry per page (a page saved on two devices before they
 * synced shows once: the newest save wins, and it counts as read only if every copy was read).
 */
export function dedupeReadingList(
  items: readonly ReadingListItem[],
): ReadingListItem[] {
  const sorted = [...items].sort(compareReadingListItems);
  const seen = new Map<string, ReadingListItem>();
  const result: ReadingListItem[] = [];
  for (const item of sorted) {
    const key = readingListKey(item.url);
    const kept = seen.get(key);
    if (kept) {
      if (item.readAt === null && kept.readAt !== null) {
        const index = result.indexOf(kept);
        const merged = { ...kept, readAt: null };
        result[index] = merged;
        seen.set(key, merged);
      }
      continue;
    }
    seen.set(key, item);
    result.push(item);
  }
  return result;
}

export function countUnread(
  items: readonly Pick<ReadingListItem, "readAt">[],
): number {
  let count = 0;
  for (const item of items) if (item.readAt === null) count += 1;
  return count;
}

/** The site label for a saved link (hostname without "www."). */
export const readingListHost = displayHost;

/** Unread or all, then a case-insensitive match on title, site, host, URL and excerpt (every word must match). */
export function filterReadingList(
  items: readonly ReadingListItem[],
  filter: ReadingListFilter,
  query = "",
): ReadingListItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (filter === "unread" && item.readAt !== null) return false;
    if (words.length === 0) return true;
    const haystack =
      `${item.title}\n${item.siteName ?? ""}\n${readingListHost(item.url)}\n${item.url}\n${item.excerpt ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** "now", "5m", "3h", "2d", "Oct 3" / "Oct 3, 2025": compact age for a list row. */
export function readingListAge(
  addedAt: number,
  now: number = Date.now(),
): string {
  const seconds = Math.max(0, Math.round((now - addedAt) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(addedAt);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

/** The toolbar badge: nothing at 0, "99+" past 99. */
export function readingListBadge(unread: number): string {
  if (!Number.isFinite(unread) || unread <= 0) return "";
  return unread > 99 ? "99+" : String(Math.floor(unread));
}

/** Whether a tab's page can be saved: a real web page in a normal (non-private) tab. */
export function canSaveToReadingList(
  page: { url: string; private?: boolean } | null | undefined,
): boolean {
  return Boolean(page && !page.private && normalizeReadingListUrl(page.url));
}

/** Page metadata collected in the page (isolated world) when saving the current tab. */
export const READING_LIST_META_SCRIPT = `(() => {
  const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || ''
  return {
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    excerpt: meta('meta[name="description"]') || meta('meta[property="og:description"]') || meta('meta[name="twitter:description"]'),
    title: meta('meta[property="og:title"]')
  }
})()`;
