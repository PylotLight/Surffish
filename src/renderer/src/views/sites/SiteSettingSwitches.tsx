import type { BrowserSiteSettings } from '../../../../shared/types'

export type SiteSettingKey = Exclude<keyof BrowserSiteSettings, 'origin'>

/** The per-site switches, shared by the address bar's site menu and Settings → Sites. */
export const SITE_SETTING_SWITCHES: ReadonlyArray<{ key: SiteSettingKey; label: string; hint: string; group: 'privacy' | 'permissions'; aria: string }> = [
  { key: 'blockAds', label: 'Block ads and trackers', hint: 'Uses the browser’s network filter for future requests on this site.', group: 'privacy', aria: 'Block ads and trackers on this site' },
  { key: 'openPopupsInTabs', label: 'Open pop-ups in tabs', hint: 'Routes pop-up windows from this site into a regular browser tab.', group: 'privacy', aria: 'Open this site’s pop-ups in tabs' },
  { key: 'allowMedia', label: 'Camera and microphone', hint: 'Allows media access requests; the operating system may still ask.', group: 'permissions', aria: 'Allow camera and microphone on this site' },
  { key: 'allowGeolocation', label: 'Location', hint: 'Allows location requests.', group: 'permissions', aria: 'Allow location on this site' },
  { key: 'allowNotifications', label: 'Notifications', hint: 'Allows notification requests.', group: 'permissions', aria: 'Allow notifications on this site' },
  { key: 'allowClipboardRead', label: 'Read clipboard', hint: 'Lets the site read what you’ve copied (paste buttons). Copying is always allowed.', group: 'permissions', aria: 'Allow this site to read the clipboard' }
]

/** Short names of the switches that differ from the defaults ("Ads allowed · Camera"). */
export function siteOverrideSummary(settings: BrowserSiteSettings): string {
  const parts: string[] = []
  if (!settings.blockAds) parts.push('Ads allowed')
  if (settings.openPopupsInTabs) parts.push('Pop-ups in tabs')
  if (settings.allowMedia) parts.push('Camera and mic')
  if (settings.allowGeolocation) parts.push('Location')
  if (settings.allowNotifications) parts.push('Notifications')
  if (settings.allowClipboardRead) parts.push('Clipboard')
  return parts.length > 0 ? parts.join(' · ') : 'Defaults'
}

export function SiteSettingSwitches({ settings, onChange, compact = false, origin }: {
  settings: BrowserSiteSettings
  onChange: (key: SiteSettingKey, value: boolean) => void
  compact?: boolean
  origin: string
}): React.JSX.Element {
  const host = (() => { try { return new URL(origin).hostname } catch { return origin } })()
  return (
    <div className={`site-setting-switches${compact ? ' is-compact' : ''}`}>
      {SITE_SETTING_SWITCHES.map((item) => (
        <label className="site-setting-row" key={item.key}>
          <span><strong>{item.label}</strong>{!compact && <small>{item.hint}</small>}</span>
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings[item.key]}
            onChange={(event) => onChange(item.key, event.target.checked)}
            aria-label={compact ? item.aria : `${item.aria} (${host})`}
          />
        </label>
      ))}
    </div>
  )
}
