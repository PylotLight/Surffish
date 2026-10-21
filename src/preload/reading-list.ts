import { ipcRenderer } from 'electron'
import type { ReadingListInput, ReadingListItem, ReadingListSnapshot } from '../shared/reading-list'

type Result<T = { snapshot: ReadingListSnapshot }> = ({ ok: true } & T) | { ok: false; error: string }
const invoke = ipcRenderer.invoke.bind(ipcRenderer)
const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** window.api.browser.readingList: pages saved for later (toolbar popover). Bad input resolves { ok: false, error }. */
export const readingListApi = {
  get: (): Promise<ReadingListSnapshot> => invoke('browser:reading-list:get'),
  add: (input: ReadingListInput): Promise<Result<{ item: ReadingListItem; created: boolean; snapshot: ReadingListSnapshot }>> => invoke('browser:reading-list:add', input),
  /** Save a tab's page (the active tab by default) with its description and an offline Reader copy. */
  addTab: (tabId?: string): Promise<Result<{ item: ReadingListItem; created: boolean; snapshot: ReadingListSnapshot }>> => invoke('browser:reading-list:add-tab', tabId ?? null),
  setRead: (id: string, read: boolean): Promise<Result> => invoke('browser:reading-list:set-read', id, read),
  remove: (id: string): Promise<Result> => invoke('browser:reading-list:remove', id),
  clearRead: (): Promise<Result<{ removed: number; snapshot: ReadingListSnapshot }>> => invoke('browser:reading-list:clear-read'),
  open: (id: string, options?: { target?: 'current' | 'new-tab'; reader?: boolean; listen?: boolean }): Promise<Result<{ tabId: string | null }>> => invoke('browser:reading-list:open', id, options ?? {}),
  contextMenu: (id: string): Promise<string | null> => invoke('browser:reading-list:context-menu', id),
  onChange: (callback: (snapshot: ReadingListSnapshot) => void): (() => void) => subscribe('browser:reading-list:changed', callback),
  /** The menu, palette or a shortcut asked to show the Reading List popover. */
  onShow: (callback: () => void): (() => void) => subscribe('browser:reading-list:show', callback)
}
