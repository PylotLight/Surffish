/**
 * A hidden page per Chrome Web Store extension that needs Surffish to talk to its service worker.
 *
 * Electron gives the main process no channel into an extension's worker (service-worker preloads do
 * not run for extension workers), but an extension page with a Surffish preload can relay: it posts
 * to the worker with chrome.runtime.sendMessage (which also wakes a stopped worker) and reaches main
 * over IPC. Surffish's worker shim recognises the `__surffishBridge` messages and hides them from
 * the extension's own listeners. The page is `surffish-bridge.html`, written into the staged
 * extension by the adapter.
 *
 * Used for:
 *  - chrome.webNavigation, which Electron lacks: main turns tab navigation events into
 *    onBeforeNavigate/onCommitted/onDOMContentLoaded/onCompleted/onErrorOccurred/... for the shim.
 *  - declarativeNetRequest: the page reads the extension's dynamic/session rules and enabled
 *    rulesets from the native API whenever the worker shim says they changed, and reports them to
 *    extension-dnr.ts (which enforces them). On start-up it mirrors Surffish's enabled-ruleset set
 *    into the native API (Electron never enables manifest rulesets on its own).
 */
import { app, ipcMain, webContents as allWebContents, WebContentsView, webFrameMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionDnrEnabledRulesets, forgetExtensionDnrTab, updateExtensionDnrState } from './extension-dnr'
import { EXTENSION_BRIDGE_PAGE } from './web-store-extension-adapter'
import { BRIDGE_RELOAD_LIMIT, BRIDGE_RELOAD_WINDOW_MS, RecoveryBudget } from '../shared/stability'

export const BRIDGE_UP_CHANNEL = 'surffish:extension-bridge:up'
export const BRIDGE_CALL_CHANNEL = 'surffish:extension-bridge:call'
export const BRIDGE_DOWN_CHANNEL = 'surffish:extension-bridge:down'

const MAX_QUEUED_EVENTS = 200
const mainDirectory = dirname(fileURLToPath(import.meta.url))

type JsonRecord = Record<string, unknown>

interface BridgeOptions {
  id: string
  /** chrome-extension://<id>/ */
  extensionUrl: string
  session: Electron.Session
  webNavigation: boolean
  dnr: boolean
  /** Is this webContents one of the user's (non-private) tabs? */
  isTab(contents: WebContents): boolean
}

interface Bridge extends BridgeOptions {
  view: WebContentsView
  ready: boolean
  queue: unknown[]
  /** Crash reloads left for this bridge: a page that keeps crashing is not reloaded forever. */
  reloads: RecoveryBudget
}

const bridges = new Map<string, Bridge>()
const watchedContents = new WeakSet<WebContents>()
let ipcRegistered = false
let contentsHooked = false

function preloadPath(): string {
  const candidates = [join(mainDirectory, '../preload/extension-bridge.cjs'), join(mainDirectory, '../../preload/extension-bridge.cjs'), join(app.getAppPath(), 'src/preload/extension-bridge.cjs')]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

function bridgeForSender(sender: WebContents, senderFrame: WebFrameMain | null): Bridge | null {
  for (const bridge of bridges.values()) {
    if (bridge.view.webContents !== sender) continue
    if (!senderFrame || senderFrame !== sender.mainFrame || !senderFrame.url.startsWith(bridge.extensionUrl)) return null
    return bridge
  }
  return null
}

function send(bridge: Bridge, message: unknown): void {
  const contents = bridge.view.webContents
  if (contents.isDestroyed()) return
  if (!bridge.ready) {
    if (bridge.queue.length < MAX_QUEUED_EVENTS) bridge.queue.push(message)
    return
  }
  contents.send(BRIDGE_DOWN_CHANNEL, message)
}

function onUp(event: IpcMainEvent, message: unknown): void {
  const bridge = bridgeForSender(event.sender, event.senderFrame)
  if (!bridge || typeof message !== 'object' || message === null) return
  const record = message as JsonRecord
  if (record.type === 'ready') {
    bridge.ready = true
    event.sender.send(BRIDGE_DOWN_CHANNEL, { type: 'init', enabledRulesets: bridge.dnr ? extensionDnrEnabledRulesets(bridge.id) : null })
    const queued = bridge.queue.splice(0)
    for (const item of queued) event.sender.send(BRIDGE_DOWN_CHANNEL, item)
  } else if (record.type === 'dnr-state' && bridge.dnr) {
    updateExtensionDnrState(bridge.id, {
      dynamicRules: record.dynamicRules,
      sessionRules: record.sessionRules,
      enabledRulesets: record.enabledRulesets,
      disabledStaticRuleIds: record.disabledStaticRuleIds
    })
  }
}

function frameInfo(frame: WebFrameMain | null | undefined): { frameId: number; parentFrameId: number } {
  // Chrome's frame ids (as chrome.scripting expects them): 0 for the main frame, else the frame tree node id.
  if (!frame || !frame.parent) return { frameId: 0, parentFrameId: -1 }
  const parent = frame.parent
  return { frameId: frame.frameTreeNodeId, parentFrameId: parent.parent ? parent.frameTreeNodeId : 0 }
}

function frameDetails(contents: WebContents, frame: WebFrameMain): JsonRecord {
  return { tabId: contents.id, processId: frame.processId, ...frameInfo(frame), url: frame.url, errorOccurred: false, documentLifecycle: 'active', frameType: frame.parent ? 'sub_frame' : 'outermost_frame' }
}

async function onCall(event: IpcMainInvokeEvent, method: unknown, args: unknown): Promise<unknown> {
  const bridge = bridgeForSender(event.sender, event.senderFrame)
  if (!bridge || !bridge.webNavigation) throw new Error('Not available.')
  const input = typeof args === 'object' && args !== null ? args as JsonRecord : {}
  const tabId = typeof input.tabId === 'number' ? input.tabId : -1
  const contents = allWebContents.fromId(tabId)
  if (!contents || contents.isDestroyed() || contents.session !== bridge.session || !bridge.isTab(contents)) return null
  const frames = contents.mainFrame.framesInSubtree
  if (method === 'webNavigation.getAllFrames') return frames.map((frame) => frameDetails(contents, frame))
  if (method === 'webNavigation.getFrame') {
    const frameId = typeof input.frameId === 'number' ? input.frameId : 0
    const frame = frames.find((candidate) => frameInfo(candidate).frameId === frameId)
    return frame ? frameDetails(contents, frame) : null
  }
  throw new Error('Unsupported bridge call.')
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on(BRIDGE_UP_CHANNEL, onUp)
  ipcMain.handle(BRIDGE_CALL_CHANNEL, onCall)
}

// ---------------------------------------------------------------------------
// webNavigation events from tabs

function dispatch(contents: WebContents, name: string, details: JsonRecord): void {
  if (bridges.size === 0) return
  let isTab: boolean | null = null
  for (const bridge of bridges.values()) {
    if (!bridge.webNavigation || contents.session !== bridge.session) continue
    isTab ??= bridge.isTab(contents)
    if (!isTab) return
    send(bridge, { type: 'event', name, details: { tabId: contents.id, timeStamp: Date.now(), ...details } })
  }
}

function frameFromIds(processId: number, routingId: number): WebFrameMain | undefined {
  try {
    return webFrameMain.fromId(processId, routingId)
  } catch {
    return undefined
  }
}

function isTrackedUrl(url: string): boolean {
  return !/^(?:chrome-extension|devtools|chrome):/i.test(url)
}

function watchContents(contents: WebContents): void {
  if (watchedContents.has(contents)) return
  watchedContents.add(contents)
  const lastUrlByFrame = new Map<number, string>()
  contents.on('did-start-navigation', (details) => {
    if (details.isSameDocument || !isTrackedUrl(details.url)) return
    const frame = details.frame
    dispatch(contents, 'onBeforeNavigate', { url: details.url, processId: -1, ...frameInfo(frame ?? null), parentDocumentId: undefined, frameType: details.isMainFrame ? 'outermost_frame' : 'sub_frame' })
  })
  contents.on('did-frame-navigate', (_event, url, _code, _status, isMainFrame, processId, routingId) => {
    if (!isTrackedUrl(url)) return
    const frame = isMainFrame ? contents.mainFrame : frameFromIds(processId, routingId)
    const ids = isMainFrame ? { frameId: 0, parentFrameId: -1 } : frameInfo(frame)
    lastUrlByFrame.set(ids.frameId, url)
    dispatch(contents, 'onCommitted', { url, processId, ...ids, transitionType: 'link', transitionQualifiers: [], frameType: isMainFrame ? 'outermost_frame' : 'sub_frame', documentLifecycle: 'active' })
  })
  contents.on('frame-created', (_event, { frame }) => {
    if (!frame) return
    frame.on('dom-ready', () => {
      if (frame.isDestroyed?.() || !isTrackedUrl(frame.url)) return
      dispatch(contents, 'onDOMContentLoaded', { url: frame.url, processId: frame.processId, ...frameInfo(frame), frameType: 'sub_frame', documentLifecycle: 'active' })
    })
  })
  contents.on('dom-ready', () => {
    const url = contents.getURL()
    if (!isTrackedUrl(url)) return
    dispatch(contents, 'onDOMContentLoaded', { url, processId: contents.mainFrame.processId, frameId: 0, parentFrameId: -1, frameType: 'outermost_frame', documentLifecycle: 'active' })
  })
  contents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
    const frame = isMainFrame ? contents.mainFrame : frameFromIds(processId, routingId)
    if (!frame || !isTrackedUrl(frame.url)) return
    dispatch(contents, 'onCompleted', { url: frame.url, processId, ...(isMainFrame ? { frameId: 0, parentFrameId: -1 } : frameInfo(frame)), frameType: isMainFrame ? 'outermost_frame' : 'sub_frame', documentLifecycle: 'active' })
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame, processId, routingId) => {
    if (!isTrackedUrl(validatedURL)) return
    const ids = isMainFrame ? { frameId: 0, parentFrameId: -1 } : frameInfo(frameFromIds(processId, routingId))
    const error = errorDescription ? (errorDescription.startsWith('net::') ? errorDescription : `net::${errorDescription}`) : `net::ERR_FAILED (${errorCode})`
    dispatch(contents, 'onErrorOccurred', { url: validatedURL, processId, ...ids, error, frameType: isMainFrame ? 'outermost_frame' : 'sub_frame' })
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame, processId, routingId) => {
    if (!isTrackedUrl(url)) return
    const ids = isMainFrame ? { frameId: 0, parentFrameId: -1 } : frameInfo(frameFromIds(processId, routingId))
    const previous = lastUrlByFrame.get(ids.frameId)
    lastUrlByFrame.set(ids.frameId, url)
    const fragmentOnly = previous !== undefined && previous.split('#')[0] === url.split('#')[0]
    dispatch(contents, fragmentOnly ? 'onReferenceFragmentUpdated' : 'onHistoryStateUpdated', { url, processId, ...ids, transitionType: 'link', transitionQualifiers: [], frameType: isMainFrame ? 'outermost_frame' : 'sub_frame' })
  })
  contents.once('destroyed', () => forgetExtensionDnrTab(contents.id))
}

function hookContents(session: Electron.Session): void {
  if (contentsHooked) return
  contentsHooked = true
  // Listeners are cheap (they return at once while no bridge wants events); attach to every page in the session.
  for (const contents of allWebContents.getAllWebContents()) {
    if (contents.session === session) watchContents(contents)
  }
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session === session) watchContents(contents)
  })
}

// ---------------------------------------------------------------------------
// Lifecycle

/** Start (or restart) the bridge page for a loaded extension. No-op when it needs neither feature. */
export function startExtensionBridge(options: BridgeOptions): void {
  stopExtensionBridge(options.id)
  if (!options.webNavigation && !options.dnr) return
  registerIpc()
  if (options.webNavigation) hookContents(options.session)
  const view = new WebContentsView({
    webPreferences: {
      session: options.session,
      // Hidden bridge page, never on screen: no wake locks.
      disableWakeLocks: true,
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  const bridge: Bridge = { ...options, view, ready: false, queue: [], reloads: new RecoveryBudget(BRIDGE_RELOAD_LIMIT, BRIDGE_RELOAD_WINDOW_MS) }
  bridges.set(options.id, bridge)
  const contents = view.webContents
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('render-process-gone', () => {
    // Reload the relay once the renderer is gone (e.g. extension process crash).
    if (bridges.get(options.id) !== bridge) return
    bridge.ready = false
    if (!bridge.reloads.tryTake()) {
      // Crash loop: stop reloading; the bridge comes back when the extension is reloaded or re-enabled.
      console.warn(`[extensions] the Surffish bridge for ${options.id} keeps crashing (${BRIDGE_RELOAD_LIMIT} times in ${BRIDGE_RELOAD_WINDOW_MS / 1000} s); not reloading it again`)
      return
    }
    setTimeout(() => {
      if (bridges.get(options.id) === bridge && !contents.isDestroyed()) void contents.loadURL(`${options.extensionUrl}${EXTENSION_BRIDGE_PAGE}`).catch(() => {})
    }, 1000)
  })
  void contents.loadURL(`${options.extensionUrl}${EXTENSION_BRIDGE_PAGE}`).catch((error: unknown) => {
    console.warn(`[extensions] could not start the Surffish bridge for ${options.id}:`, error instanceof Error ? error.message : error)
  })
}

export function stopExtensionBridge(id: string): void {
  const bridge = bridges.get(id)
  if (!bridge) return
  bridges.delete(id)
  const contents = bridge.view.webContents
  if (!contents.isDestroyed()) contents.close()
}

export function disposeExtensionBridges(): void {
  for (const id of [...bridges.keys()]) stopExtensionBridge(id)
}
