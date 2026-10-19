import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { penWidthFactor, strokeOutline } from './signature-ink'

function bounds(outline: number[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let index = 0; index < outline.length; index += 2) {
    minX = Math.min(minX, outline[index]!); maxX = Math.max(maxX, outline[index]!)
    minY = Math.min(minY, outline[index + 1]!); maxY = Math.max(maxY, outline[index + 1]!)
  }
  return [minX, minY, maxX, maxY]
}

test('a mouse stroke thins as it speeds up; a pen follows pressure', () => {
  const slow = penWidthFactor({ pointerType: 'mouse', pressure: 0.5, speed: 0.1 }, null)
  const fast = penWidthFactor({ pointerType: 'mouse', pressure: 0.5, speed: 3 }, null)
  assert.ok(fast < slow, `${fast} < ${slow}`)
  const light = penWidthFactor({ pointerType: 'pen', pressure: 0.1, speed: 0 }, null)
  const heavy = penWidthFactor({ pointerType: 'pen', pressure: 0.9, speed: 0 }, null)
  assert.ok(light < heavy)
  // Eased: one fast sample after a slow one only moves part of the way.
  const eased = penWidthFactor({ pointerType: 'mouse', pressure: 0.5, speed: 4 }, slow)
  assert.ok(eased < slow && eased > fast)
  for (const factor of [slow, fast, light, heavy, eased]) assert.ok(factor >= 0.45 && factor <= 1.5)
})

test('a stroke outline wraps the line at roughly the pen width, tapered at the ends', () => {
  const points: number[] = []
  for (let x = 0; x <= 200; x += 10) points.push(x, 50)
  const outline = strokeOutline(points, undefined, 4)
  assert.equal(outline.length % 2, 0)
  assert.ok(outline.every(Number.isFinite))
  const [minX, minY, maxX, maxY] = bounds(outline)
  assert.ok(minX >= -3 && maxX <= 203, `x ${minX}..${maxX}`)
  assert.ok(maxY - minY > 3 && maxY - minY < 4.5, `height ${maxY - minY}`)
  // Bolder pen, wider outline.
  const [, boldMinY, , boldMaxY] = bounds(strokeOutline(points, undefined, 8))
  assert.ok(boldMaxY - boldMinY > (maxY - minY) * 1.6)
})

test('per-point widths change the outline; dots and empty strokes are handled', () => {
  const points = [0, 0, 50, 0, 100, 0, 150, 0, 200, 0]
  const thin = bounds(strokeOutline(points, [0.5, 0.5, 0.5, 0.5, 0.5], 6))
  const thick = bounds(strokeOutline(points, [1.4, 1.4, 1.4, 1.4, 1.4], 6))
  assert.ok(thick[3] - thick[1] > (thin[3] - thin[1]) * 2)
  const dot = strokeOutline([10, 10], undefined, 4)
  assert.ok(dot.length >= 12)
  const [dx0, , dx1] = bounds(dot)
  assert.ok(dx1 - dx0 > 3)
  assert.deepEqual(strokeOutline([], undefined, 3), [])
})
