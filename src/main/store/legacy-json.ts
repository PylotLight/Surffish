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
