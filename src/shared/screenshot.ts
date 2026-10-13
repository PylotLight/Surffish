/**
 * Pure helpers for the screenshot tool: default filenames, drag-rectangle math, mapping a
 * selection in view (DIP / CSS) pixels onto the captured bitmap at its device pixel ratio, and the
 * full-page clip / stitching plans. No Electron imports, so all of it is unit-testable.
 */

export type ScreenshotMode = 'choose' | 'visible' | 'full' | 'scrolling'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Chromium refuses (or blanks) bitmaps past this on a side; it is also the GPU texture limit on most Macs. */
export const MAX_SCREENSHOT_SIDE_PX = 16_384
/** A drag smaller than this (in view pixels) on either side is treated as a click, not a region. */
export const MIN_REGION_SIZE = 4

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * macOS-style default name: "Surffish Screenshot 2026-10-13 at 12.57.03.png" (local time; dots
 * instead of colons, which Finder and Windows both refuse in filenames).
 */
export function screenshotFilename(date: Date): string {
  const valid = Number.isFinite(date.getTime()) ? date : new Date(0)
  const day = `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}`
  const time = `${pad(valid.getHours())}.${pad(valid.getMinutes())}.${pad(valid.getSeconds())}`
  return `Surffish Screenshot ${day} at ${time}.png`
}

/** Make sure a path picked in the save dialog ends in .png. */
export function withPngExtension(path: string): string {
  return /\.png$/i.test(path) ? path : `${path}.png`
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The rectangle spanned by a drag from `start` to `end` (either direction), clamped to `bounds`
 * (a view of that size, origin 0,0). Coordinates stay fractional; rounding happens on the bitmap.
 */
export function dragRect(start: { x: number; y: number }, end: { x: number; y: number }, bounds: Size): Rect {
  const width = Math.max(0, finite(bounds.width))
  const height = Math.max(0, finite(bounds.height))
  const x1 = clamp(finite(start.x), 0, width)
  const y1 = clamp(finite(start.y), 0, height)
  const x2 = clamp(finite(end.x), 0, width)
  const y2 = clamp(finite(end.y), 0, height)
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

/** Big enough to be a deliberate region rather than a stray click. */
export function isUsableRegion(rect: Rect, minSize = MIN_REGION_SIZE): boolean {
  return finite(rect.width) >= minSize && finite(rect.height) >= minSize
}

/** Untrusted input (IPC from the overlay page) to a Rect, or null. */
export function parseRect(value: unknown): Rect | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const numbers = [candidate.x, candidate.y, candidate.width, candidate.height]
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null
  const [x, y, width, height] = numbers as number[]
  if (width! < 0 || height! < 0) return null
  return { x: x!, y: y!, width: width!, height: height! }
}

/**
 * Map a selection in view coordinates onto a bitmap captured from that view. The ratio comes from
 * the two sizes (not an assumed devicePixelRatio), so Retina, fractional Windows scaling and page
 * zoom all line up. Edges grow outward to whole pixels (floor/ceil) so nothing selected is lost,
 * then clamp to the bitmap. Null when nothing is left.
 */
export function regionToImagePixels(rect: Rect, viewSize: Size, imageSize: Size): Rect | null {
  if (!(viewSize.width > 0) || !(viewSize.height > 0) || !(imageSize.width > 0) || !(imageSize.height > 0)) return null
  const scaleX = imageSize.width / viewSize.width
  const scaleY = imageSize.height / viewSize.height
  // Tiny float error (0.1 * 3 = 0.30000000000000004) must not grow a pixel; round to 1/1000 first.
  const snap = (value: number): number => Math.round(value * 1000) / 1000
  const left = clamp(Math.floor(snap(finite(rect.x) * scaleX)), 0, imageSize.width)
  const top = clamp(Math.floor(snap(finite(rect.y) * scaleY)), 0, imageSize.height)
  const right = clamp(Math.ceil(snap((finite(rect.x) + finite(rect.width)) * scaleX)), 0, imageSize.width)
  const bottom = clamp(Math.ceil(snap((finite(rect.y) + finite(rect.height)) * scaleY)), 0, imageSize.height)
  if (right - left < 1 || bottom - top < 1) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export interface FullPageClip {
  /** CSS-pixel clip for CDP Page.captureScreenshot (scale 1: output is clip × device pixel ratio). */
  clip: Rect & { scale: 1 }
  /** The page was taller (or wider) than the bitmap limit and the capture stops there. */
  truncated: boolean
}

/**
 * The clip for a full-page CDP capture. `contentSize` is Page.getLayoutMetrics' cssContentSize;
 * `pixelRatio` is device pixels per CSS pixel (screen scale × page zoom). Caps each side so the
 * output bitmap stays within `maxSidePx`.
 */
export function fullPageClip(contentSize: Size, pixelRatio: number, maxSidePx = MAX_SCREENSHOT_SIDE_PX): FullPageClip | null {
  const ratio = pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1
  const width = Math.ceil(finite(contentSize.width))
  const height = Math.ceil(finite(contentSize.height))
  if (width < 1 || height < 1) return null
  const maxCss = Math.max(1, Math.floor(maxSidePx / ratio))
  const clippedWidth = Math.min(width, maxCss)
  const clippedHeight = Math.min(height, maxCss)
  return {
    clip: { x: 0, y: 0, width: clippedWidth, height: clippedHeight, scale: 1 },
    truncated: clippedWidth < width || clippedHeight < height
  }
}

export interface StitchStep {
  /** window.scrollTo(0, scrollY) before this capture (CSS pixels). */
  scrollY: number
  /** Rows of the viewport capture to keep, in CSS pixels from the viewport's top. */
  cropTop: number
  height: number
}

export interface StitchPlan {
  steps: StitchStep[]
  /** Total stitched height in CSS pixels. */
  height: number
  truncated: boolean
}

/**
 * Fallback when CDP isn't available: scroll the window a viewport at a time and keep the new rows
 * of each capture. The last step scrolls to the bottom (browsers clamp past it anyway) and keeps
 * only the rows not already captured. `maxHeight` (CSS px) caps very long pages.
 */
export function stitchPlan(contentHeight: number, viewportHeight: number, maxHeight = Number.POSITIVE_INFINITY): StitchPlan {
  const viewport = Math.floor(finite(viewportHeight))
  const total = Math.min(Math.ceil(finite(contentHeight)), Number.isFinite(maxHeight) ? Math.floor(maxHeight) : Number.POSITIVE_INFINITY)
  const fullHeight = Math.ceil(finite(contentHeight))
  if (viewport < 1 || total < 1) return { steps: [], height: 0, truncated: false }
  const steps: StitchStep[] = []
  const lastScroll = Math.max(0, fullHeight - viewport)
  let covered = 0
  while (covered < total) {
    const scrollY = Math.min(covered, lastScroll)
    const cropTop = covered - scrollY
    const height = Math.min(viewport - cropTop, total - covered)
    if (height <= 0) break
    steps.push({ scrollY, cropTop, height })
    covered += height
  }
  return { steps, height: covered, truncated: total < fullHeight }
}

/** Device-pixel row range of one stitch step inside a viewport bitmap `imageHeight` px tall. */
export function stitchRowsInPixels(step: StitchStep, viewportHeight: number, imageHeight: number): { top: number; height: number } {
  const ratio = viewportHeight > 0 ? imageHeight / viewportHeight : 1
  const top = clamp(Math.round(step.cropTop * ratio), 0, imageHeight)
  const bottom = clamp(Math.round((step.cropTop + step.height) * ratio), top, imageHeight)
  return { top, height: bottom - top }
}

/** PNG signature check for bytes coming back from the annotate canvas. */
export function looksLikePng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return bytes.length > signature.length && signature.every((byte, index) => bytes[index] === byte)
}

/** Where the small preview popover sits: bottom-right of the page area, inset by `margin`, shrunk to fit. */
export function previewPopoverBounds(page: Rect, popover: Size, margin = 16): Rect {
  const width = Math.max(0, Math.min(popover.width, page.width - margin * 2))
  const height = Math.max(0, Math.min(popover.height, page.height - margin * 2))
  return {
    x: Math.round(page.x + page.width - width - margin),
    y: Math.round(page.y + page.height - height - margin),
    width: Math.round(width),
    height: Math.round(height)
  }
}
