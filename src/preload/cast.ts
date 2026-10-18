import { ipcRenderer } from 'electron'
import type { CastMediaChoice, CastSettings, CastSnapshot } from '../shared/cast'

const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export type CastControlAction = 'play' | 'pause' | 'seek' | 'volume' | 'mute' | 'stop'

/** window.api.browser.cast: the toolbar cast picker and Settings → Features → Cast. */
export const castApi = {
  snapshot: (): Promise<CastSnapshot> => ipcRenderer.invoke('browser:cast:snapshot'),
  /** The picker opened (main browses for devices until it closes) or closed. */
  setPickerOpen: (open: boolean): Promise<CastSnapshot> => ipcRenderer.invoke('browser:cast:picker', open),
  /** What "Cast video" would send from a tab (the active tab by default); null when it isn't loaded. */
  probe: (tabId?: string): Promise<{ choice: CastMediaChoice; proxied: boolean } | null> => ipcRenderer.invoke('browser:cast:probe', tabId ?? null),
  castMedia: (deviceId: string, tabId?: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('browser:cast:cast-media', deviceId, tabId ?? null),
  /** Mirror tab: stream the tab itself (picture + sound) to the Chromecast. */
  mirror: (deviceId: string, tabId?: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('browser:cast:mirror', deviceId, tabId ?? null),
  control: (action: CastControlAction, value?: number): Promise<boolean> => ipcRenderer.invoke('browser:cast:control', action, value),
  getSettings: (): Promise<CastSettings> => ipcRenderer.invoke('browser:cast:get-settings'),
  setSettings: (settings: Partial<CastSettings>): Promise<CastSettings> => ipcRenderer.invoke('browser:cast:set-settings', settings),
  onState: (callback: (snapshot: CastSnapshot) => void): (() => void) => subscribe('browser:cast:state', callback),
  onSettingsChange: (callback: (settings: CastSettings) => void): (() => void) => subscribe('browser:cast:settings-changed', callback),
  /** ⌘K "Cast…" asked to show the picker. */
  onShow: (callback: () => void): (() => void) => subscribe('browser:cast:show', callback)
}
