import { randomUUID } from 'node:crypto'
import { shouldHandOffSignIn, signInContinueUrl } from './google-webkit-sign-in-policy.ts'
import { hasGoogleSessionCookie, isWebKitGoogleSignInAvailable, runWebKitGoogleSignIn } from './google-webkit-sign-in'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, clipboard, dialog, Menu, screen, WebContentsView, type BaseWindow, type ContextMenuParams, type Event, type MenuItemConstructorOptions, type WebContents, type WebFrameMain } from 'electron'
import type { BrowserBounds, BrowserFindState, BrowserState, BrowserTabSummary, SearchEngineId, TabSleepMinutes } from '../shared/types'
import type { ExtensionTabRecord } from '../shared/extension-tabs'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, isBrowserTabSleeping, isYouTubeUrl, resolveNavigationTarget, SURFFISH_QUICK_LINKS_URL } from '../shared/navigation'
import { DEFAULT_TAB_SLEEP_MINUTES, isTabSleepMinutes, MAX_CACHED_FAVICON_BYTES, normalizeCachedFaviconDataUrl, normalizeFaviconUrl, normalizeHttpOrigin } from '../shared/persistence'
import { cleanLinkUrl } from '../shared/clean-link'
import { stepZoomFactor } from '../shared/zoom'
import { recordBrowsingVisit, updateLatestVisitFavicon, updateLatestVisitTitle } from './history'
import { BROWSER_SESSION_PARTITION, clearPrivateSession, getBrowserSession, getPrivateSession, whenPrivateSessionReady } from './browser-session'
import { forgetPrivateDownloads } from './downloads'
import { getBrowserNewTabPage, getCachedBrowserSiteFavicon, getBrowserSiteSettings, getBrowserSiteZoom, getBrowserTabSleepMinutes, saveBrowserSiteZoom, saveBrowserWindowsSession, saveBrowserSiteFavicon } from './browser-persistence'
import type { SavedWindowState } from '../shared/window-geometry'
import { bookmarkPage, bookmarkPagesInNewFolder, isUrlBookmarked, recordBookmarkFavicon, removeBookmarksForUrl } from './bookmarks'
import { showBrowserContextMenu } from './context-menu'
import { isShowingPdf, printPdf } from './pdf-viewer'
import { attachPdfEditor, confirmDiscardPdfEdits, getPdfEditorSession, pdfEditorPreloadPath, sendPdfEditorCommand } from './pdf-editor'
import { isEditablePdfSource, isPdfEditorUrl, PDF_EDITOR_URL, pdfEditorTabTitle, pdfNameFromUrl } from '../shared/pdf-editor'
import { isLocalDocumentUrl } from '../shared/external-links'
import { isBrambleExtensionUrl } from './bramble-poc-adapter'
import { attachNetworkInspector, detachNetworkInspector } from './network-inspector'
import { captureLocalNewTabPage, focusVisibleShellPage, getBrowserChromeState, getMainRendererOrigin, getShellWindowFor, getWindowRenderers, handleBrowserPageMouseEvent, isFocusAddressShortcut, sendFocusAddressToVisibleRenderer, sendToMainWindowRenderers, sendToToolbarRenderer, sendToVisibleToolbarSurface, sendToWindowRenderers, setBrowserChromeState, setBrowserPageIsLocalNewTab } from './browser-shell'
import { bindContentsToWindow, browserWindowNumber, currentBrowserWindow, focusedBrowserWindow, notifyBrowserWindowsChanged, runInWindow } from './window-scope'
import { guardPageDragRegions } from './page-drag-guard'
import { handleCommandPaletteShortcut } from './command-palette'
import { resolveAddressInput } from './search-keywords'
import { avoidLinkStatusPointer, destroyLinkStatus, flashLinkStatus, hideLinkStatus, showLinkStatus } from './link-status'
import { copyImageAtPoint, isCopyImageClick } from './copy-image'
import { onPermissionDenied } from './proxy'
import { attachTabSafety } from './safety'
import { getTabInterstitial, onTabInterstitialChanged } from './tab-interstitials'
import { isTabCrashed, recoverCrashedTabOnActivate } from './tab-health'
import { createPermissionToastThrottle, permissionDeniedMessage } from '../shared/site-permissions'
import { startMacTrackpadSwipe, stopMacTrackpadSwipe, type MacTrackpadPinchPhase, type MacTrackpadSwipeBeginRequest, type MacTrackpadSwipeDirection } from './mac-trackpad-swipe'
import { setPageViewOnScreen, type TabProcessEntry } from './tab-visibility'
import { restoredTabInactiveSince } from './tab-archive-store'
import type { TabArchiveCandidate } from '../shared/tab-archive'
import { attachScreenshots, detachScreenshots, takeScreenshot } from './screenshot'
import { attachReaderDetection, attachReaderHost, readerStateFor, readerViewFor, toggleReaderMode } from './reader-mode'
import { canWatchPage, watchPageFromTab } from './page-watchers'
import { createSplitGroup, encodeSessionSplits, noteRecentTab, orderTabsForSplits, pickLastUsedTab, removeTabFromSplits, replaceSplitPane, resizeSplitAt, splitDropSide, splitGroupOf, splitInfoFor, splitPaneRects, swapSplitPanes, MAX_SPLIT_PANES, type SavedSplit, type SplitGroup } from '../shared/split-view'
import { notifySplitPagePointer, setSplitSurfaceHandlers, updateSplitSurface } from './split-view-surface'
import { attachTabOverview, closeTabOverview, detachTabOverview, getTabOverviewContentsId, getTabOverviewContentsIds, getTabOverviewSelectedId, getTabOverviewState, moveTabOverviewSelection, isTabOverviewOpen, openTabOverview, setTabOverviewProgress, settleTabOverview, toggleTabOverview, type TabOverviewItem } from './tab-overview'

export const START_PAGE = 'https://online.bonjourr.fr/'
interface BrowserTab {
  id: string
  /** The window the tab is in; changes when the tab is moved to another window. */
  win: BrowserWindowState
  view: WebContentsView | null
  faviconUrl: string | null
  faviconRevision: number
  error: string | null
  downloadStartedForCurrentLoad: boolean
  pauseAutoplayUntilVisited: boolean
  lastUrl: string
  pendingUrl: string
  pinned: boolean
  inactiveSince: number | null
  sleepTimer: ReturnType<typeof setTimeout> | null
  pageScrollEdges: BrowserPageScrollEdges
  /** visualViewport.scale reported by the page; above 1 means the user pinch-zoomed in. */
  pageScale: number
  /** Extension origin (chrome-extension://id/) when this tab hosts an extension UI page. */
  extensionPageOrigin: string | null
  extensionPreloadPath: string | null
  extensionPageOwner: ExtensionPageOwner | null
  /** Private tab: in-memory session, never saved to history, the session file or the favicon cache. */
  isPrivate: boolean
  /** The built-in viewer is showing a PDF (refreshed on frame loads so the toolbar can offer Edit PDF). */
  showingPdf: boolean
  /** Set while the tab shows the PDF editor instead of the page; the view then runs on the editor session. */
  pdfEditor: PdfEditorTabState | null
  /** Back/forward list to restore instead of a plain load (a tab brought back from the archive). */
  restoreHistory: { entries: Electron.NavigationEntry[]; index: number } | null
}

interface PdfEditorTabState {
  /** The PDF's own http(s)/file URL; what the tab reports, persists and goes back to. */
  sourceUrl: string
  name: string
  dirty: boolean
}

/** Who opened an extension UI tab: Bramble's own integration or a Chrome Web Store extension. */
export type ExtensionPageOwner = 'bramble' | 'web-store'
interface BrowserPageScrollEdges {
  canScrollLeft: boolean
  canScrollRight: boolean
}
interface ActiveMacTrackpadSwipe {
  contents: WebContents
  tabId: string
  direction: MacTrackpadSwipeDirection
  token: number
}
const UNKNOWN_PAGE_SCROLL_EDGES: BrowserPageScrollEdges = { canScrollLeft: true, canScrollRight: true }
const MAC_SWIPE_BEGIN_CHANNEL = 'browser:mac-trackpad-swipe:begin'
const MAC_SWIPE_PROGRESS_CHANNEL = 'browser:mac-trackpad-swipe:progress'
const MAC_SWIPE_END_CHANNEL = 'browser:mac-trackpad-swipe:end'
const MAC_SWIPE_RESET_CHANNEL = 'browser:mac-trackpad-swipe:reset'
export const BACKGROUND_YOUTUBE_AUTOPLAY_ALLOW_CHANNEL = 'browser:background-youtube-autoplay:allow'
const MAC_SWIPE_SETTLE_MS = 180
const MAC_SWIPE_DEBUG = process.env.SURFFISH_SWIPE_DEBUG === '1'
interface FindState { tabId: string | null; open: boolean; text: string; result: BrowserFindState['result'] }

/** One browser window: its tabs (in sidebar order) and the per-window page state. */
interface BrowserWindowState {
  window: BaseWindow
  tabs: BrowserTab[]
  activeTabId: string | null
  /** Page area in window coordinates (where the active site view sits). */
  browserBounds: BrowserBounds
  findState: FindState
  confirmingWindowClose: boolean
  /** Private window: every new tab in it is private, and it is never saved to the session. */
  isPrivate: boolean
  /** Split views in this window; the active tab is the focused pane of the one on screen (see split-view.ts). */
  splits: SplitGroup[]
  /** Tab ids, most recently activated first ("split with last used tab"). */
  recentTabIds: string[]
}
const windowStates: BrowserWindowState[] = []
let selectedSearchEngine: SearchEngineId = DEFAULT_SEARCH_ENGINE
let tabSleepMinutes: TabSleepMinutes = DEFAULT_TAB_SLEEP_MINUTES
let activeMacTrackpadSwipe: ActiveMacTrackpadSwipe | null = null
let nextMacTrackpadSwipeToken = 0
const tabThumbnails = new Map<string, string>()
// Every New Tab looks the same, so one snapshot stands in for any that were never on screen.
let newTabThumbnail: string | null = null
const THUMBNAIL_WIDTH = 640
const FAVICON_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])
const faviconFetches = new Map<string, Promise<string | null>>()

function configuredStartPage(engine: SearchEngineId = selectedSearchEngine): string {
  const page = getBrowserNewTabPage()
  if (page === 'search') return getSearchHomepage(engine)
  return page === 'bonjourr' ? START_PAGE : SURFFISH_QUICK_LINKS_URL
}

function isLiveWindow(w: BrowserWindowState | undefined): w is BrowserWindowState {
  return Boolean(w && windowStates.includes(w) && !w.window.isDestroyed())
}

function windowStateFor(window: BaseWindow | null | undefined): BrowserWindowState | undefined {
  return window ? windowStates.find((w) => w.window === window && !w.window.isDestroyed()) : undefined
}

/** The window an implicit call is for: the IPC sender's, else the focused / last focused one. */
function currentWindowState(): BrowserWindowState | undefined {
  return windowStateFor(currentBrowserWindow()) ?? (windowStates.length === 1 ? windowStates[0] : undefined)
}

/** Every tab in every window. */
function allTabs(): BrowserTab[] {
  return windowStates.flatMap((w) => w.tabs)
}

function findTab(id: string | null | undefined): BrowserTab | undefined {
  if (!id) return undefined
  for (const w of windowStates) {
    const tab = w.tabs.find((candidate) => candidate.id === id)
    if (tab) return tab
  }
  return undefined
}

function tabForContents(contents: WebContents): BrowserTab | undefined {
  for (const w of windowStates) {
    const tab = w.tabs.find((candidate) => candidate.view?.webContents === contents)
    if (tab) return tab
  }
  return undefined
}

function activeTabOf(w: BrowserWindowState | undefined): BrowserTab | undefined {
  return w ? w.tabs.find((tab) => tab.id === w.activeTabId) : undefined
}

function isActiveTab(tab: BrowserTab): boolean {
  return tab.win.activeTabId === tab.id
}

/** The split view `tab` is a pane of, if any. */
function splitOf(tab: BrowserTab | undefined): SplitGroup | undefined {
  return tab ? splitGroupOf(tab.win.splits, tab.id) : undefined
}

/** Tabs whose pages are on screen: the active tab, or every pane of its split. */
function onScreenTabIds(w: BrowserWindowState | undefined): string[] {
  const active = activeTabOf(w)
  if (!active) return []
  return splitOf(active)?.tabIds.slice() ?? [active.id]
}

/** On screen = the active tab or another pane of its split (never slept, throttled or archived). */
function isTabOnScreen(tab: BrowserTab): boolean {
  return isActiveTab(tab) || Boolean(splitOf(activeTabOf(tab.win))?.tabIds.includes(tab.id))
}

/** Where a tab's page is drawn (window coordinates): its pane in a split on screen, else the page area. */
function pageBoundsOf(tab: BrowserTab): BrowserBounds {
  const w = tab.win
  const split = splitOf(activeTabOf(w))
  const index = split ? split.tabIds.indexOf(tab.id) : -1
  if (!split || index < 0 || w.browserBounds.width <= 0 || w.browserBounds.height <= 0) return { ...w.browserBounds }
  return splitPaneRects(w.browserBounds, split.sizes).panes[index] ?? { ...w.browserBounds }
}

/** No argument: the current window's active tab. With an id: that tab, in whichever window it is. */
function getTab(id?: string | null): BrowserTab | undefined {
  return id === undefined ? activeTabOf(currentWindowState()) : findTab(id)
}

function currentUrl(tab: BrowserTab): string {
  if (tab.pdfEditor) return tab.pdfEditor.sourceUrl
  return tab.view?.webContents.getURL() || tab.lastUrl || tab.pendingUrl || configuredStartPage()
}

function isExtensionPage(tab: BrowserTab, url: string): boolean {
  return tab.extensionPageOrigin !== null && isBrambleExtensionUrl(url, tab.extensionPageOrigin)
}
export function shouldPauseBackgroundYouTubeAutoplay(contents: WebContents): boolean {
  if (contents.isDestroyed()) return false
  const tab = tabForContents(contents)
  return Boolean(tab?.pauseAutoplayUntilVisited && !isTabOnScreen(tab))
}
function pageTitle(tab: BrowserTab): string {
  if (tab.pdfEditor) return pdfEditorTabTitle(tab.pdfEditor.name, tab.pdfEditor.dirty)
  if (currentUrl(tab) === SURFFISH_QUICK_LINKS_URL) return 'New Tab'
  const title = tab.view?.webContents.getTitle().trim()
  if (title) return title
  try {
    return new URL(currentUrl(tab)).hostname || 'New tab'
  } catch {
    return 'New tab'
  }
}

function getState(w = currentWindowState()): BrowserState {
  const tab = activeTabOf(w)
  const contents = tab?.view?.webContents
  return {
    url: tab ? currentUrl(tab) : configuredStartPage(),
    title: tab ? pageTitle(tab) : 'New tab',
    loading: contents?.isLoading() ?? false,
    // Back from the editor returns to the viewer.
    canGoBack: tab?.pdfEditor ? true : contents?.navigationHistory.canGoBack() ?? false,
    canGoForward: tab?.pdfEditor ? false : contents?.navigationHistory.canGoForward() ?? false,
    error: tab?.error ?? null,
    private: tab?.isPrivate ?? w?.isPrivate ?? false,
    zoomFactor: contents && !contents.isDestroyed() ? contents.getZoomFactor() : 1,
    pdf: tab?.pdfEditor ? 'editor' : tab?.showingPdf ? 'viewer' : null,
    reader: tab?.pdfEditor ? null : readerStateFor(contents),
    interstitial: getTabInterstitial(contents)
  }
}

function getTabSummaries(w = currentWindowState()): BrowserTabSummary[] {
  if (!w) return []
  return w.tabs.map((tab) => {
    const split = splitInfoFor(w.splits, tab.id)
    return {
    id: tab.id,
    url: currentUrl(tab),
    title: pageTitle(tab),
    faviconUrl: tab.faviconUrl,
    loading: tab.view?.webContents.isLoading() ?? false,
    active: tab.id === w.activeTabId,
    pinned: tab.pinned,
    sleeping: isBrowserTabSleeping(tab.view !== null, currentUrl(tab)),
    private: tab.isPrivate,
    audible: Boolean(tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible()),
    muted: Boolean(tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isAudioMuted()),
    crashed: isTabCrashed(tab.view?.webContents),
    ...(split ? { split } : {})
  }
  })
}

function persistPageFavicon(pageUrl: string, faviconUrl: string | null): void {
  if (!faviconUrl) return
  const safeFaviconUrl = normalizeFaviconUrl(faviconUrl)
  const origin = normalizeHttpOrigin(pageUrl)
  if (!safeFaviconUrl || !origin) return
  updateLatestVisitFavicon(pageUrl, safeFaviconUrl)

  recordBookmarkFavicon(pageUrl, safeFaviconUrl)
  notifyHistoryChanged()
}

async function readBoundedFaviconBody(response: Response): Promise<Buffer | null> {
  const body = response.body
  if (!body) return null
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_CACHED_FAVICON_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(Buffer.from(value))
    }
    return total > 0 ? Buffer.concat(chunks, total) : null
  } catch {
    return null
  } finally {
    try { reader.releaseLock() } catch { /* the stream may already be cancelled */ }
  }
}

function cachePageFavicon(pageUrl: string, faviconUrl: string): Promise<string | null> {
  const origin = normalizeHttpOrigin(pageUrl)
  if (!origin) return Promise.resolve(null)
  const inlineIcon = normalizeCachedFaviconDataUrl(faviconUrl)
  if (inlineIcon) {
    const previous = getCachedBrowserSiteFavicon(origin)
    const saved = saveBrowserSiteFavicon(origin, inlineIcon)
    if (saved && previous !== saved) sendToMainWindowRenderers('browser:site-icon:changed', { origin, faviconUrl: saved })
    return Promise.resolve(saved)
  }
  const safeIconUrl = normalizeFaviconUrl(faviconUrl)
  if (!safeIconUrl) return Promise.resolve(null)
  const key = `${origin}\n${safeIconUrl}`
  const inFlight = faviconFetches.get(key)
  if (inFlight) return inFlight

  const request = (async (): Promise<string | null> => {
    try {
      const response = await getBrowserSession().fetch(safeIconUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8_000)
      })
      if (!response.ok) return null
      const finalUrl = normalizeFaviconUrl(response.url || safeIconUrl)
      if (!finalUrl) return null
      const declaredSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredSize) && declaredSize > MAX_CACHED_FAVICON_BYTES) return null
      const mimeFromHeader = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
      const mime = FAVICON_MIME_TYPES.has(mimeFromHeader)
        ? mimeFromHeader
        : mimeFromHeader === 'application/octet-stream' && new URL(finalUrl).pathname.toLowerCase().endsWith('.ico')
          ? 'image/x-icon'
          : null
      if (!mime) return null
      const bytes = await readBoundedFaviconBody(response)
      if (!bytes) return null
      const dataUrl = normalizeCachedFaviconDataUrl(`data:${mime};base64,${bytes.toString('base64')}`)
      if (!dataUrl) return null
      const previous = getCachedBrowserSiteFavicon(origin)
      const saved = saveBrowserSiteFavicon(origin, dataUrl)
      if (saved && previous !== saved) sendToMainWindowRenderers('browser:site-icon:changed', { origin, faviconUrl: saved })
      return saved
    } catch {
      return null
    }
  })()
  faviconFetches.set(key, request)
  void request.finally(() => {
    if (faviconFetches.get(key) === request) faviconFetches.delete(key)
  })
  return request
}

function refreshTabFavicon(tab: BrowserTab): void {
  const contents = tab.view?.webContents
  if (!contents || contents.isDestroyed()) return
  const pageUrl = contents.getURL()
  if (!/^https?:\/\//i.test(pageUrl)) return
  const revision = ++tab.faviconRevision
  const script = `(() => {
    const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel~="apple-touch-icon"]'));
    links.sort((a, b) => (b.sizes?.toString().length ?? 0) - (a.sizes?.toString().length ?? 0));
    return links.find((link) => link.href)?.href ?? null;
  })()`
  void contents.executeJavaScript(script, true).then((value: unknown) => {
    if (tab.view?.webContents !== contents || tab.faviconRevision !== revision || contents.getURL() !== pageUrl) return
    let faviconUrl = typeof value === 'string' ? value : null
    if (faviconUrl) {
      try {
        const parsed = new URL(faviconUrl)
        const allowedDataImage = parsed.protocol === 'data:' && parsed.href.startsWith('data:image/') && parsed.href.length <= 500_000
        const allowedWebImage = (parsed.protocol === 'http:' || parsed.protocol === 'https:')
          && parsed.username.length === 0 && parsed.password.length === 0 && parsed.href.length <= 4_096
        if (!allowedDataImage && !allowedWebImage) faviconUrl = null
      } catch {
        faviconUrl = null
      }
    }
    if (!faviconUrl) {
      try {
        faviconUrl = `${new URL(pageUrl).origin}/favicon.ico`
      } catch {
        faviconUrl = null
      }
    }
    if (!faviconUrl) return
    if (!tab.isPrivate) persistPageFavicon(pageUrl, faviconUrl)
    if (tab.faviconUrl !== faviconUrl) {
      tab.faviconUrl = faviconUrl
      publishTabs(tab.win)
    }
    if (!tab.isPrivate) void cachePageFavicon(pageUrl, faviconUrl).then((cachedIcon) => {
      if (!cachedIcon || tab.view?.webContents !== contents || tab.faviconRevision !== revision || contents.getURL() !== pageUrl) return
      if (tab.faviconUrl !== cachedIcon) {
        tab.faviconUrl = cachedIcon
        publishTabs(tab.win)
      }
    })
  }).catch(() => undefined)
}

let historyChangedTimer: ReturnType<typeof setTimeout> | null = null
/** Navigations, title and favicon updates arrive in bursts; renderers refetch history once per burst. */
function notifyHistoryChanged(): void {
  if (historyChangedTimer) return
  historyChangedTimer = setTimeout(() => {
    historyChangedTimer = null
    sendToMainWindowRenderers('browser:history-changed')
  }, 300)
}

let windowListTimer: ReturnType<typeof setTimeout> | null = null
let lastWindowListKey = ''
/** Active tab titles feed the Window menu; tell it (debounced) when one changes. */
function noteWindowTitles(): void {
  if (windowListTimer) return
  windowListTimer = setTimeout(() => {
    windowListTimer = null
    const key = windowStates.map((w) => `${w.isPrivate}:${pageTitleOfWindow(w)}`).join('\n')
    if (key === lastWindowListKey) return
    lastWindowListKey = key
    notifyBrowserWindowsChanged()
  }, 250)
}

function publishTabs(w = currentWindowState()): void {
  if (!isLiveWindow(w)) return
  keepSplitTabsTogether(w)
  sendToWindowRenderers(w.window, 'browser:tabs', getTabSummaries(w))
  noteWindowTitles()
}

function publishState(w = currentWindowState()): void {
  if (!isLiveWindow(w)) return
  const state = getState(w)
  // Crash / hang / HTTPS notices are drawn by the content renderer, like the local New Tab page.
  setBrowserPageIsLocalNewTab(state.url === SURFFISH_QUICK_LINKS_URL || state.interstitial !== null, w.window)
  sendToWindowRenderers(w.window, 'browser:state', state)
  publishTabs(w)
}

function publishAllWindows(): void {
  for (const w of [...windowStates]) publishState(w)
}

/** Freeze the saved session while the app quits, so windows closing one by one don't drop out of it. */
let sessionFrozen = false
export function freezeBrowserSession(): void {
  persistOpenTabs()
  sessionFrozen = true
}

function persistOpenTabs(): void {
  if (sessionFrozen) return
  // Private windows are never saved; private tabs in normal windows are skipped.
  const windows = windowStates.filter((w) => !w.isPrivate && !w.window.isDestroyed())
  if (windows.length === 0) return
  // Local files opened from the OS are not restored (the path may be gone, and restore only allows http(s)).
  const saved = windows.map((w) => {
    const kept = w.tabs.filter((tab) => !tab.isPrivate && !currentUrl(tab).startsWith('file:'))
    const splits = encodeSessionSplits(kept.map((tab) => tab.id), w.splits)
    return {
      urls: kept.map(currentUrl),
      activeIndex: kept.findIndex((tab) => tab.id === w.activeTabId),
      pinnedIndexes: kept.flatMap((tab, index) => tab.pinned ? [index] : []),
      geometry: windowGeometry(w.window),
      ...(splits.length > 0 ? { splits } : {})
    }
  })
  const focused = windowStateFor(focusedBrowserWindow())
  saveBrowserWindowsSession(saved, focused ? Math.max(0, windows.indexOf(focused)) : saved.length - 1)
}

function windowGeometry(window: BaseWindow): SavedWindowState | null {
  if (window.isDestroyed()) return null
  try {
    return { bounds: window.getNormalBounds(), maximized: window.isMaximized(), fullScreen: window.isFullScreen() }
  } catch {
    return null
  }
}

function toggleTabBookmark(id: string): void {
  const tab = getTab(id)
  if (!tab) return
  const url = currentUrl(tab)
  if (!normalizeHttpOrigin(url)) return
  if (isUrlBookmarked(url)) removeBookmarksForUrl(url)
  else bookmarkPage(url, pageTitle(tab), tab.faviconUrl, tab.isPrivate)
}

/** Cmd+D / the star: bookmark the page (into Favourites) and open the edit popover for it. */
function bookmarkTabAndEdit(id: string): void {
  const tab = getTab(id)
  if (!tab) return
  const result = bookmarkPage(currentUrl(tab), pageTitle(tab), tab.faviconUrl, tab.isPrivate)
  if (!result) return
  runInWindow(tab.win.window, () => sendToVisibleToolbarSurface('browser:bookmarks:edit-current', { id: result.node.id, created: result.created }))
}

/** Cmd+Shift+D: every regular (non-private) web tab into a new top-level folder. */
export function bookmarkAllBrowserTabs(w = currentWindowState()): { folderId: string; title: string; added: number } | null {
  if (!w) return null
  const browserBounds = w.browserBounds
  const pages = tabsInSidebarOrder(w)
    .filter((tab) => !tab.isPrivate && normalizeHttpOrigin(currentUrl(tab)))
    .map((tab) => ({ url: currentUrl(tab), title: pageTitle(tab) }))
  const stamp = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
  const result = bookmarkPagesInNewFolder(pages, `Tabs · ${stamp}`)
  if (!result) {
    flashLinkStatus('No web tabs to bookmark', browserBounds, undefined, w.window)
    return null
  }
  flashLinkStatus(`Bookmarked ${result.added} tab${result.added === 1 ? '' : 's'} in “${result.folder.title}”`, browserBounds, 2400, w.window)
  return { folderId: result.folder.id, title: result.folder.title, added: result.added }
}

function applyTabBounds(w: BrowserWindowState): void {
  const { browserBounds } = w
  const pageAreaShown = browserBounds.width > 0 && browserBounds.height > 0
  // A split on screen: every pane is visible, each in its own rect (split-view.ts does the math).
  const split = splitOf(activeTabOf(w))
  const layout = split && pageAreaShown ? splitPaneRects(browserBounds, split.sizes) : null
  for (const tab of w.tabs) {
    if (!tab.view) continue
    const pane = split ? split.tabIds.indexOf(tab.id) : -1
    const visible = tab.id === w.activeTabId || pane >= 0
    const bounds = layout && pane >= 0 ? layout.panes[pane] ?? browserBounds : browserBounds
    // Reader view stands in for the page while it is open; the page stays loaded off screen.
    const reader = readerViewFor(tab.view.webContents)
    // Only the page on screen stays in the window. A zero-size view still counts as visible on
    // macOS, so background tabs used to keep running rAF/timers at full speed and kept the GPU
    // process waking up; detached + hidden, Chromium throttles them like Chrome's background tabs.
    if (!w.window.isDestroyed()) {
      setPageViewOnScreen(w.window, tab.view, visible && pageAreaShown && !reader)
      if (reader) setPageViewOnScreen(w.window, reader, visible && pageAreaShown)
    }
    tab.view.setBounds(visible ? bounds : { x: 0, y: 0, width: 0, height: 0 })
    reader?.setBounds(visible ? bounds : { x: 0, y: 0, width: 0, height: 0 })
  }
  if (!w.window.isDestroyed()) {
    updateSplitSurface(w.window, split && layout ? { bounds: { ...browserBounds }, layout, focusedIndex: split.tabIds.indexOf(w.activeTabId ?? '') } : null)
  }
}

function cancelSleepTimer(tab: BrowserTab): void {
  if (tab.sleepTimer) clearTimeout(tab.sleepTimer)
  tab.sleepTimer = null
}

function hibernateTab(tab: BrowserTab): void {
  if (isTabOnScreen(tab) || !tab.view) return
  const contents = tab.view.webContents
  if (!contents.isDestroyed() && contents.isCurrentlyAudible()) {
    tab.sleepTimer = setTimeout(() => hibernateTab(tab), 60_000)
    return
  }
  tab.lastUrl = currentUrl(tab)
  tab.pendingUrl = tab.lastUrl
  disposeTabView(tab)
  persistOpenTabs()
  publishState(tab.win)
}

function scheduleTabSleep(tab: BrowserTab): void {
  cancelSleepTimer(tab)
  // An editor tab holds unsaved edits in memory, so it never sleeps.
  if (tabSleepMinutes === 0 || !tab.view || tab.extensionPageOrigin || tab.pdfEditor || isTabOnScreen(tab) || tab.inactiveSince === null) return
  const delay = Math.max(0, tabSleepMinutes * 60_000 - (Date.now() - tab.inactiveSince))
  tab.sleepTimer = setTimeout(() => hibernateTab(tab), delay)
}

function markTabInactive(tab: BrowserTab): void {
  tab.inactiveSince = Date.now()
  scheduleTabSleep(tab)
}

function openBackgroundTab(url: string, isPrivate = false, w = currentWindowState()): void {
  const id = createTab(url, selectedSearchEngine, false, false, true, false, undefined, undefined, isPrivate, false, w)
  if (id) persistOpenTabs()
}

function disposeTabView(tab: BrowserTab): void {
  cancelSleepTimer(tab)
  const view = tab.view
  if (!view) return
  // Clear the reference first so its destroyed event cannot remove the logical tab.
  tab.view = null
  detachNetworkInspector(view.webContents)
  if (!tab.win.window.isDestroyed()) setPageViewOnScreen(tab.win.window, view, false)
  if (!view.webContents.isDestroyed()) view.webContents.close()
  applyTabBounds(tab.win)
}

function ensureTabLoaded(tab: BrowserTab): void {
  if (tab.view || !isLiveWindow(tab.win)) return
  const target = tab.pendingUrl || tab.lastUrl || configuredStartPage()
  if (target === SURFFISH_QUICK_LINKS_URL) {
    tab.pendingUrl = ''
    return
  }
  tab.pendingUrl = target
  const view = createTabView(tab)
  if (!view) return
  tab.pendingUrl = ''
  if (isActiveTab(tab)) tab.inactiveSince = null
  applyTabBounds(tab.win)
  const contents = view.webContents
  // Private pages wait for their session's proxy/ad-block setup so nothing ever goes out direct.
  const ready = tab.isPrivate && !tab.pdfEditor ? whenPrivateSessionReady() : Promise.resolve()
  const restore = tab.restoreHistory
  tab.restoreHistory = null
  void ready.then(() => contents.isDestroyed() ? undefined : restore ? contents.navigationHistory.restore(restore) : contents.loadURL(target)).catch((error: unknown) => {
    if (tab.view?.webContents !== contents) return
    const message = error instanceof Error ? error.message : String(error)
    if (!tab.downloadStartedForCurrentLoad && message.includes('ERR_FAILED')) {
      return new Promise<void>((resolve) => setTimeout(resolve, 100)).then(() => {
        if (tab.view?.webContents !== contents) return
        if (tab.downloadStartedForCurrentLoad) tab.error = null
        else tab.error = message
        publishState(tab.win)
      })
    }
    if (tab.downloadStartedForCurrentLoad) {
      tab.error = null
      publishState(tab.win)
      return
    }
    tab.error = message
    publishState(tab.win)
  })
}

function activateTabInternal(id: string): boolean {
  const tab = getTab(id)
  if (!tab) return false
  const w = tab.win
  if (w.activeTabId !== id) cancelActiveMacTrackpadSwipe()
  const previous = activeTabOf(w)
  const wasOnScreen = onScreenTabIds(w)
  if (previous && previous.id !== id) {
    hideLinkStatus(false, w.window)
    if (w.findState.open) closeFindBar(false, w)
  }
  // Best effort: grab the outgoing tab while it is still on screen for the tab overview.
  if (previous && previous.id !== id) void captureTabThumbnail(previous)
  w.activeTabId = id
  w.recentTabIds = noteRecentTab(w.recentTabIds, id)
  // Everything that left the screen starts its sleep clock; everything on it (both panes of a split) wakes.
  const nowOnScreen = onScreenTabIds(w)
  for (const goneId of wasOnScreen) {
    const gone = nowOnScreen.includes(goneId) ? undefined : findTab(goneId)
    if (gone && gone.win === w) markTabInactive(gone)
  }
  const shown = nowOnScreen.map((shownId) => findTab(shownId)).filter((candidate): candidate is BrowserTab => candidate?.win === w)
  for (const pane of shown) {
    cancelSleepTimer(pane)
    pane.inactiveSince = null
    pane.pauseAutoplayUntilVisited = false
    ensureTabLoaded(pane)
  }
  // Attach the view before focusing it; a detached view can't take focus.
  applyTabBounds(w)
  for (const pane of shown) {
    const paneContents = pane.view?.webContents
    if (pane !== tab && paneContents && !paneContents.isDestroyed()) paneContents.send(BACKGROUND_YOUTUBE_AUTOPLAY_ALLOW_CHANNEL)
  }
  const contents = tab.view?.webContents
  if (contents && !contents.isDestroyed()) {
    contents.send(BACKGROUND_YOUTUBE_AUTOPLAY_ALLOW_CHANNEL)
    // With Reader view open the keyboard belongs to the article, not the page under it.
    const focusTarget = readerViewFor(contents)?.webContents ?? contents
    focusTarget.focus()
    recoverCrashedTabOnActivate(contents)
  }
  applyTabBounds(w)
  publishState(w)
  return true
}

function showTabContextMenu(contents: WebContents, event: Event, params: ContextMenuParams): void {
  const tab = tabForContents(contents)
  const w = tab?.win ?? windowStateFor(getShellWindowFor(contents))
  if (!isLiveWindow(w)) return
  const isBrowserPage = tab !== undefined
  const editorTab = tab?.pdfEditor ? tab : undefined
  const origin = isBrowserPage ? { x: w.browserBounds.x, y: w.browserBounds.y } : getMainRendererOrigin(contents) ?? { x: 0, y: 0 }
  showBrowserContextMenu(event, contents, params, {
    window: w.window,
    pageActions: isBrowserPage,
    offsetX: origin.x,
    offsetY: origin.y,
    searchEngine: selectedSearchEngine,
    openInNewTab: (url) => {
      const id = createTab(url, selectedSearchEngine, true, false, false, false, undefined, undefined, false, false, w)
      if (id) persistOpenTabs()
    },
    openInBackgroundTab: (url) => openBackgroundTab(url, false, w),
    pdfDocument: isBrowserPage && isShowingPdf(contents),
    printPage: isBrowserPage ? () => { void printPdf(contents).catch((error: unknown) => console.warn('Could not print:', error)) } : undefined,
    editPdf: isBrowserPage && editorTab === undefined ? () => { if (tab) openPdfEditor(tab.id) } : undefined,
    pdfEditor: editorTab ? {
      save: () => sendPdfEditorCommand(contents, 'save'),
      backToViewer: () => { closePdfEditor(editorTab.id) }
    } : undefined,
    takeScreenshot: isBrowserPage && isActiveTab(tab) ? () => { void runInWindow(tab.win.window, () => takeScreenshot('choose')) } : undefined,
    readerView: isBrowserPage && editorTab === undefined && readerStateFor(contents) !== null ? () => { void toggleReaderMode(contents) } : undefined,
    // Never offered for private tabs: a watcher would re-fetch the page outside the private session.
    watchPage: isBrowserPage && editorTab === undefined && tab && !tab.isPrivate && canWatchPage(contents.getURL())
      ? (mode) => { void watchPageFromTab(contents, mode, pageTitle(tab)) }
      : undefined
  })
}

type TabMenuExtrasProvider = (id: string) => MenuItemConstructorOptions[]
let tabMenuExtrasProvider: TabMenuExtrasProvider | null = null

/** Extra tab context-menu items from feature modules (tab archive) that import this file. */
export function setBrowserTabMenuExtras(provider: TabMenuExtrasProvider | null): void {
  tabMenuExtrasProvider = provider
}

function tabMenuExtras(id: string): MenuItemConstructorOptions[] {
  try {
    return tabMenuExtrasProvider?.(id) ?? []
  } catch (error) {
    console.warn('Tab menu extras failed:', error)
    return []
  }
}

function showBrowserTabContextMenu(id: string): void {
  const tab = getTab(id)
  if (!tab || !isLiveWindow(tab.win)) return
  const { tabs, activeTabId } = tab.win
  const origin = normalizeHttpOrigin(currentUrl(tab))
  const bookmarked = Boolean(origin && isUrlBookmarked(currentUrl(tab)))
  const items: MenuItemConstructorOptions[] = [
    { label: bookmarked ? 'Remove Bookmark' : 'Bookmark Tab', ...tabMenuAccelerator('bookmark'), enabled: Boolean(origin), click: () => toggleTabBookmark(id) },
    { label: 'Bookmark All Tabs…', ...tabMenuAccelerator('bookmarkAllTabs'), click: () => { bookmarkAllBrowserTabs() } },
    { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', ...tabMenuAccelerator('pin'), click: () => setBrowserTabPinned(id, !tab.pinned) },
    { label: 'Duplicate Tab', ...tabMenuAccelerator('duplicate'), click: () => { void duplicateBrowserTab(id) } },
    { label: 'Copy Link', ...tabMenuAccelerator('copyLink'), enabled: Boolean(origin), click: () => clipboard.writeText(currentUrl(tab)) },
    { label: 'Copy Clean Link', ...tabMenuAccelerator('copyCleanLink'), enabled: Boolean(origin), click: () => clipboard.writeText(cleanLinkUrl(currentUrl(tab))) },
    { type: 'separator' },
    { label: 'Reload Tab', ...tabMenuAccelerator('reload'), click: () => reloadBrowserTab(id) },
    { label: 'Suspend Tab', enabled: !isTabOnScreen(tab) && tab.view !== null, click: () => { suspendBrowserTab(id) } },
    { label: 'Suspend Other Tabs', enabled: tabs.some((candidate) => candidate.id !== id && candidate.id !== activeTabId && !isTabOnScreen(candidate) && candidate.view !== null), click: () => suspendOtherBrowserTabs(id) },
    { type: 'separator' },
    // Feature items bring their own trailing separator.
    ...tabMenuExtras(id),
    { label: 'Close Tab', ...tabMenuAccelerator('close'), click: () => closeBrowserTab(id) },
    { label: 'Close Tabs Above', enabled: tabs.some((_candidate, index) => index < tabs.findIndex((entry) => entry.id === id)), click: () => closeBrowserTabsRelative(id, 'above') },
    { label: 'Close Tabs Below', enabled: tabs.some((_candidate, index) => index > tabs.findIndex((entry) => entry.id === id)), click: () => closeBrowserTabsRelative(id, 'below') },
    { label: 'Close Other Tabs', ...tabMenuAccelerator('closeOthers'), enabled: tabs.length > 1, click: () => closeBrowserTabsRelative(id, 'others') },
    { type: 'separator' },
    ...splitTabMenuItems(tab),
    ...moveTabMenuItems(tab)
  ]
  Menu.buildFromTemplate(items).popup({ window: tab.win.window })
}

/** "Move to New Window" plus one "Move to <window>" per other window the tab may go to. */
function moveTabMenuItems(tab: BrowserTab): MenuItemConstructorOptions[] {
  const targets = windowStates.filter((w) => w !== tab.win && isLiveWindow(w) && canMoveTabTo(tab, w))
  return [
    { label: 'Move to New Window', enabled: tab.win.tabs.length > 1, click: () => { moveBrowserTabToNewWindow(tab.id) } },
    ...targets.map((w): MenuItemConstructorOptions => ({
      label: `Move to ${browserWindowLabel(w.window)}`,
      click: () => { moveBrowserTabToWindow(tab.id, w.window) }
    }))
  ]
}

function resolveBrowserViewPreload(): string | null {
  const preload = 'mac-trackpad-swipe.cjs'
  const mainDirectory = dirname(fileURLToPath(import.meta.url))
  const appPath = app.getAppPath()
  const candidates = [
    join(mainDirectory, '../preload', preload),
    join(mainDirectory, '../../preload', preload),
    join(appPath, 'out/preload', preload),
    join(appPath, 'src/preload', preload)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Google rejects sign-in inside Electron ("This browser or app may not be
 * secure"). Hand its sign-in pages to the native WebKit helper, import the
 * session it returns, then continue where the page was headed.
 */
let lastGoogleSignInImportAt = 0
const GOOGLE_SIGN_IN_LOOP_GUARD_MS = 2 * 60 * 1000
// The cancelled load a hand-off leaves behind is not an address error.
const googleHandOffAt = new WeakMap<Electron.WebContents, number>()

function handOffGoogleSignIn(contents: Electron.WebContents, url: string): boolean {
  if (!isWebKitGoogleSignInAvailable() || !shouldHandOffSignIn(url, hasGoogleSessionCookie())) return false
  // If Google sends us straight back to sign-in right after an import, it did
  // not accept the session in Electron; don't trap the user in a pop-up loop.
  if (Date.now() - lastGoogleSignInImportAt < GOOGLE_SIGN_IN_LOOP_GUARD_MS) {
    console.warn('[google sign-in] Google asked for sign-in again right after an import; leaving it in the tab.')
    return false
  }
  const continueUrl = signInContinueUrl(url)
  googleHandOffAt.set(contents, Date.now())
  void runWebKitGoogleSignIn(continueUrl).then((result) => {
    if (contents.isDestroyed()) return
    if (result === 'signed-in') {
      lastGoogleSignInImportAt = Date.now()
      void contents.loadURL(continueUrl).catch(() => {})
    }
    else if (result === 'failed') console.warn('[google sign-in] WebKit sign-in failed; the session was not imported.')
  })
  return true
}

function createTabView(tab: BrowserTab): WebContentsView | null {
  if (!isLiveWindow(tab.win)) return null
  if (tab.pdfEditor) return createPdfEditorView(tab)
  const needsBrowserViewPreload = process.platform === 'darwin' || tab.pauseAutoplayUntilVisited
  const browserViewPreload = needsBrowserViewPreload ? resolveBrowserViewPreload() : null
  const preload = tab.extensionPreloadPath ?? browserViewPreload
  const view = new WebContentsView({
    webPreferences: {
      ...(preload ? { preload } : {}),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Run the session's sandboxed ad-filter preload in iframes too, so
      // embedded players (YouTube embeds) and ad frames get scriptlets/CSS.
      // Remote pages still get no Node.js: sandbox stays on.
      nodeIntegrationInSubFrames: true,
      ...(tab.isPrivate ? { session: getPrivateSession() } : { partition: BROWSER_SESSION_PARTITION }),
      // On for every tab; the session decides (private tabs: off unless the user opts in).
      spellcheck: true,
      // Explicit: background tabs must be throttled (timers, rAF) once they leave the screen.
      backgroundThrottling: true
    }
  })
  tab.view = view
  // Site tabs are always below the local toolbar, sidebar, and full-app surfaces. applyTabBounds
  // attaches the view (at index 0) only while it is the tab on screen.
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

  const contents = view.webContents
  bindContentsToWindow(contents, tab.win.window)
  attachNetworkInspector(tab.id, contents)
  attachTabSafety(contents)
  if (!tab.extensionPageOrigin) attachReaderDetection(contents)
  const isCurrentContents = (): boolean => tab.view?.webContents === contents
  contents.on('before-mouse-event', (_event, mouseEvent) => {
    if (!isCurrentContents()) return
    if (tab.win.splits.length > 0) {
      notifySplitPagePointer(tab.win.window, mouseEvent)
      // Clicking the other pane of a split focuses it.
      if (mouseEvent.type === 'mouseDown' && !isActiveTab(tab) && isTabOnScreen(tab)) focusSplitPane(tab.id, false)
    }
    if (!isActiveTab(tab)) {
      if (mouseEvent.type === 'mouseMove' && isTabOnScreen(tab)) avoidLinkStatusPointer(mouseEvent.x, mouseEvent.y, tab.win.window)
      return
    }
    // The sidebar reveal reads window x; a split pane's view doesn't start at the page area's left edge.
    const offsetX = pageBoundsOf(tab).x - tab.win.browserBounds.x
    handleBrowserPageMouseEvent(offsetX ? { type: mouseEvent.type, x: mouseEvent.x + offsetX } : mouseEvent, tab.win.window)
    if (mouseEvent.type === 'mouseMove') avoidLinkStatusPointer(mouseEvent.x, mouseEvent.y, tab.win.window)
    if (isCopyImageClick(mouseEvent)) {
      void copyImageAtPoint(contents, mouseEvent.x, mouseEvent.y).then((copied) => {
        if (copied) flashLinkStatus('Image copied', pageBoundsOf(tab), undefined, tab.win.window)
      })
    }
  })
  // Keyboard focus landing in the other pane (Tab key, a page focusing itself on click) focuses that pane.
  contents.on('focus', () => {
    if (isCurrentContents() && !isActiveTab(tab) && isTabOnScreen(tab)) focusSplitPane(tab.id, false)
  })
  contents.on('update-target-url', (_event, url) => {
    if (isTabOnScreen(tab) && isCurrentContents()) showLinkStatus(url, pageBoundsOf(tab), tab.win.window)
  })
  contents.on('found-in-page', (_event, result) => {
    const { findState } = tab.win
    if (!isCurrentContents() || findState.tabId !== tab.id || !findState.open) return
    findState.result = { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches, finalUpdate: result.finalUpdate }
    publishFindState(tab.win)
  })
  // Ctrl/Cmd + mouse wheel (and Windows precision-touchpad zoom) step the page zoom like Chrome.
  contents.on('zoom-changed', (_event, direction) => {
    if (isCurrentContents()) zoomTab(tab, direction === 'in' ? 'in' : 'out')
  })
  contents.on('context-menu', (event, params) => showTabContextMenu(contents, event, params))
  // A background tab whose renderer died (crash, OOM, or "Kill process" in Task Manager) goes to
  // sleep instead of holding a dead view; selecting it reloads it. The active tab keeps its view
  // so Reload works in place.
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || !isCurrentContents() || isTabOnScreen(tab)) return
    setImmediate(() => {
      if (isCurrentContents() && !isTabOnScreen(tab)) hibernateTab(tab)
    })
  })
  guardPageDragRegions(contents)
  contents.on('media-started-playing', () => {
    if (!isCurrentContents() || !tab.pauseAutoplayUntilVisited || isTabOnScreen(tab) || contents.isDestroyed()) return
    void contents.executeJavaScript(`
      for (const media of document.querySelectorAll('video, audio')) {
        if (!media.paused && !media.ended) media.pause()
      }
    `).catch(() => undefined)
  })
  // Electron disables visual pinch-zoom by default; enable it for trackpads (macOS and Windows precision touchpads).
  void contents.setVisualZoomLevelLimits(1, 3).catch(() => {})
  contents.setWindowOpenHandler((details) => {
    if (tab.extensionPageOrigin && tab.extensionPreloadPath && isBrambleExtensionUrl(details.url, tab.extensionPageOrigin)) {
      openExtensionPageTab(details.url, tab.extensionPageOrigin, tab.extensionPreloadPath, tab.extensionPageOwner ?? 'bramble')
      return { action: 'deny' }
    }
    const target = resolveNavigationTarget(details.url, selectedSearchEngine)
    if (target && /^https?:\/\//i.test(target)) {
      if (tab.extensionPageOwner === 'web-store') {
        // Links from an extension's options page open as ordinary Surffish tabs.
        if (createTab(target, selectedSearchEngine, details.disposition !== 'background-tab', false, false, false, undefined, undefined, false, false, tab.win)) persistOpenTabs()
      } else if (details.disposition === 'background-tab') {
        openBackgroundTab(target, tab.isPrivate, tab.win)
      } else if (details.disposition === 'foreground-tab' || getBrowserSiteSettings(contents.getURL())?.openPopupsInTabs) {
        // target=_blank links (and window.open without popup features) are 'foreground-tab': open them
        // like a normal new tab. Only real popups ('new-window', with size features) stay behind the site toggle.
        const popupTabId = createTab(target, selectedSearchEngine, true, false, false, false, undefined, undefined, tab.isPrivate, false, tab.win)
        if (popupTabId) persistOpenTabs()
      }
    }
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, inputEvent) => {
    if (isFocusAddressShortcut(inputEvent)) {
      event.preventDefault()
      sendFocusAddressToVisibleRenderer(tab.win.window)
      return
    }
    if (inputEvent.type !== 'keyDown' || (!inputEvent.control && !inputEvent.meta)) return
    if (handleBrowserShortcutInput(inputEvent, tab.id)) event.preventDefault()
  })
  contents.on('will-navigate', (event, url) => {
    if (isExtensionPage(tab, url)) return
    if (!resolveNavigationTarget(url) || !/^https?:\/\//i.test(url)) return event.preventDefault()
    if (!tab.isPrivate && handOffGoogleSignIn(contents, url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (!/^https?:\/\//i.test(url) && !isExtensionPage(tab, url)) return event.preventDefault()
    if (isMainFrame && !tab.isPrivate && handOffGoogleSignIn(contents, url)) event.preventDefault()
  })
  contents.on('audio-state-changed', () => {
    if (!isCurrentContents()) return
    publishTabs(tab.win)
  })
  contents.on('did-start-loading', () => {
    if (!isCurrentContents()) return
    tab.error = null
    publishState(tab.win)
  })
  contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (isCurrentContents() && isMainFrame && !isInPlace) tab.showingPdf = false
    if (!isCurrentContents() || !isMainFrame || (!/^https?:\/\//i.test(url) && !isExtensionPage(tab, url))) return
    if (!isInPlace && isActiveTab(tab)) hideLinkStatus(false, tab.win.window)
    tab.downloadStartedForCurrentLoad = false
    tab.lastUrl = url
    tab.faviconUrl = /^https?:\/\//i.test(url) ? getCachedBrowserSiteFavicon(url) : null
    tab.faviconRevision += 1
    persistOpenTabs()
    publishTabs(tab.win)
  })
  contents.on('page-favicon-updated', (_event, favicons) => {
    if (!isCurrentContents()) return
    const pageUrl = contents.getURL()
    if (!/^https?:\/\//i.test(pageUrl)) return
    const faviconUrl = favicons
      .map((candidate) => normalizeFaviconUrl(candidate) ?? normalizeCachedFaviconDataUrl(candidate))
      .find((candidate): candidate is string => candidate !== null)
    if (!faviconUrl) return
    const revision = ++tab.faviconRevision
    if (!tab.isPrivate) persistPageFavicon(pageUrl, faviconUrl)
    if (tab.faviconUrl !== faviconUrl) {
      tab.faviconUrl = faviconUrl
      publishTabs(tab.win)
    }
    if (!tab.isPrivate) void cachePageFavicon(pageUrl, faviconUrl).then((cachedIcon) => {
      if (!cachedIcon || tab.view?.webContents !== contents || tab.faviconRevision !== revision || contents.getURL() !== pageUrl) return
      if (tab.faviconUrl !== cachedIcon) {
        tab.faviconUrl = cachedIcon
        publishTabs(tab.win)
      }
    })
  })
  contents.on('did-stop-loading', () => {
    if (!isCurrentContents()) return
    tab.showingPdf = isShowingPdf(contents)
    publishState(tab.win)
    refreshTabFavicon(tab)
  })
  // The built-in PDF viewer is a child frame; notice it (and its absence) as soon as frames load.
  contents.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (!isCurrentContents() || isMainFrame) return
    const showingPdf = isShowingPdf(contents)
    if (showingPdf === tab.showingPdf) return
    tab.showingPdf = showingPdf
    if (isActiveTab(tab)) publishState(tab.win)
  })
  contents.on('did-navigate', (_event, url) => {
    if (!isCurrentContents()) return
    applySavedZoom(tab, url)
    const { findState } = tab.win
    if (findState.open && findState.tabId === tab.id) {
      // A new document: the old matches are gone, so search the new page for the same text.
      findState.result = null
      if (findState.text) contents.findInPage(findState.text, { findNext: true })
      publishFindState(tab.win)
    }
    tab.lastUrl = url
    persistOpenTabs()
    publishState(tab.win)
    if (!tab.isPrivate && /^https?:\/\//i.test(url)) {
      recordBrowsingVisit(url, pageTitle(tab))
      notifyHistoryChanged()
    }
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame) return
    resetMacTrackpadSwipeFor(contents)
    tab.lastUrl = url
    persistOpenTabs()
    publishState(tab.win)
    if (!tab.isPrivate && /^https?:\/\//i.test(url)) {
      recordBrowsingVisit(url, pageTitle(tab))
      notifyHistoryChanged()
    }
  })
  contents.on('page-title-updated', (_event, title) => {
    if (!isCurrentContents()) return
    if (!tab.isPrivate) updateLatestVisitTitle(contents.getURL(), title)
    publishState(tab.win)
    refreshTabFavicon(tab)
    notifyHistoryChanged()
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame) return
    resetMacTrackpadSwipeFor(contents)
    if (errorCode === -3) return
    if (tab.downloadStartedForCurrentLoad) {
      tab.error = null
      publishState(tab.win)
      return
    }
    tab.error = `${errorDescription} (${errorCode})`
    publishState(tab.win)
  })
  contents.on('did-stop-loading', () => {
    setTimeout(() => {
      // Overview open and tab switches capture fresh shots anyway; only seed tabs that have none,
      // so ordinary page loads don't pay for a full-page capture + JPEG encode on the main thread.
      if (isCurrentContents() && isActiveTab(tab) && !isTabOverviewOpen(tab.win.window) && !tabThumbnails.has(tab.id)) void captureTabThumbnail(tab)
    }, 700)
  })
  contents.on('destroyed', () => {
    if (activeMacTrackpadSwipe?.contents === contents) {
      activeMacTrackpadSwipe = null
      nextMacTrackpadSwipeToken += 1
    }
    detachNetworkInspector(contents)
    if (!isCurrentContents()) return
    removeDestroyedTab(tab)
  })
  return view
}

/** A tab's page went away underneath it (not through closeBrowserTab): drop the tab and pick another. */
function removeDestroyedTab(tab: BrowserTab): void {
  const w = tab.win
  const index = w.tabs.findIndex((candidate) => candidate.id === tab.id)
  if (index < 0) return
  const { groups, partners } = removeTabFromSplits(w.splits, tab.id)
  w.splits = groups
  w.tabs.splice(index, 1)
  if (w.activeTabId === tab.id) {
    w.activeTabId = null
    const replacement = findTab(partners[0]) ?? w.tabs[Math.min(index, w.tabs.length - 1)]
    if (replacement) activateTabInternal(replacement.id)
    else if (isLiveWindow(w)) newBrowserTab(undefined, undefined, w)
  }
  publishState(w)
}

/**
 * The PDF editor runs in a tab of its own kind: the isolated editor session (no network, the
 * surffish-pdf:// scheme only), its narrow preload, and no page-level extras (ad-filter preload,
 * swipe preload, network inspector). Only main ever navigates it.
 */
function createPdfEditorView(tab: BrowserTab): WebContentsView | null {
  if (!isLiveWindow(tab.win)) return null
  const preload = pdfEditorPreloadPath()
  if (!preload) {
    console.warn('[pdf editor] preload missing; editor unavailable')
    return null
  }
  const view = new WebContentsView({
    webPreferences: {
      preload,
      session: getPdfEditorSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nodeIntegrationInSubFrames: false,
      spellcheck: !tab.isPrivate,
      backgroundThrottling: true
    }
  })
  tab.view = view
  // Attached by applyTabBounds while on screen, like site views.
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  const contents = view.webContents
  bindContentsToWindow(contents, tab.win.window)
  const isCurrentContents = (): boolean => tab.view?.webContents === contents
  contents.on('context-menu', (event, params) => showTabContextMenu(contents, event, params))
  contents.on('before-mouse-event', (_event, mouseEvent) => {
    if (isActiveTab(tab) && isCurrentContents()) handleBrowserPageMouseEvent(mouseEvent, tab.win.window)
  })
  contents.on('before-input-event', (event, inputEvent) => {
    if (inputEvent.type !== 'keyDown' || (!inputEvent.control && !inputEvent.meta)) return
    // Cmd/Ctrl+S saves here (and only here), so the page and the app menu never both fire.
    // Cmd/Ctrl+Shift+S falls through to the screenshot shortcut.
    if (inputEvent.key.toLowerCase() === 's' && !inputEvent.alt && !inputEvent.shift) {
      event.preventDefault()
      if (!inputEvent.isAutoRepeat) sendPdfEditorCommand(contents, 'save')
      return
    }
    if (handleBrowserShortcutInput(inputEvent, tab.id)) event.preventDefault()
  })
  // Links inside the PDF open as ordinary tabs; the editor page itself never navigates.
  contents.setWindowOpenHandler((details) => {
    const target = resolveNavigationTarget(details.url, selectedSearchEngine)
    if (target && /^https?:\/\//i.test(target)) {
      const id = createTab(target, selectedSearchEngine, details.disposition !== 'background-tab', false, false, false, undefined, undefined, tab.isPrivate, false, tab.win)
      if (id) persistOpenTabs()
    }
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event, url) => { if (!isPdfEditorUrl(url)) event.preventDefault() })
  contents.on('did-start-loading', () => {
    if (!isCurrentContents()) return
    tab.error = null
    publishState(tab.win)
  })
  contents.on('did-stop-loading', () => { if (isCurrentContents()) publishState(tab.win) })
  contents.on('page-title-updated', () => { if (isCurrentContents()) publishState(tab.win) })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame || errorCode === -3) return
    tab.error = `${errorDescription} (${errorCode})`
    publishState(tab.win)
  })
  contents.on('render-process-gone', () => {
    // A crashed editor has lost its edits either way; don't nag on close.
    if (isCurrentContents() && tab.pdfEditor) tab.pdfEditor.dirty = false
  })
  contents.on('destroyed', () => {
    if (!isCurrentContents()) return
    removeDestroyedTab(tab)
  })
  return view
}

/** Swap a tab's view: the PDF editor in place of the page, or back. Navigation history is not kept. */
function replaceTabView(tab: BrowserTab, editor: PdfEditorTabState | null, url: string): void {
  disposeTabView(tab)
  tab.pdfEditor = editor
  tab.showingPdf = false
  tab.error = null
  tab.lastUrl = editor ? editor.sourceUrl : url
  tab.pendingUrl = url
  if (isActiveTab(tab)) {
    ensureTabLoaded(tab)
    applyTabBounds(tab.win)
    const contents = tab.view?.webContents
    if (contents && !contents.isDestroyed()) contents.focus()
  }
  persistOpenTabs()
  publishState(tab.win)
}

/** Edit PDF: open the PDF the tab shows in the bundled pdf.js editor. */
export function openPdfEditor(id = getTab()?.id): boolean {
  const tab = id ? getTab(id) : undefined
  const contents = tab?.view?.webContents
  if (!tab || tab.pdfEditor || tab.extensionPageOrigin || !contents || contents.isDestroyed() || !isShowingPdf(contents)) return false
  const sourceUrl = contents.getURL()
  if (!isEditablePdfSource(sourceUrl)) return false
  replaceTabView(tab, { sourceUrl, name: pdfNameFromUrl(sourceUrl), dirty: false }, PDF_EDITOR_URL)
  return true
}

function allowLeavingPdfEditor(tab: BrowserTab, action: string): boolean {
  if (!tab.pdfEditor?.dirty) return true
  return confirmDiscardPdfEdits(tab.win.window, tab.pdfEditor.name, action)
}

/** Back to viewer: reload the original PDF in the built-in viewer (asks first if there are unsaved edits). */
export function closePdfEditor(id = getTab()?.id): boolean {
  const tab = id ? getTab(id) : undefined
  if (!tab?.pdfEditor) return false
  if (!allowLeavingPdfEditor(tab, 'Discard Changes')) return false
  replaceTabView(tab, null, tab.pdfEditor.sourceUrl)
  return true
}

/** App menu / toolbar: Edit PDF on a PDF, Back to Viewer in the editor. */
export function togglePdfEditor(): boolean {
  const tab = getTab()
  if (!tab) return false
  return tab.pdfEditor ? closePdfEditor(tab.id) : openPdfEditor(tab.id)
}

/** App menu Save while the editor is the active tab. */
export function savePdfEditor(): boolean {
  const contents = getTab()?.pdfEditor ? getTab()?.view?.webContents : null
  if (!contents || contents.isDestroyed()) return false
  sendPdfEditorCommand(contents, 'save')
  return true
}

function hasUnsavedPdfEdits(w: BrowserWindowState): BrowserTab[] {
  return w.tabs.filter((tab) => tab.pdfEditor?.dirty)
}

function pdfEditorTabFor(contents: WebContents): BrowserTab | undefined {
  const tab = tabForContents(contents)
  return tab?.pdfEditor ? tab : undefined
}

function tabForPage(contents: WebContents): BrowserTab | undefined {
  return tabForContents(contents)
}

attachReaderHost({
  activePage: () => getActiveTabWebContents(),
  isPrivate: (page) => tabForPage(page)?.isPrivate ?? false,
  changed: (page) => {
    const tab = tabForPage(page)
    if (!tab) return
    applyTabBounds(tab.win)
    if (isActiveTab(tab)) publishState(tab.win)
  },
  handleShortcut: (page, input) => {
    const tab = tabForPage(page)
    return tab ? handleBrowserShortcutInput(input, tab.id) : false
  },
  openInNewTab: (page, url, background) => {
    const tab = tabForPage(page)
    const isPrivate = tab?.isPrivate ?? false
    if (background) openBackgroundTab(url, isPrivate, tab?.win)
    else if (createTab(url, selectedSearchEngine, true, false, false, false, undefined, undefined, isPrivate, false, tab?.win ?? currentWindowState())) persistOpenTabs()
  },
  notify: (message) => {
    const w = currentWindowState()
    if (w) flashLinkStatus(message, w.browserBounds, 2400, w.window)
  },
  window: (page) => (page ? tabForPage(page)?.win.window : currentWindowState()?.window) ?? null
})

attachPdfEditor({
  documentFor: (contents) => {
    const tab = pdfEditorTabFor(contents)
    if (!tab?.pdfEditor) return null
    return {
      sourceUrl: tab.pdfEditor.sourceUrl,
      name: tab.pdfEditor.name,
      isPrivate: tab.isPrivate,
      sourceSession: tab.isPrivate ? getPrivateSession() : getBrowserSession()
    }
  },
  setDirty: (contents, dirty) => {
    const tab = pdfEditorTabFor(contents)
    if (!tab?.pdfEditor || tab.pdfEditor.dirty === dirty) return
    tab.pdfEditor.dirty = dirty
    publishState(tab.win)
  },
  backToViewer: (contents) => {
    const tab = pdfEditorTabFor(contents)
    if (tab) closePdfEditor(tab.id)
  },
  window: () => currentWindowState()?.window ?? null
})

export interface ExtensionPageTabOptions {
  extensionUrl: string
  preloadPath: string
  owner: ExtensionPageOwner
}

function createTab(input?: string, engine: SearchEngineId = selectedSearchEngine, activate = true, deferLoad = false, pauseAutoplayUntilVisited = false, pinned = false, extensionPage?: ExtensionPageTabOptions, insertAt?: number, isPrivate = false, allowLocalDocument = false, targetWindow: BrowserWindowState | undefined = currentWindowState()): string | null {
  const w = targetWindow
  if (!isLiveWindow(w)) return null
  const { tabs } = w
  // Every page tab in a private window is private; with no address it opens the private New Tab.
  const makePrivate = (isPrivate || w.isPrivate) && !extensionPage
  const requested = input ?? (w.isPrivate && !extensionPage ? SURFFISH_QUICK_LINKS_URL : undefined)
  const target = extensionPage && requested
    ? requested
    : allowLocalDocument && requested && isLocalDocumentUrl(requested)
    ? requested
    : requested === SURFFISH_QUICK_LINKS_URL
    ? SURFFISH_QUICK_LINKS_URL
    : requested ? resolveAddressInput(requested, engine) ?? configuredStartPage(engine) : configuredStartPage(engine)
  const previous = activeTabOf(w)
  const shouldActivate = activate || w.activeTabId === null
  const tab: BrowserTab = {
    id: randomUUID(),
    win: w,
    view: null,
    faviconUrl: getCachedBrowserSiteFavicon(target),
    faviconRevision: 0,
    error: null,
    downloadStartedForCurrentLoad: false,
    pauseAutoplayUntilVisited: !shouldActivate && pauseAutoplayUntilVisited && isYouTubeUrl(target),
    lastUrl: target,
    pendingUrl: target,
    pinned,
    inactiveSince: null,
    sleepTimer: null,
    pageScrollEdges: { ...UNKNOWN_PAGE_SCROLL_EDGES },
    pageScale: 1,
    extensionPageOrigin: extensionPage?.extensionUrl ?? null,
    extensionPreloadPath: extensionPage?.preloadPath ?? null,
    extensionPageOwner: extensionPage?.owner ?? null,
    isPrivate: makePrivate,
    showingPdf: false,
    pdfEditor: null,
    restoreHistory: null
  }
  // Insert in place (e.g. reopening a closed tab) so the renderer never sees an interim order.
  if (insertAt !== undefined && insertAt >= 0 && insertAt < tabs.length) tabs.splice(insertAt, 0, tab)
  else tabs.push(tab)
  if (shouldActivate) {
    // The new tab replaces whatever was on screen (a split's panes go off screen together).
    const wasOnScreen = previous ? onScreenTabIds(w) : []
    w.activeTabId = tab.id
    w.recentTabIds = noteRecentTab(w.recentTabIds, tab.id)
    for (const goneId of wasOnScreen) {
      const gone = findTab(goneId)
      if (gone && gone !== tab && gone.win === w) markTabInactive(gone)
    }
    tab.inactiveSince = null
  } else {
    tab.inactiveSince = Date.now()
  }
  if (!deferLoad) ensureTabLoaded(tab)
  applyTabBounds(w)
  if (!shouldActivate) scheduleTabSleep(tab)
  else tab.view?.webContents.focus()
  publishState(w)
  return tab.id
}

/** What a new window starts with. */
export interface BrowserWindowInit {
  /** A private window: all of its tabs are private and it is never saved. */
  private?: boolean
  /** Tabs to restore (a saved window from the session file). */
  session?: { urls: readonly string[]; activeIndex: number; pinnedIndexes: readonly number[]; splits?: readonly SavedSplit[] }
  /** Move this existing tab (no reload) into the new window instead of opening a New Tab. */
  adoptTabId?: string
}

let macSwipeStarted = false

export function attachBrowserView(win: BaseWindow, init: BrowserWindowInit = {}): void {
  if (windowStateFor(win)) return
  const w: BrowserWindowState = {
    window: win,
    tabs: [],
    activeTabId: null,
    browserBounds: { x: 0, y: 0, width: 0, height: 0 },
    findState: { tabId: null, open: false, text: '', result: null },
    confirmingWindowClose: false,
    isPrivate: init.private === true,
    splits: [],
    recentTabIds: []
  }
  windowStates.push(w)
  tabSleepMinutes = getBrowserTabSleepMinutes()
  for (const contents of getWindowRenderers(win)) {
    contents.on('context-menu', (event, params) => {
      event.preventDefault()
      const x = Number.isFinite(params.x) ? Math.round(params.x) : 0
      const y = Number.isFinite(params.y) ? Math.round(params.y) : 0
      // A split entry's halves carry their own tab id (data-browser-pane-id) inside the row's.
      const script = `(() => { const el = document.elementFromPoint(${x}, ${y})?.closest('[data-browser-pane-id],[data-browser-tab-id]'); return el?.getAttribute('data-browser-pane-id') ?? el?.getAttribute('data-browser-tab-id') ?? null })()`
      void contents.executeJavaScript(script, true).then((id: unknown) => {
        if (typeof id === 'string' && getTab(id)) showBrowserTabContextMenu(id)
        else showTabContextMenu(contents, event, params)
      }).catch(() => showTabContextMenu(contents, event, params))
    })
  }
  if (process.platform === 'darwin') {
    win.on('swipe', (_event, direction) => {
      const contents = activeTabOf(w)?.view?.webContents
      if (!contents) return
      if (direction === 'right' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
      else if (direction === 'left' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    })
  }
  const adopted = init.adoptTabId ? findTab(init.adoptTabId) : undefined
  if (adopted && adopted.win !== w && canMoveTabTo(adopted, w)) {
    // A split pane brings its whole split along (tear-out / Move to New Window of a split entry).
    moveTabsWithSplit(adopted, w, null)
  } else if (init.session && !w.isPrivate) {
    const saved = init.session
    const restoredAt = Date.now()
    const restoredIds: (string | null)[] = []
    saved.urls.forEach((url, index) => {
      const id = createTab(url, selectedSearchEngine, false, true, false, saved.pinnedIndexes.includes(index), undefined, undefined, false, false, w)
      restoredIds.push(id)
      // Keep "last used" across restarts so tab auto-archive counts real idle time, not time since launch.
      const tab = id ? getTab(id) : undefined
      if (tab) tab.inactiveSince = restoredTabInactiveSince(currentUrl(tab), restoredAt)
    })
    for (const split of saved.splits ?? []) {
      const ids = split.tabs.map((index) => restoredIds[index] ?? null)
      if (ids.some((id) => !id || !findTab(id) || findTab(id)?.pinned || splitGroupOf(w.splits, id))) continue
      const group = createSplitGroup(randomUUID(), ids as string[], split.sizes)
      if (group) w.splits.push(group)
    }
    w.activeTabId = restoredIds[saved.activeIndex] ?? w.tabs[0]?.id ?? null
  }
  if (w.tabs.length === 0) createTab(undefined, selectedSearchEngine, true, false, false, false, undefined, undefined, false, false, w)
  w.activeTabId ??= w.tabs[0]?.id ?? null
  if (w.activeTabId) w.recentTabIds = noteRecentTab(w.recentTabIds, w.activeTabId)
  // A restored split on screen loads every pane, not just the focused one.
  for (const id of onScreenTabIds(w)) {
    const pane = findTab(id)
    if (pane) ensureTabLoaded(pane)
  }
  const visibleAtStart = new Set(onScreenTabIds(w))
  const now = Date.now()
  for (const tab of w.tabs) {
    if (!visibleAtStart.has(tab.id)) {
      tab.inactiveSince ??= now
      scheduleTabSleep(tab)
    } else {
      tab.inactiveSince = null
    }
  }
  applyTabBounds(w)
  publishState(w)
  persistOpenTabs()
  if (process.platform === 'darwin' && !macSwipeStarted) {
    // One native monitor serves every window; each gesture names the window it landed in.
    macSwipeStarted = startMacTrackpadSwipe(win, {
      onBegin: beginMacTrackpadSwipe,
      onProgress: reportMacTrackpadSwipeProgress,
      onEnd: finishMacTrackpadSwipe,
      onPinch: handleMacTrackpadPinch
    })
  }
  attachTabOverview(win, {
    getItems: () => getTabOverviewItems(w),
    getPageBounds: () => ({ ...w.browserBounds }),
    activate: (id) => { activateBrowserTab(id) },
    closeTab: (id) => { closeBrowserTab(id) },
    newTab: () => { newBrowserTab(undefined, undefined, w) },
    focusPage: () => {
      const contents = activeTabOf(w)?.view?.webContents
      if (contents && !contents.isDestroyed()) contents.focus()
      else focusVisibleShellPage(win)
    },
    handleShortcut: (input) => runInWindow(win, () => handleBrowserShortcutInput(input))
  })
  attachScreenshots(win, {
    getTarget: () => {
      const tab = activeTabOf(w)
      const contents = tab?.view?.webContents
      if (!tab || !contents || contents.isDestroyed() || isLocalNewTab(tab)) return null
      return { contents, isPrivate: tab.isPrivate, url: currentUrl(tab) }
    },
    // In a split: the focused pane only.
    getPageBounds: () => { const tab = activeTabOf(w); return tab ? pageBoundsOf(tab) : { ...w.browserBounds } },
    focusPage: () => {
      const contents = activeTabOf(w)?.view?.webContents
      if (contents && !contents.isDestroyed()) contents.focus()
      else focusVisibleShellPage(win)
    },
    flash: (message) => { const tab = activeTabOf(w); flashLinkStatus(message, tab ? pageBoundsOf(tab) : w.browserBounds, 2000, win) },
    handleShortcut: (input) => runInWindow(win, () => handleBrowserShortcutInput(input))
  })
  attachSplitSurface(w)
  // Window moves and resizes go into the saved session too (debounced; the write itself is deferred).
  let geometryTimer: ReturnType<typeof setTimeout> | null = null
  const persistGeometry = (): void => {
    if (geometryTimer) clearTimeout(geometryTimer)
    geometryTimer = setTimeout(() => { geometryTimer = null; persistOpenTabs() }, 400)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) win.on(event as 'resize', persistGeometry)
  win.on('close', (event) => {
    if (geometryTimer) clearTimeout(geometryTimer)
    const unsaved = hasUnsavedPdfEdits(w)
    if (unsaved.length > 0) {
      const name = unsaved.length === 1 ? unsaved[0]!.pdfEditor!.name : `${unsaved.length} PDFs`
      if (!confirmDiscardPdfEdits(win, name, 'Close Window')) {
        event.preventDefault()
        // A cancelled close also cancels a quit, so keep saving the session.
        sessionFrozen = false
        return
      }
      for (const tab of unsaved) tab.pdfEditor!.dirty = false
    }
    persistOpenTabs()
  })
  win.on('closed', () => {
    const index = windowStates.indexOf(w)
    if (index < 0) return
    if (activeMacTrackpadSwipe && w.tabs.some((tab) => tab.view?.webContents === activeMacTrackpadSwipe?.contents)) cancelActiveMacTrackpadSwipe()
    detachTabOverview(win)
    detachScreenshots(win)
    destroyLinkStatus(win)
    windowStates.splice(index, 1)
    const closingTabs = [...w.tabs]
    w.tabs.length = 0
    w.splits = []
    w.activeTabId = null
    for (const tab of closingTabs) {
      cancelSleepTimer(tab)
      tabThumbnails.delete(tab.id)
      const view = tab.view
      tab.view = null
      if (view) {
        detachNetworkInspector(view.webContents)
        if (!view.webContents.isDestroyed()) view.webContents.close()
      }
    }
    if (windowStates.length === 0) {
      cancelActiveMacTrackpadSwipe()
      if (macSwipeStarted) stopMacTrackpadSwipe()
      macSwipeStarted = false
      newTabThumbnail = null
    }
    if (closingTabs.some((tab) => tab.isPrivate) && !allTabs().some((tab) => tab.isPrivate)) endPrivateSession()
    // Drop the window from the saved session; the last window's tabs stay saved for the next launch.
    persistOpenTabs()
    noteWindowTitles()
  })
}

// ---------------------------------------------------------------------------
// Windows: labels for menus, and moving tabs between windows (the view moves, the page never reloads).

type BrowserWindowFactory = (init: BrowserWindowInit & { position?: { x: number; y: number }; size?: { width: number; height: number } }) => BaseWindow | null
let browserWindowFactory: BrowserWindowFactory | null = null

/** window.ts registers how to open a window, so tab moves can tear a tab out into one. */
export function setBrowserWindowFactory(factory: BrowserWindowFactory | null): void {
  browserWindowFactory = factory
}

function pageTitleOfWindow(w: BrowserWindowState): string {
  const tab = activeTabOf(w)
  return tab ? pageTitle(tab) : 'New Tab'
}

/** "Window 2 — Example Domain" (private windows say so). */
export function browserWindowLabel(window: BaseWindow): string {
  const w = windowStateFor(window)
  const number = browserWindowNumber(window)
  const title = w ? pageTitleOfWindow(w) : 'Surffish'
  const short = title.length > 48 ? `${title.slice(0, 47)}…` : title
  return `${w?.isPrivate ? 'Private ' : ''}Window ${number > 0 ? number : ''} — ${short}`.replace('Window  —', 'Window —')
}

export function isPrivateBrowserWindow(window: BaseWindow | null | undefined): boolean {
  return Boolean(windowStateFor(window)?.isPrivate)
}

/** Private windows only take private tabs (a normal tab can't switch to the private session). */
function canMoveTabTo(tab: BrowserTab, w: BrowserWindowState): boolean {
  return !w.isPrivate || tab.isPrivate
}

/** Take a tab out of its window without closing it. The window picks another tab, or closes when it was the last. */
function detachTabFromWindow(tab: BrowserTab): void {
  const from = tab.win
  const index = from.tabs.indexOf(tab)
  if (index < 0) return
  const wasActive = from.activeTabId === tab.id
  if (wasActive) {
    cancelActiveMacTrackpadSwipe()
    hideLinkStatus(false, from.window)
  }
  if (from.findState.tabId === tab.id) closeFindBar(false, from)
  const { groups, partners } = removeTabFromSplits(from.splits, tab.id)
  from.splits = groups
  from.recentTabIds = from.recentTabIds.filter((id) => id !== tab.id)
  from.tabs.splice(index, 1)
  if (tab.view) {
    const reader = readerViewFor(tab.view.webContents)
    if (!from.window.isDestroyed()) {
      setPageViewOnScreen(from.window, tab.view, false)
      if (reader) setPageViewOnScreen(from.window, reader, false)
    }
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
  if (wasActive) from.activeTabId = null
  if (from.tabs.length === 0) {
    // Emptied by the move: close it once the move has finished.
    setImmediate(() => { if (!from.window.isDestroyed() && from.tabs.length === 0) from.window.close() })
    return
  }
  if (wasActive) {
    const replacement = findTab(partners[0]) ?? from.tabs[Math.min(index, from.tabs.length - 1)]
    if (replacement) activateTabInternal(replacement.id)
  } else {
    applyTabBounds(from)
    publishState(from)
  }
}

/**
 * Move a tab into another window; a split pane takes its whole split along (same panes, sizes and
 * focused pane), so a split entry moves as one. Pages keep running: only the views move.
 */
function moveTabsWithSplit(tab: BrowserTab, to: BrowserWindowState, beforeId: string | null): void {
  const from = tab.win
  const group = splitOf(tab)
  const members = group
    ? group.tabIds.map((id) => findTab(id)).filter((member): member is BrowserTab => member?.win === from && canMoveTabTo(member, to))
    : [tab]
  const focusId = group && from.activeTabId && group.tabIds.includes(from.activeTabId) ? from.activeTabId : tab.id
  if (group) from.splits = from.splits.filter((candidate) => candidate !== group)
  // Never drop in between another split's panes.
  const before = beforeId ? findTab(beforeId) : undefined
  const beforeGroup = before ? splitOf(before) : undefined
  const anchor = beforeGroup ? to.tabs.find((candidate) => beforeGroup.tabIds.includes(candidate.id))?.id ?? beforeId : beforeId
  for (const member of members) detachTabFromWindow(member)
  for (const member of members) adoptTabIntoWindow(member, to, anchor)
  if (group && members.length === group.tabIds.length) {
    const moved = createSplitGroup(group.id, group.tabIds, group.sizes)
    if (moved) to.splits.push(moved)
  }
  if (members.some((member) => member.id === focusId)) activateTabInternal(focusId)
}

function adoptTabIntoWindow(tab: BrowserTab, to: BrowserWindowState, beforeId: string | null): void {
  tab.win = to
  const contents = tab.view?.webContents
  if (contents && !contents.isDestroyed()) bindContentsToWindow(contents, to.window)
  let at = beforeId ? to.tabs.findIndex((candidate) => candidate.id === beforeId) : -1
  if (at < 0 || to.tabs[at]?.pinned !== tab.pinned) {
    // End of the tab's own group (pinned icons or the list).
    let last = -1
    to.tabs.forEach((candidate, index) => { if (candidate.pinned === tab.pinned) last = index })
    at = tab.pinned ? last + 1 : (last < 0 ? to.tabs.length : last + 1)
  }
  to.tabs.splice(at, 0, tab)
  activateTabInternal(tab.id)
}

/** Move a tab (with its live page) into another open window, before `beforeId` or at the end. */
export function moveBrowserTabToWindow(id: string, target: BaseWindow, beforeId: string | null = null): boolean {
  const tab = findTab(id)
  const to = windowStateFor(target)
  if (!tab || !isLiveWindow(to) || to === tab.win || !canMoveTabTo(tab, to)) return false
  moveTabsWithSplit(tab, to, beforeId)
  persistOpenTabs()
  if (!to.window.isDestroyed()) {
    to.window.show()
    to.window.focus()
  }
  return true
}

/** "Move to New Window" / tearing a tab out: a new window (of the same kind) that takes the tab over. */
export function moveBrowserTabToNewWindow(id: string, position?: { x: number; y: number }): boolean {
  const tab = findTab(id)
  // Something has to stay behind: a window's only tab (or only split) can't tear out.
  if (!tab || tab.win.tabs.length <= (splitOf(tab)?.tabIds.length ?? 1) || !browserWindowFactory) return false
  let size: { width: number; height: number } | undefined
  try {
    const [width = 0, height = 0] = tab.win.window.getSize()
    if (width > 0 && height > 0) size = { width, height }
  } catch {
    // Use the default size.
  }
  const created = browserWindowFactory({ private: tab.win.isPrivate, adoptTabId: id, position, size })
  return Boolean(created && findTab(id)?.win.window === created)
}

/**
 * A sidebar drag ended outside the tab list. Over another window: move the tab there. Outside every
 * window: tear it out into a new window under the pointer. Back over its own window: nothing.
 */
export function dropBrowserTabOutside(id: string): boolean {
  const tab = findTab(id)
  if (!tab) return false
  const point = screen.getCursorScreenPoint()
  const contains = (window: BaseWindow): boolean => {
    if (window.isDestroyed() || window.isMinimized()) return false
    const bounds = window.getBounds()
    return point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height
  }
  // Back over its own window: the left/right edge of the page area splits the page with the tab.
  if (contains(tab.win.window)) return dropTabOnPageEdge(tab, point)
  const target = windowStates.find((w) => w !== tab.win && isLiveWindow(w) && contains(w.window) && canMoveTabTo(tab, w))
  if (target) return moveBrowserTabToWindow(id, target.window)
  if (windowStates.some((w) => w !== tab.win && isLiveWindow(w) && contains(w.window))) return false
  return moveBrowserTabToNewWindow(id, { x: Math.round(point.x - 80), y: Math.round(point.y - 20) })
}

/** Window menu / palette: every window with its label, in creation order. */
export function listBrowserWindows(): { window: BaseWindow; label: string; private: boolean; focused: boolean }[] {
  const focused = focusedBrowserWindow()
  return windowStates.filter(isLiveWindow).map((w) => ({ window: w.window, label: browserWindowLabel(w.window), private: w.isPrivate, focused: w.window === focused }))
}

export function getBrowserState(): BrowserState {
  return getState()
}

export function getBrowserTabs(): BrowserTabSummary[] {
  return getTabSummaries()
}

/** Diagnostics: every tab with its live web contents (null while it sleeps). */
export function getBrowserTabProcessEntries(): TabProcessEntry[] {
  const several = windowStates.length > 1
  return allTabs().map((tab) => ({
    id: tab.id,
    title: pageTitle(tab),
    url: currentUrl(tab),
    active: isActiveTab(tab),
    pdfEditor: tab.pdfEditor !== null,
    extensionPage: tab.extensionPageOrigin !== null,
    contents: tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null,
    ...(several ? { windowNumber: browserWindowNumber(tab.win.window) } : {})
  }))
}

export function getBrowserTabUrlByWebContentsId(webContentsId: number): string | null {
  const tab = allTabs().find((candidate) => candidate.view?.webContents.id === webContentsId)
  const contents = tab?.view?.webContents
  return tab && contents && !contents.isDestroyed() ? currentUrl(tab) : null
}

export function markBrowserDownloadStarted(webContentsId: number): void {
  const tab = allTabs().find((candidate) => candidate.view?.webContents.id === webContentsId)
  if (!tab) return
  tab.downloadStartedForCurrentLoad = true
  if (tab.error !== null) {
    tab.error = null
    publishState(tab.win)
  }
}

export interface ExperimentalExtensionFrameDetails {
  frameId: number
  parentFrameId: number
  processId: number
  url: string
}

/**
 * Read-only frame mapping for the explicitly enabled extension-host experiment.
 * This function is not connected to a renderer or called by the normal app path.
 */
export function getExperimentalExtensionFrames(electronTabId: number): ExperimentalExtensionFrameDetails[] | null {
  if (process.env.SURFFISH_EXPERIMENTAL_EXTENSION_HOST_BRIDGE !== '1') return null
  if (!Number.isSafeInteger(electronTabId) || electronTabId < 0) return null

  const tab = allTabs().find((candidate) => candidate.view?.webContents.id === electronTabId)
  const contents = tab?.view?.webContents
  if (!contents || contents.isDestroyed()) return null

  const mainFrame = contents.mainFrame
  const frames = mainFrame.framesInSubtree.filter((frame) => !frame.detached)
  const frameNodeIds = new Set(frames.map((frame) => frame.frameTreeNodeId))
  if (!frames.some((frame) => frame.frameTreeNodeId === mainFrame.frameTreeNodeId)) return null
  if (frames.some((frame) => frame.parent && !frameNodeIds.has(frame.parent.frameTreeNodeId))) return null

  const extensionFrameId = (frame: WebFrameMain): number =>
    frame.frameTreeNodeId === mainFrame.frameTreeNodeId ? 0 : frame.frameTreeNodeId

  if (frames.some((frame) => frame.parent && extensionFrameId(frame) <= 0)) return null
  return frames.map((frame) => ({
    frameId: extensionFrameId(frame),
    parentFrameId: frame.parent ? extensionFrameId(frame.parent) : -1,
    processId: frame.processId,
    url: frame.url
  }))
}

/** Private tab: opens on the local New Tab (private variant) unless given a URL. */
export function newPrivateBrowserTab(input?: string): string | null {
  const w = currentWindowState()
  const id = createTab(input ?? SURFFISH_QUICK_LINKS_URL, selectedSearchEngine, true, false, false, false, undefined, undefined, true, false, w)
  if (id && w) setImmediate(() => sendFocusAddressToVisibleRenderer(w.window))
  return id
}

/** Links from outside (the OS, update downloads) go to the current window, or the last normal one if that is private. */
function normalWindowState(): BrowserWindowState | undefined {
  const current = currentWindowState()
  if (!current?.isPrivate) return current
  return [...windowStates].reverse().find((w) => !w.isPrivate && isLiveWindow(w)) ?? current
}

/**
 * A link or file handed over by the OS (default browser, Open With, command line): always a new
 * foreground tab. Only http(s) URLs and local PDF/HTML documents (from the trusted main-process
 * opener, never from a page or the address bar) are accepted.
 */
export function openExternalBrowserTab(target: string): string | null {
  const localDocument = isLocalDocumentUrl(target)
  const url = localDocument ? target : resolveNavigationTarget(target)
  if (!url || (!localDocument && !/^https?:\/\//i.test(url))) return null
  const w = normalWindowState()
  const id = createTab(url, selectedSearchEngine, true, false, false, false, undefined, undefined, false, localDocument, w)
  if (id) persistOpenTabs()
  if (id && w && !w.window.isDestroyed() && w.window !== currentBrowserWindow()) w.window.focus()
  return id
}

export function newBrowserTab(input?: string, engine?: SearchEngineId, w = currentWindowState()): string | null {
  const id = createTab(input, engine ?? selectedSearchEngine, true, false, false, false, undefined, undefined, false, false, w)
  if (id && w) {
    persistOpenTabs()
    setImmediate(() => sendFocusAddressToVisibleRenderer(w.window))
  }
  return id
}

/** Open extension UI only through this main-process-only path, never through address-bar navigation. */
export function openExtensionPageTab(url: string, extensionUrl: string, preloadPath: string, owner: ExtensionPageOwner): string | null {
  if (!preloadPath || !isBrambleExtensionUrl(url, extensionUrl)) return null
  let tab = allTabs().find((candidate) => candidate.extensionPageOrigin === extensionUrl && isExtensionPage(candidate, currentUrl(candidate)))
  if (!tab) {
    const id = createTab(url, selectedSearchEngine, true, false, false, false, { extensionUrl, preloadPath, owner }, undefined, false, false, normalWindowState())
    if (!id) return null
    tab = getTab(id)
  } else {
    tab.extensionPreloadPath = preloadPath
    tab.extensionPageOwner = owner
    if (currentUrl(tab) !== url) {
      tab.lastUrl = url
      tab.pendingUrl = url
      tab.error = null
      const contents = tab.view?.webContents
      if (contents && !contents.isDestroyed()) {
        void contents.loadURL(url).catch((error: unknown) => {
          if (tab?.view?.webContents !== contents) return
          tab.error = error instanceof Error ? error.message : String(error)
          publishState(tab.win)
        })
      } else {
        ensureTabLoaded(tab)
      }
    }
    activateTabInternal(tab.id)
  }
  if (!tab) return null
  persistOpenTabs()
  const home = tab.win
  if (isLiveWindow(home)) {
    home.window.show()
    home.window.focus()
    const contents = activeTabOf(home)?.view?.webContents
    if (contents && !contents.isDestroyed()) contents.focus()
  }
  publishState(home)
  return tab.id
}

/** Open Bramble UI only through this main-process-only path, never through address-bar navigation. */
export function openBrambleExtensionTab(url: string, extensionUrl: string, preloadPath: string): string | null {
  return openExtensionPageTab(url, extensionUrl, preloadPath, 'bramble')
}

export function isBrambleExtensionTab(contents: WebContents): boolean {
  const tab = tabForContents(contents)
  return Boolean(tab && tab.extensionPageOwner === 'bramble' && isExtensionPage(tab, currentUrl(tab)))
}

/** True when `contents` is a Surffish tab showing a page of the extension at `extensionUrl`. */
export function isExtensionPageTab(contents: WebContents, extensionUrl: string, owner: ExtensionPageOwner): boolean {
  const tab = tabForContents(contents)
  return Boolean(tab && tab.extensionPageOwner === owner && tab.extensionPageOrigin === extensionUrl && isExtensionPage(tab, currentUrl(tab)))
}

/** Close extension-host tabs before replacing or unloading Bramble's extension build. */
export function closeBrambleExtensionTabs(): void {
  for (const tab of allTabs()) {
    if (tab.extensionPageOrigin && tab.extensionPageOwner === 'bramble') closeBrowserTab(tab.id)
  }
}

/** Close tabs showing pages of one extension (before disabling, updating, or uninstalling it). */
export function closeExtensionPageTabs(extensionUrl: string): void {
  for (const tab of allTabs()) {
    if (tab.extensionPageOrigin === extensionUrl) closeBrowserTab(tab.id)
  }
}

// ---------------------------------------------------------------------------
// chrome.tabs for Web Store extension pages (popups/options). Electron's own tabs API does not
// know Surffish's tab model, so the extension shim asks here. Tab IDs are the tab's WebContents id
// (what content scripts see as sender.tab.id); unloaded tabs get a stable synthetic id.

const syntheticExtensionTabIds = new Map<string, number>()
let nextSyntheticExtensionTabId = 1_000_000

function extensionTabId(tab: BrowserTab): number {
  const contents = tab.view?.webContents
  if (contents && !contents.isDestroyed()) return contents.id
  let id = syntheticExtensionTabIds.get(tab.id)
  if (id === undefined) {
    id = nextSyntheticExtensionTabId++
    syntheticExtensionTabIds.set(tab.id, id)
  }
  return id
}

function extensionTabRecord(tab: BrowserTab, index: number): ExtensionTabRecord {
  const contents = tab.view?.webContents
  const live = contents && !contents.isDestroyed()
  return {
    id: extensionTabId(tab),
    index,
    active: isActiveTab(tab),
    pinned: tab.pinned,
    url: currentUrl(tab),
    title: pageTitle(tab),
    faviconUrl: tab.faviconUrl,
    loading: Boolean(live && contents.isLoading()),
    sleeping: !live
  }
}

function findTabByExtensionId(id: number | undefined): BrowserTab | undefined {
  if (id === undefined) {
    const active = getTab()
    return active?.isPrivate ? undefined : active
  }
  return allTabs().find((tab) => !tab.isPrivate && extensionTabId(tab) === id)
}

/** Extensions never see private tabs (like Chrome's default "not allowed in Incognito"). */
export function listExtensionTabs(): ExtensionTabRecord[] {
  return windowStates.flatMap((w) => w.tabs.filter((tab) => !tab.isPrivate).map((tab, index) => extensionTabRecord(tab, index)))
}

export function getExtensionTab(id: number | undefined): ExtensionTabRecord | null {
  const tab = findTabByExtensionId(id)
  return tab ? extensionTabRecord(tab, tab.win.tabs.indexOf(tab)) : null
}

export function reloadExtensionTab(id: number | undefined, bypassCache: boolean): boolean {
  const tab = findTabByExtensionId(id)
  if (!tab) return false
  const contents = tab.view?.webContents
  if (!contents || contents.isDestroyed()) {
    ensureTabLoaded(tab)
    return true
  }
  if (bypassCache) contents.reloadIgnoringCache()
  else contents.reload()
  return true
}

/** Navigate/activate/pin a tab for an extension. `url` must already be checked by the caller. */
export function updateExtensionTab(id: number | undefined, update: { url?: string; active?: boolean; pinned?: boolean }): ExtensionTabRecord | null {
  const tab = findTabByExtensionId(id)
  if (!tab) return null
  if (typeof update.pinned === 'boolean') setBrowserTabPinned(tab.id, update.pinned)
  if (update.url) {
    tab.lastUrl = update.url
    tab.pendingUrl = update.url
    tab.error = null
    const contents = tab.view?.webContents
    if (contents && !contents.isDestroyed()) void contents.loadURL(update.url).catch(() => {})
    else if (isActiveTab(tab) || update.active) ensureTabLoaded(tab)
  }
  if (update.active) activateTabInternal(tab.id)
  persistOpenTabs()
  publishState(tab.win)
  return extensionTabRecord(tab, tab.win.tabs.indexOf(tab))
}

/** Open a tab for an extension (http(s) or that extension's own page, checked by the caller). */
export function createExtensionTab(url: string | undefined, active: boolean, extensionPage?: ExtensionPageTabOptions): ExtensionTabRecord | null {
  const id = extensionPage && url
    ? openExtensionPageTab(url, extensionPage.extensionUrl, extensionPage.preloadPath, extensionPage.owner)
    : createTab(url, selectedSearchEngine, active, false, false, false, undefined, undefined, false, false, normalWindowState())
  if (!id) return null
  persistOpenTabs()
  const tab = getTab(id)
  return tab ? extensionTabRecord(tab, tab.win.tabs.indexOf(tab)) : null
}

export function removeExtensionTabs(ids: readonly number[]): void {
  for (const id of ids) {
    const tab = findTabByExtensionId(id)
    if (tab) closeBrowserTab(tab.id)
  }
}

/** A tab's live WebContents (null while it sleeps), in whichever window it is. */
export function getBrowserTabWebContents(id: string | null | undefined): WebContents | null {
  const contents = findTab(id)?.view?.webContents
  return contents && !contents.isDestroyed() ? contents : null
}

/** Main-frame WebContents of the active tab, when it is loaded. */
export function getActiveTabWebContents(): WebContents | null {
  const contents = getTab()?.view?.webContents
  return contents && !contents.isDestroyed() ? contents : null
}

export type TabCommand =
  | 'bookmark' | 'pin' | 'duplicate' | 'copyLink' | 'copyCleanLink' | 'reload' | 'hardReload' | 'close' | 'closeOthers'
  | 'back' | 'forward' | 'previousTab' | 'nextTab'
  | 'find' | 'findNext' | 'findPrevious'
  | 'zoomIn' | 'zoomOut' | 'zoomReset'
  | 'history' | 'downloads'
  | 'bookmarkAllTabs' | 'bookmarks'
  | 'screenshot'
  | 'splitView' | 'focusPaneLeft' | 'focusPaneRight'

interface CommandShortcut {
  key: string
  shift?: boolean
  /** Match with or without Shift (Cmd+= and Cmd++ both zoom in). */
  anyShift?: boolean
  alt?: boolean
  /** Needs the platform's primary modifier (Cmd on macOS, where Ctrl+letter is text editing). */
  primaryOnly?: boolean
  accelerator: string
}

const IS_MAC = process.platform === 'darwin'

// One table for browser shortcuts: the key handler, the app menu and the tab context menu all read it.
export const TAB_COMMAND_SHORTCUTS: Record<TabCommand, CommandShortcut> = {
  bookmark: { key: 'd', accelerator: 'CmdOrCtrl+D' },
  pin: { key: 'p', shift: true, accelerator: 'CmdOrCtrl+Shift+P' },
  // Cmd+Shift+D is Chrome's "Bookmark all tabs"; Duplicate stays in the tab menu without a shortcut.
  duplicate: { key: '', accelerator: '' },
  bookmarkAllTabs: { key: 'd', shift: true, accelerator: 'CmdOrCtrl+Shift+D' },
  bookmarks: { key: 'b', alt: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Alt+B' },
  copyLink: { key: 'c', shift: true, accelerator: 'CmdOrCtrl+Shift+C' },
  copyCleanLink: { key: 'c', shift: true, alt: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Alt+Shift+C' },
  reload: { key: 'r', accelerator: 'CmdOrCtrl+R' },
  hardReload: { key: 'r', shift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Shift+R' },
  close: { key: 'w', accelerator: 'CmdOrCtrl+W' },
  closeOthers: { key: 'w', alt: true, accelerator: 'CmdOrCtrl+Alt+W' },
  back: { key: '[', primaryOnly: true, accelerator: 'CmdOrCtrl+[' },
  forward: { key: ']', primaryOnly: true, accelerator: 'CmdOrCtrl+]' },
  previousTab: { key: '[', shift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Shift+[' },
  nextTab: { key: ']', shift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Shift+]' },
  find: { key: 'f', primaryOnly: true, accelerator: 'CmdOrCtrl+F' },
  findNext: { key: 'g', primaryOnly: true, accelerator: 'CmdOrCtrl+G' },
  findPrevious: { key: 'g', shift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Shift+G' },
  // Cmd/Ctrl+Shift+= is Split View, so Zoom In is Cmd/Ctrl+= only (a layout's unshifted "+" still folds to "=").
  zoomIn: { key: '=', primaryOnly: true, accelerator: 'CmdOrCtrl+=' },
  zoomOut: { key: '-', primaryOnly: true, accelerator: 'CmdOrCtrl+-' },
  zoomReset: { key: '0', primaryOnly: true, accelerator: 'CmdOrCtrl+0' },
  // Chrome's bindings: Cmd+Y / Cmd+Shift+J on macOS, Ctrl+H / Ctrl+J elsewhere (Ctrl+Y is Redo there).
  history: IS_MAC ? { key: 'y', primaryOnly: true, accelerator: 'Cmd+Y' } : { key: 'h', primaryOnly: true, accelerator: 'Ctrl+H' },
  downloads: IS_MAC ? { key: 'j', shift: true, primaryOnly: true, accelerator: 'Cmd+Shift+J' } : { key: 'j', primaryOnly: true, accelerator: 'Ctrl+J' },
  // Free in Chrome on every platform (it has no screenshot binding); Cmd+Shift+3/4/5 stay with macOS.
  screenshot: { key: 's', shift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Shift+S' },
  // Split the tab with the last used one (or unsplit); the arrows move focus between panes.
  splitView: { key: '=', shift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Shift+=' },
  focusPaneLeft: { key: 'arrowleft', alt: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Alt+Left' },
  focusPaneRight: { key: 'arrowright', alt: true, primaryOnly: true, accelerator: 'CmdOrCtrl+Alt+Right' }
}

function tabMenuAccelerator(command: TabCommand): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> {
  // Shown as a hint only; the app menu and before-input-event do the real handling.
  const { accelerator } = TAB_COMMAND_SHORTCUTS[command]
  return accelerator ? { accelerator, registerAccelerator: false } : {}
}

export function runTabCommand(command: TabCommand, tabId = getTab()?.id): void {
  const owner = findTab(tabId)?.win.window
  if (owner && owner !== currentBrowserWindow() && isLiveWindow(windowStateFor(owner))) {
    runInWindow(owner, () => runTabCommand(command, tabId))
    return
  }
  switch (command) {
    case 'close':
      closeBrowserTabFromShortcut(tabId)
      return
    case 'back':
      browserBack()
      return
    case 'forward':
      browserForward()
      return
    case 'previousTab':
      cycleBrowserTab(-1)
      return
    case 'nextTab':
      cycleBrowserTab(1)
      return
    case 'find':
      openFindBar()
      return
    case 'findNext':
      stepFind(true)
      return
    case 'findPrevious':
      stepFind(false)
      return
    case 'zoomIn':
    case 'zoomOut':
    case 'zoomReset':
      zoomActiveBrowserTab(command === 'zoomIn' ? 'in' : command === 'zoomOut' ? 'out' : 'reset')
      return
    case 'history':
    case 'downloads':
    case 'bookmarks':
      toggleBrowserPanel(command)
      return
    case 'bookmarkAllTabs':
      bookmarkAllBrowserTabs()
      return
    case 'screenshot':
      void takeScreenshot('choose')
      return
    case 'splitView':
      toggleBrowserSplitView()
      return
    case 'focusPaneLeft':
    case 'focusPaneRight':
      focusAdjacentSplitPane(command === 'focusPaneLeft' ? -1 : 1)
      return
  }
  const tab = tabId ? getTab(tabId) : undefined
  if (!tab) return
  switch (command) {
    case 'bookmark':
      if (normalizeHttpOrigin(currentUrl(tab))) bookmarkTabAndEdit(tab.id)
      break
    case 'pin':
      setBrowserTabPinned(tab.id, !tab.pinned)
      break
    case 'duplicate':
      duplicateBrowserTab(tab.id)
      break
    case 'copyLink':
      if (normalizeHttpOrigin(currentUrl(tab))) clipboard.writeText(currentUrl(tab))
      break
    case 'copyCleanLink':
      if (normalizeHttpOrigin(currentUrl(tab))) clipboard.writeText(cleanLinkUrl(currentUrl(tab)))
      break
    case 'reload':
      reloadBrowserTab(tab.id)
      break
    case 'hardReload':
      reloadBrowserTab(tab.id, true)
      break
    case 'closeOthers':
      closeBrowserTabsRelative(tab.id, 'others')
      break
  }
}

// Shift turns these into other characters on most layouts ({ } + _); fold them back so Cmd+Shift+[ matches '['.
const SHIFTED_KEY_ALIASES: Record<string, string> = { '{': '[', '}': ']', '+': '=', '_': '-' }
const CODE_KEYS: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-' }

/** Normalises a before-input-event (Opt changes `key` on macOS, so fall back to `code`). */
export function handleBrowserShortcutInput(input: Electron.Input, tabId: string | null | undefined = getTab()?.id ?? null): boolean {
  if (input.type !== 'keyDown' || (!input.control && !input.meta)) return false
  let key = input.key.toLowerCase()
  if (input.alt) {
    if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3).toLowerCase()
    else if (/^Digit\d$/.test(input.code)) key = input.code.slice(5)
    else if (CODE_KEYS[input.code]) key = CODE_KEYS[input.code]!
  }
  key = SHIFTED_KEY_ALIASES[key] ?? key
  const primary = IS_MAC ? input.meta : input.control
  return handleBrowserShortcut(key, input.shift, tabId, input.alt, primary)
}

export function handleBrowserShortcut(key: string, shift: boolean, tabId: string | null | undefined = getTab()?.id ?? null, alt = false, primary = true): boolean {
  const owner = findTab(tabId)?.win.window
  if (owner && owner !== currentBrowserWindow() && isLiveWindow(windowStateFor(owner))) {
    return runInWindow(owner, () => handleBrowserShortcut(key, shift, tabId, alt, primary))
  }
  for (const [command, shortcut] of Object.entries(TAB_COMMAND_SHORTCUTS) as [TabCommand, CommandShortcut][]) {
    if (shortcut.key !== key || Boolean(shortcut.alt) !== alt) continue
    if (!shortcut.anyShift && Boolean(shortcut.shift) !== shift) continue
    if (shortcut.primaryOnly && !primary) continue
    // Pane focus keys are only taken while a split is on screen; otherwise the page gets them.
    if ((command === 'focusPaneLeft' || command === 'focusPaneRight') && !splitOf(findTab(tabId) ?? getTab())) continue
    runTabCommand(command, tabId ?? undefined)
    return true
  }
  // Cmd/Ctrl+K and Cmd/Ctrl+Shift+A: the command palette wins over the page unless turned off in Settings.
  if (handleCommandPaletteShortcut(key, shift, alt, primary)) return true
  if (alt) return false
  if (primary && !shift && /^[1-9]$/.test(key)) {
    selectBrowserTabByNumber(Number(key))
    return true
  }
  if (key === 'l' && !shift) {
    sendFocusAddressToVisibleRenderer()
    return true
  }
  if (key === 't' && !shift) {
    newBrowserTab()
    return true
  }
  if (key === 't' && shift) {
    reopenClosedBrowserTab()
    return true
  }
  if ((key === '\\' || key === '|') && shift) {
    toggleTabOverview()
    return true
  }
  if (key === 'tab' && (currentWindowState()?.tabs.length ?? 0) > 1) {
    cycleBrowserTab(shift ? -1 : 1)
    return true
  }
  return false
}

/** Tabs in the order the sidebar shows them: pinned icons first, then the list. */
function tabsInSidebarOrder(w = currentWindowState()): BrowserTab[] {
  const tabs = w?.tabs ?? []
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
}

/** Cmd+1..8 selects that tab, Cmd+9 the last one (as in Chrome). */
export function selectBrowserTabByNumber(number: number): void {
  // Sidebar entries: a split counts once, and selecting it lands on its last used pane.
  const w = currentWindowState()
  const ordered = tabsInSidebarOrder().flatMap((tab) => {
    const group = splitOf(tab)
    if (!group || !w) return [tab]
    if (w.tabs.find((candidate) => group.tabIds.includes(candidate.id)) !== tab) return []
    const recent = pickLastUsedTab(w.recentTabIds, null, (id) => group.tabIds.includes(id))
    return [findTab(recent) ?? tab]
  })
  const target = number === 9 ? ordered[ordered.length - 1] : ordered[number - 1]
  if (!target) return
  if (!isActiveTab(target)) activateBrowserTab(target.id)
  // From the tab overview, land on the chosen tab.
  if (isTabOverviewOpen()) closeTabOverview(target.id)
}

function closeOverviewForPanel(): void {
  if (isTabOverviewOpen()) closeTabOverview(getTab()?.id, false)
}

/** Cmd+Shift+Backspace: Settings → Privacy (Clear browsing data). */
export function openClearBrowsingData(): void {
  closeOverviewForPanel()
  setBrowserChromeState({ sidebarMode: 'privacy' })
}

/** Cmd+Y / Cmd+Shift+J / Cmd+Opt+B: toggle the history sidebar, downloads or the bookmarks manager. */
function toggleBrowserPanel(mode: 'history' | 'downloads' | 'bookmarks'): void {
  closeOverviewForPanel()
  const current = getBrowserChromeState().sidebarMode
  setBrowserChromeState({ sidebarMode: current === mode ? 'tabs' : mode })
}

// ---------------------------------------------------------------------------
// Find in page. The bar lives in the toolbar overlay renderer; main keeps the query so
// Cmd+G works with focus anywhere (page, toolbar, tab overview).

onTabInterstitialChanged(() => publishAllWindows())

const CLOSED_FIND_STATE: FindState = { tabId: null, open: false, text: '', result: null }

function publishFindState(w = currentWindowState()): void {
  if (isLiveWindow(w)) sendToWindowRenderers(w.window, 'browser:find', getBrowserFindState(w))
}

export function getBrowserFindState(w = currentWindowState()): BrowserFindState {
  const findState = w?.findState ?? CLOSED_FIND_STATE
  return { open: findState.open, text: findState.text, result: findState.result ? { ...findState.result } : null }
}

function findContents(w: BrowserWindowState): WebContents | null {
  const tab = w.findState.tabId ? getTab(w.findState.tabId) : undefined
  const contents = tab?.win === w ? tab.view?.webContents : null
  return contents && !contents.isDestroyed() ? contents : null
}

/** Cmd+F: open (or refocus) the find bar for the active page. */
export function openFindBar(): boolean {
  const w = currentWindowState()
  if (!w) return false
  closeOverviewForPanel()
  const tab = activeTabOf(w)
  const contents = tab?.view?.webContents
  if (!tab || !contents || contents.isDestroyed() || currentUrl(tab) === SURFFISH_QUICK_LINKS_URL) return false
  if (w.findState.tabId !== tab.id) w.findState = { tabId: tab.id, open: true, text: w.findState.text, result: null }
  w.findState.open = true
  publishFindState(w)
  // Focus the toolbar so typing goes to the find field; it selects the old query for retyping.
  if (!runInWindow(w.window, () => sendToToolbarRenderer('browser:find:focus', true))) {
    w.findState.open = false
    publishFindState(w)
    return false
  }
  if (w.findState.text && !w.findState.result) contents.findInPage(w.findState.text, { findNext: true })
  return true
}

/** Typing in the find field: a new search for `text` (empty clears the highlight). */
export function setBrowserFindQuery(input: unknown): void {
  const w = currentWindowState()
  if (!w || typeof input !== 'string' || !w.findState.open) return
  const text = input.slice(0, 1_000)
  const contents = findContents(w)
  w.findState.text = text
  w.findState.result = null
  if (!contents) return publishFindState(w)
  if (text) contents.findInPage(text, { findNext: true })
  else contents.stopFindInPage('clearSelection')
  publishFindState(w)
}

/** Enter / Cmd+G (forward) and Shift+Enter / Cmd+Shift+G (backward). */
export function stepFind(forward: boolean): void {
  const w = currentWindowState()
  if (!w) return
  const { findState } = w
  if (!findState.open || !findState.text || findState.tabId !== w.activeTabId) {
    openFindBar()
    return
  }
  findContents(w)?.findInPage(findState.text, { forward, findNext: false })
}

/** Esc or the close button: clear the highlight, hide the bar, hand focus back to the page. */
export function closeFindBar(focusPage = true, w = currentWindowState()): void {
  if (!w) return
  const contents = findContents(w)
  if (contents) contents.stopFindInPage('clearSelection')
  const wasOpen = w.findState.open
  w.findState = { tabId: null, open: false, text: w.findState.text, result: null }
  if (wasOpen) publishFindState(w)
  if (focusPage) {
    const active = activeTabOf(w)?.view?.webContents
    if (active && !active.isDestroyed()) active.focus()
  }
}

// ---------------------------------------------------------------------------
// Page zoom, remembered per origin. Private tabs use saved levels but keep their own changes in
// memory only (forgotten with the private session).

const privateSiteZoom = new Map<string, number>()

function savedZoomFor(tab: BrowserTab, url: string): number {
  const origin = normalizeHttpOrigin(url)
  if (!origin) return 1
  return (tab.isPrivate ? privateSiteZoom.get(origin) : undefined) ?? getBrowserSiteZoom(origin)
}

function applySavedZoom(tab: BrowserTab, url: string): void {
  const contents = tab.view?.webContents
  if (!contents || contents.isDestroyed() || !/^https?:\/\//i.test(url)) return
  const factor = savedZoomFor(tab, url)
  if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor)
}

function zoomTab(tab: BrowserTab, action: 'in' | 'out' | 'reset'): void {
  const contents = tab.view?.webContents
  if (!contents || contents.isDestroyed()) return
  const current = contents.getZoomFactor()
  const next = action === 'reset' ? 1 : stepZoomFactor(current, action === 'in' ? 1 : -1)
  if (Math.abs(current - next) > 0.001) contents.setZoomFactor(next)
  const origin = normalizeHttpOrigin(contents.getURL())
  if (origin) {
    if (tab.isPrivate) privateSiteZoom.set(origin, next)
    else saveBrowserSiteZoom(origin, next)
  }
  if (isActiveTab(tab)) publishState(tab.win)
}

/** Cmd + / Cmd - / Cmd 0 and the omnibox zoom pill. */
export function zoomActiveBrowserTab(action: unknown): void {
  if (action !== 'in' && action !== 'out' && action !== 'reset') return
  const tab = getTab()
  if (tab) zoomTab(tab, action)
}

export function setBrowserSearchEngine(engine: SearchEngineId): void {
  selectedSearchEngine = engine
}

export function setBrowserTabSleepMinutes(value: unknown): TabSleepMinutes | null {
  if (!isTabSleepMinutes(value)) return null
  tabSleepMinutes = value
  for (const tab of allTabs()) {
    if (isTabOnScreen(tab)) continue
    scheduleTabSleep(tab)
  }
  return tabSleepMinutes
}

export function activateBrowserTab(id: string): boolean {
  const activated = activateTabInternal(id)
  if (activated) {
    persistOpenTabs()
    // Switching to a tab that lives in another window (archive restore, extensions) brings that window forward.
    const window = findTab(id)?.win.window
    if (window && !window.isDestroyed() && window !== currentBrowserWindow()) window.focus()
  }
  return activated
}

export function cycleBrowserTab(offset: number): void {
  const w = currentWindowState()
  if (!w || w.tabs.length < 2) return
  const ordered = tabsInSidebarOrder(w)
  const activeIndex = ordered.findIndex((tab) => tab.id === w.activeTabId)
  const nextIndex = (activeIndex + offset + ordered.length) % ordered.length
  const next = ordered[nextIndex]
  if (next) activateBrowserTab(next.id)
}

const MAX_RECENTLY_CLOSED_TABS = 25
interface RecentlyClosedTab { url: string; index: number; pinned: boolean }
const recentlyClosedTabs: RecentlyClosedTab[] = []

function rememberClosedTab(tab: BrowserTab, index: number): void {
  // Extension UI pages need their preload wiring and a blank New Tab isn't worth bringing back.
  // Private tabs leave no trace, so they can't be reopened either.
  if (tab.extensionPageOrigin || tab.isPrivate) return
  const url = currentUrl(tab)
  if (!url || url === SURFFISH_QUICK_LINKS_URL) return
  recentlyClosedTabs.push({ url, index, pinned: tab.pinned })
  if (recentlyClosedTabs.length > MAX_RECENTLY_CLOSED_TABS) recentlyClosedTabs.shift()
}

/** Cmd+Shift+T: bring back the most recently closed tab at its old position. */
export function hasRecentlyClosedBrowserTabs(): boolean {
  return recentlyClosedTabs.length > 0
}

export function reopenClosedBrowserTab(): string | null {
  const entry = recentlyClosedTabs.pop()
  if (!entry) return null
  const id = createTab(entry.url, selectedSearchEngine, true, false, false, entry.pinned, undefined, entry.index)
  if (id) persistOpenTabs()
  return id
}

export function setBrowserTabMuted(id: string, muted: boolean): boolean {
  const contents = getTab(id)?.view?.webContents
  if (!contents || contents.isDestroyed()) return false
  contents.setAudioMuted(muted)
  const tab = getTab(id)
  if (tab) publishTabs(tab.win)
  return true
}

export function closeBrowserTab(id: string, rememberClosed = true): void {
  const tab = findTab(id)
  if (!tab) return
  const w = tab.win
  const { tabs } = w
  const index = tabs.indexOf(tab)
  if (index < 0) return
  if (!allowLeavingPdfEditor(tab, 'Close Tab')) return
  if (tab.pdfEditor) tab.pdfEditor.dirty = false
  tabThumbnails.delete(id)
  const wasActive = w.activeTabId === id
  if (wasActive) cancelActiveMacTrackpadSwipe()
  if (wasActive) hideLinkStatus(false, w.window)
  if (w.findState.tabId === id) closeFindBar(false, w)
  if (rememberClosed) rememberClosedTab(tab, index)
  // Closing a pane leaves its partner on screen (and focused, when the closed pane was).
  const { groups, partners } = removeTabFromSplits(w.splits, id)
  w.splits = groups
  w.recentTabIds = w.recentTabIds.filter((recent) => recent !== id)
  tabs.splice(index, 1)
  cancelSleepTimer(tab)
  if (wasActive) w.activeTabId = null
  disposeTabView(tab)
  if (tab.isPrivate && !allTabs().some((candidate) => candidate.isPrivate)) endPrivateSession()
  if (tabs.length === 0) {
    w.activeTabId = null
    // The last tab of one of several windows closes that window; the final window keeps a fresh New Tab.
    if (hasOtherWindows(w)) {
      setImmediate(() => { if (!w.window.isDestroyed() && w.tabs.length === 0) w.window.close() })
      return
    }
    createTab(undefined, selectedSearchEngine, true, false, false, false, undefined, undefined, false, false, w)
    persistOpenTabs()
    return
  }
  if (wasActive) {
    const replacement = findTab(partners[0]) ?? tabs[Math.min(index, tabs.length - 1)]
    if (replacement) activateTabInternal(replacement.id)
  } else {
    applyTabBounds(w)
  }
  persistOpenTabs()
  publishState(w)
}

function hasOtherWindows(w: BrowserWindowState): boolean {
  return windowStates.some((other) => other !== w && isLiveWindow(other))
}

/** Last private tab closed: wipe the in-memory session and forget its downloads. */
function endPrivateSession(): void {
  privateSiteZoom.clear()
  forgetPrivateDownloads()
  void clearPrivateSession()
}

/**
 * Cmd+W: close the tab. On the last tab of the only window, ask before closing it instead of
 * silently swapping in a fresh New Tab or letting the menu close the window. With other windows
 * open, the last tab just closes its window (like Chrome).
 */
export function closeBrowserTabFromShortcut(tabId = getTab()?.id): void {
  const w = findTab(tabId)?.win ?? currentWindowState()
  if (!w) return
  if (w.tabs.length > 1 || hasOtherWindows(w)) {
    if (tabId) closeBrowserTab(tabId)
    return
  }
  const win = w.window
  if (win.isDestroyed() || w.confirmingWindowClose) return
  w.confirmingWindowClose = true
  void dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Close Window', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Close the window?',
    detail: 'This is your last tab.'
  }).then(({ response }) => {
    if (response === 0 && !win.isDestroyed()) win.close()
  }).finally(() => {
    w.confirmingWindowClose = false
  })
}

export function setBrowserTabPinned(id: string, pinned: boolean): boolean {
  const tab = getTab(id)
  if (!tab) return false
  if (tab.pinned === pinned) return true
  // Pinned tabs live in the Favourites strip, which has no split entries: pinning unsplits first.
  if (pinned && splitOf(tab)) {
    tab.win.splits = removeTabFromSplits(tab.win.splits, tab.id).groups
    applyTabBounds(tab.win)
    publishState(tab.win)
  }
  tab.pinned = pinned
  persistOpenTabs()
  publishTabs(tab.win)
  return true
}

/**
 * Move a tab so it lands before `beforeId` (or at the end when null). Pinned and unpinned tabs keep
 * their own groups. A `beforeId` in another window moves the tab into that window.
 */
export function moveBrowserTab(id: string, beforeId: string | null): boolean {
  const moving = findTab(id)
  if (!moving || id === beforeId) return false
  const before = beforeId ? findTab(beforeId) : undefined
  if (before && before.win !== moving.win) return moveBrowserTabToWindow(id, before.win.window, beforeId)
  const { tabs } = moving.win
  const from = tabs.indexOf(moving)
  if (from < 0) return false
  // A split moves as one block, and nothing lands in between another split's panes.
  const group = splitOf(moving)
  if (group && beforeId && group.tabIds.includes(beforeId)) return false
  const beforeGroup = before ? splitOf(before) : undefined
  const anchorId = beforeGroup ? tabs.find((item) => beforeGroup.tabIds.includes(item.id))?.id ?? beforeId : beforeId
  const orderBefore = tabs.map((item) => item.id).join('|')
  const block = group ? tabs.filter((item) => group.tabIds.includes(item.id)) : [moving]
  for (const item of block) tabs.splice(tabs.indexOf(item), 1)
  const tab = moving
  let to = anchorId ? tabs.findIndex((item) => item.id === anchorId) : -1
  if (to < 0) {
    // append after the last tab in the same pinned group
    let last = -1
    tabs.forEach((item, index) => { if (item.pinned === tab.pinned) last = index })
    to = last + 1
  }
  tabs.splice(to, 0, ...block)
  if (tabs.map((item) => item.id).join('|') === orderBefore) return false
  persistOpenTabs()
  publishTabs(tab.win)
  return true
}

export function duplicateBrowserTab(id: string): string | null {
  const tab = getTab(id)
  if (!tab) return null
  const duplicateId = createTab(currentUrl(tab), selectedSearchEngine, true, false, false, false, undefined, undefined, false, false, tab.win)
  if (duplicateId) persistOpenTabs()
  return duplicateId
}

export function reloadBrowserTab(id: string, ignoreCache = false): void {
  const tab = getTab(id)
  if (!tab) return
  if (!allowLeavingPdfEditor(tab, 'Reload')) return
  if (tab.pdfEditor) tab.pdfEditor.dirty = false
  if (tab.view && !tab.view.webContents.isDestroyed()) {
    if (ignoreCache) tab.view.webContents.reloadIgnoringCache()
    else tab.view.webContents.reload()
  }
  else activateTabInternal(id)
}

export function suspendBrowserTab(id: string): void {
  const tab = getTab(id)
  if (tab && !isTabOnScreen(tab)) hibernateTab(tab)
}

/** Suspend every other tab in the same window (the active one stays awake). */
export function suspendOtherBrowserTabs(keepId: string): void {
  const w = findTab(keepId)?.win ?? currentWindowState()
  for (const tab of [...(w?.tabs ?? [])]) {
    if (tab.id !== keepId && !isTabOnScreen(tab)) hibernateTab(tab)
  }
}

function closeBrowserTabsRelative(id: string, relation: 'above' | 'below' | 'others'): void {
  const tabs = findTab(id)?.win.tabs ?? []
  const targetIndex = tabs.findIndex((tab) => tab.id === id)
  if (targetIndex < 0) return
  const idsToClose = tabs.flatMap((tab, index) => {
    const shouldClose = relation === 'above' ? index < targetIndex
      : relation === 'below' ? index > targetIndex
        : tab.id !== id
    return shouldClose ? [tab.id] : []
  })
  for (const tabId of idsToClose) closeBrowserTab(tabId)
}

export async function navigateBrowser(input: string, engine: SearchEngineId = selectedSearchEngine): Promise<boolean> {
  const url = resolveAddressInput(input, engine)
  const tab = getTab()
  if (!url || !tab) return false
  if (tab.pdfEditor) {
    // Leaving the editor: ask about unsaved edits, then load the address in a normal page view.
    if (!allowLeavingPdfEditor(tab, 'Leave Page')) return false
    replaceTabView(tab, null, url)
    return Boolean(tab.view)
  }
  if (tab.lastUrl === SURFFISH_QUICK_LINKS_URL && !tab.view) {
    tab.lastUrl = url
    tab.pendingUrl = url
    tab.error = null
    ensureTabLoaded(tab)
    if (!tab.view) return false
    publishState(tab.win)
    return true
  }
  tab.error = null
  ensureTabLoaded(tab)
  const contents = tab.view?.webContents
  if (!contents) return false
  publishState(tab.win)
  try {
    if (tab.isPrivate) await whenPrivateSessionReady()
    await contents.loadURL(url)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!tab.downloadStartedForCurrentLoad && message.includes('ERR_FAILED')) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (tab.downloadStartedForCurrentLoad) {
      tab.error = null
      publishState(tab.win)
      return true
    }
    if (message.includes('ERR_ABORTED') && Date.now() - (googleHandOffAt.get(contents) ?? 0) < 5000) {
      tab.error = null
      publishState(tab.win)
      return true
    }
    tab.error = message
    publishState(tab.win)
    return false
  }
}

export function setBrowserBounds(input: unknown): void {
  const w = currentWindowState()
  if (!w || typeof input !== 'object' || input === null) return
  const bounds = input as Partial<BrowserBounds>
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return
  const browserBounds = w.browserBounds = {
    x: Math.max(0, Math.round(bounds.x!)),
    y: Math.max(0, Math.round(bounds.y!)),
    width: Math.max(0, Math.round(bounds.width!)),
    height: Math.max(0, Math.round(bounds.height!))
  }
  // Page hidden (New Tab, a full panel): nothing to hover, so drop any status pill left over.
  if (browserBounds.width === 0 || browserBounds.height === 0) hideLinkStatus(false, w.window)
  applyTabBounds(w)
}

export function syncBrowserBoundsToWindow(width: number, height: number, overlayMode: boolean, window?: BaseWindow): void {
  const w = window ? windowStateFor(window) : currentWindowState()
  if (!isLiveWindow(w) || !overlayMode || width <= 0 || height <= 0) return
  const { browserBounds } = w
  if (browserBounds.width <= 0 || browserBounds.height <= 0) return
  const y = Math.min(browserBounds.y, height)
  const nextBounds: BrowserBounds = {
    x: 0,
    y,
    width,
    height: Math.max(0, height - y)
  }
  if (nextBounds.x === browserBounds.x && nextBounds.y === browserBounds.y
    && nextBounds.width === browserBounds.width && nextBounds.height === browserBounds.height) return
  w.browserBounds = nextBounds
  applyTabBounds(w)
}

function cancelActiveMacTrackpadSwipe(): void {
  const swipe = activeMacTrackpadSwipe
  activeMacTrackpadSwipe = null
  nextMacTrackpadSwipeToken += 1
  if (!swipe || swipe.contents.isDestroyed()) return
  try {
    swipe.contents.send(MAC_SWIPE_RESET_CHANNEL)
  } catch {
    // The renderer may be closing while the trackpad gesture is settling.
  }
}

function resetMacTrackpadSwipeFor(contents: WebContents): void {
  if (activeMacTrackpadSwipe?.contents === contents) {
    activeMacTrackpadSwipe = null
    nextMacTrackpadSwipeToken += 1
  }
  if (process.platform !== 'darwin' || contents.isDestroyed()) return
  try {
    contents.send(MAC_SWIPE_RESET_CHANNEL)
  } catch {
    // Ignore a renderer that is already navigating away.
  }
}

/** The window a native gesture landed in (its NSWindow handle), else the focused one. */
function windowForGesture(handle: unknown): BrowserWindowState | undefined {
  if (Buffer.isBuffer(handle)) {
    const match = windowStates.find((w) => {
      try {
        return isLiveWindow(w) && w.window.getNativeWindowHandle().equals(handle)
      } catch {
        return false
      }
    })
    if (match) return match
  }
  return windowStateFor(focusedBrowserWindow()) ?? currentWindowState()
}

function beginMacTrackpadSwipe(request: MacTrackpadSwipeBeginRequest): number | undefined {
  const w = windowForGesture(request.windowHandle)
  const refuse = (reason: string): undefined => {
    if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] refused:', reason, { direction: request.direction, x: request.x, y: request.y, bounds: w?.browserBounds })
    return undefined
  }
  if (process.platform !== 'darwin' || !isLiveWindow(w)) return refuse('no browser window')
  const browserBounds = w.browserBounds
  if (isTabOverviewOpen(w.window)) {
    // In the grid, horizontal swipes step the selection instead of navigating history.
    const overviewId = getTabOverviewContentsId(w.window)
    if (getTabOverviewState(w.window) !== 'open' || overviewId === null) return refuse('tab overview animating')
    if (request.direction !== 'back' && request.direction !== 'forward') return refuse('bad request')
    cancelActiveMacTrackpadSwipe()
    if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] tracking overview selection', request.direction)
    return overviewId
  }
  // The handle picks the window (windowForGesture); an unmatched handle falls back to the focused
  // window rather than rejecting the swipe (a bad compare here used to reject every swipe).
  if ((request.direction !== 'back' && request.direction !== 'forward')
    || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return refuse('bad request')
  if (browserBounds.width <= 0 || browserBounds.height <= 0
    || request.x < browserBounds.x || request.y < browserBounds.y
    || request.x >= browserBounds.x + browserBounds.width
    || request.y >= browserBounds.y + browserBounds.height) return refuse('outside page bounds')

  // In a split, the pane under the fingers navigates (focused or not).
  const tab = tabAtWindowPoint(w, request.x, request.y) ?? activeTabOf(w)
  const contents = tab?.view?.webContents
  if (!tab || !contents || contents.isDestroyed()) return refuse('no active tab')
  const canPageConsume = request.direction === 'back'
    ? tab.pageScrollEdges.canScrollLeft
    : tab.pageScrollEdges.canScrollRight
  if (canPageConsume) return refuse(`page can still scroll ${JSON.stringify(tab.pageScrollEdges)}`)

  try {
    const canNavigate = request.direction === 'back'
      ? contents.navigationHistory.canGoBack()
      : contents.navigationHistory.canGoForward()
    if (!canNavigate) return refuse('no history in that direction')
    if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] tracking', request.direction)

    cancelActiveMacTrackpadSwipe()
    const swipe: ActiveMacTrackpadSwipe = {
      contents,
      tabId: tab.id,
      direction: request.direction,
      token: ++nextMacTrackpadSwipeToken
    }
    activeMacTrackpadSwipe = swipe
    contents.send(MAC_SWIPE_BEGIN_CHANNEL, { direction: swipe.direction })
    return contents.id
  } catch (error) {
    console.warn('[trackpad swipe] Could not start page navigation:', error)
    return undefined
  }
}

function reportMacTrackpadSwipeProgress(contentsId: number, progress: number): void {
  if (getTabOverviewContentsIds().includes(contentsId)) return
  const swipe = activeMacTrackpadSwipe
  if (!swipe || swipe.contents.id !== contentsId || swipe.contents.isDestroyed()) return
  try {
    swipe.contents.send(MAC_SWIPE_PROGRESS_CHANNEL, {
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
    })
  } catch {
    cancelActiveMacTrackpadSwipe()
  }
}

function finishMacTrackpadSwipe(
  contentsId: number,
  direction: MacTrackpadSwipeDirection,
  committed: boolean,
  _maxProgress: number
): void {
  if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] end', { direction, committed, maxProgress: _maxProgress })
  const overviewWindow = windowStates.find((w) => getTabOverviewContentsId(w.window) === contentsId)
  if (overviewWindow) {
    // Selection follows the fingers: swipe right moves right, swipe left moves left.
    if (committed) moveTabOverviewSelection(direction === 'back' ? 1 : -1, overviewWindow.window)
    return
  }
  const swipe = activeMacTrackpadSwipe
  if (!swipe || swipe.contents.id !== contentsId || swipe.direction !== direction) return
  if (swipe.contents.isDestroyed()) {
    activeMacTrackpadSwipe = null
    nextMacTrackpadSwipeToken += 1
    return
  }

  try {
    swipe.contents.send(MAC_SWIPE_END_CHANNEL, { committed })
  } catch {
    cancelActiveMacTrackpadSwipe()
    return
  }

  if (!committed) {
    activeMacTrackpadSwipe = null
    nextMacTrackpadSwipeToken += 1
    return
  }

  setTimeout(() => {
    if (activeMacTrackpadSwipe !== swipe || swipe.token !== nextMacTrackpadSwipeToken) return
    activeMacTrackpadSwipe = null
    nextMacTrackpadSwipeToken += 1
    const currentTab = getTab(swipe.tabId)
    if (!currentTab || !isTabOnScreen(currentTab) || currentTab.view?.webContents !== swipe.contents
      || swipe.contents.isDestroyed() || !isLiveWindow(currentTab.win)) {
      resetMacTrackpadSwipeFor(swipe.contents)
      return
    }

    try {
      const canNavigate = direction === 'back'
        ? swipe.contents.navigationHistory.canGoBack()
        : swipe.contents.navigationHistory.canGoForward()
      if (!canNavigate) {
        resetMacTrackpadSwipeFor(swipe.contents)
      } else if (direction === 'back') {
        swipe.contents.navigationHistory.goBack()
      } else {
        swipe.contents.navigationHistory.goForward()
      }
    } catch (error) {
      console.warn('[trackpad swipe] Could not commit page navigation:', error)
      resetMacTrackpadSwipeFor(swipe.contents)
    }
  }, MAC_SWIPE_SETTLE_MS + 20)
}

export function updateBrowserTrackpadScrollEdges(contents: WebContents, input: unknown): void {
  if (process.platform !== 'darwin' || contents.isDestroyed() || typeof input !== 'object' || input === null) return
  const edges = input as Partial<BrowserPageScrollEdges>
  if (typeof edges.canScrollLeft !== 'boolean' || typeof edges.canScrollRight !== 'boolean') return
  const tab = tabForContents(contents)
  if (tab) tab.pageScrollEdges = { canScrollLeft: edges.canScrollLeft, canScrollRight: edges.canScrollRight }
}

export function updateBrowserPageScale(contents: WebContents, input: unknown): void {
  if (contents.isDestroyed() || typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return
  const tab = tabForContents(contents)
  if (tab) tab.pageScale = input
}

function isLocalNewTab(tab: BrowserTab): boolean {
  return !tab.view && currentUrl(tab) === SURFFISH_QUICK_LINKS_URL
}

function thumbnailDataUrl(image: Electron.NativeImage): string {
  const size = image.getSize()
  const scaled = size.width > THUMBNAIL_WIDTH ? image.resize({ width: THUMBNAIL_WIDTH, quality: 'good' }) : image
  return `data:image/jpeg;base64,${scaled.toJPEG(72).toString('base64')}`
}

async function captureTabThumbnail(tab: BrowserTab): Promise<void> {
  const { browserBounds } = tab.win
  if (!isActiveTab(tab) || browserBounds.width <= 0 || browserBounds.height <= 0) return
  if (isLocalNewTab(tab)) {
    const image = await captureLocalNewTabPage({ ...browserBounds }, tab.win.window)
    if (!image || !allTabs().includes(tab)) return
    const shot = thumbnailDataUrl(image)
    tabThumbnails.set(tab.id, shot)
    newTabThumbnail = shot
    return
  }
  const contents = tab.view?.webContents
  if (!contents || contents.isDestroyed()) return
  try {
    const image = await contents.capturePage()
    if (image.isEmpty() || contents.isDestroyed() || !allTabs().includes(tab)) return
    tabThumbnails.set(tab.id, thumbnailDataUrl(image))
  } catch {
    // A page that is navigating or crashing just keeps its previous thumbnail.
  }
}

async function getTabOverviewItems(w: BrowserWindowState): Promise<TabOverviewItem[]> {
  const active = activeTabOf(w)
  if (active) {
    // Fresh shot of what is on screen right now; don't hold the gesture up for a slow page.
    await Promise.race([captureTabThumbnail(active), new Promise((resolve) => setTimeout(resolve, 120))])
  }
  return getTabSummaries(w).map((summary) => ({
    id: summary.id,
    url: summary.url,
    title: summary.title,
    faviconUrl: summary.faviconUrl,
    active: summary.active,
    pinned: summary.pinned,
    sleeping: summary.sleeping,
    newTab: summary.url === SURFFISH_QUICK_LINKS_URL,
    thumbnail: tabThumbnails.get(summary.id) ?? (summary.url === SURFFISH_QUICK_LINKS_URL ? newTabThumbnail : null)
  }))
}

// How much pinch (summed NSEvent magnification) carries the overview the whole way in or out.
const PINCH_FULL_TRAVEL = 0.55
// Progress per second at release that counts as a flick, whatever the distance travelled.
const PINCH_FLICK_SPEED = 1.6
let pinchMode: 'none' | 'open' | 'close' | 'swallow' = 'none'
let pinchWindow: BaseWindow | null = null
let pinchSamples: { at: number; progress: number }[] = []

function pinchProgress(magnification: number): number {
  const travel = magnification / PINCH_FULL_TRAVEL
  const progress = pinchMode === 'open' ? -travel : 1 - travel
  return Math.min(1.25, Math.max(-0.05, progress))
}

function trackPinchProgress(magnification: number): number {
  const progress = pinchProgress(magnification)
  const now = Date.now()
  pinchSamples.push({ at: now, progress })
  while (pinchSamples.length > 2 && now - pinchSamples[0]!.at > 120) pinchSamples.shift()
  setTabOverviewProgress(progress, pinchWindow)
  return progress
}

function pinchVelocity(): number {
  const first = pinchSamples[0]
  const last = pinchSamples[pinchSamples.length - 1]
  if (!first || !last || last.at - first.at < 8) return 0
  return (last.progress - first.progress) / ((last.at - first.at) / 1000)
}

function handleMacTrackpadPinch(phase: MacTrackpadPinchPhase, magnification: number): boolean {
  if (MAC_SWIPE_DEBUG && phase !== 'change') {
    console.info('[trackpad swipe] pinch', phase, { magnification, mode: pinchMode, overview: getTabOverviewState(pinchWindow), pageScale: getTab()?.pageScale })
  }
  if (phase === 'begin') {
    pinchSamples = []
    pinchMode = 'none'
    const w = windowStateFor(focusedBrowserWindow()) ?? currentWindowState()
    pinchWindow = w?.window ?? null
    const overview = getTabOverviewState(pinchWindow)
    if (overview === 'opening' || overview === 'closing') {
      // Mid-animation: eat the pinch so the page underneath doesn't zoom.
      pinchMode = 'swallow'
      return true
    }
    if (overview === 'open') {
      pinchMode = magnification > 0 ? 'close' : 'swallow'
      if (pinchMode === 'close') {
        // Swap the page underneath now so it is already there as the selected card grows into it.
        const selected = getTabOverviewSelectedId(pinchWindow)
        if (selected && selected !== w?.activeTabId) activateBrowserTab(selected)
        trackPinchProgress(magnification)
      }
      return true
    }
    if (magnification > 0) return false
    if (!isLiveWindow(w) || !w.window.isFocused()) return false
    const tab = activeTabOf(w)
    // Pinching in on a zoomed-in page should zoom it back out, not open the overview.
    if (!tab || tab.pageScale > 1.01) return false
    pinchMode = 'open'
    void openTabOverview({ interactive: true }, w.window)
    trackPinchProgress(magnification)
    return true
  }

  const mode = pinchMode
  if (mode === 'none' || mode === 'swallow') {
    if (phase !== 'change') pinchMode = 'none'
    return mode === 'swallow'
  }
  if (phase === 'change') {
    trackPinchProgress(magnification)
    return true
  }

  const progress = pinchSamples[pinchSamples.length - 1]?.progress ?? (mode === 'open' ? 0 : 1)
  const velocity = pinchVelocity()
  pinchMode = 'none'
  pinchSamples = []
  if (phase === 'cancel') {
    settleTabOverview(mode === 'close', undefined, true, pinchWindow)
    return true
  }
  // Released: a flick wins, otherwise go wherever it is closer to.
  const open = velocity > PINCH_FLICK_SPEED ? true
    : velocity < -PINCH_FLICK_SPEED ? false
      : mode === 'open' ? progress > 0.4 : progress > 0.6
  if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] pinch released', { mode, progress, velocity, open })
  settleTabOverview(open, open ? undefined : windowStateFor(pinchWindow)?.activeTabId ?? undefined, true, pinchWindow)
  return true
}

export function browserBack(): void {
  if (getTab()?.pdfEditor) {
    closePdfEditor()
    return
  }
  const contents = getTab()?.view?.webContents
  if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
}

export function browserForward(): void {
  const contents = getTab()?.view?.webContents
  if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
}

export function browserReload(): void {
  const id = getTab()?.id
  if (id) reloadBrowserTab(id)
}

export function browserStop(): void {
  getTab()?.view?.webContents.stop()
}

export async function browserPictureInPicture(): Promise<boolean> {
  const contents = getTab()?.view?.webContents
  if (!contents || contents.isDestroyed()) return false
  try {
    const result = await contents.executeJavaScript(`(async () => {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        return true
      }
      const videos = [...document.querySelectorAll('video')]
      const video = videos.find((item) => !item.disablePictureInPicture && !item.paused && item.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        || videos.find((item) => !item.disablePictureInPicture && item.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
      if (!video || typeof video.requestPictureInPicture !== 'function') return false
      await video.requestPictureInPicture()
      return document.pictureInPictureElement === video
    })()`, true)
    return result === true
  } catch {
    return false
  }
}

// A blocked permission shouldn't look like a broken page: flash a short notice over the active tab.
const shouldToastPermission = createPermissionToastThrottle()
onPermissionDenied((contents, permission, requestingUrl) => {
  const tab = tabForContents(contents)
  if (!tab?.view || !isTabOnScreen(tab) || contents.isDestroyed()) return
  let origin = ''
  try {
    origin = new URL(requestingUrl).origin
  } catch {
    // Unknown origin: still say what was blocked.
  }
  if (!shouldToastPermission(permission, origin)) return
  flashLinkStatus(permissionDeniedMessage(permission, origin), pageBoundsOf(tab), 3200, tab.win.window)
})

// ---------------------------------------------------------------------------
// Tab archive hooks (the feature itself lives in tab-archive.ts)

export function getBrowserTabArchiveCandidates(): TabArchiveCandidate[] {
  return allTabs().map((tab) => {
    const contents = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null
    return {
      id: tab.id,
      url: currentUrl(tab),
      pinned: tab.pinned,
      // Both panes of a split on screen count as in use.
      active: isTabOnScreen(tab),
      audible: Boolean(contents?.isCurrentlyAudible()),
      private: tab.isPrivate,
      extensionPage: Boolean(tab.extensionPageOrigin),
      unsavedPdfEdits: Boolean(tab.pdfEditor?.dirty),
      inactiveSince: isTabOnScreen(tab) ? null : tab.inactiveSince
    }
  })
}

/** Ids of every tab in the same window as `id` (the tab included). */
export function getBrowserTabIdsInSameWindow(id: string): string[] {
  return findTab(id)?.win.tabs.map((tab) => tab.id) ?? []
}

export interface BrowserTabArchiveCapture {
  url: string
  title: string
  faviconUrl: string | null
  history?: { entries: Electron.NavigationEntry[]; index: number }
}

/** What the archive keeps of a tab: URL, title, favicon and (when loaded) its back/forward list. */
export function captureBrowserTabForArchive(id: string): BrowserTabArchiveCapture | null {
  const tab = getTab(id)
  if (!tab || tab.isPrivate || tab.extensionPageOrigin) return null
  const capture: BrowserTabArchiveCapture = { url: currentUrl(tab), title: pageTitle(tab), faviconUrl: tab.faviconUrl }
  const contents = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null
  if (contents && !tab.pdfEditor) {
    try {
      capture.history = { entries: contents.navigationHistory.getAllEntries(), index: contents.navigationHistory.getActiveIndex() }
    } catch {
      // Older runtimes or a page mid-teardown: the URL alone still restores the tab.
    }
  }
  return capture
}

/** Close a tab into the archive (it doesn't go on the Reopen Closed Tab stack). True when it closed. */
export function closeBrowserTabForArchive(id: string): boolean {
  closeBrowserTab(id, false)
  return !getTab(id)
}

/** Reopen an archived tab into the focused (or last focused) normal window; background tabs stay asleep until first opened. */
export function openArchivedBrowserTab(url: string, history: { entries: Electron.NavigationEntry[]; index: number } | undefined, activate = true): string | null {
  const w = normalWindowState()
  const id = createTab(url, selectedSearchEngine, activate, true, false, false, undefined, undefined, false, false, w)
  const tab = id ? getTab(id) : undefined
  if (!tab) return null
  if (history && history.entries.length > 0) tab.restoreHistory = history
  if (activate) activateTabInternal(tab.id)
  else publishState(tab.win)
  persistOpenTabs()
  return id
}

export function flashBrowserStatus(message: string, durationMs = 2000): void {
  const w = currentWindowState()
  if (w) flashLinkStatus(message, w.browserBounds, durationMs, w.window)
}

// ---------------------------------------------------------------------------
// Split view: two tabs' pages side by side (state and layout math live in ../shared/split-view).
// The window's active tab is the focused pane, so everything that acts on "the active tab" (find,
// zoom, reader, screenshots, the address bar, Cmd+W) acts on the focused pane.

/** Keep each split's tabs adjacent in the tab list (the sidebar draws them as one entry) and drop stale splits. */
function keepSplitTabsTogether(w: BrowserWindowState): void {
  if (w.splits.length === 0) return
  const present = new Set(w.tabs.map((tab) => tab.id))
  for (const group of [...w.splits]) {
    for (const id of group.tabIds) {
      if (!present.has(id) || findTab(id)?.pinned) w.splits = removeTabFromSplits(w.splits, id).groups
    }
  }
  const order = orderTabsForSplits(w.tabs.map((tab) => tab.id), w.splits)
  if (order.every((id, index) => w.tabs[index]?.id === id)) return
  const byId = new Map(w.tabs.map((tab) => [tab.id, tab]))
  w.tabs.splice(0, w.tabs.length, ...order.map((id) => byId.get(id)!))
}

/** Can this tab be a pane? Not pinned (Favourites strip), and not the local New Tab page (it has no page view). */
function canSplitTab(tab: BrowserTab | undefined): tab is BrowserTab {
  return Boolean(tab && isLiveWindow(tab.win) && !tab.pinned && currentUrl(tab) !== SURFFISH_QUICK_LINKS_URL)
}

/** Same window, both splittable, and never a private tab next to a normal one. */
function canSplitTogether(a: BrowserTab | undefined, b: BrowserTab | undefined): boolean {
  return canSplitTab(a) && canSplitTab(b) && a !== b && a.win === b.win && a.isPrivate === b.isPrivate
}

function splitWith(ids: readonly string[], focusId: string, sizes?: readonly number[]): boolean {
  const tabs = ids.map((id) => findTab(id))
  const first = tabs[0]
  if (!first || tabs.length < 2 || tabs.length > MAX_SPLIT_PANES || tabs.some((tab) => tab === first ? !canSplitTab(tab) : !canSplitTogether(first, tab))) return false
  const w = first.win
  // A tab can only be in one split: take the tabs out of the ones they were in.
  for (const tab of tabs) w.splits = removeTabFromSplits(w.splits, tab!.id).groups
  const group = createSplitGroup(randomUUID(), ids, sizes)
  if (!group) return false
  w.splits.push(group)
  keepSplitTabsTogether(w)
  if (isTabOverviewOpen(w.window)) closeTabOverview(focusId, false)
  activateTabInternal(focusId)
  persistOpenTabs()
  return true
}

/** "Split with…": `id` on the left, `otherId` on the right, `id` focused. */
export function splitBrowserTabWith(id: string, otherId: string): boolean {
  return splitWith([id, otherId], id)
}

/**
 * "Open in Split View": show `id` next to the active tab. When a split is already on screen, `id`
 * takes the place of the pane that isn't focused.
 */
export function openBrowserTabInSplitView(id: string): boolean {
  const tab = findTab(id)
  const active = tab ? activeTabOf(tab.win) : undefined
  if (!tab || !active || active === tab) return false
  const group = splitOf(active)
  if (!group) return splitWith([active.id, id], id)
  if (group.tabIds.includes(id) || !canSplitTogether(active, tab)) return false
  const replaced = group.tabIds.find((paneId) => paneId !== active.id)
  if (!replaced) return false
  const w = tab.win
  w.splits = removeTabFromSplits(w.splits, id).groups
  w.splits = w.splits.map((candidate) => candidate.id === group.id ? replaceSplitPane(candidate, replaced, id) : candidate)
  keepSplitTabsTogether(w)
  activateTabInternal(id)
  const left = findTab(replaced)
  if (left && !isTabOnScreen(left)) markTabInactive(left)
  persistOpenTabs()
  publishState(w)
  return true
}

/** Tabs the "Split with…" menu offers for `id`: the window's other splittable tabs, most recently used first. */
function splitCandidates(tab: BrowserTab): BrowserTab[] {
  const w = tab.win
  const rank = (candidate: BrowserTab): number => {
    const index = w.recentTabIds.indexOf(candidate.id)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  return w.tabs.filter((candidate) => canSplitTogether(tab, candidate) && !splitOf(candidate)).sort((a, b) => rank(a) - rank(b))
}

/** Cmd/Ctrl+Shift+=: split the active tab with the last used one (active on the left), or unsplit. */
export function toggleBrowserSplitView(): boolean {
  const w = currentWindowState()
  const active = activeTabOf(w)
  if (!w || !active) return false
  if (splitOf(active)) return unsplitBrowserTab(active.id)
  const other = pickLastUsedTab(w.recentTabIds, active.id, (id) => canSplitTogether(active, findTab(id)) && !splitOf(findTab(id)))
    ?? splitCandidates(active)[0]?.id
  if (!other || !canSplitTab(active)) {
    const message = canSplitTab(active) ? 'Open another tab to split with' : (active as BrowserTab).pinned ? 'Unpin the tab to split it' : 'Open a page to split it'
    flashLinkStatus(message, w.browserBounds, 2200, w.window)
    return false
  }
  return splitWith([active.id, other], active.id)
}

/** Unsplit the split `id` is in; the focused pane stays on screen. */
export function unsplitBrowserTab(id = getTab()?.id): boolean {
  const tab = findTab(id)
  const group = splitOf(tab)
  if (!tab || !group) return false
  const w = tab.win
  const wasOnScreen = onScreenTabIds(w)
  w.splits = w.splits.filter((candidate) => candidate !== group)
  const nowOnScreen = onScreenTabIds(w)
  for (const goneId of wasOnScreen) {
    const gone = nowOnScreen.includes(goneId) ? undefined : findTab(goneId)
    if (gone) markTabInactive(gone)
  }
  applyTabBounds(w)
  persistOpenTabs()
  publishState(w)
  return true
}

/** Swap the panes of the split `id` is in (the layout stays, the pages trade places). */
export function swapBrowserSplitPanes(id = getTab()?.id): boolean {
  const tab = findTab(id)
  const group = splitOf(tab)
  if (!tab || !group) return false
  const w = tab.win
  w.splits = w.splits.map((candidate) => candidate === group ? swapSplitPanes(candidate) : candidate)
  keepSplitTabsTogether(w)
  applyTabBounds(w)
  persistOpenTabs()
  publishState(w)
  return true
}

/** Pop a pane out into its own tab (placed right after the split) and show it on its own. */
export function popOutBrowserSplitPane(id = getTab()?.id): boolean {
  const tab = findTab(id)
  const group = splitOf(tab)
  if (!tab || !group) return false
  const w = tab.win
  w.splits = removeTabFromSplits(w.splits, tab.id).groups
  const from = w.tabs.indexOf(tab)
  const lastMember = Math.max(...group.tabIds.map((memberId) => w.tabs.findIndex((candidate) => candidate.id === memberId)))
  if (from >= 0 && lastMember > from) {
    w.tabs.splice(from, 1)
    w.tabs.splice(lastMember, 0, tab)
  }
  activateTabInternal(tab.id)
  persistOpenTabs()
  return true
}

/** Make the pane showing `id` the focused one (the active tab), optionally moving keyboard focus into it. */
function focusSplitPane(id: string | undefined, focusContents = true): boolean {
  const tab = findTab(id)
  if (!tab || !isTabOnScreen(tab)) return false
  if (isActiveTab(tab)) {
    if (focusContents) tab.view?.webContents.focus()
    return true
  }
  const w = tab.win
  if (focusContents) {
    activateTabInternal(tab.id)
  } else {
    // A click already put the keyboard there; just move the active tab without refocusing.
    cancelActiveMacTrackpadSwipe()
    hideLinkStatus(false, w.window)
    if (w.findState.open) closeFindBar(false, w)
    w.activeTabId = tab.id
    w.recentTabIds = noteRecentTab(w.recentTabIds, tab.id)
    applyTabBounds(w)
    publishState(w)
  }
  persistOpenTabs()
  return true
}

/** Cmd/Ctrl+Alt+Left/Right: focus the pane to the left/right of the focused one. */
export function focusAdjacentSplitPane(offset: number): boolean {
  const active = getTab()
  const group = splitOf(active)
  if (!active || !group) return false
  const index = group.tabIds.indexOf(active.id)
  const next = group.tabIds[Math.max(0, Math.min(group.tabIds.length - 1, index + offset))]
  return next !== active.id && focusSplitPane(next, true)
}

/** Even out the split on screen (double-click on the divider). */
export function resetBrowserSplitSizes(): boolean {
  const w = currentWindowState()
  const group = splitOf(activeTabOf(w))
  if (!w || !group) return false
  w.splits = w.splits.map((candidate) => candidate === group ? { ...candidate, sizes: group.tabIds.map(() => 1 / group.tabIds.length) } : candidate)
  applyTabBounds(w)
  persistOpenTabs()
  return true
}

/** The tab whose pane is under a window-coordinate point (null when no split is on screen). */
function tabAtWindowPoint(w: BrowserWindowState, x: number, y: number): BrowserTab | undefined {
  const group = splitOf(activeTabOf(w))
  if (!group || !Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const layout = splitPaneRects(w.browserBounds, group.sizes)
  const index = layout.cells.findIndex((cell) => x >= cell.x && x < cell.x + cell.width && y >= cell.y && y < cell.y + cell.height)
  return index >= 0 ? findTab(group.tabIds[index]) : undefined
}

/** A sidebar tab dropped over its own window's page area: the outer left/right edge splits it with the page. */
function dropTabOnPageEdge(tab: BrowserTab, screenPoint: { x: number; y: number }): boolean {
  const w = tab.win
  let content: Electron.Rectangle
  try {
    content = w.window.getContentBounds()
  } catch {
    return false
  }
  const side = splitDropSide(w.browserBounds, screenPoint.x - content.x, screenPoint.y - content.y)
  return side ? dropTabIntoSplit(tab.id, side) : false
}

/**
 * Put `id` on the `side` of the page on screen: a new split with the active tab, or (when a split is
 * already on screen) in place of the pane on that side.
 */
export function dropTabIntoSplit(id: string, side: 'left' | 'right'): boolean {
  const tab = findTab(id)
  const w = tab?.win
  const active = activeTabOf(w)
  if (!tab || !w || !active || tab === active || splitOf(tab)) return false
  const group = splitOf(active)
  if (!group) return splitWith(side === 'left' ? [tab.id, active.id] : [active.id, tab.id], tab.id)
  if (!canSplitTogether(active, tab)) return false
  const replaced = side === 'left' ? group.tabIds[0]! : group.tabIds[group.tabIds.length - 1]!
  w.splits = w.splits.map((candidate) => candidate === group ? replaceSplitPane(candidate, replaced, tab.id) : candidate)
  keepSplitTabsTogether(w)
  activateTabInternal(tab.id)
  const gone = findTab(replaced)
  if (gone && !isTabOnScreen(gone)) markTabInactive(gone)
  persistOpenTabs()
  publishState(w)
  return true
}

/** Tab context-menu items: split actions for a pane, or the ways to split a plain tab. */
function splitTabMenuItems(tab: BrowserTab): MenuItemConstructorOptions[] {
  const group = splitOf(tab)
  if (group) {
    return [
      { label: 'Swap Split Panes', click: () => { swapBrowserSplitPanes(tab.id) } },
      { label: 'Open Pane as Its Own Tab', click: () => { popOutBrowserSplitPane(tab.id) } },
      { label: 'Unsplit Tabs', ...tabMenuAccelerator('splitView'), click: () => { unsplitBrowserTab(tab.id) } },
      { type: 'separator' }
    ]
  }
  const active = activeTabOf(tab.win)
  const candidates = canSplitTab(tab) ? splitCandidates(tab).slice(0, 20) : []
  const short = (title: string): string => title.length > 48 ? `${title.slice(0, 47)}…` : title
  return [
    { label: 'Open in Split View', enabled: Boolean(active && active !== tab && canSplitTogether(active, tab)), click: () => { openBrowserTabInSplitView(tab.id) } },
    {
      label: 'Split with…',
      enabled: candidates.length > 0,
      submenu: candidates.length > 0
        ? candidates.map((candidate): MenuItemConstructorOptions => ({ label: short(pageTitle(candidate)), click: () => { splitBrowserTabWith(tab.id, candidate.id) } }))
        : [{ label: 'No other tabs to split with', enabled: false }]
    },
    { type: 'separator' }
  ]
}

/** The divider and pane-margin input from the split surface behind the panes. */
function attachSplitSurface(w: BrowserWindowState): void {
  const group = (): SplitGroup | undefined => splitOf(activeTabOf(w))
  setSplitSurfaceHandlers(w.window, {
    resize: (index, x) => {
      const current = group()
      if (!current) return
      const sizes = resizeSplitAt(w.browserBounds, current.sizes, index, x)
      w.splits = w.splits.map((candidate) => candidate === current ? { ...candidate, sizes } : candidate)
      applyTabBounds(w)
    },
    resizeEnd: () => persistOpenTabs(),
    reset: () => { runInWindow(w.window, () => resetBrowserSplitSizes()) },
    focusPane: (index) => { focusSplitPane(group()?.tabIds[index], true) }
  })
}

/** Split views of the current window, for the renderer and smoke tests. */
export interface BrowserSplitSnapshot {
  splits: { id: string; tabIds: string[]; sizes: number[] }[]
  /** The split on screen, with each pane's view bounds (window coordinates). */
  visible: { id: string; focusedTabId: string; panes: BrowserBounds[]; dividers: BrowserBounds[] } | null
}

export function getBrowserSplitState(): BrowserSplitSnapshot {
  const w = currentWindowState()
  const group = splitOf(activeTabOf(w))
  const layout = w && group ? splitPaneRects(w.browserBounds, group.sizes) : null
  return {
    splits: (w?.splits ?? []).map((candidate) => ({ id: candidate.id, tabIds: candidate.tabIds.slice(), sizes: candidate.sizes.slice() })),
    visible: w && group && layout ? { id: group.id, focusedTabId: w.activeTabId ?? '', panes: layout.panes, dividers: layout.dividers } : null
  }
}

/** Whether `id` (default: the active tab) can be split, and whether it already is. */
export function getBrowserTabSplitStatus(id = getTab()?.id): { split: boolean; canSplit: boolean } {
  const tab = findTab(id)
  return { split: Boolean(splitOf(tab)), canSplit: Boolean(tab && canSplitTab(tab) && (splitOf(tab) || splitCandidates(tab).length > 0)) }
}
