import { ipcRenderer } from 'electron'
import type { SearchEngineId } from '../shared/types'
import type { TabArchiveSettings, TabArchiveSnapshot } from '../shared/tab-archive'

/** window.api.browser.tabArchive: archived tabs, auto-archive settings, switch-to-open-tab. */
export const tabArchiveApi = {
  get: (): Promise<TabArchiveSnapshot> => ipcRenderer.invoke('browser:tab-archive:get'),
  setSettings: (patch: Partial<TabArchiveSettings>): Promise<TabArchiveSettings> => ipcRenderer.invoke('browser:tab-archive:settings:set', patch),
  archive: (tabId: string): Promise<boolean> => ipcRenderer.invoke('browser:tab-archive:archive', tabId),
  restore: (id: string): Promise<string | null> => ipcRenderer.invoke('browser:tab-archive:restore', id),
  /** Every archived tab, or just `ids`. */
  restoreAll: (ids?: string[]): Promise<number> => ipcRenderer.invoke('browser:tab-archive:restore-all', ids),
  remove: (ids: string[]): Promise<number> => ipcRenderer.invoke('browser:tab-archive:delete', ids),
  clear: (): Promise<number> => ipcRenderer.invoke('browser:tab-archive:clear'),
  /** Omnibox submit: true when main switched to an open tab with that address instead (setting on). */
  switchToOpenTab: (input: string, engine?: SearchEngineId): Promise<boolean> => ipcRenderer.invoke('browser:tab-archive:switch-to-open-tab', input, engine),
  onChange: (callback: (snapshot: TabArchiveSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TabArchiveSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:tab-archive:changed', listener)
    return () => ipcRenderer.removeListener('browser:tab-archive:changed', listener)
  }
}
