/**
 * Counting a burst of clicks (the Surffish logo's triple-click easter egg). `event.detail` resets
 * when the pointer moves a little between clicks and isn't reported the same way everywhere, so the
 * toolbar counts clicks itself: a burst is `count` clicks, each within `gapMs` of the one before.
 */
export interface ClickBurst {
  /** Clicks in the current burst so far. */
  clicks: number
  /** When the last click landed (ms, any monotonic clock). */
  lastAt: number
}

export const EMPTY_CLICK_BURST: ClickBurst = { clicks: 0, lastAt: Number.NEGATIVE_INFINITY }

export interface ClickBurstOptions {
  count: number
  gapMs: number
}

export const TRIPLE_CLICK: ClickBurstOptions = { count: 3, gapMs: 450 }

/** Add a click at `now`. `fired` is true on the click that completes a burst, which then starts over. */
export function registerClick(burst: ClickBurst, now: number, options: ClickBurstOptions = TRIPLE_CLICK): { burst: ClickBurst; fired: boolean } {
  const continues = Number.isFinite(burst.lastAt) && now >= burst.lastAt && now - burst.lastAt <= options.gapMs
  const clicks = continues ? burst.clicks + 1 : 1
  if (clicks >= options.count) return { burst: EMPTY_CLICK_BURST, fired: true }
  return { burst: { clicks, lastAt: now }, fired: false }
}
