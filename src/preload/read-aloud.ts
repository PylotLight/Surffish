import { ipcRenderer } from 'electron'
import type { ReadAloudControl, ReadAloudDownloadState, ReadAloudSettings, ReadAloudState, ReadAloudTestRequest, ReadAloudTestState } from '../shared/read-aloud'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** window.api.browser.readAloud: Settings → Integrations → Read Aloud (experimental) and the toolbar player. */
export const readAloudApi = {
  getSettings: (): Promise<ReadAloudSettings> => ipcRenderer.invoke('browser:read-aloud:get-settings'),
  setSettings: (settings: Partial<ReadAloudSettings>): Promise<ReadAloudSettings> => ipcRenderer.invoke('browser:read-aloud:set-settings', settings),
  onSettingsChange: (callback: (settings: ReadAloudSettings) => void): (() => void) => subscribe('browser:read-aloud:settings-changed', callback),
  getState: (): Promise<ReadAloudState> => ipcRenderer.invoke('browser:read-aloud:get-state'),
  onState: (callback: (state: ReadAloudState) => void): (() => void) => subscribe('browser:read-aloud:state', callback),
  control: (action: ReadAloudControl): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('browser:read-aloud:control', action),
  /** The model download (Settings shows progress, Cancel, Retry, "Ready · 71 MB" and Delete download). */
  downloadInfo: (): Promise<ReadAloudDownloadState> => ipcRenderer.invoke('browser:read-aloud:download-info'),
  onDownload: (callback: (state: ReadAloudDownloadState) => void): (() => void) => subscribe('browser:read-aloud:download', callback),
  startDownload: (): Promise<ReadAloudDownloadState> => ipcRenderer.invoke('browser:read-aloud:download-start'),
  cancelDownload: (): Promise<ReadAloudDownloadState> => ipcRenderer.invoke('browser:read-aloud:download-cancel'),
  deleteDownloads: (): Promise<ReadAloudDownloadState> => ipcRenderer.invoke('browser:read-aloud:delete-downloads'),
  /** The voice tester. */
  test: (request: Partial<ReadAloudTestRequest>): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('browser:read-aloud:test', request),
  stopTest: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('browser:read-aloud:test-stop'),
  getTestState: (): Promise<ReadAloudTestState> => ipcRenderer.invoke('browser:read-aloud:test-state'),
  onTest: (callback: (state: ReadAloudTestState) => void): (() => void) => subscribe('browser:read-aloud:test', callback)
}
