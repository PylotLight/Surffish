import assert from 'node:assert/strict'
import test from 'node:test'
import { createFileTextCache, isOwnerOnlyMode } from './write-skip.ts'

const exists = () => true
const missing = () => false

test('an unchanged write is skipped only after a read or write of the same text', () => {
  const cache = createFileTextCache()
  assert.equal(cache.isUnchanged('/p/session.json', '{"a":1}', exists), false)
  cache.remember('/p/session.json', '{"a":1}')
  assert.equal(cache.isUnchanged('/p/session.json', '{"a":1}', exists), true)
  assert.equal(cache.isUnchanged('/p/session.json', '{"a":2}', exists), false)
  assert.equal(cache.isUnchanged('/p/other.json', '{"a":1}', exists), false)
})

test('a deleted file is always rewritten, and existence is only checked on a match', () => {
  const cache = createFileTextCache()
  cache.remember('/p/prefs.json', 'x')
  assert.equal(cache.isUnchanged('/p/prefs.json', 'x', missing), false)
  let checks = 0
  cache.isUnchanged('/p/prefs.json', 'y', () => { checks++; return true })
  assert.equal(checks, 0)
})

test('clearing writes different text, and the cleared state then skips repeats', () => {
  const cache = createFileTextCache()
  cache.remember('/p/session.json', '{"tabs":["https://a.test/"]}')
  const cleared = '{"tabs":[]}'
  assert.equal(cache.isUnchanged('/p/session.json', cleared, exists), false)
  cache.remember('/p/session.json', cleared)
  assert.equal(cache.isUnchanged('/p/session.json', cleared, exists), true)
  // Old content written again after the clear (e.g. reopening the same tab) is a change.
  assert.equal(cache.isUnchanged('/p/session.json', '{"tabs":["https://a.test/"]}', exists), false)
})

test('a failed write or a non-owner-only read never skips', () => {
  const cache = createFileTextCache()
  cache.remember('/p/session.json', 'x')
  cache.forget('/p/session.json')
  assert.equal(cache.isUnchanged('/p/session.json', 'x', exists), false)
  cache.remember('/p/session.json', 'x')
  cache.remember('/p/session.json', 'x', false)
  assert.equal(cache.isUnchanged('/p/session.json', 'x', exists), false)
})

test('owner-only modes', () => {
  assert.equal(isOwnerOnlyMode(0o100600, 'darwin'), true)
  assert.equal(isOwnerOnlyMode(0o100644, 'linux'), false)
  assert.equal(isOwnerOnlyMode(0o100640, 'darwin'), false)
  assert.equal(isOwnerOnlyMode(0o100666, 'win32'), true)
})
