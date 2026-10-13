import { describe, expect, test } from 'bun:test'
import { discardOrder, lowAvailableThresholdMB, MIN_BACKGROUND_MS, memoryPressure, parseMemorySaverSettings, type DiscardCandidate } from './memory-saver'

const now = 10_000_000
const tab = (id: string, extra: Partial<DiscardCandidate> = {}): DiscardCandidate => ({
  id, live: true, onScreen: false, audible: false, pinned: false, protected: false, inactiveSince: now - MIN_BACKGROUND_MS - 1, ...extra
})

describe('memory saver', () => {
  test('on by default; a saved choice is kept', () => {
    expect(parseMemorySaverSettings(undefined)).toEqual({ enabled: true })
    expect(parseMemorySaverSettings({ enabled: false })).toEqual({ enabled: false })
    expect(parseMemorySaverSettings({ enabled: 'no' })).toEqual({ enabled: true })
  })

  test('pressure: low available memory, macOS pressure level, or Surffish over half of RAM', () => {
    const base = { totalMB: 16_384, availableMB: 8_000, macPressureLevel: null, surffishMB: 1_000 }
    expect(memoryPressure(base)).toBeNull()
    expect(memoryPressure({ ...base, availableMB: 1_500 })).toBe('system')
    expect(lowAvailableThresholdMB(16_384)).toBe(1638.4)
    expect(lowAvailableThresholdMB(4_096)).toBe(512)
    expect(lowAvailableThresholdMB(65_536)).toBe(2048)
    expect(memoryPressure({ ...base, surffishMB: 9_000 })).toBe('surffish')
    // macOS: the kernel level decides; "available" isn't consulted.
    expect(memoryPressure({ ...base, availableMB: null, macPressureLevel: 1 })).toBeNull()
    expect(memoryPressure({ ...base, availableMB: null, macPressureLevel: 2 })).toBe('system')
    expect(memoryPressure({ ...base, availableMB: null, macPressureLevel: 4 })).toBe('system')
    expect(memoryPressure({ ...base, availableMB: null, macPressureLevel: 1, surffishMB: 9_000 })).toBe('surffish')
  })

  test('discard order: least recently used live background tabs only', () => {
    const order = discardOrder([
      tab('newer', { inactiveSince: now - MIN_BACKGROUND_MS - 10 }),
      tab('oldest', { inactiveSince: now - 3 * MIN_BACKGROUND_MS }),
      tab('active', { onScreen: true, inactiveSince: null }),
      tab('playing', { audible: true }),
      tab('pinned', { pinned: true }),
      tab('editor', { protected: true }),
      tab('asleep', { live: false }),
      tab('recent', { inactiveSince: now - 60_000 })
    ], now)
    expect(order.map((t) => t.id)).toEqual(['oldest', 'newer'])
  })
})
