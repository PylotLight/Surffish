import type { BaseWindow, WebContents, WebContentsView, WebFrameMain } from 'electron'
import type { BrowserChromeMetrics, BrowserChromeState, BrowserSidebarMode } from '../shared/types'
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, normalizeSidebarWidth } from '../shared/persistence'
import { isAuthorizedShellIpcSender } from './renderer-security'
import { bindContentsToWindow, currentBrowserWindow } from './window-scope'

const REVEAL_WIDTH = 14
const REVEAL_DELAY_MS = 180
const PAGE_EXIT_DELAY_MS = 160
const SIDEBAR_MODES: ReadonlySet<BrowserSidebarMode> = new Set(['tabs', 'history', 'settings', 'newtab', 'integrations', 'network', 'site', 'downloads', 'privacy', 'diagnostics', 'bookmarks', 'watchers'])

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

type BrowserShellLayoutSync = (width: number, height: number, overlayMode: boolean, window: BaseWindow) => void

/** One window's shell: its three renderer surfaces and the chrome (sidebar/toolbar) state they share. */
interface ShellState {
  window: BaseWindow
  views: BrowserShellViews
  renderers: Map<WebContents, string>
  chromeState: BrowserChromeState
  toolbarMetrics: BrowserChromeMetrics
  activePageIsLocalNewTab: boolean
  revealTimer: ReturnType<typeof setTimeout> | null
  pageExitTimer: ReturnType<typeof setTimeout> | null
  syncPageBounds: BrowserShellLayoutSync | null
  layoutScheduled: boolean
  scheduleLayout: () => void
}

const shells = new Map<BaseWindow, ShellState>()

/** The shell an implicit call is for: the given window, else the current one (sender / focused). */
function shellFor(window?: BaseWindow | null): ShellState | null {
  const target = window ?? currentBrowserWindow()
  const shell = target ? shells.get(target) : undefined
  if (shell && !shell.window.isDestroyed()) return shell
  // Before any window is registered as a browser window (tests, start-up), fall back to the only shell.
  if (!window && shells.size === 1) {
    const [only] = shells.values()
    if (only && !only.window.isDestroyed()) return only
  }
  return null
}

function shellForContents(contents: WebContents): ShellState | null {
  for (const shell of shells.values()) if (shell.renderers.has(contents)) return shell
  return null
}

function scheduleShellLayout(shell: ShellState): void {
  if (shell.layoutScheduled) return
  shell.layoutScheduled = true
  setImmediate(() => {
    shell.layoutScheduled = false
    applyShellLayout(shell)
  })
}

function clearRevealTimer(shell: ShellState): void {
  if (shell.revealTimer) clearTimeout(shell.revealTimer)
  shell.revealTimer = null
}

function clearPageExitTimer(shell: ShellState): void {
  if (shell.pageExitTimer) clearTimeout(shell.pageExitTimer)
  shell.pageExitTimer = null
}

function clearPointerTimers(shell: ShellState): void {
  clearRevealTimer(shell)
  clearPageExitTimer(shell)
}

function isSidebarVisible(shell: ShellState): boolean {
  const { chromeState } = shell
  return chromeState.sidebarPinned || chromeState.sidebarHovered || chromeState.sidebarFocused || chromeState.sidebarMode !== 'tabs'
}

function isFullPanelMode(shell: ShellState): boolean {
  return shell.chromeState.sidebarMode !== 'tabs' && shell.chromeState.sidebarMode !== 'history'
}

function shouldUseNativeOverlays(shell: ShellState): boolean {
  return !shell.window.isDestroyed() && !shell.activePageIsLocalNewTab && !isFullPanelMode(shell)
}

function currentContentSize(shell: ShellState): { width: number; height: number } {
  if (shell.window.isDestroyed()) return { width: 0, height: 0 }
  const [width = 0, height = 0] = shell.window.getContentSize()
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

function applyShellLayout(shell: ShellState): void {
  if (shell.window.isDestroyed() || shells.get(shell.window) !== shell) return
  const { views: shellViews, chromeState, toolbarMetrics } = shell
  const { width, height } = currentContentSize(shell)
  const overlayMode = shouldUseNativeOverlays(shell)
  const sidebarVisible = isSidebarVisible(shell)
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
  // Hidden, not just zero-width, while collapsed: nothing in it should paint or animate then.
  shellViews.sidebar.setVisible(overlayMode && sidebarVisible)
  shell.syncPageBounds?.(width, height, overlayMode, shell.window)
}

const WINDOW_LAYOUT_EVENTS = ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen'] as const

export function attachBrowserShell(
  window: BaseWindow,
  views: BrowserShellViews,
  expectedRendererUrls: Record<'content' | 'toolbar' | 'sidebar', string>,
  syncPageBounds?: BrowserShellLayoutSync
): void {
  detachBrowserShell(window)
  const shell: ShellState = {
    window,
    views,
    renderers: new Map([
      [views.content.webContents, expectedRendererUrls.content],
      [views.toolbar.webContents, expectedRendererUrls.toolbar],
      [views.sidebar.webContents, expectedRendererUrls.sidebar]
    ]),
    chromeState: { ...DEFAULT_CHROME_STATE },
    toolbarMetrics: {
      toolbarHeight: process.platform === 'darwin' ? 50 : 45,
      toolbarExtent: process.platform === 'darwin' ? 50 : 45
    },
    activePageIsLocalNewTab: true,
    revealTimer: null,
    pageExitTimer: null,
    syncPageBounds: syncPageBounds ?? null,
    layoutScheduled: false,
    scheduleLayout: () => scheduleShellLayout(shell)
  }
  shells.set(window, shell)
  for (const contents of shell.renderers.keys()) bindContentsToWindow(contents, window)
  for (const event of WINDOW_LAYOUT_EVENTS) window.on(event as 'resize', shell.scheduleLayout)
  window.on('closed', () => detachBrowserShell(window))
  applyShellLayout(shell)
}

export function detachBrowserShell(window?: BaseWindow): void {
  const targets = window ? [shells.get(window)].filter((shell): shell is ShellState => Boolean(shell)) : [...shells.values()]
  for (const shell of targets) {
    if (!shell.window.isDestroyed()) {
      for (const event of WINDOW_LAYOUT_EVENTS) shell.window.removeListener(event as 'resize', shell.scheduleLayout)
    }
    clearPointerTimers(shell)
    shell.syncPageBounds = null
    shell.renderers.clear()
    shells.delete(shell.window)
  }
}

/** Every app renderer surface in every window. */
export function getMainWindowRenderers(): WebContents[] {
  return [...shells.values()].flatMap((shell) => [...shell.renderers.keys()]).filter((contents) => !contents.isDestroyed())
}

/** The app renderer surfaces of one window. */
export function getWindowRenderers(window: BaseWindow): WebContents[] {
  const shell = shells.get(window)
  return shell ? [...shell.renderers.keys()].filter((contents) => !contents.isDestroyed()) : []
}

/** The browser window whose shell surface `contents` is, if any. */
export function getShellWindowFor(contents: WebContents): BaseWindow | null {
  return shellForContents(contents)?.window ?? null
}

export function isMainWindowRenderer(contents: WebContents, senderFrame: WebFrameMain | null): boolean {
  const expectedDocumentUrl = shellForContents(contents)?.renderers.get(contents)
  if (!expectedDocumentUrl || contents.isDestroyed()) return false
  return isAuthorizedShellIpcSender({
    registered: true,
    senderIsMainFrame: senderFrame === contents.mainFrame,
    currentDocumentUrl: contents.getURL(),
    expectedDocumentUrl
  })
}

export function isToolbarRenderer(contents: WebContents): boolean {
  if (contents.isDestroyed()) return false
  for (const shell of shells.values()) if (shell.views.toolbar.webContents === contents) return true
  return false
}

/** Broadcast to every window's app surfaces (history, bookmarks, settings and other app-wide changes). */
export function sendToMainWindowRenderers(channel: string, ...args: unknown[]): void {
  for (const contents of getMainWindowRenderers()) contents.send(channel, ...args)
}

/** Send to one window's app surfaces (its tabs, page state, find bar, chrome state). */
export function sendToWindowRenderers(window: BaseWindow, channel: string, ...args: unknown[]): void {
  for (const contents of getWindowRenderers(window)) contents.send(channel, ...args)
}

export function getBrowserChromeState(window?: BaseWindow | null): BrowserChromeState {
  const shell = shellFor(window)
  return { ...(shell?.chromeState ?? DEFAULT_CHROME_STATE) }
}

export function setBrowserChromeState(input: unknown, window?: BaseWindow | null): BrowserChromeState {
  const shell = shellFor(window)
  if (!shell) return getBrowserChromeState(window)
  if (typeof input !== 'object' || input === null) return getBrowserChromeState(shell.window)
  const patch = input as Record<string, unknown>
  const next = { ...shell.chromeState }
  if (typeof patch.sidebarMode === 'string' && SIDEBAR_MODES.has(patch.sidebarMode as BrowserSidebarMode)) {
    next.sidebarMode = patch.sidebarMode as BrowserSidebarMode
  }
  if (typeof patch.sidebarPinned === 'boolean') next.sidebarPinned = patch.sidebarPinned
  if (typeof patch.sidebarHovered === 'boolean') next.sidebarHovered = patch.sidebarHovered
  if (typeof patch.sidebarFocused === 'boolean') next.sidebarFocused = patch.sidebarFocused
  if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth)) next.sidebarWidth = normalizeSidebarWidth(patch.sidebarWidth)
  if (typeof patch.sidebarResizing === 'boolean') next.sidebarResizing = patch.sidebarResizing
  shell.chromeState = next
  if (next.sidebarPinned || next.sidebarHovered || next.sidebarFocused || next.sidebarResizing || next.sidebarMode !== 'tabs') clearPointerTimers(shell)
  applyShellLayout(shell)
  sendToWindowRenderers(shell.window, 'browser:chrome-state', getBrowserChromeState(shell.window))
  return getBrowserChromeState(shell.window)
}

/** Track mouse input delivered to the full-width live page without placing a hit-test view above it. */
export function handleBrowserPageMouseEvent(input: { type: string; x: number }, window?: BaseWindow | null): void {
  const shell = shellFor(window)
  if (!shell) return
  const { chromeState } = shell
  if (!shouldUseNativeOverlays(shell) || chromeState.sidebarMode !== 'tabs') {
    clearPointerTimers(shell)
    return
  }

  if (input.type === 'mouseDown') {
    clearRevealTimer(shell)
    return
  }
  if (input.type !== 'mouseMove') return

  if (!isSidebarVisible(shell)) {
    clearPageExitTimer(shell)
    if (input.x <= REVEAL_WIDTH) {
      if (!shell.revealTimer) {
        shell.revealTimer = setTimeout(() => {
          shell.revealTimer = null
          if (shouldUseNativeOverlays(shell) && shell.chromeState.sidebarMode === 'tabs' && !isSidebarVisible(shell)) {
            setBrowserChromeState({ sidebarHovered: true }, shell.window)
          }
        }, REVEAL_DELAY_MS)
      }
    } else {
      clearRevealTimer(shell)
    }
    return
  }

  clearRevealTimer(shell)
  if (!chromeState.sidebarPinned && !chromeState.sidebarFocused && input.x >= Math.min(chromeState.sidebarWidth, currentContentSize(shell).width)) {
    if (!shell.pageExitTimer) {
      shell.pageExitTimer = setTimeout(() => {
        shell.pageExitTimer = null
        const state = shell.chromeState
        if (shouldUseNativeOverlays(shell) && state.sidebarMode === 'tabs' && state.sidebarHovered && !state.sidebarPinned && !state.sidebarFocused) {
          setBrowserChromeState({ sidebarHovered: false }, shell.window)
        }
      }, PAGE_EXIT_DELAY_MS)
    }
  } else {
    clearPageExitTimer(shell)
  }
}

export function setBrowserChromeMetrics(input: unknown, window?: BaseWindow | null): BrowserChromeMetrics {
  const shell = shellFor(window)
  if (!shell) return { toolbarHeight: 45, toolbarExtent: 45 }
  const { toolbarMetrics } = shell
  if (typeof input === 'object' && input !== null) {
    const candidate = input as Record<string, unknown>
    if (typeof candidate.toolbarHeight === 'number' && Number.isFinite(candidate.toolbarHeight)) {
      toolbarMetrics.toolbarHeight = Math.max(32, Math.min(180, Math.round(candidate.toolbarHeight)))
    }
    if (typeof candidate.toolbarExtent === 'number' && Number.isFinite(candidate.toolbarExtent)) {
      toolbarMetrics.toolbarExtent = Math.max(toolbarMetrics.toolbarHeight, Math.min(800, Math.round(candidate.toolbarExtent)))
    }
  }
  applyShellLayout(shell)
  return { ...toolbarMetrics }
}

export function setBrowserPageIsLocalNewTab(isLocalNewTab: boolean, window?: BaseWindow | null): void {
  const shell = shellFor(window)
  if (!shell || shell.activePageIsLocalNewTab === isLocalNewTab) return
  shell.activePageIsLocalNewTab = isLocalNewTab
  if (isLocalNewTab) clearPointerTimers(shell)
  applyShellLayout(shell)
}

export function getMainRendererOrigin(contents: WebContents): { x: number; y: number } | null {
  const shell = shellForContents(contents)
  if (!shell) return null
  if (contents === shell.views.sidebar.webContents) return { x: 0, y: shell.toolbarMetrics.toolbarHeight }
  if (contents === shell.views.content.webContents || contents === shell.views.toolbar.webContents) return { x: 0, y: 0 }
  return null
}

/**
 * Snapshot of the local New Tab page (drawn by the full content renderer, not a site view),
 * cropped to the page area. Null when it isn't on screen.
 */
export async function captureLocalNewTabPage(rect: { x: number; y: number; width: number; height: number }, window?: BaseWindow | null): Promise<Electron.NativeImage | null> {
  const shell = shellFor(window)
  if (!shell || !shell.activePageIsLocalNewTab || rect.width <= 0 || rect.height <= 0) return null
  const contents = shell.views.content.webContents
  if (contents.isDestroyed() || !shell.views.content.getVisible()) return null
  try {
    const image = await contents.capturePage(rect)
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}

/** Focus whichever shell surface is showing the page area (the New Tab page lives in the content renderer). */
export function focusVisibleShellPage(window?: BaseWindow | null): boolean {
  const shell = shellFor(window)
  if (!shell || shouldUseNativeOverlays(shell)) return false
  const contents = shell.views.content.webContents
  if (contents.isDestroyed()) return false
  contents.focus()
  return true
}

/** F6 everywhere, plus Alt+D on Windows/Linux (Chrome's bindings). Cmd/Ctrl+L goes through the tab shortcuts. */
export function isFocusAddressShortcut(input: Pick<Electron.Input, 'type' | 'key' | 'code' | 'alt' | 'control' | 'meta' | 'shift'>): boolean {
  if (input.type !== 'keyDown') return false
  if (input.key === 'F6' && !input.alt && !input.control && !input.meta && !input.shift) return true
  return process.platform !== 'darwin' && input.alt && !input.control && !input.meta && !input.shift && input.code === 'KeyD'
}

/** True while live pages show with the toolbar/sidebar overlay surfaces above them (not New Tab or a full panel). */
export function isNativeOverlayMode(window?: BaseWindow | null): boolean {
  const shell = shellFor(window)
  return Boolean(shell && shouldUseNativeOverlays(shell))
}

/** Focus the toolbar overlay and send it a message; false when the toolbar surface isn't on screen. */
export function sendToToolbarRenderer(channel: string, focus: boolean, ...args: unknown[]): boolean {
  const shell = shellFor()
  if (!shell || !shouldUseNativeOverlays(shell)) return false
  const target = shell.views.toolbar.webContents
  if (target.isDestroyed()) return false
  if (focus) target.focus()
  target.send(channel, ...args)
  return true
}

/**
 * Stack a small native view directly above the site pages but below every shell surface,
 * so the sidebar, toolbar popups and tab overview still cover it.
 */
export function addViewAbovePages(view: WebContentsView, window?: BaseWindow | null): boolean {
  const shell = shellFor(window)
  if (!shell || shell.window.isDestroyed()) return false
  const index = shell.window.contentView.children.indexOf(shell.views.content)
  shell.window.contentView.addChildView(view, index < 0 ? undefined : index)
  return true
}

function visibleShellTarget(shell: ShellState): WebContents | null {
  const target = shouldUseNativeOverlays(shell) ? shell.views.toolbar.webContents : shell.views.content.webContents
  return target.isDestroyed() ? null : target
}

/** Send to whichever surface is drawing the toolbar right now (overlay toolbar or the content surface). */
export function sendToVisibleToolbarSurface(channel: string, ...args: unknown[]): boolean {
  const shell = shellFor()
  const target = shell ? visibleShellTarget(shell) : null
  if (!shell || !target) return false
  if (!shell.window.isDestroyed() && !shell.window.isFocused()) shell.window.focus()
  target.focus()
  target.send(channel, ...args)
  return true
}

export function sendFocusAddressToVisibleRenderer(window?: BaseWindow | null): void {
  const shell = shellFor(window)
  const target = shell ? visibleShellTarget(shell) : null
  if (!shell || !target) return
  // Bring the window forward first so focus lands even when an extension popup or devtools had it.
  if (!shell.window.isDestroyed() && !shell.window.isFocused()) shell.window.focus()
  target.focus()
  target.send('browser:focus-address')
}

/** Focus the shell surface over the page area (toolbar overlay on live pages, else the content renderer) and message it. */
export function sendToVisibleShellRenderer(channel: string, ...args: unknown[]): boolean {
  const shell = shellFor()
  const target = shell ? visibleShellTarget(shell) : null
  if (!shell || !target) return false
  if (!shell.window.isDestroyed() && !shell.window.isFocused()) shell.window.focus()
  target.focus()
  target.send(channel, ...args)
  return true
}
