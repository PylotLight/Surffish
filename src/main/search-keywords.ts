import type { SearchEngineId } from '../shared/types'
import { resolveNavigationTarget } from '../shared/navigation'
import { parseCustomSearchEngines, parseKeywordSearch, validateCustomSearchEngineList, type CustomSearchEngine, type CustomSearchEnginesResult } from '../shared/search-keywords'
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

/** Replace the whole list; an invalid entry comes back as { ok: false, error } so the form can show why. */
export function setCustomSearchEngines(input: unknown): CustomSearchEnginesResult {
  const result = validateCustomSearchEngineList(input)
  if (!result.ok) return result
  engines = result.engines
  writeUserJson(FILE, { version: 1, engines: result.engines })
  sendToMainWindowRenderers('browser:search-keywords:changed', getCustomSearchEngines())
  return { ok: true, engines: getCustomSearchEngines() }
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
