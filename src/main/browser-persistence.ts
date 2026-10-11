import { app } from 'electron'
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
  type BrowserPreferences,
  type SavedBrowserSession
} from '../shared/persistence'
import type { BrowserPreferencesSnapshot, BrowserSiteSettings, NewTabPageId, NewTabPreferences, PinnedSite, SearchEngineId, TabSleepMinutes } from '../shared/types'

const SESSION_FILE = 'browser-session.json'
const PREFERENCES_FILE = 'browser-preferences.json'
let preferencesLoaded = false
let preferences: BrowserPreferences = parseBrowserPreferences(null)
let sessionPersistenceDisabled = false

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

export function loadBrowserSession(): SavedBrowserSession {
  const saved = parseBrowserSession(readJson(SESSION_FILE))
  writeJson(SESSION_FILE, { version: 1, tabs: saved.urls, activeIndex: saved.activeIndex, pinnedTabs: saved.pinnedIndexes })
  return saved
}

export function saveBrowserSession(urls: readonly string[], activeIndex: number, pinnedIndexes: readonly number[] = []): void {
  if (sessionPersistenceDisabled) return
  const saved = normalizeBrowserSession(urls, activeIndex, pinnedIndexes)
  writeJson(SESSION_FILE, { version: 1, tabs: saved.urls, activeIndex: saved.activeIndex, pinnedTabs: saved.pinnedIndexes })
}

/** Clear the on-disk restore list without closing current tabs or re-saving them during this run. */
export function clearSavedBrowserSession(): boolean {
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

export function getBrowserPinnedSites(): PinnedSite[] {
  loadPreferencesIfNeeded()
  return preferences.pinnedSites.map((site) => ({ ...site }))
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
  loadPreferencesIfNeeded()
  preferences = { ...preferences, pinnedSites: normalizePinnedSites(value) }
  savePreferences()
  return getBrowserPinnedSites()
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

function loadPreferencesIfNeeded(): void {
  if (preferencesLoaded) return
  preferences = parseBrowserPreferences(readJson(PREFERENCES_FILE))
  preferencesLoaded = true
}

function savePreferences(): void {
  preferencesLoaded = true
  writeJson(PREFERENCES_FILE, { version: 1, ...preferences })
}
