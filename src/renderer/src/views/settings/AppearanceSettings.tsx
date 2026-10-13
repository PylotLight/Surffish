import { useEffect, useState } from 'react'
import type { SidebarBackdropMode, SidebarBackdropSettings } from '../../../../shared/sidebar-backdrop'
import { SettingsGroup, SettingsRow } from './SettingsControls'

const MODE_HINT: Record<SidebarBackdropMode, string> = {
  native: 'Blurs the page behind the sidebar when it slides over a site. Turn off for a solid sidebar (saves a little GPU work while it’s open).',
  snapshot: 'Blurs a snapshot of the page behind the sidebar when it slides over a site. Turn off for a solid sidebar.',
  solid: 'The sidebar uses a solid, high-contrast background over sites.'
}

/** Settings → General → Appearance: sidebar blur and the bookmarks bar. */
export function AppearanceSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<SidebarBackdropSettings | null>(null)
  const [mode, setMode] = useState<SidebarBackdropMode>('solid')
  const [barVisible, setBarVisible] = useState(false)
  const isMac = window.api.platform === 'darwin'

  useEffect(() => {
    let mounted = true
    void window.api.browser.sidebarBackdrop.get().then((result) => {
      if (!mounted) return
      setSettings(result.settings)
      setMode(result.state.mode)
    }).catch(() => undefined)
    void window.api.browser.bookmarks.bar.get().then((visible) => { if (mounted) setBarVisible(visible) }).catch(() => undefined)
    const offSettings = window.api.browser.sidebarBackdrop.onSettings((next) => {
      setSettings(next)
      void window.api.browser.sidebarBackdrop.get().then((result) => { if (mounted) setMode(result.state.mode) }).catch(() => undefined)
    })
    const offBar = window.api.browser.bookmarks.bar.onChange(setBarVisible)
    return () => {
      mounted = false
      offSettings()
      offBar()
    }
  }, [])

  // With blur on, a platform without a blur path still reports 'solid'; say so instead of promising one.
  const hint = settings?.blur === false ? MODE_HINT.solid : mode === 'solid' ? 'No blur on this platform yet: the sidebar uses a solid, high-contrast background over sites.' : MODE_HINT[mode]
  return (
    <SettingsGroup title="Appearance">
      <SettingsRow label="Sidebar blur" hint={hint}>
        <input
          type="checkbox"
          className="settings-switch"
          disabled={!settings}
          checked={settings?.blur ?? true}
          aria-label="Sidebar blur"
          onChange={(event) => void window.api.browser.sidebarBackdrop.set({ blur: event.target.checked }).then(setSettings).catch(() => undefined)}
        />
      </SettingsRow>
      <SettingsRow label="Bookmarks bar" hint={`Favourites under the toolbar (${isMac ? '⇧⌘B' : 'Ctrl+Shift+B'}).`}>
        <input
          type="checkbox"
          className="settings-switch"
          checked={barVisible}
          aria-label="Show bookmarks bar"
          onChange={(event) => void window.api.browser.bookmarks.bar.set(event.target.checked).then(setBarVisible).catch(() => undefined)}
        />
      </SettingsRow>
    </SettingsGroup>
  )
}
