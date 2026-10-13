/**
 * Is this two-finger trackpad movement really a back/forward swipe?
 *
 * The macOS native module (src/native/macos/mac-trackpad-swipe.mm) used to hand the gesture to
 * AppKit's swipe tracker as soon as the fingers had moved 3pt sideways and 1.35x more sideways
 * than vertically. A slow sideways drift while reading, or a mostly-vertical scroll that wobbled
 * a little at the start, was enough to start (and often commit) a history navigation.
 *
 * Now the module asks on every scroll event of a fresh gesture (with the running totals since the
 * fingers went down) and this decides: 'wait' (keep watching), 'accept' (start tracking) or
 * 'refuse' (this gesture is a scroll; leave it to the page until the fingers lift). The bar stays
 * low enough that a deliberate flick clears it in the first few events.
 */

export interface SwipeIntentSample {
  /** Running horizontal scroll delta since the gesture began (points, signed). */
  dx: number
  /** Running vertical scroll delta since the gesture began (points, signed). */
  dy: number
  /** Time since the gesture began (ms). */
  elapsedMs: number
}

export interface SwipeIntentThresholds {
  /** Deadzone: the fingers must travel at least this far sideways before anything starts (pt). */
  minDistance: number
  /** Sideways travel must be at least this many times the vertical travel. */
  minRatio: number
  /** Average sideways speed over the gesture so far (pt/ms). Slow drifts stay under it. */
  minVelocity: number
  /** More vertical travel than this before the swipe is accepted means it's a scroll (pt). */
  maxVertical: number
  /** A gesture that hasn't qualified by now is a drift or a scroll; stop asking (ms). */
  maxIntentMs: number
  /** A committed swipe must have travelled at least this far through AppKit's 0..1 progress. */
  minCommitProgress: number
}

/**
 * Defaults, tuned to keep deliberate swipes easy: a real two-finger swipe covers 10pt in roughly
 * 30-80ms (0.12-0.35 pt/ms); reading drift and scroll wobble are well under 0.08 pt/ms.
 */
export const DEFAULT_SWIPE_INTENT: Readonly<SwipeIntentThresholds> = Object.freeze({
  minDistance: 10,
  minRatio: 2,
  minVelocity: 0.08,
  maxVertical: 14,
  maxIntentMs: 450,
  minCommitProgress: 0.12
})

export type SwipeIntent = 'wait' | 'accept' | 'refuse'

export function classifySwipeIntent(sample: SwipeIntentSample, thresholds: SwipeIntentThresholds = DEFAULT_SWIPE_INTENT): SwipeIntent {
  const horizontal = Math.abs(finite(sample.dx))
  const vertical = Math.abs(finite(sample.dy))
  const elapsed = Math.max(0, finite(sample.elapsedMs))
  if (vertical > thresholds.maxVertical) return 'refuse'
  if (horizontal >= thresholds.minDistance && horizontal >= vertical * thresholds.minRatio) {
    // The first event of a gesture can arrive with ~0ms elapsed; count it as one frame.
    const velocity = horizontal / Math.max(elapsed, 16)
    if (velocity >= thresholds.minVelocity) return 'accept'
  }
  return elapsed > thresholds.maxIntentMs ? 'refuse' : 'wait'
}

/** AppKit said the swipe ended committed: keep it only if it went far enough to be on purpose. */
export function shouldCommitSwipe(committed: boolean, peakProgress: number, thresholds: SwipeIntentThresholds = DEFAULT_SWIPE_INTENT): boolean {
  return committed && finite(peakProgress) >= thresholds.minCommitProgress
}

/**
 * SURFFISH_SWIPE_INTENT="minDistance=8,minRatio=1.8,minVelocity=0.06" overrides single
 * thresholds for tuning on a real trackpad. Unknown keys and bad numbers are ignored.
 */
export function parseSwipeIntentOverride(value: string | undefined, base: SwipeIntentThresholds = DEFAULT_SWIPE_INTENT): SwipeIntentThresholds {
  const result: SwipeIntentThresholds = { ...base }
  if (!value) return result
  for (const part of value.split(',')) {
    const [rawKey, rawValue] = part.split('=')
    const key = rawKey?.trim() as keyof SwipeIntentThresholds | undefined
    const number = Number(rawValue?.trim())
    if (!key || !(key in result) || rawValue === undefined || rawValue.trim() === '' || !Number.isFinite(number) || number < 0) continue
    result[key] = number
  }
  return result
}

/**
 * The native module sends begin requests with or without the running totals (older builds only
 * call once the 3pt / 1.35x pre-filter passes, with no totals). Without totals, keep the old
 * behaviour and accept.
 */
export function swipeIntentForRequest(request: { dx?: unknown; dy?: unknown; elapsedMs?: unknown }, thresholds: SwipeIntentThresholds = DEFAULT_SWIPE_INTENT): SwipeIntent {
  if (typeof request.dx !== 'number' || typeof request.dy !== 'number' || typeof request.elapsedMs !== 'number') return 'accept'
  return classifySwipeIntent({ dx: request.dx, dy: request.dy, elapsedMs: request.elapsedMs }, thresholds)
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}
