import { useEffect, useState } from 'react'
import type { DebugLoggingState } from '../../../../shared/stall-log'
import { SettingsRow } from './SettingsControls'

/** Settings → Advanced → Developer → Debug logging: stalls, crashes and a heartbeat to stalls.log (main/stall-logger.ts). Off by default. */
export function DebugLoggingSetting(): React.JSX.Element {
  const [state, setState] = useState<DebugLoggingState | null>(null)
  useEffect(() => {
    let live = true
    void window.api.browser.debugLogging.get().then((next) => { if (live) setState(next) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  const on = state?.active === true
  return (
    <>
      <SettingsRow
        label="Debug logging"
        hint={state?.forcedByEnv ? 'On for this run (SURFFISH_DEBUG_STALLS=1).' : 'Logs main-thread stalls, crashes and a 30 s heartbeat to stalls.log, for tracking down freezes.'}
        info="Pages are named by host only; private tabs are never named. The log is capped at about 5 MB. Off: nothing is recorded."
      >
        <input
          type="checkbox"
          className="settings-switch"
          checked={on}
          disabled={state === null || state.forcedByEnv}
          onChange={(event) => void window.api.browser.debugLogging.set({ enabled: event.target.checked }).then(setState).catch(() => undefined)}
          aria-label="Enable debug logging"
        />
      </SettingsRow>
      {state && (on || state.enabled) && (
        <SettingsRow label="Stall log" hint={state.logPath}>
          <button className="settings-action secondary" type="button" aria-label="Reveal stall log" onClick={() => void window.api.browser.debugLogging.reveal().catch(() => undefined)}>Reveal</button>
        </SettingsRow>
      )}
    </>
  )
}
