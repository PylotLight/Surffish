import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, clipboard, Menu, WebContentsView, type BaseWindow, type ContextMenuParams, type Event, type MenuItemConstructorOptions, type WebContents, type WebFrameMain } from 'electron'
import type { BrowserBounds, BrowserState, BrowserTabSummary, SearchEngineId, TabSleepMinutes } from '../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, isBrowserTabSleeping, isYouTubeUrl, resolveNavigationTarget, SURFFISH_QUICK_LINKS_URL } from '../shared/navigation'
import { DEFAULT_TAB_SLEEP_MINUTES, isTabSleepMinutes, MAX_PINNED_SITES, normalizeFaviconUrl, normalizeHttpOrigin } from '../shared/persistence'
import { recordBrowsingVisit, updateLatestVisitFavicon, updateLatestVisitTitle } from './history'
import { BROWSER_SESSION_PARTITION } from './browser-session'
import { getBrowserNewTabPage, getBrowserPreferencesSnapshot, getBrowserPinnedSites, getBrowserSiteSettings, getBrowserTabSleepMinutes, loadBrowserSession, saveBrowserPinnedSites, saveBrowserSession } from './browser-persistence'
import { showBrowserContextMenu } from './context-menu'
import { attachNetworkInspector, detachNetworkInspector } from './network-inspector'
import { getMainRendererOrigin, getMainWindowRenderers, handleBrowserPageMouseEvent, sendFocusAddressToVisibleRenderer, sendToMainWindowRenderers, setBrowserPageIsLocalNewTab } from './browser-shell'
import { startMacTrackpadSwipe, stopMacTrackpadSwipe, type MacTrackpadSwipeBeginRequest, type MacTrackpadSwipeDirection } from './mac-trackpad-swipe'

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
}
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

function configuredStartPage(engine: SearchEngineId = selectedSearchEngine): string {
  const page = getBrowserNewTabPage()
  if (page === 'search') return getSearchHomepage(engine)
  return page === 'bonjourr' ? START_PAGE : SURFFISH_QUICK_LINKS_URL
}

function getTab(id: string | null = activeTabId): BrowserTab | undefined {
  return tabs.find((tab) => tab.id === id)
}

function currentUrl(tab: BrowserTab): string {
  return tab.view?.webContents.getURL() || tab.lastUrl || tab.pendingUrl || configuredStartPage()
}
export function shouldPauseBackgroundYouTubeAutoplay(contents: WebContents): boolean {
  if (contents.isDestroyed()) return false
  const tab = tabs.find((candidate) => candidate.view?.webContents === contents)
  return Boolean(tab?.pauseAutoplayUntilVisited && tab.id !== activeTabId)
}
function pageTitle(tab: BrowserTab): string {
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
    canGoBack: contents?.navigationHistory.canGoBack() ?? false,
    canGoForward: contents?.navigationHistory.canGoForward() ?? false,
    error: tab?.error ?? null
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
    sleeping: isBrowserTabSleeping(tab.view !== null, currentUrl(tab))
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
  sendToMainWindowRenderers('browser:history-changed')
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
    persistPageFavicon(pageUrl, faviconUrl)
    if (tab.faviconUrl === faviconUrl) return
    tab.faviconUrl = faviconUrl
    publishTabs()
  }).catch(() => undefined)
}

function publishTabs(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  sendToMainWindowRenderers('browser:tabs', getTabSummaries())
}

function publishState(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const state = getState()
  setBrowserPageIsLocalNewTab(state.url === SURFFISH_QUICK_LINKS_URL)
  sendToMainWindowRenderers('browser:state', state)
  publishTabs()
}

function persistOpenTabs(): void {
  const urls = tabs.map(currentUrl)
  const pinnedIndexes = tabs.flatMap((tab, index) => tab.pinned ? [index] : [])
  saveBrowserSession(urls, tabs.findIndex((tab) => tab.id === activeTabId), pinnedIndexes)
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
  if (tabSleepMinutes === 0 || !tab.view || tab.id === activeTabId || tab.inactiveSince === null) return
  const delay = Math.max(0, tabSleepMinutes * 60_000 - (Date.now() - tab.inactiveSince))
  tab.sleepTimer = setTimeout(() => hibernateTab(tab), delay)
}

function markTabInactive(tab: BrowserTab): void {
  tab.inactiveSince = Date.now()
  scheduleTabSleep(tab)
}

function openBackgroundTab(url: string): void {
  const id = createTab(url, selectedSearchEngine, false, false, true)
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
  void contents.loadURL(target).catch((error: unknown) => {
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
  }
  applyTabBounds()
  publishState()
  return true
}

function showTabContextMenu(contents: WebContents, event: Event, params: ContextMenuParams): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const isBrowserPage = tabs.some((tab) => tab.view?.webContents === contents)
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
    openInBackgroundTab: openBackgroundTab
  })
}

function showBrowserTabContextMenu(id: string): void {
  const tab = getTab(id)
  if (!tab || !browserWindow || browserWindow.isDestroyed()) return
  const origin = normalizeHttpOrigin(currentUrl(tab))
  const bookmarked = Boolean(origin && getBrowserPinnedSites().some((site) => normalizeHttpOrigin(site.url) === origin))
  const items: MenuItemConstructorOptions[] = [
    { label: bookmarked ? 'Remove Bookmark' : 'Bookmark Tab', enabled: Boolean(origin) && (bookmarked || getBrowserPinnedSites().length < MAX_PINNED_SITES), click: () => toggleTabBookmark(id) },
    { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', click: () => setBrowserTabPinned(id, !tab.pinned) },
    { label: 'Duplicate Tab', click: () => { void duplicateBrowserTab(id) } },
    { label: 'Copy Link', enabled: Boolean(origin), click: () => clipboard.writeText(currentUrl(tab)) },
    { type: 'separator' },
    { label: 'Reload Tab', click: () => reloadBrowserTab(id) },
    { label: 'Suspend Tab', enabled: id !== activeTabId && tab.view !== null, click: () => { suspendBrowserTab(id) } },
    { label: 'Suspend Other Tabs', enabled: tabs.some((candidate) => candidate.id !== id && candidate.id !== activeTabId && candidate.view !== null), click: () => suspendOtherBrowserTabs(id) },
    { type: 'separator' },
    { label: 'Close Tab', click: () => closeBrowserTab(id) },
    { label: 'Close Tabs Above', enabled: tabs.some((candidate, index) => index < tabs.findIndex((entry) => entry.id === id)), click: () => closeBrowserTabsRelative(id, 'above') },
    { label: 'Close Tabs Below', enabled: tabs.some((candidate, index) => index > tabs.findIndex((entry) => entry.id === id)), click: () => closeBrowserTabsRelative(id, 'below') },
    { label: 'Close Other Tabs', enabled: tabs.length > 1, click: () => closeBrowserTabsRelative(id, 'others') }
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

function createTabView(tab: BrowserTab): WebContentsView | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  const needsBrowserViewPreload = process.platform === 'darwin' || tab.pauseAutoplayUntilVisited
  const browserViewPreload = needsBrowserViewPreload ? resolveBrowserViewPreload() : null
  const view = new WebContentsView({
    webPreferences: {
      ...(browserViewPreload ? { preload: browserViewPreload } : {}),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Run the session's sandboxed ad-filter preload in iframes too, so
      // embedded players (YouTube embeds) and ad frames get scriptlets/CSS.
      // Remote pages still get no Node.js: sandbox stays on.
      nodeIntegrationInSubFrames: true,
      partition: BROWSER_SESSION_PARTITION
    }
  })
  tab.view = view
  // Site tabs are always below the local toolbar, sidebar, and full-app surfaces.
  browserWindow.contentView.addChildView(view, 0)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

  const contents = view.webContents
  attachNetworkInspector(tab.id, contents)
  const isCurrentContents = (): boolean => tab.view?.webContents === contents
  contents.on('before-mouse-event', (_event, mouseEvent) => {
    if (activeTabId === tab.id && isCurrentContents()) handleBrowserPageMouseEvent(mouseEvent)
  })
  contents.on('context-menu', (event, params) => showTabContextMenu(contents, event, params))
  contents.on('media-started-playing', () => {
    if (!isCurrentContents() || !tab.pauseAutoplayUntilVisited || tab.id === activeTabId || contents.isDestroyed()) return
    void contents.executeJavaScript(`
      for (const media of document.querySelectorAll('video, audio')) {
        if (!media.paused && !media.ended) media.pause()
      }
    `).catch(() => undefined)
  })
  if (process.platform === 'darwin') {
    // Electron disables visual pinch-zoom by default; enable it for Mac trackpads.
    void contents.setVisualZoomLevelLimits(1, 3).catch(() => {})
  }
  contents.setWindowOpenHandler((details) => {
    const target = resolveNavigationTarget(details.url, selectedSearchEngine)
    if (target && /^https?:\/\//i.test(target)) {
      if (details.disposition === 'background-tab') {
        openBackgroundTab(target)
      } else if (getBrowserSiteSettings(contents.getURL())?.openPopupsInTabs) {
        const popupTabId = createTab(target, selectedSearchEngine)
        if (popupTabId) persistOpenTabs()
      }
    }
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, inputEvent) => {
    if (inputEvent.type !== 'keyDown' || (!inputEvent.control && !inputEvent.meta)) return
    const key = inputEvent.key.toLowerCase()
    if (handleBrowserShortcut(key, inputEvent.shift, tab.id)) event.preventDefault()
  })
  contents.on('will-navigate', (event, url) => {
    if (!resolveNavigationTarget(url) || !/^https?:\/\//i.test(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!/^https?:\/\//i.test(url)) event.preventDefault()
  })
  contents.on('did-start-loading', () => {
    if (!isCurrentContents()) return
    tab.error = null
    publishState()
  })
  contents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame || !/^https?:\/\//i.test(url)) return
    tab.downloadStartedForCurrentLoad = false
    tab.lastUrl = url
    tab.faviconUrl = null
    tab.faviconRevision += 1
    persistOpenTabs()
    publishTabs()
  })
  contents.on('did-stop-loading', () => {
    if (!isCurrentContents()) return
    publishState()
    refreshTabFavicon(tab)
  })
  contents.on('did-navigate', (_event, url) => {
    if (!isCurrentContents()) return
    tab.lastUrl = url
    recordBrowsingVisit(url, pageTitle(tab))
    persistOpenTabs()
    publishState()
    sendToMainWindowRenderers('browser:history-changed')
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame) return
    resetMacTrackpadSwipeFor(contents)
    tab.lastUrl = url
    recordBrowsingVisit(url, pageTitle(tab))
    persistOpenTabs()
    publishState()
    sendToMainWindowRenderers('browser:history-changed')
  })
  contents.on('page-title-updated', (_event, title) => {
    if (!isCurrentContents()) return
    updateLatestVisitTitle(contents.getURL(), title)
    publishState()
    refreshTabFavicon(tab)
    sendToMainWindowRenderers('browser:history-changed')
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

function createTab(input?: string, engine: SearchEngineId = selectedSearchEngine, activate = true, deferLoad = false, pauseAutoplayUntilVisited = false, pinned = false): string | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  const target = input === SURFFISH_QUICK_LINKS_URL
    ? SURFFISH_QUICK_LINKS_URL
    : input ? resolveNavigationTarget(input, engine) ?? configuredStartPage(engine) : configuredStartPage(engine)
  const previous = getTab()
  const shouldActivate = activate || activeTabId === null
  const tab: BrowserTab = {
    id: randomUUID(),
    view: null,
    faviconUrl: null,
    faviconRevision: 0,
    error: null,
    downloadStartedForCurrentLoad: false,
    pauseAutoplayUntilVisited: !shouldActivate && pauseAutoplayUntilVisited && isYouTubeUrl(target),
    lastUrl: target,
    pendingUrl: target,
    pinned,
    inactiveSince: null,
    sleepTimer: null,
    pageScrollEdges: { ...UNKNOWN_PAGE_SCROLL_EDGES }
  }
  tabs.push(tab)
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
      onEnd: finishMacTrackpadSwipe
    })
  }
  win.on('close', persistOpenTabs)
  win.on('closed', () => {
    if (browserWindow !== win) return
    cancelActiveMacTrackpadSwipe()
    stopMacTrackpadSwipe()
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

export function newBrowserTab(input?: string, engine?: SearchEngineId): string | null {
  const id = createTab(input, engine ?? selectedSearchEngine)
  if (id) {
    persistOpenTabs()
    setImmediate(sendFocusAddressToVisibleRenderer)
  }
  return id
}

export function handleBrowserShortcut(key: string, shift: boolean, tabId = activeTabId): boolean {
  if (key === 'l' && !shift) {
    sendFocusAddressToVisibleRenderer()
    return true
  }
  if (key === 't' && !shift) {
    newBrowserTab()
    return true
  }
  if (key === 'w' && !shift) {
    if (tabId) closeBrowserTab(tabId)
    return true
  }
  if (key === 'tab' && tabs.length > 1) {
    cycleBrowserTab(shift ? -1 : 1)
    return true
  }
  return false
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
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  const nextIndex = (activeIndex + offset + tabs.length) % tabs.length
  const next = tabs[nextIndex]
  if (next) activateBrowserTab(next.id)
}

export function closeBrowserTab(id: string): void {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const tab = tabs[index]
  if (!tab) return
  const wasActive = activeTabId === id
  if (wasActive) cancelActiveMacTrackpadSwipe()
  tabs.splice(index, 1)
  cancelSleepTimer(tab)
  if (wasActive) activeTabId = null
  disposeTabView(tab)
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

export function setBrowserTabPinned(id: string, pinned: boolean): boolean {
  const tab = getTab(id)
  if (!tab) return false
  if (tab.pinned === pinned) return true
  tab.pinned = pinned
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

function reloadBrowserTab(id: string): void {
  const tab = getTab(id)
  if (!tab) return
  if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload()
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

export function browserBack(): void {
  const contents = getTab()?.view?.webContents
  if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
}

export function browserForward(): void {
  const contents = getTab()?.view?.webContents
  if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
}

export function browserReload(): void {
  getTab()?.view?.webContents.reload()
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
