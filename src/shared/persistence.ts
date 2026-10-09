import { DEFAULT_SEARCH_ENGINE, isSearchEngineId } from './navigation.ts'
import type { SearchEngineId, TabSleepMinutes } from './types'

export const MAX_RESTORED_TABS = 50
export const DEFAULT_TAB_SLEEP_MINUTES: TabSleepMinutes = 30
export const TAB_SLEEP_OPTIONS: readonly TabSleepMinutes[] = [0, 5, 15, 30, 60]

export interface SavedBrowserSession {
  urls: string[]
  activeIndex: number
}

export interface BrowserPreferences {
  searchEngine: SearchEngineId
  tabSleepMinutes: TabSleepMinutes
}

export function isTabSleepMinutes(value: unknown): value is TabSleepMinutes {
  return typeof value === 'number' && TAB_SLEEP_OPTIONS.includes(value as TabSleepMinutes)
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
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
  if (typeof value !== 'object' || value === null) return { urls: [], activeIndex: 0 }
  const record = value as { version?: unknown; tabs?: unknown; activeIndex?: unknown }
  if (record.version !== 1 || !Array.isArray(record.tabs)) return { urls: [], activeIndex: 0 }
  const activeIndex = typeof record.activeIndex === 'number' ? record.activeIndex : 0
  const urls = record.tabs.slice(0, MAX_RESTORED_TABS).map((url) => typeof url === 'string' ? url : '')
  return normalizeBrowserSession(urls, activeIndex)
}

export function parseBrowserPreferences(value: unknown): BrowserPreferences {
  const defaults: BrowserPreferences = { searchEngine: DEFAULT_SEARCH_ENGINE, tabSleepMinutes: DEFAULT_TAB_SLEEP_MINUTES }
  if (typeof value !== 'object' || value === null) return defaults
  const record = value as { version?: unknown; searchEngine?: unknown; tabSleepMinutes?: unknown }
  if (record.version !== 1) return defaults
  return {
    searchEngine: isSearchEngineId(record.searchEngine) ? record.searchEngine : defaults.searchEngine,
    tabSleepMinutes: isTabSleepMinutes(record.tabSleepMinutes) ? record.tabSleepMinutes : defaults.tabSleepMinutes
  }
}
