import { useCallback, useEffect, useRef, useState } from 'react'
import type { DefaultBrowserStatus } from '../../../../shared/types'
import { SettingsGroup, SettingsRow } from './SettingsControls'

/** macOS confirms the change in a system dialog, so re-check for a while after asking. */
const RECHECK_INTERVAL_MS = 1000
const RECHECK_FOR_MS = 20_000

export function DefaultBrowserSettings(): React.JSX.Element {
  const [status, setStatus] = useState<DefaultBrowserStatus | null>(null)
  const [message, setMessage] = useState('')
  const recheckTimer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async (): Promise<DefaultBrowserStatus | null> => {
    try {
      const next = await window.api.browser.defaultBrowser.get()
      setStatus(next)
      return next
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(recheckTimer.current)
    }
  }, [refresh])

  async function makeDefault(): Promise<void> {
    setMessage('')
    try {
      const next = await window.api.browser.defaultBrowser.set()
      setStatus(next)
      if (next.isDefault) return
      setMessage(next.platform === 'darwin'
        ? 'Confirm the change in the macOS dialog (“Use Surffish”).'
        : next.platform === 'win32' ? 'Choose Surffish as the web browser in Default apps.' : 'Your desktop may ask you to confirm the change.')
      window.clearInterval(recheckTimer.current)
      const startedAt = Date.now()
      recheckTimer.current = window.setInterval(() => {
        void refresh().then((latest) => {
          if (latest?.isDefault || Date.now() - startedAt > RECHECK_FOR_MS) {
            window.clearInterval(recheckTimer.current)
            if (latest?.isDefault) setMessage('')
          }
        })
      }, RECHECK_INTERVAL_MS)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not change the default browser.')
    }
  }

  const isDefault = status?.isDefault === true
  return (
    <SettingsGroup title="Default browser" status={status ? (isDefault ? 'Default' : 'Not default') : undefined} statusOn={isDefault}>
      <SettingsRow label="Open links in Surffish" hint={status && !status.canSet ? 'Available in the installed app; development builds can’t register as the system browser.' : 'Links from other apps open in a new Surffish tab.'}>
        <button className="settings-action secondary" type="button" disabled={!status || !status.canSet || isDefault} onClick={() => void makeDefault()}>{isDefault ? 'Default' : 'Make default'}</button>
      </SettingsRow>
      {message && <p className="settings-message" role="status">{message}</p>}
    </SettingsGroup>
  )
}
