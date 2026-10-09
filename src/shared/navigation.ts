import type { SearchEngineId } from './types'

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'brave'
export const SEARCH_ENGINES = [
  { id: 'brave', label: 'Brave Search', searchUrl: 'https://search.brave.com/search', homeUrl: 'https://search.brave.com/' },
  { id: 'duckduckgo', label: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/', homeUrl: 'https://duckduckgo.com/' },
  { id: 'google', label: 'Google', searchUrl: 'https://www.google.com/search', homeUrl: 'https://www.google.com/' },
  { id: 'bing', label: 'Bing', searchUrl: 'https://www.bing.com/search', homeUrl: 'https://www.bing.com/' }
] as const satisfies readonly { id: SearchEngineId; label: string; searchUrl: string; homeUrl: string }[]

export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return SEARCH_ENGINES.some((engine) => engine.id === value)
}

export function getSearchHomepage(engineId: SearchEngineId): string {
  return SEARCH_ENGINES.find((engine) => engine.id === engineId)?.homeUrl ?? SEARCH_ENGINES[0].homeUrl
}

function isIpv4(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopback(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1' || normalized.startsWith('127.')
}

function searchFor(query: string, engineId: SearchEngineId): string {
  const engine = SEARCH_ENGINES.find((candidate) => candidate.id === engineId) ?? SEARCH_ENGINES[0]
  const url = new URL(engine.searchUrl)
  url.searchParams.set('q', query)
  return url.toString()
}

/** Resolve address-bar input without ever allowing a non-HTTP(S) navigation. */
export function resolveNavigationTarget(input: string, engineId: SearchEngineId = DEFAULT_SEARCH_ENGINE): string | null {
  const value = input.trim()
  if (!value) return null

  const explicitWebScheme = /^https?:/i.test(value)
  const explicitOtherScheme = /^(?:[a-z][a-z\d+.-]*):\/\//i.test(value) || /^(?:javascript|data|file|ftp|mailto|about|chrome|view-source):/i.test(value)
  if (explicitWebScheme || explicitOtherScheme) {
    try {
      const url = new URL(value)
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null
      return url.toString()
    } catch {
      return null
    }
  }

  // Whitespace is a strong signal that the user entered a search query.
  if (/\s/.test(value)) return searchFor(value, engineId)

  try {
    const url = new URL(`https://${value}`)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const looksLikeAddress = host === 'localhost' || host.endsWith('.localhost') || host.includes('.') || isIpv4(host) || host === '::1'
    if (!looksLikeAddress) return searchFor(value, engineId)
    if (isLoopback(url.hostname)) url.protocol = 'http:'
    return url.toString()
  } catch {
    return searchFor(value, engineId)
  }
}
