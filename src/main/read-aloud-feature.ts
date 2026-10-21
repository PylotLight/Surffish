import { ipcMain, type CustomScheme, type WebContents } from 'electron'
import { isReadAloudActive, READ_ALOUD_SCHEME, READ_ALOUD_SETTINGS_FILE, readAloudEnabledIn, type ReadAloudStatus } from '../shared/read-aloud-gate'
import { readUserJson } from './user-json'

/**
 * "Enable Read Aloud" gate (Settings → Integrations → Read Aloud, experimental, off by default). This
 * file is all main parses for Read Aloud at launch: the on/off flag, the engine scheme, the player
 * status menus need, and IPC stubs. Settings and IPC handling (read-aloud-settings.ts) load on the
 * first Read Aloud IPC call or reading; downloads, the hidden engine page and playback
 * (read-aloud.ts) when the feature is turned on, on the first reading or test, and never while it
 * is off. Turning it off stops any reading or download and closes the engine page; downloaded files
 * stay in the profile until Delete download.
 */
type SettingsModule = typeof import('./read-aloud-settings')

/** The engine page's scheme: fetch, a secure origin, module workers and cross-origin isolation (wasm threads). */
export const READ_ALOUD_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: READ_ALOUD_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true }
}

let enabled: boolean | null = null
let status: ReadAloudStatus = 'idle'
let settingsModule: SettingsModule | null = null
let settingsLoading: Promise<SettingsModule> | null = null
const enabledListeners = new Set<() => void>()

export function readAloudEnabled(): boolean {
  enabled ??= readAloudEnabledIn(readUserJson(READ_ALOUD_SETTINGS_FILE))
  return enabled
}

/** read-aloud-settings.ts, after a save: menus and the app menu's shortcut follow the switch. */
export function noteReadAloudEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  for (const listener of enabledListeners) listener()
}

export function onReadAloudEnabledChange(listener: () => void): () => void {
  enabledListeners.add(listener)
  return () => enabledListeners.delete(listener)
}

/** read-aloud.ts publishes every player state here, so menus can ask without loading it. */
export function noteReadAloudStatus(next: ReadAloudStatus): void {
  status = next
}

export function readAloudStatus(): ReadAloudStatus {
  return status
}

export function isReadAloudActiveNow(): boolean {
  return isReadAloudActive({ status })
}

/** Context menus' Read Aloud submenu: Pause or Resume while a reading runs. */
export function readAloudMenuState(): 'idle' | 'playing' | 'paused' {
  return status === 'paused' ? 'paused' : isReadAloudActive({ status }) ? 'playing' : 'idle'
}

function loadSettingsModule(): Promise<SettingsModule> {
  settingsLoading ??= import('./read-aloud-settings').then((loaded) => {
    settingsModule = loaded
    return loaded
  })
  return settingsLoading
}

/** Where a "Read from Here" starts: the right-click point in the page (view coordinates). */
export interface ReadAloudPoint {
  x: number
  y: number
}

/**
 * Read the page's article (Reader view's extraction), `selection`, or the page from a point out
 * loud. Always a user action (menu, palette, shortcut, Reader view button, Reading List's Listen);
 * private tabs read too, and nothing about the text is stored.
 */
export function readAloudFromPage(page: WebContents | null, target: 'page' | 'selection' | 'here', selection = '', point?: ReadAloudPoint): Promise<boolean> {
  if (!readAloudEnabled() || !page || page.isDestroyed()) return Promise.resolve(false)
  return loadSettingsModule().then((loaded) => loaded.readFromPage(page, target, selection, point))
}

export function controlReadAloud(action: 'toggle' | 'pause' | 'resume' | 'stop' | 'next' | 'previous'): void {
  if (!readAloudEnabled()) return
  void loadSettingsModule().then((loaded) => loaded.control(action))
}

/** The shortcut: pause / resume a reading, or read the page when none is going. */
export function toggleReadAloud(page: WebContents | null): void {
  if (!readAloudEnabled()) return
  if (isReadAloudActiveNow()) controlReadAloud('toggle')
  else void readAloudFromPage(page, 'page')
}

export function disposeReadAloudFeature(): void {
  settingsModule?.dispose()
}

/** Every Read Aloud channel; the handlers live in read-aloud-settings.ts and load on the first call. */
const CHANNELS = [
  'get-settings', 'set-settings', 'get-state', 'control', 'download-info', 'download-start', 'download-cancel',
  'delete-downloads', 'test-state', 'catalog', 'test', 'test-stop'
] as const
export type ReadAloudChannel = (typeof CHANNELS)[number]

export function registerReadAloudIpc(): void {
  for (const channel of CHANNELS) {
    ipcMain.handle(`browser:read-aloud:${channel}`, (event, ...args: unknown[]) => loadSettingsModule().then((loaded) => loaded.handleIpc(channel, event, args)))
  }
}
