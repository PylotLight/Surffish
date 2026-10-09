import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserBounds,
  BrowserProxySettings,
  BrowserProxyTestResult,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  SearchEngineId
} from '../shared/types'

const api = {
  platform: process.platform,
  browser: {
    state: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
    navigate: (input: string, engine?: SearchEngineId): Promise<boolean> => ipcRenderer.invoke('browser:navigate', input, engine),
    setSearchEngine: (engine: SearchEngineId): Promise<void> => ipcRenderer.invoke('browser:search-engine:set', engine),
    back: (): Promise<void> => ipcRenderer.invoke('browser:back'),
    forward: (): Promise<void> => ipcRenderer.invoke('browser:forward'),
    reload: (): Promise<void> => ipcRenderer.invoke('browser:reload'),
    stop: (): Promise<void> => ipcRenderer.invoke('browser:stop'),
    setBounds: (bounds: BrowserBounds): Promise<void> => ipcRenderer.invoke('browser:set-bounds', bounds),
    tabs: {
      get: (): Promise<BrowserTabSummary[]> => ipcRenderer.invoke('browser:tabs:get'),
      create: (input?: string, engine?: SearchEngineId): Promise<string | null> => ipcRenderer.invoke('browser:tabs:new', input, engine),
      activate: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:tabs:activate', id),
      close: (id: string): Promise<void> => ipcRenderer.invoke('browser:tabs:close', id),
      onChange: (callback: (tabs: BrowserTabSummary[]) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, tabs: BrowserTabSummary[]): void => callback(tabs)
        ipcRenderer.on('browser:tabs', listener)
        return () => ipcRenderer.removeListener('browser:tabs', listener)
      }
    },
    history: {
      get: (): Promise<BrowsingHistoryEntry[]> => ipcRenderer.invoke('browser:history:get'),
      clear: (): Promise<void> => ipcRenderer.invoke('browser:history:clear'),
      onChange: (callback: () => void): (() => void) => {
        const listener = (): void => callback()
        ipcRenderer.on('browser:history-changed', listener)
        return () => ipcRenderer.removeListener('browser:history-changed', listener)
      }
    },
    onState: (callback: (state: BrowserState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: BrowserState): void => callback(state)
      ipcRenderer.on('browser:state', listener)
      return () => ipcRenderer.removeListener('browser:state', listener)
    },
    onFocusAddress: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('browser:focus-address', listener)
      return () => ipcRenderer.removeListener('browser:focus-address', listener)
    },
    proxy: {
      get: (): Promise<BrowserProxySettings> => ipcRenderer.invoke('browser:proxy:get'),
      set: (settings: BrowserProxySettings): Promise<BrowserProxySettings> => ipcRenderer.invoke('browser:proxy:set', settings),
      test: (settings: BrowserProxySettings): Promise<BrowserProxyTestResult> => ipcRenderer.invoke('browser:proxy:test', settings)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
export type PreloadAPI = typeof api
