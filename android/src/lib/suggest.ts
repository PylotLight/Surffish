import type { SearchEngineId } from './shared'

/**
 * Remote search suggestions (opt-out in Settings). Only the typed query goes to the selected
 * engine's suggest endpoint, same as any mobile browser; local history/bookmark matching never
 * leaves the device.
 */
const ENDPOINTS: Record<SearchEngineId, (q: string) => string> = {
  brave: (q) => `https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
}

let controller: AbortController | null = null

export async function fetchSuggestions(engine: SearchEngineId, query: string): Promise<string[]> {
  const q = query.trim()
  if (q.length < 2 || /^https?:\/\//i.test(q)) return []
  controller?.abort()
  const mine = new AbortController()
  controller = mine
  try {
    const res = await fetch(ENDPOINTS[engine](q), { signal: mine.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return []
    const data: unknown = await res.json()
    // OpenSearch suggestions format: [query, [s1, s2, ...]]
    if (Array.isArray(data) && Array.isArray(data[1])) return (data[1] as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 5)
    return []
  } catch {
    return []
  }
}
