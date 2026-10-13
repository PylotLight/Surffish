import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isMainWindowRenderer, sendToWindowRenderers } from './browser-shell'
import { currentBrowserWindow } from './window-scope'
import {
  addBrowserTabsToGroup,
  closeBrowserTabGroup,
  createBrowserTabGroup,
  dropBrowserTabGroupOutside,
  getBrowserTabs,
  moveBrowserTab,
  moveBrowserTabGroup,
  moveBrowserTabGroupToWindow,
  newBrowserTabInGroup,
  removeBrowserTabsFromGroup,
  setTabGroupMenuHook,
  showBrowserTabGroupMenu,
  toggleBrowserTabGroupCollapsed,
  ungroupBrowserTabGroup,
  updateBrowserTabGroup
} from './browser'

/** Tab groups: sidebar IPC, the header menu's rename / close items, and the close confirm. */

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('This browser operation is available only to the app window.')
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertMainRenderer(event)
    return listener(event, ...args)
  })
}

const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : typeof value === 'string' ? [value] : []
const optionalString = (value: unknown): string | null => typeof value === 'string' ? value : null

/** Close Group asks first when it would close more than one tab. */
export async function closeBrowserTabGroupWithConfirm(groupId: string): Promise<boolean> {
  const count = getBrowserTabs().filter((tab) => tab.group?.id === groupId).length
  if (count > 1) {
    const win = currentBrowserWindow()
    const options = { type: 'question' as const, buttons: ['Close Tabs', 'Cancel'], defaultId: 0, cancelId: 1, message: `Close the ${count} tabs in this group?` }
    const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return false
  }
  return closeBrowserTabGroup(groupId)
}

/** Start the sidebar's inline rename for a group (header menu, palette). */
export function renameBrowserTabGroup(groupId: string): void {
  const win = currentBrowserWindow()
  if (win && !win.isDestroyed()) sendToWindowRenderers(win, 'browser:tab-groups:rename', groupId)
}

export function registerTabGroupsIpc(): void {
  setTabGroupMenuHook((groupId) => [
    { label: 'Rename Group…', click: () => renameBrowserTabGroup(groupId) },
    { label: 'Close Group…', click: () => { void closeBrowserTabGroupWithConfirm(groupId) } },
    { type: 'separator' }
  ])
  handle('browser:tab-groups:create', (_event, tabIds, input) => createBrowserTabGroup(ids(tabIds), typeof input === 'object' && input !== null ? input : {}))
  handle('browser:tab-groups:add', (_event, tabIds, groupId) => typeof groupId === 'string' && addBrowserTabsToGroup(ids(tabIds), groupId))
  handle('browser:tab-groups:remove', (_event, tabIds) => removeBrowserTabsFromGroup(ids(tabIds)))
  handle('browser:tab-groups:update', (_event, groupId, patch) => typeof groupId === 'string' && typeof patch === 'object' && patch !== null && updateBrowserTabGroup(groupId, patch))
  handle('browser:tab-groups:toggle', (_event, groupId) => typeof groupId === 'string' && toggleBrowserTabGroupCollapsed(groupId))
  handle('browser:tab-groups:ungroup', (_event, groupId) => typeof groupId === 'string' && ungroupBrowserTabGroup(groupId))
  handle('browser:tab-groups:close', (_event, groupId) => typeof groupId === 'string' && closeBrowserTabGroupWithConfirm(groupId))
  handle('browser:tab-groups:new-tab', (_event, groupId) => typeof groupId === 'string' ? newBrowserTabInGroup(groupId) : null)
  handle('browser:tab-groups:move', (_event, groupId, beforeId) => typeof groupId === 'string' && moveBrowserTabGroup(groupId, optionalString(beforeId)))
  handle('browser:tab-groups:move-to-new-window', (_event, groupId) => typeof groupId === 'string' && moveBrowserTabGroupToWindow(groupId, null))
  handle('browser:tab-groups:drop-outside', (_event, groupId) => typeof groupId === 'string' && dropBrowserTabGroupOutside(groupId))
  handle('browser:tab-groups:menu', (_event, groupId) => typeof groupId === 'string' && showBrowserTabGroupMenu(groupId))
  // Sidebar drop of a tab: where it lands and which group (null = outside every group).
  handle('browser:tab-groups:move-tab', (_event, id, beforeId, groupId) => typeof id === 'string' && moveBrowserTab(id, optionalString(beforeId), optionalString(groupId)))
}
