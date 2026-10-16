import { describe, expect, test } from 'bun:test'
import { createFrameLoop, frameIntervalFor } from './mini-window-motion'
import {
  THROW_MAX_DISTANCE,
  THROW_MAX_MS,
  THROW_MAX_SPEED,
  THROW_STALE_MS,
  THROW_TAU_MS,
  createVelocityTracker,
  flingAlong,
  flingSlideMs,
  flingTuckEdge,
  glideAt,
  glideAxis,
  glideAxisAt,
  planEdgeGlide,
  planGlide,
  releaseVelocity,
  runGlide,
  speedOf,
  throwVelocity,
  throwWorkArea,
  type GlidePlan
} from './mini-window-throw'

/** Fake clock: timeouts fire as time advances. */
function fakeTimers() {
  let now = 0
  let next = 1
  const timers = new Map<number, { fn: () => void; at: number }>()
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = next++
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout: (id: unknown) => { timers.delete(id as number) },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let due: [number, { fn: () => void; at: number }] | null = null
        for (const entry of timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = end
    }
  }
}

/** Pointer samples once a frame (60 Hz) moving at (vx, vy) px/ms, ending at `end` ms. */
function drag(vx: number, vy: number, end = 200, frame = 1000 / 60) {
  const tracker = createVelocityTracker()
  for (let t = 0; t <= end + 0.001; t += frame) tracker.add(t, Math.round(500 + vx * t), Math.round(400 + vy * t))
  return tracker
}

const WA = { x: 0, y: 25, width: 1600, height: 975 }
const DISPLAY = [{ workArea: WA }]
const WIN = { x: 600, y: 300, width: 420, height: 300 }

describe('velocity', () => {
  test('a steady drag reads its speed (once-a-frame samples, rounded to px)', () => {
    const v = drag(1.2, -0.5).velocity(200)
    expect(v).not.toBeNull()
    expect(v!.vx).toBeCloseTo(1.2, 1)
    expect(v!.vy).toBeCloseTo(-0.5, 1)
  })

  test('only the last ~90 ms count: a drag that sped up throws at the new speed', () => {
    const tracker = createVelocityTracker()
    let x = 0
    for (let t = 0; t <= 400; t += 8) {
      tracker.add(t, Math.round(x), 0)
      x += t < 250 ? 0.2 * 8 : 2 * 8
    }
    expect(tracker.velocity(400)!.vx).toBeGreaterThan(1.8)
  })

  test('a pointer that rested before letting go throws nothing (stale samples)', () => {
    const tracker = drag(2, 0, 200)
    // Released 100 ms after the last sample, no new positions.
    expect(tracker.velocity(200 + THROW_STALE_MS + 5)).toBeNull()
    // A main-driven drag keeps sampling the same spot while the pointer rests: still stale.
    const resting = drag(2, 0, 200)
    const last = resting.samples().at(-1)!
    for (let t = 216; t <= 300; t += 16) resting.add(t, last.x, last.y)
    expect(resting.velocity(300)).toBeNull()
    // Rested briefly (under the cutoff): the fit sees it slowing, still a throw.
    expect(drag(2, 0, 200).velocity(200 + THROW_STALE_MS - 10)).not.toBeNull()
  })

  test('too little to go on: one sample, or all in the same ms', () => {
    const tracker = createVelocityTracker()
    expect(tracker.velocity(0)).toBeNull()
    tracker.add(10, 0, 0)
    expect(tracker.velocity(10)).toBeNull()
    tracker.add(11, 5, 0)
    expect(tracker.velocity(11)).toBeNull()
    tracker.reset()
    expect(tracker.samples()).toHaveLength(0)
  })

  test('sparse samples (native move events, a stalled main thread) still fit, leaning on the one before the window', () => {
    const tracker = createVelocityTracker()
    tracker.add(0, 0, 0)
    tracker.add(70, 70, 0)
    tracker.add(140, 140, 0)
    expect(tracker.velocity(150)!.vx).toBeCloseTo(1, 2)
  })

  test('throw threshold and speed cap', () => {
    expect(throwVelocity({ vx: 0.2, vy: 0.1 })).toBeNull()
    expect(throwVelocity({ vx: 0.3, vy: 0 })).toEqual({ vx: 0.3, vy: 0 })
    const capped = throwVelocity({ vx: 30, vy: 40 })!
    expect(speedOf(capped)).toBeCloseTo(THROW_MAX_SPEED, 6)
    expect(capped.vx / capped.vy).toBeCloseTo(0.75, 6)
    expect(throwVelocity({ vx: Number.NaN, vy: 1 })).toBeNull()
  })

  test('Reduce Motion or the setting off: no throw, it stops where it was let go', () => {
    const velocity = { vx: 2, vy: 0 }
    expect(releaseVelocity({ enabled: true, reducedMotion: false, velocity })).toEqual(velocity)
    expect(releaseVelocity({ enabled: true, reducedMotion: true, velocity })).toBeNull()
    expect(releaseVelocity({ enabled: false, reducedMotion: false, velocity })).toBeNull()
    expect(releaseVelocity({ enabled: true, reducedMotion: false, velocity: { vx: 0.1, vy: 0 } })).toBeNull()
  })
})

describe('glide', () => {
  test('exponential friction: leaves at the release speed, travels v·τ, slows to a stop', () => {
    const axis = glideAxis(1, -10_000, 10_000)
    expect(axis).toEqual({ distance: THROW_TAU_MS, tau: THROW_TAU_MS })
    // Speed at the start ≈ v.
    expect(glideAxisAt(axis, 1)).toBeCloseTo(1, 1)
    // Each frame covers less than the one before.
    const steps = [16, 32, 48, 64].map((t) => glideAxisAt(axis, t))
    for (let i = 1; i < steps.length; i++) expect(steps[i]! - steps[i - 1]!).toBeLessThan(steps[i - 1]! - (steps[i - 2] ?? 0))
  })

  test('glide lengths: a slow throw ~300 ms, the fastest ~600 ms, never past the cap', () => {
    const slow = planGlide(WIN, { vx: 0.3, vy: 0 }, DISPLAY)!
    const fast = planGlide({ ...WIN, x: 100 }, { vx: THROW_MAX_SPEED, vy: 0 }, [{ workArea: { x: 0, y: 0, width: 5000, height: 1000 } }])!
    expect(slow.duration).toBeGreaterThanOrEqual(250)
    expect(slow.duration).toBeLessThanOrEqual(400)
    expect(fast.duration).toBeGreaterThanOrEqual(500)
    expect(fast.duration).toBeLessThanOrEqual(THROW_MAX_MS)
    expect(fast.to.x - fast.from.x).toBe(THROW_MAX_DISTANCE)
  })

  test('glideAt: rounded px along the curve, exactly the end once over', () => {
    const plan = planGlide(WIN, { vx: 1, vy: 0.5 }, DISPLAY)!
    const mid = glideAt(plan, 50)
    expect(Number.isInteger(mid.x) && Number.isInteger(mid.y)).toBe(true)
    expect(mid.x).toBeGreaterThan(WIN.x)
    expect(mid.x).toBeLessThan(plan.to.x)
    expect(glideAt(plan, plan.duration)).toEqual(plan.to)
    expect(plan.to).toEqual({ ...WIN, x: WIN.x + 100, y: WIN.y + 50 })
  })

  test('edges: eases into the work area edge (same release speed, stronger friction), never off screen', () => {
    // 60 px from the left edge, thrown left at 2 px/ms (would travel 200).
    const from = { ...WIN, x: 60 }
    const plan = planGlide(from, { vx: -2, vy: 0 }, DISPLAY)!
    expect(plan.to.x).toBe(WA.x)
    expect(plan.x.tau).toBeCloseTo(30, 6)
    // Leaves at the release speed.
    expect(glideAxisAt(plan.x, 1)).toBeCloseTo(-2, 0)
    // Never past the edge on the way.
    for (let t = 0; t <= plan.duration; t += 8) expect(glideAt(plan, t).x).toBeGreaterThanOrEqual(WA.x)
    // Bottom edge: ends flush with the work area's bottom.
    const down = planGlide({ ...WIN, y: 600 }, { vx: 0, vy: 3 }, DISPLAY)!
    expect(down.to.y + down.to.height).toBe(WA.y + WA.height)
  })

  test('let go partly off screen: eases back inside', () => {
    const from = { ...WIN, x: -50 }
    const plan = planGlide(from, { vx: 0, vy: 1 }, DISPLAY)!
    expect(plan.to.x).toBe(WA.x)
  })

  test('already at the edge, thrown into it: nothing to do', () => {
    expect(planGlide({ ...WIN, x: WA.x }, { vx: -2, vy: 0 }, DISPLAY)).toBeNull()
  })

  test('multi-display: crosses only when the throw carries its centre onto the next display', () => {
    const left = { workArea: { x: 0, y: 0, width: 1000, height: 800 } }
    const right = { workArea: { x: 1000, y: 0, width: 1000, height: 800 } }
    const displays = [left, right]
    // Centre lands on the right display: crosses, ends inside it.
    const across = planGlide({ x: 700, y: 200, width: 400, height: 300 }, { vx: 4, vy: 0 }, displays)!
    expect(across.to.x).toBe(1100)
    expect(across.to.x).toBeGreaterThanOrEqual(right.workArea.x)
    // Too slow to get its centre across: stops at the left display's edge.
    const short = planGlide({ x: 450, y: 200, width: 400, height: 300 }, { vx: 2, vy: 0 }, displays)!
    expect(short.to.x + short.to.width).toBe(1000)
    // Thrown off the desktop (no display there): stays on its own display.
    expect(throwWorkArea({ x: 700, y: 200, width: 400, height: 300 }, { x: 700, y: -900, width: 400, height: 300 }, displays)).toEqual(left.workArea)
  })
})

describe('fling to tuck', () => {
  const always = () => true
  test('a fast throw at an outer edge that would carry it past tucks there', () => {
    const near = { ...WIN, x: 1000 }
    expect(flingTuckEdge(near, { vx: 3, vy: 0.4 }, WA, always)).toBe('right')
    expect(flingTuckEdge({ ...WIN, y: 500 }, { vx: 0.2, vy: 2.5 }, WA, always)).toBe('bottom')
  })

  test('slower throws, throws aimed elsewhere, edges that cannot tuck, or ones that would not reach: just glide', () => {
    const near = { ...WIN, x: 1100 }
    expect(flingTuckEdge(near, { vx: 1.2, vy: 0 }, WA, always)).toBeNull()
    // Mostly downward, a bit right: not aimed at the right edge (and the bottom is far).
    expect(flingTuckEdge(near, { vx: 1.6, vy: 2.5 }, { ...WA, height: 5000 }, always)).toBeNull()
    expect(flingTuckEdge(near, { vx: 3, vy: 0 }, WA, (edge) => edge !== 'right')).toBeNull()
    // Middle of a huge display: the glide wouldn't reach the edge.
    expect(flingTuckEdge({ ...WIN, x: 100 }, { vx: 3, vy: 0 }, { x: 0, y: 0, width: 5000, height: 2000 }, always)).toBeNull()
  })

  test('the tuck lands where the glide along the edge would take it, and its slide continues the throw speed', () => {
    const along = flingAlong({ ...WIN, x: 1100, y: 300 }, { vx: 3, vy: 0.5 }, 'right', WA)
    expect(along.y).toBe(350)
    expect(along.x).toBe(1100)
    // 3·distance / speed: 300 px at 3 px/ms → 300 ms; a long way at a slow fling caps at 400.
    expect(flingSlideMs(300, 3, 180)).toBe(300)
    expect(flingSlideMs(600, 1.5, 180)).toBe(400)
    expect(flingSlideMs(100, 3, 180)).toBe(100)
    expect(flingSlideMs(10, 4, 180)).toBe(60)
    expect(flingSlideMs(0, 4, 180)).toBe(180)
  })
})

describe('handle glide along an edge', () => {
  test('glides along, eases into the end of the edge, ignores slow throws', () => {
    const glide = planEdgeGlide(200, 2, 0, 300)!
    expect(glide.to).toBe(300)
    expect(glide.axis.tau).toBeCloseTo(50, 6)
    expect(planEdgeGlide(200, 0.2, 0, 300)).toBeNull()
    expect(planEdgeGlide(300, 2, 0, 300)).toBeNull()
    expect(planEdgeGlide(200, -1, 0, 1000)!.to).toBe(100)
  })
})

describe('runGlide on the frame loop', () => {
  function rig() {
    const timers = fakeTimers()
    const loop = createFrameLoop({ now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, interval: () => frameIntervalFor(60) })
    return { timers, loop }
  }

  test('steps once a frame from the release point and arrives', () => {
    const { timers, loop } = rig()
    const plan = planGlide(WIN, { vx: 2, vy: 0 }, DISPLAY) as GlidePlan
    const placed: number[] = []
    let arrived = false
    runGlide(loop, 'k', plan, (rect) => { placed.push(rect.x); return true }, () => { arrived = true })
    timers.advance(plan.duration + 100)
    expect(arrived).toBe(true)
    expect(placed.at(-1)).toBe(plan.to.x)
    // The first frame is a real step away from where it was let go, in the throw's direction.
    expect(placed[0]).toBeGreaterThan(WIN.x)
    expect(placed.length).toBeGreaterThanOrEqual(Math.floor(plan.duration / (1000 / 60)) - 1)
    for (let i = 1; i < placed.length; i++) expect(placed[i]!).toBeGreaterThanOrEqual(placed[i - 1]!)
    expect(loop.running()).toBe(false)
  })

  test('grabbing again stops it at once (cancel, or the step saying no)', () => {
    const { timers, loop } = rig()
    const plan = planGlide(WIN, { vx: 2, vy: 0 }, DISPLAY) as GlidePlan
    let steps = 0
    let arrived = false
    runGlide(loop, 'k', plan, () => { steps++; return true }, () => { arrived = true })
    timers.advance(60)
    const before = steps
    loop.cancel('k')
    timers.advance(1000)
    expect(steps).toBe(before)
    expect(arrived).toBe(false)

    let grabbed = false
    let after = 0
    runGlide(loop, 'k2', plan, () => { if (grabbed) return false; after++; return true }, () => { arrived = true })
    timers.advance(50)
    grabbed = true
    const at = after
    timers.advance(1000)
    expect(after).toBe(at)
    expect(arrived).toBe(false)
    expect(loop.running()).toBe(false)
  })

  test('a slow frame never slows it down (time based): it still arrives on time', () => {
    const { timers, loop } = rig()
    const plan = planGlide(WIN, { vx: 3, vy: 0 }, DISPLAY) as GlidePlan
    let arrivedAt = -1
    runGlide(loop, 'k', plan, () => true, () => { arrivedAt = timers.now() })
    timers.advance(plan.duration + 40)
    expect(arrivedAt).toBeGreaterThan(0)
    expect(arrivedAt).toBeLessThanOrEqual(plan.duration + 20)
  })
})
