import { app, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadEntry, DownloadState } from '../shared/downloads'
import { safeDownloadFilename, safeDownloadSource, safeStoredDownloadSource } from '../shared/downloads'
import { markBrowserDownloadStarted } from './browser'
import { onPageSessionCreated } from './browser-session'
import { sendToMainWindowRenderers } from './browser-shell'
import { deferWrite } from './deferred-writes'

const HISTORY_FILENAME = 'downloads-history.json'
const MAX_DOWNLOAD_HISTORY = 300

type DownloadItemState = Electron.DownloadItem
interface StoredDownload extends DownloadEntry {
  /** Kept in the private app-data store for explicit Open/Reveal actions; never sent to the renderer. */
  filePath: string
  /** Started from a private tab: listed this session only, never written to download history. */
  isPrivate?: boolean
}

let initialized = false
let records: StoredDownload[] = []
const activeItems = new Map<string, DownloadItemState>()

function historyPath(): string {
  return join(app.getPath('userData'), HISTORY_FILENAME)
}

function isDownloadState(value: unknown): value is DownloadState {
  return value === 'progressing' || value === 'paused' || value === 'interrupted' || value === 'completed' || value === 'cancelled' || value === 'failed'
}

function parseStoredDownload(value: unknown): StoredDownload | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.filename !== 'string' || typeof item.source !== 'string' || !isDownloadState(item.state)) return null
  if (typeof item.startedAt !== 'number' || !Number.isFinite(item.startedAt)) return null
  return {
    id: item.id.slice(0, 100),
    filename: safeDownloadFilename(item.filename),
    source: safeStoredDownloadSource(item.source),
    startedAt: item.startedAt,
    completedAt: typeof item.completedAt === 'number' && Number.isFinite(item.completedAt) ? item.completedAt : null,
    receivedBytes: typeof item.receivedBytes === 'number' && Number.isFinite(item.receivedBytes) ? Math.max(0, item.receivedBytes) : 0,
    totalBytes: typeof item.totalBytes === 'number' && Number.isFinite(item.totalBytes) ? Math.max(0, item.totalBytes) : 0,
    state: item.state,
    canResume: item.canResume === true,
    fileAvailable: false,
    message: typeof item.message === 'string' ? item.message.slice(0, 300) : null,
    filePath: typeof item.filePath === 'string' ? item.filePath : ''
  }
}

function persistHistory(): void {
  deferWrite('downloads', writeHistory, 1000)
}

function writeHistory(): void {
  const target = historyPath()
  mkdirSync(join(target, '..'), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  const stored = records.filter((record) => !record.isPrivate).slice(0, MAX_DOWNLOAD_HISTORY).map(({ fileAvailable: _fileAvailable, ...record }) => record)
  try {
    writeFileSync(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, target)
  } catch {
    try { writeFileSync(target, `${JSON.stringify(stored)}\n`, { mode: 0o600 }) } catch {
      // Keep downloads working if the local metadata store is unavailable; never log file paths or source URLs.
      console.warn('Could not persist download history.')
    }
  }
}

function loadHistory(): void {
  try {
    const parsed: unknown = JSON.parse(readFileSync(historyPath(), 'utf8'))
    if (!Array.isArray(parsed)) return
    records = parsed.map(parseStoredDownload).filter((entry): entry is StoredDownload => entry !== null).slice(0, MAX_DOWNLOAD_HISTORY)
  } catch {
    records = []
  }
  const now = Date.now()
  let changed = false
  for (const record of records) {
    if (record.state === 'progressing' || record.state === 'paused' || record.state === 'interrupted') {
      record.state = 'failed'
      record.canResume = false
      record.completedAt = now
      record.message = 'This download stopped when Surffish closed and cannot be resumed here.'
      changed = true
    }
  }
  if (changed) persistHistory()
}

function fileExists(record: StoredDownload): boolean {
  return Boolean(record.filePath) && existsSync(record.filePath)
}

function publicEntries(): DownloadEntry[] {
  return records.map(({ filePath, isPrivate: _isPrivate, ...record }) => ({ ...record, fileAvailable: record.state === 'completed' && fileExists({ ...record, filePath }) }))
}

function publishDownloads(): void {
  try {
    sendToMainWindowRenderers('browser:downloads:changed', publicEntries())
  } catch {
    // A renderer closing while a transfer updates must not interrupt the download.
  }
}

let publishTimer: ReturnType<typeof setTimeout> | null = null
let lastPublishAt = 0
const PUBLISH_INTERVAL_MS = 200

/** Progress ticks arrive many times a second; renderers only need ~5 repaints a second. */
function schedulePublish(): void {
  if (publishTimer) return
  const wait = Math.max(0, PUBLISH_INTERVAL_MS - (Date.now() - lastPublishAt))
  publishTimer = setTimeout(() => {
    publishTimer = null
    lastPublishAt = Date.now()
    publishDownloads()
  }, wait)
}

function persistAndPublish(): void {
  records = records.slice(0, MAX_DOWNLOAD_HISTORY)
  persistHistory()
  schedulePublish()
}

function itemPath(item: DownloadItemState): string {
  try { return item.getSavePath() } catch { return '' }
}

function updateFromItem(record: StoredDownload, item: DownloadItemState, state?: string): void {
  record.filename = safeDownloadFilename(item.getFilename())
  record.receivedBytes = Math.max(0, item.getReceivedBytes())
  record.totalBytes = Math.max(0, item.getTotalBytes())
  record.filePath = itemPath(item) || record.filePath
  const canResume = (() => { try { return item.canResume() } catch { return false } })()
  record.canResume = canResume
  const paused = (() => { try { return item.isPaused() } catch { return false } })()
  if (state === 'interrupted') {
    record.state = canResume ? 'interrupted' : 'failed'
    record.message = canResume ? 'The download was interrupted. Resume to try again.' : 'The download was interrupted and cannot be resumed.'
  } else if (state === 'completed') {
    record.state = 'completed'
    record.completedAt = Date.now()
    record.message = null
  } else if (state === 'cancelled') {
    record.state = 'cancelled'
    record.completedAt = Date.now()
    record.message = 'Cancelled.'
  } else if (state === 'failed') {
    record.state = 'failed'
    record.completedAt = Date.now()
    record.canResume = false
    record.message = 'The download failed or was interrupted.'
  } else {
    record.state = paused ? 'paused' : 'progressing'
    record.message = null
  }
  record.fileAvailable = record.state === 'completed' && fileExists(record)
}

export function initializeDownloads(): void {
  if (initialized) return
  initialized = true
  loadHistory()
  void onPageSessionCreated((target, info) => {
    // Skip what an earlier listener already turned down (an omnibox prerender that hit a download).
    target.on('will-download', (event, item, webContents) => {
      if (!event.defaultPrevented) trackDownload(item, webContents, info.isPrivate)
    })
  })
}

/** Private session ended: drop its finished entries from the list (files on disk are untouched). */
export function forgetPrivateDownloads(): void {
  const before = records.length
  records = records.filter((record) => !record.isPrivate || activeItems.has(record.id))
  if (records.length !== before) persistAndPublish()
}

function trackDownload(item: DownloadItemState, webContents: Electron.WebContents, isPrivate: boolean): void {
  {
    markBrowserDownloadStarted(webContents.id)
    const startSeconds = item.getStartTime()
    const id = randomUUID()
    const startTime = Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds * 1000 : Date.now()
    const record: StoredDownload = {
      id,
      filename: safeDownloadFilename(item.getFilename()),
      source: safeDownloadSource(item.getURL()),
      startedAt: startTime,
      completedAt: null,
      receivedBytes: Math.max(0, item.getReceivedBytes()),
      totalBytes: Math.max(0, item.getTotalBytes()),
      state: item.isPaused() ? 'paused' : 'progressing',
      canResume: false,
      fileAvailable: false,
      message: null,
      filePath: itemPath(item),
      ...(isPrivate ? { isPrivate: true } : {})
    }
    records.unshift(record)
    activeItems.set(id, item)
    persistAndPublish()

    item.on('updated', (_downloadEvent, state) => {
      updateFromItem(record, item, state)
      persistAndPublish()
    })
    item.on('done', (_downloadEvent, state) => {
      updateFromItem(record, item, state)
      if (state !== 'interrupted' || !record.canResume) activeItems.delete(id)
      persistAndPublish()
    })
  }
}

export function getDownloadHistory(): DownloadEntry[] {
  return publicEntries()
}

function getActiveItem(id: string): DownloadItemState | undefined {
  return activeItems.get(id)
}

function refreshActiveRecord(id: string, item: DownloadItemState): void {
  const record = records.find((entry) => entry.id === id)
  if (!record) return
  updateFromItem(record, item)
  persistAndPublish()
}

export function pauseDownload(id: string): boolean {
  const item = getActiveItem(id)
  if (!item) return false
  try {
    if (item.isPaused()) return false
    item.pause()
    refreshActiveRecord(id, item)
    return true
  } catch { return false }
}

export function resumeDownload(id: string): boolean {
  const item = getActiveItem(id)
  if (!item) return false
  try {
    if (item.isPaused() || item.canResume()) {
      item.resume()
      refreshActiveRecord(id, item)
      return true
    }
  } catch {
    return false
  }
  return false
}

export function cancelDownload(id: string): boolean {
  const item = getActiveItem(id)
  if (!item) return false
  try { item.cancel(); return true } catch { return false }
}

export function removeDownload(id: string): boolean {
  const index = records.findIndex((record) => record.id === id)
  if (index < 0 || activeItems.has(id)) return false
  records.splice(index, 1)
  persistAndPublish()
  return true
}

export async function openDownload(id: string): Promise<boolean> {
  const record = records.find((entry) => entry.id === id)
  if (!record || record.state !== 'completed' || !fileExists(record)) return false
  try {
    return (await shell.openPath(record.filePath)) === ''
  } catch {
    return false
  }
}

export function revealDownload(id: string): boolean {
  const record = records.find((entry) => entry.id === id)
  if (!record || !fileExists(record)) return false
  try { shell.showItemInFolder(record.filePath); return true } catch { return false }
}

/** Clears every finished entry from the list (active transfers stay). Never deletes files. */
export function clearDownloadHistory(): boolean {
  const before = records.length
  records = records.filter((record) => activeItems.has(record.id))
  if (records.length !== before) persistAndPublish()
  return true
}

export async function openDownloadsFolder(): Promise<boolean> {
  try {
    return (await shell.openPath(app.getPath('downloads'))) === ''
  } catch {
    return false
  }
}

/** A file Surffish wrote itself (e.g. Save in the PDF editor): listed like a finished download. */
export function recordSavedFile(saved: { filePath: string; sourceUrl: string; bytes: number; isPrivate: boolean }): void {
  const now = Date.now()
  records.unshift({
    id: randomUUID(),
    filename: safeDownloadFilename(saved.filePath),
    source: safeDownloadSource(saved.sourceUrl),
    startedAt: now,
    completedAt: now,
    receivedBytes: Math.max(0, saved.bytes),
    totalBytes: Math.max(0, saved.bytes),
    state: 'completed',
    canResume: false,
    fileAvailable: true,
    message: null,
    filePath: saved.filePath,
    ...(saved.isPrivate ? { isPrivate: true } : {})
  })
  persistAndPublish()
}

/** Clear browsing data: drop finished entries started at or after `since` (files on disk are untouched). */
export function clearDownloadHistorySince(since: number): number {
  const before = records.length
  records = records.filter((record) => activeItems.has(record.id) || record.startedAt < since)
  const removed = before - records.length
  if (removed > 0) persistAndPublish()
  return removed
}
