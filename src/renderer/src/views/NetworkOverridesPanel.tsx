import { useEffect, useRef, useState } from 'react'
import { formatHeaderLines, parseHeaderLines, type NetworkOverrideRule, type NetworkOverridesState } from '../../../shared/network-overrides'
import './NetworkTools.css'

const METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']

interface DraftRule extends Omit<NetworkOverrideRule, 'headers' | 'status'> {
  headersText: string
  status: string
}

function toDraft(rule: NetworkOverrideRule): DraftRule {
  const { headers, status, ...rest } = rule
  return { ...rest, status: String(status || 200), headersText: formatHeaderLines(headers) }
}

function fromDraft(draft: DraftRule): NetworkOverrideRule {
  const { headersText, status, ...rest } = draft
  return { ...rest, status: Number(status), headers: parseHeaderLines(headersText) }
}

export function newOverrideId(): string {
  return `ov${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

/** Subscribe to the overrides state (rules, whether interception is live, hit counts). */
export function useNetworkOverrides(enabled = true): NetworkOverridesState | null {
  const [state, setState] = useState<NetworkOverridesState | null>(null)
  useEffect(() => {
    if (!enabled) {
      setState(null)
      return
    }
    let mounted = true
    void window.api.browser.network.overrides.get().then((next) => { if (mounted) setState(next) }).catch(() => undefined)
    const unsubscribe = window.api.browser.network.overrides.onChange(setState)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [enabled])
  return state
}

interface NetworkOverridesPanelProps {
  state: NetworkOverridesState | null
  /** A rule to add (from "Mock this request"); the panel adds it to its drafts once. */
  seed: NetworkOverrideRule | null
  onSeedConsumed: () => void
}

/** Mock / override rules: respond with a fixed status, headers and body, or block. Session only. */
export function NetworkOverridesPanel({ state, seed, onSeedConsumed }: NetworkOverridesPanelProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<DraftRule[]>([])
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  useEffect(() => {
    if (state && !dirtyRef.current) setDrafts(state.rules.map(toDraft))
  }, [state])

  useEffect(() => {
    if (!seed) return
    setDrafts((current) => [...current, toDraft(seed)])
    setDirty(true)
    setMessage({ text: 'Edit the new override, then Apply.', error: false })
    onSeedConsumed()
  }, [seed, onSeedConsumed])

  const update = (id: string, patch: Partial<DraftRule>): void => {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft))
    setDirty(true)
    setMessage(null)
  }

  async function apply(next: DraftRule[] = drafts): Promise<void> {
    try {
      const saved = await window.api.browser.network.overrides.set(next.map(fromDraft))
      setDrafts(saved.rules.map(toDraft))
      setDirty(false)
      const on = saved.rules.filter((rule) => rule.enabled).length
      setMessage({ text: on ? `${on} override${on === 1 ? '' : 's'} on. Matching requests from inspected tabs are answered here.` : 'Overrides are off; requests go to the network.', error: false })
    } catch (error) {
      setMessage({ text: (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), error: true })
    }
  }

  return (
    <section className="network-overrides" aria-label="Request overrides">
      <div className="network-overrides-heading">
        <div>
          <strong>Overrides</strong>
          <span>Match a URL (substring, <code>*</code> = anything) and method, then answer with a fixed response or block it. Applies to every tab the inspector records, for this session only.</span>
        </div>
        <div className="network-overrides-actions">
          <button className="settings-action secondary network-clear" type="button" onClick={() => {
            setDrafts((current) => [...current, toDraft({ id: newOverrideId(), enabled: true, urlPattern: '', method: '*', action: 'respond', status: 200, headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{}' })])
            setDirty(true)
          }}>+ Add</button>
          <button className="settings-action secondary network-clear" type="button" disabled={drafts.length === 0} onClick={() => void apply([])}>Remove all</button>
          <button className="settings-action primary network-clear" type="button" disabled={!dirty} onClick={() => void apply()}>Apply</button>
        </div>
      </div>
      {drafts.length === 0 && <p className="network-empty-detail">No overrides. Add one, or pick a request and choose “Mock”.</p>}
      <div className="network-overrides-list">
        {drafts.map((draft, index) => (
          <div className={`network-override${draft.enabled ? '' : ' is-off'}`} key={draft.id}>
            <div className="network-override-row">
              <input type="checkbox" checked={draft.enabled} aria-label={`Override ${index + 1} on`} onChange={(event) => update(draft.id, { enabled: event.target.checked })} />
              <select className="network-control network-override-method" value={draft.method} aria-label={`Override ${index + 1} method`} onChange={(event) => update(draft.id, { method: event.target.value })}>
                {(METHODS.includes(draft.method) ? METHODS : [...METHODS, draft.method]).map((method) => <option key={method} value={method}>{method === '*' ? 'Any' : method}</option>)}
              </select>
              <input className="network-override-pattern" type="text" value={draft.urlPattern} spellCheck={false} placeholder="api.example.com/v1/*" aria-label={`Override ${index + 1} URL pattern`} onChange={(event) => update(draft.id, { urlPattern: event.target.value })} />
              <select className="network-control" value={draft.action} aria-label={`Override ${index + 1} action`} onChange={(event) => update(draft.id, { action: event.target.value as DraftRule['action'] })}>
                <option value="respond">Respond</option>
                <option value="block">Block</option>
              </select>
              {draft.action === 'respond' && <input className="network-override-status" type="number" min={100} max={599} value={draft.status} aria-label={`Override ${index + 1} status`} onChange={(event) => update(draft.id, { status: event.target.value })} />}
              <span className="network-override-hits" title="Requests answered this session">{state?.hits[draft.id] ?? 0} hits</span>
              <button className="network-override-remove" type="button" aria-label={`Remove override ${index + 1}`} title="Remove" onClick={() => { setDrafts((current) => current.filter((item) => item.id !== draft.id)); setDirty(true) }}>×</button>
            </div>
            {draft.action === 'respond' && (
              <div className="network-override-response">
                <textarea value={draft.headersText} spellCheck={false} rows={3} placeholder={'Content-Type: application/json\nCache-Control: no-store'} aria-label={`Override ${index + 1} response headers`} onChange={(event) => update(draft.id, { headersText: event.target.value })} />
                <textarea value={draft.body} spellCheck={false} rows={3} placeholder="Response body" aria-label={`Override ${index + 1} response body`} onChange={(event) => update(draft.id, { body: event.target.value })} />
              </div>
            )}
          </div>
        ))}
      </div>
      {message && <p className={message.error ? 'network-error-detail' : 'network-body-note'} role="status">{message.text}</p>}
    </section>
  )
}

/** Toolbar badge while any override is intercepting requests. */
export function NetworkOverridesBadge({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }): React.JSX.Element | null {
  const state = useNetworkOverrides(enabled)
  if (!enabled || !state?.active) return null
  const on = state.rules.filter((rule) => rule.enabled).length
  return (
    <button className="network-overrides-badge" type="button" title={`${on} network override${on === 1 ? '' : 's'} active: matching requests get a fixed response or are blocked. Open Network.`} aria-label={`Overrides active (${on}). Open the Network inspector`} onClick={onOpen}>
      <span aria-hidden="true" className="network-overrides-badge-dot" />
      Overrides active
    </button>
  )
}
