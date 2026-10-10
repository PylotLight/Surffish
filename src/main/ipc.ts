import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  activateBrowserTab,
  browserBack,
  browserForward,
  browserReload,
  browserStop,
  browserPictureInPicture,
  closeBrowserTab,
  getBrowserState,
  getBrowserTabs,
  getBrowserRuntimeDiagnostics,
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
import { checkForBrambleUpdates, getBramblePocState, installLatestBramble, isBrambleUiWindow, openBramblePoc, openBrambleSetup } from './bramble-poc'
import { clearNetworkRequests, getNetworkRequestDetails, getNetworkRequests, getNetworkResponseBody } from './network-inspector'
import type { BramblePopupAnchor } from '../shared/types'
import {
  getBrowserNewTabPage,
  getBrowserPinnedSites,
  getBrowserSiteSettings,
  getBrowserSearchEngine,
  getBrowserTabSleepMinutes,
  saveBrowserNewTabPage,
  saveBrowserPinnedSites,
  saveBrowserSiteSettings,
  saveBrowserSearchEngine,
  saveBrowserTabSleepMinutes
} from './browser-persistence'

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (event.sender !== getMainWindow()?.webContents) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

function parseBramblePopupAnchor(value: unknown): BramblePopupAnchor | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const anchor = value as Record<string, unknown>
  if (![anchor.x, anchor.y, anchor.width, anchor.height].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) return undefined
  if ((anchor.width as number) <= 0 || (anchor.height as number) <= 0) return undefined
  return {
    x: anchor.x as number,
    y: anchor.y as number,
    width: anchor.width as number,
    height: anchor.height as number
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
  ipcMain.handle('browser:new-tab-page:get', (event) => {
    assertMainRenderer(event)
    return getBrowserNewTabPage()
  })
  ipcMain.handle('browser:new-tab-page:set', (event, value: unknown) => {
    assertMainRenderer(event)
    return saveBrowserNewTabPage(value)
  })
  ipcMain.handle('browser:pinned-sites:get', (event) => {
    assertMainRenderer(event)
    return getBrowserPinnedSites()
  })
  ipcMain.handle('browser:pinned-sites:set', (event, value: unknown) => {
    assertMainRenderer(event)
    return saveBrowserPinnedSites(value)
  })
  ipcMain.handle('browser:site-settings:get', (event, origin: unknown) => {
    assertMainRenderer(event)
    return getBrowserSiteSettings(origin)
  })
  ipcMain.handle('browser:site-settings:set', (event, origin: unknown, settings: unknown) => {
    assertMainRenderer(event)
    return saveBrowserSiteSettings(origin, settings)
  })
  ipcMain.handle('browser:runtime:get', async (event) => {
    assertMainRenderer(event)
    return getBrowserRuntimeDiagnostics()
  })
  ipcMain.handle('app:quit', (event) => {
    assertMainRenderer(event)
    app.quit()
  })
  ipcMain.handle('browser:bramble:get', (event) => {
    assertMainRenderer(event)
    return getBramblePocState()
  })
  ipcMain.handle('browser:bramble:check-for-updates', async (event) => {
    assertMainRenderer(event)
    return checkForBrambleUpdates()
  })
  ipcMain.handle('browser:bramble:install-latest', async (event) => {
    assertMainRenderer(event)
    return installLatestBramble()
  })
  ipcMain.handle('browser:bramble:open', async (event, anchor: unknown) => {
    assertMainRenderer(event)
    return openBramblePoc(parseBramblePopupAnchor(anchor))
  })
  ipcMain.handle('browser:bramble:setup', async (event) => {
    assertMainRenderer(event)
    return openBrambleSetup()
  })
  ipcMain.handle('browser:bramble:open-options-from-ui', async (event) => {
    if (!isBrambleUiWindow(BrowserWindow.fromWebContents(event.sender))) {
      throw new Error('Only a Bramble UI window can open Bramble Setup/Restore.')
    }
    await openBrambleSetup()
    return true
  })
  ipcMain.handle('browser:back', (event) => { assertMainRenderer(event); browserBack() })
  ipcMain.handle('browser:forward', (event) => { assertMainRenderer(event); browserForward() })
  ipcMain.handle('browser:reload', (event) => { assertMainRenderer(event); browserReload() })
  ipcMain.handle('browser:stop', (event) => { assertMainRenderer(event); browserStop() })
  ipcMain.handle('browser:picture-in-picture', (event) => { assertMainRenderer(event); return browserPictureInPicture() })
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
