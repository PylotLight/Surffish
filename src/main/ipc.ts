import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  browserBack,
  browserForward,
  browserReload,
  browserStop,
  getBrowserState,
  navigateBrowser,
  setBrowserBounds
} from './browser'
import { getBrowserProxySettings, setBrowserProxySettings, testLocalProxy } from './proxy'
import { getMainWindow } from './window'

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
  ipcMain.handle('browser:navigate', (event, input: string) => {
    assertMainRenderer(event)
    return typeof input === 'string' ? navigateBrowser(input) : false
  })
  ipcMain.handle('browser:back', (event) => { assertMainRenderer(event); browserBack() })
  ipcMain.handle('browser:forward', (event) => { assertMainRenderer(event); browserForward() })
  ipcMain.handle('browser:reload', (event) => { assertMainRenderer(event); browserReload() })
  ipcMain.handle('browser:stop', (event) => { assertMainRenderer(event); browserStop() })
  ipcMain.handle('browser:set-bounds', (event, bounds: unknown) => {
    assertMainRenderer(event)
    setBrowserBounds(bounds)
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
}
