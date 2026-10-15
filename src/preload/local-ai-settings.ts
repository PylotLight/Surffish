import { ipcRenderer } from 'electron'
import type { LocalAISettings } from '../shared/local-ai'

/** window.api.browser.localAI: Settings → General → Built-in AI (experimental). */
export const localAIApi = {
  getSettings: (): Promise<LocalAISettings> => ipcRenderer.invoke('browser:local-ai:get-settings'),
  setSettings: (settings: Partial<LocalAISettings>): Promise<LocalAISettings> => ipcRenderer.invoke('browser:local-ai:set-settings', settings),
  onSettingsChange: (callback: (settings: LocalAISettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: LocalAISettings): void => callback(settings)
    ipcRenderer.on('browser:local-ai:settings-changed', listener)
    return () => ipcRenderer.removeListener('browser:local-ai:settings-changed', listener)
  }
}
