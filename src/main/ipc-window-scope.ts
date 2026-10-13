import { ipcMain } from 'electron'
import { runInWindow, windowForContents } from './window-scope'

type IpcListener = (event: Electron.IpcMainEvent, ...args: any[]) => void
type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown
let installed = false

/**
 * Scope every IPC handler to the window its sender belongs to. One wrapper here instead of
 * threading a window through ~130 handlers; senders that aren't in a browser window (extension
 * popups, Bramble UI) run unscoped and fall back to the focused window as before.
 */
export function installIpcWindowScope(): void {
  if (installed) return
  installed = true
  const wrapped = new WeakMap<(...args: any[]) => unknown, (...args: any[]) => unknown>()
  const wrapListener = (listener: IpcListener): IpcListener => {
    const existing = wrapped.get(listener)
    if (existing) return existing as IpcListener
    const scopedListener: IpcListener = (event, ...args) => runInWindow(windowForContents(event.sender), () => listener(event, ...args))
    wrapped.set(listener, scopedListener)
    return scopedListener
  }
  const originalOn = ipcMain.on.bind(ipcMain)
  const originalOnce = ipcMain.once.bind(ipcMain)
  const originalRemoveListener = ipcMain.removeListener.bind(ipcMain)
  const originalHandle = ipcMain.handle.bind(ipcMain)
  const originalHandleOnce = ipcMain.handleOnce.bind(ipcMain)
  ipcMain.on = ((channel: string, listener: IpcListener) => originalOn(channel, wrapListener(listener))) as typeof ipcMain.on
  ipcMain.addListener = ipcMain.on
  ipcMain.once = ((channel: string, listener: IpcListener) => originalOnce(channel, wrapListener(listener))) as typeof ipcMain.once
  ipcMain.removeListener = ((channel: string, listener: IpcListener) => originalRemoveListener(channel, (wrapped.get(listener) as IpcListener | undefined) ?? listener)) as typeof ipcMain.removeListener
  ipcMain.off = ipcMain.removeListener
  ipcMain.handle = ((channel: string, handler: IpcHandler) => originalHandle(channel, (event, ...args) => runInWindow(windowForContents(event.sender), () => handler(event, ...args)))) as typeof ipcMain.handle
  ipcMain.handleOnce = ((channel: string, handler: IpcHandler) => originalHandleOnce(channel, (event, ...args) => runInWindow(windowForContents(event.sender), () => handler(event, ...args)))) as typeof ipcMain.handleOnce
}

// Installed on import: index.ts imports this module first, so even handlers other modules register
// while they load are scoped.
installIpcWindowScope()
