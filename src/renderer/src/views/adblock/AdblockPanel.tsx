import { useEffect, useState } from 'react'
import type { AdblockPageInfo } from '../../../../shared/adblock-stats'
import './adblock.css'

/**
 * The ad-blocker popover: the site's on/off switch (every blocking layer: network, cosmetic,
 * scriptlets; saved per site), what was blocked on this page by domain, and a link to the site's
 * settings. The switch applies to new requests at once; the open page keeps what was already
 * injected or blocked until it reloads, so the popover offers Reload after a change.
 */
export function AdblockPanel({ tabId, pageUrl, blocked, onClose, onOpenSettings }: {
  tabId: string
  pageUrl: string
  /** The toolbar's pushed count: a change refreshes the domain list. */
  blocked: number
  onClose: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState<AdblockPageInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reloadNeeded, setReloadNeeded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api.browser.adblock.page(tabId).then((next) => {
      if (cancelled) return
      setInfo(next)
      setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [tabId, pageUrl, blocked])
  // A different page (navigation, tab switch, reload) has the new setting already.
  useEffect(() => { setReloadNeeded(false) }, [tabId, pageUrl])

  async function toggle(): Promise<void> {
    if (!info?.origin) return
    setBusy(true)
    setError('')
    try {
      const result = await window.api.browser.adblock.setSiteEnabled(info.origin, !info.enabled)
      if (result.ok) {
        setInfo({ ...info, enabled: result.enabled })
        setReloadNeeded((value) => !value)
      } else {
        setError(result.error)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function reload(): void {
    setReloadNeeded(false)
    void window.api.browser.reload().catch(() => undefined)
  }

  const web = Boolean(info?.origin)
  const enabled = info?.enabled ?? true
  return (
    <div id="adblock-popover" className="adblock-popover" role="dialog" aria-label="Ad blocker">
      <div className="adblock-header">
        <strong>Ad blocker</strong>
        {web && <span className="adblock-host" title={info?.origin ?? ''}>{info?.host}</span>}
      </div>
      {!loaded && <p className="adblock-empty">Loading…</p>}
      {loaded && !web && <p className="adblock-empty">Ad blocking controls are available on web pages.</p>}
      {loaded && web && info && (
        <>
          <label className={`adblock-switch-row${enabled ? '' : ' is-off'}`}>
            <span>
              <strong>{enabled ? 'On for this site' : 'Off for this site'}</strong>
              <small>{enabled ? 'Ads, trackers, page filters and scriptlets are blocked.' : 'Nothing is blocked or hidden on this site.'}</small>
            </span>
            <input
              type="checkbox"
              className="settings-switch adblock-site-switch"
              checked={enabled}
              disabled={busy}
              aria-label={`Block ads and trackers on ${info.host}`}
              onChange={() => void toggle()}
            />
          </label>
          {reloadNeeded && (
            <div className="adblock-reload" role="status">
              <span>Reload to apply to this page.</span>
              <button type="button" className="adblock-reload-button" onClick={reload}>Reload</button>
            </div>
          )}
          {error && <p className="adblock-error" role="alert">{error}</p>}
          <div className="adblock-summary">
            <span className="adblock-total">{info.blocked}</span>
            <span>request{info.blocked === 1 ? '' : 's'} blocked on this page</span>
          </div>
          {info.hosts.length > 0 && (
            <ul className="adblock-hosts" aria-label="Blocked requests by domain">
              {info.hosts.map((entry) => (
                <li key={entry.host} className="adblock-host-row" data-host={entry.host}>
                  <span className="adblock-host-name" title={entry.host}>{entry.host}</span>
                  <span className="adblock-host-count">{entry.count}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="adblock-footer">
        <button type="button" className="adblock-settings-link" onClick={onOpenSettings}>Ad blocking settings…</button>
        <button type="button" className="adblock-close" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
