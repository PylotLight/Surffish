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
