import { app, utilityProcess } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { ADBLOCK_CACHE_FILE, FILTER_REFRESH_INTERVAL_MS, isFullFilterConfig, isWebPageUrl } from './adblock-policy.ts'
import { getExtensionAdblockExemptHosts } from './extension-adblock-exemptions'
import {
  applyFilterEnvironment,
  attachAdblockToSession,
  type AdblockSessionHooks,
  type BeforeRequestDetails,
  type HeadersReceivedDetails,
  type ListFetch
} from './adblock-engine.ts'
import { getBrowserSession, onPageSessionCreated } from './browser-session'
import { getBrowserSiteSettings } from './browser-persistence'
import { getBrowserTabUrlByWebContentsId } from './browser'
import { noteAdblockRequest } from './adblock-stats'
import { compileFilterEngine, downloadFilterLists, type DownloadedFilterLists } from './adblock-filters.ts'

const CACHE_FILE = ADBLOCK_CACHE_FILE
const LEGACY_CACHE_FILES = ['adblock-engine.bin']
const FILTER_FETCH_TIMEOUT_MS = 20_000
const FIRST_RUN_WAIT_MS = 8_000
// Compiling uBO's default lists takes ~0.5 s on a laptop; a compiler that hasn't answered by then is stuck.
const COMPILE_TIMEOUT_MS = 60_000
const mainDirectory = dirname(fileURLToPath(import.meta.url))

let initialization: Promise<void> | null = null
let refreshInProgress: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let activeBlocker: ElectronBlocker | null = null
let sessionAttached = false

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

function readCache(): { blocker: ElectronBlocker; fresh: boolean } | null {
  try {
    const file = cachePath()
    const modifiedAt = statSync(file).mtimeMs
    const blocker = ElectronBlocker.deserialize(readFileSync(file))
    if (!isFullFilterConfig(blocker.config)) return null
    applyFilterEnvironment(blocker)
    return {
      blocker,
      fresh: Date.now() - modifiedAt < FILTER_REFRESH_INTERVAL_MS
    }
  } catch {
    return null
  }
}

function writeCache(bytes: Uint8Array): void {
  const file = cachePath()
  const temporaryFile = `${file}.tmp`
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(temporaryFile, bytes, { mode: 0o600 })
  renameSync(temporaryFile, file)
}

function compilerPath(): string | null {
  const path = join(mainDirectory, 'adblock-compiler.js')
  return existsSync(path) ? path : null
}

/**
 * Compile the lists in a short-lived utility process (adblock-compiler.ts) and return the serialized
 * engine: the parse's CPU time and garbage stay out of main. Rejects when the process can't run,
 * fails or hangs; the caller then compiles in main as before.
 */
function compileInUtilityProcess(lists: DownloadedFilterLists): Promise<Uint8Array> {
  const path = compilerPath()
  if (!path) return Promise.reject(new Error('adblock compiler script missing'))
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path, [], { serviceName: 'Surffish Ad Filter Compiler', stdio: 'ignore' })
    let settled = false
    const finish = (error: Error | null, bytes?: Uint8Array): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      if (error) reject(error)
      else resolve(bytes!)
    }
    const timer = setTimeout(() => finish(new Error('adblock compiler timed out')), COMPILE_TIMEOUT_MS)
    child.once('message', (message: { ok?: boolean; bytes?: unknown; error?: string }) => {
      if (message?.ok && message.bytes instanceof Uint8Array) finish(null, message.bytes)
      else finish(new Error(message?.error || 'adblock compiler failed'))
    })
    child.once('exit', (code) => finish(new Error(`adblock compiler exited (${code})`)))
    child.once('spawn', () => child.postMessage({ texts: lists.texts, resources: lists.resources }))
  })
}

/** Serialized engine for the lists, compiled off the main thread when possible. */
async function compileEngine(lists: DownloadedFilterLists): Promise<{ engine: ElectronBlocker; bytes: Uint8Array }> {
  try {
    const bytes = await compileInUtilityProcess(lists)
    return { engine: applyFilterEnvironment(ElectronBlocker.deserialize(bytes)), bytes }
  } catch (error) {
    console.warn('Ad-filter compiler process unavailable; compiling in the main process:', error)
    const engine = compileFilterEngine(lists)
    return { engine, bytes: engine.serialize() }
  }
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

function adblockHooks(): AdblockSessionHooks {
  return {
    getEngine: () => activeBlocker,
    pageUrlForRequest: requestingPageUrl,
    isBlockingDisabledForPage,
    // The toolbar button's per-tab blocked count (adblock-stats.ts).
    onRequest: noteAdblockRequest,
    getExemptHosts: getExtensionAdblockExemptHosts
  }
}

function ensureSessionAttached(): void {
  if (sessionAttached) return
  // Every page session (profile, private, Spaces with separate logins) gets the same filtering;
  // the engine reference is shared, so refreshes cover them all.
  void onPageSessionCreated((target) => {
    attachAdblockToSession(target, adblockHooks(), resolveFramePreload())
  })
  sessionAttached = true
}

function activateBlocker(next: ElectronBlocker): void {
  ensureSessionAttached()
  // The session handlers read activeBlocker on every request, so swapping the
  // reference is atomic: no window where requests go unfiltered.
  activeBlocker = next
}

async function refreshFilters(): Promise<void> {
  const previous = activeBlocker
  try {
    const { engine, bytes } = await compileEngine(await downloadFilterLists(fetchThroughBrowserSession))
    activateBlocker(engine)
    try {
      writeCache(bytes)
      removeLegacyCaches()
    } catch {
      // Filters updated; the local cache just could not be saved this time.
    }
  } catch (error) {
    if (!previous || activeBlocker !== previous) {
      try {
        activateBlocker(ElectronBlocker.empty())
      } catch {
        // No engine at all: requests pass unfiltered until the next refresh.
      }
    }
    console.warn('Ad-filter update failed; continuing with the available filter engine:', error)
  }
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
    } catch (error) {
      console.warn('Could not enable the cached ad-filter engine:', error)
    }
  }
  startRefreshTimer()

  if (cached && activeBlocker) {
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

/**
 * Hook the filter into every page session now (cheap); the engine itself loads in
 * initializeNetworkAdblock() after the first window is up, with page requests held until then.
 */
export function attachNetworkAdblock(): void {
  ensureSessionAttached()
}

/** Load the filter engine (cache or first download). Page requests are held until this settles. */
export function initializeNetworkAdblock(): Promise<void> {
  initialization ??= initialize()
  return initialization
}

/** Fetch the latest uBO/EasyList lists now while the current engine keeps blocking. */
async function refreshNetworkAdblock(): Promise<void> {
  refreshInProgress ??= refreshFilters().finally(() => { refreshInProgress = null })
  await refreshInProgress
}
