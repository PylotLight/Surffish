import { ipcMain, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_AI_SETTINGS_FILE, parseLocalAISettings, type LocalAISettings } from '../shared/local-ai'
import { listPageSessions, onPageSessionCreated } from './browser-session'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readUserJson, writeSettingsFile } from './user-json'

/**
 * Built-in AI (experimental, Electron 45 `ses.registerLocalAIHandler`): when on, every non-private
 * page session hands Prompt API calls (`LanguageModel`) from its pages and extensions to one utility
 * process (local-ai-handler.ts), which answers through the selected provider (local-ai-providers.ts).
 * Off (the default): no handler, nothing forked, `LanguageModel.availability()` is 'unavailable'.
 * Changes apply at once; turning it off disconnects existing sessions in pages.
 */

const RESPAWN_LIMIT = 3
const RESPAWN_WINDOW_MS = 60_000

let settings: LocalAISettings | null = null
let child: UtilityProcess | null = null
let respawns: number[] = []

function current(): LocalAISettings {
  settings ??= parseLocalAISettings(readUserJson(LOCAL_AI_SETTINGS_FILE))
  return settings
}

function handlerPath(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'local-ai-handler.js')
  return existsSync(path) ? path : null
}

function ensureChild(): UtilityProcess | null {
  if (child) return child
  const path = handlerPath()
  if (!path) {
    console.warn('[local ai] handler script missing; built-in AI unavailable')
    return null
  }
  const now = Date.now()
  respawns = respawns.filter((at) => now - at < RESPAWN_WINDOW_MS)
  if (respawns.length >= RESPAWN_LIMIT) {
    console.warn('[local ai] handler keeps exiting; built-in AI stays off until it is toggled')
    return null
  }
  respawns.push(now)
  const forked = utilityProcess.fork(path, [], { serviceName: 'Surffish Local AI', stdio: 'inherit' })
  forked.postMessage({ type: 'settings', settings: current() })
  forked.once('exit', (code) => {
    if (child !== forked) return
    child = null
    console.warn(`[local ai] handler exited (${code})`)
    // Sessions still point at the dead process: hand them a new one (bounded above).
    if (current().enabled) applyToSessions()
  })
  child = forked
  return forked
}

function shouldServe(info: { isPrivate: boolean }): boolean {
  return current().enabled && !info.isPrivate
}

function applyToSessions(): void {
  const handler = current().enabled ? ensureChild() : null
  for (const { session, info } of listPageSessions()) session.registerLocalAIHandler(handler && shouldServe(info) ? handler : null)
  if (!handler && child) {
    const old = child
    child = null
    old.kill()
  }
}

export function getLocalAISettings(): LocalAISettings {
  return { ...current() }
}

export function setLocalAISettings(input: unknown): LocalAISettings {
  const next = parseLocalAISettings(typeof input === 'object' && input !== null ? input : {}, current())
  const toggled = next.enabled !== current().enabled
  settings = next
  writeSettingsFile(LOCAL_AI_SETTINGS_FILE, next)
  if (toggled) respawns = []
  child?.postMessage({ type: 'settings', settings: next })
  applyToSessions()
  try { sendToMainWindowRenderers('browser:local-ai:settings-changed', { ...next }) } catch { /* window closing */ }
  return { ...next }
}

/** Startup: register on page sessions as they are created (nothing is forked while it is off). */
export function initializeLocalAI(): void {
  void onPageSessionCreated((session, info) => {
    if (!shouldServe(info)) return
    const handler = ensureChild()
    if (handler) session.registerLocalAIHandler(handler)
  })
}

function fromAppWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWindowRenderer(event.sender, event.senderFrame)
}

export function registerLocalAIIpc(): void {
  ipcMain.handle('browser:local-ai:get-settings', () => getLocalAISettings())
  ipcMain.handle('browser:local-ai:set-settings', (event, input: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    return setLocalAISettings(input)
  })
}
