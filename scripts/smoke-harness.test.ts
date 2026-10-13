import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { ADBLOCK_CACHE_FILE, FULL_FILTER_CONFIG, isFullFilterConfig } from '../src/main/adblock-policy.ts'

const smoke = createRequire(import.meta.url)('./smoke-adblock-config.cjs')

test('the smokes seed an adblock engine the app accepts as its cache (no filter download at launch)', () => {
  assert.equal(smoke.ADBLOCK_CACHE_FILE, ADBLOCK_CACHE_FILE)
  assert.deepEqual({ ...smoke.ADBLOCK_CONFIG }, { ...FULL_FILTER_CONFIG })
  assert.equal(isFullFilterConfig(smoke.ADBLOCK_CONFIG), true)
})

test('smoke-only Chromium switches against the Linux OOM-score log spam', () => {
  const { smokeChromiumArgs } = createRequire(import.meta.url)('./smoke-chromium-args.cjs')
  const missing = '/nonexistent/electron'
  assert.deepEqual(smokeChromiumArgs(missing, [], {}, 'darwin'), [], 'never on macOS')
  assert.deepEqual(smokeChromiumArgs(missing, [], { ELECTRON_DISABLE_SANDBOX: '1' }, 'linux'), ['--no-sandbox', '--no-zygote'])
  assert.deepEqual(smokeChromiumArgs(missing, ['--no-sandbox'], {}, 'linux'), ['--no-sandbox', '--no-zygote'])
  assert.deepEqual(smokeChromiumArgs(missing, [], { ELECTRON_DISABLE_SANDBOX: '1', SMOKE_KEEP_ZYGOTE: '1' }, 'linux'), [])
  assert.deepEqual(smokeChromiumArgs(missing, [], {}, 'linux'), [], 'sandbox on without a setuid helper: leave the sandbox choice alone')
})
