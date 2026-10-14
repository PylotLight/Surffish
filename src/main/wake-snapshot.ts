import { ipcMain, type BaseWindow, type NativeImage, type WebContents } from 'electron'
import {
  nextWakeSnapshotPhase,
  parseWakeSnapshotInput,
  WAKE_SNAPSHOT_FADE_CHANNEL,
  WAKE_SNAPSHOT_FADE_MS,
  WAKE_SNAPSHOT_FADED_CHANNEL,
  WAKE_SNAPSHOT_HIDE_CHANNEL,
  WAKE_SNAPSHOT_INPUT_CHANNEL,
  WAKE_SNAPSHOT_JPEG_QUALITY,
  WAKE_SNAPSHOT_LOAD_GRACE_MS,
  WAKE_SNAPSHOT_MAX_SHOW_MS,
  WAKE_SNAPSHOT_SHOW_CHANNEL,
  WakeSnapshotStore,
  wakeSnapshotFits,
  wakeSnapshotMatchesUrl,
  wakeSnapshotWidth,
  type WakeSnapshotEvent,
  type WakeSnapshotInput,
  type WakeSnapshotPhase,
  type WakeSnapshotShowMessage
} from '../shared/wake-snapshot'
import { getOverlayToolbarContents, setPageCoverLostListener, setToolbarPageCover } from './browser-shell'

/**
 * Wake snapshots (rules in shared/wake-snapshot.ts): the last on-screen picture of a tab, shown by
 * the toolbar surface over the page area while a sleeping/discarded tab reloads, cross-faded out
 * on the page's first contentful paint. In memory only, capped, dropped on use and on close.
 */

interface StoredSnapshot {
  jpeg: Buffer
  /** Page area (DIP) when it was taken. */
  width: number
  height: number
  url: string
  isPrivate: boolean
  bytes: number
}

interface Presentation {
  token: number
  window: BaseWindow
  tabId: string
  page: WebContents
  toolbar: WebContents
  rect: { x: number; y: number; width: number; height: number }
  phase: WakeSnapshotPhase
  /** A press went to the page through the toolbar: keep covering until its release, so the drag/click stays whole. */
  pointerHeld: boolean
  timers: Set<ReturnType<typeof setTimeout>>
  cleanup: () => void
}

const store = new WakeSnapshotStore<StoredSnapshot>()
const presentations = new Map<BaseWindow, Presentation>()
let nextToken = 1
let shownCount = 0
let registered = false
const DEBUG = process.env.SURFFISH_WAKE_SNAPSHOT_DEBUG === '1'

// Paint timing from an isolated world (pages can't fake or break it). Resolves true on the first
// contentful paint, false when none comes before the cap.
const FIRST_PAINT_SCRIPT = `new Promise((resolve) => {
  let observer = null
  const done = (value) => { try { observer && observer.disconnect() } catch {} resolve(value) }
  try {
    if (performance.getEntriesByName('first-contentful-paint').length > 0) return resolve(true)
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name === 'first-contentful-paint')) done(true)
    })
    observer.observe({ type: 'paint', buffered: true })
  } catch { return resolve(false) }
  setTimeout(() => done(false), ${WAKE_SNAPSHOT_MAX_SHOW_MS})
})`
const PAINT_WORLD_ID = 1907

/**
 * Keep the picture a tab had when it left the screen (`image` is the capture the tab overview
 * thumbnail was made from, so this costs one resize + JPEG encode, no extra capture).
 */
export function rememberWakeSnapshot(tabId: string, image: NativeImage, pageSize: { width: number; height: number }, url: string, isPrivate: boolean): void {
  try {
    if (image.isEmpty() || !(pageSize.width > 0 && pageSize.height > 0)) return
    const size = image.getSize()
    const width = wakeSnapshotWidth(size.width)
    const scaled = width < size.width ? image.resize({ width, quality: 'good' }) : image
    const jpeg = scaled.toJPEG(WAKE_SNAPSHOT_JPEG_QUALITY)
    const kept = store.set(tabId, { jpeg, width: pageSize.width, height: pageSize.height, url, isPrivate, bytes: jpeg.length })
    if (DEBUG) console.info(`[wake-snapshot] ${kept ? 'kept' : 'dropped'} ${tabId} ${width}px ${Math.round(jpeg.length / 1024)} KB (total ${Math.round(store.totalBytes / 1024)} KB)`)
  } catch (error) {
    console.warn('[wake-snapshot] could not keep a snapshot:', error)
  }
}

export function dropWakeSnapshot(tabId: string): void {
  store.delete(tabId)
}

/** Private browsing ended: nothing from it may outlive it. */
export function dropPrivateWakeSnapshots(): void {
  store.deleteWhere((entry) => entry.isPrivate)
}

export function hasWakeSnapshot(tabId: string): boolean {
  return store.has(tabId)
}

/** Diagnostics / smokes: how many snapshots are held and their total size. */
export function getWakeSnapshotStats(): { count: number; bytes: number; shown: number; showing: number } {
  return { count: store.size, bytes: store.totalBytes, shown: shownCount, showing: presentations.size }
}

function clearTimers(presentation: Presentation): void {
  for (const timer of presentation.timers) clearTimeout(timer)
  presentation.timers.clear()
}

function later(presentation: Presentation, ms: number, run: () => void): void {
  const timer = setTimeout(() => {
    presentation.timers.delete(timer)
    run()
  }, ms)
  presentation.timers.add(timer)
}

function finish(presentation: Presentation): void {
  if (presentations.get(presentation.window) !== presentation) return
  presentations.delete(presentation.window)
  clearTimers(presentation)
  presentation.cleanup()
  presentation.phase = 'gone'
  if (!presentation.toolbar.isDestroyed()) presentation.toolbar.send(WAKE_SNAPSHOT_HIDE_CHANNEL, presentation.token)
  if (!presentation.window.isDestroyed()) setToolbarPageCover(presentation.window, false)
}

function advance(presentation: Presentation, event: WakeSnapshotEvent): void {
  if (presentations.get(presentation.window) !== presentation) return
  const next = nextWakeSnapshotPhase(presentation.phase, event)
  if (next === presentation.phase) return
  if (next === 'gone') {
    // A press on its way to the page keeps the cover (not the picture) until its release.
    if (presentation.pointerHeld && event === 'input') {
      presentation.phase = 'fading'
      if (!presentation.toolbar.isDestroyed()) presentation.toolbar.send(WAKE_SNAPSHOT_HIDE_CHANNEL, presentation.token)
      return
    }
    finish(presentation)
    return
  }
  presentation.phase = next
  if (!presentation.toolbar.isDestroyed()) presentation.toolbar.send(WAKE_SNAPSHOT_FADE_CHANNEL, presentation.token)
  // The renderer reports the end of the fade; never rely on it alone.
  later(presentation, WAKE_SNAPSHOT_FADE_MS + 400, () => { if (!presentation.pointerHeld) finish(presentation) })
}

/** Tab switched away, closed, or the page area changed: take the picture down at once. */
export function endWakeSnapshot(window: BaseWindow, unlessTabId?: string): void {
  const presentation = presentations.get(window)
  if (!presentation || presentation.tabId === unlessTabId) return
  presentation.pointerHeld = false
  finish(presentation)
}

export function endWakeSnapshotForTab(tabId: string): void {
  for (const presentation of [...presentations.values()]) {
    if (presentation.tabId === tabId) {
      presentation.pointerHeld = false
      finish(presentation)
    }
  }
}

function watchFirstPaint(presentation: Presentation): () => void {
  const { page } = presentation
  let probing = false
  const probe = (): void => {
    if (probing || page.isDestroyed() || presentations.get(presentation.window) !== presentation) return
    probing = true
    void page.executeJavaScriptInIsolatedWorld(PAINT_WORLD_ID, [{ code: FIRST_PAINT_SCRIPT }])
      .then((painted: unknown) => {
        probing = false
        if (painted === true) advance(presentation, 'painted')
      }, () => {
        // The document went away under the probe (redirect, replaced load): the next commit asks again.
        probing = false
      })
  }
  const onNavigate = (): void => probe()
  const onDomReady = (): void => probe()
  const onFinish = (): void => later(presentation, WAKE_SNAPSHOT_LOAD_GRACE_MS, () => advance(presentation, 'loaded'))
  const onFail = (_event: Electron.Event, errorCode: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (isMainFrame && errorCode !== -3) advance(presentation, 'failed')
  }
  const onGone = (): void => advance(presentation, 'failed')
  page.on('did-navigate', onNavigate)
  page.on('dom-ready', onDomReady)
  page.on('did-finish-load', onFinish)
  page.on('did-fail-load', onFail)
  page.on('render-process-gone', onGone)
  page.on('destroyed', onGone)
  return () => {
    if (page.isDestroyed()) return
    page.off('did-navigate', onNavigate)
    page.off('dom-ready', onDomReady)
    page.off('did-finish-load', onFinish)
    page.off('did-fail-load', onFail)
    page.off('render-process-gone', onGone)
    page.off('destroyed', onGone)
  }
}

/**
 * A sleeping tab was just woken on screen (its new view is attached and loading `targetUrl`):
 * show its snapshot over the page area until the page paints. False when there is nothing fit to
 * show (no snapshot, another page, a different page-area size, New Tab/a panel on screen).
 */
export function presentWakeSnapshot(window: BaseWindow, tabId: string, page: WebContents, rect: { x: number; y: number; width: number; height: number }, targetUrl: string): boolean {
  endWakeSnapshot(window)
  const snapshot = store.take(tabId)
  const skip = (reason: string): false => {
    if (DEBUG) console.info(`[wake-snapshot] not shown for ${tabId}: ${reason}`)
    return false
  }
  if (!snapshot) return skip('no snapshot')
  if (page.isDestroyed() || window.isDestroyed()) return skip('page or window gone')
  if (!wakeSnapshotMatchesUrl(snapshot.url, targetUrl)) return skip(`another page (${snapshot.url} vs ${targetUrl})`)
  if (!wakeSnapshotFits({ width: snapshot.width, height: snapshot.height }, rect)) return skip(`page area changed (${snapshot.width}x${snapshot.height} vs ${rect.width}x${rect.height})`)
  const toolbar = getOverlayToolbarContents(window)
  if (!toolbar) return skip('no overlay toolbar (New Tab or a panel on screen)')
  if (!setToolbarPageCover(window, true)) return skip('could not cover the page area')
  const presentation: Presentation = {
    token: nextToken++,
    window,
    tabId,
    page,
    toolbar,
    rect: { ...rect },
    phase: 'showing',
    pointerHeld: false,
    timers: new Set(),
    cleanup: () => {}
  }
  presentations.set(window, presentation)
  presentation.cleanup = watchFirstPaint(presentation)
  later(presentation, WAKE_SNAPSHOT_MAX_SHOW_MS, () => advance(presentation, 'timeout'))
  const message: WakeSnapshotShowMessage = {
    token: presentation.token,
    src: `data:image/jpeg;base64,${snapshot.jpeg.toString('base64')}`,
    rect: presentation.rect
  }
  toolbar.send(WAKE_SNAPSHOT_SHOW_CHANNEL, message)
  shownCount += 1
  return true
}

function forwardToPage(presentation: Presentation, input: WakeSnapshotInput): void {
  const { page, rect } = presentation
  if (page.isDestroyed()) return
  if (input.kind === 'key') {
    page.focus()
    return
  }
  const x = Math.round(input.x - rect.x)
  const y = Math.round(input.y - rect.y)
  const modifiers = input.modifiers as Electron.MouseInputEvent['modifiers']
  if (input.kind === 'mouseWheel') {
    page.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -input.deltaX, deltaY: -input.deltaY, canScroll: true, modifiers })
    return
  }
  if (input.kind === 'mouseDown') page.focus()
  page.sendInputEvent({ type: input.kind, x, y, button: input.button, clickCount: input.clickCount, modifiers })
}

export function registerWakeSnapshotIpc(): void {
  if (registered) return
  registered = true
  setPageCoverLostListener((window) => {
    const presentation = presentations.get(window)
    if (!presentation) return
    presentation.pointerHeld = false
    finish(presentation)
  })
  ipcMain.on(WAKE_SNAPSHOT_FADED_CHANNEL, (event, token: unknown) => {
    for (const presentation of presentations.values()) {
      if (presentation.token === token && presentation.toolbar === event.sender && !presentation.pointerHeld && presentation.phase === 'fading') {
        advance(presentation, 'faded')
      }
    }
  })
  ipcMain.on(WAKE_SNAPSHOT_INPUT_CHANNEL, (event, token: unknown, raw: unknown) => {
    const presentation = [...presentations.values()].find((candidate) => candidate.token === token && candidate.toolbar === event.sender)
    const input = parseWakeSnapshotInput(raw)
    if (!presentation || !input) return
    if (input.kind === 'mouseDown') presentation.pointerHeld = true
    forwardToPage(presentation, input)
    if (input.kind === 'mouseUp') {
      presentation.pointerHeld = false
      finish(presentation)
      return
    }
    if (input.kind === 'mouseMove') return
    advance(presentation, 'input')
    // A press whose release never reaches us (pointer capture lost) must not keep the cover up.
    if (presentation.pointerHeld) later(presentation, 3000, () => { presentation.pointerHeld = false; finish(presentation) })
  })
}
