import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  PAGE_WATCHERS_FEATURE_FILE,
  parsePageWatchersFeature,
  watchersDisabledResult,
  watchersTransition,
  type PageWatchersFeatureSettings
} from '../shared/page-watchers-feature'
import { normalizeWatchUrl } from '../shared/page-watchers'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readSettingsFile, writeSettingsFile } from './user-json'

/**
 * "Enable page watchers" gate. This file is all main loads at startup for watchers: page-watchers.ts
 * (the scheduler, fetches, offscreen renderer, notifications) is imported only while the feature is
 * on, so turning it off costs nothing at launch. Toggling applies live: off disposes the timers and
 * notifications (saved watchers stay in page-watchers.json), on loads the module and resumes.
 */
type WatcherModule = typeof import('./page-watchers')

let settings: PageWatchersFeatureSettings | null = null
let watcherModule: WatcherModule | null = null
let loadingModule: Promise<WatcherModule> | null = null
let started = false
let quitting = false
const listeners = new Set<(enabled: boolean) => void>()

function current(): PageWatchersFeatureSettings {
  settings ??= parsePageWatchersFeature(readSettingsFile(PAGE_WATCHERS_FEATURE_FILE))
  return settings
}

export function pageWatchersEnabled(): boolean {
  return current().enabled
}

/** App menu and similar main-side entry points rebuild when the setting changes. */
export function onPageWatchersEnabledChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function loadWatcherModule(): Promise<WatcherModule> {
  loadingModule ??= import('./page-watchers').then((module) => {
    watcherModule = module
    return module
  })
  return loadingModule
}

/** Only for a test or diagnostics: is the scheduler module in memory? */
export function isPageWatcherModuleLoaded(): boolean {
  return watcherModule !== null
}

async function start(options: { startupHold: boolean }): Promise<void> {
  if (started || quitting) return
  started = true
  try {
    const module = await loadWatcherModule()
    // Turned off (or quitting) while the module was loading.
    if (!pageWatchersEnabled() || quitting) {
      started = false
      return
    }
    module.initializePageWatchers({ startupHold: options.startupHold })
  } catch (error) {
    started = false
    console.warn('Could not start page watchers:', error)
  }
}

function stop(): void {
  if (!started) return
  started = false
  watcherModule?.disposePageWatchers()
}

/** Startup: load and start the watcher scheduler only when the feature is on. */
export function initializePageWatchersFeature(): void {
  if (pageWatchersEnabled()) void start({ startupHold: true })
}

export function disposePageWatchersFeature(): void {
  quitting = true
  stop()
}

export function getPageWatchersFeature(): PageWatchersFeatureSettings {
  return { ...current() }
}

export function setPageWatchersEnabled(input: unknown): PageWatchersFeatureSettings {
  const wasEnabled = pageWatchersEnabled()
  const next = parsePageWatchersFeature({ enabled: input !== false })
  settings = next
  writeSettingsFile(PAGE_WATCHERS_FEATURE_FILE, next)
  const transition = watchersTransition(wasEnabled, next.enabled)
  if (transition === 'stop') stop()
  else if (transition === 'start') void start({ startupHold: false })
  if (transition !== 'none') {
    try { sendToMainWindowRenderers('browser:watchers:enabled-changed', next.enabled) } catch { /* window closing */ }
    for (const listener of listeners) {
      try { listener(next.enabled) } catch (error) { console.warn('Page watchers toggle listener failed:', error) }
    }
  }
  return { ...next }
}

/** Same check page-watchers.ts uses, without loading it (the context menu asks on every right-click). */
export function canWatchPage(url: string): boolean {
  return pageWatchersEnabled() && normalizeWatchUrl(url) !== null
}

/** Context menu "Watch This Page…" / "Watch Part of This Page…". */
export async function watchPageFromTab(contents: WebContents, mode: 'page' | 'pick', title: string): Promise<void> {
  if (!pageWatchersEnabled()) return
  const module = await loadWatcherModule()
  if (!pageWatchersEnabled()) return
  await module.watchPageFromTab(contents, mode, title)
}

/** Window → Page Watchers, the command palette, notifications. No-op while off. */
export function revealPageWatchers(focusId?: string, mode: 'diff' | 'edit' = 'diff'): void {
  if (!pageWatchersEnabled()) return
  void loadWatcherModule().then((module) => { if (pageWatchersEnabled()) module.revealPageWatchers(focusId, mode) }, () => undefined)
}

function fromAppWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWindowRenderer(event.sender, event.senderFrame)
}

export function registerPageWatcherIpc(): void {
  ipcMain.handle('browser:watchers:get-enabled', () => getPageWatchersFeature())
  ipcMain.handle('browser:watchers:set-enabled', (event, enabled: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    return setPageWatchersEnabled(enabled)
  })
  // Watcher actions: a plain { ok: false, error: 'watchers disabled' } while the feature is off, never a throw.
  const gated = (channel: string, run: (module: WatcherModule, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
      if (!pageWatchersEnabled()) return watchersDisabledResult()
      const module = await loadWatcherModule()
      if (!pageWatchersEnabled()) return watchersDisabledResult()
      return run(module, ...args)
    })
  }
  gated('browser:watchers:list', (module) => module.pageWatcherIpcHandlers.list())
  gated('browser:watchers:add', (module, input) => module.pageWatcherIpcHandlers.add(input))
  gated('browser:watchers:update', (module, id, patch) => module.pageWatcherIpcHandlers.update(id, patch))
  gated('browser:watchers:delete', (module, id) => module.pageWatcherIpcHandlers.delete(id))
  gated('browser:watchers:check-now', (module, id) => module.pageWatcherIpcHandlers.checkNow(id))
}
