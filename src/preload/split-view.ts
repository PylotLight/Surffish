import { ipcRenderer } from 'electron'
import type { BrowserBounds } from '../shared/types'

export interface SplitViewSnapshot {
  splits: { id: string; tabIds: string[]; sizes: number[] }[]
  visible: { id: string; focusedTabId: string; panes: BrowserBounds[]; dividers: BrowserBounds[] } | null
}

/** window.api.browser.split: split view actions (the sidebar reads membership from the tab summaries). */
export const splitViewApi = {
  get: (): Promise<SplitViewSnapshot> => ipcRenderer.invoke('browser:split:get'),
  /** `id` left, `otherId` right. */
  with: (id: string, otherId: string): Promise<boolean> => ipcRenderer.invoke('browser:split:with', id, otherId),
  /** Show `id` next to the active tab. */
  open: (id: string): Promise<boolean> => ipcRenderer.invoke('browser:split:open', id),
  toggle: (): Promise<boolean> => ipcRenderer.invoke('browser:split:toggle'),
  unsplit: (id?: string): Promise<boolean> => ipcRenderer.invoke('browser:split:unsplit', id),
  swap: (id?: string): Promise<boolean> => ipcRenderer.invoke('browser:split:swap', id),
  popOut: (id?: string): Promise<boolean> => ipcRenderer.invoke('browser:split:pop-out', id),
  focusPane: (offset: -1 | 1): Promise<boolean> => ipcRenderer.invoke('browser:split:focus-pane', offset),
  drop: (id: string, side: 'left' | 'right'): Promise<boolean> => ipcRenderer.invoke('browser:split:drop', id, side)
}
