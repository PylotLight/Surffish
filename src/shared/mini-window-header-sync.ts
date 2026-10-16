/**
 * What reaches a mini window's header page, and when. Main recomputes the header's state on every tab
 * update it is told about (browser.ts coalesces them to one per frame), and a page can cause several
 * per keystroke: a chat app that rewrites its URL with history.replaceState while the user types is a
 * same-document navigation each time (did-start-loading, did-navigate-in-page, did-stop-loading), and
 * one that flips a "typing…" title retitles the tab per key. Each push rewrote the header page, and
 * the same-document loads flicked its loading state on and off: in the menu bar popout's always-on
 * glass strip that drew and dropped the accent loading line under every key, so the strip flashed as
 * if the window kept losing and gaining focus.
 *
 * The gate, pure (main owns the timer):
 *  - loading shows only once it has lasted MINI_HEADER_LOADING_DELAY_MS (a same-document blip is over
 *    in a frame or two and never shows; a real load shows a beat later) and goes away at once;
 *  - an update that then changes nothing the header shows is dropped;
 *  - only the title changing is held to one push per MINI_HEADER_TITLE_THROTTLE_MS (the trailing
 *    push carries the last title);
 *  - anything else goes out at once.
 */

/** A title-only change sooner than this after the last one waits (a "typing…" title flips per key). */
export const MINI_HEADER_TITLE_THROTTLE_MS = 250
/** Loading must last this long before the header shows it (same-document navigations blip for a frame or two). */
export const MINI_HEADER_LOADING_DELAY_MS = 200

export interface HeaderPushPlan<S> {
  /** The state to send now (loading as the header should show it), or null: nothing to send. */
  send: S | null
  /** Plan again in this many ms (a held title, loading that may be about to show), or null. */
  recheckMs: number | null
}

export interface HeaderStateGate<S extends { title: string; loading: boolean }> {
  /** What to send for `state` now (`extra`: anything else that should count as a change, e.g. tab URLs). */
  plan(state: S, extra?: string): HeaderPushPlan<S>
  /** `state` (a plan's `send`, or the whole state for a fresh header page) went out. */
  sent(state: S, extra?: string): void
  /** The header page was (re)loaded: it holds nothing, so the next plan always sends. */
  reset(): void
}

interface Keys {
  /** Everything. */
  full: string
  /** Everything but the title (what a held title change leaves alone). */
  rest: string
}

function keysOf<S extends { title: string; loading: boolean }>(state: S, extra: string): Keys {
  const rest = JSON.stringify({ ...state, title: '' }) + '\u0000' + extra
  return { full: `${rest}\u0000${state.title}`, rest }
}

export function createHeaderStateGate<S extends { title: string; loading: boolean }>(options: { now: () => number; titleThrottleMs?: number; loadingDelayMs?: number }): HeaderStateGate<S> {
  const throttle = options.titleThrottleMs ?? MINI_HEADER_TITLE_THROTTLE_MS
  const loadingDelay = options.loadingDelayMs ?? MINI_HEADER_LOADING_DELAY_MS
  let last: (Keys & { title: string; loading: boolean }) | null = null
  let titleAt = Number.NEGATIVE_INFINITY
  /** When this stretch of loading started (null: not loading). */
  let loadingSince: number | null = null
  return {
    plan(state, extra = '') {
      const now = options.now()
      let recheck: number | null = null
      if (!state.loading) loadingSince = null
      else loadingSince ??= now
      // Already showing it: it stays. Otherwise only once it has lasted the delay.
      const shownLoading = state.loading && (last?.loading === true || now - (loadingSince ?? now) >= loadingDelay)
      if (state.loading && !shownLoading) recheck = Math.max(1, Math.ceil(loadingDelay - (now - (loadingSince ?? now))))
      const shown: S = shownLoading === state.loading ? state : { ...state, loading: shownLoading }
      const next = keysOf(shown, extra)
      if (!last) return { send: shown, recheckMs: recheck }
      if (next.full === last.full) return { send: null, recheckMs: recheck }
      // Only the title moved, and it moved a moment ago: hold it (the trailing push brings the latest).
      if (next.rest === last.rest && now - titleAt < throttle) {
        const wait = Math.max(1, Math.ceil(throttle - (now - titleAt)))
        return { send: null, recheckMs: recheck === null ? wait : Math.min(recheck, wait) }
      }
      return { send: shown, recheckMs: recheck }
    },
    sent(state, extra = '') {
      // A title change (not the first push) starts the throttle window.
      if (last && state.title !== last.title) titleAt = options.now()
      last = { ...keysOf(state, extra), title: state.title, loading: state.loading }
    },
    reset() {
      last = null
    }
  }
}
