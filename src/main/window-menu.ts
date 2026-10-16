import { ipcMain, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { noteBrowserTabDragOutside } from './mini-window-entry'
import { dropBrowserTabOutside, listBrowserWindows, moveBrowserTabToNewWindow } from './browser'
import { isMainWindowRenderer } from './browser-shell'
import { onBrowserWindowsChanged } from './window-scope'
import { createBrowserWindow } from './window'
import { APP_SHORTCUTS } from './app-shortcuts'

/** File menu: New Window / New Private Window. */
export function newWindowMenuItems(): MenuItemConstructorOptions[] {
  return [
    { label: 'New Window', accelerator: APP_SHORTCUTS.newWindow, click: () => { createBrowserWindow(false) } },
    { label: 'New Private Window', accelerator: APP_SHORTCUTS.newPrivateWindow, click: () => { createBrowserWindow(true) } }
  ]
}

/** Window menu: every open window, the focused one checked; picking one brings it forward. */
export function windowListMenuItems(): MenuItemConstructorOptions[] {
  const windows = listBrowserWindows()
  if (windows.length === 0) return []
  return [
    { type: 'separator' },
    ...windows.map(({ window, label, focused }): MenuItemConstructorOptions => ({
      label,
      type: 'checkbox',
      checked: focused,
      click: () => {
        if (window.isDestroyed()) return
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
      }
    }))
  ]
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null

/** Rebuild the app menu (debounced) whenever windows open, close, focus or change their active tab. */
export function keepWindowMenuCurrent(rebuild: () => void): void {
  onBrowserWindowsChanged(() => {
    if (rebuildTimer) return
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null
      rebuild()
    }, 150)
  })
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

/** Tab drag-out from the sidebar, Move to New Window, and New (Private) Window from the renderer. */
export function registerWindowIpc(): void {
  ipcMain.handle('browser:tabs:drop-outside', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && dropBrowserTabOutside(id)
  })
  // A sidebar drag left (id) or came back into / ended (null) the window: mini windows show where it would join.
  ipcMain.on('browser:tabs:drag-outside', (event, id: unknown) => {
    if (!isMainWindowRenderer(event.sender, event.senderFrame)) return
    noteBrowserTabDragOutside(typeof id === 'string' ? id : null)
  })
  ipcMain.handle('browser:tabs:move-to-new-window', (event, id: unknown) => {
    assertMainRenderer(event)
    return typeof id === 'string' && moveBrowserTabToNewWindow(id)
  })
  ipcMain.handle('browser:windows:new', (event, isPrivate: unknown) => {
    assertMainRenderer(event)
    createBrowserWindow(isPrivate === true)
    return true
  })
}
