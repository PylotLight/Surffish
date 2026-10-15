import { describe, expect, test } from 'bun:test'
import { MINI_PEEK_GRACE_MS, MINI_PEEK_POLL_MS, createPeekDriver, stepPeek, type PeekPoint, type PeekState } from './mini-window-peek'

/** Fake time: intervals fire as the clock advances. */
function fakeClock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { fn: () => void; ms: number; at: number }>()
  return {
    now: () => now,
    setInterval: (fn: () => void, ms: number): unknown => {
      const id = next++
      timers.set(id, { fn, ms, at: now + ms })
      return id
    },
    clearInterval: (id: unknown) => { timers.delete(id as number) },
    active: () => timers.size,
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let due: [number, { fn: () => void; ms: number; at: number }] | null = null
        for (const entry of timers) if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry
        if (!due) break
        const [id, timer] = due
        now = timer.at
        timer.at += timer.ms
        timer.fn()
        if (!timers.has(id)) continue
      }
      now = end
    }
  }
}

const HANDLE = { x: 1580, y: 480, width: 20, height: 64 }
const WINDOW = { x: 1180, y: 300, width: 420, height: 500 }
const inside = (r: { x: number; y: number; width: number; height: number }, p: PeekPoint): boolean => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

function rig(options: { delay?: number; enabled?: boolean } = {}) {
  const clock = fakeClock()
  const log: string[] = []
  const env = { cursor: { x: 0, y: 0 } as PeekPoint, out: false, blocked: false, enabled: options.enabled ?? true, delay: options.delay ?? 350 }
  const driver = createPeekDriver({
    now: clock.now,
    cursor: () => env.cursor,
    overHandle: (p) => inside(HANDLE, p),
    overWindow: (p) => env.out && inside(WINDOW, p),
    blocked: () => env.blocked,
    enabled: () => env.enabled,
    delayMs: () => env.delay,
    slideOut: () => { env.out = true; log.push('slide-out') },
    tuck: () => { env.out = false; log.push('tuck'); driver.cancel() },
    ended: () => log.push('ended'),
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval
  })
  const park = (x: number, y: number) => { env.cursor = { x, y } }
  return { clock, log, env, driver, park }
}

describe('hover peek driver (fake timers)', () => {
  test('resting on the handle peeks after the delay, not before', () => {
    const { clock, log, driver, park } = rig()
    park(1590, 500)
    driver.enter()
    clock.advance(300)
    expect(log).toEqual([])
    clock.advance(100)
    expect(log).toEqual(['slide-out'])
    expect(driver.phase()).toBe('out')
  })

  test('the delay setting is read live', () => {
    const { clock, log, driver, park, env } = rig({ delay: 1000 })
    park(1590, 500)
    driver.enter()
    clock.advance(600)
    expect(log).toEqual([])
    env.delay = 200
    clock.advance(MINI_PEEK_POLL_MS)
    expect(log).toEqual(['slide-out'])
  })

  test('a quick pass over the handle never peeks', () => {
    const { clock, log, driver, park } = rig()
    park(1590, 470)
    driver.enter()
    for (let y = 480; y <= 560; y += 10) {
      park(1590, y)
      clock.advance(MINI_PEEK_POLL_MS)
    }
    clock.advance(1000)
    expect(log).toEqual([])
    expect(driver.phase()).toBe('idle')
    expect(clock.active()).toBe(0)
  })

  test('moving on the handle restarts the wait (debounce); tiny jitter does not', () => {
    const { clock, log, driver, park } = rig()
    park(1585, 490)
    driver.enter()
    clock.advance(280)
    park(1585, 500) // 10px: restart
    clock.advance(280)
    expect(log).toEqual([])
    park(1587, 502) // under 4px from the new anchor: still resting
    clock.advance(120)
    expect(log).toEqual(['slide-out'])
  })

  test('pointerleave before the delay cancels', () => {
    const { clock, log, driver, park } = rig()
    park(1590, 500)
    driver.enter()
    clock.advance(200)
    driver.leave()
    clock.advance(1000)
    expect(log).toEqual([])
    expect(clock.active()).toBe(0)
  })

  test('blocked (drag, held button, sliding) keeps restarting the wait', () => {
    const { clock, log, driver, park, env } = rig()
    park(1590, 500)
    env.blocked = true
    driver.enter()
    clock.advance(1000)
    expect(log).toEqual([])
    env.blocked = false
    clock.advance(300)
    expect(log).toEqual([])
    clock.advance(100)
    expect(log).toEqual(['slide-out'])
  })

  test('peeked: stays while the pointer is over the window, tucks after the grace once away', () => {
    const { clock, log, driver, park } = rig()
    park(1590, 500)
    driver.enter()
    clock.advance(400)
    expect(log).toEqual(['slide-out'])
    // The handle moved off with the window: its pointerleave changes nothing.
    driver.leave()
    park(1300, 400)
    clock.advance(5000)
    expect(log).toEqual(['slide-out'])
    park(600, 400)
    clock.advance(MINI_PEEK_GRACE_MS - 2 * MINI_PEEK_POLL_MS)
    expect(log).toEqual(['slide-out'])
    // Back in before the grace ran out: still out.
    park(1300, 400)
    clock.advance(MINI_PEEK_POLL_MS)
    park(600, 400)
    clock.advance(MINI_PEEK_GRACE_MS - MINI_PEEK_POLL_MS)
    expect(log).toEqual(['slide-out'])
    clock.advance(2 * MINI_PEEK_POLL_MS)
    expect(log).toEqual(['slide-out', 'tuck', 'ended'])
    expect(driver.phase()).toBe('idle')
    expect(clock.active()).toBe(0)
  })

  test('a click or key inside pins it out', () => {
    const { clock, log, driver, park } = rig()
    park(1590, 500)
    driver.enter()
    clock.advance(400)
    park(1300, 400)
    clock.advance(100)
    driver.pin()
    park(100, 100)
    clock.advance(5000)
    expect(log).toEqual(['slide-out', 'ended'])
    expect(clock.active()).toBe(0)
  })

  test('turned off: enter does nothing, and turning off mid-dwell cancels', () => {
    const off = rig({ enabled: false })
    off.park(1590, 500)
    off.driver.enter()
    off.clock.advance(2000)
    expect(off.log).toEqual([])
    const on = rig()
    on.park(1590, 500)
    on.driver.enter()
    on.clock.advance(100)
    on.env.enabled = false
    on.clock.advance(1000)
    expect(on.log).toEqual([])
    expect(on.driver.phase()).toBe('idle')
  })

  test('enter while dwelling or out is ignored (one peek at a time)', () => {
    const { clock, log, driver, park } = rig()
    park(1590, 500)
    driver.enter()
    clock.advance(200)
    driver.enter()
    clock.advance(200)
    expect(log).toEqual(['slide-out'])
    driver.enter()
    clock.advance(100)
    expect(log).toEqual(['slide-out'])
  })
})

describe('stepPeek', () => {
  const sample = (over: Partial<{ now: number; cursor: PeekPoint; overHandle: boolean; overWindow: boolean; blocked: boolean; delayMs: number }>) => ({
    type: 'sample' as const, now: 0, cursor: { x: 0, y: 0 }, overHandle: true, overWindow: false, blocked: false, delayMs: 350, ...over
  })
  test('idle ignores samples and leave', () => {
    const idle: PeekState = { phase: 'idle' }
    expect(stepPeek(idle, sample({ now: 9999 }))).toEqual({ state: idle, effect: null })
    expect(stepPeek(idle, { type: 'leave' })).toEqual({ state: idle, effect: null })
  })
  test('dwell: off the handle cancels, the delay slides out', () => {
    const dwell: PeekState = { phase: 'dwell', anchor: { x: 5, y: 5 }, since: 0 }
    expect(stepPeek(dwell, sample({ now: 100, cursor: { x: 5, y: 5 }, overHandle: false })).state.phase).toBe('idle')
    expect(stepPeek(dwell, sample({ now: 350, cursor: { x: 7, y: 8 } })).effect).toBe('slide-out')
    expect(stepPeek(dwell, sample({ now: 350, cursor: { x: 9, y: 5 } }))).toEqual({ state: { phase: 'dwell', anchor: { x: 9, y: 5 }, since: 350 }, effect: null })
  })
  test('out: the grace counts from the last time the pointer was inside', () => {
    const out: PeekState = { phase: 'out', lastInside: 1000 }
    expect(stepPeek(out, sample({ now: 1200, overHandle: false })).effect).toBe(null)
    expect(stepPeek(out, sample({ now: 1000 + MINI_PEEK_GRACE_MS, overHandle: false }))).toEqual({ state: { phase: 'idle' }, effect: 'tuck' })
    expect(stepPeek(out, sample({ now: 5000, overHandle: false, overWindow: true }))).toEqual({ state: { phase: 'out', lastInside: 5000 }, effect: null })
  })
})
