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
import { isProtectedVideoDeliveryUrl } from './adblock-policy.ts'
import { frameStartPayload, frameUpdateStyles, type FrameDomFeatures, type FrameStartPayload } from './adblock-filters.ts'

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
}

function topFrameUrl(event: IpcMainEvent | IpcMainInvokeEvent): string {
  const frame = event.senderFrame
  const top = frame?.top ?? frame
  return top?.url || event.sender.getURL()
}

/**
 * Attach network, CSP and frame-injection handling to a session. Returns a
 * detach function. Only one session per process can own the frame IPC.
 */
export function attachAdblockToSession(session: Session, hooks: AdblockSessionHooks, preloadPath: string): () => void {
  const preloadId = session.registerPreloadScript({ type: 'frame', filePath: preloadPath })

  const onFrameStart = (event: IpcMainEvent, reportedUrl: unknown): void => {
    // sendSync blocks the renderer until returnValue is set: always set it.
    let payload: FrameStartPayload = { active: false, styles: '', scripts: [], observe: false }
    try {
      const engine = hooks.getEngine()
      if (engine && event.sender.session === session) {
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

  const onFrameUpdate = (event: IpcMainInvokeEvent, reportedUrl: unknown, features: FrameDomFeatures): string => {
    const engine = hooks.getEngine()
    if (!engine || event.sender.session !== session) return ''
    const frameUrl = event.senderFrame?.url || (typeof reportedUrl === 'string' ? reportedUrl : '')
    if (hooks.isBlockingDisabledForPage(topFrameUrl(event) || frameUrl)) return ''
    return frameUpdateStyles(engine, frameUrl, features)
  }

  ipcMain.on(FRAME_START_CHANNEL, onFrameStart)
  ipcMain.handle(FRAME_UPDATE_CHANNEL, onFrameUpdate)

  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const engine = hooks.getEngine()
    const pageUrl = hooks.pageUrlForRequest(details)
    const allow = (): void => {
      hooks.onRequest?.(details, {}, pageUrl)
      callback({})
    }
    if (!engine) return allow()
    if (pageUrl && hooks.isBlockingDisabledForPage(pageUrl)) return allow()
    // YouTube serves both ads and wanted video chunks through googlevideo.com.
    // Ads there are removed by scriptlets instead; never risk the stream.
    if (isProtectedVideoDeliveryUrl(details.url)) return allow()
    engine.onBeforeRequest(details, (response) => {
      hooks.onRequest?.(details, response, pageUrl)
      callback(response)
    })
  })

  session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const engine = hooks.getEngine()
    if (!engine) return callback({})
    const pageUrl = hooks.pageUrlForRequest(details)
    if (pageUrl && hooks.isBlockingDisabledForPage(pageUrl)) return callback({})
    engine.onHeadersReceived(details, callback)
  })

  return () => {
    session.webRequest.onBeforeRequest(null)
    session.webRequest.onHeadersReceived(null)
    ipcMain.removeListener(FRAME_START_CHANNEL, onFrameStart)
    ipcMain.removeHandler(FRAME_UPDATE_CHANNEL)
    session.unregisterPreloadScript(preloadId)
  }
}
