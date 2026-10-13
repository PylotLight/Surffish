import { ipcMain, Menu, type BaseWindow, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { isMainWindowRenderer, sendToWindowRenderers } from './browser-shell'
import { currentBrowserWindow, runInWindow } from './window-scope'
import {
  addBrowserTabsToGroup,
  browserWindowOfTab,
  closeBrowserTab,
  createBrowserTabGroup,
  getBrowserTabs,
  listBrowserTabGroups,
  moveBrowserTabToNewWindow,
  moveBrowserTabToWindow,
  removeBrowserTabsFromGroup,
  setBrowserTabPinned,
  setTabSelectionHooks
} from './browser'
import { normalizeSelectedTabIds, selectionMenuPlan, selectionMenuTarget } from '../shared/tab-selection'

/**
 * Sidebar multi-select (shared/tab-selection.ts has the click rules). The selection lives in the
 * sidebar renderer, which reports the selected tab ids here on every change so the tab context
 * menu, Cmd/Ctrl+G and the palette can act on it. After a bulk action main tells the sidebar to
 * clear its selection.
 */

const selections = new WeakMap<BaseWindow, string[]>()

/** The window's selected tab ids that still exist there (in its current Space), in order. */
export function getSelectedBrowserTabIds(win: BaseWindow | null = currentBrowserWindow()): string[] {
  if (!win || win.isDestroyed()) return []
  const ids = selections.get(win) ?? []
  if (ids.length === 0) return []
  const live = new Set(runInWindow(win, () => getBrowserTabs()).map((tab) => tab.id))
  return ids.filter((id) => live.has(id))
}

export function clearBrowserTabSelection(win: BaseWindow | null = currentBrowserWindow()): void {
  if (!win || win.isDestroyed()) return
  selections.delete(win)
  sendToWindowRenderers(win, 'browser:tab-selection:clear')
}

/** Group N Tabs: a new group with every selected tab (grouped ones move over; pinned ones stay put). */
export function groupSelectedBrowserTabs(win: BaseWindow | null = currentBrowserWindow()): string | null {
  const ids = getSelectedBrowserTabIds(win)
  if (ids.length < 2) return null
  const groupId = createBrowserTabGroup(ids)
  clearBrowserTabSelection(win)
  return groupId
}

export function hasBrowserTabSelection(win: BaseWindow | null = currentBrowserWindow()): boolean {
  return getSelectedBrowserTabIds(win).length >= 2
}

/** Move the selected tabs (with their splits) into one new window, in order. */
function moveSelectedTabsToNewWindow(ids: readonly string[], win: BaseWindow): void {
  const [first, ...rest] = ids
  if (!first || !moveBrowserTabToNewWindow(first)) return
  const target = browserWindowOfTab(first)
  if (!target || target === win) return
  // A split partner already went along with its pane; moveBrowserTabToWindow skips it.
  for (const id of rest) if (browserWindowOfTab(id) === win) moveBrowserTabToWindow(id, target)
}

function showSelectionMenu(clickedId: string, win: BaseWindow): boolean {
  const ids = selectionMenuTarget(getSelectedBrowserTabIds(win), clickedId)
  if (!ids) return false
  const { tabs, groups } = runInWindow(win, () => ({ tabs: getBrowserTabs(), groups: listBrowserTabGroups() }))
  const byId = new Map(tabs.map((tab) => [tab.id, tab]))
  const selected = ids.flatMap((id) => {
    const tab = byId.get(id)
    return tab ? [{ id, pinned: tab.pinned, groupId: tab.group?.id ?? null }] : []
  })
  const plan = selectionMenuPlan(selected, groups.map((group) => ({ id: group.id, label: group.label, count: group.count })), tabs.length)
  const act = (fn: () => unknown) => () => {
    runInWindow(win, fn)
    clearBrowserTabSelection(win)
  }
  const unpinned = selected.filter((tab) => !tab.pinned).map((tab) => tab.id)
  const items: MenuItemConstructorOptions[] = [
    { label: plan.groupLabel, accelerator: 'CmdOrCtrl+G', registerAccelerator: false, enabled: plan.canGroup, click: act(() => createBrowserTabGroup(unpinned)) },
    ...(plan.addTargets.length > 0 ? [{
      label: 'Add to Group',
      submenu: plan.addTargets.map((group): MenuItemConstructorOptions => ({ label: `${group.label} (${group.count})`, click: act(() => addBrowserTabsToGroup(unpinned, group.id)) }))
    }] : []),
    ...(plan.canUngroup ? [{ label: 'Remove from Groups', click: act(() => removeBrowserTabsFromGroup(unpinned)) }] : []),
    { type: 'separator' },
    { label: plan.pinLabel, enabled: plan.canPin, click: act(() => { for (const id of unpinned) setBrowserTabPinned(id, true) }) },
    { label: plan.moveLabel, enabled: plan.canMoveToNewWindow, click: act(() => moveSelectedTabsToNewWindow(selected.map((tab) => tab.id), win)) },
    { type: 'separator' },
    { label: plan.closeLabel, click: act(() => { for (const tab of selected) closeBrowserTab(tab.id) }) },
    { type: 'separator' },
    { label: 'Clear Selection', click: () => clearBrowserTabSelection(win) }
  ]
  Menu.buildFromTemplate(items).popup({ window: win })
  return true
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('This browser operation is available only to the app window.')
}

export function registerTabSelectionIpc(): void {
  setTabSelectionHooks({
    showMenu: showSelectionMenu,
    groupShortcut: () => groupSelectedBrowserTabs() !== null
  })
  // The sidebar reports its selection (tab ids, split panes expanded) on every change.
  ipcMain.handle('browser:tab-selection:set', (event, ids: unknown) => {
    assertMainRenderer(event)
    const win = currentBrowserWindow()
    if (!win) return false
    const list = normalizeSelectedTabIds(ids)
    if (list.length === 0) selections.delete(win)
    else selections.set(win, list)
    return true
  })
  ipcMain.handle('browser:tab-selection:group', (event) => {
    assertMainRenderer(event)
    return groupSelectedBrowserTabs()
  })
}
