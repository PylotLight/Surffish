import { useState } from 'react'
import type { BrowserTabInterstitial } from '../../../shared/types'
import './Safety.css'

function run(action: 'reload' | 'wait' | 'kill' | 'continue-http' | 'back'): void {
  void window.api.browser.safety.tabRecovery(action).catch(() => undefined)
}

/** Full-page notice drawn over the active tab: crashed, not responding, or HTTPS unavailable. */
export function TabInterstitial({ interstitial, canGoBack }: { interstitial: BrowserTabInterstitial; canGoBack: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  if (interstitial.kind === 'crashed') {
    return (
      <section className="tab-interstitial is-crash" role="alert" aria-label="Page crashed">
        <div className="tab-interstitial-card">
          <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5" /><path d="M12 17.5h.01" /></svg>
          <h1>This page crashed</h1>
          <p>It stopped because {interstitial.label}.{interstitial.repeated ? ' It kept crashing when it reloaded, so Surffish stopped retrying on its own.' : ''}</p>
          <code>{interstitial.reason}</code>
          <div className="tab-interstitial-actions">
            <button className="settings-action primary" type="button" disabled={busy} onClick={() => { setBusy(true); run('reload') }}>Reload</button>
          </div>
        </div>
      </section>
    )
  }
  if (interstitial.kind === 'unresponsive') {
    return (
      <section className="tab-interstitial is-hang" role="alertdialog" aria-label="Page not responding">
        <div className="tab-interstitial-card">
          <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <h1>Page not responding</h1>
          <p>This page is busy and isn’t responding. You can wait for it, or stop the page (unsaved changes on it will be lost).</p>
          <div className="tab-interstitial-actions">
            <button className="settings-action secondary" type="button" onClick={() => run('wait')}>Wait</button>
            <button className="settings-action primary" type="button" onClick={() => run('kill')}>Kill page</button>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="tab-interstitial is-https" role="alert" aria-label="Site doesn't support HTTPS">
      <div className="tab-interstitial-card">
        <svg className="tab-interstitial-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6" /><path d="M12 14v2.5" /></svg>
        <h1>{interstitial.host} doesn’t support HTTPS</h1>
        <p>{interstitial.source === 'typed' ? 'Surffish tried a secure connection first and it failed.' : 'HTTPS-only mode tried a secure connection and it failed.'} If you continue, the page loads over plain HTTP: anyone on the network path can read or change it.{interstitial.remember !== false ? ` Surffish will remember this exception for ${interstitial.host}.` : ''}</p>
        <code>{interstitial.error}</code>
        <div className="tab-interstitial-actions">
          {canGoBack && <button className="settings-action secondary" type="button" onClick={() => run('back')}>Go back</button>}
          <button className="settings-action primary" type="button" onClick={() => run('continue-http')}>Continue to HTTP</button>
        </div>
      </div>
    </section>
  )
}
