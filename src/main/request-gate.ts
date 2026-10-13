/**
 * Lets several features (proxy kill switch, HTTPS-only upgrades) act on requests before the
 * ad blocker sees them. Electron allows one webRequest listener per event and session: the ad
 * blocker owns onBeforeRequest and calls gateRequest() first; when it isn't attached (it failed
 * to load) installFallbackRequestGate() keeps the gates working on their own.
 * onErrorOccurred is owned here. No `app` imports, like adblock-engine.
 */
import type { Session } from 'electron'

export type RequestGateDetails = Electron.OnBeforeRequestListenerDetails
export type RequestGate = (details: RequestGateDetails) => Electron.CallbackResponse | null
export type RequestErrorListener = (details: Electron.OnErrorOccurredListenerDetails) => void

const gates: RequestGate[] = []
const errorListeners = new Set<RequestErrorListener>()
const watchedSessions = new WeakSet<Session>()

export function addRequestGate(gate: RequestGate): () => void {
  gates.push(gate)
  return () => {
    const index = gates.indexOf(gate)
    if (index >= 0) gates.splice(index, 1)
  }
}

/** The first gate that wants to cancel or redirect the request wins; null lets it continue. */
export function gateRequest(details: RequestGateDetails): Electron.CallbackResponse | null {
  for (const gate of gates) {
    try {
      const response = gate(details)
      if (response) return response
    } catch (error) {
      console.warn('Request gate failed:', error)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Start-up hold: the first window shows before the ad-filter engine and Web Store extensions
// are loaded, so page requests wait here until they are (never an unfiltered first page).

let hold: Promise<void> | null = null

/**
 * Hold page requests until `ready` settles, or `timeoutMs` passes (a stuck start-up never
 * leaves pages hanging). Requests without a page (Session.fetch for filter lists, favicons,
 * extension downloads) and extension resources are never held, so the work being waited for
 * can't wait on itself.
 */
export function holdPageRequestsUntil(ready: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const released: Promise<void> = Promise.race([
    ready.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`Start-up work took over ${timeoutMs} ms; letting page requests through.`)
        resolve()
      }, timeoutMs)
    })
  ]).finally(() => {
    clearTimeout(timer)
    if (hold === released) hold = null
  })
  hold = released
  return released
}

/** Should this request wait for the start-up hold? */
export function isHeldRequest(details: Pick<RequestGateDetails, 'url' | 'webContentsId'>): boolean {
  if (!hold) return false
  if (typeof details.webContentsId !== 'number' || details.webContentsId < 0) return false
  return !/^(?:chrome-extension|devtools|chrome|file|data|blob):/i.test(details.url)
}

/** Run `next` now, or once the start-up hold lifts when the request is held. */
export function afterStartupHold(details: Pick<RequestGateDetails, 'url' | 'webContentsId'>, next: () => void): void {
  if (hold && isHeldRequest(details)) void hold.then(next)
  else next()
}

export type BeforeRequestHandler = (details: RequestGateDetails, callback: (response: Electron.CallbackResponse) => void) => void
const sessionHandlers = new WeakMap<Session, BeforeRequestHandler>()

/**
 * The full handler a session's requests go through once attached (the ad blocker). Requests the
 * fallback gate held at start-up are handed to it on release, so attaching late (after the first
 * window) never lets a held request through unfiltered.
 */
export function setSessionRequestHandler(session: Session, handler: BeforeRequestHandler | null): void {
  if (handler) sessionHandlers.set(session, handler)
  else sessionHandlers.delete(session)
}

export function installFallbackRequestGate(session: Session): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    afterStartupHold(details, () => {
      const handler = sessionHandlers.get(session)
      if (handler) handler(details, callback)
      else callback(gateRequest(details) ?? {})
    })
  })
}

export function onRequestError(listener: RequestErrorListener): () => void {
  errorListeners.add(listener)
  return () => { errorListeners.delete(listener) }
}

export function watchRequestErrors(session: Session): void {
  if (watchedSessions.has(session)) return
  watchedSessions.add(session)
  session.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
    for (const listener of errorListeners) {
      try {
        listener(details)
      } catch (error) {
        console.warn('Request error listener failed:', error)
      }
    }
  })
}
