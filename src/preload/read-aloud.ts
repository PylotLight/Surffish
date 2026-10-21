import { ipcRenderer } from 'electron'
import type { ReadAloudCatalogInfo, ReadAloudControl, ReadAloudDownloadState, ReadAloudSettings, ReadAloudState, ReadAloudTestRequest, ReadAloudTestState } from '../shared/read-aloud'

const invoke = <A extends unknown[], R>(name: string) => (...args: A): Promise<R> => ipcRenderer.invoke(`browser:read-aloud:${name}`, ...args)
const listen = <T>(name: string) => (callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(`browser:read-aloud:${name}`, listener)
  return () => ipcRenderer.removeListener(`browser:read-aloud:${name}`, listener)
}

/**
 * window.api.browser.readAloud: Settings → Integrations → Read Aloud (experimental), its model
 * download and voice tester, and the toolbar player.
 */
export const readAloudApi = {
  getSettings: invoke<[], ReadAloudSettings>('get-settings'),
  setSettings: invoke<[Partial<ReadAloudSettings>], ReadAloudSettings>('set-settings'),
  onSettingsChange: listen<ReadAloudSettings>('settings-changed'),
  getState: invoke<[], ReadAloudState>('get-state'),
  onState: listen<ReadAloudState>('state'),
  control: invoke<[ReadAloudControl], { ok: boolean; error?: string }>('control'),
  downloadInfo: invoke<[], ReadAloudDownloadState>('download-info'),
  onDownload: listen<ReadAloudDownloadState>('download'),
  startDownload: invoke<[], ReadAloudDownloadState>('download-start'),
  cancelDownload: invoke<[], ReadAloudDownloadState>('download-cancel'),
  deleteDownloads: invoke<[], ReadAloudDownloadState>('delete-downloads'),
  test: invoke<[Partial<ReadAloudTestRequest>], { ok: boolean; error?: string }>('test'),
  stopTest: invoke<[], { ok: boolean }>('test-stop'),
  getTestState: invoke<[], ReadAloudTestState>('test-state'),
  onTest: listen<ReadAloudTestState>('test'),
  catalog: invoke<[], ReadAloudCatalogInfo>('catalog')
}
