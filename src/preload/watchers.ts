import { ipcRenderer } from 'electron'
import type { PageWatcherSummary, WatcherPatch, WatchIntervalMinutes } from '../shared/page-watchers'

export interface PageWatchersSnapshot {
  watchers: PageWatcherSummary[]
  running: string[]
}

/** window.api.browser.watchers: Settings → Watchers (list, add, edit, pause, delete, check now). */
export const watchersApi = {
  list: (): Promise<PageWatchersSnapshot> => ipcRenderer.invoke('browser:watchers:list'),
  add: (input: { url: string; title?: string; selector?: string | null; intervalMinutes?: WatchIntervalMinutes; renderJs?: boolean }): Promise<{ ok: true; watcher: PageWatcherSummary } | { ok: false; error: string }> => ipcRenderer.invoke('browser:watchers:add', input),
  update: (id: string, patch: WatcherPatch): Promise<{ ok: true; snapshot: PageWatchersSnapshot } | { ok: false; error: string }> => ipcRenderer.invoke('browser:watchers:update', id, patch),
  remove: (id: string): Promise<PageWatchersSnapshot> => ipcRenderer.invoke('browser:watchers:delete', id),
  checkNow: (id: string): Promise<PageWatchersSnapshot> => ipcRenderer.invoke('browser:watchers:check-now', id),
  onChange: (callback: (snapshot: PageWatchersSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PageWatchersSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:watchers:changed', listener)
    return () => ipcRenderer.removeListener('browser:watchers:changed', listener)
  },
  /** A notification or the context menu asked to open one watcher. */
  onFocus: (callback: (request: { id: string; mode: 'diff' | 'edit' }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: string; mode: 'diff' | 'edit' }): void => callback(request)
    ipcRenderer.on('browser:watchers:focus', listener)
    return () => ipcRenderer.removeListener('browser:watchers:focus', listener)
  }
}
