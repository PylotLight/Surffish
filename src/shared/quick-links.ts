import type { BrowsingHistoryEntry, PinnedSite } from "./types";
import { normalizeHttpOrigin } from "./persistence.ts";

export const MAX_FREQUENT_SITES = 8;

export interface QuickLinkSite {
  title: string;
  url: string;
  origin: string;
  faviconUrl?: string;
}

/** Frequently visited sites are derived only from the browser's locally stored history. */
export function buildFrequentSites(
  history: readonly BrowsingHistoryEntry[],
  pinnedSites: readonly PinnedSite[],
  limit = MAX_FREQUENT_SITES,
): QuickLinkSite[] {
  const pinnedOrigins = new Set(
    pinnedSites
      .map((site) => normalizeHttpOrigin(site.url))
      .filter((origin): origin is string => origin !== null),
  );
  const byOrigin = new Map<
    string,
    { count: number; newestVisit: number; title: string; faviconUrl?: string }
  >();

  for (const entry of history) {
    const origin = normalizeHttpOrigin(entry.url);
    if (!origin || pinnedOrigins.has(origin)) continue;
    const current = byOrigin.get(origin);
    if (current) {
      current.count += 1;
      if (entry.visitedAt > current.newestVisit) {
        current.newestVisit = entry.visitedAt;
        if (entry.title.trim()) current.title = entry.title.trim();
      }
      if (!current.faviconUrl && entry.faviconUrl)
        current.faviconUrl = entry.faviconUrl;
    } else {
      byOrigin.set(origin, {
        count: 1,
        newestVisit: entry.visitedAt,
        title: entry.title.trim() || new URL(origin).hostname,
        ...(entry.faviconUrl ? { faviconUrl: entry.faviconUrl } : {}),
      });
    }
  }

  const safeLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(MAX_FREQUENT_SITES, Math.floor(limit)))
    : MAX_FREQUENT_SITES;
  return [...byOrigin.entries()]
    .sort(
      ([originA, a], [originB, b]) =>
        b.count - a.count ||
        b.newestVisit - a.newestVisit ||
        originA.localeCompare(originB),
    )
    .slice(0, safeLimit)
    .map(([origin, site]) => ({
      title: site.title || new URL(origin).hostname,
      url: origin,
      origin,
      ...(site.faviconUrl ? { faviconUrl: site.faviconUrl } : {}),
    }));
}

export function toQuickLinkSite(site: PinnedSite): QuickLinkSite | null {
  const origin = normalizeHttpOrigin(site.url);
  if (!origin) return null;
  return {
    title: site.title.trim() || new URL(origin).hostname,
    url: origin,
    origin,
    ...(site.faviconUrl ? { faviconUrl: site.faviconUrl } : {}),
  };
}
