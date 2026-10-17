import { powerMonitor, WebContentsView, type BaseWindow, type Rectangle, type Session, type WebContents } from 'electron'
import {
  historyFingerprint,
  PRERENDER_MAX_AGE_MS,
  PRERENDER_MEMORY_SAMPLE_MS,
  prerenderBlockedBy,
  prerenderUrlSkip,
  sameNavigationUrl,
  type PrerenderBlock
} from '../shared/omnibox-prerender'
import { getProxyGuardStatus } from './proxy-kill-switch'

/**
 * Omnibox prerender (rules and the why in shared/omnibox-prerender.ts): at most one hidden page
 * view, loaded in the active tab's session with the tab's own webPreferences and back history, that
 * Enter swaps in (browser.ts adopts the view like a promoted Glance). Cancelled on edit, blur, tab
 * changes and after a minute; never in private tabs, on battery, under memory pressure or while
 * the proxy kill switch holds traffic.
 */

export interface PrerenderTabHistory {
  entries: Electron.NavigationEntry[]
  index: number
}

/** The active tab, as the prerender needs it (browser.ts). */
export interface PrerenderTarget {
  tabId: string
  window: BaseWindow
  session: Session
  isPrivate: boolean
  /** A normal site tab that can take a swapped-in page. */
  eligible: boolean
  webPreferences: Electron.WebPreferences
  bounds: Rectangle
  /** The tab's page (null on the New Tab / Settings tab, which have no page view). */
  contents: WebContents | null
  history: PrerenderTabHistory | null
}

export interface PrerenderHost {
  activeTarget: () => PrerenderTarget | null
  bindToWindow: (contents: WebContents, window: BaseWindow) => void
}

interface Prerender {
  tabId: string
  url: string
  view: WebContentsView
  session: Session
  history: string
  startedAt: number
  loaded: boolean
  failed: boolean
  cleanups: Array<() => void>
}

export interface PrerenderStats {
  started: number
  used: number
  cancelled: number
  /** Hints that matched a URL but were held back, by reason. */
  skipped: Partial<Record<PrerenderBlock, number>>
  active: { url: string; loaded: boolean } | null
}

let host: PrerenderHost | null = null
let active: Prerender | null = null
let wanted: string | null = null
let memory: { at: number; tight: boolean } | null = null
let memorySampling = false
let memorySampler: (() => Promise<boolean>) | null = null
const stats: Omit<PrerenderStats, 'active'> = { started: 0, used: 0, cancelled: 0, skipped: {} }

export function setOmniboxPrerenderHost(next: PrerenderHost | null): void {
  host = next
}

/** How memory pressure is read (memory-saver.ts); unset means never tight. */
export function setPrerenderMemorySampler(sampler: (() => Promise<boolean>) | null): void {
  memorySampler = sampler
}

export function getOmniboxPrerenderStats(): PrerenderStats {
  return { ...stats, skipped: { ...stats.skipped }, active: active ? { url: active.url, loaded: active.loaded } : null }
}

function live(contents: WebContents | null | undefined): contents is WebContents {
  return Boolean(contents && !contents.isDestroyed())
}

function onBattery(): boolean {
  try {
    return powerMonitor.isOnBatteryPower()
  } catch {
    return false
  }
}

function proxyBlocking(): boolean {
  try {
    return getProxyGuardStatus().blocking
  } catch {
    return true
  }
}

/** Last memory reading; refreshed in the background when stale (the first hint after that waits for it). */
function memoryTight(): boolean | null {
  if (!memorySampler) return false
  const now = Date.now()
  if (memory && now - memory.at < PRERENDER_MEMORY_SAMPLE_MS) return memory.tight
  if (!memorySampling) {
    memorySampling = true
    void memorySampler().then((tight) => { memory = { at: Date.now(), tight } }, () => { memory = { at: Date.now(), tight: true } }).finally(() => {
      memorySampling = false
      // The bar still wants this page: try again with the fresh reading.
      if (wanted) startFor(wanted)
    })
  }
  return memory ? memory.tight : null
}

/** Drop the current prerender (its page is closed). */
export function cancelOmniboxPrerender(): void {
  wanted = null
  dropActive()
}

function dropActive(): void {
  const prerender = active
  if (!prerender) return
  active = null
  stats.cancelled += 1
  for (const cleanup of prerender.cleanups.splice(0)) cleanup()
  const contents = prerender.view.webContents
  if (live(contents)) contents.close()
}

/**
 * The address bar's current guess (`omniboxPrerenderUrl`), or null when it has none. A new URL
 * replaces the old prerender (one at a time); the same URL keeps it.
 */
export function hintOmniboxPrerender(url: string | null, enabled: boolean): void {
  if (!url || !enabled) {
    cancelOmniboxPrerender()
    return
  }
  wanted = url
  startFor(url)
}

function startFor(url: string): void {
  const target = host?.activeTarget() ?? null
  if (active && (active.tabId !== target?.tabId || !sameNavigationUrl(active.url, url) || active.failed)) dropActive()
  if (active || !target || prerenderUrlSkip(url)) return
  const tight = memoryTight()
  const blocked = prerenderBlockedBy({
    enabled: true,
    isPrivate: target.isPrivate,
    onBattery: onBattery(),
    memoryTight: tight === true,
    proxyBlocking: proxyBlocking(),
    tabEligible: target.eligible
  })
  if (blocked) {
    stats.skipped[blocked] = (stats.skipped[blocked] ?? 0) + 1
    return
  }
  // No memory reading yet: the sampler's callback retries once it lands.
  if (tight === null) return
  start(target, url)
}

function start(target: PrerenderTarget, url: string): void {
  const view = new WebContentsView({ webPreferences: target.webPreferences })
  view.setBounds(target.bounds)
  view.setVisible(false)
  const contents = view.webContents
  host?.bindToWindow(contents, target.window)
  const prerender: Prerender = {
    tabId: target.tabId,
    url,
    view,
    session: target.session,
    history: historyFingerprint(target.history),
    startedAt: Date.now(),
    loaded: false,
    failed: false,
    cleanups: []
  }
  active = prerender
  stats.started += 1
  const fail = (): void => {
    prerender.failed = true
    if (active === prerender) dropActive()
  }
  const on = (event: string, listener: (...args: never[]) => void): void => {
    contents.on(event as 'did-finish-load', listener as () => void)
    prerender.cleanups.push(() => { if (live(contents)) contents.removeListener(event as 'did-finish-load', listener as () => void) })
  }
  // Hidden until Enter: silent, no popups, nothing but web pages, no downloads.
  contents.setAudioMuted(true)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  on('will-navigate', (event: Electron.Event, next: string) => {
    if (prerenderUrlSkip(next)) {
      event.preventDefault()
      fail()
    }
  })
  on('will-redirect', (event: Electron.Event, next: string, _inPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame && prerenderUrlSkip(next) === 'not-http') {
      event.preventDefault()
      fail()
    }
  })
  on('did-fail-load', (_event: Electron.Event, code: number, _description: string, _url: string, isMainFrame: boolean) => {
    if (isMainFrame && code !== -3) fail()
  })
  on('did-finish-load', () => { prerender.loaded = true })
  on('render-process-gone', fail)
  // A page that turns out to be a download is not a page to swap in. Ahead of the download
  // manager's listener, which skips anything already prevented.
  const onDownload = (event: Electron.Event, _item: Electron.DownloadItem, from: WebContents): void => {
    if (from !== contents) return
    event.preventDefault()
    setImmediate(fail)
  }
  target.session.prependListener('will-download', onDownload)
  prerender.cleanups.push(() => target.session.removeListener('will-download', onDownload))
  // The tab's own page navigating or closing makes the copied history (or the whole guess) stale.
  if (live(target.contents)) {
    const source = target.contents
    const onSourceNavigation = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
      if (isMainFrame && !isInPlace && active === prerender) cancelOmniboxPrerender()
    }
    const onSourceGone = (): void => { if (active === prerender) cancelOmniboxPrerender() }
    source.on('did-start-navigation', onSourceNavigation)
    source.once('destroyed', onSourceGone)
    prerender.cleanups.push(() => {
      if (!live(source)) return
      source.removeListener('did-start-navigation', onSourceNavigation)
      source.removeListener('destroyed', onSourceGone)
    })
  }
  const timer = setTimeout(() => { if (active === prerender) cancelOmniboxPrerender() }, PRERENDER_MAX_AGE_MS)
  timer.unref?.()
  prerender.cleanups.push(() => clearTimeout(timer))
  // Start from the tab's back history, then load the page on top of it: restore() queues the
  // current entry's load and loadURL() replaces it before it leaves, so the result is the tab's
  // entries + this page, and only this page is fetched.
  if (target.history && target.history.entries.length > 0 && target.history.index >= 0) {
    const entries = target.history.entries.slice(0, target.history.index + 1)
    contents.navigationHistory.restore({ entries, index: entries.length - 1 }).catch(() => undefined)
  }
  contents.loadURL(url).catch(() => {
    // Superseded by its own redirect is fine; a real failure already came through did-fail-load.
  })
}

/**
 * Enter: the prerendered view for this tab and URL, handed over (listeners removed, unmuted), or
 * null when there is none, it's for another tab or page, it failed, or the tab's history moved on.
 */
export function takeOmniboxPrerender(tabId: string, url: string, history: PrerenderTabHistory | null): WebContentsView | null {
  const prerender = active
  wanted = null
  if (!prerender) return null
  const contents = prerender.view.webContents
  const usable = prerender.tabId === tabId && sameNavigationUrl(prerender.url, url) && !prerender.failed && live(contents) && !contents.isCrashed() &&
    prerender.history === historyFingerprint(history)
  if (!usable) {
    dropActive()
    return null
  }
  active = null
  for (const cleanup of prerender.cleanups.splice(0)) cleanup()
  contents.setAudioMuted(false)
  stats.used += 1
  return prerender.view
}
