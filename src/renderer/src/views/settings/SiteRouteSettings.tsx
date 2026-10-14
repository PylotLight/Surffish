import { useEffect, useState } from 'react'
import { routeLabel, type ProxyRoute, type ProxyRoutingState, type SiteRouteState } from '../../../../shared/proxy-routing'
import './NetworkRules.css'

/** Site panel: the effective route for the current page and the "Route this site" quick toggle. */
export function SiteRouteSettings({ url }: { url: string }): React.JSX.Element | null {
  const [state, setState] = useState<SiteRouteState | null>(null)
  const [routing, setRouting] = useState<ProxyRoutingState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      void window.api.browser.proxy.siteRoute.get(url).then((next) => { if (mounted) setState(next) }).catch(() => { if (mounted) setState(null) })
    }
    refresh()
    void window.api.browser.proxy.routing.get().then((next) => { if (mounted) setRouting(next) }).catch(() => undefined)
    const unsubscribe = window.api.browser.proxy.routing.onChange((next) => {
      if (!mounted) return
      setRouting(next)
      refresh()
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [url])

  if (!state) return null
  const choices: Array<{ value: ProxyRoute | 'default'; label: string }> = [
    { value: 'default', label: 'Default' },
    { value: 'direct', label: 'Direct' },
    { value: 'proxy', label: routing?.proxies.length ? 'Main proxy' : 'Proxy' },
    ...(routing?.proxies ?? []).map((proxy) => ({ value: `proxy:${proxy.name}` as ProxyRoute, label: `Proxy ${proxy.name}` }))
  ]
  const via = state.effective.source === 'rule' ? `rule ${state.effective.pattern}` : state.effective.source === 'local' ? 'local address' : state.effective.source === 'lan' ? 'local network' : routing?.primary.enabled ? 'default: SOCKS5 proxy on' : 'default: SOCKS5 proxy off'

  async function choose(choice: ProxyRoute | 'default'): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const next = await window.api.browser.proxy.siteRoute.set(url, choice)
      setState(next)
    } catch (caught) {
      setError((caught instanceof Error ? caught.message : String(caught)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section site-route-section">
      <div className="settings-section-heading"><div><strong>Connection</strong><span className={`settings-status${state.effective.kind === 'proxy' ? ' is-on' : ''}`}>{state.effective.kind === 'proxy' ? 'Proxied' : 'Direct'}</span></div></div>
      <p className="site-route-effective" aria-live="polite">
        <span>This page connects</span>
        <strong className={state.effective.kind === 'proxy' ? 'is-proxy' : 'is-direct'}>{routeLabel(state.effective)}</strong>
        <span>via {via}</span>
      </p>
      <div className="site-route-control">
        <span>Route this site</span>
        <div className="settings-segmented" role="radiogroup" aria-label={`Route ${state.pattern}`}>
          {choices.map((choice) => (
            <button key={choice.value} type="button" role="radio" aria-checked={state.choice === choice.value} className={state.choice === choice.value ? 'is-selected' : ''} disabled={busy} onClick={() => void choose(choice.value)}>{choice.label}</button>
          ))}
        </div>
        <small>Applies to <code>{state.pattern}</code>. Default follows the SOCKS5 proxy switch; edit every rule in Settings → General → Network rules. Reload the page to use a new route.</small>
        {state.overriddenBy && <small>A more specific rule (<code>{state.overriddenBy}</code>) decides this page’s route.</small>}
        {error && <p className="settings-message is-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
