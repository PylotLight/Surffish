import { DEFAULT_SEARCH_ENGINE, isSearchEngineId } from './navigation.ts'
import type { BrowserSiteSettings, NewTabPageId, PinnedSite, SearchEngineId, TabSleepMinutes } from './types'

export const MAX_RESTORED_TABS = 50
export const MAX_PINNED_SITES = 12
export const MAX_SAVED_SITE_SETTINGS = 200
export const DEFAULT_TAB_SLEEP_MINUTES: TabSleepMinutes = 30
export const DEFAULT_NEW_TAB_PAGE: NewTabPageId = 'bonjourr'
export const TAB_SLEEP_OPTIONS: readonly TabSleepMinutes[] = [0, 5, 15, 30, 60]

export interface SavedBrowserSession {
  urls: string[]
  activeIndex: number
}

export interface BrowserPreferences {
  searchEngine: SearchEngineId
  tabSleepMinutes: TabSleepMinutes
  newTabPage: NewTabPageId
  pinnedSites: PinnedSite[]
  siteSettings: Record<string, BrowserSiteSettings>
}

export function isTabSleepMinutes(value: unknown): value is TabSleepMinutes {
  return typeof value === 'number' && TAB_SLEEP_OPTIONS.includes(value as TabSleepMinutes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export function isHttpUrl(value: unknown): value is string {
  return safeHttpUrl(value) !== null
}

export function normalizeHttpOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

export function parseBrowserSiteSettings(originInput: unknown, value: unknown): BrowserSiteSettings | null {
  const origin = normalizeHttpOrigin(originInput)
  if (!origin) return null
  const record = isRecord(value) ? value : {}
  return {
    origin,
    blockAds: typeof record.blockAds === 'boolean' ? record.blockAds : true,
    openPopupsInTabs: record.openPopupsInTabs === true,
    allowMedia: record.allowMedia === true,
    allowGeolocation: record.allowGeolocation === true,
    allowNotifications: record.allowNotifications === true
  }
}

export function normalizePinnedSites(value: unknown): PinnedSite[] {
  if (!Array.isArray(value)) return []
  const pinned: PinnedSite[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, MAX_PINNED_SITES * 4)) {
    if (!isRecord(entry)) continue
    const url = safeHttpUrl(entry.url)
    if (!url || seen.has(url)) continue
    const parsed = new URL(url)
    const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 80) : ''
    pinned.push({ title: title || parsed.hostname, url })
    seen.add(url)
    if (pinned.length >= MAX_PINNED_SITES) break
  }
  return pinned
}

export function normalizeBrowserSession(urls: readonly string[], activeIndex: number): SavedBrowserSession {
  const indexedUrls = urls.slice(0, MAX_RESTORED_TABS).map((url, index) => ({ url, index }))
    .filter((entry) => isHttpUrl(entry.url))
  if (indexedUrls.length === 0) return { urls: [], activeIndex: 0 }

  const safeActiveIndex = Number.isInteger(activeIndex) ? activeIndex : 0
  const normalizedActiveIndex = indexedUrls.findIndex((entry) => entry.index === safeActiveIndex)
  return {
    urls: indexedUrls.map((entry) => entry.url),
    activeIndex: normalizedActiveIndex < 0 ? 0 : normalizedActiveIndex
  }
}

export function parseBrowserSession(value: unknown): SavedBrowserSession {
  if (!isRecord(value)) return { urls: [], activeIndex: 0 }
  if (value.version !== 1 || !Array.isArray(value.tabs)) return { urls: [], activeIndex: 0 }
  const activeIndex = typeof value.activeIndex === 'number' ? value.activeIndex : 0
  const urls = value.tabs.slice(0, MAX_RESTORED_TABS).map((url) => typeof url === 'string' ? url : '')
  return normalizeBrowserSession(urls, activeIndex)
}

function defaultSiteSettings(origin: string): BrowserSiteSettings {
  return { origin, blockAds: true, openPopupsInTabs: false, allowMedia: false, allowGeolocation: false, allowNotifications: false }
}

export function parseBrowserPreferences(value: unknown): BrowserPreferences {
  const defaults: BrowserPreferences = {
    searchEngine: DEFAULT_SEARCH_ENGINE,
    tabSleepMinutes: DEFAULT_TAB_SLEEP_MINUTES,
    newTabPage: DEFAULT_NEW_TAB_PAGE,
    pinnedSites: [],
    siteSettings: {}
  }
  if (!isRecord(value) || value.version !== 1) return defaults

  const siteSettings: Record<string, BrowserSiteSettings> = {}
  if (isRecord(value.siteSettings)) {
    for (const [key, settings] of Object.entries(value.siteSettings).slice(0, MAX_SAVED_SITE_SETTINGS)) {
      const parsed = parseBrowserSiteSettings(key, settings)
      if (parsed) siteSettings[parsed.origin] = parsed
    }
  }

  return {
    searchEngine: isSearchEngineId(value.searchEngine) ? value.searchEngine : defaults.searchEngine,
    tabSleepMinutes: isTabSleepMinutes(value.tabSleepMinutes) ? value.tabSleepMinutes : defaults.tabSleepMinutes,
    newTabPage: value.newTabPage === 'search' || value.newTabPage === 'bonjourr' ? value.newTabPage : defaults.newTabPage,
    pinnedSites: normalizePinnedSites(value.pinnedSites),
    siteSettings
  }
}
