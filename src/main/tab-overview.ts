import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebContentsView, ipcMain, type BaseWindow, type IpcMainEvent } from 'electron'
import type { BrowserBounds } from '../shared/types'
import { TAB_OVERVIEW_HTML } from './tab-overview-page'
import { bindContentsToWindow, currentBrowserWindow } from './window-scope'

export interface TabOverviewItem {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  active: boolean
  pinned: boolean
  sleeping: boolean
  /** The local New Tab page rather than a site. */
  newTab: boolean
  thumbnail: string | null
}

export interface TabOverviewHost {
  getItems(): Promise<TabOverviewItem[]> | TabOverviewItem[]
  getPageBounds(): BrowserBounds
  activate(id: string): void
  closeTab(id: string): void
  newTab(): void
  /** Hand keyboard focus back to the page once the overview is gone. */
  focusPage(): void
  /** Run a Cmd/Ctrl shortcut the browser normally handles (new tab, close tab, ...). */
  handleShortcut(input: Electron.Input): boolean
}

/** closed → opening (pinch or animation in flight) → open (grid settled) → closing → closed */
export type TabOverviewState = 'closed' | 'opening' | 'open' | 'closing'

const OPEN_DURATION_MS = 520
const CLOSE_DURATION_MS = 480
// If the page never reports back (crash, reload), don't leave an invisible layer over the window.
const SETTLE_FALLBACK_MS = 2000

/** One overview per window, stacked above everything in that window. */
interface TabOverview {
  window: BaseWindow
  host: TabOverviewHost
  view: WebContentsView | null
  ready: Promise<void> | null
  state: TabOverviewState
  shown: boolean
  latestProgress: number
  pendingSettle: { open: boolean; targetId?: string; refocus: boolean } | null
  refocusOnClose: boolean
  fallbackTimer: ReturnType<typeof setTimeout> | null
  lastItems: TabOverviewItem[]
  selectedId: string | null
  preloadTimer: ReturnType<typeof setTimeout> | null
  onResize: () => void
}

const overviews = new Map<BaseWindow, TabOverview>()
let ipcRegistered = false

function overviewFor(window?: BaseWindow | null): TabOverview | null {
  const target = window ?? currentBrowserWindow()
  const overview = target ? overviews.get(target) : undefined
  if (overview && !overview.window.isDestroyed()) return overview
  if (!window && overviews.size === 1) {
    const [only] = overviews.values()
    if (only && !only.window.isDestroyed()) return only
  }
  return null
}

function preloadPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../preload/tab-overview.cjs')
  return existsSync(path) ? path : null
}

function fullBounds(overview: TabOverview): BrowserBounds {
  if (overview.window.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 }
  const [width = 0, height = 0] = overview.window.getContentSize()
  return { x: 0, y: 0, width, height }
}

function liveView(overview: TabOverview): WebContentsView | null {
  return overview.view && !overview.view.webContents.isDestroyed() ? overview.view : null
}

function fromOverview(event: IpcMainEvent): TabOverview | null {
  for (const overview of overviews.values()) {
    const current = liveView(overview)
    if (current && event.sender === current.webContents) return overview
  }
  return null
}

function activeItemId(overview: TabOverview): string | undefined {
  return overview.lastItems.find((item) => item.active)?.id
}

function clearFallback(overview: TabOverview): void {
  if (overview.fallbackTimer) clearTimeout(overview.fallbackTimer)
  overview.fallbackTimer = null
}

function hideNow(overview: TabOverview): void {
  clearFallback(overview)
  const refocus = overview.refocusOnClose
  overview.state = 'closed'
  overview.shown = false
  overview.pendingSettle = null
  overview.refocusOnClose = true
  const current = liveView(overview)
  if (current) {
    current.setVisible(false)
    current.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
  if (refocus) overview.host.focusPage()
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('tab-overview:ready', (event) => {
    const overview = fromOverview(event)
    if (!overview) return
    if (overview.pendingSettle) {
      const { open, targetId, refocus } = overview.pendingSettle
      overview.pendingSettle = null
      settleTabOverview(open, targetId, refocus, overview.window)
    }
  })
  ipcMain.on('tab-overview:settled', (event, open: unknown) => {
    const overview = fromOverview(event)
    if (!overview) return
    if (open === true) {
      if (overview.state === 'opening') overview.state = 'open'
      liveView(overview)?.webContents.focus()
    } else if (overview.state === 'closing') {
      hideNow(overview)
    }
  })
  ipcMain.on('tab-overview:selected', (event, id: unknown) => {
    const overview = fromOverview(event)
    if (!overview) return
    overview.selectedId = typeof id === 'string' && overview.lastItems.some((item) => item.id === id) ? id : null
  })
  ipcMain.on('tab-overview:activate', (event, id: unknown) => {
    const overview = fromOverview(event)
    if (!overview || typeof id !== 'string' || overview.state !== 'open') return
    overview.host.activate(id)
    closeTabOverview(id, true, overview.window)
  })
  ipcMain.on('tab-overview:close-tab', (event, id: unknown) => {
    const overview = fromOverview(event)
    if (!overview || typeof id !== 'string' || overview.state !== 'open') return
    overview.host.closeTab(id)
    void refreshTabOverview(overview.window)
  })
  ipcMain.on('tab-overview:new-tab', (event) => {
    const overview = fromOverview(event)
    if (!overview || overview.state !== 'open') return
    closeTabOverview(undefined, false, overview.window)
    overview.host.newTab()
  })
  ipcMain.on('tab-overview:dismiss', (event) => {
    const overview = fromOverview(event)
    if (!overview || overview.state !== 'open') return
    closeTabOverview(activeItemId(overview), true, overview.window)
  })
}

function ensureView(overview: TabOverview): WebContentsView | null {
  if (overview.window.isDestroyed()) return null
  const existing = liveView(overview)
  if (existing) return existing
  const preload = preloadPath()
  if (!preload) {
    console.warn('[tab overview] preload missing; overview unavailable')
    return null
  }
  const view = new WebContentsView({
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
      backgroundThrottling: false
    }
  })
  overview.view = view
  view.setBackgroundColor('#00000000')
  view.setVisible(false)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event) => event.preventDefault())
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return
    const key = input.key.toLowerCase()
    // Never let Cmd+W fall through to the default menu's Close Window, even if this view still
    // holds focus after the overview closed.
    if (overview.state === 'open' && key === 'w') {
      event.preventDefault()
      if (overview.selectedId) {
        overview.host.closeTab(overview.selectedId)
        void refreshTabOverview(overview.window)
      }
      return
    }
    if (overview.state === 'open' && input.shift && (key === '\\' || key === '|')) {
      event.preventDefault()
      closeTabOverview(undefined, true, overview.window)
      return
    }
    if (overview.host.handleShortcut(input) || key === 'w') event.preventDefault()
  })
  view.webContents.on('render-process-gone', () => {
    if (overview.state !== 'closed') hideNow(overview)
    if (overview.view === view) {
      overview.view = null
      overview.ready = null
    }
  })
  bindContentsToWindow(view.webContents, overview.window)
  // Not attached to the window yet: openTabOverview adds it on top when it opens. A WebContentsView
  // attached while its first page loads takes keyboard focus even when hidden (seen on Linux), so
  // the 1.5 s preload used to steal focus from whatever the user was typing in (the address bar).
  overview.ready = view.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TAB_OVERVIEW_HTML)}`)
    .catch((error: unknown) => console.error('[tab overview] could not load:', error))
  return view
}

export function attachTabOverview(win: BaseWindow, overviewHost: TabOverviewHost): void {
  detachTabOverview(win)
  const overview: TabOverview = {
    window: win,
    host: overviewHost,
    view: null,
    ready: null,
    state: 'closed',
    shown: false,
    latestProgress: 0,
    pendingSettle: null,
    refocusOnClose: true,
    fallbackTimer: null,
    lastItems: [],
    selectedId: null,
    preloadTimer: null,
    onResize: () => {
      const current = liveView(overview)
      if (overview.state !== 'closed' && current) current.setBounds(fullBounds(overview))
    }
  }
  overviews.set(win, overview)
  registerIpc()
  win.on('resize', overview.onResize)
  // Load it ahead of time so the first pinch responds instantly.
  overview.preloadTimer = setTimeout(() => {
    overview.preloadTimer = null
    if (overviews.get(win) === overview) ensureView(overview)
  }, 1500)
}

export function detachTabOverview(win?: BaseWindow): void {
  const overview = win ? overviews.get(win) : overviewFor()
  if (!overview) return
  overviews.delete(overview.window)
  clearFallback(overview)
  if (overview.preloadTimer) clearTimeout(overview.preloadTimer)
  overview.preloadTimer = null
  if (!overview.window.isDestroyed()) overview.window.removeListener('resize', overview.onResize)
  liveView(overview)?.webContents.close()
  overview.view = null
  overview.ready = null
  overview.state = 'closed'
  overview.shown = false
  overview.pendingSettle = null
}

export function getTabOverviewState(window?: BaseWindow | null): TabOverviewState {
  return overviewFor(window)?.state ?? 'closed'
}

export function isTabOverviewOpen(window?: BaseWindow | null): boolean {
  return getTabOverviewState(window) !== 'closed'
}

/**
 * Show the overview. Interactive opens start at progress 0 (the active tab's thumbnail sitting
 * exactly over the page) and follow setTabOverviewProgress until settleTabOverview; otherwise it
 * animates in on its own.
 */
export async function openTabOverview(options: { interactive?: boolean } = {}, window?: BaseWindow | null): Promise<void> {
  const overview = overviewFor(window)
  if (!overview || overview.state !== 'closed') return
  const view = ensureView(overview)
  if (!view) return
  overview.state = 'opening'
  overview.shown = false
  overview.pendingSettle = null
  overview.latestProgress = 0
  overview.refocusOnClose = true
  clearFallback(overview)
  const [items] = await Promise.all([overview.host.getItems(), overview.ready])
  if ((overview.state as TabOverviewState) === 'closed' || view.webContents.isDestroyed() || overviews.get(overview.window) !== overview) return
  overview.lastItems = items
  overview.selectedId = activeItemId(overview) ?? null
  // (Re)appended on every open, so it sits above the shell surfaces and every site view, including
  // ones added since it was loaded (adding an existing child moves it to the top).
  overview.window.contentView.addChildView(view)
  view.setBounds(fullBounds(overview))
  view.setVisible(true)
  view.webContents.send('tab-overview:show', {
    items,
    pageBounds: overview.host.getPageBounds(),
    progress: options.interactive ? overview.latestProgress : 0,
    animate: !options.interactive && !overview.pendingSettle
  })
  overview.shown = true
  view.webContents.focus()
}

export function setTabOverviewProgress(progress: number, window?: BaseWindow | null): void {
  const overview = overviewFor(window)
  if (!overview || overview.state === 'closed' || !Number.isFinite(progress)) return
  overview.latestProgress = progress
  if (overview.shown) liveView(overview)?.webContents.send('tab-overview:progress', progress)
}

/** Finish an interactive pinch (or any close): animate to the grid (open) or back to the page. */
export function settleTabOverview(open: boolean, targetId?: string, refocus = true, window?: BaseWindow | null): void {
  const overview = overviewFor(window)
  if (!overview || overview.state === 'closed') return
  const current = liveView(overview)
  if (!current) {
    hideNow(overview)
    return
  }
  if (!overview.shown) {
    // Released before the first frame was even up: a close just never shows it, an open is
    // replayed once the page reports ready.
    if (!open) {
      overview.refocusOnClose = refocus
      hideNow(overview)
      return
    }
    overview.pendingSettle = { open, targetId, refocus }
    return
  }
  overview.state = open ? 'opening' : 'closing'
  if (!open) overview.refocusOnClose = refocus
  current.webContents.send('tab-overview:settle', { open, targetId, duration: open ? OPEN_DURATION_MS : CLOSE_DURATION_MS })
  clearFallback(overview)
  if (!open) overview.fallbackTimer = setTimeout(() => { if (overview.state === 'closing') hideNow(overview) }, SETTLE_FALLBACK_MS)
}

export function closeTabOverview(targetId?: string, refocusPage = true, window?: BaseWindow | null): void {
  const overview = overviewFor(window)
  if (!overview || overview.state === 'closed' || overview.state === 'closing') return
  settleTabOverview(false, targetId ?? activeItemId(overview), refocusPage, overview.window)
}

/** The overview's webContents id, so the swipe tracker can route gestures to it. */
export function getTabOverviewContentsId(window?: BaseWindow | null): number | null {
  const overview = overviewFor(window)
  return (overview && liveView(overview)?.webContents.id) ?? null
}

/** Every window's overview webContents id (diagnostics). */
export function getTabOverviewContentsIds(): number[] {
  return [...overviews.values()].flatMap((overview) => {
    const view = liveView(overview)
    return view ? [view.webContents.id] : []
  })
}

/** Tab the grid has selected (swiped to or hovered); a pinch out lands on it. */
export function getTabOverviewSelectedId(window?: BaseWindow | null): string | null {
  const overview = overviewFor(window)
  return !overview || overview.state === 'closed' ? null : overview.selectedId
}

export function moveTabOverviewSelection(delta: number, window?: BaseWindow | null): void {
  const overview = overviewFor(window)
  if (!overview || overview.state !== 'open') return
  liveView(overview)?.webContents.send('tab-overview:move', delta)
}

export function toggleTabOverview(window?: BaseWindow | null): void {
  const overview = overviewFor(window)
  if (!overview) return
  if (overview.state === 'open' || overview.state === 'opening') closeTabOverview(undefined, true, overview.window)
  else if (overview.state === 'closed') void openTabOverview({}, overview.window)
}

export async function refreshTabOverview(window?: BaseWindow | null): Promise<void> {
  const overview = overviewFor(window)
  if (!overview || overview.state !== 'open' || !liveView(overview)) return
  const items = await overview.host.getItems()
  const current = liveView(overview)
  if (overview.state !== 'open' || !current) return
  overview.lastItems = items
  current.webContents.send('tab-overview:items', { items, pageBounds: overview.host.getPageBounds() })
}
