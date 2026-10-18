import { app, ipcMain, webContents as allWebContents, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { CAST_SETTINGS_FILE, isCastableNetworkHit, parseCastSettings, type CastSettings, type CastSnapshot, type NetworkMediaHit } from '../shared/cast'
import { getBrowserActiveTabId, getBrowserTabWebContents } from './browser'
import { isMainWindowRenderer, sendToMainWindowRenderers, sendToVisibleToolbarSurface } from './browser-shell'
import { getEffectiveRoute } from './proxy'
import { addRequestGate } from './request-gate'
import { readUserJson, writeSettingsFile } from './user-json'

/**
 * Cast entry point: what main loads at startup for casting (settings, IPC, the per-tab media URL
 * recorder and the ⌘K hooks). The session manager (discovery, CASTV2, the media probe) is
 * src/main/cast.ts, a lazy chunk imported the first time the picker opens or the short startup
 * scan runs.
 *
 * Discovery is never continuous: one ~4 s mDNS browse ~15 s after launch (and again at
 * most every 15 min when a page starts playing media) tells the toolbar whether a Chromecast is around; the picker browses while it
 * is open. Off in Settings: no button, no commands, no scans, no recorder.
 */

type CastModule = typeof import('./cast')

const STARTUP_SCAN_DELAY_MS = 15_000
const RESCAN_INTERVAL_MS = 15 * 60_000
/** Media URLs remembered per page (newest last). */
const HITS_PER_PAGE = 12

let settings: CastSettings | null = null
let manager: import('./cast').CastManager | null = null
let loading: Promise<import('./cast').CastManager> | null = null
let lastSnapshot: CastSnapshot = { enabled: true, scanning: false, devices: [], session: null }
let lastScanAt = 0
let removeGate: (() => void) | null = null
const hits = new Map<number, NetworkMediaHit[]>()

function current(): CastSettings {
  settings ??= parseCastSettings(readUserJson(CAST_SETTINGS_FILE))
  return settings
}

export function castEnabled(): boolean {
  return current().enabled
}

function emit(snapshot: CastSnapshot): void {
  lastSnapshot = snapshot
  try { sendToMainWindowRenderers('browser:cast:state', snapshot) } catch { /* window closing */ }
}

function loadManager(): Promise<import('./cast').CastManager> {
  if (manager) return Promise.resolve(manager)
  loading ??= import('./cast').then((module: CastModule) => {
    manager = new module.CastManager({
      emit,
      enabled: castEnabled,
      tabContents: (tabId) => getBrowserTabWebContents(tabId),
      networkHits: (contents) => hits.get(contents.id)?.slice() ?? []
    })
    return manager
  })
  return loading
}

function recordHit(details: Electron.OnBeforeRequestListenerDetails): null {
  const id = details.webContentsId
  if (id === undefined || (details.resourceType !== 'media' && details.resourceType !== 'xhr' && details.resourceType !== 'other')) return null
  if (!isCastableNetworkHit(details.url, details.resourceType)) return null
  let list = hits.get(id)
  if (!list) {
    list = []
    hits.set(id, list)
    const contents = allWebContents.fromId(id)
    contents?.once('destroyed', () => hits.delete(id))
    // A new page's media replaces the old page's.
    contents?.on('did-start-navigation', (event) => { if (event.isMainFrame && !event.isSameDocument) hits.delete(id) })
  }
  if (!list.some((hit) => hit.url === details.url)) {
    list.push({ url: details.url.slice(0, 4096), resourceType: details.resourceType })
    if (list.length > HITS_PER_PAGE) list.shift()
  }
  return null
}

function applyRecorder(): void {
  if (castEnabled() && !removeGate) removeGate = addRequestGate(recordHit)
  else if (!castEnabled() && removeGate) {
    removeGate()
    removeGate = null
    hits.clear()
  }
}

function scan(): void {
  if (!castEnabled()) return
  lastScanAt = Date.now()
  void loadManager().then((loaded) => loaded.scanBriefly())
}

export function getCastSettings(): CastSettings {
  return { ...current() }
}

export function setCastSettings(input: unknown): CastSettings {
  const next = parseCastSettings(typeof input === 'object' && input !== null ? input : {}, current())
  settings = next
  writeSettingsFile(CAST_SETTINGS_FILE, next)
  applyRecorder()
  if (!next.enabled) manager?.shutdown()
  emit(manager ? manager.snapshot() : { ...lastSnapshot, enabled: next.enabled, scanning: false })
  try { sendToMainWindowRenderers('browser:cast:settings-changed', { ...next }) } catch { /* window closing */ }
  return { ...next }
}

/** ⌘K: is there a cast to stop? */
export function isCasting(): boolean {
  return lastSnapshot.session !== null
}

/** ⌘K "Cast…": shows the toolbar picker (which starts browsing). */
export function openCastPicker(): void {
  if (!castEnabled()) return
  sendToVisibleToolbarSurface('browser:cast:show')
}

export function stopCasting(): void {
  void manager?.stop()
}

function fromAppWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWindowRenderer(event.sender, event.senderFrame)
}

function guard(event: IpcMainInvokeEvent): void {
  if (!fromAppWindow(event)) throw new Error('Casting is available only to the app window.')
}

function tabOrActive(tabId: unknown): string | null {
  return typeof tabId === 'string' && tabId ? tabId : getBrowserActiveTabId()
}

function proxiedFor(contents: WebContents): boolean {
  try {
    return getEffectiveRoute(contents.getURL(), contents.session)?.kind === 'proxy'
  } catch {
    return false
  }
}

/** Startup: settings, IPC, recorder and the deferred short scan. Loads nothing heavy. */
export function registerCastIpc(): void {
  lastSnapshot = { ...lastSnapshot, enabled: castEnabled() }
  applyRecorder()
  ipcMain.handle('browser:cast:get-settings', () => getCastSettings())
  ipcMain.handle('browser:cast:set-settings', (event, input: unknown) => {
    guard(event)
    return setCastSettings(input)
  })
  ipcMain.handle('browser:cast:snapshot', () => (manager ? manager.snapshot() : lastSnapshot))
  ipcMain.handle('browser:cast:picker', async (event, open: unknown) => {
    guard(event)
    if (!castEnabled()) return lastSnapshot
    if (open !== true && !manager) return lastSnapshot
    const loaded = await loadManager()
    loaded.setPickerOpen(open === true)
    return loaded.snapshot()
  })
  ipcMain.handle('browser:cast:probe', async (event, tabId: unknown) => {
    guard(event)
    const id = tabOrActive(tabId)
    const contents = id ? getBrowserTabWebContents(id) : null
    if (!castEnabled() || !contents) return null
    const loaded = await loadManager()
    const { choice } = await loaded.probe(contents)
    return { choice, proxied: proxiedFor(contents) }
  })
  ipcMain.handle('browser:cast:cast-media', async (event, deviceId: unknown, tabId: unknown) => {
    guard(event)
    const id = tabOrActive(tabId)
    if (!castEnabled() || typeof deviceId !== 'string' || !id) return { ok: false, error: 'Nothing to cast.' }
    return (await loadManager()).castMedia(deviceId, id)
  })
  ipcMain.handle('browser:cast:control', async (event, action: unknown, value: unknown) => {
    guard(event)
    if (!manager || typeof action !== 'string') return false
    if (action === 'stop') {
      await manager.stop()
      return true
    }
    return manager.control(action, typeof value === 'number' ? value : undefined)
  })
  if (castEnabled()) setTimeout(scan, STARTUP_SCAN_DELAY_MS).unref?.()
  // A page starting a video is when a cast is likely: look again (at most every 15 min).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('media-started-playing', () => {
      if (Date.now() - lastScanAt > RESCAN_INTERVAL_MS) scan()
    })
  })
  app.on('before-quit', () => manager?.shutdown())
}

