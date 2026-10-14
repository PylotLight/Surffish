import { app } from 'electron'
import { cancelDeferredWrite, deferWrite } from './deferred-writes'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { writeFileAtomic } from './atomic-file'
import { join } from 'node:path'
import {
  normalizeHttpOrigin,
  normalizeSidebarWidth,
  normalizePinnedSites,
  parseBrowserSiteSettings,
  parseBrowserPreferences,
  parseNewTabPreferences,
  normalizeCachedFaviconDataUrl,
  type BrowserPreferences
} from '../shared/persistence'
import { normalizeWindowsSession, parseWindowsSession, serializeWindowsSession, type SavedWindowsSession, type SessionWindowInput } from '../shared/window-session'
import type { SavedWindowState } from '../shared/window-geometry'
import { isDefaultZoom, MAX_SAVED_SITE_ZOOMS, normalizeZoomFactor } from '../shared/zoom'
import { getFavouriteSites, saveFavouriteSites } from './bookmarks'
import { createFileTextCache, isOwnerOnlyMode } from '../shared/write-skip'
import { getProfileDatabase, reportStoreWriteError } from './store'
import { SessionStore } from './store/session-store'
import { legacyFileNeedsImport, markLegacyFileImported } from './store/legacy-json'
import { loadPreferencesSource, savePreferencesCopies } from './preferences-persistence'
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

/**
 * What each file last held (as read or written here). Start-up re-saves the session and
 * preferences with what is already on disk, and tab bursts re-save an unchanged session; identical
 * writes are skipped. A file read with group/other access is never skipped, so start-up still
 * tightens a session left world-readable by an older build.
 */
const lastFileText = createFileTextCache()

function readJson(filename: string): unknown {
  const path = join(app.getPath('userData'), filename)
  if (!existsSync(path)) return null
  try {
    const text = readFileSync(path, 'utf8')
    lastFileText.remember(path, text, isOwnerOnlyMode(statSync(path).mode, process.platform))
    return JSON.parse(text) as unknown
  } catch (error) {
    console.warn(`Could not read ${filename}:`, error)
    return null
  }
}

function writeJson(filename: string, value: unknown): boolean {
  const path = join(app.getPath('userData'), filename)
  const text = JSON.stringify(value)
  if (lastFileText.isUnchanged(path, text, existsSync)) return true
  try {
    writeFileAtomic(path, text)
    lastFileText.remember(path, text)
    return true
  } catch (error) {
    lastFileText.forget(path)
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

let sessionStore: SessionStore | null | undefined

/** The session tables in surffish.db, or null (no database: the JSON file is the only copy). */
function sqlSessions(): SessionStore | null {
  if (sessionStore !== undefined) return sessionStore
  const db = getProfileDatabase()
  sessionStore = db ? new SessionStore(db) : null
  return sessionStore
}

function sessionFilePath(): string {
  return join(app.getPath('userData'), SESSION_FILE)
}

/** Remember browser-session.json as written by us, so a later change means another build wrote it. */
function markSessionFileOurs(): void {
  const db = getProfileDatabase()
  if (db && sqlSessions()) {
    try { markLegacyFileImported(db, SESSION_FILE, sessionFilePath()) } catch { /* bookkeeping only */ }
  }
}

/** True when the database now holds `saved`. */
function saveSessionToDatabase(saved: SavedWindowsSession): boolean {
  const store = sqlSessions()
  if (!store) return false
  try {
    store.save(saved)
    return true
  } catch (error) {
    reportStoreWriteError('Could not save the session to the database (browser-session.json still has it):', error)
    return false
  }
}

/**
 * Every window's tabs (multi-window session). Read from surffish.db when it has this device's
 * session and browser-session.json hasn't been written by anything else since (a fallback run or
 * an older build); otherwise from the JSON file. The JSON file keeps being written alongside, so
 * it is always a complete fallback and an older build still restores.
 */
export function loadBrowserWindowsSession(legacyGeometry: SavedWindowState | null): SavedWindowsSession {
  const raw = readJson(SESSION_FILE)
  let session = parseWindowsSession(raw, legacyGeometry)
  const store = sqlSessions()
  const db = getProfileDatabase()
  let fromDatabase: SavedWindowsSession | null = null
  if (store && db) {
    try {
      fromDatabase = store.savedAt() !== null && !legacyFileNeedsImport(db, SESSION_FILE, sessionFilePath()) ? store.load() : null
      if (fromDatabase) session = fromDatabase
    } catch (error) {
      console.error('Could not read the session from the database; using browser-session.json:', error)
    }
  }
  const normalized = normalizeWindowsSession(session.windows, session.focusedIndex)
  // Rewrite the file at startup so a session saved by an older build (credential-like URL parts,
  // world-readable mode) is sanitized and owner-only right away, not only after the next tab change.
  const rewrite = (raw !== null && raw !== undefined) || fromDatabase !== null
  const wroteJson = rewrite && writeJson(SESSION_FILE, serializeWindowsSession(normalized))
  if (fromDatabase !== null) {
    if (wroteJson) markSessionFileOurs()
  } else if (store) {
    // Read from JSON (first run with the database, or the file changed): import it off the startup
    // path. A real save before then cancels this and writes the current session instead.
    deferWrite('session-import', () => {
      if (sessionPersistenceDisabled) return
      if (saveSessionToDatabase(normalized) && (wroteJson || !rewrite)) markSessionFileOurs()
    }, 1500)
  }
  return session
}

export function saveBrowserWindowsSession(windows: readonly SessionWindowInput[], focusedIndex: number): void {
  if (sessionPersistenceDisabled) return
  const saved = normalizeWindowsSession(windows, focusedIndex)
  // The startup import is stale now; this save writes the current session instead.
  cancelDeferredWrite('session-import')
  deferWrite('session', () => {
    if (sessionPersistenceDisabled) return
    const wroteJson = writeJson(SESSION_FILE, serializeWindowsSession(saved))
    // Only mark the JSON file as matching the database when both writes landed; otherwise the
    // next start sees a changed file and restores from JSON.
    if (saveSessionToDatabase(saved) && wroteJson) markSessionFileOurs()
  }, 600)
}

/** Clear the on-disk restore list without closing current tabs or re-saving them during this run. */
export function clearSavedBrowserSession(): boolean {
  cancelDeferredWrite('session')
  cancelDeferredWrite('session-import')
  const cleared = writeJson(SESSION_FILE, { version: 1, tabs: [], activeIndex: 0, pinnedTabs: [] })
  const store = sqlSessions()
  if (store) {
    try {
      store.clear()
    } catch (error) {
      console.error('Could not clear the session in the database:', error)
    }
  }
  if (cleared) {
    markSessionFileOurs()
    sessionPersistenceDisabled = true
  }
  return cleared
}

export function getBrowserSearchEngine(): SearchEngineId {
  loadPreferencesIfNeeded()
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
  // surffish.db when its copy is current, else browser-preferences.json (see preferences-persistence.ts).
  preferences = parseBrowserPreferences(loadPreferencesSource(() => readJson(PREFERENCES_FILE), () => preferences))
  preferencesLoaded = true
}

/** `privacy`: per-site entries were removed, so the JSON copy is rewritten now too (not on the slow timer). */
function savePreferences(privacy = false): void {
  preferencesLoaded = true
  savePreferencesCopies(() => preferences, () => writeJson(PREFERENCES_FILE, { version: 1, ...preferences }), privacy)
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
  savePreferences(true)
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
  savePreferences(true)
  return drop.length
}
