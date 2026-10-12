export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindowState {
  bounds: Rect
  maximized: boolean
  fullScreen: boolean
}

export interface PopupAnchor {
  x: number
  y: number
  width: number
  height: number
}

const GAP = 6

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/**
 * Screen bounds for a toolbar popup, Chrome style: right edge lines up with the
 * button's right edge, top sits just under it, flips above when there is no room.
 * The anchor is in the window's content coordinates. Everything is rounded because
 * BrowserWindow treats a fractional x/y as missing and centers the window instead.
 */
/**
 * Anchor (in content coordinates) that makes anchoredPopupBounds centre a popup over `content`:
 * the popup hangs GAP below an anchor's bottom edge and right-aligns to its right edge.
 */
export function centredPopupAnchor(content: Rect, size: { width: number; height: number }): PopupAnchor {
  const width = Math.min(size.width, content.width)
  const height = Math.min(size.height, content.height)
  return {
    x: Math.round((content.width - width) / 2),
    y: Math.round(Math.max(0, (content.height - height) / 2 - GAP - 1)),
    width,
    height: 1
  }
}

export function anchoredPopupBounds(
  anchor: PopupAnchor | undefined,
  content: Rect,
  workArea: Rect,
  size: { width: number; height: number },
  cursor: { x: number; y: number }
): Rect {
  const width = Math.round(Math.min(size.width, Math.max(1, workArea.width - 16)))
  const height = Math.round(Math.min(size.height, Math.max(1, workArea.height - 16)))
  const buttonLeft = anchor ? content.x + anchor.x : cursor.x
  const buttonTop = anchor ? content.y + anchor.y : cursor.y
  const buttonWidth = anchor?.width ?? 0
  const buttonHeight = anchor?.height ?? 0

  let x = buttonLeft + buttonWidth - width
  if (x < workArea.x) x = buttonLeft
  x = clamp(x, workArea.x, workArea.x + workArea.width - width)

  let y = buttonTop + buttonHeight + GAP
  if (y + height > workArea.y + workArea.height) y = buttonTop - height - GAP
  y = clamp(y, workArea.y, workArea.y + workArea.height - height)

  return { x: Math.round(x), y: Math.round(y), width, height }
}

export function parseSavedWindowState(value: unknown): SavedWindowState | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const bounds = record.bounds as Record<string, unknown> | undefined
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite)) return null
  if ((bounds.width as number) <= 0 || (bounds.height as number) <= 0) return null
  return {
    bounds: {
      x: Math.round(bounds.x as number),
      y: Math.round(bounds.y as number),
      width: Math.round(bounds.width as number),
      height: Math.round(bounds.height as number)
    },
    maximized: record.maximized === true,
    fullScreen: record.fullScreen === true
  }
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Put saved bounds back on a display that still exists. Picks the work area the
 * window overlaps most, shrinks it to fit, and nudges it fully on screen. Returns
 * null when the window would be off every display, so the caller uses defaults.
 */
export function fitBoundsToDisplays(
  bounds: Rect,
  workAreas: Rect[],
  minimum: { width: number; height: number }
): Rect | null {
  let best: Rect | null = null
  let bestOverlap = 0
  for (const area of workAreas) {
    const overlap = overlapArea(bounds, area)
    if (overlap > bestOverlap) {
      best = area
      bestOverlap = overlap
    }
  }
  // Require a usable chunk on screen (at least the title bar region) before trusting it.
  if (!best || bestOverlap < Math.min(bounds.width, 120) * Math.min(bounds.height, 40)) return null
  const width = clamp(bounds.width, Math.min(minimum.width, best.width), best.width)
  const height = clamp(bounds.height, Math.min(minimum.height, best.height), best.height)
  const x = clamp(bounds.x, best.x, best.x + best.width - width)
  const y = clamp(bounds.y, best.y, best.y + best.height - height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}
