import { useEffect, useState } from 'react'
import type { LocalAISettings as Settings } from '../../../../shared/local-ai'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/** Settings → General → Built-in AI (experimental): pages' Prompt API answered by Surffish. Off by default. */
export function LocalAISettings(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  useEffect(() => {
    let live = true
    const take = (next: Settings): void => {
      if (!live) return
      setSettings(next)
      setBaseUrl(next.baseUrl)
      setModel(next.model)
    }
    void window.api.browser.localAI.getSettings().then(take).catch(() => undefined)
    const off = window.api.browser.localAI.onSettingsChange(take)
    return () => {
      live = false
      off()
    }
  }, [])
  const save = (patch: Partial<Settings>): void => {
    void window.api.browser.localAI.setSettings(patch).then((next) => {
      setSettings(next)
      setBaseUrl(next.baseUrl)
      setModel(next.model)
    }).catch(() => undefined)
  }
  const on = settings?.enabled === true
  return (
    <SettingsGroup title="Built-in AI (experimental)" status={settings === null ? undefined : on ? 'On' : 'Off'} statusOn={on}>
      <SettingsRow label="Let pages use the built-in AI" hint="Answers Prompt API (LanguageModel) calls from pages and extensions." info="Never in private tabs. Off: the API reports it's unavailable.">
        <input type="checkbox" className="settings-switch" checked={on} disabled={settings === null} onChange={(event) => save({ enabled: event.target.checked })} aria-label="Let pages use the built-in AI" />
      </SettingsRow>
      {on && settings && (
        <SettingsRow label="Provider" hint={settings.provider === 'echo' ? 'Echo repeats the prompt back (for testing).' : 'An OpenAI-compatible server on this machine (LM Studio, Ollama, llama.cpp). Loopback addresses only.'}>
          <select className="settings-select" value={settings.provider} aria-label="AI provider" onChange={(event) => save({ provider: event.target.value as Settings['provider'] })}>
            <option value="echo">Echo (test)</option>
            <option value="openai-compatible">Local OpenAI-compatible server</option>
          </select>
        </SettingsRow>
      )}
      {on && settings?.provider === 'openai-compatible' && (
        <SettingsRow label="Server" hint="Base URL and model (empty model: the server's default).">
          <input className="settings-input" type="url" value={baseUrl} spellCheck={false} aria-label="AI server base URL" onChange={(event) => setBaseUrl(event.target.value)} onBlur={() => save({ baseUrl })} />
          <input className="settings-input" type="text" value={model} spellCheck={false} placeholder="model" aria-label="AI model" onChange={(event) => setModel(event.target.value)} onBlur={() => save({ model })} />
        </SettingsRow>
      )}
    </SettingsGroup>
  )
}
