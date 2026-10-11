import { DEFAULT_SEARCH_ENGINE, isSearchEngineId, LEGACY_QUICK_LINKS_URL, SURFFISH_QUICK_LINKS_URL } from './navigation.ts'
import type { BrowserProxySettings, BrowserSiteSettings, NewTabPageId, NewTabPreferences, PinnedSite, SearchEngineId, TabSleepMinutes, WorldClockPreference } from './types'

export const MAX_RESTORED_TABS = 50
export const MAX_PINNED_SITES = 12
export const MAX_SAVED_SITE_SETTINGS = 200
export const DEFAULT_TAB_SLEEP_MINUTES: TabSleepMinutes = 30
export const DEFAULT_NEW_TAB_PAGE: NewTabPageId = 'quick-links'
export const TAB_SLEEP_OPTIONS: readonly TabSleepMinutes[] = [0, 5, 15, 30, 60]
export const DEFAULT_NEW_TAB_PREFERENCES: NewTabPreferences = {
  showClock: true,
  showDate: true,
  use24HourTime: true,
  showSeconds: false,
  timeZone: 'local',
  worldClocks: [],
  weatherEnabled: false,
  weatherLocation: '',
  temperatureUnit: 'celsius',
  iconSize: 30,
  linksPerRow: 8,
  showLinkLabels: false,
  backgroundDim: 34,
  backgroundBlur: 0,
  iconVerticalOffset: 340
}
export const MAX_WORLD_CLOCKS = 8
const LOCAL_PROXY_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
export const DEFAULT_BROWSER_PROXY_SETTINGS: BrowserProxySettings = { enabled: false, host: '127.0.0.1', port: 1080 }

export interface SavedBrowserSession {
  urls: string[]
  activeIndex: number
  pinnedIndexes: number[]
}

export interface BrowserPreferences {
  searchEngine: SearchEngineId
  tabSleepMinutes: TabSleepMinutes
  newTabPage: NewTabPageId
  newTabPreferences: NewTabPreferences
  pinnedSites: PinnedSite[]
  siteSettings: Record<string, BrowserSiteSettings>
}

export function isTabSleepMinutes(value: unknown): value is TabSleepMinutes {
  return typeof value === 'number' && TAB_SLEEP_OPTIONS.includes(value as TabSleepMinutes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(maximum, Math.max(minimum, value)))
    : fallback
}

function normalizeWorldClocks(value: unknown): WorldClockPreference[] {
  if (!Array.isArray(value)) return []
  const clocks: WorldClockPreference[] = []
  const ids = new Set<string>()
  for (const entry of value.slice(0, MAX_WORLD_CLOCKS * 4)) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.label !== 'string' || !isTimeZone(entry.timeZone)) continue
    const id = entry.id.trim().slice(0, 64)
    const label = entry.label.trim().slice(0, 40)
    if (!id || !label || ids.has(id)) continue
    ids.add(id)
    clocks.push({ id, label, timeZone: entry.timeZone })
    if (clocks.length >= MAX_WORLD_CLOCKS) break
  }
  return clocks
}

export function parseNewTabPreferences(value: unknown): NewTabPreferences {
  const record = isRecord(value) ? value : {}
  return {
    showClock: typeof record.showClock === 'boolean' ? record.showClock : DEFAULT_NEW_TAB_PREFERENCES.showClock,
    showDate: typeof record.showDate === 'boolean' ? record.showDate : DEFAULT_NEW_TAB_PREFERENCES.showDate,
    use24HourTime: typeof record.use24HourTime === 'boolean' ? record.use24HourTime : DEFAULT_NEW_TAB_PREFERENCES.use24HourTime,
    showSeconds: typeof record.showSeconds === 'boolean' ? record.showSeconds : DEFAULT_NEW_TAB_PREFERENCES.showSeconds,
    timeZone: record.timeZone === 'local' || isTimeZone(record.timeZone) ? record.timeZone : DEFAULT_NEW_TAB_PREFERENCES.timeZone,
    worldClocks: normalizeWorldClocks(record.worldClocks),
    weatherEnabled: typeof record.weatherEnabled === 'boolean' ? record.weatherEnabled : DEFAULT_NEW_TAB_PREFERENCES.weatherEnabled,
    weatherLocation: typeof record.weatherLocation === 'string' ? record.weatherLocation.trim().slice(0, 100) : DEFAULT_NEW_TAB_PREFERENCES.weatherLocation,
    temperatureUnit: record.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    iconSize: boundedNumber(record.iconSize, DEFAULT_NEW_TAB_PREFERENCES.iconSize, 20, 52),
    linksPerRow: boundedNumber(record.linksPerRow, DEFAULT_NEW_TAB_PREFERENCES.linksPerRow, 3, 12),
    showLinkLabels: typeof record.showLinkLabels === 'boolean' ? record.showLinkLabels : DEFAULT_NEW_TAB_PREFERENCES.showLinkLabels,
    backgroundDim: boundedNumber(record.backgroundDim, DEFAULT_NEW_TAB_PREFERENCES.backgroundDim, 0, 70),
    backgroundBlur: boundedNumber(record.backgroundBlur, DEFAULT_NEW_TAB_PREFERENCES.backgroundBlur, 0, 12),
    iconVerticalOffset: boundedNumber(record.iconVerticalOffset, DEFAULT_NEW_TAB_PREFERENCES.iconVerticalOffset, 0, 480)
  }
}

export function parseBrowserProxySettings(value: unknown): BrowserProxySettings {
  const record = isRecord(value) ? value : {}
  const host = typeof record.host === 'string' ? record.host.trim().toLowerCase() : ''
  const port = Number(record.port)
  if (typeof record.enabled !== 'boolean' || !LOCAL_PROXY_HOSTS.has(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ...DEFAULT_BROWSER_PROXY_SETTINGS }
  }
  return { enabled: record.enabled, host, port }
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

/** Persist only bounded, credential-free web image URLs; data URLs stay transient. */
export function normalizeFaviconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length > 4_096) return null
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.href.length > 4_096) return null
    return url.toString()
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
    const faviconUrl = normalizeFaviconUrl(entry.faviconUrl)
    pinned.push({ title: title || parsed.hostname, url, ...(faviconUrl ? { faviconUrl } : {}) })
    seen.add(url)
    if (pinned.length >= MAX_PINNED_SITES) break
  }
  return pinned
}

export function normalizeBrowserSession(urls: readonly string[], activeIndex: number, pinnedIndexes: readonly number[] = []): SavedBrowserSession {
  const indexedUrls = urls.slice(0, MAX_RESTORED_TABS).map((url, index) => ({
    url: url === LEGACY_QUICK_LINKS_URL ? SURFFISH_QUICK_LINKS_URL : url,
    index
  }))
    .filter((entry) => entry.url === SURFFISH_QUICK_LINKS_URL || isHttpUrl(entry.url))
  if (indexedUrls.length === 0) return { urls: [], activeIndex: 0, pinnedIndexes: [] }

  const safeActiveIndex = Number.isInteger(activeIndex) ? activeIndex : 0
  const normalizedActiveIndex = indexedUrls.findIndex((entry) => entry.index === safeActiveIndex)
  const pinnedIndexSet = new Set(pinnedIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < urls.length))
  const normalizedPinnedIndexes = indexedUrls.flatMap((entry, index) => pinnedIndexSet.has(entry.index) ? [index] : [])
  return {
    urls: indexedUrls.map((entry) => entry.url),
    activeIndex: normalizedActiveIndex < 0 ? 0 : normalizedActiveIndex,
    pinnedIndexes: normalizedPinnedIndexes
  }
}

export function parseBrowserSession(value: unknown): SavedBrowserSession {
  if (!isRecord(value)) return { urls: [], activeIndex: 0, pinnedIndexes: [] }
  if (value.version !== 1 || !Array.isArray(value.tabs)) return { urls: [], activeIndex: 0, pinnedIndexes: [] }
  const activeIndex = typeof value.activeIndex === 'number' ? value.activeIndex : 0
  const urls = value.tabs.slice(0, MAX_RESTORED_TABS).map((url) => typeof url === 'string' ? url : '')
  const pinnedIndexes = Array.isArray(value.pinnedTabs)
    ? value.pinnedTabs.slice(0, MAX_RESTORED_TABS * 4).filter((index): index is number => typeof index === 'number' && Number.isInteger(index))
    : []
  return normalizeBrowserSession(urls, activeIndex, pinnedIndexes)
}

function defaultSiteSettings(origin: string): BrowserSiteSettings {
  return { origin, blockAds: true, openPopupsInTabs: false, allowMedia: false, allowGeolocation: false, allowNotifications: false }
}

export function parseBrowserPreferences(value: unknown): BrowserPreferences {
  const defaults: BrowserPreferences = {
    searchEngine: DEFAULT_SEARCH_ENGINE,
    tabSleepMinutes: DEFAULT_TAB_SLEEP_MINUTES,
    newTabPage: DEFAULT_NEW_TAB_PAGE,
    newTabPreferences: { ...DEFAULT_NEW_TAB_PREFERENCES, worldClocks: [] },
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
    newTabPage: value.newTabPage === 'search' || value.newTabPage === 'bonjourr' || value.newTabPage === 'quick-links' ? value.newTabPage : defaults.newTabPage,
    newTabPreferences: parseNewTabPreferences(value.newTabPreferences),
    pinnedSites: normalizePinnedSites(value.pinnedSites),
    siteSettings
  }
}
