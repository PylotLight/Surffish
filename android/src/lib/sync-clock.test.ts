import { describe, expect, test } from 'bun:test'
import { HybridLogicalClock, formatHlc, uuidv7 } from './sync-clock'

describe('sync-clock (matches desktop stamp format)', () => {
  test('uuidv7 is a v7 uuid and time-ordered', () => {
    const a = uuidv7(1_000)
    const b = uuidv7(2_000)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
  })

  test('hlc stamps are fixed width and monotonic', () => {
    expect(formatHlc(1760400000000, 1, 'dev')).toBe('1760400000000:0001:dev')
    const clock = new HybridLogicalClock('dev', formatHlc(Date.now() + 60_000, 5, 'dev'))
    const s1 = clock.now()
    const s2 = clock.now()
    expect(s1 < s2).toBe(true)
    expect(s1).toMatch(/^\d{13}:[0-9a-f]{4}:dev$/)
  })
})
