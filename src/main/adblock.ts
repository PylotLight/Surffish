import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { adsLists, ElectronBlocker, type Fetch } from '@ghostery/adblocker-electron'
import { getBrowserSession } from './browser-session'

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FILTER_FETCH_TIMEOUT_MS = 2500
const NETWORK_ONLY_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: false,
  loadCSPFilters: false,
  enableHtmlFiltering: false,
  enableMutationObserver: false,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false
} as const

let initialization: Promise<void> | null = null

function cachePath(): string {
  return join(app.getPath('userData'), 'adblock-engine.bin')
}

function isNetworkOnly(blocker: ElectronBlocker): boolean {
  return blocker.config.loadNetworkFilters &&
    !blocker.config.loadCosmeticFilters &&
    !blocker.config.loadCSPFilters &&
    !blocker.config.enableHtmlFiltering &&
    !blocker.config.enableMutationObserver &&
    !blocker.config.loadExtendedSelectors &&
    !blocker.config.loadGenericCosmeticsFilters
}

function readCache(): { blocker: ElectronBlocker; fresh: boolean } | null {
  try {
    const file = cachePath()
    const modifiedAt = statSync(file).mtimeMs
    const blocker = ElectronBlocker.deserialize(readFileSync(file))
    if (!isNetworkOnly(blocker)) return null
    return {
      blocker,
      fresh: Date.now() - modifiedAt < CACHE_MAX_AGE_MS
    }
  } catch {
    return null
  }
}

function writeCache(blocker: ElectronBlocker): void {
  const file = cachePath()
  const temporaryFile = `${file}.tmp`
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(temporaryFile, blocker.serialize(), { mode: 0o600 })
  renameSync(temporaryFile, file)
}

const fetchThroughBrowserSession: Fetch = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FILTER_FETCH_TIMEOUT_MS)
  try {
    // Session.fetch uses Chromium's network stack, so filter updates obey the
    // same SOCKS proxy configured for browser tabs instead of escaping via Node fetch.
    const response = await getBrowserSession().fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Filter-list request failed (${response.status} ${response.statusText}): ${url}`)
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function initialize(): Promise<void> {
  const browserSession = getBrowserSession()
  const cached = readCache()
  let blocker = cached?.blocker

  if (!cached?.fresh) {
    let refreshed: ElectronBlocker | null = null
    try {
      // fromPrebuiltAdsOnly does not expose its engine config. Use the same
      // maintained ads-only list set with fromLists so visual filters stay off.
      refreshed = await ElectronBlocker.fromLists(fetchThroughBrowserSession, adsLists, NETWORK_ONLY_CONFIG)
    } catch (error) {
      if (cached) {
        blocker = cached.blocker
        console.warn('Ad-filter update failed; using the last cached network filter engine:', error)
      } else {
        console.warn('Ad-filter lists are unavailable; starting without network ad filtering:', error)
        blocker = ElectronBlocker.empty(NETWORK_ONLY_CONFIG)
      }
    }
    if (refreshed) {
      blocker = refreshed
      try {
        writeCache(refreshed)
      } catch (error) {
        console.warn('Could not cache the refreshed ad-filter engine:', error)
      }
    }
  }

  if (!blocker) blocker = ElectronBlocker.empty(NETWORK_ONLY_CONFIG)

  try {
    // Electron has one webRequest listener per event. Keep this as the sole
    // request-interception owner for the browser session; SOCKS uses setProxy separately.
    blocker.enableBlockingInSession(browserSession)
    console.info('Network-only ad filtering is active for the Sockfish browser session.')
  } catch (error) {
    console.warn('Could not enable network ad filtering; the browser will continue without it:', error)
  }
}

/** Initialize after the SOCKS settings and before creating any remote browser page. */
export function initializeNetworkAdblock(): Promise<void> {
  initialization ??= initialize()
  return initialization
}
