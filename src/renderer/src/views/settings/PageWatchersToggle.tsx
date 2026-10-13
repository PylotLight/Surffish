import { SettingsGroup, SettingsRow } from './SettingsControls'
import { usePageWatchersEnabled } from './useWatchers'

/** Settings → General → Page Watchers: "Enable page watchers" (on by default). */
export function PageWatchersToggle(): React.JSX.Element {
  const enabled = usePageWatchersEnabled()
  return (
    <SettingsGroup title="Page Watchers" status={enabled === null ? undefined : enabled ? 'On' : 'Off'} statusOn={enabled === true}>
      <SettingsRow
        label="Enable page watchers"
        hint="Watch pages for changes (right-click → Watch This Page for Changes…) and get a notification when they change. Turning this off stops all checks and hides Watchers; saved watchers are kept and resume when you turn it back on."
      >
        <input
          type="checkbox"
          className="settings-switch"
          checked={enabled ?? false}
          disabled={enabled === null}
          onChange={(event) => { void window.api.browser.watchers.setEnabled(event.target.checked).catch(() => undefined) }}
          aria-label="Enable page watchers"
        />
      </SettingsRow>
    </SettingsGroup>
  )
}
