import { app, ipcMain, type IpcMainInvokeEvent, type WebContents, type CustomScheme } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  IDLE_READ_ALOUD_DOWNLOAD,
  IDLE_READ_ALOUD_STATE,
  IDLE_READ_ALOUD_TEST,
  isReadAloudControl,
  parseReadAloudSettings,
  READ_ALOUD_DIRECTORY,
  READ_ALOUD_DISABLED_ERROR,
  READ_ALOUD_READY_FILE,
  READ_ALOUD_SCHEME,
  READ_ALOUD_SETTINGS_FILE,
  type ReadAloudControl,
  type ReadAloudDownloadState,
  type ReadAloudSettings,
  type ReadAloudState,
  type ReadAloudTestState
} from '../shared/read-aloud'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readUserJson, writeSettingsFile } from './user-json'

/**
 * "Enable Read Aloud" gate (Settings → Integrations → Read Aloud, experimental, off by default). This
 * file is all main loads for Read Aloud at launch: read-aloud.ts (downloads, the hidden engine page,
 * playback, the voice tester) is imported when the feature is turned on (which starts the model
 * download), on the first "Read Aloud" or test, and never while the feature is off. Turning it off
 * stops any reading or download and closes the engine page; downloaded files stay in the profile
 * until Delete download.
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
  } else if (next.enabled) {
    // On (or switched to Phonon): download the model now, so the first reading starts right away.
    const wantsModel = next.engine === 'phonon' && (!before.enabled || before.engine !== 'phonon')
    if (wantsModel) void loadModule().then((loaded) => { if (readAloudEnabled()) loaded.prepareReadAloud() })
    else if (next.engine === 'phonon' && next.voice !== before.voice) void loadModule().then((loaded) => { if (readAloudEnabled()) loaded.prefetchReadAloudVoice(next.voice) })
    module?.applyReadAloudSettings(next)
  }
  try { sendToMainWindowRenderers('browser:read-aloud:settings-changed', { ...next }) } catch { /* window closing */ }
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

/**
 * The download as the folder shows it, without loading read-aloud.ts (Settings while the feature is
 * off, or before anything ran this session). ready.json is written last, after every hash matched.
 */
function diskDownloadState(): ReadAloudDownloadState {
  const directory = readAloudDirectory()
  let bytes = 0
  let ready = false
  try {
    const marker = JSON.parse(readFileSync(join(directory, READ_ALOUD_READY_FILE), 'utf8')) as { bytes?: unknown }
    ready = true
    bytes = typeof marker.bytes === 'number' ? marker.bytes : 0
  } catch { /* not downloaded */ }
  let voices: string[] = []
  try {
    voices = readdirSync(join(directory, 'model', 'voices')).filter((name) => name.endsWith('.safetensors')).map((name) => name.slice(0, -'.safetensors'.length))
  } catch { /* none */ }
  return { ...IDLE_READ_ALOUD_DOWNLOAD, status: ready ? 'ready' : existsSync(directory) ? 'partial' : 'absent', bytes, voices: ready ? ['default', ...voices] : voices }
}

export function getReadAloudDownloadState(): ReadAloudDownloadState {
  return module?.readAloudDownloadState() ?? diskDownloadState()
}

export function getReadAloudTestState(): ReadAloudTestState {
  return module?.readAloudTestState() ?? { ...IDLE_READ_ALOUD_TEST }
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
  ipcMain.handle('browser:read-aloud:download-info', () => getReadAloudDownloadState())
  ipcMain.handle('browser:read-aloud:download-start', async (event) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    if (!readAloudEnabled()) return getReadAloudDownloadState()
    const loaded = await loadModule()
    if (readAloudEnabled()) loaded.prepareReadAloud()
    return getReadAloudDownloadState()
  })
  ipcMain.handle('browser:read-aloud:download-cancel', (event) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    module?.cancelReadAloudDownload()
    return getReadAloudDownloadState()
  })
  ipcMain.handle('browser:read-aloud:delete-downloads', async (event) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    if (module) return module.deleteReadAloudDownloads()
    await rm(readAloudDirectory(), { recursive: true, force: true }).catch(() => undefined)
    const state = diskDownloadState()
    try { sendToMainWindowRenderers('browser:read-aloud:download', state) } catch { /* window closing */ }
    return state
  })
  ipcMain.handle('browser:read-aloud:test-state', () => getReadAloudTestState())
  // The voice pickers' list (the English catalog, fetched once the model is there) and Advanced's model conditioners.
  ipcMain.handle('browser:read-aloud:catalog', async () => {
    if (!readAloudEnabled()) return { status: 'needs-model', voices: [], conditioners: [], error: READ_ALOUD_DISABLED_ERROR }
    return (await loadModule()).readAloudCatalog()
  })
  ipcMain.handle('browser:read-aloud:test', async (event, input: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    if (!readAloudEnabled()) return { ok: false, error: READ_ALOUD_DISABLED_ERROR }
    const loaded = await loadModule()
    if (!readAloudEnabled()) return { ok: false, error: READ_ALOUD_DISABLED_ERROR }
    return loaded.testReadAloud(input, current())
  })
  ipcMain.handle('browser:read-aloud:test-stop', (event) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    module?.stopReadAloudTest()
    return { ok: true }
  })
}
