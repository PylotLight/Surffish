import { app, BaseWindow } from 'electron'
import { APP_ID, APP_NAME } from '../shared/config'
import { registerIpc } from './ipc'
import { initializeBrowserProxy } from './proxy'
import { createWindow, setMainWindowCloseHandler } from './window'
import { setBrowserSearchEngine } from './browser'
import { getBrowserSearchEngine } from './browser-persistence'
import { initializeSessionCookiePersistence } from './session-cookies'
import { disposeBramblePoc, initializeBramblePoc } from './bramble-poc'
import { initializeDownloads } from './downloads'
import { installAppMenu } from './app-menu'
import { flushExternalOpens, registerExternalOpenHandlers } from './external-links'
import { disposeWebStoreExtensions, initializeWebStoreExtensions } from './web-store-extensions'
import { registerPdfEditorScheme } from './pdf-editor'
import { disposeUpdates, initializeUpdates, registerUpdateIpc } from './updates'

app.setName(APP_NAME)
// Privileged schemes must be registered before ready.
registerPdfEditorScheme()
// Bound Chromium's HTTP cache (default grows with free disk space) so the profile stays lean.
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024))

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
// Default-browser links and opened files can arrive before ready; they queue until tabs exist.
else registerExternalOpenHandlers()
app.whenReady().then(async () => {
  if (!app.isPackaged) console.info('Surffish browser profile:', app.getPath('userData'))
  try {
    // Set the browser session's proxy before any remote page is created.
    await initializeBrowserProxy()
    await initializeSessionCookiePersistence()
    initializeDownloads()
  } catch (error) {
    console.error('Could not initialize the browser profile:', error)
    app.quit()
    return
  }
  const originalSecurityWarnings = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
  let initializeNetworkAdblock: (() => Promise<void>) | undefined
  try {
    // The adapter sets this environment variable as an import side effect.
    // Restore the app's previous setting before any windows are created.
    const adblock = await import('./adblock')
    initializeNetworkAdblock = adblock.initializeNetworkAdblock
  } catch (error) {
    console.warn('Could not load the network ad-filter adapter; continuing without it:', error)
  } finally {
    if (originalSecurityWarnings === undefined) delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
    else process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = originalSecurityWarnings
  }
  try {
    await initializeNetworkAdblock?.()
  } catch (error) {
    console.warn('Could not initialize network ad filtering; continuing without it:', error)
  }
  // Windows taskbar grouping/notifications; dev builds group under the Electron binary.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)
  registerIpc()
  registerUpdateIpc()
  installAppMenu()
  setBrowserSearchEngine(getBrowserSearchEngine())
  setMainWindowCloseHandler(() => {
    disposeBramblePoc()
    disposeWebStoreExtensions()
  })
  try {
    // Load Chrome Web Store extensions before restored tabs load, so content scripts apply.
    await initializeWebStoreExtensions()
  } catch (error) {
    console.warn('Could not load Chrome Web Store extensions; continuing without them:', error)
  }
  createWindow()
  flushExternalOpens()
  // Release-feed update notifications: first check ~30s after launch, then every 6h.
  initializeUpdates()
  try {
    await initializeBramblePoc()
  } catch (error) {
    console.warn('Could not initialize the Bramble extension; continuing without it:', error)
  }
  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error('App startup failed:', error)
  app.quit()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  disposeUpdates()
  disposeBramblePoc()
  disposeWebStoreExtensions()
})
