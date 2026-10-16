/**
 * One frame loop for all mini window motion (slides, drags, the floating header, stack followers,
 * handles gliding along an edge). Main has no requestAnimationFrame, so this ticks on timers paced
 * to the display's refresh rate with drift correction (each tick aims at start + n·interval, so a late
 * tick doesn't push the rest back). Each tick runs every job, then commits the bounds they queued:
 * one setBounds per window per tick (the last rect queued wins; unchanged rects are skipped), so a
 * window, its header panel, its handle and its stack followers all move in the same tick.
 * Pure (clock/timers injected) so it unit-tests with fake time; main/mini-window-motion.ts wires it.
 */

export interface MotionRect { x: number; y: number; width: number; height: number }

/** A job runs once per tick with the tick's time; return false when done. */
export type FrameJob = (now: number) => boolean

export interface FrameLoopDeps {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  /** The current frame interval (ms). */
  interval(): number
}

export interface FrameLoop {
  /** Run `job` every tick (replacing the job under `key`); the loop starts on demand and stops when idle. */
  run(key: unknown, job: FrameJob): void
  /** Run `fn` once on the next tick (coalesced per key: only the last one queued runs). */
  once(key: unknown, fn: (now: number) => void): void
  cancel(key: unknown): void
  has(key: unknown): boolean
  /** Queue `target` to move to `rect` when this tick commits (outside a tick: on the next one); skipped when `current()` already is `rect`. */
  place(target: unknown, rect: MotionRect, apply: (rect: MotionRect) => void, current?: () => MotionRect | null): void
  /** Forget what is queued for `target` (it is being placed directly). */
  drop(target: unknown): void
  /** Inside a tick (jobs running): places commit at its end. */
  inTick(): boolean
  /** Commit what is queued right now (end of a tick; or a caller that needs it applied immediately). */
  flush(): void
  /** A tick is scheduled. */
  running(): boolean
}

/** The frame interval for a display refresh rate (Hz), clamped to 30–240 Hz; 60 Hz when unknown. */
export function frameIntervalFor(hz: number | undefined | null): number {
  const rate = typeof hz === 'number' && Number.isFinite(hz) && hz > 0 ? Math.min(240, Math.max(30, hz)) : 60
  return 1000 / rate
}

/** Ease-out cubic. */
export function easeOut(t: number): number {
  const p = Math.min(1, Math.max(0, t))
  return 1 - (1 - p) ** 3
}

export function sameMotionRect(a: MotionRect, b: MotionRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Point `t` (0..1, eased) of the way from `from` to `to`, rounded. */
export function lerpRect(from: MotionRect, to: MotionRect, t: number): MotionRect {
  const e = easeOut(t)
  const mix = (a: number, b: number): number => Math.round(a + (b - a) * e)
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height) }
}

/**
 * How long a move of `from`→`to` takes when a full move of `full` px takes `fullMs`: shorter moves
 * (an interrupted slide turning back, a handle making room) take proportionally less, but never under
 * 40% of it, so nothing jumps.
 */
export function motionDuration(from: MotionRect, to: MotionRect, full: number, fullMs: number): number {
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.width - from.width), Math.abs(to.height - from.height))
  if (distance === 0) return 0
  if (full <= 0) return fullMs
  return Math.round(fullMs * Math.min(1, Math.max(0.4, distance / full)))
}

export function createFrameLoop(deps: FrameLoopDeps): FrameLoop {
  const jobs = new Map<unknown, FrameJob>()
  const onces = new Map<unknown, (now: number) => void>()
  const pending = new Map<unknown, { rect: MotionRect; apply: (rect: MotionRect) => void; current?: () => MotionRect | null }>()
  let timer: unknown = null
  let inTick = false
  /** When the next tick is due (drift-corrected). */
  let due = Number.NEGATIVE_INFINITY

  const idle = (): boolean => jobs.size === 0 && onces.size === 0 && pending.size === 0

  function schedule(): void {
    if (timer !== null || inTick || idle()) return
    const now = deps.now()
    const interval = deps.interval()
    // Idle (or main was busy for more than a frame): the next frame is one interval from now, so the
    // first step of a slide is a real step, not a repeat of where it starts.
    if (due < now - interval) due = now + interval
    timer = deps.setTimeout(tick, Math.max(0, due - now))
  }

  function flush(): void {
    const batch = [...pending]
    pending.clear()
    for (const [, { rect, apply, current }] of batch) {
      const now = current?.()
      if (now && sameMotionRect(now, rect)) continue
      apply(rect)
    }
  }

  function tick(): void {
    timer = null
    inTick = true
    const now = deps.now()
    due = Math.max(due, now - deps.interval()) + deps.interval()
    const queued = [...onces.values()]
    onces.clear()
    for (const fn of queued) fn(now)
    for (const [key, job] of [...jobs]) {
      // Replaced or cancelled by an earlier job this tick.
      if (jobs.get(key) !== job) continue
      let keep = false
      try {
        keep = job(now)
      } catch (error) {
        console.warn('Mini window motion job failed:', error)
      }
      if (!keep && jobs.get(key) === job) jobs.delete(key)
    }
    flush()
    inTick = false
    schedule()
  }

  return {
    run: (key, job) => {
      jobs.set(key, job)
      schedule()
    },
    once: (key, fn) => {
      onces.set(key, fn)
      schedule()
    },
    cancel: (key) => {
      jobs.delete(key)
      onces.delete(key)
    },
    has: (key) => jobs.has(key),
    place: (target, rect, apply, current) => {
      pending.set(target, { rect: { ...rect }, apply, current })
      schedule()
    },
    drop: (target) => { pending.delete(target) },
    inTick: () => inTick,
    flush,
    running: () => timer !== null
  }
}
