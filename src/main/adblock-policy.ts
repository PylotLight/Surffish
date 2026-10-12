/**
 * Pure filter-engine policy shared by the Electron main process and Node tests.
 * Nothing here imports Electron.
 */

/**
 * Full uBlock Origin-style engine: network rules, CSP rules, cosmetic hiding
 * and scriptlet injection (`##+js(...)`). YouTube ad removal depends on the
 * scriptlets, so they must stay on. HTML filtering stays off because Electron
 * cannot rewrite response bodies.
 */
export const FULL_FILTER_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadCSPFilters: true,
  enableHtmlFiltering: false,
  enableMutationObserver: true,
  // Procedural selectors (:has-text, :upward, …) need an in-page engine that
  // Ghostery's Electron path does not ship; leave them out instead of loading dead rules.
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: true,
  // Evaluate uBO `!#if env_*` blocks against FILTER_ENVIRONMENT instead of
  // loading Firefox/Safari/uBO Lite-only rules.
  loadPreprocessors: true,
  enableCompression: false,
  enableOptimizations: true
} as const

type FilterConfiguration = {
  loadNetworkFilters: boolean
  loadCosmeticFilters: boolean
  loadCSPFilters: boolean
  enableHtmlFiltering: boolean
  enableMutationObserver: boolean
  loadExtendedSelectors: boolean
  loadGenericCosmeticsFilters: boolean
  loadPreprocessors: boolean
}

export function isFullFilterConfig(config: FilterConfiguration): boolean {
  return config.loadNetworkFilters &&
    config.loadCosmeticFilters &&
    config.loadCSPFilters &&
    !config.enableHtmlFiltering &&
    config.enableMutationObserver &&
    !config.loadExtendedSelectors &&
    config.loadGenericCosmeticsFilters &&
    config.loadPreprocessors
}

export interface FilterListSource {
  id: string
  url: string
}

const UASSETS = 'https://ublockorigin.github.io/uAssets'

/**
 * uBlock Origin's own default subscriptions, fetched from the same origin uBO
 * itself uses (not the Ghostery mirror, which can lag uBO by weeks). `!#include`
 * directives (filters.txt pulls in filters-2020…2026, filters-general, …) are
 * expanded by the fetcher.
 */
export const FILTER_LIST_SOURCES: readonly FilterListSource[] = [
  { id: 'ublock-filters', url: `${UASSETS}/filters/filters.txt` },
  { id: 'ublock-badware', url: `${UASSETS}/filters/badware.txt` },
  { id: 'ublock-privacy', url: `${UASSETS}/filters/privacy.txt` },
  { id: 'ublock-unbreak', url: `${UASSETS}/filters/unbreak.txt` },
  { id: 'ublock-quick-fixes', url: `${UASSETS}/filters/quick-fixes.txt` },
  { id: 'ublock-resource-abuse', url: `${UASSETS}/filters/resource-abuse.txt` },
  { id: 'easylist', url: `${UASSETS}/thirdparties/easylist.txt` },
  { id: 'easyprivacy', url: `${UASSETS}/thirdparties/easyprivacy.txt` },
  { id: 'peter-lowe', url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext' },
  { id: 'urlhaus', url: 'https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt' }
]

/** Lists the engine cannot work without; if any is missing the update fails and the old engine stays. */
export const REQUIRED_FILTER_LIST_IDS: readonly string[] = ['ublock-filters', 'ublock-quick-fixes', 'easylist']

/** Scriptlet + redirect resources (uBO's scriptlets packaged by Ghostery). */
export const SCRIPTLET_RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

/** uBO's quick-fixes list declares an 8 hour expiry; YouTube fixes ship there. */
export const FILTER_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000

/** Hard cap on `!#include` expansion so a malformed list cannot loop. */
export const MAX_INCLUDE_DEPTH = 2

/**
 * `!#if` environment for uBO lists. Surffish is Chromium, MV2-style (blocking
 * webRequest), desktop, and has no HTML filtering.
 */
export const FILTER_ENVIRONMENT: ReadonlyArray<readonly [string, boolean]> = [
  ['env_chromium', true],
  ['env_chrome', true],
  ['env_firefox', false],
  ['env_safari', false],
  ['env_edge', false],
  ['env_mobile', false],
  ['env_mv3', false],
  ['ext_ubol', false],
  ['ext_ublock', true],
  ['cap_html_filtering', false],
  ['cap_user_stylesheet', true],
  ['cap_ipaddress', false],
  ['adguard', false],
  ['adguard_app_android', false],
  ['adguard_ext_chromium', false]
]

/**
 * Ghostery's scriptlet wrapper runs `decodeURIComponent` on every argument
 * (its own list mirror pre-encodes them). Raw uBO lists contain literal `%`
 * in some arguments (including a YouTube rule), which would throw a URIError
 * and kill that scriptlet. Escape `%` inside `+js(...)` arguments only.
 */
export function prepareFilterListText(text: string): string {
  if (!text.includes('+js(')) return text
  return text.split(/\r?\n/).map((line) => {
    const marker = line.indexOf('##+js(')
    const exceptionMarker = line.indexOf('#@#+js(')
    const start = marker !== -1 ? marker + 6 : exceptionMarker !== -1 ? exceptionMarker + 7 : -1
    if (start === -1 || line.startsWith('!')) return line
    const body = line.slice(start)
    if (!body.includes('%')) return line
    return line.slice(0, start) + body.replace(/%/g, '%25')
  }).join('\n')
}

/** Same-origin `!#include file.txt` targets of a list, resolved against its URL. */
export function extractIncludes(text: string, listUrl: string): string[] {
  let base: URL
  try {
    base = new URL(listUrl)
  } catch {
    return []
  }
  const includes: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('!#include ')) continue
    const target = line.slice('!#include '.length).trim()
    if (!target) continue
    try {
      const resolved = new URL(target, base)
      if (resolved.origin !== base.origin) continue
      includes.push(resolved.toString())
    } catch {
      continue
    }
  }
  return includes
}

export function isProtectedVideoDeliveryUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const host = new URL(value).hostname
    return host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
  } catch {
    return false
  }
}

export function isWebPageUrl(value: string | undefined | null): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Drop Electron's `Electron/x` and app-name tokens so sites see plain Chrome. */
export function chromeUserAgent(value: string): string {
  return value
    .replace(/\s(?:Electron|surffish)\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function hostMatches(host: string, exemptHosts: ReadonlySet<string>): boolean {
  for (const exempt of exemptHosts) {
    if (host === exempt || host.endsWith(`.${exempt}`)) return true
  }
  return false
}

/**
 * Requests the ad blocker must leave alone: extension resources (chrome-extension://), requests an
 * extension page or worker makes, and hosts installed extensions depend on (extensionpay.com for
 * ExtPay-based extensions, supplied by the extension installer).
 */
export function isExtensionExemptRequest(
  details: { url?: string; referrer?: string; initiator?: string; frameUrl?: string },
  exemptHosts: ReadonlySet<string>
): boolean {
  const sources = [details.url, details.referrer, details.initiator, details.frameUrl]
  if (sources.some((value) => typeof value === 'string' && value.startsWith('chrome-extension://'))) return true
  if (exemptHosts.size === 0 || !details.url) return false
  try {
    const url = new URL(details.url)
    if (hostMatches(url.hostname.toLowerCase(), exemptHosts)) return true
  } catch {
    return false
  }
  // Pages on an exempt host (the extension's payment page) load their own resources unblocked too.
  if (details.referrer) {
    try {
      if (hostMatches(new URL(details.referrer).hostname.toLowerCase(), exemptHosts)) return true
    } catch {
      // Not a URL; fall through.
    }
  }
  return false
}
