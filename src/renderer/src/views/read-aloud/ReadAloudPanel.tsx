import { useEffect, useState } from 'react'
import { READ_ALOUD_SPEEDS, type ReadAloudSettings, type ReadAloudState } from '../../../../shared/read-aloud'
import { formatDownloadSize, READ_ALOUD_VOICES } from '../../../../shared/read-aloud-assets'
import './read-aloud.css'

const ENGINE_LABELS: Record<string, string> = { phonon: 'Phonon (on-device)', system: 'System voice', openai: 'Local speech server' }

function useReadAloudSettings(): [ReadAloudSettings | null, (patch: Partial<ReadAloudSettings>) => void] {
  const [settings, setSettings] = useState<ReadAloudSettings | null>(null)
  useEffect(() => {
    let live = true
    void window.api.browser.readAloud.getSettings().then((next) => { if (live) setSettings(next) }).catch(() => undefined)
    const off = window.api.browser.readAloud.onSettingsChange((next) => { if (live) setSettings(next) })
    return () => {
      live = false
      off()
    }
  }, [])
  const save = (patch: Partial<ReadAloudSettings>): void => {
    void window.api.browser.readAloud.setSettings(patch).then(setSettings).catch(() => undefined)
  }
  return [settings, save]
}

/** The Read Aloud player popover (lazy chunk, loads with the first open). */
export function ReadAloudPanel({ state, onClose }: { state: ReadAloudState; onClose: () => void }): React.JSX.Element {
  const [settings, save] = useReadAloudSettings()
  const control = (action: Parameters<typeof window.api.browser.readAloud.control>[0]): void => {
    void window.api.browser.readAloud.control(action).catch(() => undefined)
  }
  const playing = state.status === 'playing'
  const ready = state.status === 'playing' || state.status === 'paused'
  const download = state.download
  const percent = download && download.total > 0 ? Math.round((download.loaded / download.total) * 100) : 0
  const engine = state.engine ?? settings?.engine ?? 'phonon'
  return (
    <div id="read-aloud-popover" className="read-aloud-popover" role="dialog" aria-label="Read Aloud">
      <div className="read-aloud-header">
        <strong title={state.title}>{state.status === 'error' ? 'Read Aloud' : state.title || 'Read Aloud'}</strong>
        <button type="button" className="read-aloud-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {state.status === 'error' && (
        <div className="read-aloud-message is-error" role="alert">
          <span>{state.error}</span>
          <button type="button" className="read-aloud-text-button" onClick={() => { control('stop'); onClose() }}>Dismiss</button>
        </div>
      )}
      {state.status === 'downloading' && download && (
        <div className="read-aloud-download" role="status">
          <span>Downloading the voice model, first use only ({download.label}): {formatDownloadSize(download.loaded)} of {formatDownloadSize(download.total)}</span>
          <progress max={100} value={percent} aria-label="Download progress" />
        </div>
      )}
      {state.status === 'loading' && <div className="read-aloud-message" role="status">Starting {ENGINE_LABELS[engine] ?? engine}…</div>}
      {state.status !== 'error' && (
        <>
          <div className="read-aloud-transport" role="group" aria-label="Playback">
            <button type="button" aria-label="Previous sentence" title="Previous sentence" disabled={!ready} onClick={() => control('previous')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M18 6l-8 6 8 6Z" /></svg>
            </button>
            <button type="button" className="read-aloud-play" aria-label={playing ? 'Pause' : 'Resume'} title={playing ? 'Pause' : 'Resume'} disabled={!ready} onClick={() => control('toggle')}>
              {playing
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7Z" /></svg>}
            </button>
            <button type="button" aria-label="Next sentence" title="Next sentence" disabled={!ready} onClick={() => control('next')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M6 6l8 6-8 6Z" /></svg>
            </button>
            <button type="button" aria-label="Stop" title="Stop" onClick={() => control('stop')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7Z" /></svg>
            </button>
            <span className="read-aloud-progress" aria-live="polite">{state.total > 0 ? `${Math.min(state.index + 1, state.total)} / ${state.total}` : ''}</span>
          </div>
          {settings && (
            <div className="read-aloud-options">
              <label>
                <span>Speed</span>
                <select value={settings.speed} aria-label="Reading speed" onChange={(event) => save({ speed: Number(event.target.value) })}>
                  {READ_ALOUD_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
                </select>
              </label>
              {engine === 'phonon' && (
                <label>
                  <span>Voice</span>
                  <select value={settings.voice} aria-label="Voice" onChange={(event) => save({ voice: event.target.value })}>
                    {READ_ALOUD_VOICES.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.name}{voice.locale === 'model' ? '' : ` (${voice.locale === 'en-gb' ? 'UK' : 'US'})`}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <p className="read-aloud-engine">
            {ENGINE_LABELS[engine] ?? engine}
            {state.fallbackReason && <span title={state.fallbackReason}> · Phonon unavailable, using the system voice</span>}
          </p>
        </>
      )}
    </div>
  )
}
