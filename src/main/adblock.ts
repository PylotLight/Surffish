import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { FILTER_REFRESH_INTERVAL_MS, isFullFilterConfig, isWebPageUrl } from './adblock-policy.ts'
import { getExtensionAdblockExemptHosts } from './extension-adblock-exemptions'
import {
  applyFilterEnvironment,
  attachAdblockToSession,
  buildFilterEngine,
  type BeforeRequestDetails,
  type BeforeRequestResponse,
  type FrameStartPayload,
  type HeadersReceivedDetails,
  type ListFetch
} from './adblock-engine.ts'
import { getBrowserSession } from './browser-session'
import { sendToMainWindowRenderers } from './browser-shell'
import { getBrowserSiteSettings } from './browser-persistence'
import { getBrowserTabUrlByWebContentsId } from './browser'
import type { AdblockDiagnostics, AdblockBlockedRequest } from '../shared/types'

const CACHE_FILE = 'adblock-engine-v2.bin'
const LEGACY_CACHE_FILES = ['adblock-engine.bin']
const FILTER_FETCH_TIMEOUT_MS = 20_000
const FIRST_RUN_WAIT_MS = 8_000
const MAX_RECENT_BLOCKS = 20
const mainDirectory = dirname(fileURLToPath(import.meta.url))

let initialization: Promise<void> | null = null
let refreshInProgress: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let activeBlocker: ElectronBlocker | null = null
let sessionAttached = false
let notificationTimer: ReturnType<typeof setTimeout> | null = null
let diagnostics: AdblockDiagnostics = {
  status: 'starting',
  blockingEnabled: false,
  source: 'none',
  lastUpdatedAt: null,
  blockedRequests: 0,
  allowedRequests: 0,
  networkFilterCount: 0,
  cosmeticFilterCount: 0,
  pageFixInjections: 0,
  loadedListCount: 0,
  loadedLists: [],
  recentBlockedRequests: [],
  lastError: null
}

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE)
}

function removeLegacyCaches(): void {
  for (const name of LEGACY_CACHE_FILES) {
    try {
      rmSync(join(app.getPath('userData'), name), { force: true })
    } catch {
      // Best effort only.
    }
  }
}

function resolveFramePreload(): string {
  // This module may be emitted as out/main/chunks/*.js, so look one and two
  // levels up for out/preload, then fall back to the source tree in dev.
  const candidates = [
    join(mainDirectory, '../preload/adblock-frame.cjs'),
    join(mainDirectory, '../../preload/adblock-frame.cjs'),
    join(app.getAppPath(), 'out/preload/adblock-frame.cjs'),
    join(app.getAppPath(), 'src/preload/adblock-frame.cjs')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

function readCache(): { blocker: ElectronBlocker; fresh: boolean; modifiedAt: number } | null {
  try {
    const file = cachePath()
    const modifiedAt = statSync(file).mtimeMs
    const blocker = ElectronBlocker.deserialize(readFileSync(file))
    if (!isFullFilterConfig(blocker.config)) return null
    applyFilterEnvironment(blocker)
    return {
      blocker,
      modifiedAt,
      fresh: Date.now() - modifiedAt < FILTER_REFRESH_INTERVAL_MS
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

const fetchThroughBrowserSession: ListFetch = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FILTER_FETCH_TIMEOUT_MS)
  try {
    // Session.fetch uses Chromium's network stack, so filter updates obey the
    // same SOCKS proxy configured for browser tabs instead of escaping via Node fetch.
    const response = await getBrowserSession().fetch(url, { signal: controller.signal, cache: 'no-cache' })
    if (!response.ok) throw new Error(`Filter-list request failed (${response.status} ${response.statusText}): ${url}`)
    // Read the body before the timeout is cleared so a stalled body also aborts.
    const body = await response.text()
    return new Response(body, { status: response.status, statusText: response.statusText })
  } finally {
    clearTimeout(timer)
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

function requestingPageUrl(details: BeforeRequestDetails | HeadersReceivedDetails): string {
  if (details.resourceType === 'mainFrame') return isWebPageUrl(details.url) ? details.url : ''
  const webContentsId = 'webContentsId' in details ? details.webContentsId : undefined
  const tabUrl = typeof webContentsId === 'number' ? getBrowserTabUrlByWebContentsId(webContentsId) : null
  const candidates = [tabUrl, details.referrer, 'initiatorOrigin' in details ? details.initiatorOrigin : undefined]
  return candidates.find(isWebPageUrl) ?? ''
}

function isBlockingDisabledForPage(pageUrl: string): boolean {
  return Boolean(pageUrl) && getBrowserSiteSettings(pageUrl)?.blockAds === false
}

function diagnosticsSnapshot(): AdblockDiagnostics {
  return {
    ...diagnostics,
    loadedLists: [...diagnostics.loadedLists],
    recentBlockedRequests: diagnostics.recentBlockedRequests.map((entry) => ({ ...entry }))
  }
}

function broadcastDiagnostics(): void {
  sendToMainWindowRenderers('browser:adblock:changed', diagnosticsSnapshot())
}

function scheduleDiagnosticsBroadcast(): void {
  if (notificationTimer) return
  notificationTimer = setTimeout(() => {
    notificationTimer = null
    broadcastDiagnostics()
  }, 1000)
}

function updateEngineMetadata(blocker: ElectronBlocker, loadedLists?: string[]): void {
  const filters = blocker.getFilters()
  diagnostics.networkFilterCount = filters.networkFilters.length
  diagnostics.cosmeticFilterCount = filters.cosmeticFilters.length
  const lists = loadedLists ?? blocker.loadedLists()
  diagnostics.loadedListCount = lists.length
  diagnostics.loadedLists = [...lists]
}

function recordRequest(details: BeforeRequestDetails, response: BeforeRequestResponse, pageUrl: string): void {
  if (details.resourceType === 'mainFrame') return

  if (response.cancel || response.redirectURL) {
    diagnostics.blockedRequests += 1
    const entry: AdblockBlockedRequest = {
      timestamp: Date.now(),
      requestHost: hostFromUrl(details.url),
      pageHost: hostFromUrl(pageUrl || details.referrer),
      resourceType: details.resourceType
    }
    diagnostics.recentBlockedRequests = [entry, ...diagnostics.recentBlockedRequests].slice(0, MAX_RECENT_BLOCKS)
  } else {
    diagnostics.allowedRequests += 1
  }
  scheduleDiagnosticsBroadcast()
}

function recordFrameStart(payload: FrameStartPayload): void {
  if (payload.scripts.length === 0) return
  diagnostics.pageFixInjections += payload.scripts.length
  scheduleDiagnosticsBroadcast()
}

function ensureSessionAttached(): void {
  if (sessionAttached) return
  attachAdblockToSession(getBrowserSession(), {
    getEngine: () => activeBlocker,
    pageUrlForRequest: requestingPageUrl,
    isBlockingDisabledForPage,
    onRequest: recordRequest,
    onFrameStart: recordFrameStart,
    getExemptHosts: getExtensionAdblockExemptHosts
  }, resolveFramePreload())
  sessionAttached = true
}

function activateBlocker(next: ElectronBlocker, loadedLists?: string[]): void {
  ensureSessionAttached()
  // The session handlers read activeBlocker on every request, so swapping the
  // reference is atomic: no window where requests go unfiltered.
  activeBlocker = next
  diagnostics.blockingEnabled = true
  updateEngineMetadata(next, loadedLists)
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
    const { engine, loadedLists, failedLists } = await buildFilterEngine(fetchThroughBrowserSession)
    activateBlocker(engine, loadedLists)
    diagnostics.source = 'updated'
    diagnostics.lastUpdatedAt = Date.now()
    diagnostics.status = 'active'
    diagnostics.lastError = failedLists.length > 0 ? `Some optional lists could not be downloaded: ${failedLists.join(', ')}` : null
    try {
      writeCache(engine)
      removeLegacyCaches()
    } catch (error) {
      diagnostics.lastError = `Filters updated, but the local cache could not be saved: ${errorMessage(error)}`
    }
  } catch (error) {
    diagnostics.lastError = errorMessage(error)
    if (previous && activeBlocker === previous) {
      diagnostics.status = diagnostics.source === 'empty' ? 'degraded' : 'active'
    } else {
      try {
        activateBlocker(ElectronBlocker.empty(), [])
      } catch (activationError) {
        diagnostics.blockingEnabled = false
        diagnostics.lastError = `${diagnostics.lastError}; could not enable the empty fallback engine: ${errorMessage(activationError)}`
      }
      diagnostics.source = 'empty'
      diagnostics.status = 'degraded'
    }
    console.warn('Ad-filter update failed; continuing with the available filter engine:', error)
  }
  broadcastDiagnostics()
}

function startRefreshTimer(): void {
  if (refreshTimer) return
  // uBO quick-fixes (where YouTube fixes land) expire every 8 hours.
  refreshTimer = setInterval(() => {
    void refreshNetworkAdblock().catch(() => {})
  }, FILTER_REFRESH_INTERVAL_MS)
  refreshTimer.unref?.()
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
      console.warn('Could not enable the cached ad-filter engine:', error)
    }
  }
  startRefreshTimer()

  if (cached && activeBlocker) {
    broadcastDiagnostics()
    // A stale cache keeps blocking while fresh lists download in the background.
    if (!cached.fresh) void refreshNetworkAdblock().catch(() => {})
    return
  }

  // First run: wait briefly for lists so the first page is filtered, but never
  // hold the window hostage on a slow proxy; the refresh keeps going.
  ensureSessionAttached()
  const firstRefresh = refreshNetworkAdblock().catch(() => {})
  await Promise.race([firstRefresh, new Promise((resolve) => setTimeout(resolve, FIRST_RUN_WAIT_MS))])
}

/** Initialize after the SOCKS settings and before creating any remote browser page. */
export function initializeNetworkAdblock(): Promise<void> {
  initialization ??= initialize()
  return initialization
}

/** Return aggregate counts and a short, URL-path-free list of recent matches. */
export function getAdblockDiagnostics(): AdblockDiagnostics {
  return diagnosticsSnapshot()
}

/** Fetch the latest uBO/EasyList lists now while the current engine keeps blocking. */
export async function refreshNetworkAdblock(): Promise<AdblockDiagnostics> {
  refreshInProgress ??= refreshFilters().finally(() => { refreshInProgress = null })
  await refreshInProgress
  return diagnosticsSnapshot()
}
