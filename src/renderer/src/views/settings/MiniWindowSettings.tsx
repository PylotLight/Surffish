import { useEffect, useState } from 'react'
import { acceleratorFromKeyEvent, formatAccelerator, MINI_WINDOW_MIN_OPACITY, type MiniWindowSettings as Settings } from '../../../../shared/mini-window'
import { SettingsGroup, SettingsRow, SettingsSlider } from './SettingsControls'

const IS_MAC = navigator.platform.toUpperCase().includes('MAC')
const IS_LINUX = navigator.platform.toUpperCase().includes('LINUX')

interface Status { shortcut: string; registered: boolean; error: string | null }

/**
 * Settings → General → Mini window: the page the global shortcut opens (empty: pop out the current
 * tab), the shortcut itself (press keys to record, Clear to turn it off) and opacity.
 */
export function MiniWindowSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [defaultShortcut, setDefaultShortcut] = useState('')
  const [url, setUrl] = useState('')
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.api.browser.miniWindow.getSettings().then((snapshot) => {
      if (!live) return
      setSettings(snapshot.settings)
      setStatus(snapshot.status)
      setDefaultShortcut(snapshot.defaults.shortcut)
      setUrl(snapshot.settings.defaultUrl)
    }).catch(() => undefined)
    const off = window.api.browser.miniWindow.onSettingsChange((snapshot) => {
      setSettings(snapshot.settings)
      setStatus(snapshot.status)
    })
    return () => {
      live = false
      off()
    }
  }, [])

  const update = (patch: Partial<Settings>): void => {
    void window.api.browser.miniWindow.update(patch).then((result) => {
      if (!result.ok) {
        setMessage(result.error)
        return
      }
      setMessage(null)
      setSettings(result.settings)
      setStatus(result.status)
      if ('defaultUrl' in patch) setUrl(result.settings.defaultUrl)
    }).catch(() => undefined)
  }

  const shortcutLabel = settings ? formatAccelerator(settings.shortcut, IS_MAC) : ''
  const shortcutState = !settings?.shortcut ? 'Off' : status?.registered ? 'On' : status?.error ?? 'Not active'
  return (
    <SettingsGroup title="Mini window" status={settings ? (settings.shortcut && status?.registered ? shortcutLabel : 'Shortcut off') : undefined} statusOn={Boolean(settings?.shortcut && status?.registered)}>
      <SettingsRow
        label="Default page"
        hint={`The global shortcut opens this in a small window that stays on top of other apps (e.g. claude.ai or chatgpt.com), signed in with your usual profile. Empty: the shortcut pops out the current tab. Any tab can pop out from its right-click menu or ${IS_MAC ? '⌘⇧M' : 'Ctrl+Shift+M'}.`}
      >
        <input
          className="settings-input"
          type="text"
          value={url}
          placeholder="https://claude.ai"
          spellCheck={false}
          autoCapitalize="none"
          disabled={!settings}
          aria-label="Mini window default page"
          onChange={(event) => setUrl(event.target.value)}
          onBlur={() => { if (settings && url.trim() !== settings.defaultUrl) update({ defaultUrl: url }) }}
          onKeyDown={(event) => { if (event.key === 'Enter') update({ defaultUrl: url }) }}
        />
      </SettingsRow>
      <SettingsRow
        label="Toggle shortcut"
        hint={`Works from any app: opens the default page, then shows or hides the mini window. ${shortcutState === 'On' || shortcutState === 'Off' ? '' : `${shortcutState}. `}Click the field and press new keys to change it.`}
      >
        <input
          className="settings-input"
          type="text"
          readOnly
          value={recording ? 'Press keys…' : shortcutLabel}
          disabled={!settings}
          aria-label="Mini window toggle shortcut"
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            event.preventDefault()
            if (event.key === 'Escape') return void (event.target as HTMLInputElement).blur()
            const accelerator = acceleratorFromKeyEvent(event, IS_MAC)
            if (!accelerator) return
            update({ shortcut: accelerator })
            ;(event.target as HTMLInputElement).blur()
          }}
        />
        <button className="settings-action secondary" type="button" disabled={!settings?.shortcut} aria-label="Turn off the mini window shortcut" onClick={() => update({ shortcut: '' })}>Clear</button>
        {defaultShortcut && settings?.shortcut !== defaultShortcut && (
          <button className="settings-action secondary" type="button" aria-label="Use the default mini window shortcut" onClick={() => update({ shortcut: defaultShortcut })}>Default</button>
        )}
      </SettingsRow>
      {!IS_LINUX && settings && (
        <SettingsSlider label="Opacity" value={Math.round(settings.opacity * 100)} unit="%" min={Math.round(MINI_WINDOW_MIN_OPACITY * 100)} max={100} step={5} onChange={(value) => update({ opacity: value / 100 })} />
      )}
      {message && <p className="settings-message" role="status">{message}</p>}
    </SettingsGroup>
  )
}
