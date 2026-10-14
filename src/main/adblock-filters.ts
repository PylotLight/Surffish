/**
 * Pure filter-engine helpers (no Electron APIs beyond Ghostery's engine), so
 * Node tests and the Electron harnesses share the exact production logic.
 *
 * - Lists come straight from uBO's uAssets with `!#include` expansion and the
 *   `!#if` environment applied, not Ghostery's slower mirror.
 * - `frameStartPayload` returns the scriptlets and base CSS a frame needs at
 *   document start; `frameUpdateStyles` adds generic CSS for DOM features.
 */
import { ElectronBlocker, Request } from '@ghostery/adblocker-electron'
import { parse as parseDomain } from 'tldts-experimental'
import { bundleScriptlets, type ScriptletResources } from './adblock-scriptlets.ts'
import {
  extractIncludes,
  FILTER_ENVIRONMENT,
  FILTER_LIST_SOURCES,
  FULL_FILTER_CONFIG,
  isWebPageUrl,
  MAX_INCLUDE_DEPTH,
  prepareFilterListText,
  REQUIRED_FILTER_LIST_IDS,
  SCRIPTLET_RESOURCES_URL,
  type FilterListSource
} from './adblock-policy.ts'

/** Fetch with HTTP status, so failed list downloads are detected. */
export type ListFetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>

export interface FrameStartPayload {
  active: boolean
  styles: string
  scripts: string[]
  observe: boolean
  /** Scriptlets the scripts run (several are bundled into one script); defaults to scripts.length. */
  scriptletCount?: number
}

export interface FrameDomFeatures {
  classes?: unknown
  ids?: unknown
  hrefs?: unknown
}

export interface BuiltFilterEngine {
  engine: ElectronBlocker
  loadedLists: string[]
  failedLists: string[]
}

/** Apply uBO's `!#if` environment. Must be repeated after `deserialize`. */
export function applyFilterEnvironment(engine: ElectronBlocker): ElectronBlocker {
  engine.updateEnv(new Map(FILTER_ENVIRONMENT) as Parameters<ElectronBlocker['updateEnv']>[0])
  return engine
}

async function fetchText(fetch: ListFetch, url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.text()
}

async function fetchListWithIncludes(fetch: ListFetch, url: string, depth: number, seen: Set<string>): Promise<string> {
  seen.add(url)
  const text = await fetchText(fetch, url)
  if (depth >= MAX_INCLUDE_DEPTH) return text
  const includes = extractIncludes(text, url).filter((include) => !seen.has(include))
  if (includes.length === 0) return text
  const included = await Promise.all(includes.map(async (include) => {
    try {
      return await fetchListWithIncludes(fetch, include, depth + 1, seen)
    } catch (error) {
      console.warn(`Ad-filter include failed (${include}):`, error)
      return ''
    }
  }))
  return [text, ...included].join('\n')
}

/**
 * Download every list (tolerating optional-list failures), the scriptlet
 * resources, and compile one engine. Throws when a required list or the
 * scriptlet resources are unavailable so the caller keeps its current engine.
 */
export async function buildFilterEngine(fetch: ListFetch, sources: readonly FilterListSource[] = FILTER_LIST_SOURCES): Promise<BuiltFilterEngine> {
  const seen = new Set<string>()
  const [listResults, resources] = await Promise.all([
    Promise.allSettled(sources.map((source) => fetchListWithIncludes(fetch, source.url, 0, seen))),
    fetchText(fetch, SCRIPTLET_RESOURCES_URL)
  ])

  const texts: string[] = []
  const loadedLists: string[] = []
  const failedLists: string[] = []
  listResults.forEach((result, index) => {
    const source = sources[index]
    if (!source) return
    if (result.status === 'fulfilled' && result.value.trim()) {
      texts.push(prepareFilterListText(result.value))
      loadedLists.push(source.id)
    } else {
      failedLists.push(source.id)
    }
  })

  const missingRequired = REQUIRED_FILTER_LIST_IDS.filter((id) => sources.some((source) => source.id === id) && !loadedLists.includes(id))
  if (missingRequired.length > 0) throw new Error(`Required filter lists unavailable: ${missingRequired.join(', ')}`)
  if (texts.length === 0) throw new Error('No filter lists could be downloaded')

  const engine = ElectronBlocker.parse(texts.join('\n'), FULL_FILTER_CONFIG)
  engine.updateResources(resources, `surffish-${resources.length}`)
  applyFilterEnvironment(engine)
  return { engine, loadedLists, failedLists }
}

function domainParts(url: string): { hostname: string; domain: string } {
  const parsed = parseDomain(url)
  return { hostname: parsed.hostname ?? '', domain: parsed.domain ?? parsed.hostname ?? '' }
}

const INACTIVE_PAYLOAD: FrameStartPayload = Object.freeze({ active: false, styles: '', scripts: [], observe: false }) as FrameStartPayload
/** Distinct hostname/exception combinations remembered per engine (one per site the user has open, plus their iframes). */
export const FRAME_PAYLOAD_CACHE_SIZE = 256
const payloadCache = new WeakMap<ElectronBlocker, Map<string, FrameStartPayload>>()

type HideException = { isImportant(): boolean; isException(): boolean; isGenericHide(): boolean; isSpecificHide(): boolean; getId(): number }

/** Ghostery's findApplicableHideException (engine.js): `$important,Xhide` > `$Xhide` > `@@$Xhide`; only an exception disables. */
function applicableHideException(filters: readonly HideException[]): HideException | undefined {
  let hideFilter: HideException | undefined
  let currentScore = 0
  for (const filter of filters) {
    const score = (filter.isImportant() ? 4 : 0) | (filter.isException() ? 1 : 2)
    if (score >= currentScore) {
      currentScore = score
      hideFilter = filter
    }
  }
  return hideFilter?.isException() ? hideFilter : undefined
}

/**
 * The `$elemhide` / `$generichide` / `$specifichide` exceptions that apply to this frame URL, the
 * only URL-dependent input to the hostname cosmetics (they can name paths), so it is part of the
 * cache key. Uses the same request shape as Ghostery's matchCosmeticFilters. null = can't tell (no cache).
 */
function hideExceptionState(engine: ElectronBlocker, url: string, hostname: string, domain: string): { key: string; allowGenericHides: boolean } | null {
  try {
    // Engine internals (stable across Ghostery 2.x); without them there is simply no cache.
    const internals = engine as unknown as {
      hideExceptions?: { matchAll?: (request: Request, excluded: (filter: unknown) => boolean) => HideException[] }
      isFilterExcluded?: (filter: unknown) => boolean
    }
    const bucket = internals.hideExceptions
    if (typeof bucket?.matchAll !== 'function' || typeof internals.isFilterExcluded !== 'function') return null
    const request = Request.fromRawDetails({ domain, hostname, url, sourceDomain: '', sourceHostname: '', sourceUrl: '' })
    const matched = bucket.matchAll(request, internals.isFilterExcluded.bind(engine))
    const key = matched.map((filter) => filter.getId()).sort((a, b) => a - b).join(',')
    return { key, allowGenericHides: applicableHideException(matched.filter((filter) => filter.isGenericHide())) === undefined }
  } catch {
    return null
  }
}

function computeFrameStartPayload(engine: ElectronBlocker, url: string, hostname: string, domain: string, allowGenericHides: boolean): FrameStartPayload {
  const { active, styles, scripts } = engine.getCosmeticsFilters({
    url,
    hostname,
    domain,
    getBaseRules: true,
    getInjectionRules: true,
    getExtendedRules: false,
    getRulesFromHostname: true,
    getRulesFromDOM: false
  })
  if (active === false) return INACTIVE_PAYLOAD
  // DOM-driven generic rules are all the frame observer can add; with $generichide in force it would only cost IPC.
  const observe = engine.config.enableMutationObserver && allowGenericHides
  if (!styles && scripts.length === 0 && !observe) return INACTIVE_PAYLOAD
  const bundled = bundleScriptlets(scripts, (engine as unknown as { resources?: ScriptletResources }).resources)
  return Object.freeze({ active: true, styles, scripts: bundled.scripts, observe, scriptletCount: bundled.scriptletCount })
}

/**
 * Scriptlets + specific/generic base CSS for a frame's first paint. Cached per engine by hostname
 * (+ the hide exceptions for this URL), so every same-site frame and navigation reuses one payload
 * instead of re-matching and re-assembling scriptlets. A refreshed engine is a new cache.
 * `active: false` when nothing would be injected or observed, so the preload does nothing.
 */
export function frameStartPayload(engine: ElectronBlocker, url: string): FrameStartPayload {
  if (!isWebPageUrl(url)) return INACTIVE_PAYLOAD
  const { hostname, domain } = domainParts(url)
  const hide = hideExceptionState(engine, url, hostname, domain)
  if (!hide) return computeFrameStartPayload(engine, url, hostname, domain, true)
  let cache = payloadCache.get(engine)
  if (!cache) {
    cache = new Map()
    payloadCache.set(engine, cache)
  }
  const key = `${hostname}\u0000${domain}\u0000${hide.key}`
  const hit = cache.get(key)
  if (hit) {
    // Least recently used goes first when the cache is full.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const payload = computeFrameStartPayload(engine, url, hostname, domain, hide.allowGenericHides)
  cache.set(key, payload)
  if (cache.size > FRAME_PAYLOAD_CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return payload
}

function stringList(value: unknown, limit = 2000): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && item.length <= 2048) items.push(item)
    if (items.length >= limit) break
  }
  return items
}

/** Generic cosmetic CSS matched against classes/ids/hrefs the page actually uses. */
export function frameUpdateStyles(engine: ElectronBlocker, url: string, features: FrameDomFeatures): string {
  if (!isWebPageUrl(url)) return ''
  const { hostname, domain } = domainParts(url)
  const { active, styles } = engine.getCosmeticsFilters({
    url,
    hostname,
    domain,
    classes: stringList(features?.classes),
    ids: stringList(features?.ids),
    hrefs: stringList(features?.hrefs),
    getBaseRules: false,
    getInjectionRules: false,
    getExtendedRules: false,
    getRulesFromHostname: false,
    getRulesFromDOM: true
  })
  return active === false ? '' : styles
}
