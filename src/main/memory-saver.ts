import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { freemem, totalmem } from 'node:os'
import {
  discardOrder,
  MAX_DISCARDS_PER_CHECK,
  MEMORY_CHECK_INTERVAL_MS,
  memoryPressure,
  parseMemorySaverSettings,
  UNSAVED_FORM_PROBE,
  type MemorySample,
  type MemorySaverSettings
} from '../shared/memory-saver'
import { getBrowserTabArchiveCandidates, getBrowserTabWebContents, setBrowserMemorySaverActive, suspendBrowserTab } from './browser'
import { isMainWindowRenderer, sendToMainWindowRenderers } from './browser-shell'
import { readUserJson, writeUserJson } from './user-json'

/**
 * Memory saver (Settings → General → Tabs): every 30 s, when memory is tight, discard up to two
 * least recently used background tabs (rules in shared/memory-saver.ts). On by default.
 */

const FILE = 'memory-saver.json'
let settings: MemorySaverSettings | null = null
let timer: ReturnType<typeof setInterval> | null = null
let checking = false
let discardedForMemory = 0

function current(): MemorySaverSettings {
  settings ??= parseMemorySaverSettings(readUserJson(FILE))
  return settings
}

function macPressureLevel(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2_000 }, (error, stdout) => {
      const level = Number(String(stdout).trim())
      resolve(error || !Number.isFinite(level) ? null : level)
    })
  })
}

async function sample(): Promise<MemorySample> {
  const totalMB = totalmem() / 1048576
  // Working set per process (KB), the number Activity Monitor / Task Manager are closest to.
  const surffishMB = app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0) / 1024
  if (process.platform === 'darwin') {
    // macOS keeps "free" memory near zero by design (file cache); the kernel's pressure level is the signal.
    return { totalMB, availableMB: null, macPressureLevel: await macPressureLevel(), surffishMB }
  }
  // Linux: libuv reads MemAvailable. Windows: available physical memory.
  const availableMB = process.platform === 'win32' ? process.getSystemMemoryInfo().free / 1024 : freemem() / 1048576
  return { totalMB, availableMB, macPressureLevel: null, surffishMB }
}

function hasUnsavedFormInput(id: string): Promise<boolean> {
  const contents = getBrowserTabWebContents(id)
  if (!contents) return Promise.resolve(false)
  return Promise.race([
    contents.executeJavaScript(UNSAVED_FORM_PROBE, false).then((value: unknown) => value !== false, () => true),
    // A hung page can't answer: leave it alone (the hung-tab handling covers it).
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_000))
  ])
}

/** One check: sample memory and discard up to MAX_DISCARDS_PER_CHECK tabs when it's tight. */
export async function checkMemoryPressure(): Promise<number> {
  if (checking || !current().enabled) return 0
  checking = true
  try {
    const now = Date.now()
    const order = discardOrder(getBrowserTabArchiveCandidates().map((tab) => ({
      id: tab.id,
      live: getBrowserTabWebContents(tab.id) !== null,
      onScreen: tab.active,
      audible: tab.audible,
      pinned: tab.pinned,
      protected: tab.extensionPage || tab.unsavedPdfEdits,
      inactiveSince: tab.inactiveSince
    })), now)
    // Nothing that could be discarded: skip the sample (no sysctl / metrics work at all).
    if (order.length === 0) return 0
    const reason = memoryPressure(await sample())
    if (!reason) return 0
    let discarded = 0
    for (const tab of order) {
      if (discarded >= MAX_DISCARDS_PER_CHECK) break
      if (await hasUnsavedFormInput(tab.id)) continue
      suspendBrowserTab(tab.id)
      discarded += 1
    }
    if (discarded > 0) {
      discardedForMemory += discarded
      console.info(`[memory-saver] ${reason === 'system' ? 'Low system memory' : 'Surffish over its memory share'}: discarded ${discarded} background tab(s).`)
    }
    return discarded
  } finally {
    checking = false
  }
}

function applySchedule(): void {
  setBrowserMemorySaverActive(current().enabled)
  if (current().enabled && !timer) {
    timer = setInterval(() => { void checkMemoryPressure().catch((error: unknown) => console.warn('Memory saver check failed:', error)) }, MEMORY_CHECK_INTERVAL_MS)
    timer.unref?.()
  } else if (!current().enabled && timer) {
    clearInterval(timer)
    timer = null
  }
}

export function initializeMemorySaver(): void {
  applySchedule()
}

export function disposeMemorySaver(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function snapshot(): MemorySaverSettings & { discarded: number } {
  return { ...current(), discarded: discardedForMemory }
}

function assertAppRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) throw new Error('This browser operation is available only to the app window.')
}

export function registerMemorySaverIpc(): void {
  ipcMain.handle('browser:memory-saver:get', (event) => {
    assertAppRenderer(event)
    return snapshot()
  })
  ipcMain.handle('browser:memory-saver:set', (event, patch: unknown) => {
    assertAppRenderer(event)
    const record = typeof patch === 'object' && patch !== null ? patch as Record<string, unknown> : {}
    if (typeof record.enabled === 'boolean') {
      settings = { ...current(), enabled: record.enabled }
      writeUserJson(FILE, settings)
      applySchedule()
      sendToMainWindowRenderers('browser:memory-saver:changed', snapshot())
    }
    return snapshot()
  })
}
