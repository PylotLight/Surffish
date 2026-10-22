/**
 * Ad-blocker toolbar button (uBlock Origin-style popup): what the ad filter blocked on the tab's
 * current page, per domain, and the per-site on/off switch (BrowserSiteSettings.blockAds, the same
 * switch as Settings → This site). Pure helpers only; main/adblock-stats.ts counts and serves.
 */

export interface AdblockHostCount {
  host: string;
  count: number;
}

/** What the toolbar popover shows for one tab. */
export interface AdblockPageInfo {
  tabId: string;
  /** The page's http(s) origin, the key of the per-site switch; null on non-web pages (New Tab, settings). */
  origin: string | null;
  host: string;
  /** Blocking is on for this site (BrowserSiteSettings.blockAds). */
  enabled: boolean;
  /** Requests blocked on the current page load (network filter: cancelled or redirected to a stub). */
  blocked: number;
  /** Blocked requests by domain, most first. */
  hosts: AdblockHostCount[];
}

/** tabId → blocked count on its current page (pushed to the toolbar, throttled). */
export type AdblockCounts = Record<string, number>;

/** Domains kept per page; a page that trips more than this lumps the rest under "other". */
export const MAX_TRACKED_HOSTS = 200;
export const OTHER_HOSTS = "other";
/** Domains the popover lists. */
export const POPOVER_HOST_LIMIT = 50;

/** The ad filter's answer blocks the request: cancelled, or redirected to a neutered stub (uBO counts both). */
export function isBlockedResponse(
  response: { cancel?: boolean; redirectURL?: string } | null | undefined,
): boolean {
  return Boolean(
    response &&
    (response.cancel === true ||
      (typeof response.redirectURL === "string" &&
        response.redirectURL !== "")),
  );
}

/** The domain a blocked request went to (`www.` dropped, like the popover shows it). */
export function requestHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/** Blocked requests on one page load, by domain. */
export class BlockedRequestTally {
  total = 0;
  private readonly hosts = new Map<string, number>();

  record(url: string): void {
    this.total += 1;
    let host = requestHost(url) || OTHER_HOSTS;
    if (!this.hosts.has(host) && this.hosts.size >= MAX_TRACKED_HOSTS)
      host = OTHER_HOSTS;
    this.hosts.set(host, (this.hosts.get(host) ?? 0) + 1);
  }

  /** Domains, most blocked first (ties by name), at most `limit`. */
  top(limit = POPOVER_HOST_LIMIT): AdblockHostCount[] {
    return Array.from(this.hosts, ([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
      .slice(0, Math.max(0, limit));
  }
}

/** Toolbar badge text: nothing for 0, the number up to 999, then 999+. */
export function adblockBadge(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 999 ? "999+" : String(Math.floor(count));
}

/** The button's tooltip / accessible name. */
export function adblockButtonLabel(info: {
  enabled: boolean;
  blocked: number;
  host?: string;
  web: boolean;
}): string {
  if (!info.web) return "Ad blocker";
  if (!info.enabled) return `Ad blocker: off on ${info.host || "this site"}`;
  const n = Math.max(0, Math.floor(info.blocked));
  return `Ad blocker: ${n} request${n === 1 ? "" : "s"} blocked on this page`;
}
