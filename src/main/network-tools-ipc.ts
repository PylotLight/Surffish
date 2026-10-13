import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isMainWindowRenderer } from './browser-shell'
import { getEffectiveRoute, getProxyRoutingState, getSiteRoute, setProxyRouting, setSiteRoute } from './proxy'
import {
  copyNetworkRequestAs,
  exportNetworkHar,
  getNetworkOverridesState,
  initializeNetworkTools,
  replayNetworkRequest,
  setNetworkOverrides
} from './network-tools'

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertMainRenderer(event)
    return listener(event, ...args)
  })
}

/** Per-site proxy routing (Settings → Network rules, site panel) and the Network inspector tools. */
export function registerNetworkToolsIpc(): void {
  initializeNetworkTools()
  handle('browser:proxy:routing:get', () => getProxyRoutingState())
  handle('browser:proxy:routing:set', (_event, routing) => setProxyRouting(routing))
  handle('browser:proxy:route-for', (_event, url) => typeof url === 'string' ? getEffectiveRoute(url) : null)
  handle('browser:proxy:site-route:get', (_event, url) => typeof url === 'string' ? getSiteRoute(url) : null)
  handle('browser:proxy:site-route:set', (_event, url, choice) => setSiteRoute(url, choice))
  handle('browser:network:export-har', (event, options) => exportNetworkHar(event.sender, options))
  handle('browser:network:copy-as', (_event, id, format) => copyNetworkRequestAs(id, format))
  handle('browser:network:replay', (_event, id) => replayNetworkRequest(id))
  handle('browser:network:overrides:get', () => getNetworkOverridesState())
  handle('browser:network:overrides:set', (_event, rules) => setNetworkOverrides(rules))
}
