/**
 * Wires the filter engine into an Electron session.
 *
 * - Scriptlets (`##+js(...)`) and base cosmetic CSS reach every frame
 *   synchronously through a sandboxed preload (`adblock-frame.cjs`) and run
 *   via `webFrame.executeJavaScript` before page scripts. Ghostery's stock
 *   preload asks asynchronously and often loses the race against inline
 *   scripts such as YouTube's `ytInitialPlayerResponse`.
 * - The session webRequest listeners are attached once and always delegate to
 *   the current engine, so refreshes swap engines without unregistering
 *   handlers (Electron allows a single listener per event).
 *
 * No `app` or window imports, so harnesses can load `out/main/adblock-engine.js`.
 */
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron'
import type { ElectronBlocker } from '@ghostery/adblocker-electron'
import { isExtensionExemptRequest, isProtectedVideoDeliveryUrl } from './adblock-policy.ts'
import { frameStartPayload, frameUpdateStyles, type FrameDomFeatures, type FrameStartPayload } from './adblock-filters.ts'
import { afterStartupHold, applyResponseHeaderHooks, gateRequest, installFallbackRequestGate, setSessionRequestHandler } from './request-gate.ts'

export { applyFilterEnvironment, buildFilterEngine, frameStartPayload, frameUpdateStyles } from './adblock-filters.ts'
export type { BuiltFilterEngine, FrameDomFeatures, FrameStartPayload, ListFetch } from './adblock-filters.ts'
export { FILTER_LIST_SOURCES, FULL_FILTER_CONFIG } from './adblock-policy.ts'

export const FRAME_START_CHANNEL = 'surffish:adblock:frame-start'
export const FRAME_UPDATE_CHANNEL = 'surffish:adblock:frame-update'

export type BeforeRequestDetails = Parameters<ElectronBlocker['onBeforeRequest']>[0]
export type BeforeRequestResponse = Parameters<Parameters<ElectronBlocker['onBeforeRequest']>[1]>[0]
export type HeadersReceivedDetails = Parameters<ElectronBlocker['onHeadersReceived']>[0]

export interface AdblockSessionHooks {
  /** The engine to use right now (swapped on refresh). */
  getEngine(): ElectronBlocker | null
  /** Top-level page URL a subresource request belongs to. */
  pageUrlForRequest(details: BeforeRequestDetails | HeadersReceivedDetails): string
  /** `true` when the user turned ad blocking off for this top-level page. */
  isBlockingDisabledForPage(pageUrl: string): boolean
  onRequest?(details: BeforeRequestDetails, response: BeforeRequestResponse, pageUrl: string): void
  onFrameStart?(payload: FrameStartPayload): void
  /** Hosts installed extensions depend on, which must never be blocked. */
  getExemptHosts?(): ReadonlySet<string>
}

const NO_EXEMPT_HOSTS: ReadonlySet<string> = new Set()

function requestExemptionDetails(details: BeforeRequestDetails | HeadersReceivedDetails): { url?: string; referrer?: string; initiator?: string; frameUrl?: string } {
  const raw = details as unknown as Record<string, unknown>
  let frameUrl: unknown
  try {
    // details.frame is a WebFrameMain that can already be gone.
    frameUrl = (raw.frame as { url?: unknown } | null | undefined)?.url
  } catch {
    frameUrl = undefined
  }
  return {
    url: typeof raw.url === 'string' ? raw.url : undefined,
    referrer: typeof raw.referrer === 'string' ? raw.referrer : undefined,
    initiator: typeof raw.initiator === 'string' ? raw.initiator : undefined,
    frameUrl: typeof frameUrl === 'string' ? frameUrl : undefined
  }
}

function topFrameUrl(event: IpcMainEvent | IpcMainInvokeEvent): string {
  const frame = event.senderFrame
  const top = frame?.top ?? frame
  return top?.url || event.sender.getURL()
}

const attachedSessions = new Map<Session, AdblockSessionHooks>()

function onFrameStart(event: IpcMainEvent, reportedUrl: unknown): void {
  // sendSync blocks the renderer until returnValue is set: always set it.
  let payload: FrameStartPayload = { active: false, styles: '', scripts: [], observe: false }
  try {
    const hooks = attachedSessions.get(event.sender.session)
    const engine = hooks?.getEngine()
    if (hooks && engine) {
      const frameUrl = event.senderFrame?.url || (typeof reportedUrl === 'string' ? reportedUrl : '')
      const pageUrl = topFrameUrl(event) || frameUrl
      if (!hooks.isBlockingDisabledForPage(pageUrl)) {
        payload = frameStartPayload(engine, frameUrl)
        hooks.onFrameStart?.(payload)
      }
    }
  } catch (error) {
    console.warn('Ad-filter frame injection failed:', error)
  } finally {
    event.returnValue = payload
  }
}

function onFrameUpdate(event: IpcMainInvokeEvent, reportedUrl: unknown, features: FrameDomFeatures): string {
  const hooks = attachedSessions.get(event.sender.session)
  const engine = hooks?.getEngine()
  if (!hooks || !engine) return ''
  const frameUrl = event.senderFrame?.url || (typeof reportedUrl === 'string' ? reportedUrl : '')
  if (hooks.isBlockingDisabledForPage(topFrameUrl(event) || frameUrl)) return ''
  return frameUpdateStyles(engine, frameUrl, features)
}

/**
 * Attach network, CSP and frame-injection handling to a session. Returns a detach function.
 * Several sessions (profile + private) can be attached; the frame IPC channels are shared and
 * dispatch on the sender's session.
 */
export function attachAdblockToSession(session: Session, hooks: AdblockSessionHooks, preloadPath: string): () => void {
  if (attachedSessions.has(session)) throw new Error('Ad blocking is already attached to this session.')
  const preloadId = session.registerPreloadScript({ type: 'frame', filePath: preloadPath })
  if (attachedSessions.size === 0) {
    ipcMain.on(FRAME_START_CHANNEL, onFrameStart)
    ipcMain.handle(FRAME_UPDATE_CHANNEL, onFrameUpdate)
  }
  attachedSessions.set(session, hooks)

  const handleBeforeRequest = (details: BeforeRequestDetails, callback: (response: BeforeRequestResponse) => void): void => {
    // Kill switch / HTTPS-only (and the session's extension DNR rules) run first, whatever the ad blocker would do.
    const gated = gateRequest(details, session)
    if (gated) return callback(gated)
    const engine = hooks.getEngine()
    const pageUrl = hooks.pageUrlForRequest(details)
    const allow = (): void => {
      hooks.onRequest?.(details, {}, pageUrl)
      callback({})
    }
    if (!engine) return allow()
    if (pageUrl && hooks.isBlockingDisabledForPage(pageUrl)) return allow()
    // Never block extension resources, extension-originated requests, or hosts extensions rely on.
    if (isExtensionExemptRequest(requestExemptionDetails(details), hooks.getExemptHosts?.() ?? NO_EXEMPT_HOSTS)) return allow()
    // YouTube serves both ads and wanted video chunks through googlevideo.com.
    // Ads there are removed by scriptlets instead; never risk the stream.
    if (isProtectedVideoDeliveryUrl(details.url)) return allow()
    engine.onBeforeRequest(details, (response) => {
      hooks.onRequest?.(details, response, pageUrl)
      callback(response)
    })
  }
  // Page requests made before the engine is loaded (the window shows first) wait for it; ones the
  // fallback gate was already holding come here when released.
  setSessionRequestHandler(session, handleBeforeRequest)
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    afterStartupHold(details, () => handleBeforeRequest(details, callback))
  })

  session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, rawCallback) => {
    // Response-header hooks (extension DNR modifyHeaders) apply on top of the ad blocker's changes.
    const callback = (response: Electron.HeadersReceivedResponse): void => rawCallback(applyResponseHeaderHooks(session, details, response))
    const engine = hooks.getEngine()
    if (!engine) return callback({})
    const pageUrl = hooks.pageUrlForRequest(details)
    if (pageUrl && hooks.isBlockingDisabledForPage(pageUrl)) return callback({})
    if (isExtensionExemptRequest(requestExemptionDetails(details), hooks.getExemptHosts?.() ?? NO_EXEMPT_HOSTS)) return callback({})
    engine.onHeadersReceived(details, callback)
  })

  return () => {
    session.webRequest.onBeforeRequest(null)
    setSessionRequestHandler(session, null)
    installFallbackRequestGate(session)
    session.webRequest.onHeadersReceived(null)
    session.unregisterPreloadScript(preloadId)
    attachedSessions.delete(session)
    if (attachedSessions.size === 0) {
      ipcMain.removeListener(FRAME_START_CHANNEL, onFrameStart)
      ipcMain.removeHandler(FRAME_UPDATE_CHANNEL)
    }
  }
}
