import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** Small JSON settings files in the profile (spellcheck, HTTPS-only, kill switch). */
export function readSettingsFile(filename: string): unknown {
  const path = join(app.getPath('userData'), filename)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    console.warn(`Could not read ${filename}:`, error)
    return null
  }
}

/** Atomic owner-only write; true when the file was saved. */
export function writeSettingsFile(filename: string, value: unknown): boolean {
  const directory = app.getPath('userData')
  const path = join(directory, filename)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    return true
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }) } catch { /* best-effort cleanup */ }
    console.error(`Could not save ${filename}:`, error)
    return false
  }
}
