/**
 * Shared install plumbing for extensions Surffish stages itself (Bramble and Chrome Web Store
 * extensions): atomic JSON records, atomic directory activation with rollback, identity checks,
 * and loading with a fresh service worker when Surffish's injected worker scripts change.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Write JSON via temp file + rename, keeping a backup until the new file is in place. */
export function writeJsonAtomic(targetPath: string, value: unknown): void {
  mkdirSync(dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  const backupPath = `${targetPath}.${randomUUID()}.backup`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  let backedUp = false
  try {
    if (existsSync(targetPath)) {
      renameSync(targetPath, backupPath)
      backedUp = true
    }
    renameSync(temporaryPath, targetPath)
  } catch (error) {
    if (backedUp && !existsSync(targetPath) && existsSync(backupPath)) renameSync(backupPath, targetPath)
    rmSync(temporaryPath, { force: true })
    throw error
  }
  if (backedUp) {
    try {
      rmSync(backupPath, { force: true })
    } catch {
      // The verified new file is already active; a stale backup is harmless.
    }
  }
}

export interface StagedActivation {
  /** True when an existing directory was moved aside. */
  readonly backedUp: boolean
  /** Keep the new directory and delete the backup. */
  commit(): void
  /** Remove the new directory and put the previous one back. */
  rollback(): void
}

/** Move `stagedDirectory` into `finalDirectory`, keeping any existing directory as a backup. */
export function activateStagedDirectory(stagedDirectory: string, finalDirectory: string): StagedActivation {
  const backupDirectory = `${finalDirectory}.backup-${randomUUID()}`
  let backedUp = false
  let activated = false
  mkdirSync(dirname(finalDirectory), { recursive: true })
  if (existsSync(finalDirectory)) {
    renameSync(finalDirectory, backupDirectory)
    backedUp = true
  }
  try {
    renameSync(stagedDirectory, finalDirectory)
    activated = true
  } catch (error) {
    if (backedUp && existsSync(backupDirectory)) renameSync(backupDirectory, finalDirectory)
    throw error
  }
  return {
    get backedUp() { return backedUp },
    commit() {
      if (backedUp) {
        try {
          rmSync(backupDirectory, { recursive: true, force: true })
        } catch {
          // Keep the successful install; an unreferenced backup can be cleaned up later.
        }
      }
    },
    rollback() {
      if (activated && existsSync(finalDirectory)) rmSync(finalDirectory, { recursive: true, force: true })
      if (backedUp && existsSync(backupDirectory)) renameSync(backupDirectory, finalDirectory)
    }
  }
}

export function assertExtensionIdentity(expectedId: string, actualId: string, label: string): void {
  if (expectedId !== actualId) {
    throw new Error(`The ${label} would change its extension identity (${actualId} instead of ${expectedId}). The existing copy was left in place.`)
  }
}

/** Fingerprint of the scripts an extension's background worker loads, to spot a stale registration. */
export function extensionWorkerStamp(directory: string, files: readonly string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    const path = join(directory, file)
    hash.update(file).update('\0').update(existsSync(path) ? readFileSync(path) : '').update('\0')
  }
  return hash.digest('hex')
}

/**
 * Load an extension, making sure its background worker runs the scripts on disk. Electron keeps
 * running the previously registered service worker while the extension version is unchanged, so a
 * Surffish shim update (or a restage) never reached the background. When the worker scripts differ
 * from the last load, drop the stale registration and load again.
 */
export async function loadExtensionWithFreshWorker(
  browserSession: Electron.Session,
  directory: string,
  stampPath: string,
  workerFiles: readonly string[]
): Promise<Electron.Extension> {
  const stamp = extensionWorkerStamp(directory, workerFiles)
  const previous = existsSync(stampPath) ? readFileSync(stampPath, 'utf8') : ''
  let extension = await browserSession.extensions.loadExtension(directory)
  if (previous !== stamp) {
    await browserSession.clearStorageData({ origin: extension.url.replace(/\/$/, ''), storages: ['serviceworkers'] })
    browserSession.extensions.removeExtension(extension.id)
    extension = await browserSession.extensions.loadExtension(directory)
    mkdirSync(dirname(stampPath), { recursive: true })
    writeFileSync(stampPath, stamp)
  }
  return extension
}
