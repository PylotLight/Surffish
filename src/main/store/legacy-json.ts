import { existsSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { SurffishDatabase } from './database'

/**
 * Bookkeeping for moving a JSON store into SQLite without ever losing data.
 *
 * The JSON file is left in place after import (so an older build, or a run where the database
 * fails to open, still has it). The database remembers the file's size+mtime at import time;
 * if the file later changes (a fallback run wrote to it), the next open imports it again,
 * merging by stable id, so nothing written during a fallback run is lost.
 */

export interface LegacyFileStamp {
  size: number
  mtimeMs: number
}

function metaKey(filename: string): string {
  return `legacy:${filename}`
}

export function legacyFileStamp(path: string): LegacyFileStamp | null {
  try {
    const stats = statSync(path)
    return { size: stats.size, mtimeMs: Math.floor(stats.mtimeMs) }
  } catch {
    return null
  }
}

/** True when `path` exists and differs from what was last imported (or was never imported). */
export function legacyFileNeedsImport(db: SurffishDatabase, filename: string, path: string): boolean {
  const stamp = legacyFileStamp(path)
  if (!stamp) return false
  const saved = db.getMeta(metaKey(filename))
  if (!saved) return true
  try {
    const parsed = JSON.parse(saved) as Partial<LegacyFileStamp>
    return parsed.size !== stamp.size || parsed.mtimeMs !== stamp.mtimeMs
  } catch {
    return true
  }
}

/** Remember the file as imported in its current state. */
export function markLegacyFileImported(db: SurffishDatabase, filename: string, path: string, extra: Record<string, unknown> = {}): void {
  const stamp = legacyFileStamp(path)
  if (!stamp) return
  db.setMeta(metaKey(filename), JSON.stringify({ ...stamp, importedAt: Date.now(), ...extra }))
}

export function readLegacyJson(path: string): unknown {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    console.warn(`Could not read ${path}:`, error)
    return null
  }
}

/** Atomic owner-only rewrite (used to apply a privacy delete to the legacy copy too). */
export function writeLegacyJson(path: string, value: unknown): boolean {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    return true
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }) } catch { /* best-effort cleanup */ }
    console.error(`Could not rewrite ${path}:`, error)
    return false
  }
}

/**
 * After saving a store to both surffish.db and its JSON file, record whether the JSON file can be
 * trusted to match the database at the next start:
 * - both landed: stamp the file as ours, so the next start reads the database;
 * - the database write failed: drop the stamp, so the next start reads (and re-imports) the JSON;
 * - only the JSON write failed: keep the old stamp. The file still matches it, so the next start
 *   reads the database, which has the newer data.
 */
export function settleDualWrite(db: SurffishDatabase | null, filename: string, path: string, databaseSaved: boolean, jsonSaved: boolean): void {
  // Closed at quit: the JSON file was just written, so it no longer matches the stamp and wins anyway.
  if (!db || !db.isOpen) return
  try {
    if (databaseSaved && jsonSaved) markLegacyFileImported(db, filename, path)
    else if (!databaseSaved) db.deleteMeta(metaKey(filename))
  } catch (error) {
    console.warn(`Could not update the ${filename} import stamp:`, error)
  }
}

/**
 * True when the database's copy of a store should be read at startup: it has one (`hasSavedCopy`)
 * and the JSON file is gone or unchanged since Surffish last wrote/imported it. A JSON file changed
 * by anything else (a `SURFFISH_STORE=json` run, an older build) wins and is imported instead.
 */
export function databaseCopyIsCurrent(db: SurffishDatabase, filename: string, path: string, hasSavedCopy: boolean): boolean {
  if (!hasSavedCopy) return false
  return !existsSync(path) || !legacyFileNeedsImport(db, filename, path)
}
