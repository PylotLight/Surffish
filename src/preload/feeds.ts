import { ipcRenderer } from 'electron'
import type { AddFeedResult, DiscoverResult, FeedsSnapshot } from '../main/feeds'
import type { FeedIntervalMinutes, FeedListItem } from '../shared/feeds'

type Result<T = { snapshot: FeedsSnapshot }> = ({ ok: true } & T) | { ok: false; error: string }
const invoke = ipcRenderer.invoke.bind(ipcRenderer)
const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** window.api.browser.feeds: Settings → Integrations → Feeds. Bad input resolves { ok: false, error }. */
export const feedsApi = {
  list: (): Promise<FeedsSnapshot> => invoke('browser:feeds:list'),
  items: (feedId: string | null, options?: { unreadOnly?: boolean; limit?: number }): Promise<FeedListItem[]> => invoke('browser:feeds:items', feedId, options),
  add: (input: { url: string; title?: string; intervalMinutes?: FeedIntervalMinutes | null; notify?: boolean }): Promise<AddFeedResult> => invoke('browser:feeds:add', input),
  update: (id: string, patch: { title?: string; intervalMinutes?: FeedIntervalMinutes | null; notify?: boolean; paused?: boolean }): Promise<Result> => invoke('browser:feeds:update', id, patch),
  remove: (id: string): Promise<Result> => invoke('browser:feeds:remove', id),
  refresh: (id: string | null): Promise<Result> => invoke('browser:feeds:refresh', id),
  markRead: (feedId: string | null, itemKey?: string): Promise<Result> => invoke('browser:feeds:mark-read', feedId, itemKey),
  openItem: (feedId: string, itemKey: string): Promise<Result<{ tabId: string | null }>> => invoke('browser:feeds:open-item', feedId, itemKey),
  discover: (): Promise<DiscoverResult> => invoke('browser:feeds:discover'),
  setSettings: (input: { intervalMinutes: FeedIntervalMinutes }): Promise<Result> => invoke('browser:feeds:settings:set', input),
  onChange: (callback: (snapshot: FeedsSnapshot) => void): (() => void) => subscribe('browser:feeds:changed', callback),
  /** The menu, palette or a notification asked to show Feeds (optionally discover, or one feed). */
  onReveal: (callback: (request: { discover: boolean; feedId: string | null }) => void): (() => void) => subscribe('browser:feeds:reveal', callback)
}
