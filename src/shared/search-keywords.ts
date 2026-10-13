/**
 * Search keywords / custom search engines (Chrome's "site search" + DuckDuckGo-style !bangs).
 * Pure parsing and validation only; main persists the list and the renderers show it.
 */

export interface CustomSearchEngine {
  id: string
  name: string
  /** Lower-case, no spaces: typed as `keyword query` or `!keyword` anywhere in the query. */
  keyword: string
  /** https URL with `%s` where the (URL-encoded) query goes. */
  urlTemplate: string
}

export interface KeywordSearchMatch {
  engine: CustomSearchEngine
  query: string
  via: 'keyword' | 'bang'
  /** Where to go: the template with the query, or the engine's home page for a bare `!bang`. */
  url: string
}

export const MAX_CUSTOM_SEARCH_ENGINES = 50
const MAX_NAME_LENGTH = 60
const MAX_KEYWORD_LENGTH = 24
const MAX_TEMPLATE_LENGTH = 2048
const KEYWORD_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

export const DEFAULT_CUSTOM_SEARCH_ENGINES: readonly CustomSearchEngine[] = [
  { id: 'google', name: 'Google', keyword: 'g', urlTemplate: 'https://www.google.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', keyword: 'd', urlTemplate: 'https://duckduckgo.com/?q=%s' },
  { id: 'brave', name: 'Brave Search', keyword: 'b', urlTemplate: 'https://search.brave.com/search?q=%s' },
  { id: 'youtube', name: 'YouTube', keyword: 'yt', urlTemplate: 'https://www.youtube.com/results?search_query=%s' },
  { id: 'wikipedia', name: 'Wikipedia', keyword: 'w', urlTemplate: 'https://en.wikipedia.org/wiki/Special:Search?search=%s' },
  { id: 'github', name: 'GitHub', keyword: 'gh', urlTemplate: 'https://github.com/search?q=%s' },
  { id: 'npm', name: 'npm', keyword: 'npm', urlTemplate: 'https://www.npmjs.com/search?q=%s' }
]

export function normalizeSearchKeyword(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^!+/, '').toLowerCase() : ''
}

/** Null when valid, otherwise a short message for the settings form. */
export function validateSearchTemplate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a URL.'
  const template = value.trim()
  if (template.length > MAX_TEMPLATE_LENGTH) return 'That URL is too long.'
  if (!template.includes('%s')) return 'The URL must contain %s where the search terms go.'
  let url: URL
  try {
    url = new URL(template.replaceAll('%s', 'surffish'))
  } catch {
    return 'That isn’t a valid URL.'
  }
  if (url.protocol !== 'https:') return 'Only https:// URLs are allowed.'
  if (!url.hostname || !url.hostname.includes('.')) return 'The URL needs a real host name.'
  if (url.username || url.password) return 'The URL can’t contain a username or password.'
  return null
}

export function validateSearchKeyword(value: unknown, others: readonly CustomSearchEngine[] = [], selfId?: string): string | null {
  const keyword = normalizeSearchKeyword(value)
  if (!keyword) return 'Enter a keyword.'
  if (keyword.length > MAX_KEYWORD_LENGTH) return `Keywords are at most ${MAX_KEYWORD_LENGTH} characters.`
  if (!KEYWORD_PATTERN.test(keyword)) return 'Use letters, numbers, - or _ (no spaces or dots).'
  if (others.some((engine) => engine.id !== selfId && engine.keyword === keyword)) return `“${keyword}” is already used by another engine.`
  return null
}

/** Null when the whole engine is valid against the rest of the list. */
export function validateCustomSearchEngine(engine: Pick<CustomSearchEngine, 'name' | 'keyword' | 'urlTemplate'> & { id?: string }, others: readonly CustomSearchEngine[] = []): string | null {
  if (!engine.name.trim()) return 'Enter a name.'
  if (engine.name.trim().length > MAX_NAME_LENGTH) return `Names are at most ${MAX_NAME_LENGTH} characters.`
  return validateSearchKeyword(engine.keyword, others, engine.id) ?? validateSearchTemplate(engine.urlTemplate)
}

/** Drop anything invalid or duplicated; a missing/garbled list falls back to the defaults. */
export function parseCustomSearchEngines(value: unknown): CustomSearchEngine[] {
  if (!Array.isArray(value)) return DEFAULT_CUSTOM_SEARCH_ENGINES.map((engine) => ({ ...engine }))
  const engines: CustomSearchEngine[] = []
  const ids = new Set<string>()
  for (const candidate of value) {
    if (engines.length >= MAX_CUSTOM_SEARCH_ENGINES) break
    if (typeof candidate !== 'object' || candidate === null) continue
    const record = candidate as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)) continue
    if (typeof record.name !== 'string' || typeof record.urlTemplate !== 'string') continue
    const engine: CustomSearchEngine = {
      id: record.id.trim().slice(0, 64),
      name: record.name.trim(),
      keyword: normalizeSearchKeyword(record.keyword),
      urlTemplate: record.urlTemplate.trim()
    }
    if (validateCustomSearchEngine(engine, engines)) continue
    ids.add(engine.id)
    engines.push(engine)
  }
  return engines
}

/** Fill `%s` with the encoded query (spaces as `+` look nicer but `%20` works everywhere). */
/** Result of saving the whole list from Settings: a bad entry is a message for the form, not a throw. */
export type CustomSearchEnginesResult = { ok: true; engines: CustomSearchEngine[] } | { ok: false; error: string }

/** Validate a full replacement list from the renderer; names the first bad entry so the form can show why. */
export function validateCustomSearchEngineList(input: unknown): CustomSearchEnginesResult {
  if (!Array.isArray(input)) return { ok: false, error: 'Expected a list of search engines.' }
  if (input.length > MAX_CUSTOM_SEARCH_ENGINES) return { ok: false, error: `Up to ${MAX_CUSTOM_SEARCH_ENGINES} search engines.` }
  const engines = parseCustomSearchEngines(input)
  if (engines.length === input.length) return { ok: true, engines }
  const accepted: CustomSearchEngine[] = []
  for (const candidate of input as Array<Record<string, unknown> | null>) {
    const engine = {
      id: String(candidate?.id ?? ''),
      name: String(candidate?.name ?? ''),
      keyword: String(candidate?.keyword ?? ''),
      urlTemplate: String(candidate?.urlTemplate ?? '')
    }
    const error = validateCustomSearchEngine(engine, accepted)
    if (error) return { ok: false, error: `${engine.name || 'Search engine'}: ${error}` }
    accepted.push(engine)
  }
  return { ok: false, error: 'A search engine is invalid.' }
}

export function buildKeywordSearchUrl(template: string, query: string): string {
  return template.replaceAll('%s', encodeURIComponent(query))
}

function engineHomeUrl(template: string): string {
  try {
    return `${new URL(template.replaceAll('%s', '')).origin}/`
  } catch {
    return template.replaceAll('%s', '')
  }
}

function findEngine(keyword: string, engines: readonly CustomSearchEngine[]): CustomSearchEngine | undefined {
  const normalized = keyword.toLowerCase()
  return engines.find((engine) => engine.keyword === normalized)
}

/**
 * `yt cats` (keyword then a space) or `cats !yt` / `!yt cats` (a bang token anywhere).
 * Explicit URLs are never rewritten, so `https://x.test/#!g` stays a URL.
 */
export function parseKeywordSearch(input: string, engines: readonly CustomSearchEngine[]): KeywordSearchMatch | null {
  const value = input.trim()
  if (!value || engines.length === 0) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/\s/.test(value)) return null

  // Bang first: `!yt` wins even when the first word happens to be another keyword.
  const tokens = value.split(/\s+/)
  const bangIndex = tokens.findIndex((token) => /^![a-z0-9][a-z0-9_-]*$/i.test(token) && findEngine(token.slice(1), engines))
  if (bangIndex >= 0) {
    const engine = findEngine(tokens[bangIndex]!.slice(1), engines)!
    const query = tokens.filter((_token, index) => index !== bangIndex).join(' ').trim()
    return { engine, query, via: 'bang', url: query ? buildKeywordSearchUrl(engine.urlTemplate, query) : engineHomeUrl(engine.urlTemplate) }
  }

  const match = /^(\S+)\s+(\S[\s\S]*)$/.exec(value)
  if (!match) return null
  const engine = findEngine(match[1]!, engines)
  if (!engine) return null
  const query = match[2]!.trim()
  return { engine, query, via: 'keyword', url: buildKeywordSearchUrl(engine.urlTemplate, query) }
}

/** New engine id from its name, unique within the list. */
export function makeSearchEngineId(name: string, existing: readonly CustomSearchEngine[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'engine'
  let id = base
  for (let n = 2; existing.some((engine) => engine.id === id); n += 1) id = `${base}-${n}`
  return id
}
