import { describeLoadError, type BrowserLoadError } from '../../../shared/navigation-errors'
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

/** In-page error for a main-frame load that left an empty error page. Matches the tab interstitials. */
export function LoadErrorPage({ loadError, canGoBack }: { loadError: BrowserLoadError; canGoBack: boolean }): React.JSX.Element {
  const copy = describeLoadError(loadError)
  return (
    <section className="tab-interstitial is-load-error" role="alert" aria-label={copy.title}>
      <div className="tab-interstitial-card">
        <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /><path d="m17 17 4 4" /></svg>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        {copy.codeLabel && <code>{copy.codeLabel}</code>}
        <div className="tab-interstitial-actions">
          {canGoBack && <button className="settings-action secondary" type="button" onClick={() => void window.api.browser.back()}>Go back</button>}
          <button className="settings-action primary" type="button" onClick={() => void window.api.browser.navigate(loadError.url).catch(() => undefined)}>Retry</button>
        </div>
      </div>
    </section>
  )
}
