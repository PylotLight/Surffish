import { randomUUID } from 'node:crypto'
import { WebContentsView, type BrowserWindow, type ContextMenuParams, type Event, type WebContents, type WebFrameMain } from 'electron'
import type { BrowserBounds, BrowserState, BrowserTabSummary, SearchEngineId, TabSleepMinutes } from '../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, resolveNavigationTarget } from '../shared/navigation'
import { DEFAULT_TAB_SLEEP_MINUTES, isTabSleepMinutes } from '../shared/persistence'
import { recordBrowsingVisit, updateLatestVisitTitle } from './history'
import { BROWSER_SESSION_PARTITION } from './browser-session'
import { getBrowserTabSleepMinutes, loadBrowserSession, saveBrowserSession } from './browser-persistence'
import { showBrowserContextMenu } from './context-menu'
import { attachNetworkInspector, detachNetworkInspector } from './network-inspector'

export const START_PAGE = getSearchHomepage(DEFAULT_SEARCH_ENGINE)
interface BrowserTab {
  id: string
  view: WebContentsView | null
  error: string | null
  lastUrl: string
  pendingUrl: string
  inactiveSince: number | null
  sleepTimer: ReturnType<typeof setTimeout> | null
}
const tabs: BrowserTab[] = []
let activeTabId: string | null = null
let browserWindow: BrowserWindow | null = null
let browserBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
let selectedSearchEngine: SearchEngineId = DEFAULT_SEARCH_ENGINE
let tabSleepMinutes: TabSleepMinutes = DEFAULT_TAB_SLEEP_MINUTES

function getTab(id: string | null = activeTabId): BrowserTab | undefined {
  return tabs.find((tab) => tab.id === id)
}

function currentUrl(tab: BrowserTab): string {
  return tab.view?.webContents.getURL() || tab.lastUrl || tab.pendingUrl || START_PAGE
}

function pageTitle(tab: BrowserTab): string {
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
    url: tab ? currentUrl(tab) : START_PAGE,
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
    loading: tab.view?.webContents.isLoading() ?? false,
    active: tab.id === activeTabId,
    sleeping: tab.view === null
  }))
}

function publishTabs(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  browserWindow.webContents.send('browser:tabs', getTabSummaries())
}

function publishState(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  browserWindow.webContents.send('browser:state', getState())
  publishTabs()
}

function persistOpenTabs(): void {
  const urls = tabs.map(currentUrl)
  saveBrowserSession(urls, tabs.findIndex((tab) => tab.id === activeTabId))
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
  const target = tab.pendingUrl || tab.lastUrl || START_PAGE
  tab.pendingUrl = target
  const view = createTabView(tab)
  if (!view) return
  tab.pendingUrl = ''
  tab.inactiveSince = null
  applyTabBounds()
  const contents = view.webContents
  void contents.loadURL(target).catch((error: unknown) => {
    if (tab.view?.webContents !== contents) return
    tab.error = error instanceof Error ? error.message : String(error)
    publishState()
  })
}

function activateTabInternal(id: string): boolean {
  const tab = getTab(id)
  if (!tab) return false
  const previous = getTab()
  if (previous && previous.id !== id) markTabInactive(previous)
  cancelSleepTimer(tab)
  tab.inactiveSince = null
  activeTabId = id
  ensureTabLoaded(tab)
  const contents = tab.view?.webContents
  if (contents && !contents.isDestroyed()) {
    contents.focus()
  }
  applyTabBounds()
  publishState()
  return true
}

function showTabContextMenu(contents: WebContents, event: Event, params: ContextMenuParams): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  const isBrowserPage = tabs.some((tab) => tab.view?.webContents === contents)
  showBrowserContextMenu(event, contents, params, {
    window: browserWindow,
    pageActions: isBrowserPage,
    offsetX: isBrowserPage ? browserBounds.x : 0,
    offsetY: isBrowserPage ? browserBounds.y : 0,
    searchEngine: selectedSearchEngine,
    openInNewTab: (url) => {
      const id = createTab(url, selectedSearchEngine)
      if (id) persistOpenTabs()
    },
    openInBackgroundTab: (url) => {
      const id = createTab(url, selectedSearchEngine, false)
      if (id) persistOpenTabs()
    }
  })
}

function createTabView(tab: BrowserTab): WebContentsView | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: BROWSER_SESSION_PARTITION
    }
  })
  tab.view = view
  browserWindow.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

  const contents = view.webContents
  attachNetworkInspector(tab.id, contents)
  const isCurrentContents = (): boolean => tab.view?.webContents === contents
  contents.on('context-menu', (event, params) => showTabContextMenu(contents, event, params))
  if (process.platform === 'darwin') {
    // Electron disables visual pinch-zoom by default; enable it for Mac trackpads.
    void contents.setVisualZoomLevelLimits(1, 3).catch(() => {})
  }
  contents.setWindowOpenHandler((details) => {
    if (details.disposition === 'background-tab') {
      const target = resolveNavigationTarget(details.url, selectedSearchEngine)
      if (target && /^https?:\/\//i.test(target)) {
        const backgroundTabId = createTab(target, selectedSearchEngine, false)
        if (backgroundTabId) persistOpenTabs()
      }
    }
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, inputEvent) => {
    if (inputEvent.type !== 'keyDown' || (!inputEvent.control && !inputEvent.meta)) return
    const key = inputEvent.key.toLowerCase()
    if (key === 'l' && !inputEvent.shift) {
      event.preventDefault()
      browserWindow?.webContents.send('browser:focus-address')
    } else if (key === 't' && !inputEvent.shift) {
      event.preventDefault()
      newBrowserTab()
    } else if (key === 'w' && !inputEvent.shift) {
      event.preventDefault()
      closeBrowserTab(tab.id)
    } else if (key === 'tab') {
      event.preventDefault()
      cycleBrowserTab(inputEvent.shift ? -1 : 1)
    }
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
    tab.lastUrl = url
    persistOpenTabs()
  })
  contents.on('did-stop-loading', () => { if (isCurrentContents()) publishState() })
  contents.on('did-navigate', (_event, url) => {
    if (!isCurrentContents()) return
    tab.lastUrl = url
    recordBrowsingVisit(url, pageTitle(tab))
    persistOpenTabs()
    publishState()
    browserWindow?.webContents.send('browser:history-changed')
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame) return
    tab.lastUrl = url
    recordBrowsingVisit(url, pageTitle(tab))
    persistOpenTabs()
    publishState()
    browserWindow?.webContents.send('browser:history-changed')
  })
  contents.on('page-title-updated', (_event, title) => {
    if (!isCurrentContents()) return
    updateLatestVisitTitle(contents.getURL(), title)
    publishState()
    browserWindow?.webContents.send('browser:history-changed')
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isCurrentContents() || !isMainFrame || errorCode === -3) return
    tab.error = `${errorDescription} (${errorCode})`
    publishState()
  })
  contents.on('destroyed', () => {
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

function createTab(input?: string, engine: SearchEngineId = selectedSearchEngine, activate = true, deferLoad = false): string | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  const target = input ? resolveNavigationTarget(input, engine) ?? getSearchHomepage(engine) : getSearchHomepage(engine)
  const tab: BrowserTab = {
    id: randomUUID(),
    view: null,
    error: null,
    lastUrl: target,
    pendingUrl: target,
    inactiveSince: null,
    sleepTimer: null
  }
  const previous = getTab()
  const shouldActivate = activate || activeTabId === null
  tabs.push(tab)
  if (shouldActivate) {
    if (previous && previous.id !== tab.id) markTabInactive(previous)
    activeTabId = tab.id
    tab.inactiveSince = null
  } else {
    tab.inactiveSince = Date.now()
  }
  if (shouldActivate && !deferLoad) ensureTabLoaded(tab)
  applyTabBounds()
  if (!shouldActivate) scheduleTabSleep(tab)
  else tab.view?.webContents.focus()
  publishState()
  return tab.id
}

export function attachBrowserView(win: BrowserWindow): void {
  for (const tab of [...tabs]) {
    cancelSleepTimer(tab)
    disposeTabView(tab)
  }
  tabs.length = 0
  activeTabId = null
  browserWindow = win
  browserBounds = { x: 0, y: 0, width: 0, height: 0 }
  tabSleepMinutes = getBrowserTabSleepMinutes()
  win.webContents.on('context-menu', (event, params) => showTabContextMenu(win.webContents, event, params))
  if (process.platform === 'darwin') {
    win.on('swipe', (_event, direction) => {
      const contents = getTab()?.view?.webContents
      if (!contents) return
      if (direction === 'right' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
      else if (direction === 'left' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    })
  }
  const saved = loadBrowserSession()
  for (const url of saved.urls) createTab(url, selectedSearchEngine, false, true)
  if (tabs.length === 0) createTab(START_PAGE)
  activeTabId = tabs[saved.activeIndex]?.id ?? tabs[0]?.id ?? null
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
  win.on('close', persistOpenTabs)
  win.on('closed', () => {
    if (browserWindow !== win) return
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
  if (process.env.SOCKFISH_EXPERIMENTAL_EXTENSION_HOST_BRIDGE !== '1') return null
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
  if (id) persistOpenTabs()
  return id
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
  tabs.splice(index, 1)
  cancelSleepTimer(tab)
  if (wasActive) activeTabId = null
  disposeTabView(tab)
  if (tabs.length === 0) {
    activeTabId = null
    createTab(START_PAGE)
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

export async function navigateBrowser(input: string, engine: SearchEngineId = selectedSearchEngine): Promise<boolean> {
  const url = resolveNavigationTarget(input, engine)
  const tab = getTab()
  if (!url || !tab) return false
  tab.error = null
  ensureTabLoaded(tab)
  const contents = tab.view?.webContents
  if (!contents) return false
  publishState()
  try {
    await contents.loadURL(url)
    return true
  } catch (error) {
    tab.error = error instanceof Error ? error.message : String(error)
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
