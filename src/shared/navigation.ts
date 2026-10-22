import { httpFallbackUrl, isLocalOrPrivateHost } from "./https-only";
import type { SearchEngineId } from "./types";
import { SURFFISH_SETTINGS_URL } from "./settings-tab";

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "brave";
export const SURFFISH_QUICK_LINKS_URL = "surffish://quick-links";
export const SEARCH_ENGINES = [
  {
    id: "brave",
    label: "Brave Search",
    searchUrl: "https://search.brave.com/search",
    homeUrl: "https://search.brave.com/",
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    searchUrl: "https://duckduckgo.com/",
    homeUrl: "https://duckduckgo.com/",
  },
  {
    id: "google",
    label: "Google",
    searchUrl: "https://www.google.com/search",
    homeUrl: "https://www.google.com/",
  },
  {
    id: "bing",
    label: "Bing",
    searchUrl: "https://www.bing.com/search",
    homeUrl: "https://www.bing.com/",
  },
] as const satisfies readonly {
  id: SearchEngineId;
  label: string;
  searchUrl: string;
  homeUrl: string;
}[];

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return SEARCH_ENGINES.some((engine) => engine.id === value);
}

export function getSearchHomepage(engineId: SearchEngineId): string {
  return (
    SEARCH_ENGINES.find((engine) => engine.id === engineId)?.homeUrl ??
    SEARCH_ENGINES[0].homeUrl
  );
}

/** Local New Tab and Settings content is rendered by the app, so the absence of a BrowserView does not mean it is sleeping. */
export function isBrowserTabSleeping(
  hasBrowserView: boolean,
  url: string,
): boolean {
  return (
    !hasBrowserView &&
    url !== SURFFISH_QUICK_LINKS_URL &&
    url !== SURFFISH_SETTINGS_URL
  );
}

/** Match direct YouTube destinations without accepting lookalike hostnames. */
export function isYouTubeUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    );
  } catch {
    return false;
  }
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

function isLoopback(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function searchFor(query: string, engineId: SearchEngineId): string {
  const engine =
    SEARCH_ENGINES.find((candidate) => candidate.id === engineId) ??
    SEARCH_ENGINES[0];
  const url = new URL(engine.searchUrl);
  url.searchParams.set("q", query);
  return url.toString();
}

/** Resolve address-bar input without ever allowing a non-HTTP(S) navigation. */
export function resolveNavigationTarget(
  input: string,
  engineId: SearchEngineId = DEFAULT_SEARCH_ENGINE,
): string | null {
  const value = input.trim();
  if (!value) return null;

  const explicitWebScheme = /^https?:/i.test(value);
  const explicitOtherScheme =
    /^(?:[a-z][a-z\d+.-]*):\/\//i.test(value) ||
    /^(?:javascript|data|file|ftp|mailto|about|chrome|view-source):/i.test(
      value,
    );
  if (explicitWebScheme || explicitOtherScheme) {
    try {
      const url = new URL(value);
      if (
        (url.protocol !== "https:" && url.protocol !== "http:") ||
        !url.hostname
      )
        return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  // Whitespace is a strong signal that the user entered a search query.
  if (/\s/.test(value)) return searchFor(value, engineId);

  try {
    const url = new URL(`https://${value}`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const looksLikeAddress =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.includes(".") ||
      isIpv4(host) ||
      host.includes(":");
    if (!looksLikeAddress) return searchFor(value, engineId);
    // Like Chrome: a typed local address (loopback, RFC 1918/CGNAT/link-local IPs, .local/.lan/
    // .home.arpa/.internal names) opens over plain http. LAN devices (routers, NAS, printers)
    // mostly serve http only, and the ones with https redirect there themselves. Public names
    // try https first; the main process falls back to http if that fails (typedHttpsFallbackUrl).
    if (isLoopback(url.hostname) || isLocalOrPrivateHost(url.hostname))
      url.protocol = "http:";
    return url.toString();
  } catch {
    return searchFor(value, engineId);
  }
}

/**
 * When address-bar `input` had no scheme and resolveNavigationTarget gave it https:// (a public
 * host name), the http:// URL to fall back to if the secure connection fails. Null for explicit
 * schemes, searches and anything already http.
 */
export function typedHttpsFallbackUrl(
  input: string,
  resolvedUrl: string,
): string | null {
  const value = input.trim();
  if (
    !value ||
    /\s/.test(value) ||
    /^https?:/i.test(value) ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  )
    return null;
  try {
    const resolved = new URL(resolvedUrl);
    if (resolved.protocol !== "https:") return null;
    if (new URL(`https://${value}`).host !== resolved.host) return null;
  } catch {
    return null;
  }
  return httpFallbackUrl(resolvedUrl);
}

export type PageMadeUrlKind = "blob" | "data";

/**
 * blob: (URL.createObjectURL) and data: URLs a page opens itself: a link click, target=_blank or
 * window.open. Never from the address bar (resolveNavigationTarget still refuses them there).
 * Chromium keeps its own rules on top: a blob only resolves in the storage partition (and opener)
 * that made it, and page-initiated top-level data: documents are blocked unless they download.
 * Only blobs minted by a web or local-file page count; opaque-origin blobs (blob:null/...) don't.
 */
export function pageMadeUrlKind(input: string): PageMadeUrlKind | null {
  if (/^data:/i.test(input)) return "data";
  if (!/^blob:/i.test(input)) return null;
  try {
    const inner = new URL(input.slice("blob:".length));
    return inner.protocol === "https:" ||
      inner.protocol === "http:" ||
      inner.protocol === "file:"
      ? "blob"
      : null;
  } catch {
    return null;
  }
}
