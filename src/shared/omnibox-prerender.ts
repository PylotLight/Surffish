/**
 * Omnibox prerender: the step past speculative preconnect (shared/preconnect.ts), under the same
 * "Preload pages for faster browsing" setting. When the address bar is sure what Enter will open
 * (the typed text resolves to exactly the URL of a History / Bookmark / Pinned site suggestion, or
 * the user arrowed onto one), main loads that page in a hidden view in the tab's own session, and
 * Enter swaps the view in instead of starting a load.
 *
 * Electron can't use Chromium's own prerendering: its WebContents delegate never opts in
 * (IsPrerender2Supported is "unsupported by WebContents"), so Speculation Rules prerender never
 * starts. The hidden view is the Electron equivalent; it starts from the tab's own back history
 * (navigationHistory.restore), so Back after the swap still goes to the page before.
 *
 * Pure rules live here; main/omnibox-prerender.ts does the Electron work.
 */

/** Suggestion kinds strong enough to prerender. An open tab is switched to, not loaded. */
export const PRERENDER_SOURCES: ReadonlySet<string> = new Set([
  "History",
  "Bookmark",
  "Pinned site",
]);
/** Fewer typed characters than this never prerender (a two-letter exact URL is a fluke). */
export const PRERENDER_MIN_TYPED_CHARS = 3;
/** An unused prerender is dropped after this long. */
export const PRERENDER_MAX_AGE_MS = 60_000;
/** How long a memory-pressure reading is trusted before it's sampled again. */
export const PRERENDER_MEMORY_SAMPLE_MS = 30_000;

/** Path or query words that mean "this GET does something": never load these behind the user's back. */
const UNSAFE_WORDS =
  /(?:^|[/_\-.?&=+])(?:log-?out|log-?off|sign-?out|sign-?off|delete|remove|destroy|unsubscribe|revoke|deactivate|cancel|confirm|checkout|purchase|buy|pay|vote|like|follow|subscribe|reset|disconnect|uninstall|token|oauth|authorize|callback)(?:$|[/_\-.?&=+])/i;
/** File types a navigation would download (or hand to a plugin) instead of showing a page. */
const FILE_EXTENSION =
  /\.(?:zip|dmg|pkg|exe|msi|appx|gz|tgz|bz2|xz|zst|7z|rar|iso|img|apk|deb|rpm|jar|pdf|mp4|mkv|mov|mp3|flac|wav|torrent)$/i;

export type PrerenderSkip = "not-http" | "credentials" | "unsafe" | "file";

/** Why a URL must not be prerendered, or null when it may be. */
export function prerenderUrlSkip(value: string): PrerenderSkip | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "not-http";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "not-http";
  if (url.username || url.password || !url.hostname) return "credentials";
  let path = url.pathname;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    /* keep the raw path */
  }
  if (UNSAFE_WORDS.test(path) || UNSAFE_WORDS.test(url.search)) return "unsafe";
  if (FILE_EXTENSION.test(path)) return "file";
  return null;
}

/** Same document address: parsed and normalized (so `https://a.com` == `https://a.com/`). */
export function sameNavigationUrl(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

export interface OmniboxHint {
  /** What is in the address bar. */
  input: string;
  /** The suggestion the hint is about: the selected row, else the top one. */
  suggestionUrl: string | null;
  suggestionSource: string | null;
  /** What Enter would load for `input` (resolveAddressInput), or null for nothing / a search. */
  resolvedUrl: string | null;
}

/**
 * The URL to prerender for an address-bar hint, or null. Only when Enter is certain to load a page
 * the user already knows: the resolved input is exactly the suggestion's URL, the suggestion comes
 * from History / Bookmarks / Pinned sites, and the URL is a plain page (no sign-out, delete,
 * checkout, OAuth or download style URL).
 */
export function omniboxPrerenderUrl(hint: OmniboxHint): string | null {
  if (hint.input.trim().length < PRERENDER_MIN_TYPED_CHARS) return null;
  if (!hint.suggestionSource || !PRERENDER_SOURCES.has(hint.suggestionSource))
    return null;
  if (
    !hint.resolvedUrl ||
    !sameNavigationUrl(hint.resolvedUrl, hint.suggestionUrl)
  )
    return null;
  if (prerenderUrlSkip(hint.resolvedUrl)) return null;
  return new URL(hint.resolvedUrl).href;
}

export interface PrerenderConditions {
  enabled: boolean;
  isPrivate: boolean;
  onBattery: boolean;
  /** Memory saver's pressure reading says memory is tight. */
  memoryTight: boolean;
  /** Proxy kill switch is holding traffic. */
  proxyBlocking: boolean;
  /** The active tab can take a swapped-in page (a normal site tab, not a PDF editor, extension page or mini window). */
  tabEligible: boolean;
}

export type PrerenderBlock =
  "disabled" | "private" | "battery" | "memory" | "proxy" | "tab";

/** The first reason the conditions rule a prerender out, or null when one may start. */
export function prerenderBlockedBy(
  conditions: PrerenderConditions,
): PrerenderBlock | null {
  if (!conditions.enabled) return "disabled";
  if (conditions.isPrivate) return "private";
  if (!conditions.tabEligible) return "tab";
  if (conditions.proxyBlocking) return "proxy";
  if (conditions.onBattery) return "battery";
  if (conditions.memoryTight) return "memory";
  return null;
}

/**
 * A fingerprint of a tab's back history (URLs up to the current entry). The prerender starts from
 * a copy of it; if it changed by Enter (the page navigated meanwhile), the copy is stale and the
 * prerender is dropped instead of swapping in a page with the wrong Back list.
 */
export function historyFingerprint(
  history: { entries: ReadonlyArray<{ url: string }>; index: number } | null,
): string {
  if (!history || history.index < 0) return "";
  return history.entries
    .slice(0, history.index + 1)
    .map((entry) => entry.url)
    .join("\n");
}
