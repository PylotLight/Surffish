import { ipcRenderer } from 'electron'
import type { DebugLoggingSettings, DebugLoggingState } from '../shared/stall-log'

/** window.api.browser.debugLogging: Settings → Advanced → Developer → Debug logging (main/stall-logger.ts). */
export const debugLoggingApi = {
  get: (): Promise<DebugLoggingState> => ipcRenderer.invoke('browser:debug-logging:get'),
  set: (settings: Partial<DebugLoggingSettings>): Promise<DebugLoggingState> => ipcRenderer.invoke('browser:debug-logging:set', settings),
  reveal: (): Promise<boolean> => ipcRenderer.invoke('browser:debug-logging:reveal')
}
