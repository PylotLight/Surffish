import { ipcRenderer } from 'electron'
import type { AdblockCounts, AdblockPageInfo } from '../shared/adblock-stats'
import type { BrowserSiteSettings } from '../shared/types'

const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** window.api.browser.adblock: the toolbar ad-blocker button (blocked counts, per-site switch). */
export const adblockApi = {
  /** What the filter blocked on a tab's current page, by domain, and whether it is on for the site. */
  page: (tabId: string): Promise<AdblockPageInfo | null> => ipcRenderer.invoke('browser:adblock:page', tabId),
  counts: (): Promise<AdblockCounts> => ipcRenderer.invoke('browser:adblock:counts:get'),
  /** Turn every blocking layer (network, cosmetic, scriptlets) on/off for a site; applies to new requests at once. */
  setSiteEnabled: (origin: string, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> => ipcRenderer.invoke('browser:adblock:set-site', origin, enabled),
  /** Blocked counts changed (tabId → count; throttled). */
  onCounts: (callback: (counts: AdblockCounts) => void): (() => void) => subscribe('browser:adblock:counts', callback),
  /** A site's settings changed (this popover, or Settings → This site). */
  onSiteSettingsChanged: (callback: (settings: BrowserSiteSettings) => void): (() => void) => subscribe('browser:site-settings:changed', callback)
}
