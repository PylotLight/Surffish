import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  activateBrowserTab,
  browserBack,
  browserForward,
  browserReload,
  browserStop,
  closeBrowserTab,
  getBrowserState,
  getBrowserTabs,
  navigateBrowser,
  newBrowserTab,
  setBrowserTabSleepMinutes,
  setBrowserSearchEngine,
  setBrowserBounds
} from './browser'
import { isSearchEngineId } from '../shared/navigation'
import { clearBrowsingHistory, getBrowsingHistory } from './history'
import { getBrowserProxySettings, setBrowserProxySettings, testLocalProxy } from './proxy'
import { getMainWindow } from './window'
import { clearNetworkRequests, getNetworkRequestDetails, getNetworkRequests, getNetworkResponseBody } from './network-inspector'
import {
  getBrowserSearchEngine,
  getBrowserTabSleepMinutes,
  saveBrowserSearchEngine,
  saveBrowserTabSleepMinutes
} from './browser-persistence'

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (event.sender !== getMainWindow()?.webContents) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

export function registerIpc(): void {
  ipcMain.handle('browser:state', (event) => {
    assertMainRenderer(event)
    return getBrowserState()
  })
  ipcMain.handle('browser:tabs:get', (event) => {
    assertMainRenderer(event)
    return getBrowserTabs()
  })
  ipcMain.handle('browser:tabs:new', (event, input?: string, engine?: unknown) => {
    assertMainRenderer(event)
    return newBrowserTab(typeof input === 'string' ? input : undefined, isSearchEngineId(engine) ? engine : undefined)
  })
  ipcMain.handle('browser:tabs:activate', (event, id: string) => {
    assertMainRenderer(event)
    return typeof id === 'string' && activateBrowserTab(id)
  })
  ipcMain.handle('browser:tabs:close', (event, id: string) => {
    assertMainRenderer(event)
    if (typeof id === 'string') closeBrowserTab(id)
  })
  ipcMain.handle('browser:navigate', (event, input: string, engine?: unknown) => {
    assertMainRenderer(event)
    return typeof input === 'string' ? navigateBrowser(input, isSearchEngineId(engine) ? engine : undefined) : false
  })
  ipcMain.handle('browser:search-engine:set', (event, engine: unknown) => {
    assertMainRenderer(event)
    if (isSearchEngineId(engine)) {
      setBrowserSearchEngine(engine)
      saveBrowserSearchEngine(engine)
    }
  })
  ipcMain.handle('browser:search-engine:get', (event) => {
    assertMainRenderer(event)
    return getBrowserSearchEngine()
  })
  ipcMain.handle('browser:tab-sleep:get', (event) => {
    assertMainRenderer(event)
    return getBrowserTabSleepMinutes()
  })
  ipcMain.handle('browser:tab-sleep:set', (event, value: unknown) => {
    assertMainRenderer(event)
    const saved = setBrowserTabSleepMinutes(value)
    if (saved !== null) saveBrowserTabSleepMinutes(saved)
    return saved
  })
  ipcMain.handle('app:quit', (event) => {
    assertMainRenderer(event)
    app.quit()
  })
  ipcMain.handle('browser:back', (event) => { assertMainRenderer(event); browserBack() })
  ipcMain.handle('browser:forward', (event) => { assertMainRenderer(event); browserForward() })
  ipcMain.handle('browser:reload', (event) => { assertMainRenderer(event); browserReload() })
  ipcMain.handle('browser:stop', (event) => { assertMainRenderer(event); browserStop() })
  ipcMain.handle('browser:set-bounds', (event, bounds: unknown) => {
    assertMainRenderer(event)
    setBrowserBounds(bounds)
  })
  ipcMain.handle('browser:history:get', (event) => {
    assertMainRenderer(event)
    return getBrowsingHistory()
  })
  ipcMain.handle('browser:history:clear', (event) => {
    assertMainRenderer(event)
    clearBrowsingHistory()
    getMainWindow()?.webContents.send('browser:history-changed')
  })
  ipcMain.handle('browser:proxy:get', (event) => {
    assertMainRenderer(event)
    return getBrowserProxySettings()
  })
  ipcMain.handle('browser:proxy:set', (event, settings: unknown) => {
    assertMainRenderer(event)
    return setBrowserProxySettings(settings)
  })
  ipcMain.handle('browser:proxy:test', (event, settings: unknown) => {
    assertMainRenderer(event)
    return testLocalProxy(settings)
  })
  ipcMain.handle('browser:adblock:get', async (event) => {
    assertMainRenderer(event)
    const { getAdblockDiagnostics } = await import('./adblock')
    return getAdblockDiagnostics()
  })
  ipcMain.handle('browser:adblock:refresh', async (event) => {
    assertMainRenderer(event)
    const { refreshNetworkAdblock } = await import('./adblock')
    return refreshNetworkAdblock()
  })
  ipcMain.handle('browser:network:get', (event) => {
    assertMainRenderer(event)
    return getNetworkRequests()
  })
  ipcMain.handle('browser:network:details', async (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' ? getNetworkRequestDetails(id) : null
  })
  ipcMain.handle('browser:network:response-body', async (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string'
      ? getNetworkResponseBody(id)
      : { body: null, error: 'Invalid request identifier.' }
  })
  ipcMain.handle('browser:network:clear', (event) => {
    assertMainRenderer(event)
    clearNetworkRequests()
  })
}
