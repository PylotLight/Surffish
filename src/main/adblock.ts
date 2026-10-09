import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { adsLists, ElectronBlocker, type Fetch } from '@ghostery/adblocker-electron'
import { getBrowserSession } from './browser-session'
import { getMainWindow } from './window'
import type { AdblockDiagnostics, AdblockBlockedRequest } from '../shared/types'

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FILTER_FETCH_TIMEOUT_MS = 2500
const MAX_RECENT_BLOCKS = 20
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
let refreshInProgress: Promise<void> | null = null
let activeBlocker: ElectronBlocker | null = null
let notificationTimer: ReturnType<typeof setTimeout> | null = null
let diagnostics: AdblockDiagnostics = {
  status: 'starting',
  blockingEnabled: false,
  source: 'none',
  lastUpdatedAt: null,
  blockedRequests: 0,
  allowedRequests: 0,
  networkFilterCount: 0,
  loadedListCount: 0,
  loadedLists: [],
  recentBlockedRequests: [],
  lastError: null
}

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

function readCache(): { blocker: ElectronBlocker; fresh: boolean; modifiedAt: number } | null {
  try {
    const file = cachePath()
    const modifiedAt = statSync(file).mtimeMs
    const blocker = ElectronBlocker.deserialize(readFileSync(file))
    if (!isNetworkOnly(blocker)) return null
    return {
      blocker,
      modifiedAt,
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

function listLabel(value: string): string {
  try {
    const filename = new URL(value).pathname.split('/').pop()
    return filename?.replace(/\.txt$/i, '') || new URL(value).hostname
  } catch {
    return value
  }
}

function hostFromUrl(value: string | undefined): string {
  if (!value) return 'unknown'
  try {
    return new URL(value).hostname || 'unknown'
  } catch {
    return 'unknown'
  }
}

function isProtectedVideoDelivery(details: Parameters<ElectronBlocker['onBeforeRequest']>[0]): boolean {
  const host = hostFromUrl(details.url)
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
}

function diagnosticsSnapshot(): AdblockDiagnostics {
  return {
    ...diagnostics,
    loadedLists: [...diagnostics.loadedLists],
    recentBlockedRequests: diagnostics.recentBlockedRequests.map((entry) => ({ ...entry }))
  }
}

function broadcastDiagnostics(): void {
  const contents = getMainWindow()?.webContents
  if (contents && !contents.isDestroyed()) contents.send('browser:adblock:changed', diagnosticsSnapshot())
}

function scheduleDiagnosticsBroadcast(): void {
  if (notificationTimer) return
  notificationTimer = setTimeout(() => {
    notificationTimer = null
    broadcastDiagnostics()
  }, 1000)
}

function updateEngineMetadata(blocker: ElectronBlocker): void {
  const loadedLists = blocker.loadedLists().map(listLabel)
  diagnostics.networkFilterCount = blocker.getFilters().networkFilters.length
  diagnostics.loadedListCount = loadedLists.length
  diagnostics.loadedLists = loadedLists
}

function recordRequest(details: Parameters<ElectronBlocker['onBeforeRequest']>[0], response: Parameters<Parameters<ElectronBlocker['onBeforeRequest']>[1]>[0]): void {
  if (details.resourceType === 'mainFrame') return

  if (response.cancel || response.redirectURL) {
    diagnostics.blockedRequests += 1
    const entry: AdblockBlockedRequest = {
      timestamp: Date.now(),
      requestHost: hostFromUrl(details.url),
      pageHost: hostFromUrl(details.referrer),
      resourceType: details.resourceType
    }
    diagnostics.recentBlockedRequests = [entry, ...diagnostics.recentBlockedRequests].slice(0, MAX_RECENT_BLOCKS)
  } else {
    diagnostics.allowedRequests += 1
  }
  scheduleDiagnosticsBroadcast()
}

function activateBlocker(next: ElectronBlocker): void {
  const session = getBrowserSession()
  const previous = activeBlocker
  if (previous?.isBlockingEnabled(session)) previous.disableBlockingInSession(session)

  const originalOnBeforeRequest = next.onBeforeRequest.bind(next)
  next.onBeforeRequest = (details, callback) => {
    if (isProtectedVideoDelivery(details)) {
      // YouTube serves both ads and wanted video chunks through these hosts.
      // Let them pass rather than risking interrupted playback.
      recordRequest(details, {})
      callback({})
      return
    }
    originalOnBeforeRequest(details, (response) => {
      recordRequest(details, response)
      callback(response)
    })
  }

  try {
    next.enableBlockingInSession(session)
    activeBlocker = next
    diagnostics.blockingEnabled = true
    updateEngineMetadata(next)
  } catch (error) {
    if (previous) {
      try {
        previous.enableBlockingInSession(session)
        activeBlocker = previous
        diagnostics.blockingEnabled = true
        updateEngineMetadata(previous)
      } catch (restoreError) {
        activeBlocker = null
        diagnostics.blockingEnabled = false
        diagnostics.lastError = `Could not restore previous filters: ${errorMessage(restoreError)}`
      }
    } else {
      activeBlocker = null
      diagnostics.blockingEnabled = false
    }
    throw error
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 300)
}

async function refreshFilters(): Promise<void> {
  const previous = activeBlocker
  diagnostics.status = previous ? 'updating' : 'starting'
  diagnostics.lastError = null
  broadcastDiagnostics()

  try {
    // fromPrebuiltAdsOnly does not expose its engine config. Use the same
    // maintained ads-only list set with fromLists so visual filters stay off.
    const refreshed = await ElectronBlocker.fromLists(fetchThroughBrowserSession, adsLists, NETWORK_ONLY_CONFIG)
    activateBlocker(refreshed)
    diagnostics.source = 'updated'
    diagnostics.lastUpdatedAt = Date.now()
    diagnostics.status = 'active'
    diagnostics.lastError = null
    try {
      writeCache(refreshed)
    } catch (error) {
      diagnostics.lastError = `Filters updated, but the local cache could not be saved: ${errorMessage(error)}`
    }
  } catch (error) {
    diagnostics.lastError = errorMessage(error)
    if (previous && activeBlocker === previous && diagnostics.blockingEnabled) {
      diagnostics.status = diagnostics.source === 'empty' ? 'degraded' : 'active'
    } else {
      const emptyBlocker = ElectronBlocker.empty(NETWORK_ONLY_CONFIG)
      try {
        activateBlocker(emptyBlocker)
      } catch (activationError) {
        diagnostics.lastError = `${diagnostics.lastError}; could not enable the empty fallback engine: ${errorMessage(activationError)}`
      }
      diagnostics.source = 'empty'
      diagnostics.status = 'degraded'
    }
    console.warn('Ad-filter update failed; continuing with the available network filter engine:', error)
  }
  broadcastDiagnostics()
}

async function initialize(): Promise<void> {
  const cached = readCache()
  if (cached) {
    try {
      activateBlocker(cached.blocker)
      diagnostics.source = cached.fresh ? 'cache' : 'stale-cache'
      diagnostics.lastUpdatedAt = cached.modifiedAt
      diagnostics.status = 'active'
    } catch (error) {
      diagnostics.lastError = `Could not enable the cached filter engine: ${errorMessage(error)}`
      console.warn('Could not enable the cached network ad-filter engine:', error)
    }
  }

  if (cached?.fresh && activeBlocker) {
    broadcastDiagnostics()
    return
  }

  await refreshFilters()
}

/** Initialize after the SOCKS settings and before creating any remote browser page. */
export function initializeNetworkAdblock(): Promise<void> {
  initialization ??= initialize()
  return initialization
}

/** Return aggregate request counts and a short, URL-path-free list of recent matches. */
export function getAdblockDiagnostics(): AdblockDiagnostics {
  return diagnosticsSnapshot()
}

/** Fetch maintained ads-only lists now while the currently active engine keeps blocking. */
export async function refreshNetworkAdblock(): Promise<AdblockDiagnostics> {
  await initializeNetworkAdblock()
  refreshInProgress ??= refreshFilters().finally(() => { refreshInProgress = null })
  await refreshInProgress
  return diagnosticsSnapshot()
}
