/** Spellcheck preferences (Settings → General → Spellcheck). Pure, shared by main and renderer. */
export interface SpellcheckSettings {
  enabled: boolean
  /** Hunspell dictionaries (Windows/Linux). Empty keeps Chromium's default for the system locale. macOS ignores this. */
  languages: string[]
  /** Private tabs check spelling too. Off by default: dictionary downloads and learned words stay out of private browsing. */
  privateTabs: boolean
}

export const DEFAULT_SPELLCHECK_SETTINGS: SpellcheckSettings = { enabled: true, languages: [], privateTabs: false }
export const MAX_SPELLCHECK_LANGUAGES = 5

/** Keep known language codes once each, in the user's order, capped. Unknown codes would make Chromium throw. */
export function normalizeSpellcheckLanguages(input: unknown, available?: readonly string[]): string[] {
  if (!Array.isArray(input)) return []
  const known = available ? new Set(available) : null
  const languages: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const code = value.trim()
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code) || languages.includes(code)) continue
    if (known && !known.has(code)) continue
    languages.push(code)
    if (languages.length >= MAX_SPELLCHECK_LANGUAGES) break
  }
  return languages
}

export function parseSpellcheckSettings(value: unknown, available?: readonly string[]): SpellcheckSettings {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SPELLCHECK_SETTINGS.enabled,
    languages: normalizeSpellcheckLanguages(record.languages, available),
    privateTabs: record.privateTabs === true
  }
}

/** Whether a session should check spelling: private sessions only when the user opted in. */
export function spellcheckEnabledFor(settings: SpellcheckSettings, isPrivate: boolean): boolean {
  return settings.enabled && (!isPrivate || settings.privateTabs)
}
