import { ipcRenderer } from 'electron'
import type { SidebarBackdropSettings, SidebarBackdropState } from '../shared/sidebar-backdrop'

/** window.api.browser.sidebarBackdrop: the overlay sidebar's background (blur path + snapshot) and its setting. */
export const sidebarBackdropApi = {
  get: (): Promise<{ settings: SidebarBackdropSettings; state: SidebarBackdropState }> => ipcRenderer.invoke('browser:sidebar-backdrop:get'),
  set: (patch: Partial<SidebarBackdropSettings>): Promise<SidebarBackdropSettings> => ipcRenderer.invoke('browser:sidebar-backdrop:set', patch),
  /** The page under the sidebar changed (tab switch, navigation): refresh the snapshot (throttled in main). */
  refresh: (): Promise<boolean> => ipcRenderer.invoke('browser:sidebar-backdrop:refresh'),
  onState: (callback: (state: SidebarBackdropState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SidebarBackdropState): void => callback(state)
    ipcRenderer.on('browser:sidebar-backdrop', listener)
    return () => ipcRenderer.removeListener('browser:sidebar-backdrop', listener)
  },
  onSettings: (callback: (settings: SidebarBackdropSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: SidebarBackdropSettings): void => callback(settings)
    ipcRenderer.on('browser:sidebar-backdrop:settings', listener)
    return () => ipcRenderer.removeListener('browser:sidebar-backdrop:settings', listener)
  }
}
