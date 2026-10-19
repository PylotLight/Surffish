// Pen-on-paper geometry for drawn PDF signatures: a stroke's width follows pen pressure (or, with a
// mouse / trackpad, its speed: faster is thinner), the path is smoothed with Catmull-Rom, and the
// ends taper like a real pen landing and lifting. Each stroke becomes one closed outline polygon, so
// the result is a filled vector shape (pdf.js "contour" signature) rather than an even-width line.

/** Stroke weights offered on the draw pad (base pen width in pad pixels). Index 2 is the old default. */
export const PEN_WEIGHTS = [1.5, 2.25, 3, 4, 5.5] as const
export const DEFAULT_PEN_WEIGHT_INDEX = 2

const MIN_FACTOR = 0.45
const MAX_FACTOR = 1.5

export interface PenSample {
  pointerType: string
  pressure: number
  /** Pad pixels per millisecond since the previous sample (0 for the first). */
  speed: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The width factor for the next point, eased from the previous one so the line never jumps. A pen
 * (stylus) gives real pressure; mice and trackpads report a fixed 0.5, so speed stands in for it.
 */
export function penWidthFactor(sample: PenSample, previous: number | null): number {
  const usePressure = sample.pointerType === 'pen' && sample.pressure > 0
  const target = usePressure ? 0.45 + sample.pressure * 1.05 : 1.25 - clamp(sample.speed, 0, 4) * 0.4
  const clamped = clamp(target, MIN_FACTOR, MAX_FACTOR)
  if (previous === null) return Math.round(clamped * 100) / 100
  const eased = previous * (usePressure ? 0.5 : 0.72) + clamped * (usePressure ? 0.5 : 0.28)
  return Math.round(clamp(eased, MIN_FACTOR, MAX_FACTOR) * 100) / 100
}

interface Point { x: number; y: number; w: number }

function dedupe(points: number[], widths: readonly number[] | undefined): Point[] {
  const result: Point[] = []
  for (let index = 0; index + 1 < points.length; index += 2) {
    const point = { x: points[index]!, y: points[index + 1]!, w: widths?.[index / 2] ?? 1 }
    const last = result[result.length - 1]
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.6) {
      last.w = Math.max(last.w, point.w)
      continue
    }
    result.push(point)
  }
  return result
}

/** Catmull-Rom through the samples, resampled every ~2px, widths interpolated along the way. */
function smooth(points: Point[]): Point[] {
  if (points.length < 3) return points
  const result: Point[] = [points[0]!]
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!
    const p1 = points[index]!
    const p2 = points[index + 1]!
    const p3 = points[Math.min(points.length - 1, index + 2)]!
    const steps = clamp(Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2), 1, 24)
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      const t2 = t * t
      const t3 = t2 * t
      const along = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      result.push({ x: along(p0.x, p1.x, p2.x, p3.x), y: along(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t })
    }
  }
  return result
}

function circle(x: number, y: number, radius: number): number[] {
  const result: number[] = []
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2
    result.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  return result
}

/**
 * The closed outline (x,y pairs) of one stroke drawn with a pen of `baseWidth`. `widths` holds one
 * factor per input point (missing: an even width). Returns [] for an empty stroke.
 */
export function strokeOutline(points: readonly number[], widths: readonly number[] | undefined, baseWidth: number): number[] {
  const raw = dedupe([...points], widths)
  if (raw.length === 0) return []
  if (raw.length === 1) return circle(raw[0]!.x, raw[0]!.y, Math.max(0.6, (baseWidth * raw[0]!.w) / 2) * 1.1)
  const path = smooth(raw)
  // Soften width changes a little more (pressure noise), two box-filter passes.
  for (let pass = 0; pass < 2; pass += 1) {
    const widthsNow = path.map((point) => point.w)
    for (let index = 1; index < path.length - 1; index += 1) path[index]!.w = (widthsNow[index - 1]! + widthsNow[index]! * 2 + widthsNow[index + 1]!) / 4
  }
  const lengths = [0]
  for (let index = 1; index < path.length; index += 1) lengths.push(lengths[index - 1]! + Math.hypot(path[index]!.x - path[index - 1]!.x, path[index]!.y - path[index - 1]!.y))
  const total = lengths[lengths.length - 1]!
  // Taper: the pen lands a little thin and lifts off thinner. Short flicks barely taper.
  const taper = total < baseWidth * 3 ? 0 : Math.min(total * 0.2, baseWidth * 5 + 8)
  const ease = (value: number): number => value * value * (3 - 2 * value)
  const left: number[] = []
  const right: number[] = []
  const radii: number[] = []
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!
    const before = path[Math.max(0, index - 1)]!
    const after = path[Math.min(path.length - 1, index + 1)]!
    let tx = after.x - before.x
    let ty = after.y - before.y
    const length = Math.hypot(tx, ty) || 1
    tx /= length
    ty /= length
    let factor = 1
    if (taper > 0) {
      const fromStart = clamp(lengths[index]! / taper, 0, 1)
      const fromEnd = clamp((total - lengths[index]!) / taper, 0, 1)
      factor = Math.min(0.45 + 0.55 * ease(fromStart), 0.3 + 0.7 * ease(fromEnd))
    }
    const radius = Math.max(0.35, (baseWidth * point.w * factor) / 2)
    radii.push(radius)
    left.push(point.x - ty * radius, point.y + tx * radius)
    right.push(point.x + ty * radius, point.y - tx * radius)
  }
  // Round caps: half circles joining the two sides at each end.
  const cap = (point: Point, radius: number, nx: number, ny: number, tx: number, ty: number): number[] => {
    const result: number[] = []
    for (let step = 1; step < 6; step += 1) {
      const angle = (step / 6) * Math.PI
      result.push(point.x + radius * (nx * Math.cos(angle) + tx * Math.sin(angle)), point.y + radius * (ny * Math.cos(angle) + ty * Math.sin(angle)))
    }
    return result
  }
  const n = path.length
  const end = path[n - 1]!
  const endTangent = { x: end.x - path[n - 2]!.x, y: end.y - path[n - 2]!.y }
  const endLength = Math.hypot(endTangent.x, endTangent.y) || 1
  const start = path[0]!
  const startTangent = { x: path[1]!.x - start.x, y: path[1]!.y - start.y }
  const startLength = Math.hypot(startTangent.x, startTangent.y) || 1
  const etx = endTangent.x / endLength
  const ety = endTangent.y / endLength
  const stx = startTangent.x / startLength
  const sty = startTangent.y / startLength
  const outline = [...left]
  // End cap: from the left side (normal (-ty, tx)) round the front to the right side.
  outline.push(...cap(end, radii[n - 1]!, -ety, etx, etx, ety))
  for (let index = n - 1; index >= 0; index -= 1) outline.push(right[index * 2]!, right[index * 2 + 1]!)
  // Start cap: from the right side round the back to the left side.
  outline.push(...cap(start, radii[0]!, sty, -stx, -stx, -sty))
  return outline.map((value) => Math.round(value * 100) / 100)
}
