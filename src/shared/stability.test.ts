import { describe, expect, test } from 'bun:test'
import { BRIDGE_RELOAD_LIMIT, BRIDGE_RELOAD_WINDOW_MS, countStabilityEvent, emptyStabilityCounters, errorSignature, LogThrottle, RecoveryBudget, STABILITY_RECENT_LIMIT, stabilityFailureTotal } from './stability'

describe('stability counters', () => {
  test('count, summarise and cap the recent list', () => {
    const counters = emptyStabilityCounters()
    for (let index = 0; index < STABILITY_RECENT_LIMIT + 5; index += 1) countStabilityEvent(counters, 'unhandledRejections', `boom ${index}`, 0)
    countStabilityEvent(counters, 'shellReloads', null)
    expect(counters.unhandledRejections).toBe(STABILITY_RECENT_LIMIT + 5)
    expect(counters.shellReloads).toBe(1)
    expect(counters.recent.length).toBe(STABILITY_RECENT_LIMIT)
    expect(counters.recent.at(-1)).toContain(`boom ${STABILITY_RECENT_LIMIT + 4}`)
  })

  test('failure total leaves out recoveries and hang prompts', () => {
    const counters = emptyStabilityCounters()
    countStabilityEvent(counters, 'gpuGone', null)
    countStabilityEvent(counters, 'tabRendererGone', null)
    countStabilityEvent(counters, 'shellReloads', null)
    countStabilityEvent(counters, 'unresponsive', null)
    expect(stabilityFailureTotal(counters)).toBe(2)
  })
})

describe('LogThrottle', () => {
  test('first few, then every Nth', () => {
    const throttle = new LogThrottle(2, 10)
    const logged = Array.from({ length: 30 }, () => throttle.shouldLog('same')).filter(Boolean)
    expect(logged).toEqual([1, 2, 10, 20, 30])
    expect(throttle.shouldLog('other')).toBe(1)
  })

  test('bounded number of signatures', () => {
    const throttle = new LogThrottle(1, 100, 3)
    for (const name of ['a', 'b', 'c', 'd']) throttle.shouldLog(name)
    // 'a' was forgotten, so it logs again as a first occurrence.
    expect(throttle.shouldLog('a')).toBe(1)
  })
})

describe('errorSignature', () => {
  test('first line of the message', () => {
    expect(errorSignature(new TypeError('x is undefined\n  at y'))).toBe('TypeError: x is undefined')
    expect(errorSignature('plain')).toBe('plain')
    expect(errorSignature(undefined)).toBe('undefined')
  })
})

describe('RecoveryBudget', () => {
  test('limit per window, then attempts age out', () => {
    const budget = new RecoveryBudget(2, 1000)
    expect(budget.tryTake(0)).toBe(true)
    expect(budget.tryTake(10)).toBe(true)
    expect(budget.tryTake(20)).toBe(false)
    expect(budget.tryTake(1001)).toBe(true)
  })

  test('extension bridge crash loop (reload every 1 s) stops after the limit, recovers after the window', () => {
    const budget = new RecoveryBudget(BRIDGE_RELOAD_LIMIT, BRIDGE_RELOAD_WINDOW_MS)
    const taken: boolean[] = []
    for (let crash = 0; crash < 10; crash += 1) taken.push(budget.tryTake(crash * 1000))
    expect(taken.filter(Boolean).length).toBe(BRIDGE_RELOAD_LIMIT)
    expect(taken.slice(BRIDGE_RELOAD_LIMIT).every((ok) => !ok)).toBe(true)
    expect(budget.tryTake(BRIDGE_RELOAD_WINDOW_MS + 5000)).toBe(true)
  })
})
