import type { SearchEngineId } from '../shared/types'
import { resolveNavigationTarget } from '../shared/navigation'
import { parseCustomSearchEngines, parseKeywordSearch, validateCustomSearchEngine, MAX_CUSTOM_SEARCH_ENGINES, type CustomSearchEngine } from '../shared/search-keywords'
import { readUserJson, writeUserJson } from './user-json'
import { sendToMainWindowRenderers } from './browser-shell'

const FILE = 'search-keywords.json'
let engines: CustomSearchEngine[] | null = null

export function getCustomSearchEngines(): CustomSearchEngine[] {
  if (!engines) {
    const saved = readUserJson(FILE)
    const record = typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? saved as Record<string, unknown> : null
    engines = parseCustomSearchEngines(record?.version === 1 ? record.engines : null)
  }
  return engines.map((engine) => ({ ...engine }))
}

/** Replace the whole list; rejects (throws) if any entry is invalid so the form can show why. */
export function setCustomSearchEngines(input: unknown): CustomSearchEngine[] {
  if (!Array.isArray(input)) throw new Error('Expected a list of search engines.')
  if (input.length > MAX_CUSTOM_SEARCH_ENGINES) throw new Error(`Up to ${MAX_CUSTOM_SEARCH_ENGINES} search engines.`)
  const next = parseCustomSearchEngines(input)
  if (next.length !== input.length) {
    // Find the first bad one for a useful message.
    const accepted: CustomSearchEngine[] = []
    for (const candidate of input as Record<string, unknown>[]) {
      const engine = {
        id: String(candidate?.id ?? ''),
        name: String(candidate?.name ?? ''),
        keyword: String(candidate?.keyword ?? ''),
        urlTemplate: String(candidate?.urlTemplate ?? '')
      }
      const error = validateCustomSearchEngine(engine, accepted)
      if (error) throw new Error(`${engine.name || 'Search engine'}: ${error}`)
      accepted.push(engine)
    }
    throw new Error('A search engine is invalid.')
  }
  engines = next
  writeUserJson(FILE, { version: 1, engines: next })
  sendToMainWindowRenderers('browser:search-keywords:changed', getCustomSearchEngines())
  return getCustomSearchEngines()
}

/**
 * Address-bar input: `keyword query` / `!bang` route to a custom engine, everything else goes
 * through the normal URL-or-search resolver. The result is always an http(s) URL or null.
 */
export function resolveAddressInput(input: string, engine?: SearchEngineId): string | null {
  const match = parseKeywordSearch(input, getCustomSearchEngines())
  if (match) {
    const url = resolveNavigationTarget(match.url)
    if (url && url.startsWith('https://')) return url
  }
  return resolveNavigationTarget(input, engine)
}
