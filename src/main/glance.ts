import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebContentsView, ipcMain, type BaseWindow, type IpcMainEvent, type WebContents } from 'electron'
import {
  GLANCE_CORNER_RADIUS,
  glanceKeyAction,
  glanceLayout,
  glanceTitle,
  glanceWindowOpenAction,
  isGlanceableUrl,
  type GlanceHeaderState
} from '../shared/glance'
import { POPOVER_DISMISS_CHANNEL } from '../shared/popover-dismiss'
import { stepZoomFactor } from '../shared/zoom'
import { sendToWindowRenderers } from './browser-shell'
import { emitGlanceLinkHover, getGlanceHost, type GlanceHost, type GlanceSource } from './glance-entry'
import { GLANCE_PAGE_HTML } from './glance-page'
import { guardPageDragRegions } from './page-drag-guard'
import { showBrowserContextMenu } from './context-menu'
import { recordBrowsingVisit, updateLatestVisitTitle } from './history'

/**
 * Glance: a link opened in a floating sheet over the current tab. Lazy chunk (glance-entry.ts
 * imports it on the first open). Per window at most one glance, made of two views stacked on top
 * of everything in the window:
 *   - chrome: a transparent local page (glance-page.ts) drawing the dimmed backdrop, the card and
 *     its header. A press on the backdrop closes the glance.
 *   - page: the remote page, a WebContentsView in the source tab's session (so Spaces, private
 *     tabs and per-site proxy rules apply), sandboxed like a tab, with rounded corners.
 * Close destroys both webContents. Promote hands the page view (and its webContents) to a new tab (no reload,
 * history kept) and destroys only the chrome view.
 */

interface Glance {
  window: BaseWindow
  source: GlanceSource
  page: WebContentsView
  chrome: WebContentsView
  url: string
  /** Listeners this module put on the page's webContents; removed before a promote hands it over. */
  pageListeners: Array<[string, (...args: never[]) => void]>
  onResize: () => void
  onWindowClosed: () => void
  onSourceGone: () => void
  /** The page is in HTML fullscreen (video): it fills the window and Esc is the page's. */
  fullscreen: boolean
  ended: boolean
}

const glances = new Map<BaseWindow, Glance>()
let ipcRegistered = false
const IS_MAC = process.platform === 'darwin'
const CHROME_READY_TIMEOUT_MS = 3000

function host(): GlanceHost {
  const current = getGlanceHost()
  if (!current) throw new Error('Glance host is not registered')
  return current
}

function preloadPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../preload/glance.cjs')
  return existsSync(path) ? path : null
}

function live(contents: WebContents | null | undefined): contents is WebContents {
  return Boolean(contents && !contents.isDestroyed())
}

function glanceFor(window: BaseWindow | null): Glance | null {
  if (window) return glances.get(window) ?? null
  if (glances.size === 1) return [...glances.values()][0] ?? null
  return null
}

function fromChrome(event: IpcMainEvent): Glance | null {
  for (const glance of glances.values()) if (glance.chrome.webContents === event.sender) return glance
  return null
}

function headerState(glance: Glance): GlanceHeaderState {
  const contents = glance.page.webContents
  const url = live(contents) ? contents.getURL() || glance.url : glance.url
  return {
    url,
    title: glanceTitle(live(contents) ? contents.getTitle() : '', url),
    loading: live(contents) ? contents.isLoading() : false,
    canGoBack: live(contents) ? contents.navigationHistory.canGoBack() : false,
    private: glance.source.isPrivate,
    canSplit: host().canSplit(glance.source)
  }
}

function publishHeader(glance: Glance): void {
  if (glance.ended || !live(glance.chrome.webContents)) return
  glance.chrome.webContents.send('glance:state', headerState(glance))
}

function layout(glance: Glance): void {
  if (glance.ended || glance.window.isDestroyed()) return
  const [width = 0, height = 0] = glance.window.getContentSize()
  const next = glanceLayout(width, height)
  glance.chrome.setBounds(next.backdrop)
  glance.page.setBounds(glance.fullscreen ? next.backdrop : next.page)
  glance.page.setBorderRadius(glance.fullscreen ? 0 : GLANCE_CORNER_RADIUS)
  if (live(glance.chrome.webContents)) glance.chrome.webContents.send('glance:layout', next)
}

function registerIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('glance:close', (event) => {
    const glance = fromChrome(event)
    if (glance) endGlance(glance, true)
  })
  ipcMain.on('glance:promote', (event) => {
    const glance = fromChrome(event)
    if (glance) promote(glance, true)
  })
  ipcMain.on('glance:split', (event) => {
    const glance = fromChrome(event)
    if (!glance || !host().canSplit(glance.source)) return
    const id = promote(glance, false)
    if (id) host().openInSplitView(id)
  })
  ipcMain.on('glance:back', (event) => {
    const glance = fromChrome(event)
    const contents = glance?.page.webContents
    if (live(contents) && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    if (live(contents)) contents.focus()
  })
}

function onPage<T extends unknown[]>(glance: Glance, event: string, listener: (...args: T) => void): void {
  const contents = glance.page.webContents
  ;(contents.on as (name: string, fn: (...args: T) => void) => WebContents)(event, listener)
  glance.pageListeners.push([event, listener as unknown as (...args: never[]) => void])
}

/** Keys pressed in the glance page or its header. */
function handleKey(glance: Glance, event: Electron.Event, input: Electron.Input): void {
  const page = glance.page.webContents
  const action = glanceKeyAction(input, IS_MAC, glance.fullscreen)
  if (!action) return
  event.preventDefault()
  if (action === 'close') return void endGlance(glance, true)
  if (action === 'promote') return void promote(glance, true)
  if (action === 'close-and-forward') {
    const { source } = glance
    endGlance(glance, false)
    if (!host().handleShortcut(source, input)) host().focusSource(source)
    return
  }
  if (!live(page)) return
  switch (action) {
    case 'reload': page.reload(); break
    case 'back': if (page.navigationHistory.canGoBack()) page.navigationHistory.goBack(); break
    case 'forward': if (page.navigationHistory.canGoForward()) page.navigationHistory.goForward(); break
    case 'zoom-in': case 'zoom-out': case 'zoom-reset':
      page.setZoomFactor(action === 'zoom-reset' ? 1 : stepZoomFactor(page.getZoomFactor(), action === 'zoom-in' ? 1 : -1))
      break
  }
}

function wirePage(glance: Glance): void {
  const contents = glance.page.webContents
  const { source } = glance
  // A site's app-region: drag CSS must not turn parts of the window into a drag handle.
  guardPageDragRegions(contents)
  contents.setWindowOpenHandler((details) => {
    const action = glanceWindowOpenAction(details)
    if (action === 'navigate') void contents.loadURL(details.url).catch(() => undefined)
    else if (action === 'background-tab') host().openTab(source, details.url, false)
    return { action: 'deny' }
  })
  onPage(glance, 'will-navigate', (event: Electron.Event, url: string) => {
    if (!isGlanceableUrl(url)) event.preventDefault()
  })
  onPage(glance, 'will-redirect', (event: Electron.Event, url: string) => {
    if (!isGlanceableUrl(url)) event.preventDefault()
  })
  onPage(glance, 'before-input-event', (event: Electron.Event, input: Electron.Input) => handleKey(glance, event, input))
  onPage(glance, 'context-menu', (event: Electron.Event, params: Electron.ContextMenuParams) => {
    if (glance.ended || glance.window.isDestroyed()) return
    const bounds = glance.page.getBounds()
    showBrowserContextMenu(event, contents, params, {
      window: glance.window,
      pageActions: true,
      offsetX: bounds.x,
      offsetY: bounds.y,
      searchEngine: host().searchEngine(),
      openInNewTab: (url) => host().openTab(source, url, true),
      openInBackgroundTab: (url) => host().openTab(source, url, false),
      // Inside a glance, "Open Link in Glance" just follows the link here.
      openInGlance: (url) => { if (isGlanceableUrl(url)) void contents.loadURL(url).catch(() => undefined) }
    })
  })
  onPage(glance, 'update-target-url', (_event: Electron.Event, url: string) => emitGlanceLinkHover(contents, url, true))
  const header = (): void => publishHeader(glance)
  onPage(glance, 'did-start-loading', header)
  onPage(glance, 'did-stop-loading', header)
  onPage(glance, 'page-title-updated', (_event: Electron.Event, title: string) => {
    if (!source.isPrivate) updateLatestVisitTitle(contents.getURL(), title)
    header()
  })
  // History like a tab, except in private tabs (nothing private is ever written).
  const visit = (url: string): void => {
    if (!source.isPrivate && isGlanceableUrl(url)) recordBrowsingVisit(url, contents.getTitle() || url)
    header()
  }
  onPage(glance, 'did-navigate', (_event: Electron.Event, url: string) => visit(url))
  onPage(glance, 'did-navigate-in-page', (_event: Electron.Event, url: string, isMainFrame: boolean) => { if (isMainFrame) visit(url) })
  onPage(glance, 'enter-html-full-screen', () => { glance.fullscreen = true; layout(glance) })
  onPage(glance, 'leave-html-full-screen', () => { glance.fullscreen = false; layout(glance) })
  onPage(glance, 'render-process-gone', () => endGlance(glance, true))
  onPage(glance, 'destroyed', () => endGlance(glance, false))
}

function createChromeView(window: BaseWindow): { view: WebContentsView; ready: Promise<void> } | null {
  const preload = preloadPath()
  if (!preload) {
    console.warn('[glance] preload missing; Glance unavailable')
    return null
  }
  const view = new WebContentsView({
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, transparent: true, backgroundThrottling: false }
  })
  view.setBackgroundColor('#00000000')
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event) => event.preventDefault())
  host().bindToWindow(view.webContents, window)
  // Loaded before it is attached: a view attached while its first page loads takes keyboard focus,
  // which belongs to the glance page.
  const ready = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, CHROME_READY_TIMEOUT_MS)
    view.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
    view.webContents.once('destroyed', () => { clearTimeout(timer); resolve() })
  })
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(GLANCE_PAGE_HTML)}`).catch(() => undefined)
  return { view, ready }
}

export async function openGlanceFor(source: GlanceSource, url: string): Promise<boolean> {
  registerIpc()
  const { window } = source
  if (window.isDestroyed() || !live(source.contents) || !isGlanceableUrl(url)) return false
  // One glance per window: a new one replaces it.
  const previous = glances.get(window)
  if (previous) endGlance(previous, false)
  const chrome = createChromeView(window)
  if (!chrome) return false
  const page = new WebContentsView({ webPreferences: host().pageWebPreferences(source) })
  page.setBorderRadius(GLANCE_CORNER_RADIUS)
  page.setBackgroundColor('#ffffffff')
  host().bindToWindow(page.webContents, window)
  const glance: Glance = {
    window,
    source,
    page,
    chrome: chrome.view,
    url,
    pageListeners: [],
    onResize: () => layout(glance),
    onWindowClosed: () => endGlance(glance, false),
    onSourceGone: () => endGlance(glance, false),
    fullscreen: false,
    ended: false
  }
  glances.set(window, glance)
  wirePage(glance)
  window.on('resize', glance.onResize)
  window.once('closed', glance.onWindowClosed)
  source.contents.once('destroyed', glance.onSourceGone)
  chrome.view.webContents.on('before-input-event', (event, input) => handleKey(glance, event, input))
  // Start the page load right away (the card animates in while it loads).
  void page.webContents.loadURL(url).catch(() => undefined)
  // Close any toolbar popover: it would sit under the glance.
  sendToWindowRenderers(window, POPOVER_DISMISS_CHANNEL, 'request')
  await chrome.ready
  if (glance.ended || window.isDestroyed()) return false
  window.contentView.addChildView(chrome.view)
  window.contentView.addChildView(page)
  layout(glance)
  publishHeader(glance)
  page.webContents.focus()
  return true
}

function detachViews(glance: Glance): void {
  const { window } = glance
  if (!window.isDestroyed()) {
    window.removeListener('resize', glance.onResize)
    window.removeListener('closed', glance.onWindowClosed)
    for (const view of [glance.page, glance.chrome]) {
      if (window.contentView.children.includes(view)) window.contentView.removeChildView(view)
    }
  }
  if (live(glance.source.contents)) glance.source.contents.removeListener('destroyed', glance.onSourceGone)
}

/** Close and destroy the glance (both webContents). `refocus`: give the keyboard back to the tab. */
function endGlance(glance: Glance, refocus: boolean): void {
  if (glance.ended) return
  glance.ended = true
  if (glances.get(glance.window) === glance) glances.delete(glance.window)
  detachViews(glance)
  if (live(glance.page.webContents)) glance.page.webContents.close()
  if (live(glance.chrome.webContents)) glance.chrome.webContents.close()
  if (refocus && !glance.window.isDestroyed()) host().focusSource(glance.source)
}

/** Hand the page's webContents to a new tab next to the source. Returns the new tab id. */
function promote(glance: Glance, activate: boolean): string | null {
  if (glance.ended) return null
  const contents = glance.page.webContents
  if (!live(contents)) {
    endGlance(glance, true)
    return null
  }
  glance.ended = true
  if (glances.get(glance.window) === glance) glances.delete(glance.window)
  for (const [event, listener] of glance.pageListeners) contents.removeListener(event as 'destroyed', listener as () => void)
  glance.pageListeners = []
  detachViews(glance)
  // The tab rounds nothing: give the page its square corners back before the tab adopts it.
  glance.page.setBorderRadius(0)
  if (live(glance.chrome.webContents)) glance.chrome.webContents.close()
  const url = contents.getURL() || glance.url
  const id = host().adoptAsTab(glance.source, glance.page, url, activate)
  if (!id) {
    // Couldn't make the tab (window going away): don't leave the page running headless.
    if (live(contents)) contents.close()
    return null
  }
  return id
}

export function isGlanceOpenIn(window: BaseWindow | null): boolean {
  const glance = glanceFor(window)
  return Boolean(glance && !glance.ended)
}

export function closeGlanceIn(window: BaseWindow | null): boolean {
  const glance = glanceFor(window)
  if (!glance) return false
  endGlance(glance, true)
  return true
}

export function promoteGlanceIn(window: BaseWindow | null): string | null {
  const glance = glanceFor(window)
  return glance ? promote(glance, true) : null
}

/** The source tab left the screen (tab switch, closed, slept): the glance goes with it. */
export function syncGlanceWithActiveTab(window: BaseWindow): void {
  const glance = glances.get(window)
  if (!glance || glance.ended) return
  if (!live(glance.source.contents) || !host().isActiveTab(window, glance.source.tabId)) endGlance(glance, false)
}

export function glanceContentsIds(): { page: number[]; chrome: number[] } {
  const page: number[] = []
  const chrome: number[] = []
  for (const glance of glances.values()) {
    if (live(glance.page.webContents)) page.push(glance.page.webContents.id)
    if (live(glance.chrome.webContents)) chrome.push(glance.chrome.webContents.id)
  }
  return { page, chrome }
}
