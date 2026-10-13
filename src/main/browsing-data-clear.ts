import { webContents as allWebContents, type Session } from 'electron'
import { getDomain } from 'tldts-experimental'
import {
  clearRangeStart,
  cookieMatchesHost,
  cookieRemovalUrl,
  groupCookiesBySite,
  originsForHosts,
  originsVisitedSince,
  parseClearBrowsingDataOptions,
  type ClearBrowsingDataResult,
  type CookieSiteSummary,
  type SiteDataSummary
} from '../shared/browsing-data'
import { normalizeHttpOrigin } from '../shared/persistence'
import { getBrowserSession, getPageSession, listPageSessions } from './browser-session'
import { knownSpacePartitions } from './spaces-store'

/** The profile session plus every Space partition (separate logins), opened this run or not. */
function persistentPageSessions(): Session[] {
  const sessions = new Set<Session>([getBrowserSession()])
  for (const partition of knownSpacePartitions()) sessions.add(getPageSession(partition))
  for (const { session, info } of listPageSessions()) if (info.persistent) sessions.add(session)
  return [...sessions]
}
import { getBrowsingHistory, removeBrowsingHistory } from './history'
import { clearDownloadHistory, clearDownloadHistorySince } from './downloads'
import { clearBrowserSiteZoom, resetBrowserSiteSettings } from './browser-persistence'
import { sendToMainWindowRenderers } from './browser-shell'
import { getActiveTabWebContents } from './browser'
import { forgetArchivedTabsSince } from './tab-archive-store'

/**
 * Clear browsing data (Settings → Privacy) and per-site data controls. Clearing and Forget This
 * Site act on the profile session and every Space partition; the cookie list reads the profile
 * session only; private tabs keep everything in memory and wipe it when the last one closes.
 *
 * Electron can't clear cookies, storage or cache by date, so for a time range those are
 * cleared for the sites visited in that range (from Surffish history), like "sites you used".
 */
const STORAGE_TYPES = ['backgroundFetch', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'] as const

function siteOf(host: string): string {
  return getDomain(host, { allowPrivateDomains: true }) ?? host
}

/** Extension pages keep their storage: clearing site data must not wipe installed extensions. */
function extensionOrigins(target: Session): string[] {
  try {
    return target.extensions.getAllExtensions().map((extension) => extension.url.replace(/\/$/, ''))
  } catch {
    return []
  }
}

async function removeCookies(target: Session, match: (cookie: Electron.Cookie) => boolean): Promise<number> {
  const cookies = await target.cookies.get({})
  let removed = 0
  for (const cookie of cookies) {
    if (!match(cookie)) continue
    const url = cookieRemovalUrl(cookie)
    if (!url) continue
    try {
      await target.cookies.remove(url, cookie.name)
      removed += 1
    } catch {
      // A cookie that vanished in the meantime is fine.
    }
  }
  return removed
}

function hostsOf(origins: readonly string[]): string[] {
  return [...new Set(origins.map((origin) => {
    try {
      return new URL(origin).hostname.toLowerCase()
    } catch {
      return ''
    }
  }).filter(Boolean))]
}

function resetZoomOnOpenPages(origins: readonly string[] | null): void {
  const sessions = new Set(persistentPageSessions())
  for (const contents of allWebContents.getAllWebContents()) {
    if (contents.isDestroyed() || !sessions.has(contents.session)) continue
    const origin = normalizeHttpOrigin(contents.getURL())
    if (!origin || (origins && !origins.includes(origin))) continue
    contents.setZoomFactor(1)
  }
}

export async function clearBrowsingData(input: unknown): Promise<ClearBrowsingDataResult> {
  const options = parseClearBrowsingDataOptions(input)
  if (!options) throw new Error('Choose a time range and what to clear.')
  const since = clearRangeStart(options.range, Date.now())
  const allTime = since === 0
  // Read history before clearing it: it decides which sites a time range covers.
  const origins = allTime ? null : originsVisitedSince(getBrowsingHistory(), since)
  const result: ClearBrowsingDataResult = { scopedOrigins: origins ? origins.length : null, historyRemoved: 0, downloadsRemoved: 0 }
  const scoped = origins !== null && origins.length > 0

  for (const target of persistentPageSessions()) {
  if (options.cookies) {
    if (allTime) {
      const excludeOrigins = extensionOrigins(target)
      await target.clearData({ dataTypes: [...STORAGE_TYPES, 'cookies'], ...(excludeOrigins.length ? { excludeOrigins } : {}) })
      // Belt and braces: anything clearData left behind.
      await removeCookies(target, () => true)
      await target.clearAuthCache().catch(() => undefined)
    } else if (scoped) {
      const hosts = hostsOf(origins)
      await removeCookies(target, (cookie) => hosts.some((host) => cookieMatchesHost(cookie.domain ?? '', host)))
      await target.clearData({ dataTypes: [...STORAGE_TYPES], origins })
    }
  }
  if (options.cache) {
    if (allTime) {
      await target.clearCache()
      await target.clearCodeCaches({}).catch(() => undefined)
      await target.clearHostResolverCache().catch(() => undefined)
    } else if (scoped) {
      await target.clearData({ dataTypes: ['cache'], origins })
    }
  }
  }
  if (options.permissions && (allTime || scoped)) resetBrowserSiteSettings(origins)
  if (options.zoom && (allTime || scoped)) {
    clearBrowserSiteZoom(origins)
    resetZoomOnOpenPages(origins)
  }
  if (options.history) {
    result.historyRemoved = removeBrowsingHistory((entry) => entry.visitedAt >= since)
    forgetArchivedTabsSince(since)
    sendToMainWindowRenderers('browser:history-changed')
  }
  if (options.downloads) {
    if (allTime) clearDownloadHistory()
    else result.downloadsRemoved = clearDownloadHistorySince(since)
  }
  return result
}

export async function listCookieSites(): Promise<CookieSiteSummary[]> {
  const cookies = await getBrowserSession().cookies.get({})
  return groupCookiesBySite(cookies, siteOf)
}

/** Delete one site's cookies (every host under its registrable domain) and its storage. */
export async function deleteCookieSite(siteInput: unknown): Promise<CookieSiteSummary[]> {
  if (typeof siteInput !== 'string' || !siteInput.trim()) return listCookieSites()
  const site = siteInput.trim().toLowerCase()
  const target = getBrowserSession()
  const hosts = new Set<string>()
  await removeCookies(target, (cookie) => {
    const host = (cookie.domain ?? '').replace(/^\./, '').toLowerCase()
    if (siteOf(host) !== site) return false
    hosts.add(host)
    return true
  })
  if (hosts.size > 0) await target.clearData({ dataTypes: [...STORAGE_TYPES], origins: originsForHosts([...hosts]) }).catch(() => undefined)
  return listCookieSites()
}

async function storageUsage(origin: string): Promise<number | null> {
  const contents = getActiveTabWebContents()
  if (!contents || contents.isDestroyed() || normalizeHttpOrigin(contents.getURL()) !== origin) return null
  try {
    // Isolated world, so the page can't see or tamper with the call.
    const usage = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(1999, [{ code: 'navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().then((estimate) => estimate.usage ?? null) : null' }]),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500))
    ])
    return typeof usage === 'number' && Number.isFinite(usage) ? usage : null
  } catch {
    return null
  }
}

export async function getSiteData(originInput: unknown): Promise<SiteDataSummary | null> {
  const origin = normalizeHttpOrigin(originInput)
  if (!origin) return null
  const host = new URL(origin).hostname
  const cookies = (await getBrowserSession().cookies.get({})).filter((cookie) => cookieMatchesHost(cookie.domain ?? '', host))
  return { origin, cookies: cookies.length, storageBytes: await storageUsage(origin) }
}

/** Forget this site: cookies, storage, cache, permissions/settings and zoom; history entries if asked. */
export async function forgetSite(originInput: unknown, includeHistory: unknown): Promise<SiteDataSummary | null> {
  const origin = normalizeHttpOrigin(originInput)
  if (!origin) return null
  const host = new URL(origin).hostname.toLowerCase()
  const origins = originsForHosts([host])
  for (const target of persistentPageSessions()) {
    await removeCookies(target, (cookie) => cookieMatchesHost(cookie.domain ?? '', host))
    await target.clearData({ dataTypes: [...STORAGE_TYPES, 'cache'], origins })
  }
  resetBrowserSiteSettings(origins)
  clearBrowserSiteZoom(origins)
  resetZoomOnOpenPages(origins)
  if (includeHistory === true) {
    removeBrowsingHistory((entry) => {
      try {
        return new URL(entry.url).hostname.toLowerCase() === host
      } catch {
        return false
      }
    })
    sendToMainWindowRenderers('browser:history-changed')
  }
  return getSiteData(origin)
}
