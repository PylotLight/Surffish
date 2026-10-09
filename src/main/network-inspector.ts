import type { WebContents } from 'electron'
import type {
  NetworkHeader,
  NetworkRequestDetails,
  NetworkRequestSummary,
  NetworkResponseBody
} from '../shared/types'
import { getMainWindow } from './window'

const MAX_RETAINED_REQUESTS = 1000
const MAX_BODY_CHARACTERS = 1_000_000
const MAX_REQUEST_BODY_CHARACTERS = 128_000
const BROADCAST_INTERVAL_MS = 100

type HeaderMap = Record<string, unknown>
type CdpRequest = {
  url?: string
  method?: string
  headers?: HeaderMap
  postData?: string
  hasPostData?: boolean
}
type CdpResponse = {
  url?: string
  status?: number
  statusText?: string
  headers?: HeaderMap
  mimeType?: string
  remoteIPAddress?: string
  remotePort?: number
  protocol?: string
  securityState?: string
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
  fromPrefetchCache?: boolean
  timing?: Record<string, unknown>
  encodedDataLength?: number
}
type InternalRequest = NetworkRequestDetails & {
  protocolRequestId: string
  monotonicStart: number
  bodyCache: NetworkResponseBody | null
}
type Tracker = {
  contents: WebContents
  tabId: string
  messageListener: (event: Electron.Event, method: string, params: Record<string, unknown>) => void
  detachListener: (event: Electron.Event, reason: string) => void
  activeRequests: Map<string, string>
}

const records = new Map<string, InternalRequest>()
const trackers = new Map<number, Tracker>()
let nextRequestNumber = 0
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
let lastResponseBody: { id: string; value: NetworkResponseBody } | null = null

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function headersFrom(value: unknown): NetworkHeader[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as HeaderMap).map(([name, rawValue]) => ({
    name,
    value: Array.isArray(rawValue) ? rawValue.map(stringValue).join(', ') : stringValue(rawValue)
  }))
}

function boundedText(value: string | undefined, limit: number): { text: string | null; truncated: boolean } {
  if (typeof value !== 'string') return { text: null, truncated: false }
  return { text: value.slice(0, limit), truncated: value.length > limit }
}

function initiatorLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const initiator = value as { type?: unknown; url?: unknown; stack?: { callFrames?: Array<{ url?: unknown; lineNumber?: unknown }> } }
  const frame = initiator.stack?.callFrames?.find((item) => typeof item.url === 'string' && item.url.length > 0)
  const source = stringValue(initiator.url) || stringValue(frame?.url)
  const line = typeof frame?.lineNumber === 'number' ? `:${frame.lineNumber + 1}` : ''
  const kind = stringValue(initiator.type)
  return [kind, source ? `${source}${line}` : ''].filter(Boolean).join(' · ')
}

function requestKey(tabId: string, protocolRequestId: string): string {
  return `${tabId}\u0000${protocolRequestId}`
}

function getRecord(id: string | undefined): InternalRequest | undefined {
  return id ? records.get(id) : undefined
}

function summaryOf(record: InternalRequest): NetworkRequestSummary {
  const {
    id, tabId, url, method, resourceType, status, statusText, mimeType,
    startedAt, durationMs, transferSize, responseBodyAvailable, state, initiator, errorText,
    fromDiskCache, fromServiceWorker
  } = record
  return {
    id, tabId, url, method, resourceType, status, statusText, mimeType,
    startedAt, durationMs, transferSize, responseBodyAvailable, state, initiator, errorText,
    fromDiskCache, fromServiceWorker
  }
}

function publish(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    const contents = getMainWindow()?.webContents
    if (contents && !contents.isDestroyed()) contents.send('browser:network:changed', getNetworkRequests())
  }, BROADCAST_INTERVAL_MS)
}

function enforceRetention(): void {
  while (records.size > MAX_RETAINED_REQUESTS) {
    const oldestId = records.keys().next().value as string | undefined
    if (!oldestId) break
    const oldest = records.get(oldestId)
    records.delete(oldestId)
    if (oldest) {
      const tracker = [...trackers.values()].find((candidate) => candidate.tabId === oldest.tabId)
      const key = requestKey(oldest.tabId, oldest.protocolRequestId)
      if (tracker?.activeRequests.get(key) === oldestId) tracker.activeRequests.delete(key)
    }
  }
}

function createRecord(tracker: Tracker, protocolRequestId: string, params: Record<string, unknown>): InternalRequest {
  const request = (params.request ?? {}) as CdpRequest
  const wallTime = numberValue(params.wallTime)
  const monotonicStart = numberValue(params.timestamp) ?? performance.now() / 1000
  const record: InternalRequest = {
    id: `${tracker.tabId}:${++nextRequestNumber}`,
    tabId: tracker.tabId,
    url: stringValue(request.url),
    method: stringValue(request.method) || 'GET',
    resourceType: stringValue(params.type) || 'Other',
    status: null,
    statusText: '',
    mimeType: '',
    startedAt: wallTime === null ? Date.now() : wallTime * 1000,
    durationMs: null,
    transferSize: null,
    state: 'pending',
    initiator: initiatorLabel(params.initiator),
    errorText: '',
    fromDiskCache: false,
    fromServiceWorker: false,
    requestHeaders: headersFrom(request.headers),
    responseHeaders: [],
    requestBody: null,
    requestBodyAvailable: request.hasPostData === true || typeof request.postData === 'string',
    requestBodyTruncated: false,
    responseBodyAvailable: false,
    remoteAddress: '',
    protocol: '',
    securityState: '',
    timing: null,
    protocolRequestId,
    monotonicStart,
    bodyCache: null
  }
  records.set(record.id, record)
  tracker.activeRequests.set(requestKey(tracker.tabId, protocolRequestId), record.id)
  enforceRetention()
  return record
}

function applyResponse(record: InternalRequest, response: CdpResponse): void {
  record.status = numberValue(response.status)
  record.statusText = stringValue(response.statusText)
  record.mimeType = stringValue(response.mimeType)
  record.responseHeaders = headersFrom(response.headers)
  const port = numberValue(response.remotePort)
  const address = stringValue(response.remoteIPAddress)
  record.remoteAddress = address ? `${address}${port === null ? '' : `:${port}`}` : ''
  record.protocol = stringValue(response.protocol)
  record.securityState = stringValue(response.securityState)
  record.fromDiskCache ||= response.fromDiskCache === true || response.fromPrefetchCache === true
  record.fromServiceWorker ||= response.fromServiceWorker === true
  if (response.timing && typeof response.timing === 'object') {
    record.timing = Object.fromEntries(
      Object.entries(response.timing)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    )
  }
}

function finishRecord(record: InternalRequest, timestamp: unknown, transferSize?: unknown): void {
  const end = numberValue(timestamp)
  if (end !== null) record.durationMs = Math.max(0, Math.round((end - record.monotonicStart) * 1000))
  const bytes = numberValue(transferSize)
  if (bytes !== null) record.transferSize = Math.max(0, Math.round(bytes))
}

function handleMessage(tracker: Tracker, method: string, params: Record<string, unknown>): void {
  const protocolRequestId = stringValue(params.requestId)
  if (!protocolRequestId) return
  const key = requestKey(tracker.tabId, protocolRequestId)
  let record = getRecord(tracker.activeRequests.get(key))

  if (method === 'Network.requestWillBeSent') {
    const redirectResponse = params.redirectResponse as CdpResponse | undefined
    if (redirectResponse && record) {
      applyResponse(record, redirectResponse)
      record.state = 'complete'
      record.responseBodyAvailable = false
      finishRecord(record, params.timestamp, redirectResponse.encodedDataLength)
    }
    record = createRecord(tracker, protocolRequestId, params)
  } else if (method === 'Network.requestWillBeSentExtraInfo') {
    if (record) {
      record.requestHeaders = headersFrom(params.headers)
      publish()
    }
    return
  } else if (method === 'Network.responseReceived') {
    if (record) {
      applyResponse(record, (params.response ?? {}) as CdpResponse)
      publish()
    }
    return
  } else if (method === 'Network.responseReceivedExtraInfo') {
    if (record) {
      const extraHeaders = params.headers
      if (extraHeaders && typeof extraHeaders === 'object') record.responseHeaders = headersFrom(extraHeaders)
      const status = numberValue(params.statusCode)
      if (status !== null) record.status = status
      publish()
    }
    return
  } else if (method === 'Network.dataReceived') {
    if (record) {
      const encoded = numberValue(params.encodedDataLength)
      if (encoded !== null) record.transferSize = (record.transferSize ?? 0) + Math.max(0, encoded)
      publish()
    }
    return
  } else if (method === 'Network.loadingFinished') {
    if (record) {
      record.state = 'complete'
      record.responseBodyAvailable = record.status !== null && record.status !== 204 && record.status !== 304
      finishRecord(record, params.timestamp, params.encodedDataLength)
      tracker.activeRequests.delete(key)
      publish()
    }
    return
  } else if (method === 'Network.loadingFailed') {
    if (record) {
      record.state = 'failed'
      const error = stringValue(params.errorText)
      const blockedReason = stringValue(params.blockedReason)
      record.errorText = [error, blockedReason ? `Blocked: ${blockedReason}` : ''].filter(Boolean).join(' · ')
      if (!record.errorText) record.errorText = 'Request failed'
      finishRecord(record, params.timestamp)
      tracker.activeRequests.delete(key)
      publish()
    }
    return
  } else {
    return
  }
  publish()
}

function markInFlightFailed(tracker: Tracker, reason: string): void {
  for (const id of tracker.activeRequests.values()) {
    const record = records.get(id)
    if (!record || record.state !== 'pending') continue
    record.state = 'failed'
    record.errorText = reason
    record.responseBodyAvailable = false
  }
  tracker.activeRequests.clear()
  publish()
}

/** Attach before the first navigation so the main document and subresources are both observed. */
export function attachNetworkInspector(tabId: string, contents: WebContents): void {
  if (contents.isDestroyed() || trackers.has(contents.id)) return
  const debuggerApi = contents.debugger
  if (debuggerApi.isAttached()) {
    console.warn(`Network capture is unavailable for tab ${tabId}: its DevTools debugger is already attached.`)
    return
  }
  const tracker: Tracker = {
    contents,
    tabId,
    activeRequests: new Map(),
    messageListener: (_event, method, params) => handleMessage(tracker, method, params),
    detachListener: (_event, reason) => {
      trackers.delete(contents.id)
      markInFlightFailed(tracker, `Network capture detached (${reason || 'unknown reason'}).`)
    }
  }
  try {
    debuggerApi.attach('1.3')
    trackers.set(contents.id, tracker)
    debuggerApi.on('message', tracker.messageListener)
    debuggerApi.on('detach', tracker.detachListener)
    void debuggerApi.sendCommand('Network.enable', {
      maxTotalBufferSize: 20 * 1024 * 1024,
      maxResourceBufferSize: 2 * 1024 * 1024
    }).catch((error: unknown) => {
      console.warn(`Could not enable network capture for tab ${tabId}:`, error)
    })
  } catch (error) {
    console.warn(`Could not attach network capture for tab ${tabId}:`, error)
  }
}

/** Stop CDP capture when a tab view is disposed, while keeping its recent rows for inspection. */
export function detachNetworkInspector(contents: WebContents): void {
  const tracker = trackers.get(contents.id)
  if (!tracker) return
  trackers.delete(contents.id)
  contents.debugger.off('message', tracker.messageListener)
  contents.debugger.off('detach', tracker.detachListener)
  markInFlightFailed(tracker, 'Tab view was unloaded before the request finished.')
  if (!contents.isDestroyed() && contents.debugger.isAttached()) {
    try {
      contents.debugger.detach()
    } catch (error) {
      console.warn('Could not detach the network inspector:', error)
    }
  }
}

export function getNetworkRequests(): NetworkRequestSummary[] {
  return [...records.values()].reverse().map(summaryOf)
}

export async function getNetworkRequestDetails(id: string): Promise<NetworkRequestDetails | null> {
  const record = records.get(id)
  if (!record) return null
  if (record.requestBodyAvailable && record.requestBody === null) {
    const tracker = [...trackers.values()].find((candidate) => candidate.tabId === record.tabId)
    if (tracker && tracker.contents.debugger.isAttached()) {
      try {
        const response = await tracker.contents.debugger.sendCommand('Network.getRequestPostData', {
          requestId: record.protocolRequestId
        }) as { postData?: string }
        const body = boundedText(response.postData, MAX_REQUEST_BODY_CHARACTERS)
        record.requestBody = body.text
        record.requestBodyTruncated = body.truncated
      } catch {
        // Request data is not always retained by Chromium; the request row remains useful without it.
      }
    }
  }
  const { protocolRequestId: _protocolRequestId, monotonicStart: _monotonicStart, bodyCache: _bodyCache, ...details } = record
  return { ...details, ...summaryOf(record), requestHeaders: [...record.requestHeaders], responseHeaders: [...record.responseHeaders], timing: record.timing ? { ...record.timing } : null }
}

export async function getNetworkResponseBody(id: string): Promise<{ body: NetworkResponseBody | null; error: string | null }> {
  const record = records.get(id)
  if (!record) return { body: null, error: 'This request is no longer retained.' }
  if (lastResponseBody?.id === id) return { body: { ...lastResponseBody.value }, error: null }
  if (!record.responseBodyAvailable) return { body: null, error: 'No response body is available for this request.' }
  const tracker = [...trackers.values()].find((candidate) => candidate.tabId === record.tabId)
  if (!tracker || !tracker.contents.debugger.isAttached()) {
    return { body: null, error: 'The response body is no longer available because this tab has been unloaded or closed.' }
  }
  try {
    const response = await tracker.contents.debugger.sendCommand('Network.getResponseBody', {
      requestId: record.protocolRequestId
    }) as { body?: string; base64Encoded?: boolean }
    const bounded = boundedText(response.body ?? '', MAX_BODY_CHARACTERS)
    const body: NetworkResponseBody = {
      text: bounded.text ?? '',
      base64Encoded: response.base64Encoded === true,
      truncated: bounded.truncated
    }
    lastResponseBody = { id, value: body }
    return { body: { ...body }, error: null }
  } catch {
    return { body: null, error: 'Chromium no longer has this response body in its network buffer.' }
  }
}

export function clearNetworkRequests(): void {
  records.clear()
  lastResponseBody = null
  for (const tracker of trackers.values()) tracker.activeRequests.clear()
  publish()
}
