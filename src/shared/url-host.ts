/** Host helpers shared by main and the renderer (one copy instead of a private one per module). */

/** The URL's hostname (already lower-case, IPv6 in brackets), or '' when it doesn't parse. */
export function urlHostname(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Short host for labels: hostname without a leading "www."; the input itself when it doesn't parse. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}
