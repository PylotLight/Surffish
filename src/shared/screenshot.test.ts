import { describe, expect, test } from 'bun:test'
import {
  dragRect,
  fullPageClip,
  isUsableRegion,
  looksLikePng,
  parseRect,
  previewPopoverBounds,
  regionToImagePixels,
  screenshotFilename,
  stitchPlan,
  stitchRowsInPixels,
  withPngExtension
} from './screenshot'

describe('screenshotFilename', () => {
  test('macOS-style local date and time, no colons', () => {
    expect(screenshotFilename(new Date(2026, 9, 3, 9, 5, 7))).toBe('Surffish Screenshot 2026-10-03 at 09.05.07.png')
    expect(screenshotFilename(new Date(2026, 11, 31, 23, 59, 59))).toBe('Surffish Screenshot 2026-12-31 at 23.59.59.png')
    expect(screenshotFilename(new Date(2026, 0, 1))).not.toContain(':')
  })

  test('an invalid date still gives a usable name', () => {
    expect(screenshotFilename(new Date(Number.NaN))).toMatch(/^Surffish Screenshot \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/)
  })

  test('withPngExtension adds .png once', () => {
    expect(withPngExtension('/tmp/shot')).toBe('/tmp/shot.png')
    expect(withPngExtension('/tmp/shot.PNG')).toBe('/tmp/shot.PNG')
  })
})

describe('dragRect', () => {
  const bounds = { width: 800, height: 600 }

  test('normalises drags in any direction', () => {
    expect(dragRect({ x: 100, y: 50 }, { x: 300, y: 250 }, bounds)).toEqual({ x: 100, y: 50, width: 200, height: 200 })
    expect(dragRect({ x: 300, y: 250 }, { x: 100, y: 50 }, bounds)).toEqual({ x: 100, y: 50, width: 200, height: 200 })
    expect(dragRect({ x: 300, y: 50 }, { x: 100, y: 250 }, bounds)).toEqual({ x: 100, y: 50, width: 200, height: 200 })
  })

  test('clamps to the view when the pointer leaves it', () => {
    expect(dragRect({ x: 700, y: 500 }, { x: 1200, y: 900 }, bounds)).toEqual({ x: 700, y: 500, width: 100, height: 100 })
    expect(dragRect({ x: 50, y: 50 }, { x: -40, y: -10 }, bounds)).toEqual({ x: 0, y: 0, width: 50, height: 50 })
  })

  test('non-finite input collapses to zero', () => {
    expect(dragRect({ x: Number.NaN, y: 0 }, { x: 10, y: Number.POSITIVE_INFINITY }, bounds)).toEqual({ x: 0, y: 0, width: 10, height: 0 })
  })

  test('isUsableRegion ignores clicks', () => {
    expect(isUsableRegion({ x: 0, y: 0, width: 3, height: 100 })).toBe(false)
    expect(isUsableRegion({ x: 0, y: 0, width: 4, height: 4 })).toBe(true)
  })
})

describe('parseRect', () => {
  test('accepts finite non-negative rects only', () => {
    expect(parseRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 })
    expect(parseRect({ x: 1, y: 2, width: -3, height: 4 })).toBeNull()
    expect(parseRect({ x: '1', y: 2, width: 3, height: 4 })).toBeNull()
    expect(parseRect({ x: 1, y: 2, width: Number.NaN, height: 4 })).toBeNull()
    expect(parseRect(null)).toBeNull()
  })
})

describe('regionToImagePixels', () => {
  test('1x: identity', () => {
    expect(regionToImagePixels({ x: 10, y: 20, width: 100, height: 50 }, { width: 800, height: 600 }, { width: 800, height: 600 }))
      .toEqual({ x: 10, y: 20, width: 100, height: 50 })
  })

  test('Retina 2x doubles everything', () => {
    expect(regionToImagePixels({ x: 10, y: 20, width: 100, height: 50 }, { width: 800, height: 600 }, { width: 1600, height: 1200 }))
      .toEqual({ x: 20, y: 40, width: 200, height: 100 })
  })

  test('fractional ratios grow outward to whole pixels', () => {
    // 1.25x (Windows 125%): 10.5 → 13.125 floors to 13; 10.5+20.3=30.8 → 38.5 ceils to 39.
    expect(regionToImagePixels({ x: 10.5, y: 10.5, width: 20.3, height: 20.3 }, { width: 800, height: 600 }, { width: 1000, height: 750 }))
      .toEqual({ x: 13, y: 13, width: 26, height: 26 })
  })

  test('float noise does not add a pixel', () => {
    expect(regionToImagePixels({ x: 0.1, y: 0, width: 0.2, height: 1 }, { width: 10, height: 10 }, { width: 30, height: 30 }))
      .toEqual({ x: 0, y: 0, width: 1, height: 3 })
  })

  test('clamps to the bitmap at the far edges', () => {
    expect(regionToImagePixels({ x: 700, y: 500, width: 200, height: 200 }, { width: 800, height: 600 }, { width: 1600, height: 1200 }))
      .toEqual({ x: 1400, y: 1000, width: 200, height: 200 })
    expect(regionToImagePixels({ x: -50, y: -50, width: 100, height: 100 }, { width: 800, height: 600 }, { width: 1600, height: 1200 }))
      .toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  test('null when the region is empty or outside, or sizes are bogus', () => {
    expect(regionToImagePixels({ x: 900, y: 0, width: 10, height: 10 }, { width: 800, height: 600 }, { width: 1600, height: 1200 })).toBeNull()
    expect(regionToImagePixels({ x: 0, y: 0, width: 0, height: 10 }, { width: 800, height: 600 }, { width: 1600, height: 1200 })).toBeNull()
    expect(regionToImagePixels({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 600 }, { width: 1600, height: 1200 })).toBeNull()
  })

  test('non-uniform ratios (scrollbar-less capture) map each axis on its own', () => {
    expect(regionToImagePixels({ x: 100, y: 100, width: 100, height: 100 }, { width: 800, height: 600 }, { width: 1600, height: 900 }))
      .toEqual({ x: 200, y: 150, width: 200, height: 150 })
  })
})

describe('fullPageClip', () => {
  test('whole page when it fits', () => {
    expect(fullPageClip({ width: 1280, height: 4000.4 }, 2)).toEqual({ clip: { x: 0, y: 0, width: 1280, height: 4001, scale: 1 }, truncated: false })
  })

  test('caps the height so the bitmap stays under the limit at the pixel ratio', () => {
    expect(fullPageClip({ width: 1280, height: 50_000 }, 2)).toEqual({ clip: { x: 0, y: 0, width: 1280, height: 8192, scale: 1 }, truncated: true })
    expect(fullPageClip({ width: 1280, height: 50_000 }, 1.5, 16_384)?.clip.height).toBe(10_922)
  })

  test('bogus ratio falls back to 1; empty pages give null', () => {
    expect(fullPageClip({ width: 100, height: 100 }, Number.NaN)?.clip).toEqual({ x: 0, y: 0, width: 100, height: 100, scale: 1 })
    expect(fullPageClip({ width: 0, height: 100 }, 1)).toBeNull()
  })
})

describe('stitchPlan', () => {
  test('one step when the page fits the viewport', () => {
    expect(stitchPlan(600, 800)).toEqual({ steps: [{ scrollY: 0, cropTop: 0, height: 600 }], height: 600, truncated: false })
  })

  test('the last step scrolls to the bottom and keeps only the new rows', () => {
    expect(stitchPlan(2500, 1000)).toEqual({
      steps: [
        { scrollY: 0, cropTop: 0, height: 1000 },
        { scrollY: 1000, cropTop: 0, height: 1000 },
        { scrollY: 1500, cropTop: 500, height: 500 }
      ],
      height: 2500,
      truncated: false
    })
  })

  test('exact multiples need no overlap', () => {
    expect(stitchPlan(2000, 1000).steps).toEqual([
      { scrollY: 0, cropTop: 0, height: 1000 },
      { scrollY: 1000, cropTop: 0, height: 1000 }
    ])
  })

  test('caps very long pages', () => {
    const plan = stitchPlan(100_000, 1000, 2500)
    expect(plan.height).toBe(2500)
    expect(plan.truncated).toBe(true)
    expect(plan.steps.at(-1)).toEqual({ scrollY: 2000, cropTop: 0, height: 500 })
  })

  test('nothing to do for empty pages', () => {
    expect(stitchPlan(0, 800).steps).toEqual([])
    expect(stitchPlan(800, 0).steps).toEqual([])
  })

  test('stitchRowsInPixels scales crop rows to the bitmap', () => {
    expect(stitchRowsInPixels({ scrollY: 1500, cropTop: 500, height: 500 }, 1000, 2000)).toEqual({ top: 1000, height: 1000 })
    expect(stitchRowsInPixels({ scrollY: 0, cropTop: 0, height: 1000 }, 1000, 1000)).toEqual({ top: 0, height: 1000 })
  })
})

describe('misc', () => {
  test('looksLikePng', () => {
    expect(looksLikePng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true)
    expect(looksLikePng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]))).toBe(false)
    expect(looksLikePng(new Uint8Array())).toBe(false)
  })

  test('previewPopoverBounds sits bottom-right and shrinks to fit', () => {
    expect(previewPopoverBounds({ x: 0, y: 50, width: 1200, height: 800 }, { width: 340, height: 300 })).toEqual({ x: 844, y: 534, width: 340, height: 300 })
    expect(previewPopoverBounds({ x: 0, y: 50, width: 200, height: 200 }, { width: 340, height: 300 })).toEqual({ x: 16, y: 66, width: 168, height: 168 })
  })
})
