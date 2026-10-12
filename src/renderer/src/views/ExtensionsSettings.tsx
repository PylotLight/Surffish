import { useState } from 'react'
import type { WebStoreExtensionsState, WebStoreExtensionSummary } from '../../../shared/types'
import { parseChromeWebStoreInput } from '../../../shared/chrome-web-store'
import { runExtensionAction } from './useWebStoreExtensions'

interface Props {
  state: WebStoreExtensionsState
  setState: (state: WebStoreExtensionsState) => void
}

const LEVEL_LABEL: Record<WebStoreExtensionSummary['compatibility'], string> = {
  supported: 'Supported',
  partial: 'Partial',
  unsupported: 'Unsupported'
}

/** Settings → Integrations: install from the Chrome Web Store and manage installed extensions. */
export function ExtensionsSettings({ state, setState }: Props): React.JSX.Element {
  const [input, setInput] = useState('')
  const api = window.api.browser.extensions
  const run = (action: () => Promise<WebStoreExtensionsState>): void => { void runExtensionAction(action, setState, state) }
  const validInput = parseChromeWebStoreInput(input) !== null

  return (
    <section className="settings-section extensions-settings-section" aria-label="Chrome Web Store extensions">
      <div className="settings-section-heading">
        <div>
          <strong>Chrome Web Store extensions</strong>
          <span className={`settings-status${state.extensions.length > 0 ? ' is-on' : ''}`}>
            {state.busy ? 'Working…' : state.extensions.length === 0 ? 'None installed' : `${state.extensions.length} installed`}
          </span>
        </div>
      </div>
      <form className="extensions-install-form" onSubmit={(event) => {
        event.preventDefault()
        if (!validInput || state.busy) return
        run(() => api.install(input))
        setInput('')
      }}>
        <input
          type="text"
          value={input}
          spellCheck={false}
          placeholder="chromewebstore.google.com/detail/… or extension ID"
          aria-label="Chrome Web Store link or extension ID"
          onChange={(event) => setInput(event.target.value)}
        />
        <button className="settings-action primary" type="submit" disabled={!validInput || state.busy}>{state.busy && !state.busyId ? 'Installing…' : 'Install'}</button>
      </form>
      <p className="settings-help">Paste a store link, or click <strong>Add to Surffish</strong> on the store page. Partial extensions list what won’t work; Unsupported ones are blocked. Hide or pin extensions from the toolbar’s puzzle menu.</p>
      {state.extensions.map((extension) => (
        <div className="extension-settings-row" key={extension.id}>
          <div className="extension-settings-header">
            {extension.iconDataUrl ? <img className="extension-settings-icon" src={extension.iconDataUrl} alt="" /> : <span className="extension-settings-icon extension-toolbar-fallback" aria-hidden="true">{extension.name.slice(0, 1)}</span>}
            <div className="extension-settings-title">
              <strong>{extension.name}</strong>
              <span className="settings-status">
                {extension.version} · <span className={`extension-compat is-${extension.compatibility}`}>{LEVEL_LABEL[extension.compatibility]}</span>
                {!extension.enabled ? ' · Off' : !extension.loaded ? ' · Not loaded' : ''}
              </span>
            </div>
            <input type="checkbox" className="settings-switch" checked={extension.enabled} disabled={state.busy} aria-label={`${extension.name} on`} onChange={(event) => run(() => api.setEnabled(extension.id, event.target.checked))} />
          </div>
          {extension.description && <p className="settings-help">{extension.description}</p>}
          {extension.gaps.length > 0 && (
            <details className="extension-gaps">
              <summary>{extension.gaps.length} feature{extension.gaps.length === 1 ? '' : 's'} won’t work in Surffish</summary>
              <ul>{extension.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
            </details>
          )}
          {extension.hostPermissions.length > 0 && <p className="settings-help"><strong>Site access:</strong> {extension.hostPermissions.join(', ')}</p>}
          <div className="settings-actions extension-settings-actions">
            {extension.hasOptions && <button className="settings-action secondary" type="button" disabled={!extension.loaded} onClick={() => run(() => api.openOptions(extension.id))}>Options</button>}
            <button className="settings-action secondary" type="button" disabled={state.busy} onClick={() => run(() => api.checkForUpdate(extension.id))}>{state.busyId === extension.id ? 'Checking…' : 'Check for update'}</button>
            <button className="settings-action secondary" type="button" disabled={state.busy} onClick={() => run(() => api.uninstall(extension.id))}>Remove</button>
          </div>
          {extension.error && <p className="settings-message is-error" role="alert">{extension.error}</p>}
        </div>
      ))}
      {state.notice && <p className="settings-message" role="status">{state.notice}</p>}
      {state.error && <p className="settings-message is-error" role="alert">{state.error}</p>}
    </section>
  )
}
