import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from '../shared/config'
import { registerIpc } from './ipc'
import { initializeBrowserProxy } from './proxy'
import { createWindow, showWindow } from './window'

if (!app.requestSingleInstanceLock()) app.quit()
app.whenReady().then(async () => {
  try {
    // Set the browser session's proxy before any remote page is created.
    await initializeBrowserProxy()
  } catch (error) {
    console.error('Could not initialize the browser proxy session:', error)
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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error('App startup failed:', error)
  app.quit()
})
app.on('second-instance', () => showWindow())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
