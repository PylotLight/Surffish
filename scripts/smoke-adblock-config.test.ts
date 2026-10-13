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
