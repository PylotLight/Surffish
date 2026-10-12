import { net } from 'electron'

/**
 * A fetch() that goes through the browser session (so it honours Surffish's proxy), only talks to
 * an allow-listed set of URLs, follows at most a few redirects (each one re-checked), and caps the
 * response size. Shared by the Bramble release installer and the Chrome Web Store installer.
 */
export interface RestrictedFetchOptions {
  /** Human label used in error messages, e.g. "GitHub release" or "Chrome Web Store". */
  label: string
  isAllowedUrl(url: URL): boolean
  maxResponseBytes: number
  getSession(): Electron.Session
  maxRedirects?: number
}

export type RestrictedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

// Session.fetch cancels redirect:'manual' in Electron instead of exposing the 3xx response; net.request preserves the configured session/proxy while leaving each redirect hop inspectable.
function fetchOnce(options: RestrictedFetchOptions, url: URL, method: string, headers: Headers, signal?: AbortSignal | null): Promise<Response> {
  const { label, maxResponseBytes } = options
  return new Promise((resolve, reject) => {
    const request = net.request({ url: url.toString(), method, session: options.getSession() })
    headers.forEach((value, name) => request.setHeader(name, value))
    let settled = false
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    const resolveOnce = (response: Response): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }
    const rejectOnce = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const onAbort = (): void => {
      rejectOnce(signal?.reason ?? new DOMException('The request was aborted.', 'AbortError'))
      request.abort()
    }

    request.on('error', rejectOnce)
    request.on('redirect', (statusCode, _redirectMethod, _redirectUrl, responseHeaders) => {
      const location = Object.entries(responseHeaders).find(([name]) => name.toLowerCase() === 'location')?.[1]?.[0]
      if (!location) {
        rejectOnce(new Error(`The ${label} download returned a redirect without a destination.`))
      } else {
        const redirectHeaders = new Headers()
        redirectHeaders.set('location', location)
        resolveOnce(new Response(null, { status: statusCode, headers: redirectHeaders }))
      }
      request.abort()
    })
    request.on('response', (response) => {
      const responseHeaders = new Headers()
      for (const [name, rawValue] of Object.entries(response.headers)) {
        if (rawValue === undefined) continue
        for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) responseHeaders.append(name, value)
      }
      const rawLength = responseHeaders.get('content-length')
      if (rawLength && Number(rawLength) > maxResponseBytes) {
        rejectOnce(new Error(`The ${label} response exceeds the allowed download size.`))
        request.abort()
        return
      }
      const chunks: Buffer[] = []
      let totalBytes = 0
      response.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += bytes.length
        if (totalBytes > maxResponseBytes) {
          rejectOnce(new Error(`The ${label} response exceeds the allowed download size.`))
          request.abort()
          return
        }
        chunks.push(bytes)
      })
      response.on('aborted', () => rejectOnce(new Error(`The ${label} response ended unexpectedly.`)))
      response.on('error', rejectOnce)
      response.on('end', () => {
        if (settled) return
        const status = response.statusCode ?? 200
        const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks, totalBytes)
        resolveOnce(new Response(body, { status, headers: responseHeaders }))
      })
    })
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
    }
    request.end()
  })
}

export function createRestrictedFetch(options: RestrictedFetchOptions): RestrictedFetch {
  const { label } = options
  const maxRedirects = options.maxRedirects ?? 4
  const restrictedFetch = async (input: string | URL | Request, init?: RequestInit, redirects = 0): Promise<Response> => {
    const requestInput = input instanceof Request ? input : null
    const url = new URL(requestInput?.url ?? String(input))
    if (!options.isAllowedUrl(url)) throw new Error(`The ${label} request URL is not an approved host.`)
    const method = init?.method ?? requestInput?.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') throw new Error(`${label} requests must use GET or HEAD.`)
    if (init?.body || requestInput?.body) throw new Error(`${label} requests cannot send a request body.`)
    const headers = new Headers(requestInput?.headers)
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value))
    const redirectMode = init?.redirect ?? requestInput?.redirect ?? 'follow'
    const response = await fetchOnce(options, url, method, headers, init?.signal ?? requestInput?.signal)
    if (response.status < 300 || response.status >= 400) return response
    if (redirectMode === 'manual') return response
    if (redirectMode === 'error') throw new Error(`The ${label} endpoint redirected unexpectedly.`)
    if (redirects >= maxRedirects) throw new Error(`The ${label} request exceeded the redirect limit.`)
    const location = response.headers.get('location')
    if (!location) throw new Error(`The ${label} request returned an invalid redirect.`)
    const nextUrl = new URL(location, url)
    if (!options.isAllowedUrl(nextUrl)) throw new Error(`The ${label} request redirected outside the approved hosts.`)
    return restrictedFetch(nextUrl, init, redirects + 1)
  }
  return (input, init) => restrictedFetch(input, init)
}
