import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchoredPopupBounds, centredPopupAnchor, fitBoundsToDisplays, parseSavedWindowState } from './window-geometry.ts'

const area = { x: 0, y: 25, width: 1728, height: 1092 }
const size = { width: 500, height: 550 }

test('popup right-aligns under a toolbar button near the right edge', () => {
  const content = { x: 200, y: 100, width: 1240, height: 820 }
  const anchor = { x: 1160.5, y: 9.25, width: 32, height: 32 }
  const bounds = anchoredPopupBounds(anchor, content, area, size, { x: 0, y: 0 })
  assert.equal(bounds.x + bounds.width, Math.round(200 + 1160.5 + 32))
  assert.equal(bounds.y, Math.round(100 + 9.25 + 32 + 6))
  assert.ok(Number.isInteger(bounds.x) && Number.isInteger(bounds.y))
})

test('popup falls back to left-aligned when right-aligning would leave the screen', () => {
  const content = { x: 0, y: 25, width: 800, height: 600 }
  const bounds = anchoredPopupBounds({ x: 40, y: 8, width: 32, height: 32 }, content, area, size, { x: 0, y: 0 })
  assert.equal(bounds.x, 40)
})

test('popup flips above when there is no room below', () => {
  const content = { x: 0, y: 25, width: 1728, height: 1092 }
  const bounds = anchoredPopupBounds({ x: 900, y: 1000, width: 32, height: 32 }, content, area, size, { x: 0, y: 0 })
  assert.equal(bounds.y, 25 + 1000 - 550 - 6)
})

test('saved state parsing rejects junk and rounds', () => {
  assert.equal(parseSavedWindowState(null), null)
  assert.equal(parseSavedWindowState({ bounds: { x: 1, y: 2, width: 0, height: 5 } }), null)
  assert.deepEqual(parseSavedWindowState({ bounds: { x: 1.4, y: 2, width: 900.6, height: 700 }, maximized: true }), {
    bounds: { x: 1, y: 2, width: 901, height: 700 }, maximized: true, fullScreen: false
  })
})

test('bounds on a disconnected monitor are dropped', () => {
  assert.equal(fitBoundsToDisplays({ x: 3000, y: 100, width: 1200, height: 800 }, [area], { width: 800, height: 540 }), null)
})

test('bounds spilling off the edge are nudged back and shrunk to fit', () => {
  const fitted = fitBoundsToDisplays({ x: 1400, y: 10, width: 2000, height: 800 }, [area], { width: 800, height: 540 })
  assert.deepEqual(fitted, { x: 0, y: 25, width: 1728, height: 800 })
})

test('bounds pick the display they mostly sit on', () => {
  const second = { x: 1728, y: 0, width: 2560, height: 1415 }
  const fitted = fitBoundsToDisplays({ x: 2000, y: 200, width: 1240, height: 820 }, [area, second], { width: 800, height: 540 })
  assert.deepEqual(fitted, { x: 2000, y: 200, width: 1240, height: 820 })
})

test('centredPopupAnchor centres the popup over the window content', () => {
  const content = { x: 100, y: 50, width: 1400, height: 900 }
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  const size = { width: 500, height: 550 }
  const bounds = anchoredPopupBounds(centredPopupAnchor(content, size), content, workArea, size, { x: 0, y: 0 })
  assert.equal(bounds.x, 100 + (1400 - 500) / 2)
  assert.equal(bounds.y, 50 + (900 - 550) / 2)
  assert.equal(bounds.width, 500)
  assert.equal(bounds.height, 550)
})
