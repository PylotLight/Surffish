import { ipcRenderer } from 'electron'
import type { MiniWindowSettings } from '../shared/mini-window'

export interface MiniWindowSettingsSnapshot {
  settings: MiniWindowSettings
  status: { shortcut: string; registered: boolean; error: string | null }
}

/** window.api.browser.miniWindow: Settings → General → Mini window. */
export const miniWindowApi = {
  getSettings: (): Promise<MiniWindowSettingsSnapshot & { defaults: MiniWindowSettings }> => ipcRenderer.invoke('browser:mini-window:get-settings'),
  update: (patch: Partial<MiniWindowSettings>): Promise<({ ok: true } & MiniWindowSettingsSnapshot) | { ok: false; error: string }> => ipcRenderer.invoke('browser:mini-window:update-settings', patch),
  onSettingsChange: (callback: (snapshot: MiniWindowSettingsSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: MiniWindowSettingsSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:mini-window:settings-changed', listener)
    return () => ipcRenderer.removeListener('browser:mini-window:settings-changed', listener)
  }
}
