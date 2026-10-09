import { DEFAULT_SEARCH_ENGINE, isSearchEngineId } from './navigation.ts'
import type { SearchEngineId } from './types'

export const MAX_RESTORED_TABS = 50

export interface SavedBrowserSession {
  urls: string[]
  activeIndex: number
}

export interface BrowserPreferences {
  searchEngine: SearchEngineId
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
  if (typeof value !== 'object' || value === null) return { searchEngine: DEFAULT_SEARCH_ENGINE }
  const record = value as { version?: unknown; searchEngine?: unknown }
  return record.version === 1 && isSearchEngineId(record.searchEngine)
    ? { searchEngine: record.searchEngine }
    : { searchEngine: DEFAULT_SEARCH_ENGINE }
}
