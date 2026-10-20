import { app, ipcMain, type IpcMainInvokeEvent, type WebContents, type CustomScheme } from 'electron'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  IDLE_READ_ALOUD_STATE,
  isReadAloudControl,
  parseReadAloudSettings,
  READ_ALOUD_DIRECTORY,
  READ_ALOUD_DISABLED_ERROR,
  READ_ALOUD_READY_FILE,
  READ_ALOUD_SCHEME,
  READ_ALOUD_SETTINGS_FILE,
  type ReadAloudControl,
  type ReadAloudSettings,
  type ReadAloudState
} from '../shared/read-aloud'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readUserJson, writeSettingsFile } from './user-json'

/**
 * "Enable Read Aloud" gate (Settings → Features, experimental, off by default). This file is all main
 * loads for Read Aloud at launch: read-aloud.ts (downloads, the hidden engine page, playback) is
 * imported on the first "Read Aloud" and never while the feature is off. Turning it off stops any
 * reading and closes the engine page; downloaded files stay in the profile for next time.
 */
type ReadAloudModule = typeof import('./read-aloud')

/** The engine page's scheme: fetch, a secure origin, module workers and cross-origin isolation (wasm threads). */
export const READ_ALOUD_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: READ_ALOUD_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true }
}

let settings: ReadAloudSettings | null = null
let module: ReadAloudModule | null = null
let loading: Promise<ReadAloudModule> | null = null
const listeners = new Set<(enabled: boolean) => void>()

function current(): ReadAloudSettings {
  settings ??= parseReadAloudSettings(readUserJson(READ_ALOUD_SETTINGS_FILE))
  return settings
}

export function readAloudEnabled(): boolean {
  return current().enabled
}

export function getReadAloudSettings(): ReadAloudSettings {
  return { ...current() }
}

/** App menu and similar main-side entry points rebuild when the setting changes. */
export function onReadAloudEnabledChange(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function loadModule(): Promise<ReadAloudModule> {
  loading ??= import('./read-aloud').then((loaded) => {
    module = loaded
    return loaded
  })
  return loading
}

/** The player state, without loading the module (idle until the first reading). */
export function getReadAloudState(): ReadAloudState {
  return module?.readAloudState() ?? { ...IDLE_READ_ALOUD_STATE, speed: current().speed, voice: current().voice }
}

export function isReadAloudActiveNow(): boolean {
  const status = getReadAloudState().status
  return status === 'downloading' || status === 'loading' || status === 'playing' || status === 'paused'
}

export function setReadAloudSettings(input: unknown): ReadAloudSettings {
  const before = current()
  const next = parseReadAloudSettings(input, before)
  settings = next
  writeSettingsFile(READ_ALOUD_SETTINGS_FILE, next)
  if (before.enabled && !next.enabled) {
    module?.disposeReadAloud()
  } else if (next.enabled && module) {
    module.applyReadAloudSettings(next)
  }
  try { sendToMainWindowRenderers('browser:read-aloud:settings-changed', { ...next }) } catch { /* window closing */ }
  if (before.enabled !== next.enabled) {
    for (const listener of listeners) {
      try { listener(next.enabled) } catch (error) { console.warn('Read Aloud toggle listener failed:', error) }
    }
  }
  return { ...next }
}

/**
 * Read the page's article (Reader view's extraction) or `selection` out loud. Always a user action
 * (menu, palette, shortcut, Reader view button); private tabs read too, and nothing about the text
 * is stored.
 */
export async function readAloudFromPage(page: WebContents | null, target: 'page' | 'selection', selection = ''): Promise<boolean> {
  if (!readAloudEnabled() || !page || page.isDestroyed()) return false
  const loaded = await loadModule()
  if (!readAloudEnabled()) return false
  return loaded.startReadAloud(page, target, selection, current())
}

export function controlReadAloud(action: ReadAloudControl): void {
  if (!readAloudEnabled()) return
  module?.controlReadAloud(action)
}

export function disposeReadAloudFeature(): void {
  module?.disposeReadAloud()
}

export function readAloudDirectory(): string {
  return join(app.getPath('userData'), READ_ALOUD_DIRECTORY)
}

/** The runtime and model were downloaded and checked (read-aloud.ts writes the marker last). */
export function readAloudDownloaded(): boolean {
  return existsSync(join(readAloudDirectory(), READ_ALOUD_READY_FILE))
}

function fromAppWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWindowRenderer(event.sender, event.senderFrame)
}

export function registerReadAloudIpc(): void {
  ipcMain.handle('browser:read-aloud:get-settings', () => getReadAloudSettings())
  ipcMain.handle('browser:read-aloud:set-settings', (event, input: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    return setReadAloudSettings(input)
  })
  ipcMain.handle('browser:read-aloud:get-state', () => getReadAloudState())
  ipcMain.handle('browser:read-aloud:control', (event, action: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    if (!readAloudEnabled()) return { ok: false, error: READ_ALOUD_DISABLED_ERROR }
    if (!isReadAloudControl(action)) return { ok: false, error: 'unknown control' }
    controlReadAloud(action)
    return { ok: true }
  })
  ipcMain.handle('browser:read-aloud:download-info', () => ({ downloaded: readAloudDownloaded() }))
  ipcMain.handle('browser:read-aloud:delete-downloads', async (event) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    module?.disposeReadAloud()
    await rm(readAloudDirectory(), { recursive: true, force: true }).catch(() => undefined)
    return { downloaded: readAloudDownloaded() }
  })
}
