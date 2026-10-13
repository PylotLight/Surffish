import { ipcRenderer } from 'electron'
import type { PageWatcherSummary, WatcherPatch, WatchIntervalMinutes } from '../shared/page-watchers'
import type { PageWatchersFeatureSettings, WatchersDisabledResult } from '../shared/page-watchers-feature'

export interface PageWatchersSnapshot {
  watchers: PageWatcherSummary[]
  running: string[]
}

/** window.api.browser.watchers: Settings → Watchers (list, add, edit, pause, delete, check now). */
export const watchersApi = {
  /** Every action answers WatchersDisabledResult ({ ok: false, error: 'watchers disabled' }) while the feature is off. */
  list: (): Promise<PageWatchersSnapshot | WatchersDisabledResult> => ipcRenderer.invoke('browser:watchers:list'),
  add: (input: { url: string; title?: string; selector?: string | null; intervalMinutes?: WatchIntervalMinutes; renderJs?: boolean }): Promise<{ ok: true; watcher: PageWatcherSummary } | { ok: false; error: string }> => ipcRenderer.invoke('browser:watchers:add', input),
  update: (id: string, patch: WatcherPatch): Promise<{ ok: true; snapshot: PageWatchersSnapshot } | { ok: false; error: string }> => ipcRenderer.invoke('browser:watchers:update', id, patch),
  remove: (id: string): Promise<PageWatchersSnapshot | WatchersDisabledResult> => ipcRenderer.invoke('browser:watchers:delete', id),
  checkNow: (id: string): Promise<PageWatchersSnapshot | WatchersDisabledResult> => ipcRenderer.invoke('browser:watchers:check-now', id),
  onChange: (callback: (snapshot: PageWatchersSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PageWatchersSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:watchers:changed', listener)
    return () => ipcRenderer.removeListener('browser:watchers:changed', listener)
  },
  /** Settings → General → "Enable page watchers" (on by default). */
  getEnabled: (): Promise<PageWatchersFeatureSettings> => ipcRenderer.invoke('browser:watchers:get-enabled'),
  setEnabled: (enabled: boolean): Promise<PageWatchersFeatureSettings> => ipcRenderer.invoke('browser:watchers:set-enabled', enabled),
  onEnabledChange: (callback: (enabled: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean): void => callback(enabled === true)
    ipcRenderer.on('browser:watchers:enabled-changed', listener)
    return () => ipcRenderer.removeListener('browser:watchers:enabled-changed', listener)
  },
  /** A notification or the context menu asked to open one watcher. */
  onFocus: (callback: (request: { id: string; mode: 'diff' | 'edit' }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: string; mode: 'diff' | 'edit' }): void => callback(request)
    ipcRenderer.on('browser:watchers:focus', listener)
    return () => ipcRenderer.removeListener('browser:watchers:focus', listener)
  }
}
