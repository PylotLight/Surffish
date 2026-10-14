import { ipcRenderer } from 'electron'
import type { GlanceSettings } from '../shared/glance'

/** window.api.browser.glance: Settings → General → "Shift-click opens links in Glance". */
export const glanceApi = {
  getSettings: (): Promise<GlanceSettings> => ipcRenderer.invoke('browser:glance:get-settings'),
  setShiftClick: (enabled: boolean): Promise<GlanceSettings> => ipcRenderer.invoke('browser:glance:set-shift-click', enabled),
  onSettingsChange: (callback: (settings: GlanceSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: GlanceSettings): void => callback(settings)
    ipcRenderer.on('browser:glance:settings-changed', listener)
    return () => ipcRenderer.removeListener('browser:glance:settings-changed', listener)
  }
}
