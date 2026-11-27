/**
 * Pure helpers for handing a login to the native WebKit helper. TorBox is the first site: its
 * Cloudflare Turnstile challenge is rejected in Chromium but passes in WebKit (Orion ground truth),
 * so the login happens in WKWebView and its cookies are imported back into the browser session.
 */

export const TORBOX_LOGIN_URL = "https://www.torbox.app/login";
export const TORBOX_COOKIE_DOMAIN = "torbox.app";

/** A TorBox login page — the only navigation worth interrupting for the helper. */
export function isTorBoxLoginUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host !== "torbox.app" && !host.endsWith(".torbox.app")) return false;
    // TorBox's SPA has shipped /login, /login/ and /login.<ext> over time; a redirect can also add
    // a trailing slash. Match the whole family, but not /logins or an unrelated path.
    const path = url.pathname.toLowerCase();
    return (
      path === "/login" ||
      path.startsWith("/login/") ||
      /^\/login\.[a-z0-9]+$/.test(path) ||
      path === "/auth/login" ||
      path === "/signin" ||
      path === "/sign-in"
    );
  } catch {
    return false;
  }
}

/**
 * Cloudflare clearance/load-balancing and analytics cookies are not proof the user signed in: the
 * helper test leaves those behind even when the login page is still showing. Anything else in the
 * TorBox cookie jar is treated as a session cookie.
 */
export function isTorBoxSessionCookie(name: string): boolean {
  return !/^(?:cf_|__cf|_ga|_gid|_fbp|_fbc|hjid|_gcl|fk|AMP_)/i.test(name);
}

/** Any page on TorBox — used to notice a navigation that may need the WebKit helper. */
export function isTorBoxUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return host === "torbox.app" || host.endsWith(".torbox.app");
  } catch {
    return false;
  }
}

/** A helper cookie belongs to the target site (or one of its subdomains), never an unrelated host. */
export function isCookieDomainAllowed(
  domain: string,
  allowedDomains: ReadonlyArray<string>,
): boolean {
  const host = domain.replace(/^\./, "").toLowerCase().replace(/\.$/, "");
  return allowedDomains.some((raw) => {
    const allowed = raw.replace(/^\./, "").toLowerCase().replace(/\.$/, "");
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}
