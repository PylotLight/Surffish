import type { Session } from 'electron'
import { getBrowserSession, listPageSessions, onPageSessionCreated } from './browser-session'
import { parseSpellcheckSettings, spellcheckEnabledFor, type SpellcheckSettings } from '../shared/spellcheck'
import { readSettingsFile, writeSettingsFile } from './safety-store'

const FILE = 'browser-spellcheck.json'
let settings: SpellcheckSettings = parseSpellcheckSettings(null)

export interface SpellcheckState {
  settings: SpellcheckSettings
  /** Dictionaries Chromium can download (Windows/Linux); empty on macOS. */
  available: string[]
  /** What the profile session checks right now. */
  active: string[]
  /** macOS uses the system spellchecker and its languages (System Settings → Keyboard → Text Input). */
  osManagedLanguages: boolean
}

const osManaged = process.platform === 'darwin'

function applyToSession(target: Session, isPrivate: boolean): void {
  try {
    target.setSpellCheckerEnabled(spellcheckEnabledFor(settings, isPrivate))
    if (!osManaged && settings.languages.length > 0) target.setSpellCheckerLanguages(settings.languages)
  } catch (error) {
    console.warn('Could not apply spellcheck settings:', error)
  }
}

function applyAll(): void {
  for (const { session: target, info } of listPageSessions()) applyToSession(target, info.isPrivate)
}

export function initializeSpellcheck(): void {
  settings = parseSpellcheckSettings(readSettingsFile(FILE), osManaged ? undefined : getBrowserSession().availableSpellCheckerLanguages)
  // getPrivateSession() turns spelling off; this runs after and applies the user's choice.
  void onPageSessionCreated((target, info) => applyToSession(target, info.isPrivate))
}

export function getSpellcheckState(): SpellcheckState {
  const browserSession = getBrowserSession()
  return {
    settings: { ...settings, languages: [...settings.languages] },
    available: osManaged ? [] : [...browserSession.availableSpellCheckerLanguages],
    active: osManaged ? [] : browserSession.getSpellCheckerLanguages(),
    osManagedLanguages: osManaged
  }
}

export function setSpellcheckSettings(input: unknown): SpellcheckState {
  settings = parseSpellcheckSettings(input, osManaged ? undefined : getBrowserSession().availableSpellCheckerLanguages)
  writeSettingsFile(FILE, settings)
  applyAll()
  return getSpellcheckState()
}
