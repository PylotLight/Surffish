/** Shared type-only contracts between the main, preload, and renderer processes. */
export type SearchEngineId = 'brave' | 'duckduckgo' | 'google' | 'bing'
export type TabSleepMinutes = 0 | 5 | 15 | 30 | 60

export interface BrowserProxySettings {
  enabled: boolean
  host: string
  port: number
}
export interface BrowserProxyTestResult {
  reachable: boolean
  message: string
}
export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}
export interface BrowserTabSummary {
  id: string
  url: string
  title: string
  loading: boolean
  active: boolean
  sleeping: boolean
}
export interface BrowsingHistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
}
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Browser-renderer coordinates for anchoring the Bramble launcher window. */
export interface BramblePopupAnchor {
  x: number
  y: number
  width: number
  height: number
}

export interface BramblePocState {
  installed: boolean
  loading: boolean
  version: string | null
  popupOpen: boolean
  error: string | null
}

export interface AdblockBlockedRequest {
  timestamp: number
  requestHost: string
  pageHost: string
  resourceType: string
}

export interface AdblockDiagnostics {
  status: 'starting' | 'active' | 'updating' | 'degraded'
  blockingEnabled: boolean
  source: 'none' | 'updated' | 'cache' | 'stale-cache' | 'empty'
  lastUpdatedAt: number | null
  blockedRequests: number
  allowedRequests: number
  networkFilterCount: number
  loadedListCount: number
  loadedLists: string[]
  recentBlockedRequests: AdblockBlockedRequest[]
  lastError: string | null
}

export type NetworkRequestState = 'pending' | 'complete' | 'failed'

export interface NetworkHeader {
  name: string
  value: string
}

/** Safe-to-render row data emitted frequently while a request is in flight. */
export interface NetworkRequestSummary {
  id: string
  tabId: string
  url: string
  method: string
  resourceType: string
  status: number | null
  statusText: string
  mimeType: string
  startedAt: number
  durationMs: number | null
  transferSize: number | null
  responseBodyAvailable: boolean
  state: NetworkRequestState
  initiator: string
  errorText: string
  fromDiskCache: boolean
  fromServiceWorker: boolean
}

/** Full request metadata is fetched only when the user opens a request. */
export interface NetworkRequestDetails extends NetworkRequestSummary {
  requestHeaders: NetworkHeader[]
  responseHeaders: NetworkHeader[]
  requestBody: string | null
  requestBodyAvailable: boolean
  requestBodyTruncated: boolean
  remoteAddress: string
  protocol: string
  securityState: string
  timing: Record<string, number> | null
}

export interface NetworkResponseBody {
  text: string
  base64Encoded: boolean
  truncated: boolean
}
