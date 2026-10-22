import { urlHostname } from "./url-host";

/**
 * Navigation results and friendly copy for Chromium net errors.
 *
 * Main reports load failures as `tab.error` strings in a few shapes: did-fail-load's
 * `ERR_NAME_NOT_RESOLVED (-105)`, loadURL's `ERR_NAME_NOT_RESOLVED (-105) loading 'https://…'`,
 * or a bare `net::ERR_…`. Everything here is pure so it can be unit tested.
 */

/** Chromium's net::ERR_ABORTED: the navigation was superseded (redirect, history replace, a new load). */
export const NET_ERR_ABORTED = -3;

/** What `browser:navigate` resolves to. */
export type NavigateResult =
  | { ok: true }
  /** The input isn't a loadable address or search terms (javascript:, file:, empty…). */
  | { ok: false; reason: "invalid" }
  /** The user kept the current page (e.g. unsaved PDF edits) or there was no tab to load into. */
  | { ok: false; reason: "cancelled" }
  /** The page failed to load; the tab's error state carries the details. */
  | { ok: false; reason: "load"; code: number | null; message: string };

/** Load-error details published with the active tab's state. */
export interface BrowserLoadError {
  /** Chromium net error code (negative), when known. */
  code: number | null;
  /** `ERR_…` name, when known. */
  name: string | null;
  /** The address that failed (used for Retry). */
  url: string;
  /** A proxy route applies to `url` right now (per-site routing included). */
  viaProxy: boolean;
  /** The main-frame load failed: show the in-page error (the toast is only for pages that stayed loaded). */
  fullPage: boolean;
  /** The failed load never committed and this page is still underneath (offer to go back to it). */
  pageBehind?: string | null;
}

export type LoadErrorKind =
  | "dns"
  | "refused"
  | "timeout"
  | "connection"
  | "offline"
  | "proxy"
  | "certificate"
  | "secure-connection"
  | "redirects"
  | "blocked"
  | "not-found"
  | "generic";

export interface LoadErrorCopy {
  kind: LoadErrorKind;
  title: string;
  detail: string;
  /** The copy talks about the proxy/tunnel. */
  mentionsProxy: boolean;
  /** Short code label for the notice, e.g. `ERR_NAME_NOT_RESOLVED`. Empty when unknown. */
  codeLabel: string;
}

const NAMES_BY_CODE: Record<number, string> = {
  [-2]: "ERR_FAILED",
  [-3]: "ERR_ABORTED",
  [-6]: "ERR_FILE_NOT_FOUND",
  [-7]: "ERR_TIMED_OUT",
  [-20]: "ERR_BLOCKED_BY_CLIENT",
  [-21]: "ERR_NETWORK_CHANGED",
  [-22]: "ERR_BLOCKED_BY_ADMINISTRATOR",
  [-27]: "ERR_BLOCKED_BY_RESPONSE",
  [-100]: "ERR_CONNECTION_CLOSED",
  [-101]: "ERR_CONNECTION_RESET",
  [-102]: "ERR_CONNECTION_REFUSED",
  [-103]: "ERR_CONNECTION_ABORTED",
  [-104]: "ERR_CONNECTION_FAILED",
  [-105]: "ERR_NAME_NOT_RESOLVED",
  [-106]: "ERR_INTERNET_DISCONNECTED",
  [-107]: "ERR_SSL_PROTOCOL_ERROR",
  [-109]: "ERR_ADDRESS_UNREACHABLE",
  [-111]: "ERR_TUNNEL_CONNECTION_FAILED",
  [-113]: "ERR_SSL_VERSION_OR_CIPHER_MISMATCH",
  [-118]: "ERR_CONNECTION_TIMED_OUT",
  [-120]: "ERR_SOCKS_CONNECTION_FAILED",
  [-121]: "ERR_SOCKS_CONNECTION_HOST_UNREACHABLE",
  [-130]: "ERR_PROXY_CONNECTION_FAILED",
  [-137]: "ERR_NAME_RESOLUTION_FAILED",
  [-200]: "ERR_CERT_COMMON_NAME_INVALID",
  [-201]: "ERR_CERT_DATE_INVALID",
  [-202]: "ERR_CERT_AUTHORITY_INVALID",
  [-310]: "ERR_TOO_MANY_REDIRECTS",
  [-324]: "ERR_EMPTY_RESPONSE",
};

const CODES_BY_NAME = new Map(
  Object.entries(NAMES_BY_CODE).map(([code, name]) => [name, Number(code)]),
);

/** Pull the net error code/name out of a tab error string or a loadURL rejection message. */
export function parseLoadError(message: string | null | undefined): {
  code: number | null;
  name: string | null;
} {
  const text = typeof message === "string" ? message : "";
  const nameMatch = /\b(ERR_[A-Z0-9_]+)\b/.exec(text);
  const codeMatch = /\((-\d{1,4})\)/.exec(text);
  let name = nameMatch?.[1] ?? null;
  let code = codeMatch ? Number(codeMatch[1]) : null;
  if (code === null && name) code = CODES_BY_NAME.get(name) ?? null;
  if (name === null && code !== null) name = NAMES_BY_CODE[code] ?? null;
  return { code, name };
}

/** A loadURL rejection (or did-fail-load code) that only means the navigation was superseded. */
export function isAbortedNavigation(error: unknown): boolean {
  if (error === NET_ERR_ABORTED) return true;
  if (typeof error === "object" && error !== null) {
    const record = error as {
      errno?: unknown;
      code?: unknown;
      message?: unknown;
    };
    if (record.errno === NET_ERR_ABORTED || record.code === "ERR_ABORTED")
      return true;
    if (typeof record.message === "string")
      return parseLoadError(record.message).name === "ERR_ABORTED";
    return false;
  }
  return (
    typeof error === "string" && parseLoadError(error).name === "ERR_ABORTED"
  );
}

function kindFor(code: number | null, name: string | null): LoadErrorKind {
  const n = name ?? "";
  if (n === "ERR_NAME_NOT_RESOLVED" || n === "ERR_NAME_RESOLUTION_FAILED")
    return "dns";
  if (n === "ERR_CONNECTION_REFUSED") return "refused";
  if (n === "ERR_TIMED_OUT" || n === "ERR_CONNECTION_TIMED_OUT")
    return "timeout";
  if (
    n === "ERR_INTERNET_DISCONNECTED" ||
    n === "ERR_NETWORK_CHANGED" ||
    n === "ERR_ADDRESS_UNREACHABLE"
  )
    return "offline";
  if (
    n.startsWith("ERR_SOCKS_") ||
    n.startsWith("ERR_PROXY_") ||
    n === "ERR_TUNNEL_CONNECTION_FAILED" ||
    n === "ERR_MANDATORY_PROXY_CONFIGURATION_FAILED"
  )
    return "proxy";
  if (
    n.startsWith("ERR_CERT_") ||
    (code !== null && code <= -200 && code > -300)
  )
    return "certificate";
  if (n.startsWith("ERR_SSL_") || n === "ERR_BAD_SSL_CLIENT_AUTH_CERT")
    return "secure-connection";
  if (n === "ERR_TOO_MANY_REDIRECTS") return "redirects";
  if (n.startsWith("ERR_BLOCKED_BY_")) return "blocked";
  if (n === "ERR_FILE_NOT_FOUND") return "not-found";
  if (
    [
      "ERR_CONNECTION_RESET",
      "ERR_CONNECTION_CLOSED",
      "ERR_CONNECTION_ABORTED",
      "ERR_CONNECTION_FAILED",
      "ERR_EMPTY_RESPONSE",
    ].includes(n)
  )
    return "connection";
  return "generic";
}

const PROXY_HINT =
  "This site goes through your proxy, so check the tunnel too.";

/**
 * Friendly copy for a load error. Only mentions the proxy when a proxy route actually applies
 * to the URL (`viaProxy`) or the error itself is about the proxy.
 */
export function describeLoadError(input: {
  code?: number | null;
  name?: string | null;
  message?: string | null;
  url?: string | null;
  viaProxy?: boolean;
}): LoadErrorCopy {
  const parsed = parseLoadError(input.message);
  const code = input.code ?? parsed.code;
  const name =
    input.name ??
    parsed.name ??
    (code !== null ? (NAMES_BY_CODE[code] ?? null) : null);
  const host = urlHostname(input.url);
  const site = host || "the site";
  const viaProxy = input.viaProxy === true;
  const kind = kindFor(code, name);
  const codeLabel = name ?? (code !== null ? `Error ${code}` : "");
  const withProxy = (
    detail: string,
  ): { detail: string; mentionsProxy: boolean } =>
    viaProxy
      ? { detail: `${detail} ${PROXY_HINT}`, mentionsProxy: true }
      : { detail, mentionsProxy: false };
  const copy = (
    title: string,
    detail: string,
    proxyAware = true,
  ): LoadErrorCopy => {
    const resolved = proxyAware
      ? withProxy(detail)
      : { detail, mentionsProxy: false };
    return {
      kind,
      title,
      detail: resolved.detail,
      mentionsProxy: resolved.mentionsProxy,
      codeLabel,
    };
  };
  switch (kind) {
    case "dns":
      return copy(
        "Can’t find that site",
        `${host ? `${host} didn’t resolve` : "That address didn’t resolve"}. Check the spelling, or the site may be down.`,
      );
    case "refused":
      return copy(
        `${site} refused to connect`,
        "The site isn’t accepting connections right now.",
      );
    case "timeout":
      return copy(
        `${site} took too long to respond`,
        "The connection timed out. Try again in a moment.",
      );
    case "connection":
      return copy(
        "The connection dropped",
        `The connection to ${site} was interrupted before the page loaded.`,
      );
    case "offline":
      return copy(
        "You’re offline",
        "Check your internet connection, then try again.",
        false,
      );
    case "proxy":
      return {
        kind,
        title: "Can’t reach the proxy",
        detail:
          "This page goes through your proxy and it didn’t answer. Check the tunnel, or route this site Direct.",
        mentionsProxy: true,
        codeLabel,
      };
    case "certificate":
      return copy(
        "This connection isn’t private",
        `${site}’s security certificate isn’t valid, so Surffish didn’t open it.`,
        false,
      );
    case "secure-connection":
      return copy(
        "Couldn’t connect securely",
        `${site} doesn’t support a secure connection Surffish trusts.`,
        false,
      );
    case "redirects":
      return copy(
        `${site} redirected too many times`,
        "Clearing the site’s cookies sometimes fixes this.",
        false,
      );
    case "blocked":
      return viaProxy
        ? {
            kind,
            title: "This page was blocked",
            detail:
              "The proxy kill switch, an ad-block filter, or a site rule stopped it.",
            mentionsProxy: true,
            codeLabel,
          }
        : copy(
            "This page was blocked",
            "An ad-block filter or a site rule stopped it.",
            false,
          );
    case "not-found":
      return copy(
        "File not found",
        "It may have been moved, renamed, or deleted.",
        false,
      );
    default:
      return copy(
        "Couldn’t open this page",
        `${host ? `${host} didn’t load.` : "The page didn’t load."}`,
      );
  }
}

/** Shown only when the address bar input itself can't be opened. */
export const INVALID_ADDRESS_COPY = {
  title: "That address can’t be opened",
  detail: "Use an HTTP(S) address or search terms.",
} as const;

/** Main-frame errors that leave an empty error page behind (worth an in-page error view). */
export function shouldShowFullPageError(code: number | null): boolean {
  // ERR_ABORTED is a superseded load; ERR_FAILED is often a download hand-off (cleared a beat later).
  return code !== null && code !== NET_ERR_ABORTED && code !== -2;
}
