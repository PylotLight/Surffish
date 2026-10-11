import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserSiteSettings,
  BramblePopupAnchor,
  BrambleExtensionState,
  BrowserBounds,
  BrowserProxySettings,
  BrowserProxyTestResult,
  BrowserState,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  NewTabBackground,
  NewTabBackgroundRefreshResult,
  NewTabPageId,
  PinnedSite,
  NetworkRequestDetails,
  NetworkRequestSummary,
  NetworkResponseBody,
  SearchEngineId,
  TabSleepMinutes
} from '../shared/types'
import type { DownloadEntry } from '../shared/downloads'

const api = {
  platform: process.platform,
  browser: {
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
    state: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
    navigate: (input: string, engine?: SearchEngineId): Promise<boolean> => ipcRenderer.invoke('browser:navigate', input, engine),
    setSearchEngine: (engine: SearchEngineId): Promise<void> => ipcRenderer.invoke('browser:search-engine:set', engine),
    getSearchEngine: (): Promise<SearchEngineId> => ipcRenderer.invoke('browser:search-engine:get'),
    getTabSleepMinutes: (): Promise<TabSleepMinutes> => ipcRenderer.invoke('browser:tab-sleep:get'),
    setTabSleepMinutes: (minutes: TabSleepMinutes): Promise<TabSleepMinutes | null> => ipcRenderer.invoke('browser:tab-sleep:set', minutes),
    newTabPage: {
      get: (): Promise<NewTabPageId> => ipcRenderer.invoke('browser:new-tab-page:get'),
      set: (page: NewTabPageId): Promise<NewTabPageId | null> => ipcRenderer.invoke('browser:new-tab-page:set', page)
    },
    newTabBackgrounds: {
      get: (): Promise<NewTabBackground[]> => ipcRenderer.invoke('browser:new-tab-backgrounds:get'),
      refresh: (): Promise<NewTabBackgroundRefreshResult> => ipcRenderer.invoke('browser:new-tab-backgrounds:refresh'),
      onChange: (callback: (backgrounds: NewTabBackground[]) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, backgrounds: NewTabBackground[]): void => callback(backgrounds)
        ipcRenderer.on('browser:new-tab-backgrounds:changed', listener)
        return () => ipcRenderer.removeListener('browser:new-tab-backgrounds:changed', listener)
      }
    },
    pinnedSites: {
      get: (): Promise<PinnedSite[]> => ipcRenderer.invoke('browser:pinned-sites:get'),
      set: (sites: PinnedSite[]): Promise<PinnedSite[]> => ipcRenderer.invoke('browser:pinned-sites:set', sites)
    },
    siteSettings: {
      get: (origin: string): Promise<BrowserSiteSettings | null> => ipcRenderer.invoke('browser:site-settings:get', origin),
      set: (origin: string, settings: BrowserSiteSettings): Promise<BrowserSiteSettings | null> => ipcRenderer.invoke('browser:site-settings:set', origin, settings)
    },
    pictureInPicture: (): Promise<boolean> => ipcRenderer.invoke('browser:picture-in-picture'),
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
    },
    downloads: {
      get: (): Promise<DownloadEntry[]> => ipcRenderer.invoke('browser:downloads:get'),
      pause: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:downloads:pause', id),
      resume: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:downloads:resume', id),
      cancel: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:downloads:cancel', id),
      remove: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:downloads:remove', id),
      open: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:downloads:open', id),
      reveal: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:downloads:reveal', id),
      onChange: (callback: (downloads: DownloadEntry[]) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, downloads: DownloadEntry[]): void => callback(downloads)
        ipcRenderer.on('browser:downloads:changed', listener)
        return () => ipcRenderer.removeListener('browser:downloads:changed', listener)
      }
    },
    bramble: {
      get: (): Promise<BrambleExtensionState> => ipcRenderer.invoke('browser:bramble:get'),
      checkForUpdates: (): Promise<BrambleExtensionState> => ipcRenderer.invoke('browser:bramble:check-for-updates'),
      installLatest: (): Promise<BrambleExtensionState> => ipcRenderer.invoke('browser:bramble:install-latest'),
      open: (anchor?: BramblePopupAnchor): Promise<BrambleExtensionState> => ipcRenderer.invoke('browser:bramble:open', anchor),
      setup: (): Promise<BrambleExtensionState> => ipcRenderer.invoke('browser:bramble:setup'),
      onChange: (callback: (state: BrambleExtensionState) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, state: BrambleExtensionState): void => callback(state)
        ipcRenderer.on('browser:bramble:changed', listener)
        return () => ipcRenderer.removeListener('browser:bramble:changed', listener)
      }
    },
    network: {
      get: (): Promise<NetworkRequestSummary[]> => ipcRenderer.invoke('browser:network:get'),
      details: (id: string): Promise<NetworkRequestDetails | null> => ipcRenderer.invoke('browser:network:details', id),
      responseBody: (id: string): Promise<{ body: NetworkResponseBody | null; error: string | null }> => ipcRenderer.invoke('browser:network:response-body', id),
      clear: (): Promise<void> => ipcRenderer.invoke('browser:network:clear'),
      onChange: (callback: (requests: NetworkRequestSummary[]) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, requests: NetworkRequestSummary[]): void => callback(requests)
        ipcRenderer.on('browser:network:changed', listener)
        return () => ipcRenderer.removeListener('browser:network:changed', listener)
      }
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
export type PreloadAPI = typeof api
