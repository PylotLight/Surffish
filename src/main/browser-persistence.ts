import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeHttpOrigin,
  normalizePinnedSites,
  parseBrowserSiteSettings,
  normalizeBrowserSession,
  parseBrowserPreferences,
  parseBrowserSession,
  type BrowserPreferences,
  type SavedBrowserSession
} from '../shared/persistence'
import type { BrowserSiteSettings, NewTabPageId, PinnedSite, SearchEngineId, TabSleepMinutes } from '../shared/types'

const SESSION_FILE = 'browser-session.json'
const PREFERENCES_FILE = 'browser-preferences.json'
let preferencesLoaded = false
let preferences: BrowserPreferences = parseBrowserPreferences(null)

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

function writeJson(filename: string, value: unknown): void {
  const directory = app.getPath('userData')
  const path = join(directory, filename)
  const temporaryPath = `${path}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(value), 'utf8')
    renameSync(temporaryPath, path)
  } catch (error) {
    console.error(`Could not save ${filename}:`, error)
  }
}

export function loadBrowserSession(): SavedBrowserSession {
  return parseBrowserSession(readJson(SESSION_FILE))
}

export function saveBrowserSession(urls: readonly string[], activeIndex: number): void {
  const saved = normalizeBrowserSession(urls, activeIndex)
  writeJson(SESSION_FILE, { version: 1, tabs: saved.urls, activeIndex: saved.activeIndex })
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

export function getBrowserPinnedSites(): PinnedSite[] {
  loadPreferencesIfNeeded()
  return preferences.pinnedSites.map((site) => ({ ...site }))
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
