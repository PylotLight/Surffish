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
    return /^\/login(?:[/?#]|$)/i.test(url.pathname);
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
