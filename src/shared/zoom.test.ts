import assert from 'node:assert/strict'
import test from 'node:test'
import { formatZoomPercent, isDefaultZoom, normalizeZoomFactor, stepZoomFactor } from './zoom.ts'

test('zoom steps walk the preset list and stop at the ends', () => {
  assert.equal(stepZoomFactor(1, 1), 1.1)
  assert.equal(stepZoomFactor(1.1, 1), 1.25)
  assert.equal(stepZoomFactor(1, -1), 0.9)
  assert.equal(stepZoomFactor(5, 1), 5)
  assert.equal(stepZoomFactor(0.25, -1), 0.25)
})

test('zoom steps from an in-between factor land on the neighbouring preset', () => {
  assert.equal(stepZoomFactor(1.05, 1), 1.1)
  assert.equal(stepZoomFactor(1.05, -1), 1)
})

test('zoom factors are validated, clamped and formatted', () => {
  assert.equal(normalizeZoomFactor('1.5'), null)
  assert.equal(normalizeZoomFactor(Number.NaN), null)
  assert.equal(normalizeZoomFactor(0), null)
  assert.equal(normalizeZoomFactor(9), 5)
  assert.equal(normalizeZoomFactor(1.333), 1.33)
  assert.equal(isDefaultZoom(1.001), true)
  assert.equal(formatZoomPercent(1.1), '110%')
  assert.equal(formatZoomPercent(0.67), '67%')
})
