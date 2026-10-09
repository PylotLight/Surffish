import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserBounds,
  BrowserProxySettings,
  BrowserProxyTestResult,
  BrowserState
} from '../shared/types'

const api = {
  platform: process.platform,
  browser: {
    state: (): Promise<BrowserState> => ipcRenderer.invoke('browser:state'),
    navigate: (input: string): Promise<boolean> => ipcRenderer.invoke('browser:navigate', input),
    back: (): Promise<void> => ipcRenderer.invoke('browser:back'),
    forward: (): Promise<void> => ipcRenderer.invoke('browser:forward'),
    reload: (): Promise<void> => ipcRenderer.invoke('browser:reload'),
    stop: (): Promise<void> => ipcRenderer.invoke('browser:stop'),
    setBounds: (bounds: BrowserBounds): Promise<void> => ipcRenderer.invoke('browser:set-bounds', bounds),
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
