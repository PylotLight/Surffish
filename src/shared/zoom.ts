/** Page zoom steps, matching Chrome's presets. 1 is 100%. */
export const ZOOM_FACTORS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
export const MIN_ZOOM_FACTOR = ZOOM_FACTORS[0]!
export const MAX_ZOOM_FACTOR = ZOOM_FACTORS[ZOOM_FACTORS.length - 1]!
export const MAX_SAVED_SITE_ZOOMS = 200

export function isDefaultZoom(factor: number): boolean {
  return Math.abs(factor - 1) < 0.005
}

/** Clamp to the supported range and round to two decimals; null for anything that isn't a usable number. */
export function normalizeZoomFactor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, value)) * 100) / 100
}

/** Next preset in `direction` from `current` (which may sit between presets, e.g. after pinch or Ctrl+wheel). */
export function stepZoomFactor(current: number, direction: 1 | -1): number {
  const value = normalizeZoomFactor(current) ?? 1
  if (direction > 0) return ZOOM_FACTORS.find((factor) => factor > value + 0.001) ?? MAX_ZOOM_FACTOR
  return [...ZOOM_FACTORS].reverse().find((factor) => factor < value - 0.001) ?? MIN_ZOOM_FACTOR
}

export function formatZoomPercent(factor: number): string {
  return `${Math.round(factor * 100)}%`
}

/** Largest trackpad pinch (visual zoom) scale on a page: tabs and Glance alike. */
export const PINCH_ZOOM_MAX_SCALE = 3

export type PageZoomAction = 'in' | 'out' | 'reset'

/** Electron's zoom-changed direction (Ctrl+wheel, precision-touchpad zoom) as a zoom step. */
export function zoomActionForWheel(direction: unknown): PageZoomAction | null {
  return direction === 'in' ? 'in' : direction === 'out' ? 'out' : null
}
