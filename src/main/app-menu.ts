import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { newBrowserTab, newPrivateBrowserTab, reopenClosedBrowserTab, runTabCommand, TAB_COMMAND_SHORTCUTS, type TabCommand } from './browser'
import { getMainWindow } from './window'
import { APP_NAME } from '../shared/config'

// Electron's default menu maps Cmd+W to Close Window, which fires whenever no web contents has
// focus (e.g. right after a tab view is torn down on the New Tab page). Own the menu so Cmd+W is
// always Close Tab, and the window only closes from it with confirmation on the last tab.
function tabItem(label: string, command: TabCommand): MenuItemConstructorOptions {
  return { label, accelerator: TAB_COMMAND_SHORTCUTS[command].accelerator, click: () => runTabCommand(command) }
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: APP_NAME,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        } satisfies MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => { newBrowserTab() } },
        { label: 'New Private Tab', accelerator: 'CmdOrCtrl+Shift+N', click: () => { newPrivateBrowserTab() } },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => { reopenClosedBrowserTab() } },
        tabItem('Close Tab', 'close'),
        tabItem('Close Other Tabs', 'closeOthers'),
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) win.close()
          }
        },
        ...(isMac ? [] : [{ type: 'separator' } as const, { role: 'quit' } as const])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Tab',
      submenu: [
        tabItem('Reload Tab', 'reload'),
        tabItem('Duplicate Tab', 'duplicate'),
        tabItem('Pin / Unpin Tab', 'pin'),
        tabItem('Bookmark Tab', 'bookmark'),
        tabItem('Copy Link', 'copyLink')
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const, { type: 'separator' } as const]),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
