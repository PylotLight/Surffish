import type { BaseWindow, WebContents, WebContentsView, WebFrameMain } from 'electron'
import type { BrowserChromeMetrics, BrowserChromeState, BrowserSidebarMode } from '../shared/types'
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, normalizeSidebarWidth } from '../shared/persistence'
import { isAuthorizedShellIpcSender } from './renderer-security'

const REVEAL_WIDTH = 14
const REVEAL_DELAY_MS = 180
const PAGE_EXIT_DELAY_MS = 160
const SIDEBAR_MODES: ReadonlySet<BrowserSidebarMode> = new Set(['tabs', 'history', 'settings', 'newtab', 'integrations', 'network', 'site', 'downloads'])

const DEFAULT_CHROME_STATE: BrowserChromeState = {
  sidebarMode: 'tabs',
  sidebarPinned: false,
  sidebarHovered: false,
  sidebarFocused: false,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarResizing: false
}

export interface BrowserShellViews {
  content: WebContentsView
  toolbar: WebContentsView
  sidebar: WebContentsView
}

let mainWindow: BaseWindow | null = null
let shellViews: BrowserShellViews | null = null
let shellRenderers = new Map<WebContents, string>()
let chromeState: BrowserChromeState = { ...DEFAULT_CHROME_STATE }
let toolbarMetrics: BrowserChromeMetrics = { toolbarHeight: 45, toolbarExtent: 45 }
let activePageIsLocalNewTab = true
let revealTimer: ReturnType<typeof setTimeout> | null = null
let pageExitTimer: ReturnType<typeof setTimeout> | null = null
type BrowserShellLayoutSync = (width: number, height: number, overlayMode: boolean) => void
let syncBrowserPageBounds: BrowserShellLayoutSync | null = null
let shellLayoutScheduled = false

function scheduleShellLayout(): void {
  if (shellLayoutScheduled) return
  shellLayoutScheduled = true
  setImmediate(() => {
    shellLayoutScheduled = false
    applyShellLayout()
  })
}

function clearRevealTimer(): void {
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = null
}

function clearPageExitTimer(): void {
  if (pageExitTimer) clearTimeout(pageExitTimer)
  pageExitTimer = null
}

function clearPointerTimers(): void {
  clearRevealTimer()
  clearPageExitTimer()
}

function isSidebarVisible(): boolean {
  return chromeState.sidebarPinned || chromeState.sidebarHovered || chromeState.sidebarFocused || chromeState.sidebarMode !== 'tabs'
}

function isFullPanelMode(): boolean {
  return chromeState.sidebarMode !== 'tabs' && chromeState.sidebarMode !== 'history'
}

function shouldUseNativeOverlays(): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && !activePageIsLocalNewTab && !isFullPanelMode())
}

function currentContentSize(): { width: number; height: number } {
  if (!mainWindow || mainWindow.isDestroyed()) return { width: 0, height: 0 }
  const [width = 0, height = 0] = mainWindow.getContentSize()
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

function applyShellLayout(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !shellViews) return
  const { width, height } = currentContentSize()
  const overlayMode = shouldUseNativeOverlays()
  const sidebarVisible = isSidebarVisible()
  const toolbarHeight = Math.min(toolbarMetrics.toolbarHeight, height)
  const toolbarExtent = Math.min(Math.max(toolbarMetrics.toolbarExtent, toolbarHeight), height)

  // Keep the full React renderer alive and correctly sized for New Tab and local panels.
  // When native overlays are active it is hidden, so its full-window bounds cannot steal page input.
  shellViews.content.setBounds({ x: 0, y: 0, width, height })
  shellViews.content.setVisible(!overlayMode)

  shellViews.toolbar.setBounds({ x: 0, y: 0, width, height: toolbarExtent })
  shellViews.toolbar.setVisible(overlayMode)

  shellViews.sidebar.setBounds({
    x: 0,
    y: 0,
    // The visible sidebar covers the complete window; a zero-width hidden layer leaves page pixels interactive.
    width: sidebarVisible
      ? Math.min(chromeState.sidebarResizing ? MAX_SIDEBAR_WIDTH : chromeState.sidebarWidth, width)
      : 0,
    height
  })
  shellViews.sidebar.setVisible(overlayMode)
  syncBrowserPageBounds?.(width, height, overlayMode)
}

export function attachBrowserShell(
  window: BaseWindow,
  views: BrowserShellViews,
  expectedRendererUrls: Record<'content' | 'toolbar' | 'sidebar', string>,
  syncPageBounds?: BrowserShellLayoutSync
): void {
  mainWindow = window
  shellViews = views
  syncBrowserPageBounds = syncPageBounds ?? null
  shellRenderers = new Map([
    [views.content.webContents, expectedRendererUrls.content],
    [views.toolbar.webContents, expectedRendererUrls.toolbar],
    [views.sidebar.webContents, expectedRendererUrls.sidebar]
  ])
  toolbarMetrics = {
    toolbarHeight: process.platform === 'darwin' ? 50 : 45,
    toolbarExtent: process.platform === 'darwin' ? 50 : 45
  }
  window.on('resize', scheduleShellLayout)
  window.on('maximize', scheduleShellLayout)
  window.on('unmaximize', scheduleShellLayout)
  window.on('restore', scheduleShellLayout)
  window.on('enter-full-screen', scheduleShellLayout)
  window.on('leave-full-screen', scheduleShellLayout)
  window.on('closed', detachBrowserShell)
  applyShellLayout()
}

export function detachBrowserShell(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeListener('resize', scheduleShellLayout)
    mainWindow.removeListener('maximize', scheduleShellLayout)
    mainWindow.removeListener('unmaximize', scheduleShellLayout)
    mainWindow.removeListener('restore', scheduleShellLayout)
    mainWindow.removeListener('enter-full-screen', scheduleShellLayout)
    mainWindow.removeListener('leave-full-screen', scheduleShellLayout)
  }
  clearPointerTimers()
  mainWindow = null
  shellViews = null
  syncBrowserPageBounds = null
  shellRenderers.clear()
  activePageIsLocalNewTab = true
  chromeState = { ...DEFAULT_CHROME_STATE }
}

export function getMainWindowRenderers(): WebContents[] {
  return [...shellRenderers.keys()].filter((contents) => !contents.isDestroyed())
}

export function isMainWindowRenderer(contents: WebContents, senderFrame: WebFrameMain | null): boolean {
  const expectedDocumentUrl = shellRenderers.get(contents)
  if (!expectedDocumentUrl || contents.isDestroyed()) return false
  return isAuthorizedShellIpcSender({
    registered: true,
    senderIsMainFrame: senderFrame === contents.mainFrame,
    currentDocumentUrl: contents.getURL(),
    expectedDocumentUrl
  })
}

export function isToolbarRenderer(contents: WebContents): boolean {
  return Boolean(shellViews && shellViews.toolbar.webContents === contents && !contents.isDestroyed())
}

export function sendToMainWindowRenderers(channel: string, ...args: unknown[]): void {
  for (const contents of getMainWindowRenderers()) contents.send(channel, ...args)
}

export function getBrowserChromeState(): BrowserChromeState {
  return { ...chromeState }
}

export function setBrowserChromeState(input: unknown): BrowserChromeState {
  if (typeof input !== 'object' || input === null) return getBrowserChromeState()
  const patch = input as Record<string, unknown>
  const next = { ...chromeState }
  if (typeof patch.sidebarMode === 'string' && SIDEBAR_MODES.has(patch.sidebarMode as BrowserSidebarMode)) {
    next.sidebarMode = patch.sidebarMode as BrowserSidebarMode
  }
  if (typeof patch.sidebarPinned === 'boolean') next.sidebarPinned = patch.sidebarPinned
  if (typeof patch.sidebarHovered === 'boolean') next.sidebarHovered = patch.sidebarHovered
  if (typeof patch.sidebarFocused === 'boolean') next.sidebarFocused = patch.sidebarFocused
  if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth)) next.sidebarWidth = normalizeSidebarWidth(patch.sidebarWidth)
  if (typeof patch.sidebarResizing === 'boolean') next.sidebarResizing = patch.sidebarResizing
  chromeState = next
  if (chromeState.sidebarPinned || chromeState.sidebarHovered || chromeState.sidebarFocused || chromeState.sidebarResizing || chromeState.sidebarMode !== 'tabs') clearPointerTimers()
  applyShellLayout()
  sendToMainWindowRenderers('browser:chrome-state', getBrowserChromeState())
  return getBrowserChromeState()
}

/** Track mouse input delivered to the full-width live page without placing a hit-test view above it. */
export function handleBrowserPageMouseEvent(input: { type: string; x: number }): void {
  if (!shouldUseNativeOverlays() || chromeState.sidebarMode !== 'tabs') {
    clearPointerTimers()
    return
  }

  if (input.type === 'mouseDown') {
    clearRevealTimer()
    return
  }
  if (input.type !== 'mouseMove') return

  if (!isSidebarVisible()) {
    clearPageExitTimer()
    if (input.x <= REVEAL_WIDTH) {
      if (!revealTimer) {
        revealTimer = setTimeout(() => {
          revealTimer = null
          if (shouldUseNativeOverlays() && chromeState.sidebarMode === 'tabs' && !isSidebarVisible()) {
            setBrowserChromeState({ sidebarHovered: true })
          }
        }, REVEAL_DELAY_MS)
      }
    } else {
      clearRevealTimer()
    }
    return
  }

  clearRevealTimer()
  if (!chromeState.sidebarPinned && !chromeState.sidebarFocused && input.x >= Math.min(chromeState.sidebarWidth, currentContentSize().width)) {
    if (!pageExitTimer) {
      pageExitTimer = setTimeout(() => {
        pageExitTimer = null
        if (shouldUseNativeOverlays() && chromeState.sidebarMode === 'tabs' && chromeState.sidebarHovered && !chromeState.sidebarPinned && !chromeState.sidebarFocused) {
          setBrowserChromeState({ sidebarHovered: false })
        }
      }, PAGE_EXIT_DELAY_MS)
    }
  } else {
    clearPageExitTimer()
  }
}

export function setBrowserChromeMetrics(input: unknown): BrowserChromeMetrics {
  if (typeof input === 'object' && input !== null) {
    const candidate = input as Record<string, unknown>
    if (typeof candidate.toolbarHeight === 'number' && Number.isFinite(candidate.toolbarHeight)) {
      toolbarMetrics.toolbarHeight = Math.max(32, Math.min(180, Math.round(candidate.toolbarHeight)))
    }
    if (typeof candidate.toolbarExtent === 'number' && Number.isFinite(candidate.toolbarExtent)) {
      toolbarMetrics.toolbarExtent = Math.max(toolbarMetrics.toolbarHeight, Math.min(800, Math.round(candidate.toolbarExtent)))
    }
  }
  applyShellLayout()
  return { ...toolbarMetrics }
}

export function setBrowserPageIsLocalNewTab(isLocalNewTab: boolean): void {
  if (activePageIsLocalNewTab === isLocalNewTab) return
  activePageIsLocalNewTab = isLocalNewTab
  if (isLocalNewTab) clearPointerTimers()
  applyShellLayout()
}

export function getMainRendererOrigin(contents: WebContents): { x: number; y: number } | null {
  if (!shellViews) return null
  if (contents === shellViews.sidebar.webContents) return { x: 0, y: toolbarMetrics.toolbarHeight }
  if (contents === shellViews.content.webContents || contents === shellViews.toolbar.webContents) return { x: 0, y: 0 }
  return null
}

/**
 * Snapshot of the local New Tab page (drawn by the full content renderer, not a site view),
 * cropped to the page area. Null when it isn't on screen.
 */
export async function captureLocalNewTabPage(rect: { x: number; y: number; width: number; height: number }): Promise<Electron.NativeImage | null> {
  if (!shellViews || !activePageIsLocalNewTab || rect.width <= 0 || rect.height <= 0) return null
  const contents = shellViews.content.webContents
  if (contents.isDestroyed() || !shellViews.content.getVisible()) return null
  try {
    const image = await contents.capturePage(rect)
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}

/** Focus whichever shell surface is showing the page area (the New Tab page lives in the content renderer). */
export function focusVisibleShellPage(): boolean {
  if (!shellViews || shouldUseNativeOverlays()) return false
  const contents = shellViews.content.webContents
  if (contents.isDestroyed()) return false
  contents.focus()
  return true
}

export function sendFocusAddressToVisibleRenderer(): void {
  if (!shellViews) return
  const target = shouldUseNativeOverlays() ? shellViews.toolbar.webContents : shellViews.content.webContents
  if (!target.isDestroyed()) {
    target.focus()
    target.send('browser:focus-address')
  }
}
