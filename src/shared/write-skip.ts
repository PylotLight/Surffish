/**
 * Skips re-writing a small JSON file with exactly what it already holds.
 *
 * Start-up re-saves the session, preferences and window geometry with what was just read
 * (normalising the session, renderers re-sending the search engine, restore move/resize events),
 * and tab bursts re-save an unchanged session. Each of those was a temp-file write + rename.
 *
 * A write is skipped only when the text matches what this process last read or wrote for that
 * path AND the file is still there AND (when the caller cares) it was owner-only when read. A
 * deleted file, a failed write, or a world-readable file left by an older build always writes.
 */
export type FileTextCache = {
  /** Remember what a path holds after a read or a successful write. `ownerOnly: false` = never skip it. */
  remember(path: string, text: string, ownerOnly?: boolean): void
  /** Forget a path (failed write, file removed): the next save always writes. */
  forget(path: string): void
  /** True when writing `text` would leave the file as it is. `fileExists` is checked last, only on a match. */
  isUnchanged(path: string, text: string, fileExists: (path: string) => boolean): boolean
}

export function createFileTextCache(): FileTextCache {
  const known = new Map<string, string>()
  return {
    remember(path, text, ownerOnly = true) {
      if (ownerOnly) known.set(path, text)
      else known.delete(path)
    },
    forget(path) {
      known.delete(path)
    },
    isUnchanged(path, text, fileExists) {
      return known.get(path) === text && fileExists(path)
    }
  }
}

/** POSIX mode bits with no group/other access. Windows has no such bits, so any mode counts. */
export function isOwnerOnlyMode(mode: number, platform: string): boolean {
  return platform === 'win32' || (mode & 0o077) === 0
}
