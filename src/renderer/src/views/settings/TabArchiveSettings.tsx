import { archiveAfterLabel, SUGGESTED_TAB_ARCHIVE_AFTER, TAB_ARCHIVE_AFTER_OPTIONS, type TabArchiveAfter, type TabArchiveSettings as Settings } from '../../../../shared/tab-archive'
import { useTabArchive } from '../tab-archive/useTabArchive'
import { SettingsGroup, SettingsRow } from './SettingsControls'
import '../tab-archive/tab-archive.css'

function update(patch: Partial<Settings>): void {
  void window.api.browser.tabArchive.setSettings(patch).catch(() => undefined)
}

/** Settings → General → Tab archive: auto-archive idle tabs (off until the one-time prompt is accepted) and switch-to-open-tab. */
export function TabArchiveSettings(): React.JSX.Element {
  const { settings, tabs, loaded } = useTabArchive()
  const on = settings.archiveAfter !== 'off'
  return (
    <SettingsGroup title="Tab archive" status={loaded ? (on ? archiveAfterLabel(settings.archiveAfter) : 'Off') : undefined} statusOn={on}>
      {loaded && !settings.prompted && !on && (
        <div className="tab-archive-prompt" role="note">
          <p>Tidy up automatically? Tabs you haven't opened for a day close into the Archived list in the sidebar, where you can search and restore them.</p>
          <button className="settings-action primary" type="button" onClick={() => update({ archiveAfter: SUGGESTED_TAB_ARCHIVE_AFTER, prompted: true })}>Turn on</button>
          <button className="settings-action secondary" type="button" onClick={() => update({ prompted: true })}>No thanks</button>
        </div>
      )}
      <SettingsRow label="Archive unused tabs" hint="Closes tabs you haven't opened in a while into Archived." info="Find them in the sidebar and ⌘K / Ctrl+K search. Pinned, playing, private and unsaved PDF tabs are never archived. Up to 500 are kept.">
        <select
          className="settings-select"
          value={settings.archiveAfter}
          disabled={!loaded}
          onChange={(event) => update({ archiveAfter: event.target.value as TabArchiveAfter, prompted: true })}
          aria-label="Archive unused tabs after"
        >
          {TAB_ARCHIVE_AFTER_OPTIONS.map((option) => <option key={option} value={option}>{archiveAfterLabel(option)}</option>)}
        </select>
      </SettingsRow>
      <SettingsRow label="Switch to open tabs" hint="Typing the address of a tab that's already open switches to it instead of opening it twice.">
        <input type="checkbox" className="settings-switch" checked={settings.switchToOpenTab} disabled={!loaded} onChange={(event) => update({ switchToOpenTab: event.target.checked })} aria-label="Switch to an open tab instead of opening a duplicate" />
      </SettingsRow>
      {tabs.length > 0 && (
        <SettingsRow label="Archived tabs" hint={`${tabs.length} archived. They're also cleared with browsing history.`}>
          <button className="settings-action secondary" type="button" onClick={() => { if (window.confirm(`Clear all ${tabs.length} archived tabs?`)) void window.api.browser.tabArchive.clear() }}>Clear</button>
        </SettingsRow>
      )}
    </SettingsGroup>
  )
}
