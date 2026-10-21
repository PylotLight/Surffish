import { useEffect, useState } from 'react'
import {
  downloadPercent,
  IDLE_READ_ALOUD_DOWNLOAD,
  IDLE_READ_ALOUD_TEST,
  isReadAloudDownloadBusy,
  READ_ALOUD_SAMPLE_TEXT,
  READ_ALOUD_SPEEDS,
  READ_ALOUD_TEST_MAX_CHARS,
  realtimeFactor,
  type ReadAloudDownloadState,
  type ReadAloudEngineId,
  type ReadAloudSettings as Settings,
  type ReadAloudTestState
} from '../../../../shared/read-aloud'
import { firstUseDownloadBytes, formatDownloadSize, READ_ALOUD_VOICES } from '../../../../shared/read-aloud-assets'
import { SettingsGroup, SettingsRow } from './SettingsControls'
import './ReadAloudSettings.css'

/**
 * Settings → Integrations → Read Aloud (experimental, off by default; its own lazy chunk). Turning
 * it on downloads the Phonon model right away (progress, Cancel, Retry, then "Ready · 71 MB"); the
 * files stay in the profile when it's turned off, until Delete download. The voice tester speaks a
 * sample with any engine, voice and speed and shows load time, time to first audio and the real-time
 * factor. Off keeps the read-aloud module unloaded in main and every entry point hidden.
 */

const ENGINE_LABELS: Record<ReadAloudEngineId, string> = { phonon: 'Phonon (on-device)', system: 'System voice', openai: 'Local speech server' }

function voiceLabel(voice: (typeof READ_ALOUD_VOICES)[number]): string {
  return `${voice.name}${voice.locale === 'model' ? '' : ` (${voice.locale === 'en-gb' ? 'UK' : 'US'})`}`
}

function ms(value: number | null): string {
  if (value === null) return '–'
  return value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
}

function useReadAloud(): {
  settings: Settings | null
  download: ReadAloudDownloadState
  test: ReadAloudTestState
  save: (patch: Partial<Settings>) => void
} {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [download, setDownload] = useState<ReadAloudDownloadState>(IDLE_READ_ALOUD_DOWNLOAD)
  const [test, setTest] = useState<ReadAloudTestState>(IDLE_READ_ALOUD_TEST)
  useEffect(() => {
    let live = true
    const api = window.api.browser.readAloud
    void api.getSettings().then((next) => { if (live) setSettings(next) }).catch(() => undefined)
    void api.downloadInfo().then((next) => { if (live) setDownload(next) }).catch(() => undefined)
    void api.getTestState().then((next) => { if (live) setTest(next) }).catch(() => undefined)
    const offs = [
      api.onSettingsChange((next) => { if (live) setSettings(next) }),
      api.onDownload((next) => { if (live) setDownload(next) }),
      api.onTest((next) => { if (live) setTest(next) })
    ]
    return () => {
      live = false
      for (const off of offs) off()
    }
  }, [])
  const save = (patch: Partial<Settings>): void => {
    void window.api.browser.readAloud.setSettings(patch).then(setSettings).catch(() => undefined)
  }
  return { settings, download, test, save }
}

/** The model row: progress + Cancel, error + Retry, Resume, or "Ready · 71 MB" + Delete download. */
function ModelDownloadRow({ download, enabled }: { download: ReadAloudDownloadState; enabled: boolean }): React.JSX.Element | null {
  const api = window.api.browser.readAloud
  const size = formatDownloadSize(download.bytes || firstUseDownloadBytes())
  const remove = (): void => { void api.deleteDownloads().catch(() => undefined) }
  const deleteButton = <button className="settings-action secondary" type="button" aria-label="Delete the downloaded voice model" onClick={remove}>Delete download</button>
  if (!enabled) {
    // Off keeps the files; offer Delete separately.
    if (download.status === 'absent') return null
    return (
      <SettingsRow label="Voice model" hint={download.status === 'ready' ? `Kept in this profile (${size}) for when Read Aloud is turned back on.` : 'A partial download is kept in this profile; it resumes when Read Aloud is turned on.'}>
        {deleteButton}
      </SettingsRow>
    )
  }
  const busy = isReadAloudDownloadBusy(download)
  const percent = downloadPercent(download.loaded, download.total)
  return (
    <div className="settings-row read-aloud-model-row" data-status={download.status}>
      <div className="settings-row-copy">
        <span className="settings-row-label">Voice model</span>
        {download.status === 'ready' && <span className="settings-row-hint read-aloud-model-status" role="status">Ready · {size}</span>}
        {download.status === 'checking' && <span className="settings-row-hint read-aloud-model-status" role="status">Checking the downloaded files…</span>}
        {download.status === 'downloading' && (
          <div className="read-aloud-model-progress" role="status">
            <progress max={100} value={percent} aria-label="Voice model download progress" />
            <span className="settings-row-hint read-aloud-model-status">
              {formatDownloadSize(download.loaded)} of {formatDownloadSize(download.total)} · {percent}%{download.label ? ` · ${download.label}` : ''}
            </span>
          </div>
        )}
        {download.status === 'error' && <span className="settings-row-hint read-aloud-model-status is-error" role="alert">Download failed: {download.error}</span>}
        {download.status === 'cancelled' && <span className="settings-row-hint read-aloud-model-status" role="status">Download cancelled ({size}).</span>}
        {(download.status === 'absent' || download.status === 'partial') && <span className="settings-row-hint read-aloud-model-status" role="status">{download.status === 'partial' ? 'Download incomplete.' : `Not downloaded (${size}).`}</span>}
      </div>
      <div className="settings-row-control">
        {busy && <button className="settings-action secondary" type="button" onClick={() => { void api.cancelDownload().catch(() => undefined) }}>Cancel</button>}
        {download.status === 'error' && <button className="settings-action primary" type="button" onClick={() => { void api.startDownload().catch(() => undefined) }}>Retry</button>}
        {(download.status === 'cancelled' || download.status === 'absent' || download.status === 'partial') && <button className="settings-action primary" type="button" onClick={() => { void api.startDownload().catch(() => undefined) }}>{download.status === 'partial' ? 'Resume download' : 'Download'}</button>}
        {(download.status === 'ready' || download.status === 'partial' || download.status === 'cancelled' || download.status === 'error') && deleteButton}
      </div>
    </div>
  )
}

function TestResult({ test }: { test: ReadAloudTestState }): React.JSX.Element | null {
  if (test.status === 'idle' && !test.stats && !test.error) return null
  const stats = test.stats
  const rtf = realtimeFactor(stats)
  const engine = test.engine ? ENGINE_LABELS[test.engine] : ''
  return (
    <div className="read-aloud-test-result" role="status" data-status={test.status}>
      {test.status === 'preparing' && <span>Getting {engine} ready…</span>}
      {test.status === 'loading' && <span>Starting {engine}…</span>}
      {test.status === 'error' && <span className="is-error">{test.error}</span>}
      {stats && (
        <dl className="read-aloud-test-stats">
          <div><dt>Load</dt><dd data-stat="load">{ms(stats.loadMs)}{test.engine === 'phonon' && stats.loadMs !== null ? (stats.cold ? ' (cold)' : ' (already loaded)') : ''}</dd></div>
          <div><dt title="From the engine being ready to the first sound">First audio</dt><dd data-stat="first-audio">{ms(stats.firstAudioMs)}</dd></div>
          <div><dt title="Seconds of compute per second of speech; below 1 is faster than real time">Real-time factor</dt><dd data-stat="rtf">{rtf === null ? (test.engine === 'system' ? 'n/a' : '–') : `${rtf.toFixed(2)}×${rtf > 0 ? ` (${(1 / rtf).toFixed(1)}× faster)` : ''}`}</dd></div>
          {stats.threads !== null && <div><dt>Threads</dt><dd data-stat="threads">{stats.threads}</dd></div>}
        </dl>
      )}
      {test.fallbackReason && <span className="read-aloud-test-note" title={test.fallbackReason}>Phonon couldn’t start; the system voice was used.</span>}
    </div>
  )
}

/** Voice tester: engine, voice (Phonon), speed, sample text, Play/Stop and the timing numbers. */
function VoiceTester({ settings, download, test, save }: { settings: Settings; download: ReadAloudDownloadState; test: ReadAloudTestState; save: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const api = window.api.browser.readAloud
  const [engine, setEngine] = useState<ReadAloudEngineId>(settings.engine)
  const [speedIndex, setSpeedIndex] = useState(() => Math.max(0, READ_ALOUD_SPEEDS.indexOf(settings.speed as (typeof READ_ALOUD_SPEEDS)[number])))
  const [text, setText] = useState(READ_ALOUD_SAMPLE_TEXT)
  const speed = READ_ALOUD_SPEEDS[speedIndex] ?? 1
  const running = test.status === 'preparing' || test.status === 'loading' || test.status === 'playing'
  const voiceFetch = download.voice
  const play = (): void => {
    if (running) {
      void api.stopTest().catch(() => undefined)
      return
    }
    void api.test({ text, engine, voice: settings.voice, speed }).catch(() => undefined)
  }
  return (
    <SettingsGroup title="Voice tester" className="read-aloud-tester">
      <SettingsRow label="Engine" hint="Try the fallbacks too. The engine Read Aloud uses is set above.">
        <select className="settings-select" value={engine} aria-label="Voice tester engine" onChange={(event) => setEngine(event.target.value as ReadAloudEngineId)}>
          {(Object.keys(ENGINE_LABELS) as ReadAloudEngineId[]).map((id) => <option key={id} value={id}>{ENGINE_LABELS[id]}</option>)}
        </select>
      </SettingsRow>
      {engine === 'phonon' && (
        <SettingsRow label="Voice" hint="Also the voice Read Aloud uses. Each extra voice downloads once (~256 KB).">
          <div className="read-aloud-voice-picker">
            <select className="settings-select" value={settings.voice} aria-label="Read Aloud voice" onChange={(event) => save({ voice: event.target.value })}>
              {READ_ALOUD_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voiceLabel(voice)}{download.voices.includes(voice.id) ? ' ✓' : ''}</option>)}
            </select>
            {voiceFetch && <progress className="read-aloud-voice-progress" max={100} value={downloadPercent(voiceFetch.loaded, voiceFetch.total)} aria-label="Voice download progress" />}
          </div>
        </SettingsRow>
      )}
      <label className="settings-row settings-slider-row read-aloud-speed-row">
        <span className="settings-row-label">Speed</span>
        <input className="settings-range" type="range" min={0} max={READ_ALOUD_SPEEDS.length - 1} step={1} value={speedIndex} style={{ '--range-fill': `${(speedIndex / (READ_ALOUD_SPEEDS.length - 1)) * 100}%` } as React.CSSProperties} aria-label="Voice tester speed" aria-valuetext={`${speed}×`} onChange={(event) => setSpeedIndex(Number(event.target.value))} />
        <output className="settings-slider-value">{speed}×</output>
      </label>
      <div className="read-aloud-test-text">
        <textarea className="settings-input" rows={3} maxLength={READ_ALOUD_TEST_MAX_CHARS} value={text} spellCheck={false} aria-label="Sample text" onChange={(event) => setText(event.target.value)} />
        <div className="read-aloud-test-actions">
          <button className="settings-action secondary" type="button" disabled={text === READ_ALOUD_SAMPLE_TEXT} onClick={() => setText(READ_ALOUD_SAMPLE_TEXT)}>Reset text</button>
          <button className={`settings-action ${running ? 'secondary' : 'primary'} read-aloud-test-play`} type="button" aria-label={running ? 'Stop the voice test' : 'Play the voice test'} onClick={play}>{running ? 'Stop' : 'Play'}</button>
        </div>
      </div>
      <TestResult test={test} />
    </SettingsGroup>
  )
}

export function ReadAloudSettings(): React.JSX.Element {
  const { settings, download, test, save } = useReadAloud()
  const [endpoint, setEndpoint] = useState('')
  const [endpointVoice, setEndpointVoice] = useState('')
  useEffect(() => {
    if (!settings) return
    setEndpoint(settings.endpoint)
    setEndpointVoice(settings.endpointVoice)
  }, [settings?.endpoint, settings?.endpointVoice])
  const on = settings?.enabled === true
  return (
    <div className="read-aloud-settings">
      <SettingsGroup title="Read Aloud (experimental)" status={settings === null ? undefined : on ? 'On' : 'Off'} statusOn={on}>
        <SettingsRow
          label="Enable Read Aloud"
          hint="Listen to articles and selected text, spoken on this Mac."
          info={`Right-click a page → Read Aloud, or ⌘K → Read Aloud. Uses Phonon (an on-device voice model, Apache-2.0); turning this on downloads it once (${formatDownloadSize(firstUseDownloadBytes())}) into this profile. Text never leaves this computer. Off: nothing is loaded, and the download is kept until you delete it.`}
        >
          <input type="checkbox" className="settings-switch" checked={on} disabled={settings === null} onChange={(event) => save({ enabled: event.target.checked })} aria-label="Enable Read Aloud" />
        </SettingsRow>
        {settings && <ModelDownloadRow download={download} enabled={on} />}
        {on && settings && (
          <SettingsRow label="Voice engine" hint={settings.engine === 'phonon' ? 'Phonon runs inside Surffish. Falls back to the system voice if it can’t start.' : settings.engine === 'system' ? 'The voices built into the system.' : 'An OpenAI-compatible /v1/audio/speech server on this machine (e.g. ptts-openai-server). Loopback addresses only.'}>
            <select className="settings-select" value={settings.engine} aria-label="Read Aloud voice engine" onChange={(event) => save({ engine: event.target.value as Settings['engine'] })}>
              {(Object.keys(ENGINE_LABELS) as ReadAloudEngineId[]).map((id) => <option key={id} value={id}>{ENGINE_LABELS[id]}</option>)}
            </select>
          </SettingsRow>
        )}
        {on && settings?.engine === 'openai' && (
          <SettingsRow label="Server" hint="Base URL and voice (empty voice: the server’s default).">
            <input className="settings-input" type="url" value={endpoint} spellCheck={false} aria-label="Speech server base URL" onChange={(event) => setEndpoint(event.target.value)} onBlur={() => save({ endpoint })} />
            <input className="settings-input" type="text" value={endpointVoice} spellCheck={false} placeholder="voice" aria-label="Speech server voice" onChange={(event) => setEndpointVoice(event.target.value)} onBlur={() => save({ endpointVoice })} />
          </SettingsRow>
        )}
      </SettingsGroup>
      {on && settings && <VoiceTester settings={settings} download={download} test={test} save={save} />}
    </div>
  )
}
