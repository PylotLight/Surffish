import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { newBrowserTab, newPrivateBrowserTab, openClearBrowsingData, reopenClosedBrowserTab, runTabCommand, savePdfEditor, togglePdfEditor, selectBrowserTabByNumber, TAB_COMMAND_SHORTCUTS, type TabCommand } from './browser'
import { getMainWindow } from './window'
import { sendFocusAddressToVisibleRenderer } from './browser-shell'
import { APP_NAME } from '../shared/config'
import { checkForUpdatesFromMenu } from './updates'
import { APP_SHORTCUTS } from './app-shortcuts'
import { openCommandPalette } from './command-palette'
import { toggleTaskManager } from './diagnostics'
import { toggleReaderMode } from './reader-mode'
import { onPageWatchersEnabledChange, pageWatchersEnabled, revealPageWatchers } from './page-watchers-feature'
import { revealFeeds } from './feeds-ipc'
import { showReadingList } from './reading-list-ipc'
import { keepWindowMenuCurrent, newWindowMenuItems, windowListMenuItems } from './window-menu'
import { popOutBrowserSplitPane, swapBrowserSplitPanes, unsplitBrowserTab } from './browser'

// Electron's default menu maps Cmd+W to Close Window, which fires whenever no web contents has
// focus (e.g. right after a tab view is torn down on the New Tab page). Own the menu so Cmd+W is
// always Close Tab, and the window only closes from it with confirmation on the last tab.
function tabItem(label: string, command: TabCommand): MenuItemConstructorOptions {
  const { accelerator } = TAB_COMMAND_SHORTCUTS[command]
  return { label, ...(accelerator ? { accelerator } : {}), click: () => runTabCommand(command) }
}

/** View → Split View. Items no-op when there is nothing to split / no split on screen. */
function splitViewMenu(): MenuItemConstructorOptions {
  return {
    label: 'Split View',
    submenu: [
      tabItem('Split with Last Used Tab / Unsplit', 'splitView'),
      { label: 'Swap Panes', click: () => { swapBrowserSplitPanes() } },
      { label: 'Open Pane as Its Own Tab', click: () => { popOutBrowserSplitPane() } },
      { label: 'Close Focused Pane', click: () => runTabCommand('close') },
      { label: 'Unsplit Tabs', click: () => { unsplitBrowserTab() } },
      { type: 'separator' },
      // Hints only: the key handler takes these just while a split is on screen, so pages keep them otherwise.
      { ...tabItem('Focus Left Pane', 'focusPaneLeft'), registerAccelerator: false },
      { ...tabItem('Focus Right Pane', 'focusPaneRight'), registerAccelerator: false }
    ]
  }
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
        { label: 'New Tab', accelerator: APP_SHORTCUTS.newTab, click: () => { newBrowserTab() } },
        { label: 'New Private Tab', accelerator: APP_SHORTCUTS.newPrivateTab, click: () => { newPrivateBrowserTab() } },
        ...newWindowMenuItems(),
        { label: 'Reopen Closed Tab', accelerator: APP_SHORTCUTS.reopenClosedTab, click: () => { reopenClosedBrowserTab() } },
        { label: 'Open Location…', accelerator: APP_SHORTCUTS.openLocation, click: () => { sendFocusAddressToVisibleRenderer() } },
        // F6 (and Alt+D off macOS) also focus the address bar; hidden so the menu shows one entry.
        { label: 'Focus Address Bar', accelerator: 'F6', visible: false, acceleratorWorksWhenHidden: true, click: () => { sendFocusAddressToVisibleRenderer() } },
        ...(isMac ? [] : [{ label: 'Focus Address Bar', accelerator: 'Alt+D', visible: false, acceleratorWorksWhenHidden: true, click: () => { sendFocusAddressToVisibleRenderer() } } satisfies MenuItemConstructorOptions]),
        { type: 'separator' },
        // Both act only when the active tab is a PDF (viewer) or the PDF editor; otherwise no-ops.
        { label: 'Edit PDF / Back to Viewer', accelerator: APP_SHORTCUTS.editPdf, click: () => { togglePdfEditor() } },
        { label: 'Save Edited PDF…', accelerator: APP_SHORTCUTS.savePdf, click: () => { savePdfEditor() } },
        { type: 'separator' },
        tabItem('Take Screenshot…', 'screenshot'),
        { type: 'separator' },
        tabItem('Close Tab', 'close'),
        tabItem('Close Other Tabs', 'closeOthers'),
        {
          label: 'Close Window',
          accelerator: APP_SHORTCUTS.closeWindow,
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
        tabItem('Copy Link', 'copyLink'),
        tabItem('Copy Clean Link', 'copyCleanLink'),
        { type: 'separator' },
        // No-ops when the palette is turned off in Settings (pages then get Cmd/Ctrl+K themselves).
        { label: 'Search Tabs…', accelerator: APP_SHORTCUTS.tabSearch, click: () => { openCommandPalette('tabs') } },
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
      label: 'Bookmarks',
      submenu: [
        tabItem('Bookmark This Tab…', 'bookmark'),
        tabItem('Bookmark All Tabs…', 'bookmarkAllTabs'),
        { type: 'separator' },
        tabItem('Bookmark Manager', 'bookmarks'),
        tabItem('Show/Hide Bookmarks Bar', 'bookmarksBar'),
        { type: 'separator' },
        tabItem('Add to Reading List', 'readingList'),
        { label: 'Show Reading List', click: () => { showReadingList() } }
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
        { label: 'Command Palette…', accelerator: APP_SHORTCUTS.commandPalette, click: () => { openCommandPalette('all') } },
        { type: 'separator' },
        // No-op unless the page looks like an article (or Reader view is open).
        { label: 'Reader View', accelerator: APP_SHORTCUTS.readerView, click: () => { void toggleReaderMode() } },
        { type: 'separator' },
        // Cmd/Ctrl+Shift+= (which types "+") is Split View now, so there is no hidden Cmd+Plus zoom item.
        tabItem('Zoom In', 'zoomIn'),
        tabItem('Zoom Out', 'zoomOut'),
        tabItem('Actual Size', 'zoomReset'),
        { type: 'separator' },
        splitViewMenu(),
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
        ...(pageWatchersEnabled() ? [{ label: 'Page Watchers', click: () => { revealPageWatchers() } }] : []),
        { label: 'Feeds', click: () => { revealFeeds() } },
        { label: 'Task Manager', accelerator: 'Shift+Escape', click: () => toggleTaskManager() },
        ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : []),
        ...windowListMenuItems()
      ]
    },
    // macOS has it in the app menu; elsewhere it lives under Help.
    ...(isMac ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => checkForUpdatesFromMenu() }] } satisfies MenuItemConstructorOptions])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  if (!windowMenuWatched) {
    windowMenuWatched = true
    keepWindowMenuCurrent(installAppMenu)
    onPageWatchersEnabledChange(() => installAppMenu())
  }
}

let windowMenuWatched = false
