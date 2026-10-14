import type { BaseWindow, WebContents, WebContentsView, WebFrameMain } from 'electron'
import type { BrowserChromeMetrics, BrowserChromeState, BrowserSidebarMode } from '../shared/types'
import { DEFAULT_SIDEBAR_WIDTH, normalizeSidebarWidth } from '../shared/persistence'
import { SIDEBAR_CARD, sidebarCardInset, sidebarCardMaxWidth } from '../shared/sidebar-card'
import { POPOVER_DISMISS_CHANNEL, sidebarModeAfterTabSwitch, surfacePressDismissReason, windowBlurDismissesPopovers, type PopoverDismissReason, type ToolbarPopoverState } from '../shared/popover-dismiss'
import { isAuthorizedShellIpcSender } from './renderer-security'
import { bindContentsToWindow, currentBrowserWindow } from './window-scope'
import { SidebarOverlayMotion } from './sidebar-motion'
import { SidebarRevealGuard } from './sidebar-reveal-guard'

const REVEAL_WIDTH = 14
const REVEAL_DELAY_MS = 180
const PAGE_EXIT_DELAY_MS = 160
const SIDEBAR_MODES: ReadonlySet<BrowserSidebarMode> = new Set(['tabs', 'history', 'settings', 'newtab', 'integrations', 'network', 'site', 'downloads', 'privacy', 'diagnostics', 'bookmarks', 'watchers', 'feeds'])

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
  /** Slides the overlay sidebar view along one open/close timeline (sidebar-motion.ts). */
  sidebarMotion: SidebarOverlayMotion
  lastOverlayMode: boolean | null
  /** Native-blur backdrop: the sidebar view is inset to the card and rounded (sidebar-backdrop.ts). */
  sidebarFrame: { inset: number; radius: number } | null
  sidebarOverlayShown: boolean
  /** Light-dismiss listeners (window blur, presses on the sidebar view), kept to remove on detach. */
  dismissOnBlur: () => void
  dismissOnSidebarPress: (event: Electron.Event, mouseEvent: { type: string }) => void
  /** Last active tab main published for this window (a change closes the History panel, in order). */
  lastActiveTabId: string | null
  /** When `lastActiveTabId` became the active tab (epoch ms), published as `BrowserState.activeTabSince`. */
  activeTabSince: number
  /** Releases hover/focus/drag holds the renderer missed (sidebar-reveal-guard.ts). Null until attached. */
  revealGuard: SidebarRevealGuard | null
  /** What the next layout is for, for the sidebar lock debug log. */
  layoutCause: string | null
}

export type SidebarOverlayEvent = 'shown' | 'hidden' | 'prefetch'
let sidebarOverlayListener: ((window: BaseWindow, event: SidebarOverlayEvent) => void) | null = null

/** sidebar-backdrop.ts: hear when the overlay sidebar opens/closes over a live page (and just before a hover reveal). */
export function setSidebarOverlayListener(listener: ((window: BaseWindow, event: SidebarOverlayEvent) => void) | null): void {
  sidebarOverlayListener = listener
}

let sidebarMotionListener: ((window: BaseWindow, progress: number) => void) | null = null

/** sidebar-backdrop.ts: the overlay sidebar's open progress each frame (0 hidden … 1 open), to ramp the native tint. */
export function setSidebarMotionListener(listener: ((window: BaseWindow, progress: number) => void) | null): void {
  sidebarMotionListener = listener
}

function emitSidebarOverlay(shell: ShellState, event: SidebarOverlayEvent): void {
  try {
    sidebarOverlayListener?.(shell.window, event)
  } catch (error) {
    console.warn('Sidebar overlay listener failed:', error)
  }
}

const shells = new Map<BaseWindow, ShellState>()

/** The shell an implicit call is for: the given window, else the current one (sender / focused). */
const pageCovers = new WeakSet<BaseWindow>()
let pageCoverLostListener: ((window: BaseWindow) => void) | null = null

/** wake-snapshot.ts: hear when a layout change (New Tab, a full panel) ends a page cover. */
export function setPageCoverLostListener(listener: ((window: BaseWindow) => void) | null): void {
  pageCoverLostListener = listener
}

/**
 * Stretch the toolbar surface over the whole window (true) or give it back its own height
 * (false). Only while live pages show with the overlay surfaces; returns whether it covers now.
 */
export function setToolbarPageCover(window: BaseWindow, cover: boolean): boolean {
  const shell = shells.get(window)
  if (!shell || shell.window.isDestroyed()) return false
  const covering = cover && shouldUseNativeOverlays(shell)
  if (covering === pageCovers.has(window)) return covering
  if (covering) pageCovers.add(window)
  else pageCovers.delete(window)
  applyShellLayout(shell)
  return covering
}

/** The window's toolbar surface while it is the visible overlay (live pages), else null. */
export function getOverlayToolbarContents(window: BaseWindow): WebContents | null {
  const shell = shells.get(window)
  if (!shell || !shouldUseNativeOverlays(shell)) return null
  const contents = shell.views.toolbar.webContents
  return contents.isDestroyed() ? null : contents
}

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
  const { views: shellViews, toolbarMetrics } = shell
  const { width, height } = currentContentSize(shell)
  const overlayMode = shouldUseNativeOverlays(shell)
  const sidebarVisible = isSidebarVisible(shell)
  const toolbarHeight = Math.min(toolbarMetrics.toolbarHeight, height)
  const toolbarExtent = Math.min(Math.max(toolbarMetrics.toolbarExtent, toolbarHeight), height)

  // Keep the full React renderer alive and correctly sized for New Tab and local panels.
  // When native overlays are active it is hidden, so its full-window bounds cannot steal page input.
  shellViews.content.setBounds({ x: 0, y: 0, width, height })
  shellViews.content.setVisible(!overlayMode)

  // A wake snapshot (wake-snapshot.ts) is drawn by the toolbar surface over the page area, so the
  // toolbar view covers the whole window while one shows. Leaving overlay mode ends it.
  if (!overlayMode && pageCovers.has(shell.window)) {
    pageCovers.delete(shell.window)
    pageCoverLostListener?.(shell.window)
  }
  const coversPage = overlayMode && pageCovers.has(shell.window)
  shellViews.toolbar.setBounds({ x: 0, y: 0, width, height: coversPage ? height : toolbarExtent })
  shellViews.toolbar.setVisible(overlayMode)

  // With the native blur on, the view is cut to the card itself (the blur covers the whole view);
  // otherwise it is the full-height strip and the CSS insets the card. Either way the card lands on
  // sidebarCardRect, the same rect the in-page sidebar uses (shared/sidebar-card.ts).
  const inset = shell.sidebarFrame ? sidebarCardInset(height, { ...SIDEBAR_CARD, inset: shell.sidebarFrame.inset }) : 0
  // The view keeps its card width while closed (slid out and hidden, see sidebar-motion.ts), so a
  // reveal never resizes the sidebar renderer. Never wider than the card may get. During a width
  // drag it follows the live width too: the view's own background is the native blur/tint, so a
  // view widened for the drag showed that underlay at full size (the drag keeps its implicit
  // mouse capture on the sidebar view, so it doesn't need the extra hit-test area).
  shell.sidebarMotion.layout({
    y: inset,
    width: overlaySidebarWidth(shell, width),
    height: Math.max(0, height - inset * 2)
  })
  // Open/close slides along one timeline while live pages stay on screen; entering or leaving
  // New Tab / a full panel snaps (the in-page sidebar takes over there).
  const overlayShown = overlayMode && sidebarVisible
  const animate = shell.lastOverlayMode === overlayMode
  shell.lastOverlayMode = overlayMode
  shell.sidebarMotion.setOpen(overlayShown, { animate })
  if (overlayShown && !shell.sidebarOverlayShown) {
    shell.sidebarOverlayShown = true
    emitSidebarOverlay(shell, 'shown')
  }
  shell.syncPageBounds?.(width, height, overlayMode, shell.window)
  const cause = shell.layoutCause ?? 'layout'
  shell.layoutCause = null
  shell.revealGuard?.noteChromeChanged(cause)
}

/** The overlay sidebar view's width: the sidebar width, never wider than the card may get. */
function overlaySidebarWidth(shell: ShellState, windowWidth = currentContentSize(shell).width): number {
  return Math.min(shell.chromeState.sidebarWidth, sidebarCardMaxWidth(windowWidth))
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
    scheduleLayout: () => scheduleShellLayout(shell),
    sidebarMotion: null as unknown as SidebarOverlayMotion,
    lastOverlayMode: null,
    sidebarFrame: null,
    sidebarOverlayShown: false,
    lastActiveTabId: null,
    activeTabSince: 0,
    revealGuard: null,
    layoutCause: null,
    dismissOnBlur: () => dismissPopoversOnWindowBlur(shell),
    dismissOnSidebarPress: (_event, mouseEvent) => dismissToolbarPopoversOnPress(shell, 'sidebar', mouseEvent.type)
  }
  shell.sidebarMotion = new SidebarOverlayMotion(views.sidebar, {
    onProgress: (progress) => sidebarMotionListener?.(window, progress),
    onHidden: () => {
      if (!shell.sidebarOverlayShown) return
      shell.sidebarOverlayShown = false
      emitSidebarOverlay(shell, 'hidden')
      shell.revealGuard?.noteChromeChanged('overlay hidden')
    }
  })
  shells.set(window, shell)
  for (const contents of shell.renderers.keys()) bindContentsToWindow(contents, window)
  for (const event of WINDOW_LAYOUT_EVENTS) window.on(event as 'resize', shell.scheduleLayout)
  window.on('blur', shell.dismissOnBlur)
  // Main-process only: sends nothing unless a popover is open (shared/popover-dismiss.ts).
  views.sidebar.webContents.on('before-mouse-event', shell.dismissOnSidebarPress)
  window.on('closed', () => detachBrowserShell(window))
  applyShellLayout(shell)
  shell.revealGuard = new SidebarRevealGuard({
    window,
    sidebarContents: views.sidebar.webContents,
    getChrome: () => shell.chromeState,
    patchChrome: (patch, cause) => setBrowserChromeState(patch, window, cause),
    overlayShown: () => shell.sidebarOverlayShown && shouldUseNativeOverlays(shell),
    sidebarWidth: () => overlaySidebarWidth(shell)
  })
}

// Surfaces of closed windows: their last in-flight IPC calls are dropped quietly (see ipc-retired.ts).
const retiredRenderers = new WeakSet<WebContents>()

/** A shell surface whose window has closed (it is being torn down). */
export function isRetiredShellRenderer(contents: WebContents): boolean {
  return retiredRenderers.has(contents)
}

export function detachBrowserShell(window?: BaseWindow): void {
  const targets = window ? [shells.get(window)].filter((shell): shell is ShellState => Boolean(shell)) : [...shells.values()]
  for (const shell of targets) {
    if (!shell.window.isDestroyed()) {
      for (const event of WINDOW_LAYOUT_EVENTS) shell.window.removeListener(event as 'resize', shell.scheduleLayout)
      shell.window.removeListener('blur', shell.dismissOnBlur)
    }
    const sidebarContents = shell.views.sidebar.webContents
    if (!sidebarContents.isDestroyed()) sidebarContents.removeListener('before-mouse-event', shell.dismissOnSidebarPress)
    clearPointerTimers(shell)
    shell.revealGuard?.dispose()
    shell.revealGuard = null
    shell.sidebarMotion.dispose()
    shell.syncPageBounds = null
    for (const contents of shell.renderers.keys()) retiredRenderers.add(contents)
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
  for (const contents of getMainWindowRenderers()) sendIfAlive(contents, channel, args)
}

/**
 * A surface whose renderer just died (it reloads itself, see crash-guard.ts) has no frame to send
 * to; skip it instead of Electron logging "Render frame was disposed" for every broadcast meanwhile.
 * It asks for fresh state when it loads again.
 */
function sendIfAlive(contents: WebContents, channel: string, args: unknown[]): void {
  if (contents.isCrashed()) return
  contents.send(channel, ...args)
}

/** Send to one window's app surfaces (its tabs, page state, find bar, chrome state). */
export function sendToWindowRenderers(window: BaseWindow, channel: string, ...args: unknown[]): void {
  for (const contents of getWindowRenderers(window)) sendIfAlive(contents, channel, args)
}

export function getBrowserChromeState(window?: BaseWindow | null): BrowserChromeState {
  const shell = shellFor(window)
  return { ...(shell?.chromeState ?? DEFAULT_CHROME_STATE) }
}

export function setBrowserChromeState(input: unknown, window?: BaseWindow | null, cause?: string): BrowserChromeState {
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
  shell.layoutCause = cause ?? `set ${Object.keys(patch).filter((key) => key.startsWith('sidebar')).map((key) => `${key}=${String(patch[key])}`).join(' ')}`
  if (next.sidebarPinned || next.sidebarHovered || next.sidebarFocused || next.sidebarResizing || next.sidebarMode !== 'tabs') clearPointerTimers(shell)
  applyShellLayout(shell)
  sendToWindowRenderers(shell.window, 'browser:chrome-state', getBrowserChromeState(shell.window))
  return getBrowserChromeState(shell.window)
}

/**
 * Main published the window's active tab: when it differs from the last one seen, close the History
 * panel here, in order with the shortcut that toggles it, rather than in the toolbar when the
 * (per-frame coalesced) tab broadcast lands. That broadcast can arrive after a History panel opened
 * just after the switch (switch tab, Cmd+Y right away) and closed it again. A transient "no active
 * tab" (mid-close) is skipped, so closing the active tab still counts as a switch.
 */
export function noteActiveTabForHistoryPanel(activeTabId: string | null | undefined, window?: BaseWindow | null): void {
  const shell = shellFor(window)
  if (!shell || !activeTabId) return
  const previous = shell.lastActiveTabId
  shell.lastActiveTabId = activeTabId
  if (previous !== activeTabId) shell.activeTabSince = Date.now()
  const mode = shell.chromeState.sidebarMode
  const next = sidebarModeAfterTabSwitch(mode, previous, activeTabId)
  if (next !== mode) setBrowserChromeState({ sidebarMode: next }, shell.window)
}

/**
 * When the window's active tab became active (epoch ms; 0 before the first one), stamped in order
 * with whatever main sends next (a Reading List / bookmark popover it opens right after a switch).
 */
export function activeTabSinceFor(window?: BaseWindow | null): number {
  return shellFor(window)?.activeTabSince ?? 0
}

/** Track mouse input delivered to the full-width live page without placing a hit-test view above it. */
export function handleBrowserPageMouseEvent(input: { type: string; x: number }, window?: BaseWindow | null): void {
  const shell = shellFor(window)
  if (!shell) return
  dismissToolbarPopoversOnPress(shell, 'page', input.type)
  // A press on the page lets go of hover/focus/drag holds; any move or release reaching the page
  // ends a sidebar drag whose mouseup the sidebar never saw.
  shell.revealGuard?.handlePageMouse(input)
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
        // The reveal waits REVEAL_DELAY_MS; start the backdrop capture now so it's ready when it shows.
        emitSidebarOverlay(shell, 'prefetch')
        shell.revealTimer = setTimeout(() => {
          shell.revealTimer = null
          if (shouldUseNativeOverlays(shell) && shell.chromeState.sidebarMode === 'tabs' && !isSidebarVisible(shell)) {
            setBrowserChromeState({ sidebarHovered: true }, shell.window, 'page edge hover reveal')
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
          setBrowserChromeState({ sidebarHovered: false }, shell.window, 'pointer moved onto the page')
        }
      }, PAGE_EXIT_DELAY_MS)
    }
  } else {
    clearPageExitTimer(shell)
  }
}

function popoverState(shell: ShellState): ToolbarPopoverState {
  const { toolbarHeight, toolbarExtent, popoverOpen } = shell.toolbarMetrics
  return { overlayMode: shouldUseNativeOverlays(shell), toolbarHeight, toolbarExtent, popoverOpen, historyOpen: shell.chromeState.sidebarMode === 'history' }
}

function sendPopoverDismiss(reason: PopoverDismissReason, targets: WebContents[]): void {
  for (const contents of targets) if (!contents.isDestroyed()) contents.send(POPOVER_DISMISS_CHANNEL, reason)
}

/**
 * A press on the page or the sidebar view closes the toolbar's popovers: the toolbar's document
 * never sees those clicks (separate WebContentsViews), and the toolbar may not even have had focus
 * to lose.
 */
function dismissToolbarPopoversOnPress(shell: ShellState, surface: 'page' | 'sidebar', mouseType: string): void {
  const reason = surfacePressDismissReason(surface, mouseType, popoverState(shell))
  if (reason) sendPopoverDismiss(reason, [shell.views.toolbar.webContents])
}

/** The window losing focus closes popovers in whichever surface draws the toolbar. */
function dismissPopoversOnWindowBlur(shell: ShellState): void {
  const state = popoverState(shell)
  // Off overlay mode the content renderer draws the toolbar; its own document blur may not fire if
  // focus was on the page, so tell it too.
  if (!state.overlayMode) return sendPopoverDismiss('window-blur', [shell.views.content.webContents])
  if (windowBlurDismissesPopovers(state)) sendPopoverDismiss('window-blur', [shell.views.toolbar.webContents])
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
      // Rounded up: a fractional popover bottom rounded down clipped its last pixel row.
      toolbarMetrics.toolbarExtent = Math.max(toolbarMetrics.toolbarHeight, Math.min(2400, Math.ceil(candidate.toolbarExtent)))
    }
    if (typeof candidate.popoverOpen === 'boolean') toolbarMetrics.popoverOpen = candidate.popoverOpen
  }
  applyShellLayout(shell)
  return { ...toolbarMetrics, windowHeight: currentContentSize(shell).height }
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

/** The overlay sidebar view of a window (sidebar-backdrop.ts paints its background). */
export function getSidebarOverlayView(window: BaseWindow): WebContentsView | null {
  const shell = shells.get(window)
  return shell && !shell.window.isDestroyed() ? shell.views.sidebar : null
}

/** True while the overlay sidebar is on screen above a live page in this window. */
export function isSidebarOverlayShown(window: BaseWindow): boolean {
  return Boolean(shells.get(window)?.sidebarOverlayShown)
}

/** Inset + round the overlay sidebar view to its card (native blur), or back to the full-height strip (null). */
export function setSidebarOverlayFrame(window: BaseWindow, frame: { inset: number; radius: number } | null): void {
  const shell = shells.get(window)
  if (!shell || shell.window.isDestroyed()) return
  const same = shell.sidebarFrame?.inset === frame?.inset && shell.sidebarFrame?.radius === frame?.radius
  shell.sidebarFrame = frame ? { ...frame } : null
  if (!same) applyShellLayout(shell)
}

/** Every browser window with a shell. */
export function getShellWindows(): BaseWindow[] {
  return [...shells.keys()].filter((window) => !window.isDestroyed())
}
