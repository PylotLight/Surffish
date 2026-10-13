/** Clear browsing data and per-site cookie helpers. Pure, shared by main and renderer (no tldts here, so the renderer stays lean). */

export type ClearBrowsingDataRange = 'hour' | 'day' | 'week' | 'month' | 'all'

export const CLEAR_RANGES: ReadonlyArray<{ id: ClearBrowsingDataRange; label: string; ms: number }> = [
  { id: 'hour', label: 'Last hour', ms: 60 * 60 * 1000 },
  { id: 'day', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'month', label: 'Last 4 weeks', ms: 28 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All time', ms: Number.POSITIVE_INFINITY }
]

export interface ClearBrowsingDataOptions {
  range: ClearBrowsingDataRange
  history: boolean
  downloads: boolean
  cookies: boolean
  cache: boolean
  permissions: boolean
  zoom: boolean
}

export const DEFAULT_CLEAR_OPTIONS: ClearBrowsingDataOptions = { range: 'hour', history: true, downloads: false, cookies: true, cache: true, permissions: false, zoom: false }

export interface ClearBrowsingDataResult {
  /** Sites whose cookies/storage/cache/permissions/zoom were scoped to the range (null = everything). */
  scopedOrigins: number | null
  historyRemoved: number
  downloadsRemoved: number
}

export function parseClearBrowsingDataOptions(value: unknown): ClearBrowsingDataOptions | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!CLEAR_RANGES.some((range) => range.id === record.range)) return null
  const flag = (key: keyof ClearBrowsingDataOptions): boolean => record[key] === true
  return { range: record.range as ClearBrowsingDataRange, history: flag('history'), downloads: flag('downloads'), cookies: flag('cookies'), cache: flag('cache'), permissions: flag('permissions'), zoom: flag('zoom') }
}

/** Earliest timestamp to clear from (0 for all time). */
export function clearRangeStart(range: ClearBrowsingDataRange, now: number): number {
  const ms = CLEAR_RANGES.find((entry) => entry.id === range)?.ms ?? Number.POSITIVE_INFINITY
  return Number.isFinite(ms) ? Math.max(0, now - ms) : 0
}

/** Distinct http(s) origins visited at or after `since`, from history entries. */
export function originsVisitedSince(entries: ReadonlyArray<{ url: string; visitedAt: number }>, since: number): string[] {
  const origins = new Set<string>()
  for (const entry of entries) {
    if (entry.visitedAt < since) continue
    try {
      const url = new URL(entry.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin)
    } catch {
      // Skip malformed entries.
    }
  }
  return [...origins]
}

export function cookieHost(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\./, '')
}

/**
 * A cookie belongs to `hostname` when it would be sent there (exact host or a parent-domain
 * cookie) or was set by a subdomain of it. Parent-domain cookies cover siblings too; that's
 * how cookies work, and Chrome's "delete site data" removes them the same way.
 */
export function cookieMatchesHost(cookieDomain: string, hostname: string): boolean {
  const cookie = cookieHost(cookieDomain)
  const host = hostname.trim().toLowerCase()
  if (!cookie || !host) return false
  return cookie === host || host.endsWith(`.${cookie}`) || cookie.endsWith(`.${host}`)
}

/** URL to pass to cookies.remove() for a stored cookie. */
export function cookieRemovalUrl(cookie: { domain?: string; path?: string; secure?: boolean }): string | null {
  const host = cookieHost(cookie.domain ?? '')
  if (!host) return null
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const path = cookie.path?.startsWith('/') ? cookie.path : '/'
  return `${cookie.secure ? 'https' : 'http'}://${urlHost}${path}`
}

export interface CookieSiteSummary {
  site: string
  cookies: number
  /** Distinct cookie hosts under this site (e.g. www.example.com, example.com). */
  hosts: string[]
}

/** Group cookies by site; `siteOf` maps a host to its registrable domain (tldts in main). */
export function groupCookiesBySite(cookies: ReadonlyArray<{ domain?: string }>, siteOf: (host: string) => string): CookieSiteSummary[] {
  const sites = new Map<string, { cookies: number; hosts: Set<string> }>()
  for (const cookie of cookies) {
    const host = cookieHost(cookie.domain ?? '')
    if (!host) continue
    const site = siteOf(host) || host
    const entry = sites.get(site) ?? { cookies: 0, hosts: new Set<string>() }
    entry.cookies += 1
    entry.hosts.add(host)
    sites.set(site, entry)
  }
  return [...sites.entries()]
    .map(([site, entry]) => ({ site, cookies: entry.cookies, hosts: [...entry.hosts].sort() }))
    .sort((a, b) => a.site.localeCompare(b.site))
}

/** http and https origins for a set of cookie hosts, for storage clearing. */
export function originsForHosts(hosts: readonly string[]): string[] {
  return hosts.flatMap((host) => {
    const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    return [`https://${urlHost}`, `http://${urlHost}`]
  })
}

export interface SiteDataSummary {
  origin: string
  cookies: number
  /** Bytes the origin stores (navigator.storage.estimate on the open page); null when unknown. */
  storageBytes: number | null
}

export function formatStorageBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'storage unknown'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
