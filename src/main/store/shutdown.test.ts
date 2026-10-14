import { afterAll, describe, expect, mock, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { FILE_DB_TEST_TIMEOUT_MS, storeTestDir } from './test-temp-dir'

// A stand-in Electron `app` that records listeners, so the test can play the quit sequence.
const listeners = new Map<string, Array<() => void>>()
const directory = storeTestDir('surffish-shutdown-')
mock.module('electron', () => ({
  app: {
    getPath: () => directory,
    getVersion: () => '0.0.0-test',
    on: (event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }
  }
}))

const { deferWrite, isShuttingDownWrites } = await import('../deferred-writes')
const { closeProfileDatabase, getProfileDatabase, reportStoreWriteError } = await import('./index')
const { isStoreClosedError, SurffishDatabase } = await import('./database')

function emit(event: string, order: 'registered' | 'reversed' = 'registered'): void {
  const list = [...(listeners.get(event) ?? [])]
  for (const listener of order === 'reversed' ? list.reverse() : list) listener()
}

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('profile database shutdown order', () => {
  test('a write still queued at quit lands before surffish.db closes, then later writes run at once', () => {
    const db = getProfileDatabase()
    expect(db).not.toBeNull()
    // Queue a save on a timer, the way session/Spaces/bookmark saves are queued.
    deferWrite('test-late-save', () => db!.setMeta('late-save', 'landed'), 60_000)
    // `app.exit()` skips 'will-quit' and emits 'quit'. The database's close hook was registered first
    // (getProfileDatabase ran before deferWrite), so it runs before the deferred-writes hook here;
    // play it both ways to prove the order doesn't depend on that.
    emit('quit', 'registered')
    expect(db!.isOpen).toBe(false)
    expect(isShuttingDownWrites()).toBe(true)

    const reopened = SurffishDatabase.open({ path: join(directory, 'surffish.db') })
    try {
      expect(reopened.getMeta('late-save')).toBe('landed')
    } finally {
      reopened.close()
    }

    // After quit a new write runs straight away (no timer left to fire against a closed database).
    let ran = false
    deferWrite('test-after-quit', () => { ran = true }, 60_000)
    expect(ran).toBe(true)
    emit('quit', 'reversed')
    closeProfileDatabase()
  }, FILE_DB_TEST_TIMEOUT_MS)

  test('a write against the closed database is a quiet StoreClosedError, not a log line', () => {
    const db = getProfileDatabase()!
    expect(db.isOpen).toBe(false)
    let caught: unknown
    try {
      db.transaction(() => db.setMeta('too-late', 'x'))
    } catch (error) {
      caught = error
    }
    expect(isStoreClosedError(caught)).toBe(true)
    expect(() => db.checkpoint()).not.toThrow()

    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { logged.push(args) }
    try {
      reportStoreWriteError('Could not save the session to the database:', caught)
      expect(logged).toHaveLength(0)
      reportStoreWriteError('Could not save the session to the database:', new Error('disk full'))
      expect(logged).toHaveLength(1)
    } finally {
      console.error = original
    }
  }, FILE_DB_TEST_TIMEOUT_MS)
})
