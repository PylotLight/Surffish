import { app, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import * as os from 'node:os'
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
import { getGlassState, getMainWindow, setGlassVibrancy, showWindow } from './window'
import type { GlassState, SysInfo, VibrancyName } from '../shared/types'

const isMac = process.platform === 'darwin'
const VIBRANCY_OPTIONS: readonly VibrancyName[] = [
  'fullscreen-ui', 'under-window', 'sidebar', 'hud', 'content', 'popover', 'menu', 'titlebar'
]

function notify(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false
  new Notification({ title, body }).show()
  return true
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (event.sender !== getMainWindow()?.webContents) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

export function registerIpc(): void {
  ipcMain.handle('ping', () => 'pong')
  ipcMain.handle('sys:info', (): SysInfo => ({
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMem: os.totalmem(),
    freeMem: os.freemem()
  }))
  ipcMain.handle('notify:send', (_event: IpcMainInvokeEvent, payload: { title: string; body: string }): boolean =>
    notify(payload.title, payload.body)
  )
  ipcMain.handle('dock:set-badge', (_event: IpcMainInvokeEvent, count: number): boolean => {
    if (isMac) app.setBadgeCount(count)
    return isMac
  })
  ipcMain.handle('win:hide', () => getMainWindow()?.hide())
  ipcMain.handle('win:show', () => showWindow())
  ipcMain.handle('win:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('win:flash', () => getMainWindow()?.flashFrame(true))

  ipcMain.handle('app:hide', (): boolean => {
    if (isMac) app.hide()
    else getMainWindow()?.hide()
    return true
  })
  ipcMain.handle('dock:hide', (): boolean => {
    if (isMac) app.dock?.hide()
    return isMac
  })
  ipcMain.handle('dock:show', (): boolean => {
    if (isMac) app.dock?.show()
    return isMac
  })

  ipcMain.handle('glass:get', (): GlassState => getGlassState())
  ipcMain.handle('glass:set', (_event: IpcMainInvokeEvent, name: VibrancyName | null): GlassState => {
    if (name !== null && !VIBRANCY_OPTIONS.includes(name)) return getGlassState()
    return setGlassVibrancy(name)
  })
  ipcMain.handle('glass:options', (): readonly VibrancyName[] => VIBRANCY_OPTIONS)
  ipcMain.handle('shell:open', (_event: IpcMainInvokeEvent, url: string): boolean => {
    if (!url.startsWith('https://')) return false
    void shell.openExternal(url)
    return true
  })

  ipcMain.handle('browser:state', (event) => {
    assertMainRenderer(event)
    return getBrowserState()
  })
  ipcMain.handle('browser:navigate', (event, url: string) => {
    assertMainRenderer(event)
    return typeof url === 'string' ? navigateBrowser(url) : false
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

  ipcMain.handle('app:quit', () => app.quit())
}
