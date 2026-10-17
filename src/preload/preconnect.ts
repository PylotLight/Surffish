import { ipcRenderer } from 'electron'
import type { PreconnectSettings } from '../shared/preconnect'

type PreconnectSnapshot = PreconnectSettings & {
  issued: number
  /** Omnibox prerender counters (main/omnibox-prerender.ts). */
  prerender: { started: number; used: number; cancelled: number; skipped: Record<string, number>; active: { url: string; loaded: boolean } | null }
}

/** window.api.browser.preconnect: "Preload pages for faster browsing" (Settings → Tabs) and the address bar's typing hint. */
export const preconnectApi = {
  get: (): Promise<PreconnectSnapshot> => ipcRenderer.invoke('browser:preconnect:get'),
  set: (patch: Partial<PreconnectSettings>): Promise<PreconnectSnapshot> => ipcRenderer.invoke('browser:preconnect:set', patch),
  onChange: (callback: (snapshot: PreconnectSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PreconnectSnapshot): void => callback(snapshot)
    ipcRenderer.on('browser:preconnect:changed', listener)
    return () => ipcRenderer.removeListener('browser:preconnect:changed', listener)
  },
  /**
   * Debounced address-bar text and the suggestion Enter is about (URL + source); main resolves it,
   * preconnects the origin, and prerenders a sure History/Bookmark match.
   */
  typed: (input: string, topSuggestionUrl: string | null, topSuggestionSource: string | null = null): void => ipcRenderer.send('browser:preconnect:typed', input, topSuggestionUrl, topSuggestionSource),
  /** The address bar stopped editing: drop any prerender. */
  typingEnded: (): void => ipcRenderer.send('browser:preconnect:typing-ended'),
  /** The pointer rested on a sleeping tab in the sidebar (dwell already timed); main warms the origin it will wake to. */
  hoverSleepingTab: (tabId: string): void => ipcRenderer.send('browser:preconnect:tab-hover', tabId)
}
