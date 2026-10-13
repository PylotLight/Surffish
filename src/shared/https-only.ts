/** HTTPS-only mode: which navigations to upgrade and which failures mean "this site has no HTTPS". Pure. */

export const MAX_HTTPS_EXCEPTIONS = 500

function ipv4Parts(host: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null
  const parts = host.split('.').map(Number)
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null
}

/** Hosts that never get upgraded: loopback, LAN names, private and link-local addresses, single-label intranet names. */
export function isLocalOrPrivateHost(hostnameInput: string): boolean {
  const host = hostnameInput.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true
  const v4 = ipv4Parts(host)
  if (v4) {
    const [a, b] = v4 as [number, number, number, number]
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  if (host.includes(':')) {
    return host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.')
  }
  // Single-label names ("nas", "router") are intranet hosts with no public certificate.
  return !host.includes('.')
}

export function normalizeHttpsExceptions(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const hosts: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const host = value.trim().toLowerCase()
    if (!host || host.length > 253 || /[\s/:@]/.test(host) || hosts.includes(host)) continue
    hosts.push(host)
  }
  return hosts.slice(-MAX_HTTPS_EXCEPTIONS)
}

/**
 * The https:// URL to load instead of `url`, or null to leave it alone. Like Chrome's HTTPS
 * upgrades, only default-port http URLs are upgraded, and never local or excepted hosts.
 */
export function httpsUpgradeTarget(url: string, exceptions: ReadonlySet<string>): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' || parsed.port !== '' || parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  if (isLocalOrPrivateHost(host) || exceptions.has(host)) return null
  parsed.protocol = 'https:'
  return parsed.toString()
}

/** The http:// URL an upgraded https:// URL came from. */
export function httpFallbackUrl(httpsUrl: string): string | null {
  try {
    const parsed = new URL(httpsUrl)
    if (parsed.protocol !== 'https:') return null
    parsed.protocol = 'http:'
    return parsed.toString()
  } catch {
    return null
  }
}

const UPGRADE_FAILURES = new Set([
  'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_CONNECTION_FAILED',
  'ERR_TIMED_OUT', 'ERR_EMPTY_RESPONSE', 'ERR_TOO_MANY_REDIRECTS', 'ERR_ADDRESS_UNREACHABLE', 'ERR_BAD_SSL_CLIENT_AUTH_CERT'
])

/** Network errors (net::ERR_* names, or bare names) that mean the https:// version of a site doesn't work. */
export function isHttpsUpgradeFailure(error: string): boolean {
  const name = error.trim().replace(/^net::/, '').replace(/\s*\(-?\d+\)$/, '')
  return name.startsWith('ERR_CERT_') || name.startsWith('ERR_SSL_') || UPGRADE_FAILURES.has(name)
}

/** Omnibox security label: plain http pages are "Not secure", except loopback (a secure context, as in Chrome). */
export function isInsecurePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host))
  } catch {
    return false
  }
}
