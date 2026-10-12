import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activateStagedDirectory, assertExtensionIdentity, extensionWorkerStamp, writeJsonAtomic } from './extension-staging.ts'

function withTemp(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'surffish-staging-test-'))
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function dir(path: string, marker: string): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'marker'), marker)
  return path
}

test('activation swaps directories and commit drops the backup', () => withTemp((root) => {
  const final = dir(join(root, 'ext', '1.0'), 'old')
  const staged = dir(join(root, 'staged'), 'new')
  const activation = activateStagedDirectory(staged, final)
  assert.equal(activation.backedUp, true)
  assert.equal(readFileSync(join(final, 'marker'), 'utf8'), 'new')
  activation.commit()
  assert.deepEqual(readdirSync(join(root, 'ext')), ['1.0'])
}))

test('rollback restores the previous directory', () => withTemp((root) => {
  const final = dir(join(root, 'ext', '1.0'), 'old')
  const activation = activateStagedDirectory(dir(join(root, 'staged'), 'new'), final)
  activation.rollback()
  assert.equal(readFileSync(join(final, 'marker'), 'utf8'), 'old')
  assert.deepEqual(readdirSync(join(root, 'ext')), ['1.0'])
  const fresh = activateStagedDirectory(dir(join(root, 'staged2'), 'first'), join(root, 'other', '2.0'))
  assert.equal(fresh.backedUp, false)
  fresh.rollback()
  assert.equal(existsSync(join(root, 'other', '2.0')), false)
}))

test('identity check, worker stamp, and atomic JSON', () => withTemp((root) => {
  assert.doesNotThrow(() => assertExtensionIdentity('a', 'a', 'x'))
  assert.throws(() => assertExtensionIdentity('a', 'b', 'Chrome Web Store package'), /would change its extension identity/)
  writeFileSync(join(root, 'sw.js'), 'one')
  const first = extensionWorkerStamp(root, ['sw.js', 'missing.js'])
  writeFileSync(join(root, 'sw.js'), 'two')
  assert.notEqual(extensionWorkerStamp(root, ['sw.js', 'missing.js']), first)
  writeJsonAtomic(join(root, 'nested', 'installed.json'), { a: 1 })
  writeJsonAtomic(join(root, 'nested', 'installed.json'), { a: 2 })
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'nested', 'installed.json'), 'utf8')), { a: 2 })
  assert.deepEqual(readdirSync(join(root, 'nested')), ['installed.json'])
}))
