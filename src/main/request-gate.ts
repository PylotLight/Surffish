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

export function installFallbackRequestGate(session: Session): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback(gateRequest(details) ?? {}))
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
