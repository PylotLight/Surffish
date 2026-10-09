import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SEARCH_ENGINE } from '../shared/navigation'
import {
  normalizeBrowserSession,
  parseBrowserPreferences,
  parseBrowserSession,
  type BrowserPreferences,
  type SavedBrowserSession
} from '../shared/persistence'
import type { SearchEngineId } from '../shared/types'

const SESSION_FILE = 'browser-session.json'
const PREFERENCES_FILE = 'browser-preferences.json'
let preferencesLoaded = false
let preferences: BrowserPreferences = { searchEngine: DEFAULT_SEARCH_ENGINE }

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
  preferences = { searchEngine }
  preferencesLoaded = true
  writeJson(PREFERENCES_FILE, { version: 1, searchEngine })
}
