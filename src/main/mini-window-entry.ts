import { app, globalShortcut, ipcMain, type BaseWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  DEFAULT_MINI_WINDOW_SETTINGS,
  MINI_WINDOW_SETTINGS_FILE,
  clashingAppShortcut,
  normalizeAccelerator,
  normalizeMiniWindowUrl,
  parseMiniWindowSettings,
  type MiniWindowSettings
} from '../shared/mini-window'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readUserJson, writeSettingsFile } from './user-json'

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
  /** Move a tab's live view into the mini window (no reload). False when it can't go. */
  adoptTab(tabId: string, win: BaseWindow): boolean
  /** Open `url` as the mini window's tab, in the normal profile session. */
  openUrl(url: string, win: BaseWindow): string | null
  /** Put the mini window's tab back into a browser window (the mini window closes). */
  returnTab(win: BaseWindow): boolean
  /** Close the mini window's tab (and with it the window). */
  closeTab(win: BaseWindow): void
  /** Where the page goes inside the mini window (window coordinates). */
  setPageBounds(win: BaseWindow, bounds: { x: number; y: number; width: number; height: number }): void
  pageContents(win: BaseWindow): WebContents | null
  header(win: BaseWindow): { tabId: string; title: string; url: string; faviconUrl: string | null; loading: boolean; canGoBack: boolean; private: boolean } | null
  /** Run a browser shortcut pressed in the mini window; true when it was one. */
  handleShortcut(win: BaseWindow, input: Electron.Input): boolean
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

function loadModule(): Promise<MiniWindowModule> {
  loadingModule ??= import('./mini-window').then((module) => {
    miniModule = module
    return module
  })
  return loadingModule
}

/** Pop a tab (default: the current window's active tab) out to the mini window. */
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

/** Put the mini window's tab back into the browser. */
export function returnMiniWindowToBrowser(): boolean {
  return miniModule?.returnToBrowser() ?? false
}

/**
 * The global shortcut (and the palette's "Toggle Mini Window"): with nothing in the mini window,
 * open the pinned default page (or, without one, pop out the current tab); otherwise show or hide it.
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
  const shortcutChanged = next.shortcut !== current().shortcut
  settings = parseMiniWindowSettings(next)
  writeSettingsFile(MINI_WINDOW_SETTINGS_FILE, settings)
  if (shortcutChanged) applyShortcut()
  miniModule?.applySettings(getMiniWindowSettings())
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
