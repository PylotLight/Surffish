import { ipcRenderer } from 'electron'
import type { ReadAloudControl, ReadAloudSettings, ReadAloudState } from '../shared/read-aloud'

/** window.api.browser.readAloud: Settings → Features → Read Aloud (experimental) and the toolbar player. */
export const readAloudApi = {
  getSettings: (): Promise<ReadAloudSettings> => ipcRenderer.invoke('browser:read-aloud:get-settings'),
  setSettings: (settings: Partial<ReadAloudSettings>): Promise<ReadAloudSettings> => ipcRenderer.invoke('browser:read-aloud:set-settings', settings),
  onSettingsChange: (callback: (settings: ReadAloudSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: ReadAloudSettings): void => callback(settings)
    ipcRenderer.on('browser:read-aloud:settings-changed', listener)
    return () => ipcRenderer.removeListener('browser:read-aloud:settings-changed', listener)
  },
  getState: (): Promise<ReadAloudState> => ipcRenderer.invoke('browser:read-aloud:get-state'),
  onState: (callback: (state: ReadAloudState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ReadAloudState): void => callback(state)
    ipcRenderer.on('browser:read-aloud:state', listener)
    return () => ipcRenderer.removeListener('browser:read-aloud:state', listener)
  },
  control: (action: ReadAloudControl): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('browser:read-aloud:control', action),
  /** Whether the model was downloaded (Settings shows the size and a Delete button). */
  downloadInfo: (): Promise<{ downloaded: boolean }> => ipcRenderer.invoke('browser:read-aloud:download-info'),
  deleteDownloads: (): Promise<{ downloaded: boolean }> => ipcRenderer.invoke('browser:read-aloud:delete-downloads')
}
