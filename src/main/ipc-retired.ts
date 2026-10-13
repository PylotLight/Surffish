import { ipcMain } from 'electron'
import { isRetiredShellRenderer } from './browser-shell'

/**
 * A closing window's surfaces can have IPC calls in flight when the window goes (their `*:get`
 * calls while bootstrapping, a last `chrome:set`). Those used to fail the app-window check and
 * log "This browser operation is available only to the app window" for every handler. Calls from
 * a surface of a closed window now resolve to undefined without running; every other sender is
 * checked by the handlers exactly as before. Install before the handlers are registered.
 */
export function quietRetiredShellSenders(): void {
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    if (isRetiredShellRenderer(event.sender)) return undefined
    return listener(event, ...args)
  })
}
