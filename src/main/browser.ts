import { randomUUID } from 'node:crypto'
import { shouldHandOffSignIn, signInContinueUrl } from './google-webkit-sign-in-policy.ts'
import { hasGoogleSessionCookie, isWebKitGoogleSignInAvailable, runWebKitGoogleSignIn } from './google-webkit-sign-in'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, clipboard, dialog, Menu, WebContentsView, type BaseWindow, type ContextMenuParams, type Event, type MenuItemConstructorOptions, type WebContents, type WebFrameMain } from 'electron'
import type { BrowserBounds, BrowserFindState, BrowserState, BrowserTabSummary, SearchEngineId, TabSleepMinutes } from '../shared/types'
import type { ExtensionTabRecord } from '../shared/extension-tabs'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, isBrowserTabSleeping, isYouTubeUrl, resolveNavigationTarget, SURFFISH_QUICK_LINKS_URL } from '../shared/navigation'
import { DEFAULT_TAB_SLEEP_MINUTES, isTabSleepMinutes, MAX_CACHED_FAVICON_BYTES, MAX_PINNED_SITES, normalizeCachedFaviconDataUrl, normalizeFaviconUrl, normalizeHttpOrigin } from '../shared/persistence'
import { cleanLinkUrl } from '../shared/clean-link'
import { stepZoomFactor } from '../shared/zoom'
import { recordBrowsingVisit, updateLatestVisitFavicon, updateLatestVisitTitle } from './history'
import { BROWSER_SESSION_PARTITION, clearPrivateSession, getBrowserSession, getPrivateSession, whenPrivateSessionReady } from './browser-session'
import { forgetPrivateDownloads } from './downloads'
import { getBrowserNewTabPage, getBrowserPreferencesSnapshot, getBrowserPinnedSites, getCachedBrowserSiteFavicon, getBrowserSiteSettings, getBrowserSiteZoom, getBrowserTabSleepMinutes, loadBrowserSession, saveBrowserSiteZoom, saveBrowserPinnedSites, saveBrowserSession, saveBrowserSiteFavicon } from './browser-persistence'
import { showBrowserContextMenu } from './context-menu'
import { isShowingPdf, printPdf } from './pdf-viewer'
import { attachPdfEditor, confirmDiscardPdfEdits, getPdfEditorSession, pdfEditorPreloadPath, sendPdfEditorCommand } from './pdf-editor'
import { isEditablePdfSource, isPdfEditorUrl, PDF_EDITOR_URL, pdfEditorTabTitle, pdfNameFromUrl } from '../shared/pdf-editor'
import { isLocalDocumentUrl } from '../shared/external-links'
import { isBrambleExtensionUrl } from './bramble-poc-adapter'
import { attachNetworkInspector, detachNetworkInspector } from './network-inspector'
import { captureLocalNewTabPage, focusVisibleShellPage, getBrowserChromeState, getMainRendererOrigin, getMainWindowRenderers, handleBrowserPageMouseEvent, isFocusAddressShortcut, sendFocusAddressToVisibleRenderer, sendToMainWindowRenderers, sendToToolbarRenderer, setBrowserChromeState, setBrowserPageIsLocalNewTab } from './browser-shell'
import { guardPageDragRegions } from './page-drag-guard'
import { avoidLinkStatusPointer, destroyLinkStatus, flashLinkStatus, hideLinkStatus, showLinkStatus } from './link-status'
import { copyImageAtPoint, isCopyImageClick } from './copy-image'
import { onPermissionDenied } from './proxy'
import { attachTabSafety } from './safety'
import { getTabInterstitial, onTabInterstitialChanged } from './tab-interstitials'
import { isTabCrashed, recoverCrashedTabOnActivate } from './tab-health'
import { createPermissionToastThrottle, permissionDeniedMessage } from '../shared/site-permissions'
import { startMacTrackpadSwipe, stopMacTrackpadSwipe, type MacTrackpadPinchPhase, type MacTrackpadSwipeBeginRequest, type MacTrackpadSwipeDirection } from './mac-trackpad-swipe'
import { attachTabOverview, closeTabOverview, detachTabOverview, getTabOverviewContentsId, getTabOverviewSelectedId, getTabOverviewState, moveTabOverviewSelection, isTabOverviewOpen, openTabOverview, setTabOverviewProgress, settleTabOverview, toggleTabOverview, type TabOverviewItem } from './tab-overview'

export const START_PAGE = 'https://online.bonjourr.fr/'
interface BrowserTab {
  id: string
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
const tabs: BrowserTab[] = []
let activeTabId: string | null = null
let browserWindow: BaseWindow | null = null
let browserBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
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

function getTab(id: string | null = activeTabId): BrowserTab | undefined {
  return tabs.find((tab) => tab.id === id)
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
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
  return Boolean(tab?.pauseAutoplayUntilVisited && tab.id !== activeTabId)
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

function getState(): BrowserState {
  const tab = getTab()
  const contents = tab?.view?.webContents
  return {
    url: tab ? currentUrl(tab) : configuredStartPage(),
    title: tab ? pageTitle(tab) : 'New tab',
    loading: contents?.isLoading() ?? false,
    // Back from the editor returns to the viewer.
    canGoBack: tab?.pdfEditor ? true : contents?.navigationHistory.canGoBack() ?? false,
    canGoForward: tab?.pdfEditor ? false : contents?.navigationHistory.canGoForward() ?? false,
    error: tab?.error ?? null,
    private: tab?.isPrivate ?? false,
    zoomFactor: contents && !contents.isDestroyed() ? contents.getZoomFactor() : 1,
    pdf: tab?.pdfEditor ? 'editor' : tab?.showingPdf ? 'viewer' : null,
    interstitial: getTabInterstitial(contents)
  }
}

function getTabSummaries(): BrowserTabSummary[] {
  return tabs.map((tab) => ({
    id: tab.id,
    url: currentUrl(tab),
    title: pageTitle(tab),
    faviconUrl: tab.faviconUrl,
    loading: tab.view?.webContents.isLoading() ?? false,
    active: tab.id === activeTabId,
    pinned: tab.pinned,
    sleeping: isBrowserTabSleeping(tab.view !== null, currentUrl(tab)),
    private: tab.isPrivate,
    audible: Boolean(tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible()),
    muted: Boolean(tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isAudioMuted()),
    crashed: isTabCrashed(tab.view?.webContents)
  }))
}

function persistPageFavicon(pageUrl: string, faviconUrl: string | null): void {
  if (!faviconUrl) return
  const safeFaviconUrl = normalizeFaviconUrl(faviconUrl)
  const origin = normalizeHttpOrigin(pageUrl)
  if (!safeFaviconUrl || !origin) return
  updateLatestVisitFavicon(pageUrl, safeFaviconUrl)

  const pinnedSites = getBrowserPinnedSites()
  let pinnedSitesChanged = false
  const nextPinnedSites = pinnedSites.map((site) => {
    if (normalizeHttpOrigin(site.url) !== origin || site.faviconUrl === safeFaviconUrl) return site
    pinnedSitesChanged = true
    return { ...site, faviconUrl: safeFaviconUrl }
  })
  if (pinnedSitesChanged) {
    saveBrowserPinnedSites(nextPinnedSites)
    sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
  }
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
      publishTabs()
    }
    if (!tab.isPrivate) void cachePageFavicon(pageUrl, faviconUrl).then((cachedIcon) => {
      if (!cachedIcon || tab.view?.webContents !== contents || tab.faviconRevision !== revision || contents.getURL() !== pageUrl) return
      if (tab.faviconUrl !== cachedIcon) {
        tab.faviconUrl = cachedIcon
        publishTabs()
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

function publishTabs(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  sendToMainWindowRenderers('browser:tabs', getTabSummaries())
}

function publishState(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const state = getState()
  // Crash / hang / HTTPS notices are drawn by the content renderer, like the local New Tab page.
  setBrowserPageIsLocalNewTab(state.url === SURFFISH_QUICK_LINKS_URL || state.interstitial !== null)
  sendToMainWindowRenderers('browser:state', state)
  publishTabs()
}

function persistOpenTabs(): void {
  // Local files opened from the OS are not restored (the path may be gone, and restore only allows http(s)).
  const saved = tabs.filter((tab) => !tab.isPrivate && !currentUrl(tab).startsWith('file:'))
  const urls = saved.map(currentUrl)
  const pinnedIndexes = saved.flatMap((tab, index) => tab.pinned ? [index] : [])
  saveBrowserSession(urls, saved.findIndex((tab) => tab.id === activeTabId), pinnedIndexes)
}

function toggleTabBookmark(id: string): void {
  const tab = getTab(id)
  if (!tab) return
  const origin = normalizeHttpOrigin(currentUrl(tab))
  if (!origin) return
  const bookmarks = getBrowserPinnedSites()
  const isBookmarked = bookmarks.some((site) => normalizeHttpOrigin(site.url) === origin)
  if (!isBookmarked && bookmarks.length >= MAX_PINNED_SITES) return
  const next = isBookmarked
    ? bookmarks.filter((site) => normalizeHttpOrigin(site.url) !== origin)
    : [...bookmarks, {
        title: pageTitle(tab).trim().slice(0, 80) || new URL(origin).hostname,
        url: origin,
        ...(tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {})
      }]
  saveBrowserPinnedSites(next)
  sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
}

function applyTabBounds(): void {
  for (const tab of tabs) {
    if (!tab.view) continue
    const visible = tab.id === activeTabId
    tab.view.setBounds(visible ? browserBounds : { x: 0, y: 0, width: 0, height: 0 })
  }
}

function cancelSleepTimer(tab: BrowserTab): void {
  if (tab.sleepTimer) clearTimeout(tab.sleepTimer)
  tab.sleepTimer = null
}

function hibernateTab(tab: BrowserTab): void {
  if (tab.id === activeTabId || !tab.view) return
  const contents = tab.view.webContents
  if (!contents.isDestroyed() && contents.isCurrentlyAudible()) {
    tab.sleepTimer = setTimeout(() => hibernateTab(tab), 60_000)
    return
  }
  tab.lastUrl = currentUrl(tab)
  tab.pendingUrl = tab.lastUrl
  disposeTabView(tab)
  persistOpenTabs()
  publishState()
}

function scheduleTabSleep(tab: BrowserTab): void {
  cancelSleepTimer(tab)
  // An editor tab holds unsaved edits in memory, so it never sleeps.
  if (tabSleepMinutes === 0 || !tab.view || tab.extensionPageOrigin || tab.pdfEditor || tab.id === activeTabId || tab.inactiveSince === null) return
  const delay = Math.max(0, tabSleepMinutes * 60_000 - (Date.now() - tab.inactiveSince))
  tab.sleepTimer = setTimeout(() => hibernateTab(tab), delay)
}

function markTabInactive(tab: BrowserTab): void {
  tab.inactiveSince = Date.now()
  scheduleTabSleep(tab)
}

function openBackgroundTab(url: string, isPrivate = false): void {
  const id = createTab(url, selectedSearchEngine, false, false, true, false, undefined, undefined, isPrivate)
  if (id) persistOpenTabs()
}

function disposeTabView(tab: BrowserTab): void {
  cancelSleepTimer(tab)
  const view = tab.view
  if (!view) return
  // Clear the reference first so its destroyed event cannot remove the logical tab.
  tab.view = null
  detachNetworkInspector(view.webContents)
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.contentView.removeChildView(view)
  if (!view.webContents.isDestroyed()) view.webContents.close()
  applyTabBounds()
}

function ensureTabLoaded(tab: BrowserTab): void {
  if (tab.view || !browserWindow || browserWindow.isDestroyed()) return
  const target = tab.pendingUrl || tab.lastUrl || configuredStartPage()
  if (target === SURFFISH_QUICK_LINKS_URL) {
    tab.pendingUrl = ''
    return
  }
  tab.pendingUrl = target
  const view = createTabView(tab)
  if (!view) return
  tab.pendingUrl = ''
  if (tab.id === activeTabId) tab.inactiveSince = null
  applyTabBounds()
  const contents = view.webContents
  // Private pages wait for their session's proxy/ad-block setup so nothing ever goes out direct.
  const ready = tab.isPrivate && !tab.pdfEditor ? whenPrivateSessionReady() : Promise.resolve()
  void ready.then(() => contents.isDestroyed() ? undefined : contents.loadURL(target)).catch((error: unknown) => {
    if (tab.view?.webContents !== contents) return
    const message = error instanceof Error ? error.message : String(error)
    if (!tab.downloadStartedForCurrentLoad && message.includes('ERR_FAILED')) {
      return new Promise<void>((resolve) => setTimeout(resolve, 100)).then(() => {
        if (tab.view?.webContents !== contents) return
        if (tab.downloadStartedForCurrentLoad) tab.error = null
        else tab.error = message
        publishState()
      })
    }
    if (tab.downloadStartedForCurrentLoad) {
      tab.error = null
      publishState()
      return
    }
    tab.error = message
    publishState()
  })
}

function activateTabInternal(id: string): boolean {
  const tab = getTab(id)
  if (!tab) return false
  if (activeTabId !== id) cancelActiveMacTrackpadSwipe()
  const previous = getTab()
  if (previous && previous.id !== id) {
    hideLinkStatus()
    if (findState.open) closeFindBar(false)
  }
  // Best effort: grab the outgoing tab while it is still on screen for the tab overview.
  if (previous && previous.id !== id) void captureTabThumbnail(previous)
  if (previous && previous.id !== id) markTabInactive(previous)
  cancelSleepTimer(tab)
  tab.inactiveSince = null
  tab.pauseAutoplayUntilVisited = false
  activeTabId = id
  ensureTabLoaded(tab)
  const contents = tab.view?.webContents
  if (contents && !contents.isDestroyed()) {
    contents.send(BACKGROUND_YOUTUBE_AUTOPLAY_ALLOW_CHANNEL)
    contents.focus()
    recoverCrashedTabOnActivate(contents)
  }
  applyTabBounds()
  publishState()
  return true
}

function showTabContextMenu(contents: WebContents, event: Event, params: ContextMenuParams): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
  const isBrowserPage = tab !== undefined
  const editorTab = tab?.pdfEditor ? tab : undefined
  const origin = isBrowserPage ? { x: browserBounds.x, y: browserBounds.y } : getMainRendererOrigin(contents) ?? { x: 0, y: 0 }
  showBrowserContextMenu(event, contents, params, {
    window: browserWindow,
    pageActions: isBrowserPage,
    offsetX: origin.x,
    offsetY: origin.y,
    searchEngine: selectedSearchEngine,
    openInNewTab: (url) => {
      const id = createTab(url, selectedSearchEngine)
      if (id) persistOpenTabs()
    },
    openInBackgroundTab: openBackgroundTab,
    pdfDocument: isBrowserPage && isShowingPdf(contents),
    printPage: isBrowserPage ? () => { void printPdf(contents).catch((error: unknown) => console.warn('Could not print:', error)) } : undefined,
    editPdf: isBrowserPage && editorTab === undefined ? () => { if (tab) openPdfEditor(tab.id) } : undefined,
    pdfEditor: editorTab ? {
      save: () => sendPdfEditorCommand(contents, 'save'),
      backToViewer: () => { closePdfEditor(editorTab.id) }
    } : undefined
  })
}

function showBrowserTabContextMenu(id: string): void {
  const tab = getTab(id)
  if (!tab || !browserWindow || browserWindow.isDestroyed()) return
  const origin = normalizeHttpOrigin(currentUrl(tab))
  const bookmarked = Boolean(origin && getBrowserPinnedSites().some((site) => normalizeHttpOrigin(site.url) === origin))
  const items: MenuItemConstructorOptions[] = [
    { label: bookmarked ? 'Remove Bookmark' : 'Bookmark Tab', ...tabMenuAccelerator('bookmark'), enabled: Boolean(origin) && (bookmarked || getBrowserPinnedSites().length < MAX_PINNED_SITES), click: () => toggleTabBookmark(id) },
    { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', ...tabMenuAccelerator('pin'), click: () => setBrowserTabPinned(id, !tab.pinned) },
    { label: 'Duplicate Tab', ...tabMenuAccelerator('duplicate'), click: () => { void duplicateBrowserTab(id) } },
    { label: 'Copy Link', ...tabMenuAccelerator('copyLink'), enabled: Boolean(origin), click: () => clipboard.writeText(currentUrl(tab)) },
    { label: 'Copy Clean Link', ...tabMenuAccelerator('copyCleanLink'), enabled: Boolean(origin), click: () => clipboard.writeText(cleanLinkUrl(currentUrl(tab))) },
    { type: 'separator' },
    { label: 'Reload Tab', ...tabMenuAccelerator('reload'), click: () => reloadBrowserTab(id) },
    { label: 'Suspend Tab', enabled: id !== activeTabId && tab.view !== null, click: () => { suspendBrowserTab(id) } },
    { label: 'Suspend Other Tabs', enabled: tabs.some((candidate) => candidate.id !== id && candidate.id !== activeTabId && candidate.view !== null), click: () => suspendOtherBrowserTabs(id) },
    { type: 'separator' },
    { label: 'Close Tab', ...tabMenuAccelerator('close'), click: () => closeBrowserTab(id) },
    { label: 'Close Tabs Above', enabled: tabs.some((_candidate, index) => index < tabs.findIndex((entry) => entry.id === id)), click: () => closeBrowserTabsRelative(id, 'above') },
    { label: 'Close Tabs Below', enabled: tabs.some((_candidate, index) => index > tabs.findIndex((entry) => entry.id === id)), click: () => closeBrowserTabsRelative(id, 'below') },
    { label: 'Close Other Tabs', ...tabMenuAccelerator('closeOthers'), enabled: tabs.length > 1, click: () => closeBrowserTabsRelative(id, 'others') }
  ]
  Menu.buildFromTemplate(items).popup({ window: browserWindow })
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
  if (!browserWindow || browserWindow.isDestroyed()) return null
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
      spellcheck: true
    }
  })
  tab.view = view
  // Site tabs are always below the local toolbar, sidebar, and full-app surfaces.
  browserWindow.contentView.addChildView(view, 0)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

  const contents = view.webContents
  attachNetworkInspector(tab.id, contents)
  attachTabSafety(contents)
  const isCurrentContents = (): boolean => tab.view?.webContents === contents
  contents.on('before-mouse-event', (_event, mouseEvent) => {
    if (activeTabId !== tab.id || !isCurrentContents()) return
    handleBrowserPageMouseEvent(mouseEvent)
    if (mouseEvent.type === 'mouseMove') avoidLinkStatusPointer(mouseEvent.x, mouseEvent.y)
    if (isCopyImageClick(mouseEvent)) {
      void copyImageAtPoint(contents, mouseEvent.x, mouseEvent.y).then((copied) => {
        if (copied) flashLinkStatus('Image copied', browserBounds)
      })
    }
  })
  contents.on('update-target-url', (_event, url) => {
    if (activeTabId === tab.id && isCurrentContents()) showLinkStatus(url, browserBounds)
  })
  contents.on('found-in-page', (_event, result) => {
    if (!isCurrentContents() || findState.tabId !== tab.id || !findState.open) return
    findState.result = { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches, finalUpdate: result.finalUpdate }
    publishFindState()
  })
  // Ctrl/Cmd + mouse wheel (and Windows precision-touchpad zoom) step the page zoom like Chrome.
  contents.on('zoom-changed', (_event, direction) => {
    if (isCurrentContents()) zoomTab(tab, direction === 'in' ? 'in' : 'out')
  })
  contents.on('context-menu', (event, params) => showTabContextMenu(contents, event, params))
  guardPageDragRegions(contents)
  contents.on('media-started-playing', () => {
    if (!isCurrentContents() || !tab.pauseAutoplayUntilVisited || tab.id === activeTabId || contents.isDestroyed()) return
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
        if (createTab(target, selectedSearchEngine, details.disposition !== 'background-tab')) persistOpenTabs()
      } else if (details.disposition === 'background-tab') {
        openBackgroundTab(target, tab.isPrivate)
      } else if (getBrowserSiteSettings(contents.getURL())?.openPopupsInTabs) {
        const popupTabId = createTab(target, selectedSearchEngine, true, false, false, false, undefined, undefined, tab.isPrivate)
        if (popupTabId) persistOpenTabs()
      }
    }
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, inputEvent) => {
    if (isFocusAddressShortcut(inputEvent)) {
      event.preventDefault()
      sendFocusAddressToVisibleRenderer()
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
    publishTabs()
  })
  contents.on('did-start-loading', () => {
    if (!isCurrentContents()) return
    tab.error = null
    publishState()
  })
  contents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (isCurrentContents() && isMainFrame && !isInPlace) tab.showingPdf = false
    if (!isCurrentContents() || !isMainFrame || (!/^https?:\/\//i.test(url) && !isExtensionPage(tab, url))) return
    if (!isInPlace && tab.id === activeTabId) hideLinkStatus()
    tab.downloadStartedForCurrentLoad = false
    tab.lastUrl = url
    tab.faviconUrl = /^https?:\/\//i.test(url) ? getCachedBrowserSiteFavicon(url) : null
    tab.faviconRevision += 1
    persistOpenTabs()
    publishTabs()
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
      publishTabs()
    }
    if (!tab.isPrivate) void cachePageFavicon(pageUrl, faviconUrl).then((cachedIcon) => {
      if (!cachedIcon || tab.view?.webContents !== contents || tab.faviconRevision !== revision || contents.getURL() !== pageUrl) return
      if (tab.faviconUrl !== cachedIcon) {
        tab.faviconUrl = cachedIcon
        publishTabs()
      }
    })
  })
  contents.on('did-stop-loading', () => {
    if (!isCurrentContents()) return
    tab.showingPdf = isShowingPdf(contents)
    publishState()
    refreshTabFavicon(tab)
  })
  // The built-in PDF viewer is a child frame; notice it (and its absence) as soon as frames load.
  contents.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (!isCurrentContents() || isMainFrame) return
    const showingPdf = isShowingPdf(contents)
    if (showingPdf === tab.showingPdf) return
    tab.showingPdf = showingPdf
    if (tab.id === activeTabId) publishState()
  })
  contents.on('did-navigate', (_event, url) => {
    if (!isCurrentContents()) return
    applySavedZoom(tab, url)
    if (findState.open && findState.tabId === tab.id) {
      // A new document: the old matches are gone, so search the new page for the same text.
      findState.result = null
      if (findState.text) contents.findInPage(findState.text, { findNext: true })
      publishFindState()
    }
    tab.lastUrl = url
    persistOpenTabs()
    publishState()
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
    publishState()
    if (!tab.isPrivate && /^https?:\/\//i.test(url)) {
      recordBrowsingVisit(url, pageTitle(tab))
      notifyHistoryChanged()
    }
  })
  contents.on('page-title-updated', (_event, title) => {
    if (!isCurrentContents()) return
    if (!tab.isPrivate) updateLatestVisitTitle(contents.getURL(), title)
    publishState()
    refreshTabFavicon(tab)
    notifyHistoryChanged()
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame) return
    resetMacTrackpadSwipeFor(contents)
    if (errorCode === -3) return
    if (tab.downloadStartedForCurrentLoad) {
      tab.error = null
      publishState()
      return
    }
    tab.error = `${errorDescription} (${errorCode})`
    publishState()
  })
  contents.on('did-stop-loading', () => {
    setTimeout(() => {
      // Overview open and tab switches capture fresh shots anyway; only seed tabs that have none,
      // so ordinary page loads don't pay for a full-page capture + JPEG encode on the main thread.
      if (isCurrentContents() && tab.id === activeTabId && !isTabOverviewOpen() && !tabThumbnails.has(tab.id)) void captureTabThumbnail(tab)
    }, 700)
  })
  contents.on('destroyed', () => {
    if (activeMacTrackpadSwipe?.contents === contents) {
      activeMacTrackpadSwipe = null
      nextMacTrackpadSwipeToken += 1
    }
    detachNetworkInspector(contents)
    if (!isCurrentContents()) return
    const index = tabs.findIndex((candidate) => candidate.id === tab.id)
    if (index < 0) return
    tabs.splice(index, 1)
    if (activeTabId === tab.id) {
      activeTabId = null
      const replacement = tabs[Math.min(index, tabs.length - 1)]
      if (replacement) activateTabInternal(replacement.id)
      else if (browserWindow && !browserWindow.isDestroyed()) newBrowserTab()
    }
    publishState()
  })
  return view
}

/**
 * The PDF editor runs in a tab of its own kind: the isolated editor session (no network, the
 * surffish-pdf:// scheme only), its narrow preload, and no page-level extras (ad-filter preload,
 * swipe preload, network inspector). Only main ever navigates it.
 */
function createPdfEditorView(tab: BrowserTab): WebContentsView | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
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
      spellcheck: !tab.isPrivate
    }
  })
  tab.view = view
  browserWindow.contentView.addChildView(view, 0)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  const contents = view.webContents
  const isCurrentContents = (): boolean => tab.view?.webContents === contents
  contents.on('context-menu', (event, params) => showTabContextMenu(contents, event, params))
  contents.on('before-mouse-event', (_event, mouseEvent) => {
    if (activeTabId === tab.id && isCurrentContents()) handleBrowserPageMouseEvent(mouseEvent)
  })
  contents.on('before-input-event', (event, inputEvent) => {
    if (inputEvent.type !== 'keyDown' || (!inputEvent.control && !inputEvent.meta)) return
    // Cmd/Ctrl+S saves here (and only here), so the page and the app menu never both fire.
    if (inputEvent.key.toLowerCase() === 's' && !inputEvent.alt) {
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
      const id = createTab(target, selectedSearchEngine, details.disposition !== 'background-tab', false, false, false, undefined, undefined, tab.isPrivate)
      if (id) persistOpenTabs()
    }
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event, url) => { if (!isPdfEditorUrl(url)) event.preventDefault() })
  contents.on('did-start-loading', () => {
    if (!isCurrentContents()) return
    tab.error = null
    publishState()
  })
  contents.on('did-stop-loading', () => { if (isCurrentContents()) publishState() })
  contents.on('page-title-updated', () => { if (isCurrentContents()) publishState() })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame || errorCode === -3) return
    tab.error = `${errorDescription} (${errorCode})`
    publishState()
  })
  contents.on('render-process-gone', () => {
    // A crashed editor has lost its edits either way; don't nag on close.
    if (isCurrentContents() && tab.pdfEditor) tab.pdfEditor.dirty = false
  })
  contents.on('destroyed', () => {
    if (!isCurrentContents()) return
    const index = tabs.findIndex((candidate) => candidate.id === tab.id)
    if (index < 0) return
    tabs.splice(index, 1)
    if (activeTabId === tab.id) {
      activeTabId = null
      const replacement = tabs[Math.min(index, tabs.length - 1)]
      if (replacement) activateTabInternal(replacement.id)
      else if (browserWindow && !browserWindow.isDestroyed()) newBrowserTab()
    }
    publishState()
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
  if (tab.id === activeTabId) {
    ensureTabLoaded(tab)
    applyTabBounds()
    const contents = tab.view?.webContents
    if (contents && !contents.isDestroyed()) contents.focus()
  }
  persistOpenTabs()
  publishState()
}

/** Edit PDF: open the PDF the tab shows in the bundled pdf.js editor. */
export function openPdfEditor(id = activeTabId ?? undefined): boolean {
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
  return confirmDiscardPdfEdits(browserWindow, tab.pdfEditor.name, action)
}

/** Back to viewer: reload the original PDF in the built-in viewer (asks first if there are unsaved edits). */
export function closePdfEditor(id = activeTabId ?? undefined): boolean {
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

function hasUnsavedPdfEdits(): BrowserTab[] {
  return tabs.filter((tab) => tab.pdfEditor?.dirty)
}

function pdfEditorTabFor(contents: WebContents): BrowserTab | undefined {
  return tabs.find((tab) => tab.pdfEditor && tab.view?.webContents === contents)
}

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
    publishState()
  },
  backToViewer: (contents) => {
    const tab = pdfEditorTabFor(contents)
    if (tab) closePdfEditor(tab.id)
  },
  window: () => browserWindow
})

export interface ExtensionPageTabOptions {
  extensionUrl: string
  preloadPath: string
  owner: ExtensionPageOwner
}

function createTab(input?: string, engine: SearchEngineId = selectedSearchEngine, activate = true, deferLoad = false, pauseAutoplayUntilVisited = false, pinned = false, extensionPage?: ExtensionPageTabOptions, insertAt?: number, isPrivate = false, allowLocalDocument = false): string | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  const target = extensionPage && input
    ? input
    : allowLocalDocument && input && isLocalDocumentUrl(input)
    ? input
    : input === SURFFISH_QUICK_LINKS_URL
    ? SURFFISH_QUICK_LINKS_URL
    : input ? resolveNavigationTarget(input, engine) ?? configuredStartPage(engine) : configuredStartPage(engine)
  const previous = getTab()
  const shouldActivate = activate || activeTabId === null
  const tab: BrowserTab = {
    id: randomUUID(),
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
    isPrivate: isPrivate && !extensionPage,
    showingPdf: false,
    pdfEditor: null
  }
  // Insert in place (e.g. reopening a closed tab) so the renderer never sees an interim order.
  if (insertAt !== undefined && insertAt >= 0 && insertAt < tabs.length) tabs.splice(insertAt, 0, tab)
  else tabs.push(tab)
  if (shouldActivate) {
    if (previous && previous.id !== tab.id) markTabInactive(previous)
    activeTabId = tab.id
    tab.inactiveSince = null
  } else {
    tab.inactiveSince = Date.now()
  }
  if (!deferLoad) ensureTabLoaded(tab)
  applyTabBounds()
  if (!shouldActivate) scheduleTabSleep(tab)
  else tab.view?.webContents.focus()
  publishState()
  return tab.id
}

export function attachBrowserView(win: BaseWindow): void {
  for (const tab of [...tabs]) {
    cancelSleepTimer(tab)
    disposeTabView(tab)
  }
  tabs.length = 0
  activeTabId = null
  browserWindow = win
  browserBounds = { x: 0, y: 0, width: 0, height: 0 }
  tabSleepMinutes = getBrowserTabSleepMinutes()
  for (const contents of getMainWindowRenderers()) {
    contents.on('context-menu', (event, params) => {
      event.preventDefault()
      const x = Number.isFinite(params.x) ? Math.round(params.x) : 0
      const y = Number.isFinite(params.y) ? Math.round(params.y) : 0
      const script = `(() => document.elementFromPoint(${x}, ${y})?.closest('[data-browser-tab-id]')?.getAttribute('data-browser-tab-id') ?? null)()`
      void contents.executeJavaScript(script, true).then((id: unknown) => {
        if (typeof id === 'string' && getTab(id)) showBrowserTabContextMenu(id)
        else showTabContextMenu(contents, event, params)
      }).catch(() => showTabContextMenu(contents, event, params))
    })
  }
  if (process.platform === 'darwin') {
    win.on('swipe', (_event, direction) => {
      const contents = getTab()?.view?.webContents
      if (!contents) return
      if (direction === 'right' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
      else if (direction === 'left' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    })
  }
  const saved = loadBrowserSession()
  saved.urls.forEach((url, index) => createTab(url, selectedSearchEngine, false, true, false, saved.pinnedIndexes.includes(index)))
  if (tabs.length === 0) createTab()
  activeTabId = tabs[saved.activeIndex]?.id ?? tabs[0]?.id ?? null
  if (activeTabId) {
    const activeTab = getTab(activeTabId)
    if (activeTab) ensureTabLoaded(activeTab)
  }
  const now = Date.now()
  for (const tab of tabs) {
    if (tab.id !== activeTabId) {
      tab.inactiveSince ??= now
      scheduleTabSleep(tab)
    } else {
      tab.inactiveSince = null
    }
  }
  applyTabBounds()
  publishState()
  persistOpenTabs()
  if (process.platform === 'darwin') {
    startMacTrackpadSwipe(win, {
      onBegin: beginMacTrackpadSwipe,
      onProgress: reportMacTrackpadSwipeProgress,
      onEnd: finishMacTrackpadSwipe,
      onPinch: handleMacTrackpadPinch
    })
  }
  attachTabOverview(win, {
    getItems: getTabOverviewItems,
    getPageBounds: () => ({ ...browserBounds }),
    activate: (id) => { activateBrowserTab(id) },
    closeTab: (id) => { closeBrowserTab(id) },
    newTab: () => { newBrowserTab() },
    focusPage: () => {
      const contents = getTab()?.view?.webContents
      if (contents && !contents.isDestroyed()) contents.focus()
      else focusVisibleShellPage()
    },
    handleShortcut: (input) => handleBrowserShortcutInput(input)
  })
  win.on('close', (event) => {
    const unsaved = hasUnsavedPdfEdits()
    if (unsaved.length > 0) {
      const name = unsaved.length === 1 ? unsaved[0]!.pdfEditor!.name : `${unsaved.length} PDFs`
      if (!confirmDiscardPdfEdits(win, name, 'Close Window')) {
        event.preventDefault()
        return
      }
      for (const tab of unsaved) tab.pdfEditor!.dirty = false
    }
    persistOpenTabs()
  })
  win.on('closed', () => {
    if (browserWindow !== win) return
    cancelActiveMacTrackpadSwipe()
    stopMacTrackpadSwipe()
    detachTabOverview()
    destroyLinkStatus()
    findState = { tabId: null, open: false, text: '', result: null }
    tabThumbnails.clear()
    newTabThumbnail = null
    const closingTabs = [...tabs]
    tabs.length = 0
    activeTabId = null
    browserWindow = null
    for (const tab of closingTabs) {
      cancelSleepTimer(tab)
      const view = tab.view
      tab.view = null
      if (view) {
        detachNetworkInspector(view.webContents)
        if (!view.webContents.isDestroyed()) view.webContents.close()
      }
    }
  })
}

export function getBrowserState(): BrowserState {
  return getState()
}

export function getBrowserTabs(): BrowserTabSummary[] {
  return getTabSummaries()
}

export function getBrowserTabUrlByWebContentsId(webContentsId: number): string | null {
  const tab = tabs.find((candidate) => candidate.view?.webContents.id === webContentsId)
  const contents = tab?.view?.webContents
  return tab && contents && !contents.isDestroyed() ? currentUrl(tab) : null
}

export function markBrowserDownloadStarted(webContentsId: number): void {
  const tab = tabs.find((candidate) => candidate.view?.webContents.id === webContentsId)
  if (!tab) return
  tab.downloadStartedForCurrentLoad = true
  if (tab.error !== null) {
    tab.error = null
    publishState()
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

  const tab = tabs.find((candidate) => candidate.view?.webContents.id === electronTabId)
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
  const id = createTab(input ?? SURFFISH_QUICK_LINKS_URL, selectedSearchEngine, true, false, false, false, undefined, undefined, true)
  if (id) setImmediate(sendFocusAddressToVisibleRenderer)
  return id
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
  const id = createTab(url, selectedSearchEngine, true, false, false, false, undefined, undefined, false, localDocument)
  if (id) persistOpenTabs()
  return id
}

export function newBrowserTab(input?: string, engine?: SearchEngineId): string | null {
  const id = createTab(input, engine ?? selectedSearchEngine)
  if (id) {
    persistOpenTabs()
    setImmediate(sendFocusAddressToVisibleRenderer)
  }
  return id
}

/** Open extension UI only through this main-process-only path, never through address-bar navigation. */
export function openExtensionPageTab(url: string, extensionUrl: string, preloadPath: string, owner: ExtensionPageOwner): string | null {
  if (!preloadPath || !isBrambleExtensionUrl(url, extensionUrl)) return null
  let tab = tabs.find((candidate) => candidate.extensionPageOrigin === extensionUrl && isExtensionPage(candidate, currentUrl(candidate)))
  if (!tab) {
    const id = createTab(url, selectedSearchEngine, true, false, false, false, { extensionUrl, preloadPath, owner })
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
          publishState()
        })
      } else {
        ensureTabLoaded(tab)
      }
    }
    activateTabInternal(tab.id)
  }
  if (!tab) return null
  persistOpenTabs()
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.show()
    browserWindow.focus()
    const contents = getTab()?.view?.webContents
    if (contents && !contents.isDestroyed()) contents.focus()
  }
  publishState()
  return tab.id
}

/** Open Bramble UI only through this main-process-only path, never through address-bar navigation. */
export function openBrambleExtensionTab(url: string, extensionUrl: string, preloadPath: string): string | null {
  return openExtensionPageTab(url, extensionUrl, preloadPath, 'bramble')
}

export function isBrambleExtensionTab(contents: WebContents): boolean {
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
  return Boolean(tab && tab.extensionPageOwner === 'bramble' && isExtensionPage(tab, currentUrl(tab)))
}

/** True when `contents` is a Surffish tab showing a page of the extension at `extensionUrl`. */
export function isExtensionPageTab(contents: WebContents, extensionUrl: string, owner: ExtensionPageOwner): boolean {
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
  return Boolean(tab && tab.extensionPageOwner === owner && tab.extensionPageOrigin === extensionUrl && isExtensionPage(tab, currentUrl(tab)))
}

/** Close extension-host tabs before replacing or unloading Bramble's extension build. */
export function closeBrambleExtensionTabs(): void {
  for (const tab of [...tabs]) {
    if (tab.extensionPageOrigin && tab.extensionPageOwner === 'bramble') closeBrowserTab(tab.id)
  }
}

/** Close tabs showing pages of one extension (before disabling, updating, or uninstalling it). */
export function closeExtensionPageTabs(extensionUrl: string): void {
  for (const tab of [...tabs]) {
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
    active: tab.id === activeTabId,
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
  return tabs.find((tab) => !tab.isPrivate && extensionTabId(tab) === id)
}

/** Extensions never see private tabs (like Chrome's default "not allowed in Incognito"). */
export function listExtensionTabs(): ExtensionTabRecord[] {
  return tabs.filter((tab) => !tab.isPrivate).map((tab, index) => extensionTabRecord(tab, index))
}

export function getExtensionTab(id: number | undefined): ExtensionTabRecord | null {
  const tab = findTabByExtensionId(id)
  return tab ? extensionTabRecord(tab, tabs.indexOf(tab)) : null
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
    else if (tab.id === activeTabId || update.active) ensureTabLoaded(tab)
  }
  if (update.active) activateTabInternal(tab.id)
  persistOpenTabs()
  publishState()
  return extensionTabRecord(tab, tabs.indexOf(tab))
}

/** Open a tab for an extension (http(s) or that extension's own page, checked by the caller). */
export function createExtensionTab(url: string | undefined, active: boolean, extensionPage?: ExtensionPageTabOptions): ExtensionTabRecord | null {
  const id = extensionPage && url
    ? openExtensionPageTab(url, extensionPage.extensionUrl, extensionPage.preloadPath, extensionPage.owner)
    : createTab(url, selectedSearchEngine, active)
  if (!id) return null
  persistOpenTabs()
  const tab = getTab(id)
  return tab ? extensionTabRecord(tab, tabs.indexOf(tab)) : null
}

export function removeExtensionTabs(ids: readonly number[]): void {
  for (const id of ids) {
    const tab = findTabByExtensionId(id)
    if (tab) closeBrowserTab(tab.id)
  }
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
  duplicate: { key: 'd', shift: true, accelerator: 'CmdOrCtrl+Shift+D' },
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
  zoomIn: { key: '=', anyShift: true, primaryOnly: true, accelerator: 'CmdOrCtrl+=' },
  zoomOut: { key: '-', primaryOnly: true, accelerator: 'CmdOrCtrl+-' },
  zoomReset: { key: '0', primaryOnly: true, accelerator: 'CmdOrCtrl+0' },
  // Chrome's bindings: Cmd+Y / Cmd+Shift+J on macOS, Ctrl+H / Ctrl+J elsewhere (Ctrl+Y is Redo there).
  history: IS_MAC ? { key: 'y', primaryOnly: true, accelerator: 'Cmd+Y' } : { key: 'h', primaryOnly: true, accelerator: 'Ctrl+H' },
  downloads: IS_MAC ? { key: 'j', shift: true, primaryOnly: true, accelerator: 'Cmd+Shift+J' } : { key: 'j', primaryOnly: true, accelerator: 'Ctrl+J' }
}

function tabMenuAccelerator(command: TabCommand): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> {
  // Shown as a hint only; the app menu and before-input-event do the real handling.
  return { accelerator: TAB_COMMAND_SHORTCUTS[command].accelerator, registerAccelerator: false }
}

export function runTabCommand(command: TabCommand, tabId = activeTabId ?? undefined): void {
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
      toggleBrowserPanel(command)
      return
  }
  const tab = tabId ? getTab(tabId) : undefined
  if (!tab) return
  switch (command) {
    case 'bookmark':
      if (normalizeHttpOrigin(currentUrl(tab))) toggleTabBookmark(tab.id)
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
export function handleBrowserShortcutInput(input: Electron.Input, tabId = activeTabId): boolean {
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

export function handleBrowserShortcut(key: string, shift: boolean, tabId = activeTabId, alt = false, primary = true): boolean {
  for (const [command, shortcut] of Object.entries(TAB_COMMAND_SHORTCUTS) as [TabCommand, CommandShortcut][]) {
    if (shortcut.key !== key || Boolean(shortcut.alt) !== alt) continue
    if (!shortcut.anyShift && Boolean(shortcut.shift) !== shift) continue
    if (shortcut.primaryOnly && !primary) continue
    runTabCommand(command, tabId ?? undefined)
    return true
  }
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
  if (key === 'tab' && tabs.length > 1) {
    cycleBrowserTab(shift ? -1 : 1)
    return true
  }
  return false
}

/** Tabs in the order the sidebar shows them: pinned icons first, then the list. */
function tabsInSidebarOrder(): BrowserTab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
}

/** Cmd+1..8 selects that tab, Cmd+9 the last one (as in Chrome). */
export function selectBrowserTabByNumber(number: number): void {
  const ordered = tabsInSidebarOrder()
  const target = number === 9 ? ordered[ordered.length - 1] : ordered[number - 1]
  if (!target) return
  if (target.id !== activeTabId) activateBrowserTab(target.id)
  // From the tab overview, land on the chosen tab.
  if (isTabOverviewOpen()) closeTabOverview(target.id)
}

function closeOverviewForPanel(): void {
  if (isTabOverviewOpen()) closeTabOverview(activeTabId ?? undefined, false)
}

/** Cmd+Shift+Backspace: Settings → Privacy (Clear browsing data). */
export function openClearBrowsingData(): void {
  closeOverviewForPanel()
  setBrowserChromeState({ sidebarMode: 'privacy' })
}

/** Cmd+Y / Cmd+Shift+J: toggle the history sidebar or the downloads panel. */
function toggleBrowserPanel(mode: 'history' | 'downloads'): void {
  closeOverviewForPanel()
  const current = getBrowserChromeState().sidebarMode
  setBrowserChromeState({ sidebarMode: current === mode ? 'tabs' : mode })
}

// ---------------------------------------------------------------------------
// Find in page. The bar lives in the toolbar overlay renderer; main keeps the query so
// Cmd+G works with focus anywhere (page, toolbar, tab overview).

onTabInterstitialChanged(() => publishState())

let findState: { tabId: string | null; open: boolean; text: string; result: BrowserFindState['result'] } = { tabId: null, open: false, text: '', result: null }

function publishFindState(): void {
  sendToMainWindowRenderers('browser:find', getBrowserFindState())
}

export function getBrowserFindState(): BrowserFindState {
  return { open: findState.open, text: findState.text, result: findState.result ? { ...findState.result } : null }
}

function findContents(): WebContents | null {
  const contents = findState.tabId ? getTab(findState.tabId)?.view?.webContents : null
  return contents && !contents.isDestroyed() ? contents : null
}

/** Cmd+F: open (or refocus) the find bar for the active page. */
export function openFindBar(): boolean {
  closeOverviewForPanel()
  const tab = getTab()
  const contents = tab?.view?.webContents
  if (!tab || !contents || contents.isDestroyed() || currentUrl(tab) === SURFFISH_QUICK_LINKS_URL) return false
  if (findState.tabId !== tab.id) findState = { tabId: tab.id, open: true, text: findState.text, result: null }
  findState.open = true
  publishFindState()
  // Focus the toolbar so typing goes to the find field; it selects the old query for retyping.
  if (!sendToToolbarRenderer('browser:find:focus', true)) {
    findState.open = false
    publishFindState()
    return false
  }
  if (findState.text && !findState.result) contents.findInPage(findState.text, { findNext: true })
  return true
}

/** Typing in the find field: a new search for `text` (empty clears the highlight). */
export function setBrowserFindQuery(input: unknown): void {
  if (typeof input !== 'string' || !findState.open) return
  const text = input.slice(0, 1_000)
  const contents = findContents()
  findState.text = text
  findState.result = null
  if (!contents) return publishFindState()
  if (text) contents.findInPage(text, { findNext: true })
  else contents.stopFindInPage('clearSelection')
  publishFindState()
}

/** Enter / Cmd+G (forward) and Shift+Enter / Cmd+Shift+G (backward). */
export function stepFind(forward: boolean): void {
  if (!findState.open || !findState.text || findState.tabId !== activeTabId) {
    openFindBar()
    return
  }
  findContents()?.findInPage(findState.text, { forward, findNext: false })
}

/** Esc or the close button: clear the highlight, hide the bar, hand focus back to the page. */
export function closeFindBar(focusPage = true): void {
  const contents = findContents()
  if (contents) contents.stopFindInPage('clearSelection')
  const wasOpen = findState.open
  findState = { tabId: null, open: false, text: findState.text, result: null }
  if (wasOpen) publishFindState()
  if (focusPage) {
    const active = getTab()?.view?.webContents
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
  if (tab.id === activeTabId) publishState()
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
  for (const tab of tabs) {
    if (tab.id === activeTabId) continue
    scheduleTabSleep(tab)
  }
  return tabSleepMinutes
}

export function activateBrowserTab(id: string): boolean {
  const activated = activateTabInternal(id)
  if (activated) persistOpenTabs()
  return activated
}

export function cycleBrowserTab(offset: number): void {
  if (tabs.length < 2) return
  const ordered = tabsInSidebarOrder()
  const activeIndex = ordered.findIndex((tab) => tab.id === activeTabId)
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
  publishTabs()
  return true
}

export function closeBrowserTab(id: string): void {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const tab = tabs[index]
  if (!tab) return
  if (!allowLeavingPdfEditor(tab, 'Close Tab')) return
  if (tab.pdfEditor) tab.pdfEditor.dirty = false
  tabThumbnails.delete(id)
  const wasActive = activeTabId === id
  if (wasActive) cancelActiveMacTrackpadSwipe()
  if (wasActive) hideLinkStatus()
  if (findState.tabId === id) closeFindBar(false)
  rememberClosedTab(tab, index)
  tabs.splice(index, 1)
  cancelSleepTimer(tab)
  if (wasActive) activeTabId = null
  disposeTabView(tab)
  if (tab.isPrivate && !tabs.some((candidate) => candidate.isPrivate)) endPrivateSession()
  if (tabs.length === 0) {
    activeTabId = null
    createTab()
    persistOpenTabs()
    return
  }
  if (wasActive) {
    const replacement = tabs[Math.min(index, tabs.length - 1)]
    if (replacement) activateTabInternal(replacement.id)
  } else {
    applyTabBounds()
  }
  persistOpenTabs()
  publishState()
}

/** Last private tab closed: wipe the in-memory session and forget its downloads. */
function endPrivateSession(): void {
  privateSiteZoom.clear()
  forgetPrivateDownloads()
  void clearPrivateSession()
}

let confirmingWindowClose = false

/**
 * Cmd+W: close the tab. On the last tab, ask before closing the whole window instead of
 * silently swapping in a fresh New Tab or letting the menu close the window.
 */
export function closeBrowserTabFromShortcut(tabId = activeTabId ?? undefined): void {
  if (tabs.length > 1) {
    if (tabId) closeBrowserTab(tabId)
    return
  }
  const win = browserWindow
  if (!win || win.isDestroyed() || confirmingWindowClose) return
  confirmingWindowClose = true
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
    confirmingWindowClose = false
  })
}

export function setBrowserTabPinned(id: string, pinned: boolean): boolean {
  const tab = getTab(id)
  if (!tab) return false
  if (tab.pinned === pinned) return true
  tab.pinned = pinned
  persistOpenTabs()
  publishTabs()
  return true
}

/** Move a tab so it lands before `beforeId` (or at the end when null). Pinned and unpinned tabs keep their own groups. */
export function moveBrowserTab(id: string, beforeId: string | null): boolean {
  const from = tabs.findIndex((tab) => tab.id === id)
  if (from < 0 || id === beforeId) return false
  const [tab] = tabs.splice(from, 1)
  if (!tab) return false
  let to = beforeId ? tabs.findIndex((item) => item.id === beforeId) : -1
  if (to < 0) {
    // append after the last tab in the same pinned group
    let last = -1
    tabs.forEach((item, index) => { if (item.pinned === tab.pinned) last = index })
    to = last + 1
  }
  tabs.splice(to, 0, tab)
  if (to === from) return false
  persistOpenTabs()
  publishTabs()
  return true
}

export function duplicateBrowserTab(id: string): string | null {
  const tab = getTab(id)
  if (!tab) return null
  const duplicateId = createTab(currentUrl(tab), selectedSearchEngine)
  if (duplicateId) persistOpenTabs()
  return duplicateId
}

function reloadBrowserTab(id: string, ignoreCache = false): void {
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

function suspendBrowserTab(id: string): void {
  const tab = getTab(id)
  if (tab && tab.id !== activeTabId) hibernateTab(tab)
}

function suspendOtherBrowserTabs(keepId: string): void {
  for (const tab of [...tabs]) {
    if (tab.id !== keepId && tab.id !== activeTabId) hibernateTab(tab)
  }
}

function closeBrowserTabsRelative(id: string, relation: 'above' | 'below' | 'others'): void {
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
  const url = resolveNavigationTarget(input, engine)
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
    publishState()
    return true
  }
  tab.error = null
  ensureTabLoaded(tab)
  const contents = tab.view?.webContents
  if (!contents) return false
  publishState()
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
      publishState()
      return true
    }
    if (message.includes('ERR_ABORTED') && Date.now() - (googleHandOffAt.get(contents) ?? 0) < 5000) {
      tab.error = null
      publishState()
      return true
    }
    tab.error = message
    publishState()
    return false
  }
}

export function setBrowserBounds(input: unknown): void {
  if (!browserWindow || typeof input !== 'object' || input === null) return
  const bounds = input as Partial<BrowserBounds>
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return
  browserBounds = {
    x: Math.max(0, Math.round(bounds.x!)),
    y: Math.max(0, Math.round(bounds.y!)),
    width: Math.max(0, Math.round(bounds.width!)),
    height: Math.max(0, Math.round(bounds.height!))
  }
  // Page hidden (New Tab, a full panel): nothing to hover, so drop any status pill left over.
  if (browserBounds.width === 0 || browserBounds.height === 0) hideLinkStatus()
  applyTabBounds()
}

export function syncBrowserBoundsToWindow(width: number, height: number, overlayMode: boolean): void {
  if (!browserWindow || browserWindow.isDestroyed() || !overlayMode || width <= 0 || height <= 0) return
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
  browserBounds = nextBounds
  applyTabBounds()
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

function beginMacTrackpadSwipe(request: MacTrackpadSwipeBeginRequest): number | undefined {
  const refuse = (reason: string): undefined => {
    if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] refused:', reason, { direction: request.direction, x: request.x, y: request.y, bounds: browserBounds })
    return undefined
  }
  if (process.platform !== 'darwin' || !browserWindow || browserWindow.isDestroyed()) return refuse('no browser window')
  if (isTabOverviewOpen()) {
    // In the grid, horizontal swipes step the selection instead of navigating history.
    const overviewId = getTabOverviewContentsId()
    if (getTabOverviewState() !== 'open' || overviewId === null) return refuse('tab overview animating')
    if (request.direction !== 'back' && request.direction !== 'forward') return refuse('bad request')
    cancelActiveMacTrackpadSwipe()
    if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] tracking overview selection', request.direction)
    return overviewId
  }
  // The handle only tells us which NSWindow the gesture landed in. Surffish drives one browser
  // window, so a mismatch is logged rather than treated as fatal (a bad compare here used to
  // reject every swipe).
  if (MAC_SWIPE_DEBUG && Buffer.isBuffer(request.windowHandle)
    && !browserWindow.getNativeWindowHandle().equals(request.windowHandle)) {
    console.info('[trackpad swipe] window handle differs from getNativeWindowHandle(); continuing')
  }
  if ((request.direction !== 'back' && request.direction !== 'forward')
    || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return refuse('bad request')
  if (browserBounds.width <= 0 || browserBounds.height <= 0
    || request.x < browserBounds.x || request.y < browserBounds.y
    || request.x >= browserBounds.x + browserBounds.width
    || request.y >= browserBounds.y + browserBounds.height) return refuse('outside page bounds')

  const tab = getTab()
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
  if (contentsId === getTabOverviewContentsId()) return
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
  if (contentsId === getTabOverviewContentsId()) {
    // Selection follows the fingers: swipe right moves right, swipe left moves left.
    if (committed) moveTabOverviewSelection(direction === 'back' ? 1 : -1)
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
    if (!currentTab || currentTab.id !== activeTabId || currentTab.view?.webContents !== swipe.contents
      || swipe.contents.isDestroyed() || !browserWindow || browserWindow.isDestroyed()) {
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
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
  if (tab) tab.pageScrollEdges = { canScrollLeft: edges.canScrollLeft, canScrollRight: edges.canScrollRight }
}

export function updateBrowserPageScale(contents: WebContents, input: unknown): void {
  if (contents.isDestroyed() || typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
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
  if (tab.id !== activeTabId || browserBounds.width <= 0 || browserBounds.height <= 0) return
  if (isLocalNewTab(tab)) {
    const image = await captureLocalNewTabPage({ ...browserBounds })
    if (!image || !tabs.includes(tab)) return
    const shot = thumbnailDataUrl(image)
    tabThumbnails.set(tab.id, shot)
    newTabThumbnail = shot
    return
  }
  const contents = tab.view?.webContents
  if (!contents || contents.isDestroyed()) return
  try {
    const image = await contents.capturePage()
    if (image.isEmpty() || contents.isDestroyed() || !tabs.includes(tab)) return
    tabThumbnails.set(tab.id, thumbnailDataUrl(image))
  } catch {
    // A page that is navigating or crashing just keeps its previous thumbnail.
  }
}

async function getTabOverviewItems(): Promise<TabOverviewItem[]> {
  const active = getTab()
  if (active) {
    // Fresh shot of what is on screen right now; don't hold the gesture up for a slow page.
    await Promise.race([captureTabThumbnail(active), new Promise((resolve) => setTimeout(resolve, 120))])
  }
  return getTabSummaries().map((summary) => ({
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
  setTabOverviewProgress(progress)
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
    console.info('[trackpad swipe] pinch', phase, { magnification, mode: pinchMode, overview: getTabOverviewState(), pageScale: getTab()?.pageScale })
  }
  if (phase === 'begin') {
    pinchSamples = []
    pinchMode = 'none'
    const overview = getTabOverviewState()
    if (overview === 'opening' || overview === 'closing') {
      // Mid-animation: eat the pinch so the page underneath doesn't zoom.
      pinchMode = 'swallow'
      return true
    }
    if (overview === 'open') {
      pinchMode = magnification > 0 ? 'close' : 'swallow'
      if (pinchMode === 'close') {
        // Swap the page underneath now so it is already there as the selected card grows into it.
        const selected = getTabOverviewSelectedId()
        if (selected && selected !== activeTabId) activateBrowserTab(selected)
        trackPinchProgress(magnification)
      }
      return true
    }
    if (magnification > 0) return false
    if (!browserWindow || browserWindow.isDestroyed() || !browserWindow.isFocused()) return false
    const tab = getTab()
    // Pinching in on a zoomed-in page should zoom it back out, not open the overview.
    if (!tab || tab.pageScale > 1.01) return false
    pinchMode = 'open'
    void openTabOverview({ interactive: true })
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
    settleTabOverview(mode === 'close')
    return true
  }
  // Released: a flick wins, otherwise go wherever it is closer to.
  const open = velocity > PINCH_FLICK_SPEED ? true
    : velocity < -PINCH_FLICK_SPEED ? false
      : mode === 'open' ? progress > 0.4 : progress > 0.6
  if (MAC_SWIPE_DEBUG) console.info('[trackpad swipe] pinch released', { mode, progress, velocity, open })
  settleTabOverview(open, open ? undefined : activeTabId ?? undefined)
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
  const tab = activeTabId ? getTab(activeTabId) : undefined
  if (!tab?.view || tab.view.webContents !== contents || contents.isDestroyed()) return
  let origin = ''
  try {
    origin = new URL(requestingUrl).origin
  } catch {
    // Unknown origin: still say what was blocked.
  }
  if (!shouldToastPermission(permission, origin)) return
  flashLinkStatus(permissionDeniedMessage(permission, origin), browserBounds, 3200)
})
