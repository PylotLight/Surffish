import { useEffect, useMemo, useState } from 'react'
import { CLEAR_RANGES, DEFAULT_CLEAR_OPTIONS, type ClearBrowsingDataOptions, type CookieSiteSummary } from '../../../../shared/browsing-data'
import { SettingsGroup, SettingsRow } from './SettingsControls'
import { formatTabVolume } from '../../../../shared/tab-volume'
import '../Safety.css'

type HttpsOnlyState = Awaited<ReturnType<typeof window.api.browser.safety.httpsOnly.get>>

const CLEAR_ITEMS: ReadonlyArray<{ key: keyof Omit<ClearBrowsingDataOptions, 'range'>; label: string; hint: string }> = [
  { key: 'history', label: 'Browsing history', hint: 'Visited pages and address bar suggestions' },
  { key: 'downloads', label: 'Download list', hint: 'Entries only; files stay on disk' },
  { key: 'cookies', label: 'Cookies and site data', hint: 'Signs you out of most sites' },
  { key: 'cache', label: 'Cached images and files', hint: 'Pages may load slower next time' },
  { key: 'permissions', label: 'Site permissions', hint: 'Camera, location, notifications, per-site settings' },
  { key: 'zoom', label: 'Zoom and volume levels', hint: 'Saved per-site page zoom and tab volume' }
]

function ClearBrowsingData(): React.JSX.Element {
  const [options, setOptions] = useState<ClearBrowsingDataOptions>(DEFAULT_CLEAR_OPTIONS)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const nothing = CLEAR_ITEMS.every((item) => !options[item.key])

  async function clear(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.api.browser.safety.privacy.clear(options)
      const scope = result.scopedOrigins === null ? '' : result.scopedOrigins === 0 ? ' No sites were visited in that period, so no site data needed clearing.' : ` Site data was cleared for the ${result.scopedOrigins} site${result.scopedOrigins === 1 ? '' : 's'} you visited in that period.`
      setMessage({ text: `Cleared.${scope}`, error: false })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not clear browsing data.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup title="Clear browsing data">
      <SettingsRow label="Time range" hint="Shortcut: ⌘/Ctrl+Shift+Backspace. Private tabs are never affected; they clear themselves.">
        <select className="settings-select" value={options.range} onChange={(event) => setOptions((current) => ({ ...current, range: event.target.value as ClearBrowsingDataOptions['range'] }))} aria-label="Time range to clear">
          {CLEAR_RANGES.map((range) => <option key={range.id} value={range.id}>{range.label}</option>)}
        </select>
      </SettingsRow>
      <div className="privacy-checks">
        {CLEAR_ITEMS.map((item) => (
          <label className="privacy-check" key={item.key}>
            <input type="checkbox" checked={options[item.key]} onChange={(event) => setOptions((current) => ({ ...current, [item.key]: event.target.checked }))} />
            <span>{item.label}<small>{item.hint}</small></span>
          </label>
        ))}
      </div>
      {options.range !== 'all' && <p className="settings-help">For a time range, cookies, site data, cache, permissions, zoom and volume levels are cleared for the sites you visited in that period.</p>}
      <div className="settings-actions">
        <button className="settings-action primary" type="button" disabled={busy || nothing} onClick={() => void clear()}>{busy ? 'Clearing…' : 'Clear data'}</button>
      </div>
      {message && <p className={`settings-message${message.error ? ' is-error' : ''}`} role="status">{message.text}</p>}
    </SettingsGroup>
  )
}

function HttpsOnlySettings(): React.JSX.Element {
  const [state, setState] = useState<HttpsOnlyState | null>(null)
  useEffect(() => {
    void window.api.browser.safety.httpsOnly.get().then(setState).catch(() => undefined)
  }, [])
  return (
    <SettingsGroup title="HTTPS-only mode" status={state ? (state.enabled ? 'On' : 'Off') : undefined} statusOn={state?.enabled}
      aside={<input type="checkbox" className="settings-switch" disabled={!state} checked={state?.enabled ?? false} onChange={(event) => void window.api.browser.safety.httpsOnly.set(event.target.checked).then(setState)} aria-label="HTTPS-only mode" />}>
      <p className="settings-help">{state?.enabled
        ? 'Every http:// address is upgraded to https://. If a site has no working HTTPS you’ll be asked before it loads over HTTP. Local network addresses are never upgraded.'
        : 'Recommended: turn this on to upgrade http:// addresses to https:// and get a warning before any page loads insecurely. Local network addresses are never upgraded.'}</p>
      {state && state.exceptions.length > 0 && (
        <ul className="privacy-cookie-list" aria-label="Sites allowed over HTTP">
          {state.exceptions.map((host) => (
            <li key={host}>
              <span className="privacy-cookie-site">{host}<small>Allowed over HTTP</small></span>
              <button className="privacy-icon-button" type="button" title="Remove exception" aria-label={`Remove HTTP exception for ${host}`} onClick={() => void window.api.browser.safety.httpsOnly.removeException(host).then(setState)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  )
}

function SiteVolumes(): React.JSX.Element {
  const [sites, setSites] = useState<Array<{ origin: string; volume: number }> | null>(null)
  useEffect(() => {
    void window.api.browser.siteVolume.list().then(setSites).catch(() => setSites([]))
  }, [])
  const reset = (origin: string | null): void => { void window.api.browser.siteVolume.reset(origin).then(setSites).catch(() => undefined) }
  // Newest change first.
  const shown = [...(sites ?? [])].reverse()
  return (
    <SettingsGroup title="Tab volume" status={sites ? `${sites.length} site${sites.length === 1 ? '' : 's'}` : undefined}>
      <p className="settings-help">Volume set on a tab’s speaker is remembered for its site. Private tabs never save theirs.</p>
      {sites === null ? <p className="settings-help">Loading…</p> : shown.length === 0 ? <p className="settings-help">No sites have a saved volume.</p> : (
        <ul className="privacy-cookie-list" aria-label="Sites with a saved volume">
          {shown.map((site) => (
            <li key={site.origin}>
              <span className="privacy-cookie-site">{hostOf(site.origin)}<small>{formatTabVolume(site.volume)}</small></span>
              <button className="privacy-icon-button" type="button" title="Reset to 100%" aria-label={`Reset volume for ${hostOf(site.origin)}`} onClick={() => reset(site.origin)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && <div className="settings-actions"><button className="settings-action secondary" type="button" onClick={() => reset(null)}>Reset all to 100%</button></div>}
    </SettingsGroup>
  )
}

function hostOf(origin: string): string {
  try { return new URL(origin).host } catch { return origin }
}

function CookieSites(): React.JSX.Element {
  const [sites, setSites] = useState<CookieSiteSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [busySite, setBusySite] = useState<string | null>(null)
  useEffect(() => {
    void window.api.browser.safety.privacy.cookieSites().then(setSites).catch(() => setSites([]))
  }, [])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (sites ?? []).filter((site) => !needle || site.site.includes(needle) || site.hosts.some((host) => host.includes(needle)))
  }, [sites, query])
  const total = (sites ?? []).reduce((sum, site) => sum + site.cookies, 0)

  async function remove(site: string): Promise<void> {
    setBusySite(site)
    try {
      setSites(await window.api.browser.safety.privacy.deleteCookieSite(site))
    } finally {
      setBusySite(null)
    }
  }

  return (
    <SettingsGroup title="Sites with cookies" status={sites ? `${sites.length} sites · ${total} cookies` : undefined}>
      <input className="privacy-search" type="search" placeholder="Search sites" value={query} spellCheck={false} onChange={(event) => setQuery(event.target.value)} aria-label="Search sites with cookies" />
      {sites === null ? <p className="settings-help">Loading…</p> : filtered.length === 0 ? <p className="settings-help">{sites.length === 0 ? 'No cookies stored.' : 'No matching sites.'}</p> : (
        <ul className="privacy-cookie-list">
          {filtered.map((site) => (
            <li key={site.site}>
              <span className="privacy-cookie-site">{site.site}<small>{site.cookies} cookie{site.cookies === 1 ? '' : 's'} · {site.hosts.join(', ')}</small></span>
              <button className="privacy-icon-button" type="button" disabled={busySite === site.site} title="Delete cookies and site data" aria-label={`Delete cookies and site data for ${site.site}`} onClick={() => void remove(site.site)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsGroup>
  )
}

/** Settings → Privacy. */
export function PrivacySettings(): React.JSX.Element {
  return (
    <div className="settings-view settings-view-privacy">
      <header className="settings-page-header">
        <div className="settings-page-heading-copy">
          <h1>Privacy</h1>
          <p>Clear browsing data, HTTPS-only mode, saved tab volumes and stored cookies.</p>
        </div>
      </header>
      <div className="settings-content">
        <ClearBrowsingData />
        <HttpsOnlySettings />
        <SiteVolumes />
        <CookieSites />
      </div>
    </div>
  )
}
