import { ipcRenderer } from 'electron'
import type { EffectiveRoute, ProxyRoute, ProxyRoutingSettings, ProxyRoutingState, SiteRouteState } from '../shared/proxy-routing'
import type { NetworkCopyResult, NetworkHarExportResult, NetworkOverrideRule, NetworkOverridesState, NetworkReplayResult } from '../shared/network-overrides'

/** Spread into window.api.browser.proxy: per-site routing rules and named proxies. */
export const proxyRoutingApi = {
  routing: {
    get: (): Promise<ProxyRoutingState> => ipcRenderer.invoke('browser:proxy:routing:get'),
    set: (routing: ProxyRoutingSettings): Promise<ProxyRoutingState> => ipcRenderer.invoke('browser:proxy:routing:set', routing),
    onChange: (callback: (state: ProxyRoutingState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ProxyRoutingState): void => callback(state)
      ipcRenderer.on('browser:proxy:routing-changed', listener)
      return () => ipcRenderer.removeListener('browser:proxy:routing-changed', listener)
    }
  },
  routeFor: (url: string): Promise<EffectiveRoute | null> => ipcRenderer.invoke('browser:proxy:route-for', url),
  siteRoute: {
    get: (url: string): Promise<SiteRouteState | null> => ipcRenderer.invoke('browser:proxy:site-route:get', url),
    set: (url: string, choice: ProxyRoute | 'default'): Promise<SiteRouteState | null> => ipcRenderer.invoke('browser:proxy:site-route:set', url, choice)
  }
}

/** Spread into window.api.browser.network: HAR export, copy as, replay, overrides. */
export const networkToolsApi = {
  exportHar: (options: { tabId: string | null; includeBodies: boolean }): Promise<NetworkHarExportResult> => ipcRenderer.invoke('browser:network:export-har', options),
  copyAs: (id: string, format: 'curl' | 'fetch'): Promise<NetworkCopyResult> => ipcRenderer.invoke('browser:network:copy-as', id, format),
  replay: (id: string): Promise<NetworkReplayResult> => ipcRenderer.invoke('browser:network:replay', id),
  overrides: {
    get: (): Promise<NetworkOverridesState> => ipcRenderer.invoke('browser:network:overrides:get'),
    set: (rules: NetworkOverrideRule[]): Promise<NetworkOverridesState> => ipcRenderer.invoke('browser:network:overrides:set', rules),
    onChange: (callback: (state: NetworkOverridesState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: NetworkOverridesState): void => callback(state)
      ipcRenderer.on('browser:network:overrides-changed', listener)
      return () => ipcRenderer.removeListener('browser:network:overrides-changed', listener)
    }
  }
}
