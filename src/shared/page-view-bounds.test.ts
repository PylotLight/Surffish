import { describe, expect, test } from 'bun:test'
import { initialPageViewBounds, pageViewBounds } from './page-view-bounds'

const area = { x: 0, y: 50, width: 1200, height: 750 }
const pane = { x: 600, y: 50, width: 600, height: 750 }

describe('page view bounds', () => {
  test('on screen: its own rect (a copy)', () => {
    expect(pageViewBounds(true, pane)).toEqual(pane)
    expect(pageViewBounds(true, area)).not.toBe(area)
  })

  test('off screen: left alone (never shrunk to 0x0, so showing it again is not a 0 -> full resize)', () => {
    expect(pageViewBounds(false, area)).toBeNull()
  })

  test('new views start at the page area when it is known', () => {
    expect(initialPageViewBounds(area)).toEqual(area)
    expect(initialPageViewBounds({ x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(initialPageViewBounds(null)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(initialPageViewBounds({ x: 0, y: 0, width: Number.NaN, height: 10 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
