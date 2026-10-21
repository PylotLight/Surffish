import { useEffect, useRef, useState } from 'react'
import {
  formatSpeed,
  IDLE_READ_ALOUD_DOWNLOAD,
  IDLE_READ_ALOUD_TEST,
  normalizeSpeed,
  READ_ALOUD_DEFAULT_TEMPERATURE,
  READ_ALOUD_MAX_SPEED,
  READ_ALOUD_MAX_TEMPERATURE,
  READ_ALOUD_MIN_SPEED,
  READ_ALOUD_SPEED_PRESETS,
  type ReadAloudCatalogInfo,
  type ReadAloudDevice,
  type ReadAloudDownloadState,
  type ReadAloudEngineId,
  type ReadAloudRewrites,
  type ReadAloudSettings as Settings,
  type ReadAloudTestState
} from '../../../../shared/read-aloud'
import { firstUseDownloadBytes, formatDownloadSize, type ModelConditioner } from '../../../../shared/read-aloud-assets'
import { downloadPercent, isReadAloudDownloadBusy, READ_ALOUD_SAMPLE_TEXT, READ_ALOUD_TEST_MAX_CHARS, realtimeFactor } from '../../../../shared/read-aloud-tester'
import { filterVoices, groupVoices, voiceSummary } from '../../../../shared/read-aloud-voices'
import { useVoiceCatalog } from '../read-aloud/useVoiceCatalog'
import { SettingsDisclosure, SettingsGroup, SettingsRow, SettingsSegmented } from './SettingsControls'
import './ReadAloudSettings.css'

/**
 * Settings → Integrations → Read Aloud (experimental, off by default; its own lazy chunk). Turning
 * it on downloads the Phonon model right away (progress, Cancel, Retry, then "Ready · 71 MB"); the
 * files stay in the profile when it's turned off, until Delete download. One "Voice" section holds
 * the real Read Aloud settings (engine, voice from the English catalog, speed 0.75–3×, Phonon's
 * levers, Advanced) and tests them: Play speaks the sample with exactly those and shows load time,
 * time to first audio, the real-time factor, device and threads. Off keeps the read-aloud module
 * unloaded in main and every entry point hidden.
 */

const ENGINE_LABELS: Record<ReadAloudEngineId, string> = { phonon: 'Phonon (on-device)', system: 'System voice', openai: 'Local speech server' }

const REWRITE_OPTIONS: ReadonlyArray<{ value: ReadAloudRewrites; label: string }> = [
  { value: 'all', label: 'Numbers, dates, times & phone numbers' },
  { value: 'default', label: 'Numbers, money & links (default)' },
  { value: 'none', label: 'Off: read as written' }
]
const DEVICE_OPTIONS: ReadonlyArray<{ value: ReadAloudDevice; label: string }> = [{ value: 'cpu', label: 'CPU' }, { value: 'webgpu', label: 'WebGPU' }, { value: 'auto', label: 'Auto' }]
const THREAD_OPTIONS = ['auto', 1, 2, 3, 4, 6, 8] as const

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
          <div><dt title="Seconds of compute per second of speech at this speed; below 1 is faster than real time">Real-time factor</dt><dd data-stat="rtf">{rtf === null ? (test.engine === 'system' ? 'n/a' : '–') : `${rtf.toFixed(2)}×${rtf > 0 ? ` (${(1 / rtf).toFixed(1)}× faster)` : ''}`}</dd></div>
          {stats.device !== null && <div><dt>Device</dt><dd data-stat="device" title={stats.deviceReason}>{stats.device === 'webgpu' ? 'WebGPU' : stats.device === 'cpu' ? 'CPU' : stats.device}</dd></div>}
          {stats.threads !== null && <div><dt>Threads</dt><dd data-stat="threads" title={stats.threadsReason}>{stats.threads}</dd></div>}
        </dl>
      )}
      {stats && (stats.deviceReason || stats.threadsReason) && <span className="read-aloud-test-note" data-stat="reasons">{[stats.deviceReason, stats.threadsReason].filter(Boolean).join(' · ')}</span>}
      {test.fallbackReason && <span className="read-aloud-test-note" title={test.fallbackReason}>Phonon couldn’t start; the system voice was used.</span>}
    </div>
  )
}

/** A slider that shows its value while dragging and saves once it settles (no respeak per pixel). */
function useSettled(value: number, save: (value: number) => void, delay = 300): [number, (value: number) => void] {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { if (!timer.current) setLocal(value) }, [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const change = (next: number): void => {
    setLocal(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      save(next)
    }, delay)
  }
  return [local, change]
}

/** Speed: one-click presets (0.75–3×) and a fine slider in 0.05 steps. */
function SpeedControl({ speed, save }: { speed: number; save: (speed: number) => void }): React.JSX.Element {
  const [value, setValue] = useSettled(speed, save)
  const percent = ((value - READ_ALOUD_MIN_SPEED) / (READ_ALOUD_MAX_SPEED - READ_ALOUD_MIN_SPEED)) * 100
  return (
    <div className="settings-row read-aloud-speed-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">Speed</span>
        <span className="settings-row-hint">Above 1.25× Phonon’s audio is time-stretched, keeping its pitch.</span>
      </div>
      <div className="settings-row-control read-aloud-speed-control">
        <div className="read-aloud-speed-presets" role="group" aria-label="Speed presets">
          {READ_ALOUD_SPEED_PRESETS.map((preset) => (
            <button key={preset} type="button" className={Math.abs(preset - value) < 0.001 ? 'is-selected' : ''} aria-pressed={Math.abs(preset - value) < 0.001} onClick={() => setValue(preset)}>{formatSpeed(preset)}</button>
          ))}
        </div>
        <div className="read-aloud-speed-slider">
          <input className="settings-range" type="range" min={READ_ALOUD_MIN_SPEED} max={READ_ALOUD_MAX_SPEED} step={0.05} value={value} style={{ '--range-fill': `${percent}%` } as React.CSSProperties} aria-label="Reading speed" aria-valuetext={formatSpeed(value)} onChange={(event) => setValue(normalizeSpeed(Number(event.target.value)))} />
          <output className="settings-slider-value" data-speed>{formatSpeed(value)}</output>
        </div>
      </div>
    </div>
  )
}

/** Voice: search + a grouped list (a few recommended picks, then model voice, American, British, other, characters). */
function VoicePicker({ settings, catalog, download, save }: { settings: Settings; catalog: ReadAloudCatalogInfo; download: ReadAloudDownloadState; save: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const matches = filterVoices(catalog.voices, query)
  const selected = catalog.voices.find((voice) => voice.id === settings.voice)
  // Keep the current voice listed while a search hides it, so the select still shows it.
  const listed = selected && !matches.includes(selected) ? [selected, ...matches] : matches
  const voiceFetch = download.voice
  const english = catalog.voices.length - 1
  const hint = catalog.status === 'needs-model' ? 'More voices appear once the model is downloaded.'
    : catalog.status === 'error' ? `Couldn’t load the voice list: ${catalog.error}`
    : `${english} English voices (Apache-2.0). Each downloads once (~256 KB) when picked.`
  return (
    <div className="settings-row read-aloud-voice-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">Voice</span>
        <span className="settings-row-hint" data-voice-count={english}>{hint}</span>
        {selected?.description && <span className="settings-row-info read-aloud-voice-description">{selected.description}</span>}
      </div>
      <div className="settings-row-control read-aloud-voice-picker">
        {catalog.voices.length > 1 && <input className="settings-input read-aloud-voice-search" type="search" value={query} placeholder="Search voices (e.g. british, calm, male)" spellCheck={false} aria-label="Search voices" onChange={(event) => setQuery(event.target.value)} />}
        <select className="settings-select" value={selected ? settings.voice : 'default'} aria-label="Read Aloud voice" onChange={(event) => save({ voice: event.target.value })}>
          {groupVoices(listed, { recommended: !query }).map((group) => (
            <optgroup key={group.key} label={group.label}>
              {group.voices.map((voice) => <option key={voice.id} value={voice.id}>{voiceSummary(voice, { accent: group.key === 'recommended' })}</option>)}
            </optgroup>
          ))}
        </select>
        {query && <span className="settings-row-hint" data-voice-matches={matches.length}>{matches.length === 0 ? 'No voices match.' : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}</span>}
        {voiceFetch && <progress className="read-aloud-voice-progress" max={100} value={downloadPercent(voiceFetch.loaded, voiceFetch.total)} aria-label="Voice download progress" />}
      </div>
    </div>
  )
}

function ConditionerRow({ conditioner, value, save }: { conditioner: ModelConditioner; value: string | number | undefined; save: (value: string | number | undefined) => void }): React.JSX.Element {
  const label = conditioner.name.replace(/_/g, ' ')
  return (
    <SettingsRow label={label.charAt(0).toUpperCase() + label.slice(1)} hint={`Model conditioner “${conditioner.name}” from the checkpoint’s config. Leave on the model default unless experimenting.`}>
      {conditioner.type === 'lut'
        ? (
          <select className="settings-select" value={value === undefined ? '' : String(value)} aria-label={`Conditioner ${conditioner.name}`} onChange={(event) => save(event.target.value === '' ? undefined : event.target.value)}>
            <option value="">Model default</option>
            {conditioner.values.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          )
        : <input className="settings-input" type="number" step={0.05} value={value === undefined ? '' : String(value)} placeholder="default" aria-label={`Conditioner ${conditioner.name}`} onChange={(event) => save(event.target.value === '' ? undefined : Number(event.target.value))} />}
    </SettingsRow>
  )
}

/** Advanced (collapsed): where Phonon runs, threads, quantization, the checkpoint's other conditioners. */
function PhononAdvanced({ settings, catalog, save }: { settings: Settings; catalog: ReadAloudCatalogInfo; save: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const summary = `${settings.device === 'webgpu' ? 'WebGPU' : settings.device === 'auto' ? 'Auto' : 'CPU'} · ${settings.threads === 'auto' ? 'auto threads' : `${settings.threads} threads`} · q8`
  const setCondition = (name: string, value: string | number | undefined): void => {
    const conditions = { ...settings.conditions }
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) delete conditions[name]
    else conditions[name] = value
    save({ conditions })
  }
  return (
    <SettingsDisclosure id="read-aloud-advanced" title="Advanced" summary={summary}>
      <SettingsRow label="Device" hint="CPU is the default: for a model this small it is often faster than WebGPU on Apple silicon. Auto uses the GPU when one is offered.">
        <SettingsSegmented value={settings.device} options={DEVICE_OPTIONS} ariaLabel="Phonon device" onChange={(device) => save({ device })} />
      </SettingsRow>
      <SettingsRow label="Threads" hint="CPU threads Phonon generates on. 2 (the default) keeps up at 3×; past a few, splitting the work costs more than it saves.">
        <select className="settings-select" value={String(settings.threads)} aria-label="Phonon threads" onChange={(event) => save({ threads: event.target.value === 'auto' ? 'auto' : Number(event.target.value) })}>
          {THREAD_OPTIONS.map((option) => <option key={option} value={String(option)}>{option === 'auto' ? 'Auto (3)' : option === 2 ? '2 (default)' : option}</option>)}
        </select>
      </SettingsRow>
      <SettingsRow label="Quantization" hint="8-bit weights: smaller and faster than f32 on the CPU.">
        <span className="read-aloud-fixed-value">q8</span>
      </SettingsRow>
      {catalog.conditioners.map((conditioner) => (
        <ConditionerRow key={conditioner.name} conditioner={conditioner} value={settings.conditions[conditioner.name]} save={(value) => setCondition(conditioner.name, value)} />
      ))}
      <p className="read-aloud-advanced-note">Phonon has no pitch control; voices differ in pitch instead.</p>
    </SettingsDisclosure>
  )
}

/**
 * The one "Voice" section: Read Aloud's engine, voice, speed and Phonon levers, and a tester that
 * speaks the sample with exactly those (so what you hear here is what Read Aloud sounds like).
 */
function VoiceSection({ settings, download, test, save }: { settings: Settings; download: ReadAloudDownloadState; test: ReadAloudTestState; save: (patch: Partial<Settings>) => void }): React.JSX.Element {
  const api = window.api.browser.readAloud
  const catalog = useVoiceCatalog(download.status === 'ready')
  const [text, setText] = useState(READ_ALOUD_SAMPLE_TEXT)
  const [endpoint, setEndpoint] = useState(settings.endpoint)
  const [endpointVoice, setEndpointVoice] = useState(settings.endpointVoice)
  const [temperature, setTemperature] = useSettled(settings.temperature, (value) => save({ temperature: value }))
  useEffect(() => {
    setEndpoint(settings.endpoint)
    setEndpointVoice(settings.endpointVoice)
  }, [settings.endpoint, settings.endpointVoice])
  const running = test.status === 'preparing' || test.status === 'loading' || test.status === 'playing'
  const phonon = settings.engine === 'phonon'
  const play = (): void => {
    if (running) {
      void api.stopTest().catch(() => undefined)
      return
    }
    void api.test({ text }).catch(() => undefined)
  }
  return (
    <SettingsGroup title="Voice" className="read-aloud-voice-section">
      <SettingsRow label="Engine" hint={phonon ? 'Phonon runs inside Surffish. Falls back to the system voice if it can’t start.' : settings.engine === 'system' ? 'The voices built into the system.' : 'An OpenAI-compatible /v1/audio/speech server on this machine (e.g. ptts-openai-server). Loopback addresses only.'}>
        <select className="settings-select" value={settings.engine} aria-label="Read Aloud voice engine" onChange={(event) => save({ engine: event.target.value as ReadAloudEngineId })}>
          {(Object.keys(ENGINE_LABELS) as ReadAloudEngineId[]).map((id) => <option key={id} value={id}>{ENGINE_LABELS[id]}</option>)}
        </select>
      </SettingsRow>
      {settings.engine === 'openai' && (
        <SettingsRow label="Server" hint="Base URL and voice (empty voice: the server’s default).">
          <input className="settings-input" type="url" value={endpoint} spellCheck={false} aria-label="Speech server base URL" onChange={(event) => setEndpoint(event.target.value)} onBlur={() => save({ endpoint })} />
          <input className="settings-input" type="text" value={endpointVoice} spellCheck={false} placeholder="voice" aria-label="Speech server voice" onChange={(event) => setEndpointVoice(event.target.value)} onBlur={() => save({ endpointVoice })} />
        </SettingsRow>
      )}
      {phonon && <VoicePicker settings={settings} catalog={catalog} download={download} save={save} />}
      <SpeedControl speed={settings.speed} save={(speed) => save({ speed })} />
      {phonon && (
        <>
          <label className="settings-row settings-slider-row read-aloud-expressiveness-row">
            <span className="settings-row-label" title={`Phonon’s sampling temperature (default ${READ_ALOUD_DEFAULT_TEMPERATURE}). Higher varies the delivery more; very high can slur.`}>Expressiveness</span>
            <input className="settings-range" type="range" min={0} max={READ_ALOUD_MAX_TEMPERATURE} step={0.05} value={temperature} style={{ '--range-fill': `${(temperature / READ_ALOUD_MAX_TEMPERATURE) * 100}%` } as React.CSSProperties} aria-label="Expressiveness" aria-valuetext={temperature.toFixed(2)} onChange={(event) => setTemperature(Math.round(Number(event.target.value) * 100) / 100)} />
            <output className="settings-slider-value">{temperature.toFixed(2)}</output>
          </label>
          <SettingsRow label="Vary each read" hint="Off: the same text always sounds the same. On: a new take every time you press play.">
            <input type="checkbox" className="settings-switch" checked={settings.varySeed} aria-label="Vary each read" onChange={(event) => save({ varySeed: event.target.checked })} />
          </SettingsRow>
          <SettingsRow label="Read numbers, dates & times naturally" hint="How Phonon spells out text before speaking. Changing it restarts the model.">
            <select className="settings-select" value={settings.rewrites} aria-label="Text normalization" onChange={(event) => save({ rewrites: event.target.value as ReadAloudRewrites })}>
              {REWRITE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </SettingsRow>
        </>
      )}
      <div className="read-aloud-test-text">
        <textarea className="settings-input" rows={3} maxLength={READ_ALOUD_TEST_MAX_CHARS} value={text} spellCheck={false} aria-label="Sample text" onChange={(event) => setText(event.target.value)} />
        <div className="read-aloud-test-actions">
          <button className="settings-action secondary" type="button" disabled={text === READ_ALOUD_SAMPLE_TEXT} onClick={() => setText(READ_ALOUD_SAMPLE_TEXT)}>Reset text</button>
          <button className={`settings-action ${running ? 'secondary' : 'primary'} read-aloud-test-play`} type="button" aria-label={running ? 'Stop the voice test' : 'Play the voice test'} onClick={play}>{running ? 'Stop' : 'Play'}</button>
        </div>
      </div>
      <TestResult test={test} />
      {phonon && <PhononAdvanced settings={settings} catalog={catalog} save={save} />}
    </SettingsGroup>
  )
}

export function ReadAloudSettings(): React.JSX.Element {
  const { settings, download, test, save } = useReadAloud()
  const on = settings?.enabled === true
  return (
    <div className="read-aloud-settings">
      <SettingsGroup title="Read Aloud (experimental)" status={settings === null ? undefined : on ? 'On' : 'Off'} statusOn={on}>
        <SettingsRow
          label="Enable Read Aloud"
          hint="Listen to articles and selected text, spoken on this Mac."
          info={`Right-click a page → Read Aloud (Read Page, Read from Here, Read Selection), ⇧⌘U to play/pause, or Listen on a Reading List item. Uses Phonon (an on-device voice model, Apache-2.0); turning this on downloads it once (${formatDownloadSize(firstUseDownloadBytes())}) into this profile. Text never leaves this computer. Off: nothing is loaded, and the download is kept until you delete it.`}
        >
          <input type="checkbox" className="settings-switch" checked={on} disabled={settings === null} onChange={(event) => save({ enabled: event.target.checked })} aria-label="Enable Read Aloud" />
        </SettingsRow>
        {settings && <ModelDownloadRow download={download} enabled={on} />}
      </SettingsGroup>
      {on && settings && <VoiceSection settings={settings} download={download} test={test} save={save} />}
    </div>
  )
}
