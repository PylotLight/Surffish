import { app, BaseWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME } from '../shared/config'
import { registerIpc } from './ipc'
import { initializeBrowserProxy } from './proxy'
import { createWindow, setMainWindowCloseHandler, showWindow } from './window'
import { setBrowserSearchEngine } from './browser'
import { getBrowserSearchEngine } from './browser-persistence'
import { initializeSessionCookiePersistence } from './session-cookies'
import { disposeBramblePoc, initializeBramblePoc } from './bramble-poc'
import { initializeDownloads } from './downloads'

app.setName(APP_NAME)
// Keep the established profile directory when it exists; leave explicit test/custom profile paths untouched.
const appDataPath = app.getPath('appData')
const legacyUserDataPath = join(appDataPath, 'sockfish')
const currentUserDataPath = resolve(app.getPath('userData')).toLowerCase()
const newUserDataPath = resolve(appDataPath, APP_NAME).toLowerCase()
if (currentUserDataPath === newUserDataPath && existsSync(legacyUserDataPath)) {
  app.setPath('userData', legacyUserDataPath)
}

if (!app.requestSingleInstanceLock()) app.quit()
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
  electronApp.setAppUserModelId(APP_ID)
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerIpc()
  setBrowserSearchEngine(getBrowserSearchEngine())
  setMainWindowCloseHandler(disposeBramblePoc)
  createWindow()
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
app.on('second-instance', () => showWindow())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', disposeBramblePoc)
