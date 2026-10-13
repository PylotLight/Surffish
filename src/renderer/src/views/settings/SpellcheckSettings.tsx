import { useEffect, useState } from 'react'
import type { SpellcheckSettings as SpellcheckPreferences } from '../../../../shared/spellcheck'
import { MAX_SPELLCHECK_LANGUAGES } from '../../../../shared/spellcheck'
import { SettingsGroup, SettingsRow } from './SettingsControls'
import '../Safety.css'

type SpellcheckState = Awaited<ReturnType<typeof window.api.browser.safety.spellcheck.get>>

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Settings → General → Spellcheck. */
export function SpellcheckSettings(): React.JSX.Element {
  const [state, setState] = useState<SpellcheckState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.browser.safety.spellcheck.get().then(setState).catch(() => setError('Could not read spellcheck settings.'))
  }, [])

  async function save(patch: Partial<SpellcheckPreferences>): Promise<void> {
    if (!state) return
    setError('')
    try {
      setState(await window.api.browser.safety.spellcheck.set({ ...state.settings, ...patch }))
    } catch {
      setError('Could not save spellcheck settings.')
    }
  }

  const settings = state?.settings
  const chosen = settings && settings.languages.length > 0 ? settings.languages : state?.active ?? []
  const addable = (state?.available ?? []).filter((code) => !chosen.includes(code))
  return (
    <SettingsGroup title="Spellcheck" status={settings ? (settings.enabled ? 'On' : 'Off') : undefined} statusOn={settings?.enabled}
      aside={<input type="checkbox" className="settings-switch" disabled={!settings} checked={settings?.enabled ?? false} onChange={(event) => void save({ enabled: event.target.checked })} aria-label="Check spelling while typing" />}>
      <SettingsRow label="Private tabs" hint="Off by default, so private browsing doesn’t use or teach the dictionary.">
        <input type="checkbox" className="settings-switch" disabled={!settings?.enabled} checked={settings?.privateTabs ?? false} onChange={(event) => void save({ privateTabs: event.target.checked })} aria-label="Check spelling in private tabs" />
      </SettingsRow>
      {state?.osManagedLanguages ? (
        <SettingsRow label="Languages" hint="macOS checks spelling with the system dictionaries. Choose languages in System Settings → Keyboard → Text Input → Edit → Spelling.">
          <span className="settings-row-hint">Managed by macOS</span>
        </SettingsRow>
      ) : (
        <SettingsRow label="Languages" hint={`Up to ${MAX_SPELLCHECK_LANGUAGES}. Dictionaries download from Google the first time a language is used.`}>
          <select className="settings-select" value="" disabled={!settings?.enabled || chosen.length >= MAX_SPELLCHECK_LANGUAGES || addable.length === 0} onChange={(event) => {
            if (event.target.value) void save({ languages: [...chosen, event.target.value] })
          }} aria-label="Add a spellcheck language">
            <option value="">Add language…</option>
            {addable.map((code) => <option key={code} value={code}>{languageName(code)} ({code})</option>)}
          </select>
        </SettingsRow>
      )}
      {!state?.osManagedLanguages && chosen.length > 0 && (
        <div className="privacy-language-list" aria-label="Spellcheck languages">
          {chosen.map((code) => (
            <span className="privacy-language-chip" key={code}>{languageName(code)}
              <button type="button" aria-label={`Remove ${languageName(code)}`} disabled={chosen.length <= 1} onClick={() => void save({ languages: chosen.filter((entry) => entry !== code) })}>×</button>
            </span>
          ))}
        </div>
      )}
      <p className="settings-help">Right-click a misspelled word for suggestions and Add to Dictionary.</p>
      {error && <p className="settings-message is-error" role="alert">{error}</p>}
    </SettingsGroup>
  )
}
