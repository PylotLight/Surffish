/**
 * HAR 1.2 export of the Network inspector's captured requests. Pure: main gathers the records
 * (and, if asked, bodies from Chromium's buffer) and this turns them into the HAR document.
 * Spec: http://www.softwareishard.com/blog/har-12-spec/
 */
import type { NetworkHeader, NetworkRequestDetails, NetworkResponseBody } from './types'

export interface HarSourceEntry {
  request: NetworkRequestDetails
  /** Only when bodies were requested and Chromium still had one. */
  responseBody?: NetworkResponseBody | null
}

export interface HarBuildOptions {
  creatorVersion: string
  includeBodies: boolean
  /** Per-body cap in characters (request payload and response text). */
  maxBodyCharacters?: number
  /** Cap for all bodies together; later bodies are left out once it's reached. */
  maxTotalBodyCharacters?: number
}

export const HAR_DEFAULT_MAX_BODY = 1_000_000
export const HAR_DEFAULT_MAX_TOTAL_BODIES = 25_000_000

export interface HarNameValue { name: string; value: string; comment?: string }
export interface HarTimings { blocked: number; dns: number; connect: number; send: number; wait: number; receive: number; ssl: number }
export interface HarPostData { mimeType: string; text: string; params: HarNameValue[]; comment?: string }
export interface HarContent { size: number; mimeType: string; text?: string; encoding?: string; comment?: string }
export interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    cookies: HarNameValue[]
    headers: HarNameValue[]
    queryString: HarNameValue[]
    postData?: HarPostData
    headersSize: number
    bodySize: number
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    cookies: HarNameValue[]
    headers: HarNameValue[]
    content: HarContent
    redirectURL: string
    headersSize: number
    bodySize: number
    _error?: string
  }
  cache: Record<string, never>
  timings: HarTimings
  serverIPAddress?: string
  _resourceType?: string
  _surffishTabId?: string
  comment?: string
}
export interface HarLog {
  log: {
    version: '1.2'
    creator: { name: string; version: string }
    pages: []
    entries: HarEntry[]
    comment?: string
  }
}

/** Chromium's protocol strings (h2, http/1.1, h3) to HAR's httpVersion. */
export function harHttpVersion(protocol: string): string {
  const value = protocol.trim().toLowerCase()
  if (value === 'h2' || value === 'http/2' || value === 'http/2.0') return 'HTTP/2.0'
  if (value === 'h3' || value.startsWith('h3-') || value === 'quic' || value === 'http/3') return 'HTTP/3'
  if (value === 'http/1.0') return 'HTTP/1.0'
  if (value === 'http/1.1') return 'HTTP/1.1'
  return value ? value.toUpperCase() : 'HTTP/1.1'
}

function headerValue(headers: NetworkHeader[], name: string): string {
  const key = name.toLowerCase()
  return headers.find((header) => header.name.toLowerCase() === key)?.value ?? ''
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Split a Cookie request header. Values stay exactly as sent. */
export function parseCookieHeader(value: string): HarNameValue[] {
  return value.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? { name: part, value: '' } : { name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() }
  })
}

/** Set-Cookie response headers (CDP joins several with newlines). Attributes are dropped. */
export function parseSetCookieHeaders(headers: NetworkHeader[]): HarNameValue[] {
  return headers
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .flatMap((header) => header.value.split('\n'))
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .map((pair) => {
      const index = pair.indexOf('=')
      return index < 0 ? { name: pair, value: '' } : { name: pair.slice(0, index).trim(), value: pair.slice(index + 1).trim() }
    })
}

export function harQueryString(url: string): HarNameValue[] {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

/**
 * CDP ResourceTiming (ms offsets from requestTime, -1 = not applicable) to HAR timings, the same
 * way Chrome DevTools does. Without timing data the whole duration counts as waiting.
 */
export function harTimings(timing: Record<string, number> | null, durationMs: number | null): HarTimings {
  const total = Math.max(0, durationMs ?? 0)
  const result: HarTimings = { blocked: -1, dns: -1, connect: -1, send: 0, wait: total, receive: 0, ssl: -1 }
  if (!timing) return result
  const at = (name: string): number => {
    const value = timing[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : -1
  }
  const span = (start: number, end: number): number => start >= 0 && end >= start ? round(end - start) : -1
  const dnsStart = at('dnsStart')
  const connectStart = at('connectStart')
  const sendStart = at('sendStart')
  const sendEnd = at('sendEnd')
  const headersEnd = at('receiveHeadersEnd')
  if (sendStart < 0 || headersEnd < 0) return result
  const firstPhase = [dnsStart, connectStart, sendStart].find((value) => value >= 0) ?? sendStart
  result.blocked = round(Math.max(0, firstPhase))
  result.dns = span(dnsStart, at('dnsEnd'))
  result.connect = span(connectStart, at('connectEnd'))
  result.ssl = span(at('sslStart'), at('sslEnd'))
  result.send = Math.max(0, span(sendStart, sendEnd))
  result.wait = Math.max(0, span(Math.max(sendEnd, sendStart), headersEnd))
  result.receive = round(Math.max(0, total - headersEnd))
  return result
}

/** HAR `time`: the sum of the timings that apply (ssl is already inside connect). */
export function harTotalTime(timings: HarTimings): number {
  const parts = [timings.blocked, timings.dns, timings.connect, timings.send, timings.wait, timings.receive]
  return round(parts.filter((value) => value >= 0).reduce((sum, value) => sum + value, 0))
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function buildHar(entries: HarSourceEntry[], options: HarBuildOptions): HarLog {
  const perBody = Math.max(0, options.maxBodyCharacters ?? HAR_DEFAULT_MAX_BODY)
  let budget = Math.max(0, options.maxTotalBodyCharacters ?? HAR_DEFAULT_MAX_TOTAL_BODIES)
  let omittedForBudget = 0
  const takeBody = (text: string): { text: string; note?: string } | null => {
    if (budget <= 0) {
      omittedForBudget += 1
      return null
    }
    const limit = Math.min(perBody, budget)
    const clipped = text.slice(0, limit)
    budget -= clipped.length
    return clipped.length < text.length ? { text: clipped, note: `Truncated to ${clipped.length.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters.` } : { text: clipped }
  }

  const harEntries = [...entries]
    .sort((a, b) => a.request.startedAt - b.request.startedAt)
    .map(({ request, responseBody }): HarEntry => {
      const timings = harTimings(request.timing, request.durationMs)
      const httpVersion = harHttpVersion(request.protocol)
      const requestMime = headerValue(request.requestHeaders, 'content-type')
      let postData: HarPostData | undefined
      if (request.requestBodyAvailable) {
        const body = options.includeBodies && request.requestBody !== null ? takeBody(request.requestBody) : null
        postData = { mimeType: requestMime, text: body?.text ?? '', params: [] }
        const notes = [
          request.requestBodyTruncated ? 'Payload was cut short when captured.' : '',
          body?.note ?? '',
          !options.includeBodies ? 'Body not included in this export.' : request.requestBody === null ? 'Chromium did not retain the payload.' : body === null ? 'Left out: export size limit reached.' : ''
        ].filter(Boolean)
        if (notes.length) postData.comment = notes.join(' ')
      }
      const content: HarContent = { size: Math.max(0, request.transferSize ?? 0), mimeType: request.mimeType || headerValue(request.responseHeaders, 'content-type') || 'x-unknown' }
      if (options.includeBodies && responseBody) {
        const body = takeBody(responseBody.text)
        if (body) {
          content.text = body.text
          if (responseBody.base64Encoded) content.encoding = 'base64'
          if (!responseBody.base64Encoded) content.size = byteLength(responseBody.text)
          const notes = [responseBody.truncated ? 'Body was cut short when captured.' : '', body.note ?? ''].filter(Boolean)
          if (notes.length) content.comment = notes.join(' ')
        } else {
          content.comment = 'Left out: export size limit reached.'
        }
      }
      const cookieHeader = headerValue(request.requestHeaders, 'cookie')
      const entry: HarEntry = {
        startedDateTime: new Date(request.startedAt).toISOString(),
        time: harTotalTime(timings),
        request: {
          method: request.method,
          url: request.url,
          httpVersion,
          cookies: cookieHeader ? parseCookieHeader(cookieHeader) : [],
          headers: request.requestHeaders.map((header) => ({ name: header.name, value: header.value })),
          queryString: harQueryString(request.url),
          ...(postData ? { postData } : {}),
          headersSize: -1,
          bodySize: postData ? (request.requestBody !== null && !request.requestBodyTruncated ? byteLength(request.requestBody) : -1) : 0
        },
        response: {
          status: request.status ?? 0,
          statusText: request.statusText,
          httpVersion,
          cookies: parseSetCookieHeaders(request.responseHeaders),
          headers: request.responseHeaders.map((header) => ({ name: header.name, value: header.value })),
          content,
          redirectURL: headerValue(request.responseHeaders, 'location'),
          headersSize: -1,
          bodySize: request.transferSize ?? -1,
          ...(request.errorText ? { _error: request.errorText } : {})
        },
        cache: {},
        timings,
        _resourceType: request.resourceType.toLowerCase(),
        _surffishTabId: request.tabId
      }
      const address = request.remoteAddress.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
      if (address) entry.serverIPAddress = address
      if (request.state === 'pending') entry.comment = 'Still pending when exported.'
      return entry
    })

  const log: HarLog['log'] = {
    version: '1.2',
    creator: { name: 'Surffish', version: options.creatorVersion },
    pages: [],
    entries: harEntries
  }
  if (omittedForBudget > 0) log.comment = `${omittedForBudget} bodies were left out to keep the export under its size limit.`
  return { log }
}
