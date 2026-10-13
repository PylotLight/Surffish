import { app } from 'electron'
import { cancelDeferredWrite, deferWrite } from './deferred-writes'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  normalizeHttpOrigin,
  normalizeSidebarWidth,
  normalizePinnedSites,
  parseBrowserSiteSettings,
  normalizeBrowserSession,
  parseBrowserPreferences,
  parseBrowserSession,
  parseNewTabPreferences,
  normalizeCachedFaviconDataUrl,
  type BrowserPreferences,
  type SavedBrowserSession
} from '../shared/persistence'
import { normalizeWindowsSession, parseWindowsSession, serializeWindowsSession, type SavedWindowsSession, type SessionWindowInput } from '../shared/window-session'
import type { SavedWindowState } from '../shared/window-geometry'
import { isDefaultZoom, MAX_SAVED_SITE_ZOOMS, normalizeZoomFactor } from '../shared/zoom'
import { getFavouriteSites, saveFavouriteSites } from './bookmarks'
import type { BrowserPreferencesSnapshot, BrowserSiteSettings, NewTabPageId, NewTabPreferences, PinnedSite, SearchEngineId, TabSleepMinutes } from '../shared/types'

const SESSION_FILE = 'browser-session.json'
const PREFERENCES_FILE = 'browser-preferences.json'
const SITE_ICON_CACHE_FILE = 'browser-site-icons.json'
const MAX_CACHED_SITE_ICONS = 128
let preferencesLoaded = false
let preferences: BrowserPreferences = parseBrowserPreferences(null)
let sessionPersistenceDisabled = false
let siteIconsLoaded = false
const cachedSiteIcons = new Map<string, string>()

function readJson(filename: string): unknown {
  const path = join(app.getPath('userData'), filename)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    console.warn(`Could not read ${filename}:`, error)
    return null
  }
}

function writeJson(filename: string, value: unknown): boolean {
  const directory = app.getPath('userData')
  const path = join(directory, filename)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    return true
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }) } catch { /* best-effort cleanup */ }
    console.error(`Could not save ${filename}:`, error)
    return false
  }
}

function loadCachedSiteIcons(): void {
  if (siteIconsLoaded) return
  siteIconsLoaded = true
  const value: unknown = readJson(SITE_ICON_CACHE_FILE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.icons !== 'object' || record.icons === null || Array.isArray(record.icons)) return
  for (const [originInput, iconInput] of Object.entries(record.icons as Record<string, unknown>).slice(-MAX_CACHED_SITE_ICONS)) {
    const origin = normalizeHttpOrigin(originInput)
    const icon = normalizeCachedFaviconDataUrl(iconInput)
    if (origin && icon) cachedSiteIcons.set(origin, icon)
  }
}

export function getCachedBrowserSiteFavicon(originInput: unknown): string | null {
  loadCachedSiteIcons()
  const origin = normalizeHttpOrigin(originInput)
  return origin ? cachedSiteIcons.get(origin) ?? null : null
}

export function getBrowserSiteFaviconCache(originsInput: unknown): Record<string, string> {
  loadCachedSiteIcons()
  if (!Array.isArray(originsInput)) return {}
  const icons: Record<string, string> = {}
  for (const originInput of originsInput.slice(0, MAX_CACHED_SITE_ICONS)) {
    const origin = normalizeHttpOrigin(originInput)
    const icon = origin ? cachedSiteIcons.get(origin) : undefined
    if (origin && icon) icons[origin] = icon
  }
  return icons
}

export function saveBrowserSiteFavicon(originInput: unknown, iconInput: unknown): string | null {
  loadCachedSiteIcons()
  const origin = normalizeHttpOrigin(originInput)
  const icon = normalizeCachedFaviconDataUrl(iconInput)
  if (!origin || !icon) return null
  cachedSiteIcons.delete(origin)
  cachedSiteIcons.set(origin, icon)
  while (cachedSiteIcons.size > MAX_CACHED_SITE_ICONS) {
    const oldest = cachedSiteIcons.keys().next().value as string | undefined
    if (!oldest) break
    cachedSiteIcons.delete(oldest)
  }
  deferWrite('site-icons', () => writeJson(SITE_ICON_CACHE_FILE, { version: 1, icons: Object.fromEntries(cachedSiteIcons) }), 2000)
  return icon
}

export function loadBrowserSession(): SavedBrowserSession {
  const saved = parseBrowserSession(readJson(SESSION_FILE))
  writeJson(SESSION_FILE, { version: 1, tabs: saved.urls, activeIndex: saved.activeIndex, pinnedTabs: saved.pinnedIndexes })
  return saved
}

export function saveBrowserSession(urls: readonly string[], activeIndex: number, pinnedIndexes: readonly number[] = []): void {
  if (sessionPersistenceDisabled) return
  const saved = normalizeBrowserSession(urls, activeIndex, pinnedIndexes)
  deferWrite('session', () => {
    if (!sessionPersistenceDisabled) writeJson(SESSION_FILE, { version: 1, tabs: saved.urls, activeIndex: saved.activeIndex, pinnedTabs: saved.pinnedIndexes })
  }, 600)
}

/** Every window's tabs (multi-window session); the file stays readable as a one-window session by older builds. */
export function loadBrowserWindowsSession(legacyGeometry: SavedWindowState | null): SavedWindowsSession {
  const raw = readJson(SESSION_FILE)
  const session = parseWindowsSession(raw, legacyGeometry)
  // Rewrite the file at startup so a session saved by an older build (credential-like URL parts,
  // world-readable mode) is sanitized and owner-only right away, not only after the next tab change.
  if (raw !== null && raw !== undefined) writeJson(SESSION_FILE, serializeWindowsSession(normalizeWindowsSession(session.windows, session.focusedIndex)))
  return session
}

export function saveBrowserWindowsSession(windows: readonly SessionWindowInput[], focusedIndex: number): void {
  if (sessionPersistenceDisabled) return
  const saved = normalizeWindowsSession(windows, focusedIndex)
  deferWrite('session', () => {
    if (!sessionPersistenceDisabled) writeJson(SESSION_FILE, serializeWindowsSession(saved))
  }, 600)
}

/** Clear the on-disk restore list without closing current tabs or re-saving them during this run. */
export function clearSavedBrowserSession(): boolean {
  cancelDeferredWrite('session')
  const cleared = writeJson(SESSION_FILE, { version: 1, tabs: [], activeIndex: 0, pinnedTabs: [] })
  if (cleared) sessionPersistenceDisabled = true
  return cleared
}

export function getBrowserSearchEngine(): SearchEngineId {
  if (!preferencesLoaded) {
    preferences = parseBrowserPreferences(readJson(PREFERENCES_FILE))
    preferencesLoaded = true
  }
  return preferences.searchEngine
}

export function saveBrowserSearchEngine(searchEngine: SearchEngineId): void {
  loadPreferencesIfNeeded()
  preferences = { ...preferences, searchEngine }
  savePreferences()
}

export function getBrowserTabSleepMinutes(): TabSleepMinutes {
  loadPreferencesIfNeeded()
  return preferences.tabSleepMinutes
}

export function saveBrowserTabSleepMinutes(tabSleepMinutes: TabSleepMinutes): void {
  loadPreferencesIfNeeded()
  preferences = { ...preferences, tabSleepMinutes }
  savePreferences()
}

export function getBrowserNewTabPage(): NewTabPageId {
  loadPreferencesIfNeeded()
  return preferences.newTabPage
}

export function saveBrowserNewTabPage(value: unknown): NewTabPageId | null {
  if (value !== 'bonjourr' && value !== 'search') return null
  loadPreferencesIfNeeded()
  preferences = { ...preferences, newTabPage: value }
  savePreferences()
  return preferences.newTabPage
}

export function getBrowserNewTabPreferences(): NewTabPreferences {
  loadPreferencesIfNeeded()
  return { ...preferences.newTabPreferences, worldClocks: preferences.newTabPreferences.worldClocks.map((clock) => ({ ...clock })) }
}

export function saveBrowserNewTabPreferences(value: unknown): NewTabPreferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  loadPreferencesIfNeeded()
  preferences = { ...preferences, newTabPreferences: parseNewTabPreferences(value) }
  savePreferences()
  return getBrowserNewTabPreferences()
}

/** The pinned strip is now the first bookmarks of the Favourites folder (see bookmarks.ts). */
export function getBrowserPinnedSites(): PinnedSite[] {
  return getFavouriteSites()
}

export function getBrowserSidebarWidth(): number {
  loadPreferencesIfNeeded()
  return preferences.sidebarWidth
}

export function saveBrowserSidebarWidth(value: unknown): number {
  loadPreferencesIfNeeded()
  preferences = { ...preferences, sidebarWidth: normalizeSidebarWidth(value) }
  savePreferences()
  return preferences.sidebarWidth
}

export function getBrowserPreferencesSnapshot(): BrowserPreferencesSnapshot {
  return {
    searchEngine: getBrowserSearchEngine(),
    tabSleepMinutes: getBrowserTabSleepMinutes(),
    newTabPage: getBrowserNewTabPage(),
    newTabPreferences: getBrowserNewTabPreferences(),
    pinnedSites: getBrowserPinnedSites(),
    sidebarWidth: getBrowserSidebarWidth()
  }
}

export function saveBrowserPinnedSites(value: unknown): PinnedSite[] {
  // The legacy preferences copy is left as it was at migration, so an older build still has a strip.
  return saveFavouriteSites(normalizePinnedSites(value))
}

export function getBrowserSiteSettings(value: unknown): BrowserSiteSettings | null {
  const origin = normalizeHttpOrigin(value)
  if (!origin) return null
  loadPreferencesIfNeeded()
  return { ...(preferences.siteSettings[origin] ?? parseBrowserSiteSettings(origin, {})!) }
}

export function saveBrowserSiteSettings(origin: unknown, value: unknown): BrowserSiteSettings | null {
  const settings = parseBrowserSiteSettings(origin, value)
  if (!settings) return null
  loadPreferencesIfNeeded()
  preferences = { ...preferences, siteSettings: { ...preferences.siteSettings, [settings.origin]: settings } }
  savePreferences()
  return { ...settings }
}

/** Saved page zoom for a site (1 when none), applied when a tab navigates to that origin. */
export function getBrowserSiteZoom(value: unknown): number {
  const origin = normalizeHttpOrigin(value)
  if (!origin) return 1
  loadPreferencesIfNeeded()
  return preferences.siteZoom[origin] ?? 1
}

export function saveBrowserSiteZoom(value: unknown, factorInput: unknown): number | null {
  const origin = normalizeHttpOrigin(value)
  const factor = normalizeZoomFactor(factorInput)
  if (!origin || factor === null) return null
  loadPreferencesIfNeeded()
  const current = preferences.siteZoom[origin] ?? 1
  if (current === factor) return factor
  // Most recently changed last, so the oldest drop off first once the cap is reached.
  const next = { ...preferences.siteZoom }
  delete next[origin]
  if (!isDefaultZoom(factor)) next[origin] = factor
  const entries = Object.entries(next)
  preferences = { ...preferences, siteZoom: Object.fromEntries(entries.slice(-MAX_SAVED_SITE_ZOOMS)) }
  deferWrite('preferences:site-zoom', () => savePreferences(), 800)
  return factor
}

function loadPreferencesIfNeeded(): void {
  if (preferencesLoaded) return
  preferences = parseBrowserPreferences(readJson(PREFERENCES_FILE))
  preferencesLoaded = true
}

function savePreferences(): void {
  preferencesLoaded = true
  writeJson(PREFERENCES_FILE, { version: 1, ...preferences })
}

/** Reset site permissions and settings to defaults for these origins (null = every site). */
export function resetBrowserSiteSettings(origins: readonly string[] | null): number {
  loadPreferencesIfNeeded()
  const current = preferences.siteSettings
  const drop = origins === null ? Object.keys(current) : origins.map(normalizeHttpOrigin).filter((origin): origin is string => origin !== null && origin in current)
  if (drop.length === 0) return 0
  const next = { ...current }
  for (const origin of drop) delete next[origin]
  preferences = { ...preferences, siteSettings: next }
  savePreferences()
  return drop.length
}

/** Forget saved page zoom for these origins (null = every site). */
export function clearBrowserSiteZoom(origins: readonly string[] | null): number {
  loadPreferencesIfNeeded()
  const current = preferences.siteZoom
  const drop = origins === null ? Object.keys(current) : origins.map(normalizeHttpOrigin).filter((origin): origin is string => origin !== null && origin in current)
  if (drop.length === 0) return 0
  const next = { ...current }
  for (const origin of drop) delete next[origin]
  cancelDeferredWrite('preferences:site-zoom')
  preferences = { ...preferences, siteZoom: next }
  savePreferences()
  return drop.length
}
