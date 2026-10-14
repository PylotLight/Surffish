import { useEffect, useState } from 'react'
import { SettingsRow } from './SettingsControls'

type Snapshot = Awaited<ReturnType<typeof window.api.browser.memorySaver.get>>

/** Settings → General → Tabs: discard background tabs when memory is tight, and same-site process sharing (both on by default). */
export function MemorySaverSettings(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    let live = true
    void window.api.browser.memorySaver.get().then((next) => { if (live) setSnapshot(next) }).catch(() => undefined)
    const off = window.api.browser.memorySaver.onChange(setSnapshot)
    return () => {
      live = false
      off()
    }
  }, [])
  const discarded = snapshot?.discarded ?? 0
  const set = (patch: Parameters<typeof window.api.browser.memorySaver.set>[0]): void => {
    void window.api.browser.memorySaver.set(patch).then(setSnapshot).catch(() => undefined)
  }
  const sharePending = snapshot ? snapshot.shareSiteProcesses !== snapshot.shareSiteProcessesActive : false
  return (
    <>
    <SettingsRow
      label="Memory saver"
      hint={`When your computer runs low on memory, or Surffish uses more than half of it, tabs you haven't looked at for 5 minutes or more go to sleep early, least recently used first. Playing, pinned and tabs with unsaved form input stay awake.${discarded > 0 ? ` ${discarded} tab${discarded === 1 ? '' : 's'} put to sleep this session.` : ''}`}
    >
      <input
        type="checkbox"
        className="settings-switch"
        checked={snapshot?.enabled ?? true}
        disabled={!snapshot}
        onChange={(event) => { set({ enabled: event.target.checked }) }}
        aria-label="Put background tabs to sleep when memory is low"
      />
    </SettingsRow>
    <SettingsRow
      label="Share processes between tabs of the same site"
      hint={`Tabs from the same site run in one process, which uses much less memory with many tabs open. If that process crashes or a page hangs, every open tab of that site is affected. Different sites, private tabs and Spaces always get their own processes.${sharePending ? ' Restart Surffish to apply.' : ''}`}
    >
      <input
        type="checkbox"
        className="settings-switch"
        checked={snapshot?.shareSiteProcesses ?? true}
        disabled={!snapshot}
        onChange={(event) => { set({ shareSiteProcesses: event.target.checked }) }}
        aria-label="Share processes between tabs of the same site"
      />
    </SettingsRow>
    </>
  )
}
