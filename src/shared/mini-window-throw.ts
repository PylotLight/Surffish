/**
 * Throwing a mini window: let go of a drag while the pointer is still moving and the window carries on
 * in that direction, slowing down with exponential friction (UIScrollView-ish) until it stops. The
 * glide runs on the shared frame loop (mini-window-motion.ts) like every other mini window move, time
 * based (a slow frame never slows it), and grabbing the window again stops it at once.
 *
 *   - Velocity: a least-squares fit over the last THROW_SAMPLE_WINDOW_MS of pointer (or window)
 *     positions. A pointer that rested for THROW_STALE_MS before letting go throws nothing.
 *   - Friction: displacement d(t) = v0·τ·(1 − e^(−t/τ)), so it leaves at exactly the release velocity
 *     and travels v0·τ in total. Speed is capped (THROW_MAX_SPEED), so is distance (THROW_MAX_DISTANCE).
 *   - Edges: the glide ends inside a display's work area. An axis that would run past it gets a
 *     stronger friction (τ' = room / v0), so it still leaves at the release velocity and eases into
 *     the edge instead of hitting it. It crosses to another display only when the throw carries the
 *     window's centre onto that display; otherwise it stops at the edge of the one it is on.
 *   - Fling to tuck: a fast throw aimed at an outer edge (where tucking is allowed) that would carry the
 *     window past it tucks it there instead (the dock's tuck slide, started at the throw's speed).
 *
 * Pure: no Electron. main/mini-window.ts (header and native drags) and main/mini-window-dock.ts
 * (handle drags along an edge) drive it.
 */

import type { MiniRect } from './mini-window'

export interface ThrowPoint { x: number; y: number }
export interface ThrowSample { t: number; x: number; y: number }
/** px per ms. */
export interface ThrowVelocity { vx: number; vy: number }

/** Positions this recent (before letting go) estimate the velocity. */
export const THROW_SAMPLE_WINDOW_MS = 90
/** The pointer rested this long before letting go: no throw. */
export const THROW_STALE_MS = 60
/** Slower than this at release (px/ms): no throw, it stays where it was let go. */
export const THROW_MIN_SPEED = 0.3
/** Release speed is capped here (px/ms), so a wild flick can't send it across a big display. */
export const THROW_MAX_SPEED = 4
/** Friction time constant (ms): total travel is v0·τ; 0.3 px/ms glides ~300 ms, the cap ~600 ms. */
export const THROW_TAU_MS = 100
/** A glide never travels further than this (px) along either axis. */
export const THROW_MAX_DISTANCE = 400
/** It's done once less than this (px) is left. */
export const THROW_SETTLE_PX = 1
/** Hard cap on a glide's length (ms). */
export const THROW_MAX_MS = 700
/** Fling to tuck: at least this fast (px/ms) toward the edge… */
export const THROW_TUCK_SPEED = 1.5
/** …and aimed at it: the component toward the edge is at least this share of the speed (~45°). */
export const THROW_TUCK_AIM = 0.7
/** The fastest the continued tuck slide may be (ms), so it is still a slide. */
export const THROW_TUCK_MIN_MS = 60

/**
 * Recent drag positions → release velocity. `add` as the drag reports positions (once a frame for
 * main-driven drags, per native move event otherwise); `velocity(now)` when it is let go.
 */
export interface VelocityTracker {
  add(t: number, x: number, y: number): void
  reset(): void
  /** The velocity at `now` (release), or null when there is too little to go on or the pointer had rested (stale). */
  velocity(now: number): ThrowVelocity | null
  samples(): readonly ThrowSample[]
}

export function createVelocityTracker(windowMs = THROW_SAMPLE_WINDOW_MS, staleMs = THROW_STALE_MS): VelocityTracker {
  let list: ThrowSample[] = []
  /** When the position last changed (a pointer that rests keeps reporting the same place). */
  let movedAt = Number.NEGATIVE_INFINITY
  return {
    add: (t, x, y) => {
      const last = list.at(-1)
      if (last && t < last.t) return
      if (!last || last.x !== x || last.y !== y) movedAt = t
      if (last && last.t === t) list[list.length - 1] = { t, x, y }
      else list.push({ t, x, y })
      // Keep a little more than the window (one sample before it anchors a sparse fit).
      const cutoff = t - windowMs * 3
      while (list.length > 2 && (list[0]?.t ?? t) < cutoff) list.shift()
    },
    reset: () => {
      list = []
      movedAt = Number.NEGATIVE_INFINITY
    },
    velocity: (now) => estimateVelocity(list, now, movedAt, windowMs, staleMs),
    samples: () => list
  }
}

/** Least-squares velocity over the samples in the last `windowMs` before `now` (plus the one just before, when sparse). */
export function estimateVelocity(samples: readonly ThrowSample[], now: number, movedAt: number, windowMs = THROW_SAMPLE_WINDOW_MS, staleMs = THROW_STALE_MS): ThrowVelocity | null {
  if (samples.length < 2) return null
  if (now - movedAt > staleMs) return null
  const from = now - windowMs
  let start = samples.findIndex((sample) => sample.t >= from)
  if (start === -1) return null
  // Fewer than three in the window (event-driven samples, a stalled main thread): lean on the one before it.
  if (samples.length - start < 3 && start > 0 && (samples[start - 1]?.t ?? 0) >= now - windowMs * 2) start--
  const used = samples.slice(start)
  if (used.length < 2) return null
  const first = used[0] as ThrowSample
  const span = (used.at(-1) as ThrowSample).t - first.t
  if (span < 4) return null
  let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0
  for (const sample of used) {
    const t = sample.t - first.t
    st += t
    sx += sample.x
    sy += sample.y
    stt += t * t
    stx += t * sample.x
    sty += t * sample.y
  }
  const n = used.length
  const denominator = n * stt - st * st
  if (denominator <= 0) return null
  return { vx: (n * stx - st * sx) / denominator, vy: (n * sty - st * sy) / denominator }
}

export function speedOf(v: ThrowVelocity): number {
  return Math.hypot(v.vx, v.vy)
}

/** The release velocity, capped at THROW_MAX_SPEED; null when it is too slow to throw. */
export function throwVelocity(v: ThrowVelocity | null, minSpeed = THROW_MIN_SPEED, maxSpeed = THROW_MAX_SPEED): ThrowVelocity | null {
  if (!v || !Number.isFinite(v.vx) || !Number.isFinite(v.vy)) return null
  const speed = speedOf(v)
  if (speed < minSpeed) return null
  const scale = speed > maxSpeed ? maxSpeed / speed : 1
  return { vx: v.vx * scale, vy: v.vy * scale }
}

/** One axis of a glide: displacement d(t) = distance·(1 − e^(−t/tau)). */
export interface GlideAxis { distance: number; tau: number }

/**
 * One axis: release speed `v` (px/ms), the room it has (`min` ≤ 0 ≤ `max`, px it may move either way
 * before leaving the area). Leaves at `v` and eases to a stop: v·τ when there is room, else at the edge
 * (stronger friction). Already outside the room (dragged partly off): eases back in.
 */
export function glideAxis(v: number, min: number, max: number, tau = THROW_TAU_MS, maxDistance = THROW_MAX_DISTANCE): GlideAxis {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const natural = Math.max(-maxDistance, Math.min(maxDistance, v * tau))
  const distance = Math.max(lo, Math.min(hi, natural))
  if (distance === 0) return { distance: 0, tau }
  // Heading the way it was thrown: keep the release speed, shorten the glide to fit (τ' = room / v).
  if (Math.sign(distance) === Math.sign(v) && v !== 0) return { distance, tau: Math.max(1, Math.min(tau, distance / v)) }
  // Back into the area (it was let go partly outside): a gentle ease at the normal friction.
  return { distance, tau }
}

export function glideAxisAt(axis: GlideAxis, t: number): number {
  if (axis.distance === 0 || t <= 0) return 0
  return axis.distance * (1 - Math.exp(-t / axis.tau))
}

/** How long until less than THROW_SETTLE_PX is left on the axis (capped at THROW_MAX_MS). */
export function glideAxisDuration(axis: GlideAxis, settle = THROW_SETTLE_PX, maxMs = THROW_MAX_MS): number {
  const distance = Math.abs(axis.distance)
  if (distance <= settle) return distance === 0 ? 0 : Math.min(maxMs, axis.tau)
  return Math.min(maxMs, axis.tau * Math.log(distance / settle))
}

export interface GlidePlan {
  from: MiniRect
  to: MiniRect
  x: GlideAxis
  y: GlideAxis
  /** ms */
  duration: number
}

/** Where the glide is `t` ms in (rounded; exactly `to` once it is over). */
export function glideAt(plan: GlidePlan, t: number): MiniRect {
  if (t >= plan.duration) return { ...plan.to }
  return { ...plan.from, x: Math.round(plan.from.x + glideAxisAt(plan.x, t)), y: Math.round(plan.from.y + glideAxisAt(plan.y, t)) }
}

export interface ThrowDisplay { workArea: MiniRect }

function contains(r: MiniRect, p: ThrowPoint): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
}

function centreOf(r: MiniRect): ThrowPoint {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

function distanceTo(r: MiniRect, p: ThrowPoint): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
  return Math.hypot(dx, dy)
}

/**
 * The work area the glide ends in: the display the window's centre would land on, when it lands on one
 * (a throw that carries it across to the next display); otherwise the one it starts on (it stops at
 * that display's edge, never off the desktop).
 */
export function throwWorkArea(from: MiniRect, natural: MiniRect, displays: readonly ThrowDisplay[]): MiniRect | null {
  if (displays.length === 0) return null
  const landing = centreOf(natural)
  const onto = displays.find((display) => contains(display.workArea, landing))
  if (onto) return onto.workArea
  const start = centreOf(from)
  const home = displays.find((display) => contains(display.workArea, start))
  if (home) return home.workArea
  return [...displays].sort((a, b) => distanceTo(a.workArea, start) - distanceTo(b.workArea, start))[0]?.workArea ?? null
}

/** The glide for a window at `from` let go at velocity `v` (already through throwVelocity), ending inside a work area. */
export function planGlide(from: MiniRect, v: ThrowVelocity, displays: readonly ThrowDisplay[], tau = THROW_TAU_MS): GlidePlan | null {
  const cap = (n: number): number => Math.max(-THROW_MAX_DISTANCE, Math.min(THROW_MAX_DISTANCE, n))
  const natural = { ...from, x: from.x + cap(v.vx * tau), y: from.y + cap(v.vy * tau) }
  const area = throwWorkArea(from, natural, displays)
  if (!area) return null
  // Room either way on each axis, so the window ends fully inside the area (pinned to its top-left when bigger than it).
  const roomX: [number, number] = [area.x - from.x, Math.max(area.x, area.x + area.width - from.width) - from.x]
  const roomY: [number, number] = [area.y - from.y, Math.max(area.y, area.y + area.height - from.height) - from.y]
  const x = glideAxis(v.vx, roomX[0], roomX[1], tau)
  const y = glideAxis(v.vy, roomY[0], roomY[1], tau)
  const to = { ...from, x: Math.round(from.x + x.distance), y: Math.round(from.y + y.distance) }
  if (to.x === from.x && to.y === from.y) return null
  const duration = Math.max(glideAxisDuration(x), glideAxisDuration(y))
  return { from: { ...from }, to, x, y, duration }
}

export type ThrowEdge = 'left' | 'right' | 'top' | 'bottom'

/**
 * Fling to tuck: the edge of `workArea` a throw at `v` from `from` is aimed at, when it is fast enough
 * toward it (THROW_TUCK_SPEED, within ~45°) and would carry the window past it. `allowed` says whether
 * that edge can take a tucked window (an outer edge, tucking on). Null: just glide.
 */
export function flingTuckEdge(from: MiniRect, v: ThrowVelocity, workArea: MiniRect, allowed: (edge: ThrowEdge) => boolean, tau = THROW_TAU_MS): ThrowEdge | null {
  const speed = speedOf(v)
  if (speed < THROW_TUCK_SPEED) return null
  const reach = (n: number): number => Math.max(-THROW_MAX_DISTANCE, Math.min(THROW_MAX_DISTANCE, n * tau))
  const dx = reach(v.vx)
  const dy = reach(v.vy)
  const candidates: Array<{ edge: ThrowEdge; toward: number; past: boolean }> = [
    { edge: 'left', toward: -v.vx, past: from.x + dx < workArea.x },
    { edge: 'right', toward: v.vx, past: from.x + from.width + dx > workArea.x + workArea.width },
    { edge: 'top', toward: -v.vy, past: from.y + dy < workArea.y },
    { edge: 'bottom', toward: v.vy, past: from.y + from.height + dy > workArea.y + workArea.height }
  ]
  const best = candidates.filter((c) => c.past && c.toward >= THROW_TUCK_SPEED * THROW_TUCK_AIM && c.toward >= speed * THROW_TUCK_AIM).sort((a, b) => b.toward - a.toward)[0]
  return best && allowed(best.edge) ? best.edge : null
}

/** Where along the edge a flung window tucks: its release rect moved by the glide along that edge (the push toward it becomes the tuck). */
export function flingAlong(from: MiniRect, v: ThrowVelocity, edge: ThrowEdge, workArea: MiniRect, tau = THROW_TAU_MS): MiniRect {
  const horizontal = edge === 'top' || edge === 'bottom'
  if (horizontal) {
    const axis = glideAxis(v.vx, workArea.x - from.x, Math.max(workArea.x, workArea.x + workArea.width - from.width) - from.x, tau)
    return { ...from, x: Math.round(from.x + axis.distance) }
  }
  const axis = glideAxis(v.vy, workArea.y - from.y, Math.max(workArea.y, workArea.y + workArea.height - from.height) - from.y, tau)
  return { ...from, y: Math.round(from.y + axis.distance) }
}

/** The longest a tuck slide continuing a slower fling may take (ms), so it still reads as one motion. */
export const THROW_TUCK_MAX_MS = 400

/**
 * How long the tuck slide continuing a fling takes so it leaves at the throw's speed: the slide eases
 * out cubically (start speed 3·distance/duration). THROW_TUCK_MIN_MS..max(normal slide, THROW_TUCK_MAX_MS).
 */
export function flingSlideMs(distance: number, speedToward: number, normalMs: number, maxMs = THROW_TUCK_MAX_MS): number {
  if (distance <= 0 || speedToward <= 0) return normalMs
  return Math.round(Math.max(THROW_TUCK_MIN_MS, Math.min(Math.max(normalMs, maxMs), (3 * distance) / speedToward)))
}

/** One axis along a docked edge (a handle drag): `offset` along it, `min`..`max` the offsets allowed. */
export function planEdgeGlide(offset: number, v: number, min: number, max: number, tau = THROW_TAU_MS): { axis: GlideAxis; to: number; duration: number } | null {
  if (Math.abs(v) < THROW_MIN_SPEED) return null
  const capped = Math.max(-THROW_MAX_SPEED, Math.min(THROW_MAX_SPEED, v))
  const axis = glideAxis(capped, min - offset, max - offset, tau)
  const to = Math.round(offset + axis.distance)
  if (to === offset) return null
  return { axis, to, duration: glideAxisDuration(axis) }
}

/** Throw or not, at release: the setting on, Reduce Motion off (then it stops where it was let go), and fast enough. */
export function releaseVelocity(options: { enabled: boolean; reducedMotion: boolean; velocity: ThrowVelocity | null }): ThrowVelocity | null {
  if (!options.enabled || options.reducedMotion) return null
  return throwVelocity(options.velocity)
}

/**
 * Run a glide on the shared frame loop under `key` (main/mini-window-motion.ts's `motion`): each tick
 * `step` gets where the window is now (return false to stop: grabbed again, closed); `done` runs once
 * it has arrived (not when stopped). Timed from its first tick (frameClock). Cancel with loop.cancel(key).
 */
export function runGlide(
  loop: { run(key: unknown, job: (now: number) => boolean): void; interval(): number },
  key: unknown,
  plan: GlidePlan,
  step: (rect: MiniRect, last: boolean) => boolean,
  done: () => void
): void {
  // Same as frameClock (mini-window-motion.ts), inlined to keep this module free of the loop's imports.
  let start: number | null = null
  loop.run(key, (now) => {
    if (start === null) start = now - loop.interval()
    const t = now - start
    const last = t >= plan.duration
    if (!step(glideAt(plan, t), last)) return false
    if (last) done()
    return !last
  })
}
