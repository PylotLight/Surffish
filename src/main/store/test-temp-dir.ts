import { accessSync, constants, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** How long (ms) a file-backed SQLite test may take before bun fails it (bun defaults to 5 s). */
export const FILE_DB_TEST_TIMEOUT_MS = 30_000

/**
 * A fresh directory for unit tests that open real surffish.db files. On Linux it lives in /dev/shm
 * (RAM) when that is writable: every open, journal_mode switch and migration commit fsyncs, and on
 * the CI pods' disks that made trivial tests take 1.5-8 s (two hit bun's 5 s default timeout) while
 * they take ~5 ms locally. The SQLite code under test is the same; only the medium changes. Falls back
 * to the OS temp dir everywhere else.
 */
export function storeTestDir(prefix: string): string {
  return mkdtempSync(join(fastTempRoot(), prefix))
}

function fastTempRoot(): string {
  if (process.platform === 'linux') {
    try {
      accessSync('/dev/shm', constants.W_OK)
      return '/dev/shm'
    } catch { /* no writable tmpfs */ }
  }
  return tmpdir()
}
