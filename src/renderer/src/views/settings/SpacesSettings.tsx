import { formatAccelerator } from '../../../../shared/command-palette'
import { useSpaces } from '../spaces/SpacesSwitcher'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/** Settings → General → Spaces: "Enable Spaces" (off by default). */
export function SpacesSettings(): React.JSX.Element {
  const snapshot = useSpaces()
  const platform = window.api.platform
  const shortcut = formatAccelerator(platform === 'darwin' ? 'Ctrl+1' : 'Ctrl+Shift+1', platform)
  const enabled = snapshot?.enabled ?? false
  return (
    <SettingsGroup title="Spaces" status={snapshot ? (enabled ? `${snapshot.spaces.length} Space${snapshot.spaces.length === 1 ? '' : 's'}` : 'Off') : undefined} statusOn={enabled}>
      <SettingsRow
        label="Enable Spaces"
        hint="Separate sets of tabs (Work, Personal…) with their own pinned tabs."
        info={`Switch from the bottom of the sidebar, with ${shortcut}…9 or a two-finger swipe on the sidebar. A Space can have its own logins and its own proxy (right-click it). Turning Spaces off moves every tab into one list.`}
      >
        <input
          type="checkbox"
          className="settings-switch"
          checked={enabled}
          disabled={!snapshot}
          onChange={(event) => { void window.api.browser.spaces.setEnabled(event.target.checked).catch(() => undefined) }}
          aria-label="Enable Spaces"
        />
      </SettingsRow>
    </SettingsGroup>
  )
}
