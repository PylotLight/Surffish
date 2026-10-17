import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseWakeSnapshotManifest,
  planWakeSnapshotDisk,
  serializeWakeSnapshotManifest,
  WAKE_SNAPSHOT_DISK_WRITE_DELAY_MS,
  wakeSnapshotUrlKey,
  type WakeSnapshotDiskEntry
} from '../shared/wake-snapshot-disk'
import { wakeSnapshotFits } from '../shared/wake-snapshot'
import { writeFileAtomic } from './atomic-file'
import { cancelDeferredWrite, deferWrite } from './deferred-writes'

/**
 * Wake snapshots on disk (rules in shared/wake-snapshot-disk.ts): `wake-snapshots/` in the profile,
 * one owner-only JPEG per page plus `index.json`. Written a moment after the in-memory snapshot is
 * kept (one deferred write per burst of tab switches, flushed on quit), read back only when a tab
 * with no snapshot in memory is opened (a restored tab's first wake after a restart).
 */

const DIR = 'wake-snapshots'
const MANIFEST = 'index.json'
const WRITE_KEY = 'wake-snapshots'
const DEBUG = process.env.SURFFISH_WAKE_SNAPSHOT_DEBUG === '1'

interface PendingPicture {
  entry: WakeSnapshotDiskEntry
  jpeg: Buffer
}

/** By file key; null until first used (read from index.json then). */
let entries: Map<string, WakeSnapshotDiskEntry> | null = null
const pending = new Map<string, PendingPicture>()
let manifestDirty = false

function dirPath(): string {
  return join(app.getPath('userData'), DIR)
}

function fileFor(key: string): string {
  return join(dirPath(), `${key}.jpg`)
}

/** One picture per page per session partition (a Space with its own logins shows its own copy). */
function keyFor(urlKey: string, partition: string): string {
  return createHash('sha256').update(`${partition}\n${urlKey}`).digest('hex').slice(0, 32)
}

function loaded(): Map<string, WakeSnapshotDiskEntry> {
  if (entries) return entries
  entries = new Map()
  try {
    const raw = JSON.parse(readFileSync(join(dirPath(), MANIFEST), 'utf8')) as unknown
    for (const entry of parseWakeSnapshotManifest(raw)) entries.set(entry.key, entry)
  } catch {
    // Nothing saved yet (or unreadable): start empty; stray files are removed by the next prune.
  }
  return entries
}

function removeFile(key: string): void {
  try { unlinkSync(fileFor(key)) } catch { /* already gone */ }
}

/** Apply the cap/age plan (optionally only `keepKeys`), removing the files that fall out. */
function enforce(keepKeys?: ReadonlySet<string>): void {
  const all = loaded()
  const { drop } = planWakeSnapshotDisk([...all.values()], { now: Date.now(), keepKeys })
  for (const entry of drop) {
    all.delete(entry.key)
    pending.delete(entry.key)
    removeFile(entry.key)
    manifestDirty = true
  }
}

function flush(): void {
  const all = loaded()
  for (const [key, picture] of pending) {
    try {
      writeFileAtomic(fileFor(key), picture.jpeg)
      all.set(key, picture.entry)
      manifestDirty = true
    } catch (error) {
      console.warn('[wake-snapshot] could not save a snapshot to disk:', error)
    }
  }
  pending.clear()
  enforce()
  if (!manifestDirty) return
  try {
    writeFileAtomic(join(dirPath(), MANIFEST), JSON.stringify(serializeWakeSnapshotManifest([...all.values()])))
    manifestDirty = false
  } catch (error) {
    console.warn('[wake-snapshot] could not save the snapshot index:', error)
  }
}

function scheduleFlush(): void {
  deferWrite(WRITE_KEY, flush, WAKE_SNAPSHOT_DISK_WRITE_DELAY_MS)
}

/** Keep a (non-private) tab's snapshot for after a restart; replaces any older picture of the same page. */
export function saveWakeSnapshotToDisk(url: string, partition: string, jpeg: Buffer, pageArea: { width: number; height: number }): void {
  const urlKey = wakeSnapshotUrlKey(url)
  if (!urlKey || jpeg.length === 0) return
  const key = keyFor(urlKey, partition)
  pending.set(key, { jpeg, entry: { key, url, width: pageArea.width, height: pageArea.height, bytes: jpeg.length, savedAt: Date.now() } })
  scheduleFlush()
}

/** The saved picture of `url` if it would still fit `pageArea` (read synchronously: one small file, on a tab's first wake only). */
export function readWakeSnapshotFromDisk(url: string, partition: string, pageArea: { width: number; height: number }): { jpeg: Buffer; width: number; height: number; url: string } | null {
  const urlKey = wakeSnapshotUrlKey(url)
  if (!urlKey) return null
  const key = keyFor(urlKey, partition)
  const waiting = pending.get(key)
  if (waiting) return wakeSnapshotFits(waiting.entry, pageArea) ? { jpeg: waiting.jpeg, width: waiting.entry.width, height: waiting.entry.height, url: waiting.entry.url } : null
  const entry = loaded().get(key)
  if (!entry || !wakeSnapshotFits(entry, pageArea)) return null
  if (planWakeSnapshotDisk([entry], { now: Date.now() }).keep.length === 0) return null
  try {
    const jpeg = readFileSync(fileFor(key))
    if (DEBUG) console.info(`[wake-snapshot] read from disk for ${url} (${Math.round(jpeg.length / 1024)} KB)`)
    return { jpeg, width: entry.width, height: entry.height, url: entry.url }
  } catch {
    loaded().delete(key)
    manifestDirty = true
    scheduleFlush()
    return null
  }
}

/** The page's tab was closed (and no other open tab shows it): its picture goes too. */
export function forgetWakeSnapshotOnDisk(url: string, partition: string): void {
  const urlKey = wakeSnapshotUrlKey(url)
  if (!urlKey) return
  const key = keyFor(urlKey, partition)
  const had = pending.delete(key)
  if (!loaded().has(key)) {
    if (had) scheduleFlush()
    return
  }
  loaded().delete(key)
  removeFile(key)
  manifestDirty = true
  scheduleFlush()
}

/** After a restore: only pictures of pages that are open somewhere stay (and nothing over the caps). */
export function pruneWakeSnapshotsOnDisk(openPages: readonly { url: string; partition: string }[]): void {
  const keep = new Set<string>()
  for (const page of openPages) {
    const urlKey = wakeSnapshotUrlKey(page.url)
    if (urlKey) keep.add(keyFor(urlKey, page.partition))
  }
  for (const key of pending.keys()) keep.add(key)
  enforce(keep)
  // Files the index doesn't know (a crash between writes, an older index) go as well.
  const known = new Set([...loaded().keys(), ...pending.keys()])
  try {
    for (const name of readdirSync(dirPath())) {
      const match = /^([a-f0-9]{32})\.jpg$/.exec(name)
      if (match && !known.has(match[1])) removeFile(match[1])
      else if (name.endsWith('.tmp')) rmSync(join(dirPath(), name), { force: true })
    }
  } catch {
    // No folder yet.
  }
  if (manifestDirty) scheduleFlush()
}

/** Clear Browsing Data for a time range / Forget This Site: the saved pictures of matching pages go. */
export function forgetWakeSnapshotsOnDisk(matches: (url: string) => boolean): void {
  const all = loaded()
  for (const [key, picture] of [...pending]) if (matches(picture.entry.url)) pending.delete(key)
  for (const [key, entry] of [...all]) {
    if (!matches(entry.url)) continue
    all.delete(key)
    removeFile(key)
    manifestDirty = true
  }
  if (manifestDirty) scheduleFlush()
}

/** Clear Browsing Data for all time (history or cache): every saved picture goes. */
export function clearWakeSnapshotsOnDisk(): void {
  cancelDeferredWrite(WRITE_KEY)
  pending.clear()
  entries = new Map()
  manifestDirty = false
  try { rmSync(dirPath(), { recursive: true, force: true }) } catch (error) { console.warn('[wake-snapshot] could not clear saved snapshots:', error) }
}
