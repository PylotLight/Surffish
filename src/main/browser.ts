import { WebContentsView, type BrowserWindow } from 'electron'
import type { BrowserBounds, BrowserState } from '../shared/types'
import { resolveNavigationTarget } from '../shared/navigation'

export const START_PAGE = 'https://duckduckgo.com/'
let browserView: WebContentsView | null = null
let browserWindow: BrowserWindow | null = null
let lastError: string | null = null

function getState(): BrowserState {
  const contents = browserView?.webContents
  return {
    url: contents?.getURL() || START_PAGE,
    title: contents?.getTitle() || 'New page',
    loading: contents?.isLoading() ?? false,
    canGoBack: contents?.navigationHistory.canGoBack() ?? false,
    canGoForward: contents?.navigationHistory.canGoForward() ?? false,
    error: lastError
  }
}
function publishState(): void {
  if (!browserWindow || browserWindow.isDestroyed()) return
  browserWindow.webContents.send('browser:state', getState())
}
export function attachBrowserView(win: BrowserWindow): void {
  if (browserView && !browserView.webContents.isDestroyed()) {
    browserWindow?.contentView.removeChildView(browserView)
    browserView.webContents.close()
  }
  browserWindow = win
  lastError = null
  browserView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: 'persist:fish-browser'
    }
  })
  win.contentView.addChildView(browserView)
  browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  const contents = browserView.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta) || input.key.toLowerCase() !== 'l') return
    event.preventDefault()
    browserWindow?.webContents.send('browser:focus-address')
  })
  contents.on('will-navigate', (event, url) => {
    if (!resolveNavigationTarget(url) || !/^https?:\/\//i.test(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!/^https?:\/\//i.test(url)) event.preventDefault()
  })
  contents.on('did-start-loading', () => {
    lastError = null
    publishState()
  })
  contents.on('did-stop-loading', publishState)
  contents.on('did-navigate', publishState)
  contents.on('did-navigate-in-page', publishState)
  contents.on('page-title-updated', publishState)
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    lastError = `${errorDescription} (${errorCode})`
    publishState()
  })
  contents.on('destroyed', () => {
    if (browserView?.webContents === contents) browserView = null
  })
  win.on('closed', () => {
    if (browserWindow !== win) return
    browserView?.webContents.close()
    browserView = null
    browserWindow = null
  })
  void contents.loadURL(START_PAGE).catch((error: unknown) => {
    lastError = error instanceof Error ? error.message : String(error)
    publishState()
  })
}
export function getBrowserState(): BrowserState {
  return getState()
}
export async function navigateBrowser(input: string): Promise<boolean> {
  const url = resolveNavigationTarget(input)
  if (!url || !browserView) return false
  lastError = null
  publishState()
  try {
    await browserView.webContents.loadURL(url)
    return true
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    publishState()
    return false
  }
}
export function setBrowserBounds(input: unknown): void {
  if (!browserView || typeof input !== 'object' || input === null) return
  const bounds = input as Partial<BrowserBounds>
  const values = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return
  const x = Math.max(0, Math.round(bounds.x!))
  const y = Math.max(0, Math.round(bounds.y!))
  const width = Math.max(0, Math.round(bounds.width!))
  const height = Math.max(0, Math.round(bounds.height!))
  browserView.setBounds({ x, y, width, height })
}
export function browserBack(): void {
  if (browserView?.webContents.navigationHistory.canGoBack()) browserView.webContents.navigationHistory.goBack()
}
export function browserForward(): void {
  if (browserView?.webContents.navigationHistory.canGoForward()) browserView.webContents.navigationHistory.goForward()
}
export function browserReload(): void {
  browserView?.webContents.reload()
}
export function browserStop(): void {
  browserView?.webContents.stop()
}
