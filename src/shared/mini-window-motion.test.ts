import { describe, expect, test } from 'bun:test'
import { createFrameLoop, easeOut, frameIntervalFor, lerpRect, motionDuration, type MotionRect } from './mini-window-motion'

/** Fake clock: timeouts fire as time advances (late by `lag` ms when set, like a busy main thread). */
function fakeTimers() {
  let now = 0
  let next = 1
  const timers = new Map<number, { fn: () => void; at: number }>()
  const api = {
    lag: 0,
    now: () => now,
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = next++
      timers.set(id, { fn, at: now + ms + api.lag })
      return id
    },
    clearTimeout: (id: unknown) => { timers.delete(id as number) },
    pending: () => timers.size,
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
  return api
}

function rig(hz = 60) {
  const timers = fakeTimers()
  const loop = createFrameLoop({ now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, interval: () => frameIntervalFor(hz) })
  return { timers, loop }
}

const rect = (x: number, y = 0): MotionRect => ({ x, y, width: 100, height: 100 })

describe('frame loop', () => {
  test('ticks at the display refresh rate, drift-corrected, and stops when idle', () => {
    const { timers, loop } = rig(120)
    const ticks: number[] = []
    let left = 12
    timers.lag = 1 // every timer fires 1 ms late: the schedule still holds 8.33 ms on average
    loop.run('a', (now) => { ticks.push(now); return --left > 0 })
    timers.advance(1000)
    expect(ticks.length).toBe(12)
    const span = (ticks[11] ?? 0) - (ticks[0] ?? 0)
    expect(span / 11).toBeGreaterThan(8.2)
    expect(span / 11).toBeLessThan(8.6)
    expect(timers.pending()).toBe(0)
    expect(loop.running()).toBe(false)
  })

  test('all jobs run in the same tick, and each window gets one setBounds per tick (last wins)', () => {
    const { timers, loop } = rig()
    const applied: Array<[string, number, number]> = []
    const win = { id: 'win' }
    const panel = { id: 'panel' }
    let frame = 0
    loop.run('lead', (now) => {
      frame++
      loop.place(win, rect(frame), (r) => applied.push(['win', r.x, now]))
      loop.place(win, rect(frame * 10), (r) => applied.push(['win', r.x, now]))
      loop.place(panel, rect(frame * 10, -64), (r) => applied.push(['panel', r.x, now]))
      return frame < 3
    })
    loop.run('follower', (now) => {
      loop.place({}, rect(frame), (r) => applied.push(['follower', r.x, now]))
      return frame < 3
    })
    timers.advance(200)
    for (const n of [1, 2, 3]) {
      const tick = applied.filter((entry) => entry[1] === n * 10 || (entry[0] === 'follower' && entry[1] === n))
      expect(tick.map((entry) => entry[0]).sort()).toEqual(['follower', 'panel', 'win'])
      expect(new Set(tick.map((entry) => entry[2])).size).toBe(1)
    }
    expect(applied.filter((entry) => entry[0] === 'win').length).toBe(3)
  })

  test('an unchanged rect is not applied again', () => {
    const { timers, loop } = rig()
    let current = rect(5)
    let calls = 0
    loop.run('job', () => {
      loop.place('w', rect(5), (r) => { calls++; current = r }, () => current)
      return false
    })
    timers.advance(50)
    expect(calls).toBe(0)
  })

  test('once() coalesces per key; cancel() stops a job; drop() forgets a queued place', () => {
    const { timers, loop } = rig()
    const ran: number[] = []
    for (let i = 0; i < 5; i++) loop.once('follow', () => ran.push(i))
    let count = 0
    loop.run('job', () => { count++; return true })
    loop.place('w', rect(1), () => ran.push(99))
    loop.drop('w')
    timers.advance(20)
    expect(ran).toEqual([4])
    loop.cancel('job')
    const before = count
    timers.advance(100)
    expect(count).toBe(before)
    expect(timers.pending()).toBe(0)
  })

  test('a job replaced mid-tick (an interrupted slide) runs only as the new one', () => {
    const { timers, loop } = rig()
    const seen: string[] = []
    loop.run('slide', () => { seen.push('old'); return true })
    timers.advance(17)
    loop.run('slide', () => { seen.push('new'); return false })
    timers.advance(100)
    expect(seen).toEqual(['old', 'new'])
  })

  test('outside a tick, place() goes out on the next tick', () => {
    const { timers, loop } = rig()
    let applied = 0
    loop.place('w', rect(3), () => applied++)
    expect(loop.inTick()).toBe(false)
    timers.advance(17)
    expect(applied).toBe(1)
  })
})

describe('motion maths', () => {
  test('frame interval from the refresh rate (clamped, 60 Hz when unknown)', () => {
    expect(frameIntervalFor(60)).toBeCloseTo(16.667, 2)
    expect(frameIntervalFor(120)).toBeCloseTo(8.333, 2)
    expect(frameIntervalFor(0)).toBeCloseTo(16.667, 2)
    expect(frameIntervalFor(undefined)).toBeCloseTo(16.667, 2)
    expect(frameIntervalFor(1000)).toBeCloseTo(1000 / 240, 2)
    expect(frameIntervalFor(10)).toBeCloseTo(1000 / 30, 2)
  })
  test('ease-out: fast start, settles at the end', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.8)
    expect(lerpRect(rect(0), rect(100), 0.5).x).toBe(88)
    expect(lerpRect(rect(0), rect(100), 2).x).toBe(100)
  })
  test('shorter moves take proportionally less (never under 40%), none takes 0', () => {
    expect(motionDuration(rect(0), rect(420), 420, 180)).toBe(180)
    expect(motionDuration(rect(0), rect(210), 420, 180)).toBe(90)
    expect(motionDuration(rect(0), rect(10), 420, 180)).toBe(72)
    expect(motionDuration(rect(0), rect(0), 420, 180)).toBe(0)
    expect(motionDuration(rect(0), rect(900), 420, 180)).toBe(180)
  })
})
