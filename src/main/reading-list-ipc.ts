import { clipboard, ipcMain, Menu, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { isMainWindowRenderer, sendToVisibleToolbarSurface } from './browser-shell'
import { getMainWindow } from './window'

/**
 * The always-loaded half of the Reading List: IPC handlers and the entry points menus, the palette
 * and the shortcut call. The store, page metadata and Reader copy code live in ./reading-list, which
 * loads on first use (the toolbar asks for the unread count after the window has painted), so launch
 * never pays for it.
 */
type ReadingListModule = typeof import('./reading-list')
let readingListModule: Promise<ReadingListModule> | null = null

export function loadReadingList(): Promise<ReadingListModule> {
  readingListModule ??= import('./reading-list')
  readingListModule.catch(() => { readingListModule = null })
  return readingListModule
}

function warn(error: unknown): void {
  console.warn('[reading-list]', error)
}

/** Cmd/Ctrl+Shift+L, the tab menu, the app menu and the palette: save a tab (active tab by default). */
export function addTabToReadingList(tabId?: string | null): void {
  void loadReadingList().then((module) => module.addTabToReadingList(tabId, { notify: true })).catch(warn)
}

/** "Add Link to Reading List" on a page's right-click menu: saves the link without opening it. */
export function addLinkToReadingList(url: string, title?: string): void {
  void loadReadingList().then((module) => module.addLinkToReadingList(url, title)).catch(warn)
}

/** Open the Reading List popover in the window's toolbar. */
export function showReadingList(): void {
  sendToVisibleToolbarSurface('browser:reading-list:show')
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('The Reading List is available only to the app window.')
}

function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

type ItemMenuAction = 'open' | 'open-new-tab' | 'open-reader' | 'toggle-read' | 'copy-link' | 'remove'

/** Native right-click menu for a Reading List row. Main carries the action out itself. */
function popupItemMenu(module: ReadingListModule, id: unknown): Promise<ItemMenuAction | null> {
  const item = typeof id === 'string' ? module.readingListSnapshot().items.find((candidate) => candidate.id === id) : undefined
  const window = getMainWindow()
  if (!item || !window || window.isDestroyed()) return Promise.resolve(null)
  return new Promise((resolve) => {
    let chosen: ItemMenuAction | null = null
    const pick = (action: ItemMenuAction) => () => { chosen = action }
    const items: MenuItemConstructorOptions[] = [
      { label: 'Open', click: pick('open') },
      { label: 'Open in New Tab', click: pick('open-new-tab') },
      { label: item.hasSnapshot ? 'Open in Reader View (saved copy offline)' : 'Open in Reader View', click: pick('open-reader') },
      { type: 'separator' },
      { label: item.readAt === null ? 'Mark as Read' : 'Mark as Unread', click: pick('toggle-read') },
      { label: 'Copy Link', click: pick('copy-link') },
      { type: 'separator' },
      { label: 'Remove', click: pick('remove') }
    ]
    Menu.buildFromTemplate(items).popup({
      window,
      callback: () => setTimeout(() => {
        resolve(chosen)
        if (!chosen) return
        if (chosen === 'open' || chosen === 'open-new-tab' || chosen === 'open-reader') {
          void module.openReadingListItem(item.id, { target: chosen === 'open-new-tab' ? 'new-tab' : 'current', reader: chosen === 'open-reader' }).catch(warn)
        } else if (chosen === 'toggle-read') {
          module.setReadingListItemRead(item.id, item.readAt === null)
        } else if (chosen === 'copy-link') {
          clipboard.writeText(item.url)
        } else if (chosen === 'remove') {
          module.removeReadingListItem(item.id)
        }
      }, 0)
    })
  })
}

export function registerReadingListIpc(): void {
  const handle = (channel: string, run: (module: ReadingListModule, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertMainRenderer(event)
      try {
        return await run(await loadReadingList(), ...args)
      } catch (error) {
        warn(error)
        return failure(error)
      }
    })
  }
  handle('browser:reading-list:get', (module) => module.readingListSnapshot())
  handle('browser:reading-list:add', (module, input) => module.addToReadingList(input))
  handle('browser:reading-list:add-tab', (module, tabId) => module.addTabToReadingList(typeof tabId === 'string' ? tabId : null))
  handle('browser:reading-list:set-read', (module, id, read) => module.setReadingListItemRead(id, read))
  handle('browser:reading-list:remove', (module, id) => module.removeReadingListItem(id))
  handle('browser:reading-list:clear-read', (module) => module.clearReadReadingListItems())
  handle('browser:reading-list:open', (module, id, options) => module.openReadingListItem(id, options))
  handle('browser:reading-list:context-menu', (module, id) => popupItemMenu(module, id))
}
