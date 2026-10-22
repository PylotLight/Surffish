/**
 * Google blocks sign-in from embedded Chromium. Surffish hands Google's sign-in
 * pages to a native WebKit helper and imports the resulting session cookies.
 * Pure helpers live here so they can be unit tested without Electron.
 */

export interface WebKitCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: string;
}

export interface ElectronCookieDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

const SIGN_IN_PATHS = [
  /^\/v3\/signin(\/(identifier|challenge|rejected)[^/]*)?\/?$/i,
  /^\/ServiceLogin/i,
  /^\/signin\/v2\/identifier/i,
  /^\/AccountChooser/i,
  /^\/InteractiveLogin/i,
];

/** Top-level Google sign-in pages that Electron would be rejected on. */
export function isGoogleSignInPage(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "accounts.google.com"
    )
      return false;
    // passive=... is Google's silent "are you still signed in?" bounce; it
    // never shows a form, so let Electron follow it back to the service.
    if (url.searchParams.has("passive")) return false;
    return SIGN_IN_PATHS.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

/**
 * ServiceLogin is a router: with a live session Google bounces straight back
 * to the service, without one it moves on to the identifier page (which is
 * handed off then). So once Electron holds a Google session, let it through.
 */
export function shouldHandOffSignIn(
  value: string,
  hasGoogleSession: boolean,
): boolean {
  if (!isGoogleSignInPage(value)) return false;
  if (!hasGoogleSession) return true;
  try {
    return !/^\/ServiceLogin/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/** Where the tab should go after the session is imported. */
export function signInContinueUrl(value: string): string {
  try {
    const target = new URL(new URL(value).searchParams.get("continue") ?? "");
    if (target.protocol === "https:" && !isGoogleSignInPage(target.toString()))
      return target.toString();
  } catch {
    // fall through
  }
  return "https://www.google.com/";
}

export function isImportableCookieDomain(domain: string): boolean {
  const host = domain.replace(/^\./, "").toLowerCase();
  return (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com")
  );
}

export function toElectronCookie(
  cookie: WebKitCookie,
): ElectronCookieDetails | null {
  if (
    !cookie ||
    typeof cookie.name !== "string" ||
    typeof cookie.value !== "string" ||
    typeof cookie.domain !== "string"
  )
    return null;
  if (!isImportableCookieDomain(cookie.domain)) return null;
  const host = cookie.domain.replace(/^\./, "");
  const path = cookie.path || "/";
  const secure = Boolean(cookie.secure);
  const sameSite = cookie.sameSite?.toLowerCase();
  const details: ElectronCookieDetails = {
    url: `${secure ? "https" : "http"}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure,
    httpOnly: Boolean(cookie.httpOnly),
    sameSite:
      sameSite === "lax" || sameSite === "strict"
        ? sameSite
        : secure
          ? "no_restriction"
          : "unspecified",
  };
  // A leading dot marks a domain cookie; otherwise keep it host-only (required for __Host-).
  if (cookie.domain.startsWith(".") && !cookie.name.startsWith("__Host-"))
    details.domain = cookie.domain;
  if (
    typeof cookie.expirationDate === "number" &&
    Number.isFinite(cookie.expirationDate)
  )
    details.expirationDate = cookie.expirationDate;
  return details;
}

export type HelperMessage =
  | { type: "cookies"; cookies: WebKitCookie[] }
  | { type: "bramble-list"; host: string }
  | { type: "bramble-fill"; id: string };

/** One line the helper wrote on stdout, or null for noise and malformed lines. */
export function parseHelperMessage(line: string): HelperMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as Record<string, unknown>;
  if (message.type === "cookies" && Array.isArray(message.cookies))
    return { type: "cookies", cookies: message.cookies as WebKitCookie[] };
  if (message.type === "bramble-list" && typeof message.host === "string")
    return { type: "bramble-list", host: message.host.toLowerCase() };
  if (
    message.type === "bramble-fill" &&
    typeof message.id === "string" &&
    message.id.length > 0 &&
    message.id.length <= 256
  )
    return { type: "bramble-fill", id: message.id };
  return null;
}

/** Bramble fills only ever answer for Google's own sign-in host. */
export function isBrambleFillHost(host: string): boolean {
  return host === "accounts.google.com";
}

/** Electron top-left window frame as the helper's --frame argument. */
export function helperFrameArgument(
  bounds:
    { x: number; y: number; width: number; height: number } | null | undefined,
): string | null {
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return null;
  return `--frame=${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`;
}
