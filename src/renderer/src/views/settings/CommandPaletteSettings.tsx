import { useEffect, useState } from 'react'
import type { CommandPaletteSettings as PaletteSettings } from '../../../../shared/command-palette'
import { formatAccelerator } from '../../../../shared/command-palette'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/** Settings → General: turn the Cmd/Ctrl+K palette off to leave those keys to sites (Slack, GitHub…). */
export function CommandPaletteSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<PaletteSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.api.browser.commandPalette.onSettingsChange(setSettings)
    void window.api.browser.commandPalette.getSettings().then((next) => {
      if (!cancelled) setSettings(next)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const platform = window.api.platform
  const palette = formatAccelerator('CmdOrCtrl+K', platform)
  const tabSearch = formatAccelerator('CmdOrCtrl+Shift+A', platform)
  return (
    <SettingsGroup title="Command palette" status={settings ? (settings.enabled ? 'On' : 'Off') : undefined} statusOn={settings?.enabled === true}>
      <SettingsRow label={`${palette} command palette`} hint={`Searches commands, tabs, favourites and history; ${tabSearch} searches tabs.`} info="Turn off to let sites use these keys.">
        <input
          type="checkbox"
          className="settings-switch"
          checked={settings?.enabled ?? true}
          disabled={!settings}
          onChange={(event) => {
            const enabled = event.target.checked
            setSettings({ enabled })
            void window.api.browser.commandPalette.setSettings({ enabled }).then(setSettings).catch(() => undefined)
          }}
          aria-label="Enable the command palette shortcut"
        />
      </SettingsRow>
    </SettingsGroup>
  )
}
