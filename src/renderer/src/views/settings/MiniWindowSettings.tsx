import { useEffect, useState } from 'react'
import { acceleratorFromKeyEvent, formatAccelerator, MINI_WINDOW_MIN_OPACITY, MINI_WINDOW_PEEK_DELAYS, type MiniWindowGrouping, type MiniWindowHeaderPlacement, type MiniWindowMenuBarIcon, type MiniWindowSettings as Settings } from '../../../../shared/mini-window'
import { SettingsGroup, SettingsRow, SettingsSlider } from './SettingsControls'

const IS_MAC = navigator.platform.toUpperCase().includes('MAC')
const IS_LINUX = navigator.platform.toUpperCase().includes('LINUX')

interface Status { shortcut: string; registered: boolean; error: string | null }

/**
 * Settings → General → Mini window: the page the global shortcut opens (empty: pop out the current
 * tab), the shortcut itself (press keys to record, Clear to turn it off), how several mini windows
 * group, where the header shows, the menu bar icon, tuck to screen edge (and peek on hover, with its
 * delay) and opacity.
 */

const GROUPING_HINTS: Record<MiniWindowGrouping, string> = {
  tabs: 'Popped-out tabs join the last used mini window as tabs (one edge tab each). Drag a tab out of the strip to give it its own window; drop a window\'s header on another, or tuck it to an edge that already has one, to merge them.',
  stack: 'Each tab gets its own mini window. Windows tucked to the same screen edge share one edge tab and slide out together, stacked along the edge.',
  separate: 'Each tab gets its own mini window with its own edge tab.'
}
const HEADER_HINTS: Record<MiniWindowHeaderPlacement, string> = {
  float: 'The header and tab strip show just above the mini window (below it when there is no room above), so they never cover the page.',
  push: 'The header and tab strip show inside the mini window and move the page down while they are visible.',
  overlay: 'The header and tab strip slide over the top of the page while the pointer is near them.'
}

const MENU_BAR_NAME = IS_MAC ? 'menu bar' : 'system tray'
const MENU_BAR_HINTS: Record<MiniWindowMenuBarIcon, string> = {
  'in-use': `Send a mini window to the ${MENU_BAR_NAME} (its header's button, ⌘K, or a tab's right-click menu) and an icon there drops it in under the icon. The icon shows only while one lives there.`,
  always: `The ${MENU_BAR_NAME} icon always shows; click it to drop in a mini window that lives there, or to send the current tab there.`,
  never: `No ${MENU_BAR_NAME} icon, and mini windows can't be sent there.`
}

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
      <SettingsRow label="Mini window grouping" hint={GROUPING_HINTS[settings?.grouping ?? 'tabs']}>
        <select
          className="settings-select"
          value={settings?.grouping ?? 'tabs'}
          disabled={!settings}
          aria-label="Mini window grouping"
          onChange={(event) => update({ grouping: event.target.value as MiniWindowGrouping })}
        >
          <option value="tabs">Tabs</option>
          <option value="stack">Stack</option>
          <option value="separate">Separate</option>
        </select>
      </SettingsRow>
      <SettingsRow label="Mini window header" hint={HEADER_HINTS[settings?.headerPlacement ?? 'float']}>
        <select
          className="settings-select"
          value={settings?.headerPlacement ?? 'float'}
          disabled={!settings}
          aria-label="Mini window header"
          onChange={(event) => update({ headerPlacement: event.target.value as MiniWindowHeaderPlacement })}
        >
          <option value="float">Float above</option>
          <option value="push">Push content</option>
          <option value="overlay">Overlay</option>
        </select>
      </SettingsRow>
      <SettingsRow label={IS_MAC ? 'Menu bar icon' : 'Tray icon'} hint={MENU_BAR_HINTS[settings?.menuBarIcon ?? 'in-use']}>
        <select
          className="settings-select"
          value={settings?.menuBarIcon ?? 'in-use'}
          disabled={!settings}
          aria-label="Mini window menu bar icon"
          onChange={(event) => update({ menuBarIcon: event.target.value as MiniWindowMenuBarIcon })}
        >
          <option value="in-use">When in use</option>
          <option value="always">Always</option>
          <option value="never">Never</option>
        </select>
      </SettingsRow>
      <SettingsRow
        label="Tuck to screen edge"
        hint="Drag the mini window against a screen edge (or use its header's arrow) and it slides away, leaving a small tab on the edge. Click the tab or press the toggle shortcut to slide it back out."
      >
        <input
          type="checkbox"
          className="settings-switch"
          disabled={!settings}
          checked={settings?.tuckToEdge ?? true}
          aria-label="Tuck the mini window to a screen edge"
          onChange={(event) => update({ tuckToEdge: event.target.checked })}
        />
      </SettingsRow>
      {settings?.tuckToEdge && (
        <SettingsRow label="Peek tucked mini on hover" hint="Rest the pointer on a tucked mini window's edge tab and it slides out for a look; move away and it tucks back in. Click or type in it to keep it out.">
          <input
            type="checkbox"
            className="settings-switch"
            checked={settings.peekOnHover}
            aria-label="Peek the tucked mini window on hover"
            onChange={(event) => update({ peekOnHover: event.target.checked })}
          />
        </SettingsRow>
      )}
      {settings?.tuckToEdge && settings.peekOnHover && (
        <SettingsRow label="Hover delay" hint="How long the pointer rests on the edge tab before the mini window peeks out.">
          <select
            className="settings-select"
            value={settings.peekDelayMs}
            aria-label="Mini window peek hover delay"
            onChange={(event) => update({ peekDelayMs: Number(event.target.value) })}
          >
            {MINI_WINDOW_PEEK_DELAYS.map((ms) => <option key={ms} value={ms}>{ms === 1000 ? '1 s' : `${ms} ms`}</option>)}
          </select>
        </SettingsRow>
      )}
      {!IS_LINUX && settings && (
        <SettingsSlider label="Opacity" value={Math.round(settings.opacity * 100)} unit="%" min={Math.round(MINI_WINDOW_MIN_OPACITY * 100)} max={100} step={5} onChange={(value) => update({ opacity: value / 100 })} />
      )}
      {message && <p className="settings-message" role="status">{message}</p>}
    </SettingsGroup>
  )
}
