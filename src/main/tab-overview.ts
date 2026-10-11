import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebContentsView, ipcMain, type BaseWindow, type IpcMainEvent } from 'electron'
import type { BrowserBounds } from '../shared/types'
import { TAB_OVERVIEW_HTML } from './tab-overview-page'

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

let overviewWindow: BaseWindow | null = null
let host: TabOverviewHost | null = null
let view: WebContentsView | null = null
let ready: Promise<void> | null = null
let state: TabOverviewState = 'closed'
let shown = false
let latestProgress = 0
let pendingSettle: { open: boolean; targetId?: string; refocus: boolean } | null = null
let refocusOnClose = true
let fallbackTimer: ReturnType<typeof setTimeout> | null = null
let ipcRegistered = false
let lastItems: TabOverviewItem[] = []
let selectedId: string | null = null

function preloadPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../preload/tab-overview.cjs')
  return existsSync(path) ? path : null
}

function fullBounds(): BrowserBounds {
  if (!overviewWindow || overviewWindow.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 }
  const [width = 0, height = 0] = overviewWindow.getContentSize()
  return { x: 0, y: 0, width, height }
}

function liveView(): WebContentsView | null {
  return view && !view.webContents.isDestroyed() ? view : null
}

function fromOverview(event: IpcMainEvent): boolean {
  const current = liveView()
  return Boolean(current && event.sender === current.webContents)
}

function activeItemId(): string | undefined {
  return lastItems.find((item) => item.active)?.id
}

function clearFallback(): void {
  if (fallbackTimer) clearTimeout(fallbackTimer)
  fallbackTimer = null
}

function hideNow(): void {
  clearFallback()
  const refocus = refocusOnClose
  state = 'closed'
  shown = false
  pendingSettle = null
  refocusOnClose = true
  const current = liveView()
  if (current) {
    current.setVisible(false)
    current.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
  if (refocus) host?.focusPage()
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('tab-overview:ready', (event) => {
    if (!fromOverview(event)) return
    if (pendingSettle) {
      const { open, targetId, refocus } = pendingSettle
      pendingSettle = null
      settleTabOverview(open, targetId, refocus)
    }
  })
  ipcMain.on('tab-overview:settled', (event, open: unknown) => {
    if (!fromOverview(event)) return
    if (open === true) {
      if (state === 'opening') state = 'open'
      liveView()?.webContents.focus()
    } else if (state === 'closing') {
      hideNow()
    }
  })
  ipcMain.on('tab-overview:selected', (event, id: unknown) => {
    if (!fromOverview(event)) return
    selectedId = typeof id === 'string' && lastItems.some((item) => item.id === id) ? id : null
  })
  ipcMain.on('tab-overview:activate', (event, id: unknown) => {
    if (!fromOverview(event) || typeof id !== 'string' || !host || state !== 'open') return
    host.activate(id)
    closeTabOverview(id)
  })
  ipcMain.on('tab-overview:close-tab', (event, id: unknown) => {
    if (!fromOverview(event) || typeof id !== 'string' || !host || state !== 'open') return
    host.closeTab(id)
    void refreshTabOverview()
  })
  ipcMain.on('tab-overview:new-tab', (event) => {
    if (!fromOverview(event) || !host || state !== 'open') return
    closeTabOverview(undefined, false)
    host.newTab()
  })
  ipcMain.on('tab-overview:dismiss', (event) => {
    if (!fromOverview(event) || state !== 'open') return
    closeTabOverview(activeItemId())
  })
}

function onResize(): void {
  const current = liveView()
  if (state !== 'closed' && current) current.setBounds(fullBounds())
}

function ensureView(): WebContentsView | null {
  if (!overviewWindow || overviewWindow.isDestroyed()) return null
  const existing = liveView()
  if (existing) return existing
  const preload = preloadPath()
  if (!preload) {
    console.warn('[tab overview] preload missing; overview unavailable')
    return null
  }
  view = new WebContentsView({
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true,
      backgroundThrottling: false
    }
  })
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
    if (state === 'open' && key === 'w') {
      event.preventDefault()
      if (selectedId && host) {
        host.closeTab(selectedId)
        void refreshTabOverview()
      }
      return
    }
    if (state === 'open' && input.shift && (key === '\\' || key === '|')) {
      event.preventDefault()
      closeTabOverview()
      return
    }
    if (host?.handleShortcut(input) || key === 'w') event.preventDefault()
  })
  view.webContents.on('render-process-gone', () => {
    if (state !== 'closed') hideNow()
    view = null
    ready = null
  })
  // Appended last, so it sits above the shell surfaces and every site view.
  overviewWindow.contentView.addChildView(view)
  ready = view.webContents
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(TAB_OVERVIEW_HTML)}`)
    .catch((error: unknown) => console.error('[tab overview] could not load:', error))
  return view
}

export function attachTabOverview(win: BaseWindow, overviewHost: TabOverviewHost): void {
  overviewWindow = win
  host = overviewHost
  registerIpc()
  win.on('resize', onResize)
  // Load it ahead of time so the first pinch responds instantly.
  setTimeout(() => ensureView(), 1500)
}

export function detachTabOverview(): void {
  clearFallback()
  if (overviewWindow && !overviewWindow.isDestroyed()) overviewWindow.removeListener('resize', onResize)
  liveView()?.webContents.close()
  view = null
  ready = null
  overviewWindow = null
  host = null
  state = 'closed'
  shown = false
  pendingSettle = null
}

export function getTabOverviewState(): TabOverviewState {
  return state
}

export function isTabOverviewOpen(): boolean {
  return state !== 'closed'
}

/**
 * Show the overview. Interactive opens start at progress 0 (the active tab's thumbnail sitting
 * exactly over the page) and follow setTabOverviewProgress until settleTabOverview; otherwise it
 * animates in on its own.
 */
export async function openTabOverview(options: { interactive?: boolean } = {}): Promise<void> {
  if (state !== 'closed' || !host) return
  const overview = ensureView()
  if (!overview) return
  state = 'opening'
  shown = false
  pendingSettle = null
  latestProgress = 0
  refocusOnClose = true
  clearFallback()
  const [items] = await Promise.all([host.getItems(), ready])
  if ((state as TabOverviewState) === 'closed' || overview.webContents.isDestroyed() || !host) return
  lastItems = items
  selectedId = activeItemId() ?? null
  overview.setBounds(fullBounds())
  overview.setVisible(true)
  overview.webContents.send('tab-overview:show', {
    items,
    pageBounds: host.getPageBounds(),
    progress: options.interactive ? latestProgress : 0,
    animate: !options.interactive && !pendingSettle
  })
  shown = true
  overview.webContents.focus()
}

export function setTabOverviewProgress(progress: number): void {
  if (state === 'closed' || !Number.isFinite(progress)) return
  latestProgress = progress
  if (shown) liveView()?.webContents.send('tab-overview:progress', progress)
}

/** Finish an interactive pinch (or any close): animate to the grid (open) or back to the page. */
export function settleTabOverview(open: boolean, targetId?: string, refocus = true): void {
  if (state === 'closed') return
  const current = liveView()
  if (!current) {
    hideNow()
    return
  }
  if (!shown) {
    // Released before the first frame was even up: a close just never shows it, an open is
    // replayed once the page reports ready.
    if (!open) {
      refocusOnClose = refocus
      hideNow()
      return
    }
    pendingSettle = { open, targetId, refocus }
    return
  }
  state = open ? 'opening' : 'closing'
  if (!open) refocusOnClose = refocus
  current.webContents.send('tab-overview:settle', { open, targetId, duration: open ? OPEN_DURATION_MS : CLOSE_DURATION_MS })
  clearFallback()
  if (!open) fallbackTimer = setTimeout(() => { if (state === 'closing') hideNow() }, SETTLE_FALLBACK_MS)
}

export function closeTabOverview(targetId?: string, refocusPage = true): void {
  if (state === 'closed' || state === 'closing') return
  settleTabOverview(false, targetId ?? activeItemId(), refocusPage)
}

/** The overview's webContents id, so the swipe tracker can route gestures to it. */
export function getTabOverviewContentsId(): number | null {
  return liveView()?.webContents.id ?? null
}

/** Tab the grid has selected (swiped to or hovered); a pinch out lands on it. */
export function getTabOverviewSelectedId(): string | null {
  return state === 'closed' ? null : selectedId
}

export function moveTabOverviewSelection(delta: number): void {
  if (state !== 'open') return
  liveView()?.webContents.send('tab-overview:move', delta)
}

export function toggleTabOverview(): void {
  if (state === 'open' || state === 'opening') closeTabOverview()
  else if (state === 'closed') void openTabOverview()
}

export async function refreshTabOverview(): Promise<void> {
  if (state !== 'open' || !host || !liveView()) return
  const items = await host.getItems()
  const current = liveView()
  if (state !== 'open' || !current) return
  lastItems = items
  current.webContents.send('tab-overview:items', { items, pageBounds: host.getPageBounds() })
}
