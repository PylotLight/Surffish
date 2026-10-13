import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPELLCHECK_SETTINGS, MAX_SPELLCHECK_LANGUAGES, normalizeSpellcheckLanguages, parseSpellcheckSettings, spellcheckEnabledFor } from './spellcheck.ts'

describe('spellcheck settings', () => {
  test('defaults: on, system languages, off in private tabs', () => {
    expect(parseSpellcheckSettings(null)).toEqual(DEFAULT_SPELLCHECK_SETTINGS)
    expect(DEFAULT_SPELLCHECK_SETTINGS).toEqual({ enabled: true, languages: [], privateTabs: false })
  })
  test('private tabs stay off unless opted in', () => {
    expect(spellcheckEnabledFor(DEFAULT_SPELLCHECK_SETTINGS, true)).toBe(false)
    expect(spellcheckEnabledFor({ ...DEFAULT_SPELLCHECK_SETTINGS, privateTabs: true }, true)).toBe(true)
    expect(spellcheckEnabledFor({ ...DEFAULT_SPELLCHECK_SETTINGS, enabled: false, privateTabs: true }, true)).toBe(false)
    expect(spellcheckEnabledFor({ ...DEFAULT_SPELLCHECK_SETTINGS, enabled: false }, false)).toBe(false)
  })
  test('languages: deduped, validated against the available list, capped', () => {
    expect(normalizeSpellcheckLanguages(['en-GB', 'en-GB', 'xx', 'fr', 42, '../x'], ['en-GB', 'fr', 'de'])).toEqual(['en-GB', 'fr'])
    expect(normalizeSpellcheckLanguages(['en-US', 'de', 'fr', 'es', 'it', 'nl', 'pt-BR'])).toHaveLength(MAX_SPELLCHECK_LANGUAGES)
    expect(normalizeSpellcheckLanguages('en-US')).toEqual([])
  })
})
