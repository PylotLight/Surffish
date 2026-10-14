import { app } from 'electron'
import { join } from 'node:path'
import { beginShutdownWrites } from '../deferred-writes'
import { isStoreClosedError, StoreOpenError, SurffishDatabase } from './database'

/**
 * The profile database for this run, opened lazily on first use.
 *
 * Safe fallback: if the database can't be opened (no node:sqlite, a schema from a newer build,
 * disk errors), `getProfileDatabase()` returns null and every store keeps using its JSON file as
 * before. A corrupt file is moved aside once (`surffish.db.corrupt-<time>`) and a fresh database
 * is created; the JSON files are never deleted, so the next import brings the data back.
 *
 * `SURFFISH_STORE=json` forces the JSON path (kill switch for debugging or a bad release).
 */

export const PROFILE_DB_FILE = 'surffish.db'

export type ProfileStoreStatus =
  | { backend: 'sqlite'; path: string; deviceId: string; recoveredFrom?: string }
  | { backend: 'json'; reason: string }

let database: SurffishDatabase | null = null
let status: ProfileStoreStatus | null = null
let quitHookInstalled = false

export function profileDatabasePath(): string {
  return join(app.getPath('userData'), PROFILE_DB_FILE)
}

function open(path: string): SurffishDatabase {
  return SurffishDatabase.open({ path, platform: process.platform, appVersion: app.getVersion() })
}

export function getProfileDatabase(): SurffishDatabase | null {
  if (status) return database
  if (process.env.SURFFISH_STORE === 'json') {
    status = { backend: 'json', reason: 'SURFFISH_STORE=json' }
    return null
  }
  const path = profileDatabasePath()
  try {
    database = open(path)
    status = { backend: 'sqlite', path, deviceId: database.deviceId }
  } catch (error) {
    if (error instanceof StoreOpenError && error.kind === 'corrupt') {
      const movedTo = SurffishDatabase.quarantine(path)
      if (movedTo) {
        try {
          database = open(path)
          status = { backend: 'sqlite', path, deviceId: database.deviceId, recoveredFrom: movedTo }
          console.warn(`surffish.db was unreadable; moved it to ${movedTo} and started a fresh one (re-importing JSON stores).`)
        } catch (retryError) {
          database = null
          status = { backend: 'json', reason: String(retryError) }
        }
      } else {
        status = { backend: 'json', reason: error.message }
      }
    } else {
      database = null
      status = { backend: 'json', reason: error instanceof Error ? error.message : String(error) }
    }
    if (!database) console.error('Profile database unavailable; using JSON stores:', status.backend === 'json' ? status.reason : '')
  }
  installQuitHook()
  return database
}

/**
 * Close surffish.db at quit, after every queued write has landed. Deferred writes are flushed
 * here first (and run at once from then on), so a save timer can't fire against a closed database
 * whichever 'quit' listener Electron calls first. `app.exit()` (smokes, crash paths) skips
 * 'will-quit' but still emits 'quit', so this covers it too.
 */
export function closeProfileDatabase(): void {
  if (!database?.isOpen) return
  beginShutdownWrites()
  database.close()
}

/**
 * Log a failed database write unless it only failed because the database closed at quit: the
 * caller keeps its JSON copy, and that file (newer than the import stamp) wins at the next start.
 */
export function reportStoreWriteError(message: string, error: unknown): void {
  if (isStoreClosedError(error)) return
  console.error(message, error)
}

function installQuitHook(): void {
  if (quitHookInstalled) return
  quitHookInstalled = true
  try {
    // After 'will-quit' deferred writes flush; close last so a final write still lands.
    app.on('quit', closeProfileDatabase)
  } catch {
    // Unit tests import modules without a live Electron app.
  }
}
