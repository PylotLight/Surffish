import type {
  BrowserTabSummary,
  BrowsingHistoryEntry,
  PinnedSite,
} from "./types";
import { displayHost } from "./url-host";

export type AddressSuggestionSource =
  "Pinned site" | "Bookmark" | "Open tab" | "History";

export interface AddressSuggestion {
  title: string;
  url: string;
  source: AddressSuggestionSource;
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Suggestions are resolved from local browser data only; no keystrokes leave the device. */
export function buildAddressSuggestions(
  input: string,
  pinnedSites: readonly PinnedSite[],
  tabs: ReadonlyArray<Pick<BrowserTabSummary, "title" | "url">>,
  history: readonly BrowsingHistoryEntry[],
  limit = 7,
  bookmarks: ReadonlyArray<{ title: string; url: string }> = [],
): AddressSuggestion[] {
  const query = input.trim().toLocaleLowerCase();
  if (!query || limit < 1) return [];

  const candidates: AddressSuggestion[] = [
    ...pinnedSites.map((site) => ({
      title: site.title,
      url: site.url,
      source: "Pinned site" as const,
    })),
    // Bookmarks rank above open tabs and history.
    ...bookmarks.map((bookmark) => ({
      title: bookmark.title,
      url: bookmark.url,
      source: "Bookmark" as const,
    })),
    ...tabs.map((tab) => ({
      title: tab.title,
      url: tab.url,
      source: "Open tab" as const,
    })),
    ...history.map((entry) => ({
      title: entry.title,
      url: entry.url,
      source: "History" as const,
    })),
  ];
  const seen = new Set<string>();
  const matches: AddressSuggestion[] = [];

  for (const candidate of candidates) {
    const url = normalizedUrl(candidate.url);
    if (!url || seen.has(url)) continue;
    const haystack =
      `${candidate.title} ${candidate.url} ${displayHost(candidate.url)}`.toLocaleLowerCase();
    if (!haystack.includes(query)) continue;
    matches.push({ ...candidate, url });
    seen.add(url);
    if (matches.length >= limit) break;
  }
  return matches;
}

/** Where an address bar's suggestions come from: the window's open tabs, local history and bookmarks. */
export interface OmniboxSuggestionSources {
  tabs: ReadonlyArray<{ title: string; url: string }>;
  history: readonly BrowsingHistoryEntry[];
  bookmarks: ReadonlyArray<{ title: string; url: string }>;
}

/**
 * An address bar's dropdown rows for `query`: the toolbar omnibox and the mini window's address field
 * both ask this (favourites rank first through bookmarks, in tree order, so no separate pinned list).
 */
export function omniboxSuggestions(
  query: string,
  sources: OmniboxSuggestionSources,
  limit = 7,
): AddressSuggestion[] {
  return buildAddressSuggestions(
    query,
    [],
    sources.tabs,
    sources.history,
    limit,
    sources.bookmarks,
  );
}
