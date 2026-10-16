import { app, globalShortcut, ipcMain, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  DEFAULT_MINI_WINDOW_SETTINGS,
  MINI_WINDOW_SETTINGS_FILE,
  clashingAppShortcut,
  isMiniWindowGrouping,
  isMiniWindowHeaderPlacement,
  isMiniWindowMenuBarIcon,
  isMiniWindowPeekDelay,
  normalizeAccelerator,
  normalizeMiniWindowUrl,
  parseMiniWindowSettings,
  type MiniWindowGrouping,
  type MiniWindowHeaderPlacement,
  type MiniWindowSettings
} from '../shared/mini-window'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readUserJson, writeSettingsFile } from './user-json'

/** Which pages live in the menu bar (shared/mini-window-menubar.ts MINI_WINDOW_MENU_BAR_FILE; not imported, to keep it out of startup). */
const MENU_BAR_FILE = 'mini-window-menubar.json'

/**
 * Mini window entry point: everything main loads at startup for it (settings, IPC, the global
 * toggle shortcut and the calls browser.ts / menus / the palette make). The window itself
 * (mini-window.ts) is a lazy chunk, imported the first time a mini window opens.
 */

type MiniWindowModule = typeof import('./mini-window')

/** What mini-window.ts needs from the tab registry (browser.ts). */
export interface MiniWindowHost {
  /** Register `win` as the mini window's (tab-less) window state. */
  attachWindow(win: BaseWindow): void
  /** The current browser window's active tab (what a pop-out without a tab id takes). */
  activeTabId(): string | null
  canPopOut(tabId: string): boolean
  /**
   * Move a tab's live view into the mini window (no reload), from a browser window or another mini
   * window, and make it the active tab there. False when it can't go (not a web page, or a private
   * tab and a normal collection).
   */
  adoptTab(tabId: string, win: BaseWindow): boolean
  /** The mini window's tabs, in strip order. */
  tabs(win: BaseWindow): MiniWindowTab[]
  /** Show one of the mini window's tabs. */
  activateTab(win: BaseWindow, tabId: string): boolean
  /** Open `url` as the mini window's tab, in the normal profile session. */
  openUrl(url: string, win: BaseWindow): string | null
  /** Put one of the mini window's tabs (default: the active one) back into a browser window (its last tab closes the mini window). */
  returnTab(win: BaseWindow, tabId?: string): boolean
  /** Close one of the mini window's tabs (default: the active one); its last tab closes the window. */
  closeTab(win: BaseWindow, tabId?: string): void
  /** Where the page goes inside the mini window (window coordinates). */
  setPageBounds(win: BaseWindow, bounds: { x: number; y: number; width: number; height: number }): void
  pageContents(win: BaseWindow): WebContents | null
  header(win: BaseWindow): ({ tabId: string; title: string; url: string; faviconUrl: string | null; loading: boolean; canGoBack: boolean; private: boolean } & MiniWindowTabAudio) | null
  /** Set one of the mini window's tabs' volume (0..1) / mute. */
  setTabVolume(win: BaseWindow, tabId: string, volume: number): void
  setTabMuted(win: BaseWindow, tabId: string, muted: boolean): void
  /** Run a browser shortcut pressed in the mini window; true when it was one. */
  handleShortcut(win: BaseWindow, input: Electron.Input): boolean
  /** A short notice in the browser window (e.g. too many mini windows open). */
  notify(message: string): void
  /** Tabs in the (normal) browser windows, for picking the menu bar's pages back out after a restart. */
  browserTabs(): Array<{ tabId: string; url: string }>
}

/** What the header's speaker needs (shown while the tab is audible, holds media or is muted). */
export interface MiniWindowTabAudio {
  audio: boolean
  muted: boolean
  volume: number
}

export interface MiniWindowTab extends MiniWindowTabAudio {
  /** Making sound right now (the menu bar icon's ♪). */
  playing: boolean
  tabId: string
  title: string
  url: string
  faviconUrl: string | null
  active: boolean
}

export interface MiniWindowListing {
  tabId: string
  title: string
  tucked: boolean
  focused: boolean
  /** Lives in the menu bar (tucked: its popout is hidden). */
  menuBar: boolean
}

export interface MiniWindowShortcutStatus {
  /** The configured accelerator ('' = off). */
  shortcut: string
  /** Registered with the OS right now. */
  registered: boolean
  /** Why it isn't: another app holds it, or it shadows a Surffish shortcut. */
  error: string | null
}

let settings: MiniWindowSettings | null = null
let host: MiniWindowHost | null = null
let miniModule: MiniWindowModule | null = null
let loadingModule: Promise<MiniWindowModule> | null = null
let registeredShortcut: string | null = null
let shortcutError: string | null = null
let appShortcuts: () => readonly string[] = () => []
let settingsOpener: () => void = () => {}

function current(): MiniWindowSettings {
  settings ??= parseMiniWindowSettings(readUserJson(MINI_WINDOW_SETTINGS_FILE))
  return settings
}

export function getMiniWindowSettings(): MiniWindowSettings {
  return { ...current() }
}

export function setMiniWindowHost(next: MiniWindowHost | null): void {
  host = next
}

export function getMiniWindowHost(): MiniWindowHost | null {
  return host
}

/** Surffish's own accelerators (app menu + tab commands), so the global shortcut never shadows one. */
export function setMiniWindowAppShortcuts(provider: () => readonly string[]): void {
  appShortcuts = provider
}

/** How the menu bar icon's "Settings…" opens Settings → Mini window (commands.ts knows the panels). */
export function setMiniWindowSettingsOpener(open: () => void): void {
  settingsOpener = open
}

/** The menu bar icon's "Mini Window Settings…": bring a browser window forward with Settings open. */
export function openMiniWindowSettings(): void {
  // A menu bar click never activates Surffish on macOS.
  if (process.platform === 'darwin') app.focus({ steal: true })
  settingsOpener()
}

function loadModule(): Promise<MiniWindowModule> {
  loadingModule ??= import('./mini-window').then((module) => {
    miniModule = module
    return module
  })
  return loadingModule
}

/** Pop a tab (default: the current window's active tab) out into a new mini window of its own. */
export async function popOutTabToMiniWindow(tabId?: string | null): Promise<boolean> {
  if (!host) return false
  const id = tabId ?? host.activeTabId()
  if (!id || !host.canPopOut(id)) return false
  try {
    return (await loadModule()).popOutTab(id)
  } catch (error) {
    console.warn('Could not open the mini window:', error)
    return false
  }
}

/** Open a tab (default: the current window's active tab) in the menu bar (tab menu "Open in Menu Bar"). */
export async function popOutTabToMenuBar(tabId?: string | null): Promise<boolean> {
  if (!host || current().menuBarIcon === 'never') return false
  const id = tabId ?? host.activeTabId()
  if (!id || !host.canPopOut(id)) return false
  try {
    return (await loadModule()).popOutTabToMenuBar(id)
  } catch (error) {
    console.warn('Could not open the mini window in the menu bar:', error)
    return false
  }
}

/** ⌘K "Send Mini Window to Menu Bar": the last used floating mini window, else the current tab. */
export async function sendMiniWindowToMenuBar(): Promise<boolean> {
  if (miniModule?.sendCurrentToMenuBar()) return true
  return popOutTabToMenuBar()
}

/** Can ⌘K "Send Mini Window to Menu Bar" do anything (icon not off; a floating mini or a tab that can pop out)? */
export function canSendToMenuBar(canPopOutCurrentTab: boolean): boolean {
  if (current().menuBarIcon === 'never') return false
  return canPopOutCurrentTab || Boolean(miniModule?.list().some((mini) => !mini.menuBar))
}

/**
 * After the first window paints: menu bar minis from the last run come back there, and with the icon
 * set to 'always' it shows. Nothing loads (or is created) otherwise.
 */
export function startMiniWindowMenuBar(): void {
  const { menuBarIcon } = current()
  if (menuBarIcon === 'never') return
  const saved = readUserJson(MENU_BAR_FILE) as { urls?: unknown } | null
  const hasPages = Array.isArray(saved?.urls) && saved.urls.length > 0
  if (menuBarIcon !== 'always' && !hasPages) return
  void loadModule().then((module) => module.startMenuBar()).catch((error: unknown) => console.warn('Could not restore the menu bar mini windows:', error))
}

/** Put one mini window's tab back into the browser: the mini window `window`, or the one holding `tabId`. */
export function returnMiniWindowToBrowser(target: { window?: BaseWindow; tabId?: string }): boolean {
  return miniModule?.returnToBrowser(target) ?? false
}

/** ⌘K: turn hover peek for tucked mini windows on/off (applies live). */
export function setMiniWindowPeekOnHover(peekOnHover: boolean): boolean {
  return updateMiniWindowSettings({ peekOnHover }).ok
}

/** ⌘K: turn throwing mini windows with momentum on/off (applies live). */
export function setMiniWindowThrowMomentum(throwMomentum: boolean): boolean {
  return updateMiniWindowSettings({ throwMomentum }).ok
}

/** Settings → Mini window grouping (also the Window menu and the palette). Regroups open mini windows without reloading. */
export function setMiniWindowGrouping(grouping: MiniWindowGrouping): boolean {
  return updateMiniWindowSettings({ grouping }).ok
}

/** Settings → Mini window header (also the Window menu and the palette). Moves open headers live, no reloads. */
export function setMiniWindowHeaderPlacement(headerPlacement: MiniWindowHeaderPlacement): boolean {
  return updateMiniWindowSettings({ headerPlacement }).ok
}

/** Put every mini window's tab back into the browser. */
export function returnAllMiniWindows(): boolean {
  return miniModule?.returnAll() ?? false
}

/** Open mini windows, oldest first (Window menu, palette). */
export function listMiniWindows(): MiniWindowListing[] {
  return miniModule?.list() ?? []
}

/** Bring the mini window holding `tabId` forward with the keyboard. */
export function focusMiniWindow(tabId: string): boolean {
  return miniModule?.focusMini(tabId) ?? false
}

/**
 * The global shortcut (and the palette's "Show/Hide Mini Windows"): with no mini window open, open
 * the pinned default page (or, without one, pop out the current tab); otherwise show or hide all of
 * them together (docked ones slide out or tuck away).
 */
export async function toggleMiniWindow(): Promise<boolean> {
  if (miniModule?.isOpen()) return miniModule.toggleVisible()
  const { defaultUrl } = current()
  if (defaultUrl) {
    try {
      return (await loadModule()).openPinnedPage(defaultUrl)
    } catch (error) {
      console.warn('Could not open the mini window:', error)
      return false
    }
  }
  return popOutTabToMiniWindow()
}

/** Tuck a mini window (the last used, or the one holding `tabId`) to the nearest screen edge, or slide it back out (palette). */
export function tuckMiniWindow(tabId?: string): boolean {
  return miniModule?.toggleTuck(tabId) ?? false
}

/** Is that mini window tucked away behind its edge handle? */
export function isMiniWindowTucked(tabId?: string): boolean {
  return miniModule?.isTucked(tabId) ?? false
}

/** browser.ts: the mini window's tab changed (title, URL, loading); refresh its header. */
export function noteMiniWindowChanged(window: BaseWindow): void {
  miniModule?.refreshHeader(window)
}

function unregisterShortcut(): void {
  if (registeredShortcut) {
    try { globalShortcut.unregister(registeredShortcut) } catch { /* already gone */ }
  }
  registeredShortcut = null
}

/** (Re)register the configured global toggle. Fails quietly (status says why) when the OS or Surffish already uses it. */
function applyShortcut(): void {
  unregisterShortcut()
  shortcutError = null
  const { shortcut } = current()
  if (!shortcut || !app.isReady()) return
  const clash = clashingAppShortcut(shortcut, appShortcuts(), process.platform === 'darwin')
  if (clash) {
    shortcutError = 'Surffish already uses this shortcut'
    return
  }
  let ok = false
  try {
    ok = globalShortcut.register(shortcut, () => { void toggleMiniWindow() })
  } catch (error) {
    console.warn('Could not register the mini window shortcut:', error)
  }
  if (ok) registeredShortcut = shortcut
  else shortcutError = 'Another app is using this shortcut'
}

export function getMiniWindowShortcutStatus(): MiniWindowShortcutStatus {
  return { shortcut: current().shortcut, registered: registeredShortcut !== null && globalShortcut.isRegistered(registeredShortcut), error: shortcutError }
}

function publishSettings(): void {
  try { sendToMainWindowRenderers('browser:mini-window:settings-changed', { settings: getMiniWindowSettings(), status: getMiniWindowShortcutStatus() }) } catch { /* window closing */ }
}

/** Settings → General → Mini window. Bad input returns {ok:false,error} instead of throwing over IPC. */
export function updateMiniWindowSettings(input: unknown): { ok: true; settings: MiniWindowSettings; status: MiniWindowShortcutStatus } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Invalid settings' }
  const patch = input as Record<string, unknown>
  const next = { ...current() }
  if ('defaultUrl' in patch) {
    const url = normalizeMiniWindowUrl(patch.defaultUrl)
    if (url === null) return { ok: false, error: 'Enter a web address (https://…)' }
    next.defaultUrl = url
  }
  if ('shortcut' in patch) {
    if (patch.shortcut === '' || patch.shortcut === null) next.shortcut = ''
    else {
      const accelerator = normalizeAccelerator(patch.shortcut)
      if (!accelerator) return { ok: false, error: 'Use a modifier (⌘, Ctrl, ⌥ or Alt) plus one key' }
      next.shortcut = accelerator
    }
  }
  if ('opacity' in patch) next.opacity = parseMiniWindowSettings({ ...next, opacity: patch.opacity }).opacity
  if ('tuckToEdge' in patch) {
    if (typeof patch.tuckToEdge !== 'boolean') return { ok: false, error: 'Invalid settings' }
    next.tuckToEdge = patch.tuckToEdge
  }
  if ('peekOnHover' in patch) {
    if (typeof patch.peekOnHover !== 'boolean') return { ok: false, error: 'Invalid settings' }
    next.peekOnHover = patch.peekOnHover
  }
  if ('peekDelayMs' in patch) {
    if (!isMiniWindowPeekDelay(patch.peekDelayMs)) return { ok: false, error: 'Invalid settings' }
    next.peekDelayMs = patch.peekDelayMs
  }
  if ('throwMomentum' in patch) {
    if (typeof patch.throwMomentum !== 'boolean') return { ok: false, error: 'Invalid settings' }
    next.throwMomentum = patch.throwMomentum
  }
  if ('grouping' in patch) {
    if (!isMiniWindowGrouping(patch.grouping)) return { ok: false, error: 'Invalid settings' }
    next.grouping = patch.grouping
  }
  if ('headerPlacement' in patch) {
    if (!isMiniWindowHeaderPlacement(patch.headerPlacement)) return { ok: false, error: 'Invalid settings' }
    next.headerPlacement = patch.headerPlacement
  }
  if ('menuBarIcon' in patch) {
    if (!isMiniWindowMenuBarIcon(patch.menuBarIcon)) return { ok: false, error: 'Invalid settings' }
    next.menuBarIcon = patch.menuBarIcon
  }
  const shortcutChanged = next.shortcut !== current().shortcut
  settings = parseMiniWindowSettings(next)
  writeSettingsFile(MINI_WINDOW_SETTINGS_FILE, settings)
  if (shortcutChanged) applyShortcut()
  if (miniModule) miniModule.applySettings(getMiniWindowSettings())
  // 'always' with no mini window opened yet: the icon needs the (lazy) window module.
  else if (settings.menuBarIcon === 'always') void loadModule().then((module) => module.applySettings(getMiniWindowSettings())).catch(() => undefined)
  publishSettings()
  return { ok: true, settings: getMiniWindowSettings(), status: getMiniWindowShortcutStatus() }
}

function fromAppWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWindowRenderer(event.sender, event.senderFrame)
}

export function registerMiniWindowIpc(): void {
  ipcMain.handle('browser:mini-window:get-settings', () => ({ settings: getMiniWindowSettings(), status: getMiniWindowShortcutStatus(), defaults: { ...DEFAULT_MINI_WINDOW_SETTINGS } }))
  ipcMain.handle('browser:mini-window:update-settings', (event, input: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    return updateMiniWindowSettings(input)
  })
  applyShortcut()
  app.on('will-quit', unregisterShortcut)
}
