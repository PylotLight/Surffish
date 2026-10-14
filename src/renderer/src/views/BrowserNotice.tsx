import { useEffect, useState } from 'react'
import { describeLoadError, type BrowserLoadError } from '../../../shared/navigation-errors'
import { describeCertificateError, type SiteCertificateInfo } from '../../../shared/certificates'
import { localHttpFallbackUrl } from '../../../shared/https-only'
import { CertificateViewer } from './lazy-views'
import './BrowserNotice.css'
import './Safety.css'

type NoticeTone = 'error' | 'warning'

const ICONS: Record<NoticeTone, React.JSX.Element> = {
  error: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5" /><path d="M12 16.2h.01" /></svg>,
  warning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
}

/** Floating notice under the toolbar: icon, message, optional action, dismiss. */
export function BrowserNotice({ tone, title, detail, code, actionLabel, onAction, onDismiss }: {
  tone: NoticeTone
  title: string
  detail?: string
  code?: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div id="browser-notice" className={`browser-notice is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="browser-notice-icon">{ICONS[tone]}</span>
      <span className="browser-notice-text">
        <strong>{title}</strong>
        {detail && <span className="browser-notice-detail">{detail}</span>}
        {code && <code className="browser-notice-code">{code}</code>}
      </span>
      {actionLabel && onAction && <button className="browser-notice-action" type="button" onClick={onAction}>{actionLabel}</button>}
      <button className="browser-notice-dismiss" type="button" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10" /><path d="M17 7 7 17" /></svg>
      </button>
    </div>
  )
}

/** Toast for a tab's load error (page still on screen, e.g. a failed load over an existing page). */
export function LoadErrorNotice({ loadError, onDismiss }: { loadError: BrowserLoadError; onDismiss: () => void }): React.JSX.Element {
  const copy = describeLoadError(loadError)
  return (
    <BrowserNotice
      tone={copy.kind === 'offline' || copy.kind === 'blocked' ? 'warning' : 'error'}
      title={copy.title}
      detail={copy.detail}
      code={copy.codeLabel}
      actionLabel="Retry"
      onAction={() => void window.api.browser.navigate(loadError.url).catch(() => undefined)}
      onDismiss={onDismiss}
    />
  )
}

function hostOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname : ''
  } catch {
    return ''
  }
}

function retry(url: string): void {
  void window.api.browser.navigate(url).catch(() => undefined)
}

/** A local-network device that failed over https: offer its plain-http address (routers, NAS, printers). */
function httpFallbackLabel(httpUrl: string): string {
  try {
    const url = new URL(httpUrl)
    return `Continue to http://${url.host}`
  } catch {
    return 'Continue to HTTP'
  }
}

function continueToHttp(httpUrl: string): void {
  void window.api.browser.navigate(httpUrl).catch(() => undefined)
}

/** "Back to <page>" when the failed load never replaced the page; else history back. */
function BackAction({ loadError, canGoBack }: { loadError: BrowserLoadError; canGoBack: boolean }): React.JSX.Element | null {
  if (loadError.pageBehind) {
    const host = hostOf(loadError.pageBehind)
    return <button className="settings-action secondary" type="button" onClick={() => void window.api.browser.dismissLoadError().catch(() => undefined)}>{host ? `Back to ${host}` : 'Back to page'}</button>
  }
  return canGoBack ? <button className="settings-action secondary" type="button" onClick={() => void window.api.browser.back()}>Go back</button> : null
}

const GLOBE_ICON = <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /><path d="m17 17 4 4" /></svg>
const TUNNEL_ICON = <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 20V11a9 9 0 0 1 18 0v9" /><path d="M7 20v-8a5 5 0 0 1 10 0v8" /><path d="M3 4l18 16" /></svg>
const BROKEN_LOCK_ICON = <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /><path d="M12 14v2.5" /><path d="M3.5 21 20.5 4" /></svg>

/**
 * In-page error for every failed main-frame load (DNS, refused, proxy, certificate…), drawn over
 * the page area like the tab interstitials. The toolbar toast is only for failures that left a
 * loaded page on screen (see shouldShowFullPageError).
 */
export function LoadErrorPage({ loadError, canGoBack }: { loadError: BrowserLoadError; canGoBack: boolean }): React.JSX.Element {
  const copy = describeLoadError(loadError)
  if (copy.kind === 'certificate') return <CertificateErrorPage loadError={loadError} canGoBack={canGoBack} />
  return <GenericLoadErrorPage loadError={loadError} canGoBack={canGoBack} />
}

function GenericLoadErrorPage({ loadError, canGoBack }: { loadError: BrowserLoadError; canGoBack: boolean }): React.JSX.Element {
  const copy = describeLoadError(loadError)
  const host = hostOf(loadError.url)
  const [routeError, setRouteError] = useState('')
  const [routing, setRouting] = useState(false)
  const offerDirect = copy.kind === 'proxy' && loadError.viaProxy && host !== ''
  const httpFallback = localHttpFallbackUrl(loadError.url, loadError.name)
  return (
    <section className={`tab-interstitial is-load-error is-${copy.kind}`} role="alert" aria-label={copy.title}>
      <div className="tab-interstitial-card">
        {copy.kind === 'proxy' ? TUNNEL_ICON : GLOBE_ICON}
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        {httpFallback && <p className="tab-interstitial-hint">{`${host} is on your local network. Devices like routers, NAS boxes and printers often only serve plain HTTP.`}</p>}
        {copy.codeLabel && <code>{copy.codeLabel}</code>}
        {routeError && <p className="tab-interstitial-error" role="status">{routeError}</p>}
        <div className="tab-interstitial-actions">
          <BackAction loadError={loadError} canGoBack={canGoBack} />
          {offerDirect && <button className="settings-action secondary" type="button" disabled={routing} title={`Add a Direct rule for ${host} (Settings → Network rules) and load it without the proxy`} onClick={() => {
            setRouting(true)
            setRouteError('')
            void window.api.browser.proxy.siteRoute.set(loadError.url, 'direct')
              .then(() => window.api.browser.navigate(loadError.url))
              .catch((error: unknown) => setRouteError(error instanceof Error ? error.message : String(error)))
              .finally(() => setRouting(false))
          }}>Route Direct</button>}
          <button className={`settings-action ${httpFallback ? 'secondary' : 'primary'}`} type="button" onClick={() => retry(loadError.url)}>Retry</button>
          {httpFallback && <button className="settings-action primary http-fallback" type="button" title={`Load ${httpFallback} over plain HTTP (not encrypted)`} onClick={() => continueToHttp(httpFallback)}>{httpFallbackLabel(httpFallback)}</button>}
        </div>
      </div>
    </section>
  )
}

function formatShortDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** Chrome-style certificate interstitial: Advanced → details, view certificate, proceed (unsafe). */
function CertificateErrorPage({ loadError, canGoBack }: { loadError: BrowserLoadError; canGoBack: boolean }): React.JSX.Element {
  const host = hostOf(loadError.url) || 'this site'
  const [advanced, setAdvanced] = useState(false)
  const [info, setInfo] = useState<SiteCertificateInfo | null | 'loading'>(null)
  const [viewer, setViewer] = useState(false)
  const [proceeding, setProceeding] = useState(false)
  const errorName = loadError.name ?? (loadError.code !== null ? `Error ${loadError.code}` : '')
  const httpFallback = localHttpFallbackUrl(loadError.url, loadError.name)
  // A new failure (another host or certificate) closes the details.
  useEffect(() => {
    setAdvanced(false)
    setViewer(false)
    setInfo(null)
  }, [loadError.url, loadError.code])
  const openAdvanced = (): void => {
    const next = !advanced
    setAdvanced(next)
    if (next && info === null) {
      setInfo('loading')
      void window.api.browser.certificate.info().then((value) => setInfo(value)).catch(() => setInfo(null))
    }
  }
  const details = info && info !== 'loading' ? info : null
  const leaf = details?.chain[0] ?? null
  return (
    <section className={`tab-interstitial is-load-error is-certificate${viewer ? ' is-expanded' : ''}`} role="alert" aria-label="Your connection isn’t private">
      <div className="tab-interstitial-card">
        {BROKEN_LOCK_ICON}
        <h1>Your connection isn’t private</h1>
        <p>{`Surffish didn’t open ${host} because its security certificate isn’t trusted. Someone could be impersonating the site, or it’s a device on your network (a router, NAS or printer) with a self-signed certificate.`}</p>
        {errorName && <code>{errorName}</code>}
        <div className="tab-interstitial-actions">
          <BackAction loadError={loadError} canGoBack={canGoBack} />
          <button className="settings-action secondary cert-advanced-toggle" type="button" aria-expanded={advanced} onClick={openAdvanced}>{advanced ? 'Hide advanced' : 'Advanced'}</button>
          <button className="settings-action primary" type="button" onClick={() => retry(loadError.url)}>Retry</button>
        </div>
        {advanced && (
          <div className="cert-advanced">
            <p>{describeCertificateError(loadError.name)}</p>
            {info === 'loading' && <p className="cert-advanced-muted">Loading certificate…</p>}
            {leaf && (
              <dl className="cert-advanced-facts">
                <div><dt>Host</dt><dd>{details?.host || host}</dd></div>
                <div><dt>Issued to</dt><dd>{leaf.subject.commonName ?? leaf.subjectText}</dd></div>
                <div><dt>Issued by</dt><dd>{leaf.issuer.commonName ?? leaf.issuer.organization ?? leaf.issuerText}{leaf.selfSigned ? ' (self-signed)' : ''}</dd></div>
                <div><dt>Valid</dt><dd>{`${formatShortDate(leaf.validFrom)} – ${formatShortDate(leaf.validTo)}`}</dd></div>
                <div><dt>SHA-256</dt><dd className="is-mono">{leaf.fingerprintSha256}</dd></div>
              </dl>
            )}
            {(details || httpFallback) && (
              <div className="cert-advanced-links">
                {details && <button type="button" className="cert-link" onClick={() => setViewer((open) => !open)}>{viewer ? 'Hide certificate' : 'View certificate'}</button>}
                {httpFallback && <button type="button" className="cert-link http-fallback" title={`Load ${httpFallback} over plain HTTP (not encrypted)`} onClick={() => continueToHttp(httpFallback)}>{httpFallbackLabel(httpFallback)}</button>}
              </div>
            )}
            {viewer && details && <div className="cert-advanced-viewer"><CertificateViewer info={details} /></div>}
            {details?.canProceed && (
              <>
                <button type="button" className="cert-link is-danger cert-proceed" disabled={proceeding} onClick={() => {
                  setProceeding(true)
                  void window.api.browser.certificate.proceed().catch(() => false).finally(() => setProceeding(false))
                }}>{`Proceed to ${host} (unsafe)`}</button>
                <p className="cert-advanced-muted">Surffish allows only this certificate for {host}, until you quit (private tabs: until you close them). The address bar shows “Not secure” while you’re there.</p>
              </>
            )}
            {info === null && <p className="cert-advanced-muted">The certificate wasn’t captured. Retry, then open Advanced again.</p>}
          </div>
        )}
      </div>
    </section>
  )
}
