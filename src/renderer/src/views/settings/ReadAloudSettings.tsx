import { useEffect, useState } from 'react'
import type { ReadAloudSettings as Settings } from '../../../../shared/read-aloud'
import { firstUseDownloadBytes, formatDownloadSize, READ_ALOUD_VOICES } from '../../../../shared/read-aloud-assets'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/**
 * Settings → Features → Read Aloud (experimental, off by default): on-device text to speech for
 * articles and selections. Off keeps the read-aloud module unloaded and every entry point hidden.
 */
export function ReadAloudSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [endpointVoice, setEndpointVoice] = useState('')
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    const take = (next: Settings): void => {
      if (!live) return
      setSettings(next)
      setEndpoint(next.endpoint)
      setEndpointVoice(next.endpointVoice)
    }
    void window.api.browser.readAloud.getSettings().then(take).catch(() => undefined)
    void window.api.browser.readAloud.downloadInfo().then((info) => { if (live) setDownloaded(info.downloaded) }).catch(() => undefined)
    const off = window.api.browser.readAloud.onSettingsChange(take)
    return () => {
      live = false
      off()
    }
  }, [])
  const save = (patch: Partial<Settings>): void => {
    void window.api.browser.readAloud.setSettings(patch).then((next) => {
      setSettings(next)
      setEndpoint(next.endpoint)
      setEndpointVoice(next.endpointVoice)
    }).catch(() => undefined)
  }
  const on = settings?.enabled === true
  return (
    <SettingsGroup title="Read Aloud (experimental)" status={settings === null ? undefined : on ? 'On' : 'Off'} statusOn={on}>
      <SettingsRow
        label="Enable Read Aloud"
        hint="Listen to articles and selected text, spoken on this Mac."
        info={`Right-click a page → Read Aloud, or ⌘K → Read Aloud. Uses Phonon (an on-device voice model, Apache-2.0). The first reading downloads it once (${formatDownloadSize(firstUseDownloadBytes())}); text never leaves this computer. Off: nothing is loaded.`}
      >
        <input type="checkbox" className="settings-switch" checked={on} disabled={settings === null} onChange={(event) => save({ enabled: event.target.checked })} aria-label="Enable Read Aloud" />
      </SettingsRow>
      {on && settings && (
        <SettingsRow label="Voice engine" hint={settings.engine === 'phonon' ? 'Phonon runs inside Surffish. Falls back to the system voice if it can’t start.' : settings.engine === 'system' ? 'The voices built into the system.' : 'An OpenAI-compatible /v1/audio/speech server on this machine (e.g. ptts-openai-server). Loopback addresses only.'}>
          <select className="settings-select" value={settings.engine} aria-label="Read Aloud voice engine" onChange={(event) => save({ engine: event.target.value as Settings['engine'] })}>
            <option value="phonon">Phonon (on-device)</option>
            <option value="system">System voice</option>
            <option value="openai">Local speech server</option>
          </select>
        </SettingsRow>
      )}
      {on && settings?.engine === 'phonon' && (
        <SettingsRow label="Voice" hint={downloaded ? 'Model downloaded. Other voices download on first use (~250 KB each).' : `Downloads on first use (${formatDownloadSize(firstUseDownloadBytes())}).`}>
          <select className="settings-select" value={settings.voice} aria-label="Read Aloud voice" onChange={(event) => save({ voice: event.target.value })}>
            {READ_ALOUD_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.locale === 'model' ? '' : ` (${voice.locale === 'en-gb' ? 'UK' : 'US'})`}</option>)}
          </select>
          {downloaded && (
            <button className="settings-action secondary" type="button" aria-label="Delete the downloaded voice model" onClick={() => { void window.api.browser.readAloud.deleteDownloads().then((info) => setDownloaded(info.downloaded)).catch(() => undefined) }}>Delete download</button>
          )}
        </SettingsRow>
      )}
      {on && settings?.engine === 'openai' && (
        <SettingsRow label="Server" hint="Base URL and voice (empty voice: the server’s default).">
          <input className="settings-input" type="url" value={endpoint} spellCheck={false} aria-label="Speech server base URL" onChange={(event) => setEndpoint(event.target.value)} onBlur={() => save({ endpoint })} />
          <input className="settings-input" type="text" value={endpointVoice} spellCheck={false} placeholder="voice" aria-label="Speech server voice" onChange={(event) => setEndpointVoice(event.target.value)} onBlur={() => save({ endpointVoice })} />
        </SettingsRow>
      )}
    </SettingsGroup>
  )
}
