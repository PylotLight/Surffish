import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  activateBrowserTab,
  browserBack,
  browserForward,
  browserReload,
  browserStop,
  browserPictureInPicture,
  updateBrowserTrackpadScrollEdges,
  updateBrowserPageScale,
  closeBrowserTab,
  setBrowserTabMuted,
  newPrivateBrowserTab,
  moveBrowserTab,
  getBrowserState,
  getBrowserTabs,
  navigateBrowser,
  newBrowserTab,
  isBrambleExtensionTab,
  setBrowserTabSleepMinutes,
  setBrowserSearchEngine,
  setBrowserBounds,
  shouldPauseBackgroundYouTubeAutoplay,
  closeFindBar,
  getBrowserFindState,
  setBrowserFindQuery,
  stepFind,
  zoomActiveBrowserTab,
  togglePdfEditor,
  dismissActiveLoadError,
  activeTabHasLoadError,
  getActiveTabWebContents
} from './browser'
import { certificateInfoFor, proceedPastCertificateError, showNativeCertificate } from './certificates'
import { isSearchEngineId } from '../shared/navigation'
import { registerCommandIpc } from './command-ipc'
import { clearBrowsingHistory, getBrowsingHistory } from './history'
import { getBrowserProxySettings, setBrowserProxySettings, testLocalProxy } from './proxy'
import { getDefaultBrowserStatus, makeDefaultBrowser } from './external-links'
import { forgetArchivedTabsSince } from './tab-archive-store'
import {
  getBrowserChromeState,
  isMainWindowRenderer,
  isToolbarRenderer,
  sendToMainWindowRenderers,
  setBrowserChromeMetrics,
  setBrowserChromeState
} from './browser-shell'
import { cancelDownload, getDownloadHistory, openDownload, pauseDownload, removeDownload, resumeDownload, revealDownload, clearDownloadHistory, openDownloadsFolder } from './downloads'
import { getNewTabBackgrounds, refreshNewTabBackgrounds } from './new-tab-backgrounds'
import { getNewTabWeather } from './new-tab-weather'
import { brambleTabsCallerForSender, checkForBrambleUpdates, getBramblePocState, installLatestBramble, closeBramblePopoutFromBackground, isBrambleClipboardSource, isBrambleOffscreenSource, isBrambleUiWindow, openBramblePopoutFromBackground, openBrambleOptionsFromUi, openBramblePoc, openBrambleSetup, setBrambleToolbarAnchor, writeBrambleClipboardText } from './bramble-poc'
import {
  checkWebStoreExtensionUpdate,
  getWebStoreExtensionsState,
  installFromStorePage,
  installWebStoreExtension,
  openOptionsFromExtensionPage,
  openWebStoreExtensionOptions,
  openWebStoreExtensionPopup,
  setWebStoreExtensionEnabled,
  uninstallWebStoreExtension,
  webStoreExtensionForSender,
  webStoreTabsCallerForSender
} from './web-store-extensions'
import { handleExtensionTabsCall } from './extension-tabs-host'
import { registerNetworkToolsIpc } from './network-tools-ipc'
import { registerSplitViewIpc } from './split-view-ipc'
import { registerSpacesIpc } from './spaces-ipc'
import { registerSidebarBackdropIpc } from './sidebar-backdrop'
import { registerBookmarksBarIpc } from './bookmarks-bar'
import { registerTabGroupsIpc } from './tab-groups-ipc'
import { registerTabSelectionIpc } from './tab-selection'
import { clearNetworkRequests, getNetworkRequestDetails, getNetworkRequests, getNetworkResponseBody, watchNetworkRequests, disableNetworkCapture } from './network-inspector'
import type { BramblePopupAnchor } from '../shared/types'
import { getMainWindow } from './window'
import { registerSafetyIpc } from './safety'
import {
  clearSavedBrowserSession,
  getBrowserNewTabPage,
  getBrowserSiteFaviconCache,
  getBrowserPinnedSites,
  getBrowserSiteSettings,
  getBrowserSearchEngine,
  getBrowserPreferencesSnapshot,
  getBrowserTabSleepMinutes,
  saveBrowserNewTabPage,
  saveBrowserPinnedSites,
  saveBrowserSiteSettings,
  saveBrowserSearchEngine,
  saveBrowserTabSleepMinutes,
  saveBrowserNewTabPreferences,
  saveBrowserSidebarWidth
} from './browser-persistence'

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
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
  registerSafetyIpc()
  registerCommandIpc()
  registerNetworkToolsIpc()
  registerSplitViewIpc()
  registerSpacesIpc()
  registerSidebarBackdropIpc()
  registerBookmarksBarIpc()
  registerTabGroupsIpc()
  registerTabSelectionIpc()
  ipcMain.on('browser:background-youtube-autoplay:policy', (event) => {
    event.returnValue = event.senderFrame === event.sender.mainFrame && shouldPauseBackgroundYouTubeAutoplay(event.sender)
  })
  ipcMain.on('browser:mac-trackpad-swipe:scroll-edge', (event, edges: unknown) => {
    if (process.platform === 'darwin' && event.senderFrame === event.sender.mainFrame) {
      updateBrowserTrackpadScrollEdges(event.sender, edges)
    }
  })
  ipcMain.on('browser:mac-trackpad-swipe:page-scale', (event, scale: unknown) => {
    if (process.platform === 'darwin' && event.senderFrame === event.sender.mainFrame) {
      updateBrowserPageScale(event.sender, scale)
    }
  })
  ipcMain.handle('browser:preferences:get', (event) => {
    assertMainRenderer(event)
    return getBrowserPreferencesSnapshot()
  })
  ipcMain.handle('browser:site-icons:get', (event, origins: unknown) => {
    assertMainRenderer(event)
    return getBrowserSiteFaviconCache(origins)
  })
  ipcMain.handle('browser:chrome:get', (event) => {
    assertMainRenderer(event)
    return getBrowserChromeState()
  })
  ipcMain.handle('browser:chrome:set', (event, state: unknown) => {
    assertMainRenderer(event)
    return setBrowserChromeState(state)
  })
  ipcMain.handle('browser:chrome:metrics', (event, metrics: unknown) => {
    assertMainRenderer(event)
    if (!isToolbarRenderer(event.sender)) throw new Error('Only the toolbar surface can report native toolbar metrics.')
    return setBrowserChromeMetrics(metrics)
  })
  ipcMain.handle('browser:sidebar-width:set', (event, value: unknown) => {
    assertMainRenderer(event)
    const width = saveBrowserSidebarWidth(value)
    setBrowserChromeState({ sidebarWidth: width })
    sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
    return width
  })
  ipcMain.handle('browser:state', (event) => {
    assertMainRenderer(event)
    return getBrowserState()
  })
  ipcMain.handle('browser:session:clear', (event) => {
    assertMainRenderer(event)
    return clearSavedBrowserSession()
  })
  ipcMain.handle('browser:tabs:get', (event) => {
    assertMainRenderer(event)
    return getBrowserTabs()
  })
  ipcMain.handle('browser:tabs:new', (event, input?: string, engine?: unknown) => {
    assertMainRenderer(event)
    return newBrowserTab(typeof input === 'string' ? input : undefined, isSearchEngineId(engine) ? engine : undefined)
  })
  ipcMain.handle('browser:tabs:new-private', (event, input?: unknown) => {
    assertMainRenderer(event)
    return newPrivateBrowserTab(typeof input === 'string' ? input : undefined)
  })
  ipcMain.handle('browser:tabs:activate', (event, id: string) => {
    assertMainRenderer(event)
    return typeof id === 'string' && activateBrowserTab(id)
  })
  ipcMain.handle('browser:tabs:close', (event, id: string) => {
    assertMainRenderer(event)
    if (typeof id === 'string') closeBrowserTab(id)
  })
  ipcMain.handle('browser:tabs:mute', (event, id: unknown, muted: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && typeof muted === 'boolean' && setBrowserTabMuted(id, muted)
  })
  ipcMain.handle('browser:tabs:move', (event, id: unknown, beforeId: unknown) => {
    assertMainRenderer(event)
    if (typeof id !== 'string' || (beforeId !== null && typeof beforeId !== 'string')) return false
    return moveBrowserTab(id, beforeId)
  })
  ipcMain.handle('browser:navigate', (event, input: string, engine?: unknown) => {
    assertMainRenderer(event)
    return typeof input === 'string' ? navigateBrowser(input, isSearchEngineId(engine) ? engine : undefined) : { ok: false, reason: 'invalid' }
  })
  ipcMain.handle('browser:search-engine:set', (event, engine: unknown) => {
    assertMainRenderer(event)
    if (isSearchEngineId(engine)) {
      setBrowserSearchEngine(engine)
      saveBrowserSearchEngine(engine)
      sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
    }
  })
  ipcMain.handle('browser:search-engine:get', (event) => {
    assertMainRenderer(event)
    return getBrowserSearchEngine()
  })
  ipcMain.handle('browser:default-browser:get', (event) => {
    assertMainRenderer(event)
    return getDefaultBrowserStatus()
  })
  ipcMain.handle('browser:default-browser:set', (event) => {
    assertMainRenderer(event)
    return makeDefaultBrowser()
  })
  ipcMain.handle('browser:tab-sleep:get', (event) => {
    assertMainRenderer(event)
    return getBrowserTabSleepMinutes()
  })
  ipcMain.handle('browser:tab-sleep:set', (event, value: unknown) => {
    assertMainRenderer(event)
    const saved = setBrowserTabSleepMinutes(value)
    if (saved !== null) {
      saveBrowserTabSleepMinutes(saved)
      sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
    }
    return saved
  })
  ipcMain.handle('browser:new-tab-page:get', (event) => {
    assertMainRenderer(event)
    return getBrowserNewTabPage()
  })
  ipcMain.handle('browser:new-tab-page:set', (event, value: unknown) => {
    assertMainRenderer(event)
    const saved = saveBrowserNewTabPage(value)
    if (saved) sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
    return saved
  })
  ipcMain.handle('browser:new-tab-preferences:set', (event, value: unknown) => {
    assertMainRenderer(event)
    const saved = saveBrowserNewTabPreferences(value)
    if (saved) sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
    return saved
  })
  ipcMain.handle('browser:new-tab-weather:get', async (event, location: unknown) => {
    assertMainRenderer(event)
    if (typeof location !== 'string') throw new Error('Enter a city or town to load weather.')
    return getNewTabWeather(location)
  })
  ipcMain.handle('browser:new-tab-backgrounds:get', (event) => {
    assertMainRenderer(event)
    return getNewTabBackgrounds()
  })
  ipcMain.handle('browser:new-tab-backgrounds:refresh', (event) => {
    assertMainRenderer(event)
    return refreshNewTabBackgrounds(true)
  })
  ipcMain.handle('browser:pinned-sites:get', (event) => {
    assertMainRenderer(event)
    return getBrowserPinnedSites()
  })
  ipcMain.handle('browser:pinned-sites:set', (event, value: unknown) => {
    assertMainRenderer(event)
    const saved = saveBrowserPinnedSites(value)
    sendToMainWindowRenderers('browser:preferences-changed', getBrowserPreferencesSnapshot())
    return saved
  })
  ipcMain.handle('browser:site-settings:get', (event, origin: unknown) => {
    assertMainRenderer(event)
    return getBrowserSiteSettings(origin)
  })
  ipcMain.handle('browser:site-settings:set', (event, origin: unknown, settings: unknown) => {
    assertMainRenderer(event)
    return saveBrowserSiteSettings(origin, settings)
  })
  ipcMain.handle('browser:downloads:get', (event) => {
    assertMainRenderer(event)
    return getDownloadHistory()
  })
  ipcMain.handle('browser:downloads:pause', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && pauseDownload(id)
  })
  ipcMain.handle('browser:downloads:resume', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && resumeDownload(id)
  })
  ipcMain.handle('browser:downloads:cancel', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && cancelDownload(id)
  })
  ipcMain.handle('browser:downloads:remove', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && removeDownload(id)
  })
  ipcMain.handle('browser:downloads:open', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' ? openDownload(id) : false
  })
  ipcMain.handle('browser:downloads:clear', (event) => {
    assertMainRenderer(event)
    return clearDownloadHistory()
  })
  ipcMain.handle('browser:downloads:open-folder', (event) => {
    assertMainRenderer(event)
    return openDownloadsFolder()
  })
  ipcMain.handle('browser:downloads:reveal', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && revealDownload(id)
  })
  ipcMain.handle('app:quit', (event) => {
    assertMainRenderer(event)
    app.quit()
  })
  ipcMain.handle('app:window-control', (event, action: unknown) => {
    assertMainRenderer(event)
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return false
    if (action === 'close') window.close()
    else if (action === 'minimize') window.minimize()
    else if (action === 'toggle-zoom') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else return false
    return true
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
  ipcMain.on('browser:bramble:anchor', (event, anchor: unknown) => {
    if (!isMainWindowRenderer(event.sender, event.senderFrame)) return
    setBrambleToolbarAnchor(parseBramblePopupAnchor(anchor))
  })
  ipcMain.handle('browser:bramble:setup', async (event) => {
    assertMainRenderer(event)
    return openBrambleSetup()
  })
  ipcMain.handle('browser:bramble:open-options-from-ui', async (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    if (!isBrambleUiWindow(sourceWindow) && !isBrambleExtensionTab(event.sender)) {
      throw new Error('Only a Bramble UI window can open Bramble Setup/Restore.')
    }
    await openBrambleOptionsFromUi(sourceWindow, event.sender)
    return true
  })
  ipcMain.handle('browser:bramble:popout-open', async (event, url: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    if (event.senderFrame !== event.sender.mainFrame || !isBrambleOffscreenSource(sourceWindow, event.sender)) {
      throw new Error('Only Bramble’s background host can open the Bramble pop-out.')
    }
    await openBramblePopoutFromBackground(typeof url === 'string' ? url : '')
    return true
  })
  ipcMain.handle('browser:bramble:popout-close', (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    if (event.senderFrame !== event.sender.mainFrame || !isBrambleOffscreenSource(sourceWindow, event.sender)) {
      throw new Error('Only Bramble’s background host can close the Bramble pop-out.')
    }
    closeBramblePopoutFromBackground()
    return true
  })
  ipcMain.handle('browser:bramble:clipboard-write', (event, value: unknown) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender)
    if (event.senderFrame !== event.sender.mainFrame || !isBrambleClipboardSource(sourceWindow, event.sender)) {
      throw new Error('Only a Bramble extension UI page can write to the clipboard.')
    }
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 1024 * 1024) {
      throw new Error('The Bramble clipboard text is invalid or exceeds the allowed size.')
    }
    writeBrambleClipboardText(value)
    return true
  })
  // Quick unlock (PIN / Touch ID) for Bramble: the module loads on the first call, never at startup.
  const quickUnlock = (): Promise<typeof import('./bramble-quick-unlock')> => import('./bramble-quick-unlock')
  ipcMain.handle('browser:bramble:quick-unlock:get', async (event) => {
    assertMainRenderer(event)
    return (await quickUnlock()).getQuickUnlockState()
  })
  ipcMain.handle('browser:bramble:quick-unlock:enrol', async (event, input: unknown) => {
    assertMainRenderer(event)
    return (await quickUnlock()).enrolQuickUnlock(input)
  })
  ipcMain.handle('browser:bramble:quick-unlock:disable', async (event) => {
    assertMainRenderer(event)
    return (await quickUnlock()).disableQuickUnlock()
  })
  ipcMain.handle('browser:bramble:quick-unlock:set-touch-id', async (event, enabled: unknown) => {
    assertMainRenderer(event)
    return (await quickUnlock()).setQuickUnlockTouchId(enabled)
  })
  ipcMain.handle('browser:bramble:quick-unlock:set-require-master', async (event, input: unknown) => {
    assertMainRenderer(event)
    return (await quickUnlock()).setQuickUnlockRequireMaster(input)
  })
  ipcMain.handle('browser:extensions:get', (event) => {
    assertMainRenderer(event)
    return getWebStoreExtensionsState()
  })
  ipcMain.handle('browser:extensions:install', async (event, input: unknown) => {
    assertMainRenderer(event)
    return installWebStoreExtension(input)
  })
  ipcMain.handle('browser:extensions:set-enabled', async (event, id: unknown, enabled: unknown) => {
    assertMainRenderer(event)
    return setWebStoreExtensionEnabled(id, enabled)
  })
  ipcMain.handle('browser:extensions:uninstall', async (event, id: unknown) => {
    assertMainRenderer(event)
    return uninstallWebStoreExtension(id)
  })
  ipcMain.handle('browser:extensions:check-update', async (event, id: unknown) => {
    assertMainRenderer(event)
    return checkWebStoreExtensionUpdate(id)
  })
  ipcMain.handle('browser:extensions:open-popup', (event, id: unknown, anchor: unknown) => {
    assertMainRenderer(event)
    return openWebStoreExtensionPopup(id, parseBramblePopupAnchor(anchor))
  })
  ipcMain.handle('browser:extensions:open-options', (event, id: unknown) => {
    assertMainRenderer(event)
    return openWebStoreExtensionOptions(id)
  })
  // chrome.tabs from an extension's own popup/options page: Web Store extensions (extension-host.cjs)
  // and Bramble (bramble-poc.cjs). Each owner checks the sender is one of its extension's pages.
  ipcMain.handle('browser:extensions:host-tabs', (event, op: unknown, payload: unknown) => {
    const caller = webStoreTabsCallerForSender(event.sender, event.senderFrame) ?? brambleTabsCallerForSender(event.sender, event.senderFrame)
    if (!caller) throw new Error('Only an installed extension’s own page can use this bridge.')
    return handleExtensionTabsCall(caller, op, payload)
  })
  ipcMain.handle('browser:extensions:host-options', (event) => {
    const entry = webStoreExtensionForSender(event.sender, event.senderFrame)
    if (!entry) throw new Error('Only an installed extension’s own page can use this bridge.')
    return openOptionsFromExtensionPage(entry)
  })
  // "Add to Surffish" on a chromewebstore.google.com detail page (web-store-page.cjs).
  ipcMain.handle('browser:extensions:store-page-install', async (event) => {
    await installFromStorePage(event.sender, event.senderFrame)
    return true
  })
  ipcMain.handle('browser:back', (event) => { assertMainRenderer(event); browserBack() })
  ipcMain.handle('browser:forward', (event) => { assertMainRenderer(event); browserForward() })
  ipcMain.handle('browser:reload', (event) => { assertMainRenderer(event); browserReload() })
  ipcMain.handle('browser:stop', (event) => { assertMainRenderer(event); browserStop() })
  ipcMain.handle('browser:load-error:dismiss', (event) => { assertMainRenderer(event); return dismissActiveLoadError() })
  ipcMain.handle('browser:certificate:info', (event) => {
    assertMainRenderer(event)
    return certificateInfoFor(getActiveTabWebContents(), activeTabHasLoadError())
  })
  ipcMain.handle('browser:certificate:proceed', async (event) => {
    assertMainRenderer(event)
    const url = proceedPastCertificateError(getActiveTabWebContents())
    if (!url) return false
    await navigateBrowser(url)
    return true
  })
  ipcMain.handle('browser:certificate:show-native', (event) => {
    assertMainRenderer(event)
    return showNativeCertificate(getActiveTabWebContents(), activeTabHasLoadError())
  })
  ipcMain.handle('browser:zoom', (event, action: unknown) => { assertMainRenderer(event); zoomActiveBrowserTab(action) })
  ipcMain.handle('browser:find:get', (event) => { assertMainRenderer(event); return getBrowserFindState() })
  ipcMain.handle('browser:find:query', (event, text: unknown) => { assertMainRenderer(event); setBrowserFindQuery(text) })
  ipcMain.handle('browser:find:step', (event, forward: unknown) => { assertMainRenderer(event); stepFind(forward !== false) })
  ipcMain.handle('browser:find:close', (event) => { assertMainRenderer(event); closeFindBar() })
  ipcMain.handle('browser:pdf-editor:toggle', (event) => { assertMainRenderer(event); return togglePdfEditor() })
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
    forgetArchivedTabsSince(0)
    sendToMainWindowRenderers('browser:history-changed')
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
  ipcMain.handle('browser:network:get', (event) => {
    assertMainRenderer(event)
    return getNetworkRequests()
  })
  ipcMain.handle('browser:network:watch', (event, watching: unknown) => {
    assertMainRenderer(event)
    return watchNetworkRequests(watching === true)
  })
  ipcMain.handle('browser:network:disable', (event) => {
    assertMainRenderer(event)
    disableNetworkCapture()
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
