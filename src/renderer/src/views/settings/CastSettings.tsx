import { useEffect, useState } from 'react'
import type { CastSettings as Settings } from '../../../../shared/cast'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/** Settings → General → Features → Cast: the toolbar cast button, ⌘K commands and device discovery. On by default. */
export function CastSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let live = true
    const take = (next: Settings): void => { if (live) setSettings(next) }
    void window.api.browser.cast.getSettings().then(take).catch(() => undefined)
    const off = window.api.browser.cast.onSettingsChange(take)
    return () => {
      live = false
      off()
    }
  }, [])
  const on = settings?.enabled === true
  return (
    <SettingsGroup title="Cast" status={settings === null ? undefined : on ? 'On' : 'Off'} statusOn={on}>
      <SettingsRow
        label="Cast to Chromecast"
        hint="Play a page’s video on a Chromecast or Google TV on your network."
        info="Looks for devices only while the cast picker is open, briefly at launch and when a video starts (at most every 15 min). The Chromecast loads videos itself, not through the SOCKS proxy."
      >
        <input type="checkbox" className="settings-switch" checked={on} disabled={settings === null} onChange={(event) => { void window.api.browser.cast.setSettings({ enabled: event.target.checked }).then(setSettings).catch(() => undefined) }} aria-label="Cast to Chromecast" />
      </SettingsRow>
    </SettingsGroup>
  )
}
