import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic-file'

/** Small private JSON files in userData (command palette, search keywords, feature settings…). */
export function readUserJson(filename: string): unknown {
  const path = join(app.getPath('userData'), filename)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    console.warn(`Could not read ${filename}:`, error)
    return null
  }
}

/** Atomic owner-only write; true when the file was saved. `pretty` keeps hand-editable settings files indented. */
export function writeUserJson(filename: string, value: unknown, options: { pretty?: boolean } = {}): boolean {
  try {
    writeFileAtomic(join(app.getPath('userData'), filename), options.pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Could not save ${filename}:`, error)
    return false
  }
}

/** Small JSON settings files in the profile (spellcheck, HTTPS-only, kill switch, Spaces, Glance…). */
export const readSettingsFile = readUserJson

/** Same as writeUserJson, indented (these files predate the compact ones and stay byte-identical). */
export function writeSettingsFile(filename: string, value: unknown): boolean {
  return writeUserJson(filename, value, { pretty: true })
}
