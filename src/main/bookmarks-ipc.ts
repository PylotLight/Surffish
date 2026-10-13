import { ipcMain, Menu, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { isMainWindowRenderer } from './browser-shell'
import { getMainWindow } from './window'
import {
  createBookmark,
  createBookmarkFolder,
  deleteBookmarks,
  editBookmark,
  getBookmarksSnapshot,
  moveBookmarks
} from './bookmarks'
import { exportBookmarksHtmlFile, importBookmarksHtmlFile, listBookmarkImportSources, openFullDiskAccessSettings, runBookmarkImport } from './bookmark-import'
import { bookmarkAllBrowserTabs } from './browser'
import type { BookmarkMenuAction } from '../shared/bookmark-import'


function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error('This browser operation is available only to the app window.')
  }
}

/**
 * Native right-click menu for a bookmark or folder. Main only reports which item was chosen;
 * the renderer that asked carries it out (it owns the edit form and knows the node).
 */
function popupBookmarkMenu(request: unknown): Promise<BookmarkMenuAction | null> {
  const record = typeof request === 'object' && request !== null ? request as Record<string, unknown> : {}
  const isFolder = record.type === 'folder'
  const fixed = record.fixed === true
  const childCount = typeof record.childCount === 'number' ? record.childCount : 0
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return Promise.resolve(null)
  return new Promise((resolve) => {
    let chosen: BookmarkMenuAction | null = null
    const pick = (action: BookmarkMenuAction) => () => { chosen = action }
    const items: MenuItemConstructorOptions[] = isFolder
      ? [
          { label: childCount > 0 ? `Open All (${childCount})` : 'Open All', enabled: childCount > 0, click: pick('open-all') },
          { type: 'separator' },
          { label: 'Rename…', enabled: !fixed, click: pick('edit') },
          { label: 'New Folder…', click: pick('new-folder') },
          { type: 'separator' },
          { label: 'Delete Folder', enabled: !fixed, click: pick('delete') }
        ]
      : [
          { label: 'Open', click: pick('open') },
          { label: 'Open in New Tab', click: pick('open-new-tab') },
          { label: 'Open in Private Tab', click: pick('open-private') },
          { type: 'separator' },
          { label: 'Edit…', click: pick('edit') },
          { label: 'New Folder…', click: pick('new-folder') },
          { type: 'separator' },
          { label: 'Delete', click: pick('delete') }
        ]
    // No coordinates: the menu opens at the pointer, which works for every shell surface.
    Menu.buildFromTemplate(items).popup({
      window,
      // Clicks run before the close callback; defer so `chosen` is set either way.
      callback: () => setTimeout(() => resolve(chosen), 0)
    })
  })
}

export function registerBookmarkIpc(): void {
  ipcMain.handle('browser:bookmarks:get', (event) => {
    assertMainRenderer(event)
    return getBookmarksSnapshot()
  })
  ipcMain.handle('browser:bookmarks:create', (event, request: unknown) => {
    assertMainRenderer(event)
    return createBookmark(typeof request === 'object' && request !== null ? request : {})
  })
  ipcMain.handle('browser:bookmarks:create-folder', (event, request: unknown) => {
    assertMainRenderer(event)
    return createBookmarkFolder(typeof request === 'object' && request !== null ? request : {})
  })
  ipcMain.handle('browser:bookmarks:update', (event, id: unknown, patch: unknown) => {
    assertMainRenderer(event)
    return editBookmark(id, typeof patch === 'object' && patch !== null ? patch : {})
  })
  ipcMain.handle('browser:bookmarks:move', (event, ids: unknown, parentId: unknown, index: unknown) => {
    assertMainRenderer(event)
    return moveBookmarks(ids, parentId, index)
  })
  ipcMain.handle('browser:bookmarks:delete', (event, ids: unknown) => {
    assertMainRenderer(event)
    return deleteBookmarks(ids)
  })
  ipcMain.handle('browser:bookmarks:bookmark-all-tabs', (event) => {
    assertMainRenderer(event)
    return bookmarkAllBrowserTabs()
  })
  ipcMain.handle('browser:bookmarks:context-menu', (event, request: unknown) => {
    assertMainRenderer(event)
    return popupBookmarkMenu(request)
  })
  ipcMain.handle('browser:bookmarks:import-sources', (event) => {
    assertMainRenderer(event)
    return listBookmarkImportSources()
  })
  ipcMain.handle('browser:bookmarks:import', (event, id: unknown, options: unknown) => {
    assertMainRenderer(event)
    return runBookmarkImport(id, options)
  })
  ipcMain.handle('browser:bookmarks:import-html', (event) => {
    assertMainRenderer(event)
    return importBookmarksHtmlFile(getMainWindow())
  })
  ipcMain.handle('browser:bookmarks:export-html', (event) => {
    assertMainRenderer(event)
    return exportBookmarksHtmlFile(getMainWindow())
  })
  ipcMain.handle('browser:bookmarks:open-full-disk-access', (event) => {
    assertMainRenderer(event)
    return openFullDiskAccessSettings()
  })
}
