import { Fragment, useEffect, useState } from 'react'
import type { BrowserTabSummary, NetworkRequestDetails, NetworkRequestSummary, NetworkResponseBody } from '../../../shared/types'
import { formatVisitedAt } from '../lib/format'
import { useStoredState } from '../lib/stored-state'

/** The Network inspector is a debug tool: off by default, opt in from Settings → General → Developer. */
export function useNetworkToolEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useStoredState('surffish.devtools.networkInspectorEnabled', false)
  return [enabled, (next) => {
    setEnabled(next)
    if (!next) void window.api.browser.network.disable()
  }]
}

type NetworkDetailsTab = 'headers' | 'payload' | 'response' | 'timing'

function formatNetworkTime(durationMs: number | null): string {
  if (durationMs === null) return '—'
  if (durationMs < 1) return '<1 ms'
  return `${Math.round(durationMs)} ms`
}

function formatNetworkSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function networkRequestName(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function networkStatusLabel(request: NetworkRequestSummary): string {
  if (request.state === 'pending') return 'Pending'
  if (request.status !== null) return `${request.status}${request.statusText ? ` ${request.statusText}` : ''}`
  return request.state === 'failed' ? 'Failed' : '—'
}

function networkTimingLabel(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replace(/^./, (first) => first.toUpperCase())
}

function networkTimingValue(value: number): string {
  return value < 0 ? '—' : `${value.toFixed(2)} ms`
}

function responseBodyText(body: NetworkResponseBody): string {
  if (!body.base64Encoded) return body.text
  try {
    const binary = atob(body.text)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return body.text
  }
}


interface NetworkViewProps {
  tabs: BrowserTabSummary[]
  /** Only the content surface streams rows; other surfaces never mount this view's subscription. */
  live: boolean
}

/** Settings → Network: live request list + detail pane. Opt-in debug tool (Settings → General → Developer). */
export default function NetworkView({ tabs, live }: NetworkViewProps): React.JSX.Element {
  const [networkRequests, setNetworkRequests] = useState<NetworkRequestSummary[]>([])
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(null)
  const [networkDetails, setNetworkDetails] = useState<NetworkRequestDetails | null>(null)
  const [networkDetailsTab, setNetworkDetailsTab] = useState<NetworkDetailsTab>('headers')
  const [networkQuery, setNetworkQuery] = useState('')
  const [networkTypeFilter, setNetworkTypeFilter] = useState('all')
  const [networkScope, setNetworkScope] = useState<'all' | 'active'>('all')
  const [networkResponseBody, setNetworkResponseBody] = useState<NetworkResponseBody | null>(null)
  const [networkResponseError, setNetworkResponseError] = useState('')
  const [networkBodyLoading, setNetworkBodyLoading] = useState(false)

  useEffect(() => {
    // Network rows are only streamed while someone is looking at them; capture itself starts on first open.
    if (!live) return
    const unsubscribeNetwork = window.api.browser.network.onChange(setNetworkRequests)
    void window.api.browser.network.watch(true).then(setNetworkRequests)
    return () => {
      unsubscribeNetwork()
      void window.api.browser.network.watch(false)
    }
  }, [live])

  const selectedNetworkSummary = networkRequests.find((request) => request.id === selectedNetworkId) ?? null

  useEffect(() => {
    if (!selectedNetworkId) {
      setNetworkDetails(null)
      return
    }
    let cancelled = false
    void window.api.browser.network.details(selectedNetworkId).then((details) => {
      if (!cancelled) setNetworkDetails(details)
    }).catch(() => {
      if (!cancelled) setNetworkDetails(null)
    })
    return () => { cancelled = true }
  }, [selectedNetworkId, selectedNetworkSummary?.state, selectedNetworkSummary?.status])

  useEffect(() => {
    if (networkDetailsTab !== 'response' || !selectedNetworkId) {
      setNetworkBodyLoading(false)
      return
    }
    if (!selectedNetworkSummary?.responseBodyAvailable) {
      setNetworkBodyLoading(false)
      setNetworkResponseBody(null)
      setNetworkResponseError(selectedNetworkSummary?.state === 'pending' ? 'The response is not available until this request completes.' : 'No response body is available for this request.')
      return
    }
    let cancelled = false
    setNetworkBodyLoading(true)
    setNetworkResponseError('')
    void window.api.browser.network.responseBody(selectedNetworkId).then((result) => {
      if (cancelled) return
      setNetworkResponseBody(result.body)
      setNetworkResponseError(result.error ?? '')
    }).catch((error: unknown) => {
      if (!cancelled) setNetworkResponseError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!cancelled) setNetworkBodyLoading(false)
    })
    return () => { cancelled = true }
  }, [networkDetailsTab, selectedNetworkId, selectedNetworkSummary?.responseBodyAvailable, selectedNetworkSummary?.state])

  return (
    <div className="network-view">
      <header className="network-page-header">
        <div>
          <h1>Network</h1>
          <p>Live Chromium network events captured by this browser. Request details stay in memory only.</p>
        </div>
        <div className="network-toolbar-actions">
          <label className="network-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={networkQuery} onChange={(event) => setNetworkQuery(event.target.value)} placeholder="Filter requests" aria-label="Filter network requests" />
          </label>
          <select className="network-control" value={networkScope} onChange={(event) => setNetworkScope(event.target.value as 'all' | 'active')} aria-label="Request tab scope">
            <option value="all">All tabs</option>
            <option value="active">Active tab</option>
          </select>
          <select className="network-control" value={networkTypeFilter} onChange={(event) => setNetworkTypeFilter(event.target.value)} aria-label="Request type filter">
            <option value="all">All types</option>
            {[...new Set(networkRequests.map((request) => request.resourceType))].sort().map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <button className="settings-action secondary network-clear" type="button" disabled={networkRequests.length === 0} onClick={() => {
            void window.api.browser.network.clear()
            setSelectedNetworkId(null)
            setNetworkDetails(null)
            setNetworkResponseBody(null)
          }}>Clear</button>
        </div>
      </header>
      <div className="network-summary" aria-live="polite">
        <span>{networkRequests.length.toLocaleString()} retained</span>
        <span>{networkRequests.filter((request) => request.state === 'pending').length.toLocaleString()} pending</span>
        <span>Latest 1,000 retained · oldest roll off</span>
        {networkRequests.length === 0 && <span>Navigate in a loaded tab to capture requests.</span>}
      </div>
      <div className="network-workspace">
        <div className="network-request-table-wrap">
          <table className="network-request-table">
            <thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Initiator</th><th>Size</th><th>Time</th></tr></thead>
            <tbody>
              {networkRequests.filter((request) => {
                const query = networkQuery.trim().toLowerCase()
                const activeId = tabs.find((tab) => tab.active)?.id
                return (networkScope === 'all' || request.tabId === activeId) &&
                  (networkTypeFilter === 'all' || request.resourceType === networkTypeFilter) &&
                  (!query || `${request.url} ${request.method} ${request.status ?? ''} ${request.resourceType} ${request.initiator} ${request.errorText}`.toLowerCase().includes(query))
              }).map((request) => (
                <tr key={request.id} className={`${request.state === 'failed' ? 'is-failed' : ''}${request.id === selectedNetworkId ? ' is-selected' : ''}`} onClick={() => {
                  setSelectedNetworkId(request.id)
                  setNetworkDetailsTab('headers')
                  setNetworkResponseBody(null)
                  setNetworkResponseError('')
                  setNetworkBodyLoading(false)
                }} title={request.url} aria-selected={request.id === selectedNetworkId} tabIndex={0} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedNetworkId(request.id)
                    setNetworkDetailsTab('headers')
                    setNetworkResponseBody(null)
                    setNetworkResponseError('')
                    setNetworkBodyLoading(false)
                  }
                }}>
                  <td><span className="network-method">{request.method}</span><span className="network-name">{networkRequestName(request.url)}</span><span className="network-tab-label">{tabs.find((tab) => tab.id === request.tabId)?.title ?? 'Closed tab'}</span></td>
                  <td><span className={`network-status network-status-${request.state}`}>{networkStatusLabel(request)}</span></td>
                  <td>{request.resourceType}</td>
                  <td title={request.initiator}>{request.initiator || '—'}</td>
                  <td>{formatNetworkSize(request.transferSize)}</td>
                  <td>{formatNetworkTime(request.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section className="network-request-details" aria-label="Selected request details">
          {selectedNetworkSummary ? (
            <>
              <div className="network-detail-title"><strong>{networkRequestName(selectedNetworkSummary.url)}</strong><span>{selectedNetworkSummary.method} · {networkStatusLabel(selectedNetworkSummary)}</span></div>
              <nav className="network-detail-tabs" aria-label="Request detail sections">
                {(['headers', 'payload', 'response', 'timing'] as const).map((tab) => <button key={tab} type="button" className={networkDetailsTab === tab ? 'is-current' : ''} aria-current={networkDetailsTab === tab ? 'page' : undefined} onClick={() => setNetworkDetailsTab(tab)}>{tab[0]?.toUpperCase()}{tab.slice(1)}</button>)}
              </nav>
              <div className="network-detail-content">
                {networkDetailsTab === 'headers' && (networkDetails ? (
                  <>
                    <div className="network-detail-section"><strong>General</strong>
                      <dl>
                        <dt>Request URL</dt><dd className="network-url-value">{networkDetails.url}</dd>
                        <dt>Request Method</dt><dd>{networkDetails.method}</dd>
                        <dt>Status Code</dt><dd>{networkStatusLabel(networkDetails)}</dd>
                        <dt>Remote Address</dt><dd>{networkDetails.remoteAddress || '—'}</dd>
                        <dt>Protocol / Security</dt><dd>{networkDetails.protocol || '—'}{networkDetails.securityState ? ` · ${networkDetails.securityState}` : ''}</dd>
                      </dl>
                    </div>
                    {networkDetails.responseHeaders.length > 0 && <div className="network-detail-section"><strong>Response Headers</strong><dl>{networkDetails.responseHeaders.map((header, index) => <Fragment key={`response-${header.name}-${index}`}><dt>{header.name}</dt><dd>{header.value || '(empty)'}</dd></Fragment>)}</dl></div>}
                    {networkDetails.requestHeaders.length > 0 && <div className="network-detail-section"><strong>Request Headers</strong><dl>{networkDetails.requestHeaders.map((header, index) => <Fragment key={`request-${header.name}-${index}`}><dt>{header.name}</dt><dd>{header.value || '(empty)'}</dd></Fragment>)}</dl></div>}
                    {networkDetails.errorText && <p className="network-error-detail">{networkDetails.errorText}</p>}
                  </>
                ) : <p className="network-empty-detail">Loading request details…</p>)}
                {networkDetailsTab === 'payload' && (networkDetails?.requestBodyAvailable
                  ? <><strong className="network-detail-heading">Request payload</strong><pre>{networkDetails.requestBody ?? 'Chromium did not retain the request payload.'}</pre>{networkDetails.requestBodyTruncated && <p className="network-body-note">Payload display limited to 128 KB.</p>}</>
                  : <p className="network-empty-detail">This request has no captured payload.</p>)}
                {networkDetailsTab === 'response' && (networkBodyLoading
                  ? <p className="network-empty-detail">Loading response body…</p>
                  : networkResponseBody
                    ? <><pre>{responseBodyText(networkResponseBody)}</pre>{networkResponseBody.truncated && <p className="network-body-note">Response display limited to 1 MB.</p>}{networkResponseBody.base64Encoded && <p className="network-body-note">Chromium returned this body as base64-encoded data.</p>}</>
                    : <p className="network-empty-detail">{networkResponseError || 'Select a completed request to inspect its response body.'}</p>)}
                {networkDetailsTab === 'timing' && (networkDetails ? (
                  <div className="network-detail-section"><strong>Timing</strong>
                    <dl>
                      <dt>Started</dt><dd>{formatVisitedAt(networkDetails.startedAt)}</dd>
                      <dt>Total duration</dt><dd>{formatNetworkTime(networkDetails.durationMs)}</dd>
                      {networkDetails.timing && Object.entries(networkDetails.timing).filter(([name]) => name !== 'requestTime').map(([name, value]) => <Fragment key={name}><dt>{networkTimingLabel(name)}</dt><dd>{networkTimingValue(value)}</dd></Fragment>)}
                    </dl>
                  </div>
                ) : <p className="network-empty-detail">Loading timing…</p>)}
              </div>
            </>
          ) : <p className="network-empty-detail">Select a request to inspect its headers, payload, response and timing.</p>}
        </section>
      </div>
    </div>
  )
}
