/**
 * Hover peek for a tucked mini window (main/mini-window-dock.ts drives it). Pure rules plus a small
 * driver with injected clock/timers so it unit-tests with fake time.
 *
 * - Dwell: the pointer enters the tucked handle and rests there (moving less than MINI_PEEK_STILL_PX
 *   from where it settled) for the hover delay. Any bigger move restarts the wait from the new spot,
 *   and leaving the handle before the delay is up cancels it, so a pointer just passing over never
 *   peeks. While something blocks a peek (a drag, a held button, the group still sliding) the wait
 *   keeps restarting.
 * - Out: the window (or its whole 'stack' group) slides out as a temporary peek. It stays while the
 *   pointer is over the window, its handle or its floating header; once the pointer has been away
 *   for MINI_PEEK_GRACE_MS it tucks again. Positions come from polling the cursor (screen.getCursorScreenPoint),
 *   since a never-focused window's mouseleave can go missing.
 * - Pin: a click or a key press inside the peeked window (or a click on its handle) keeps it out like
 *   a normal slide-out; the peek just ends there and the tuck button / shortcut tucks it again.
 */

export interface PeekPoint { x: number; y: number }

/** Movement under this (px, either axis) still counts as resting on the handle. */
export const MINI_PEEK_STILL_PX = 4
/** Away from the window, handle and header this long and a peek tucks again. */
export const MINI_PEEK_GRACE_MS = 450
/** How often the cursor is sampled while dwelling or peeked. */
export const MINI_PEEK_POLL_MS = 40

export type PeekState =
  | { phase: 'idle' }
  | { phase: 'dwell'; anchor: PeekPoint; since: number }
  | { phase: 'out'; lastInside: number }

export type PeekInput =
  /** The pointer entered the tucked handle (with no button held). */
  | { type: 'enter'; now: number; cursor: PeekPoint }
  /** The pointer left the handle (or a button went down on it). */
  | { type: 'leave' }
  | {
    type: 'sample'
    now: number
    cursor: PeekPoint
    /** Over the tucked handle. */
    overHandle: boolean
    /** Over the peeked window(s), their handle or floating header. */
    overWindow: boolean
    /** A drag, a held button or a slide in progress: no peek starts now. */
    blocked: boolean
    delayMs: number
    graceMs?: number
  }
  /** Clicked or typed inside: it stays out (the peek ends without tucking). */
  | { type: 'pin' }
  /** Tucked, undocked, dragged, turned off: forget the peek. */
  | { type: 'cancel' }

export type PeekEffect = 'slide-out' | 'tuck' | null

export interface PeekStep { state: PeekState; effect: PeekEffect }

const IDLE: PeekState = { phase: 'idle' }

function moved(a: PeekPoint, b: PeekPoint): boolean {
  return Math.abs(a.x - b.x) >= MINI_PEEK_STILL_PX || Math.abs(a.y - b.y) >= MINI_PEEK_STILL_PX
}

export function stepPeek(state: PeekState, input: PeekInput): PeekStep {
  switch (input.type) {
    case 'enter':
      // Already dwelling or out: nothing new.
      return state.phase === 'idle' ? { state: { phase: 'dwell', anchor: input.cursor, since: input.now }, effect: null } : { state, effect: null }
    case 'leave':
      // Out: the cursor poll decides (the handle moves away with the window as it slides).
      return state.phase === 'dwell' ? { state: IDLE, effect: null } : { state, effect: null }
    case 'pin':
    case 'cancel':
      return { state: IDLE, effect: null }
    case 'sample': {
      if (state.phase === 'dwell') {
        // Passed over (its pointerleave can be late or missing).
        if (!input.overHandle) return { state: IDLE, effect: null }
        // Moving, or not allowed right now: the wait starts again from here.
        if (input.blocked || moved(input.cursor, state.anchor)) return { state: { phase: 'dwell', anchor: input.cursor, since: input.now }, effect: null }
        if (input.now - state.since >= input.delayMs) return { state: { phase: 'out', lastInside: input.now }, effect: 'slide-out' }
        return { state, effect: null }
      }
      if (state.phase === 'out') {
        if (input.overWindow || input.overHandle) return { state: { phase: 'out', lastInside: input.now }, effect: null }
        if (input.now - state.lastInside >= (input.graceMs ?? MINI_PEEK_GRACE_MS)) return { state: IDLE, effect: 'tuck' }
        return { state, effect: null }
      }
      return { state, effect: null }
    }
  }
}

export interface PeekDriverDeps {
  now(): number
  cursor(): PeekPoint
  overHandle(point: PeekPoint): boolean
  overWindow(point: PeekPoint): boolean
  blocked(): boolean
  enabled(): boolean
  delayMs(): number
  slideOut(): void
  tuck(): void
  /** The peek ended (tucked, pinned or cancelled) after it slid out. */
  ended?(): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface PeekDriver {
  enter(): void
  leave(): void
  pin(): void
  cancel(): void
  phase(): PeekState['phase']
}

/** Runs stepPeek: polls the cursor only while dwelling or out. */
export function createPeekDriver(deps: PeekDriverDeps): PeekDriver {
  let state: PeekState = IDLE
  let timer: unknown = null

  const stopTimer = (): void => {
    if (timer !== null) deps.clearInterval(timer)
    timer = null
  }

  function apply(input: PeekInput): void {
    const wasOut = state.phase === 'out'
    const step = stepPeek(state, input)
    // State first: the effect can call back in (tucking cancels the peek).
    state = step.state
    if (state.phase === 'idle') stopTimer()
    else if (timer === null) timer = deps.setInterval(sample, MINI_PEEK_POLL_MS)
    if (step.effect === 'slide-out') deps.slideOut()
    else if (step.effect === 'tuck') deps.tuck()
    if (wasOut && state.phase === 'idle') deps.ended?.()
  }

  function sample(): void {
    if (state.phase === 'idle') return stopTimer()
    if (state.phase === 'dwell' && !deps.enabled()) return apply({ type: 'cancel' })
    const cursor = deps.cursor()
    apply({ type: 'sample', now: deps.now(), cursor, overHandle: deps.overHandle(cursor), overWindow: deps.overWindow(cursor), blocked: deps.blocked(), delayMs: deps.delayMs() })
  }

  return {
    enter: () => {
      if (state.phase !== 'idle' || !deps.enabled()) return
      apply({ type: 'enter', now: deps.now(), cursor: deps.cursor() })
    },
    leave: () => apply({ type: 'leave' }),
    pin: () => { if (state.phase !== 'idle') apply({ type: 'pin' }) },
    cancel: () => { if (state.phase !== 'idle') apply({ type: 'cancel' }) },
    phase: () => state.phase
  }
}
