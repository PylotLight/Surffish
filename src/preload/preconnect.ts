import { ipcRenderer } from 'electron'
import type { PreconnectSettings } from '../shared/preconnect'

type PreconnectSnapshot = PreconnectSettings & { issued: number }

/** window.api.browser.preconnect: "Preload pages for faster browsing" (Settings → Tabs) and the address bar's typing hint. */
export const preconnectApi = {
  get: (): Promise<PreconnectSnapshot> => ipcRenderer.invoke('browser:preconnect:get'),
  set: (patch: Partial<PreconnectSettings>): Promise<PreconnectSnapshot> => ipcRenderer.invoke('browser:preconnect:set', patch),
  onChange: (callback: (snapshot: PreconnectSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PreconnectSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:preconnect:changed', listener)
    return () => ipcRenderer.removeListener('browser:preconnect:changed', listener)
  },
  /** Debounced address-bar text and the top suggestion's URL; main resolves and preconnects the origin. */
  typed: (input: string, topSuggestionUrl: string | null): void => ipcRenderer.send('browser:preconnect:typed', input, topSuggestionUrl)
}
