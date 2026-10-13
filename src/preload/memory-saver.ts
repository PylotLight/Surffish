import { ipcRenderer } from 'electron'
import type { MemorySaverSettings } from '../shared/memory-saver'

type MemorySaverSnapshot = MemorySaverSettings & { discarded: number }

/** window.api.browser.memorySaver: discard background tabs when memory is tight (Settings → Tabs). */
export const memorySaverApi = {
  get: (): Promise<MemorySaverSnapshot> => ipcRenderer.invoke('browser:memory-saver:get'),
  set: (patch: Partial<MemorySaverSettings>): Promise<MemorySaverSnapshot> => ipcRenderer.invoke('browser:memory-saver:set', patch),
  onChange: (callback: (snapshot: MemorySaverSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: MemorySaverSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:memory-saver:changed', listener)
    return () => ipcRenderer.removeListener('browser:memory-saver:changed', listener)
  }
}
