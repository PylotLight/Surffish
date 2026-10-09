import { randomUUID } from 'node:crypto'
import { WebContentsView, type BrowserWindow } from 'electron'
import type { BrowserBounds, BrowserState, BrowserTabSummary } from '../shared/types'
import { DEFAULT_SEARCH_ENGINE, getSearchHomepage, resolveNavigationTarget } from '../shared/navigation'
import type { SearchEngineId } from '../shared/types'
import { recordBrowsingVisit, updateLatestVisitTitle } from './history'
import { BROWSER_SESSION_PARTITION } from './browser-session'
import { loadBrowserSession, saveBrowserSession } from './browser-persistence'

export const START_PAGE = getSearchHomepage(DEFAULT_SEARCH_ENGINE)
interface BrowserTab {
  id: string
  view: WebContentsView
  error: string | null
  lastUrl: string
}
const tabs: BrowserTab[] = []
let activeTabId: string | null = null
let browserWindow: BrowserWindow | null = null
let browserBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
let selectedSearchEngine: SearchEngineId = DEFAULT_SEARCH_ENGINE

function getTab(id: string | null = activeTabId): BrowserTab | undefined {
  return tabs.find((tab) => tab.id === id)
}

function pageTitle(tab: BrowserTab): string {
  const title = tab.view.webContents.getTitle().trim()
  if (title) return title
  const url = tab.view.webContents.getURL()
  try {
    return url ? new URL(url).hostname : 'New tab'
  } catch {
    return 'New tab'
  }
}

function getState(): BrowserState {
  const tab = getTab()
  const contents = tab?.view.webContents
  return {
    url: contents?.getURL() || tab?.lastUrl || START_PAGE,
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
    url: tab.view.webContents.getURL() || tab.lastUrl || START_PAGE,
    title: pageTitle(tab),
    loading: tab.view.webContents.isLoading(),
    active: tab.id === activeTabId
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
  const urls = tabs.map((tab) => tab.view.webContents.getURL() || tab.lastUrl)
  saveBrowserSession(urls, tabs.findIndex((tab) => tab.id === activeTabId))
}

function applyTabBounds(): void {
  for (const tab of tabs) {
    const visible = tab.id === activeTabId
    tab.view.setBounds(visible ? browserBounds : { x: 0, y: 0, width: 0, height: 0 })
  }
}

function detachTab(tab: BrowserTab): void {
  const contents = tab.view.webContents
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.contentView.removeChildView(tab.view)
  }
  if (!contents.isDestroyed()) contents.close()
}

function activateTabInternal(id: string): boolean {
  const tab = getTab(id)
  if (!tab || tab.view.webContents.isDestroyed()) return false
  activeTabId = id
  applyTabBounds()
  tab.view.webContents.focus()
  publishState()
  return true
}

function createTab(input?: string, engine: SearchEngineId = selectedSearchEngine, activate = true): string | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null
  const target = input ? resolveNavigationTarget(input, engine) ?? getSearchHomepage(engine) : getSearchHomepage(engine)
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
  const tab: BrowserTab = { id: randomUUID(), view, error: null, lastUrl: target }
  tabs.push(tab)
  browserWindow.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })

  const contents = view.webContents
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
    tab.error = null
    publishState()
  })
  contents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame || !/^https?:\/\//i.test(url)) return
    tab.lastUrl = url
    persistOpenTabs()
  })
  contents.on('did-stop-loading', publishState)
  contents.on('did-navigate', (_event, url) => {
    tab.lastUrl = url
    recordBrowsingVisit(url, pageTitle(tab))
    persistOpenTabs()
    publishState()
    browserWindow?.webContents.send('browser:history-changed')
  })
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    tab.lastUrl = url
    recordBrowsingVisit(url, pageTitle(tab))
    persistOpenTabs()
    publishState()
    browserWindow?.webContents.send('browser:history-changed')
  })
  contents.on('page-title-updated', (_event, title) => {
    updateLatestVisitTitle(contents.getURL(), title)
    publishState()
    browserWindow?.webContents.send('browser:history-changed')
  })
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    tab.error = `${errorDescription} (${errorCode})`
    publishState()
  })
  contents.on('destroyed', () => {
    const index = tabs.findIndex((candidate) => candidate.id === tab.id)
    if (index < 0) return
    tabs.splice(index, 1)
    if (activeTabId === tab.id) {
      activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
      if (tabs.length === 0 && browserWindow && !browserWindow.isDestroyed()) newBrowserTab()
      else applyTabBounds()
    }
    publishState()
  })

  const shouldActivate = activate || activeTabId === null
  if (shouldActivate) activeTabId = tab.id
  applyTabBounds()
  if (shouldActivate) contents.focus()
  publishState()
  void contents.loadURL(target).catch((error: unknown) => {
    tab.error = error instanceof Error ? error.message : String(error)
    publishState()
  })
  return tab.id
}

export function attachBrowserView(win: BrowserWindow): void {
  for (const tab of [...tabs]) detachTab(tab)
  tabs.length = 0
  activeTabId = null
  browserWindow = win
  browserBounds = { x: 0, y: 0, width: 0, height: 0 }
  if (process.platform === 'darwin') {
    win.on('swipe', (_event, direction) => {
      const contents = getTab()?.view.webContents
      if (!contents) return
      if (direction === 'right' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
      else if (direction === 'left' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    })
  }
  const saved = loadBrowserSession()
  for (const url of saved.urls) createTab(url)
  if (tabs.length === 0) createTab(START_PAGE)
  activeTabId = tabs[saved.activeIndex]?.id ?? tabs[0]?.id ?? null
  applyTabBounds()
  persistOpenTabs()
  win.on('close', persistOpenTabs)
  win.on('closed', () => {
    if (browserWindow !== win) return
    const closingTabs = [...tabs]
    tabs.length = 0
    activeTabId = null
    browserWindow = null
    for (const tab of closingTabs) {
      const contents = tab.view.webContents
      if (!contents.isDestroyed()) contents.close()
    }
  })
}

export function getBrowserState(): BrowserState {
  return getState()
}

export function getBrowserTabs(): BrowserTabSummary[] {
  return getTabSummaries()
}

export function newBrowserTab(input?: string, engine?: SearchEngineId): string | null {
  const id = createTab(input, engine ?? selectedSearchEngine)
  if (id) persistOpenTabs()
  return id
}

export function setBrowserSearchEngine(engine: SearchEngineId): void {
  selectedSearchEngine = engine
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
  tabs.splice(index, 1)
  if (activeTabId === id) activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
  detachTab(tab)
  if (tabs.length === 0) {
    activeTabId = null
    createTab(START_PAGE)
    persistOpenTabs()
    return
  }
  applyTabBounds()
  persistOpenTabs()
  publishState()
}

export async function navigateBrowser(input: string, engine: SearchEngineId = selectedSearchEngine): Promise<boolean> {
  const url = resolveNavigationTarget(input, engine)
  const tab = getTab()
  if (!url || !tab) return false
  tab.error = null
  publishState()
  try {
    await tab.view.webContents.loadURL(url)
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
  const contents = getTab()?.view.webContents
  if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
}

export function browserForward(): void {
  const contents = getTab()?.view.webContents
  if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
}

export function browserReload(): void {
  getTab()?.view.webContents.reload()
}

export function browserStop(): void {
  getTab()?.view.webContents.stop()
}
