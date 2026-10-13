import { useEffect, useState } from 'react'
import type { ProxyGuardStatus } from '../../../shared/proxy-guard'
import './Safety.css'

/** Toolbar banner while the proxy kill switch is blocking traffic. */
export function ProxyDownBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<ProxyGuardStatus | null>(null)
  useEffect(() => {
    let mounted = true
    void window.api.browser.safety.proxyGuard.get().then((next) => { if (mounted) setStatus(next) }).catch(() => undefined)
    const unsubscribe = window.api.browser.safety.proxyGuard.onChange(setStatus)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])
  if (!status?.blocking) return null
  return (
    <div className="proxy-down-banner" role="alert">
      <span><strong>Proxy down – traffic blocked.</strong> {status.endpoint ? `Can’t reach ${status.endpoint}. ` : ''}Pages stay offline until the proxy is back (kill switch).</span>
      <button type="button" onClick={() => void window.api.browser.safety.proxyGuard.check().then(setStatus)}>Retry</button>
    </div>
  )
}
