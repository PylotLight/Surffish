import { app, BaseWindow, ipcMain, powerMonitor, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { access, appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { freemem, loadavg, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import {
  debugStallsFromEnv,
  DEBUG_LOGGING_SETTINGS_FILE,
  formatSnapshot,
  formatStallLine,
  parseDebugLoggingSettings,
  shouldRotateStallLog,
  stallFromTick,
  stallLogPageLabel,
  STALL_HEARTBEAT_MS,
  STALL_LOG_NAME,
  STALL_LOG_ROTATED_NAME,
  STALL_PROBE_INTERVAL_MS,
  summarizeProcesses,
  type DebugLoggingSettings,
  snapshotWritesSince,
  type DebugLoggingState,
  type SnapshotWriteStats,
  type StallSnapshot
} from '../shared/stall-log'
import { readUserJson, writeSettingsFile } from './user-json'

/**
 * Debug logging (Settings → Advanced → Developer → Debug logging, ⌘K "Turn On Debug Logging", or
 * SURFFISH_DEBUG_STALLS=1 at launch). Off by default; while off nothing runs: no timers, no
 * listeners do any work (crash-guard's hooks return on one boolean). While on, appends to
 * <logs>/stalls.log (packaged macOS: ~/Library/Logs/Surffish/stalls.log), rotated at 5 MB:
 *
 *  - STALL: the main thread was away ≥ 500 ms (a 100 ms timer that fired late), with a snapshot of
 *    every process (type, CPU, working set), free memory, macOS memory pressure, load average,
 *    windows / tabs / awake tabs, hidden prerender views and recent wake snapshot disk writes;
 *  - HEARTBEAT every 30 s with the same snapshot, so a gap between heartbeats (with no SUSPEND line)
 *    shows the whole machine stopped, not just Surffish;
 *  - crash guard events: renderers unresponsive / responsive / gone, child processes gone (GPU
 *    included), app surface recovery reloads, main-process exceptions;
 *  - SUSPEND / RESUME / LOCK / UNLOCK from powerMonitor, so sleep doesn't read as a freeze.
 *
 * Pages are named by host only (stallLogPageLabel): no paths, queries or page content, and private
 * pages are never named. Appends are async (fs/promises), buffered and serialized; nothing here does
 * synchronous disk I/O on the main thread.
 */

/** Tabs / windows / prerender / snapshot writes: read from browser modules (wired in index.ts) so this stays import-light. */
export interface StallLogContext {
  windows: () => number
  tabs: () => { total: number; awake: number }
  prerenders: () => number
  /** Totals since launch; the log prints the change since the previous line. */
  snapshotWrites: () => SnapshotWriteStats
}

const FLUSH_MS = 250
const forcedByEnv = debugStallsFromEnv(process.env['SURFFISH_DEBUG_STALLS'])

let initialized = false
let settings: DebugLoggingSettings = { enabled: false }
let active = false
let context: StallLogContext | null = null
let probe: ReturnType<typeof setInterval> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let lastTick = 0
let lastHeartbeat = 0
let suspended = false
let macPressure: number | null = null
const NO_WRITES: SnapshotWriteStats = { files: 0, bytes: 0, flushes: 0, flushMs: 0 }
let lastSnapshotWrites: SnapshotWriteStats = NO_WRITES
const powerListeners: Array<[string, () => void]> = []

let buffer: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let writing: Promise<void> = Promise.resolve()
let logSize: number | null = null

export function stallLogPath(): string {
  return join(app.getPath('logs'), STALL_LOG_NAME)
}

/** Whether a line would be written right now (crash-guard checks this before building any detail). */
export function stallLogActive(): boolean {
  return active
}

export function setStallLogContext(next: StallLogContext): void {
  context = next
}

function now(): number {
  return performance.now()
}

// ---------------------------------------------------------------------------
// Writer: buffered, async, serialized, rotated.

function writeChunk(path: string, chunk: string): Promise<void> {
  return (async () => {
    if (logSize === null) {
      await mkdir(dirname(path), { recursive: true })
      logSize = await stat(path).then((info) => info.size, () => 0)
    }
    const bytes = Buffer.byteLength(chunk)
    if (shouldRotateStallLog(logSize, bytes)) {
      await rename(path, join(dirname(path), STALL_LOG_ROTATED_NAME)).catch(() => undefined)
      logSize = 0
    }
    await appendFile(path, chunk, { mode: 0o600 })
    logSize += bytes
  })().catch(() => {
    // Logs folder not writable: a debug log never gets in the way.
    logSize = null
  })
}

function flush(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (buffer.length === 0) return writing
  const chunk = buffer.join('')
  buffer = []
  let path: string
  try {
    path = stallLogPath()
  } catch {
    return writing
  }
  writing = writing.then(() => writeChunk(path, chunk))
  return writing
}

function write(kind: string, detail: string): void {
  buffer.push(formatStallLine(new Date(), kind, detail))
  flushTimer ??= setTimeout(() => void flush(), FLUSH_MS)
}

// ---------------------------------------------------------------------------
// Snapshot.

function refreshMacPressure(): void {
  if (process.platform !== 'darwin') return
  execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2_000 }, (_error, stdout) => {
    const level = Number(String(stdout ?? '').trim())
    macPressure = String(stdout ?? '').trim() !== '' && Number.isFinite(level) ? level : null
  })
}

function safe<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

function snapshot(): StallSnapshot {
  const tabs = context ? safe(context.tabs) : null
  const writes = context ? safe(context.snapshotWrites) : null
  let snapshotWrites: StallSnapshot['snapshotWrites'] = null
  if (writes) {
    snapshotWrites = snapshotWritesSince(writes, lastSnapshotWrites)
    lastSnapshotWrites = writes
  }
  return {
    processes: summarizeProcesses(safe(() => app.getAppMetrics()) ?? []),
    freeMB: freemem() / 1048576,
    totalMB: totalmem() / 1048576,
    macPressure,
    load: loadavg(),
    windows: context ? safe(context.windows) : null,
    tabs: tabs?.total ?? null,
    awakeTabs: tabs?.awake ?? null,
    prerenders: context ? safe(context.prerenders) : null,
    snapshotWrites
  }
}

// ---------------------------------------------------------------------------
// Probe and heartbeat.

function onProbe(): void {
  const at = now()
  const elapsed = at - lastTick
  lastTick = at
  if (suspended) return
  const stall = stallFromTick(elapsed)
  if (stall !== null) write('stall', `main thread blocked ~${stall}ms (app ${appFocusState()}) | ${formatSnapshot(snapshot())}`)
}

/** macOS can throttle a background app's timers (App Nap), so a stall while no window is focused is weaker evidence. */
function appFocusState(): string {
  return safe(() => BaseWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused())) ? 'focused' : 'in background'
}

function onHeartbeat(): void {
  const at = now()
  const gap = Math.round(at - lastHeartbeat)
  lastHeartbeat = at
  refreshMacPressure()
  // A late heartbeat is the interesting part: the gap says how long nothing ran.
  const late = gap - STALL_HEARTBEAT_MS > 2_000 ? ` (late: ${gap}ms since the previous one)` : ''
  write('heartbeat', `app ${appFocusState()} | ${formatSnapshot(snapshot())}${late}`)
}

function start(): void {
  if (active) return
  active = true
  suspended = false
  lastTick = now()
  lastHeartbeat = lastTick
  lastSnapshotWrites = (context ? safe(context.snapshotWrites) : null) ?? NO_WRITES
  probe = setInterval(onProbe, STALL_PROBE_INTERVAL_MS)
  heartbeat = setInterval(onHeartbeat, STALL_HEARTBEAT_MS)
  probe.unref?.()
  heartbeat.unref?.()
  for (const [event, label] of [['suspend', 'system going to sleep'], ['resume', 'system woke'], ['lock-screen', 'screen locked'], ['unlock-screen', 'screen unlocked']] as const) {
    const listener = (): void => {
      if (event === 'suspend') suspended = true
      if (event === 'resume') {
        suspended = false
        lastTick = now()
        lastHeartbeat = lastTick
      }
      write(event === 'suspend' || event === 'resume' ? event : event.replace('-screen', ''), label)
    }
    try {
      powerMonitor.on(event as 'suspend', listener)
      powerListeners.push([event, listener])
    } catch {
      // No powerMonitor (unit tests).
    }
  }
  refreshMacPressure()
  write('debug', `logging on${forcedByEnv ? ' (SURFFISH_DEBUG_STALLS=1)' : ''}: Surffish ${app.getVersion()}${app.isPackaged ? '' : ' dev'}, Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, ${process.platform} ${process.arch} | ${formatSnapshot(snapshot())}`)
}

function stop(): void {
  if (!active) return
  write('debug', 'logging off')
  active = false
  if (probe) clearInterval(probe)
  if (heartbeat) clearInterval(heartbeat)
  probe = null
  heartbeat = null
  for (const [event, listener] of powerListeners.splice(0)) {
    try { powerMonitor.removeListener(event as 'suspend', listener) } catch { /* gone */ }
  }
  void flush()
}

function apply(): void {
  if (forcedByEnv || settings.enabled) start()
  else stop()
}

// ---------------------------------------------------------------------------
// Events from crash-guard.ts and the rest of main. Cheap no-ops while off.

/** One event line (crash guard, recovery, child process). */
export function stallLogEvent(kind: string, detail: string): void {
  if (!active) return
  write(kind, detail)
}

/** A webContents event, naming the page by host only (private pages: never). */
export function stallLogContentsEvent(kind: string, contents: WebContents, detail = ''): void {
  if (!active) return
  write(kind, `${describeContents(contents)}${detail ? ` ${detail}` : ''}`)
}

function describeContents(contents: WebContents): string {
  try {
    if (contents.isDestroyed()) return 'destroyed'
    let isPrivate = false
    try { isPrivate = !contents.session.isPersistent() } catch { /* no session */ }
    return `${contents.getType()} ${stallLogPageLabel(contents.getURL(), isPrivate)}`
  } catch {
    return 'webContents'
  }
}

// ---------------------------------------------------------------------------
// Settings, IPC, command palette.

export function getDebugLoggingState(): DebugLoggingState {
  return { enabled: settings.enabled, forcedByEnv, active, logPath: safe(stallLogPath) ?? STALL_LOG_NAME }
}

export function setDebugLogging(input: unknown): DebugLoggingState {
  settings = parseDebugLoggingSettings(typeof input === 'object' && input !== null ? input : {}, settings)
  writeSettingsFile(DEBUG_LOGGING_SETTINGS_FILE, settings)
  apply()
  return getDebugLoggingState()
}

/** Show stalls.log in Finder (its folder when there is no log yet). */
export async function revealStallLog(): Promise<void> {
  await flush()
  const path = stallLogPath()
  const exists = await access(path).then(() => true, () => false)
  if (exists) shell.showItemInFolder(path)
  else {
    await mkdir(dirname(path), { recursive: true }).catch(() => undefined)
    await shell.openPath(dirname(path))
  }
}

/** After ready (userData and the app name are final by then): read the setting and start if on. */
export function initializeStallLogger(): void {
  if (initialized) return
  initialized = true
  settings = parseDebugLoggingSettings(readUserJson(DEBUG_LOGGING_SETTINGS_FILE))
  apply()
  app.on('will-quit', () => {
    if (!active) return
    write('debug', 'quitting')
    void flush()
  })
}

type AppWindowCheck = (sender: WebContents, frame: IpcMainInvokeEvent['senderFrame']) => boolean

/** `isMainWindowRenderer` comes from browser-shell.ts (passed in so crash-guard's import of this module stays light). */
export function registerDebugLoggingIpc(isMainWindowRenderer: AppWindowCheck): void {
  const fromAppWindow = (event: IpcMainInvokeEvent): boolean => isMainWindowRenderer(event.sender, event.senderFrame)
  ipcMain.handle('browser:debug-logging:get', () => getDebugLoggingState())
  ipcMain.handle('browser:debug-logging:set', (event, input: unknown) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    return setDebugLogging(input)
  })
  ipcMain.handle('browser:debug-logging:reveal', async (event) => {
    if (!fromAppWindow(event)) throw new Error('This browser operation is available only to the app window.')
    await revealStallLog()
    return true
  })
}
