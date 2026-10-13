import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { newBrowserTab, newPrivateBrowserTab, openClearBrowsingData, reopenClosedBrowserTab, runTabCommand, savePdfEditor, togglePdfEditor, selectBrowserTabByNumber, TAB_COMMAND_SHORTCUTS, type TabCommand } from './browser'
import { getMainWindow } from './window'
import { sendFocusAddressToVisibleRenderer } from './browser-shell'
import { APP_NAME } from '../shared/config'
import { checkForUpdatesFromMenu } from './updates'

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
            { label: 'Check for Updates…', click: () => checkForUpdatesFromMenu() },
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
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: () => { sendFocusAddressToVisibleRenderer() } },
        // F6 (and Alt+D off macOS) also focus the address bar; hidden so the menu shows one entry.
        { label: 'Focus Address Bar', accelerator: 'F6', visible: false, acceleratorWorksWhenHidden: true, click: () => { sendFocusAddressToVisibleRenderer() } },
        ...(isMac ? [] : [{ label: 'Focus Address Bar', accelerator: 'Alt+D', visible: false, acceleratorWorksWhenHidden: true, click: () => { sendFocusAddressToVisibleRenderer() } } satisfies MenuItemConstructorOptions]),
        { type: 'separator' },
        // Both act only when the active tab is a PDF (viewer) or the PDF editor; otherwise no-ops.
        { label: 'Edit PDF / Back to Viewer', accelerator: 'CmdOrCtrl+Shift+E', click: () => { togglePdfEditor() } },
        { label: 'Save Edited PDF…', accelerator: 'CmdOrCtrl+S', click: () => { savePdfEditor() } },
        { type: 'separator' },
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
        { role: 'selectAll' },
        { type: 'separator' },
        tabItem('Find…', 'find'),
        tabItem('Find Next', 'findNext'),
        tabItem('Find Previous', 'findPrevious')
      ]
    },
    {
      label: 'Tab',
      submenu: [
        tabItem('Reload Tab', 'reload'),
        tabItem('Hard Reload Tab', 'hardReload'),
        tabItem('Duplicate Tab', 'duplicate'),
        tabItem('Pin / Unpin Tab', 'pin'),
        tabItem('Bookmark Tab', 'bookmark'),
        tabItem('Copy Link', 'copyLink'),
        tabItem('Copy Clean Link', 'copyCleanLink'),
        { type: 'separator' },
        tabItem('Select Next Tab', 'nextTab'),
        tabItem('Select Previous Tab', 'previousTab'),
        // Cmd+1..8 / Cmd+9: hidden like Chrome's, but registered so they work with no page focused.
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number): MenuItemConstructorOptions => ({
          label: number === 9 ? 'Select Last Tab' : `Select Tab ${number}`,
          accelerator: `CmdOrCtrl+${number}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => selectBrowserTabByNumber(number)
        }))
      ]
    },
    {
      label: 'History',
      submenu: [
        tabItem('Back', 'back'),
        tabItem('Forward', 'forward'),
        { type: 'separator' },
        tabItem('Show History', 'history'),
        { label: 'Clear Browsing Data…', accelerator: 'CmdOrCtrl+Shift+Backspace', click: () => openClearBrowsingData() }
      ]
    },
    {
      label: 'View',
      submenu: [
        tabItem('Zoom In', 'zoomIn'),
        // Cmd+Shift+= types "+"; keep the Plus accelerator working without a second visible item.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, acceleratorWorksWhenHidden: true, click: () => runTabCommand('zoomIn') },
        tabItem('Zoom Out', 'zoomOut'),
        tabItem('Actual Size', 'zoomReset'),
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const, { type: 'separator' } as const]),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        tabItem('Downloads', 'downloads'),
        ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : [])
      ]
    },
    // macOS has it in the app menu; elsewhere it lives under Help.
    ...(isMac ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => checkForUpdatesFromMenu() }] } satisfies MenuItemConstructorOptions])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
