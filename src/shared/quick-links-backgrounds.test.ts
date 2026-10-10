import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getQuickLinkBackgroundIndex,
  nextQuickLinkBackgroundIndex,
  QUICK_LINK_BACKGROUND_ROTATION_MS
} from './quick-links-backgrounds.ts'

test('rotates one locally bundled background every fifteen-minute slot and wraps', () => {
  const rotation = QUICK_LINK_BACKGROUND_ROTATION_MS
  assert.equal(getQuickLinkBackgroundIndex(0, 4), 0)
  assert.equal(getQuickLinkBackgroundIndex(rotation - 1, 4), 0)
  assert.equal(getQuickLinkBackgroundIndex(rotation, 4), 1)
  assert.equal(getQuickLinkBackgroundIndex(rotation * 3, 4), 3)
  assert.equal(getQuickLinkBackgroundIndex(rotation * 4, 4), 0)
})

test('manual next-background navigation wraps and normalizes its index', () => {
  assert.equal(nextQuickLinkBackgroundIndex(0, 4), 1)
  assert.equal(nextQuickLinkBackgroundIndex(3, 4), 0)
  assert.equal(nextQuickLinkBackgroundIndex(-1, 4), 0)
  assert.equal(nextQuickLinkBackgroundIndex(Number.NaN, 4), 1)
})

test('invalid time or image counts safely select the first background', () => {
  assert.equal(getQuickLinkBackgroundIndex(Number.NaN, 4), 0)
  assert.equal(getQuickLinkBackgroundIndex(0, 0), 0)
  assert.equal(getQuickLinkBackgroundIndex(0, -1), 0)
  assert.equal(nextQuickLinkBackgroundIndex(0, 0), 0)
})
