import { describe, expect, test } from 'bun:test'
import { createPanelActivationGuard } from './mac-panel'

function rig(options: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; addon?: unknown; throws?: boolean } = {}) {
  const calls: Buffer[] = []
  const warnings: string[] = []
  let loads = 0
  const guard = createPanelActivationGuard({
    platform: options.platform ?? 'darwin',
    env: options.env ?? {},
    load: () => {
      loads += 1
      if (options.throws) throw new Error('dlopen failed')
      return (options.addon === undefined
        ? { preventActivation: (handle: Buffer) => { calls.push(handle); return true } }
        : options.addon) as never
    },
    warn: (message) => { warnings.push(message) }
  })
  const window = (destroyed = false) => ({ isDestroyed: () => destroyed, getNativeWindowHandle: () => Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) })
  return { guard, calls, warnings, window, loads: () => loads }
}

describe('panel activation guard (macOS panels never activate Surffish)', () => {
  test('macOS: hands the window handle to the addon, loaded once', () => {
    const { guard, calls, window, loads, warnings } = rig()
    expect(guard.apply(window())).toBe(true)
    expect(guard.apply(window())).toBe(true)
    expect(calls).toHaveLength(2)
    expect([...calls[0]!]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(loads()).toBe(1)
    expect(guard.available()).toBe(true)
    expect(warnings).toEqual([])
  })

  test('never on Linux/Windows, and never loads the addon there', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const { guard, calls, window, loads } = rig({ platform })
      expect(guard.apply(window())).toBe(false)
      expect(guard.available()).toBe(false)
      expect(calls).toHaveLength(0)
      expect(loads()).toBe(0)
    }
  })

  test('SURFFISH_PANEL_ACTIVATION=allow opts out (comparing on a Mac)', () => {
    const { guard, window, loads } = rig({ env: { SURFFISH_PANEL_ACTIVATION: 'allow' } })
    expect(guard.apply(window())).toBe(false)
    expect(loads()).toBe(0)
  })

  test('no addon built, a stale addon without the export, or a failing load: nothing applied, warned once', () => {
    const missing = rig({ addon: null })
    expect(missing.guard.apply(missing.window())).toBe(false)
    expect(missing.warnings).toEqual([])
    const stale = rig({ addon: { start() {}, stop() {} } })
    expect(stale.guard.apply(stale.window())).toBe(false)
    expect(stale.guard.apply(stale.window())).toBe(false)
    expect(stale.warnings).toHaveLength(1)
    expect(stale.loads()).toBe(1)
    const failing = rig({ throws: true })
    expect(failing.guard.apply(failing.window())).toBe(false)
    expect(failing.guard.available()).toBe(false)
    expect(failing.warnings).toHaveLength(1)
  })

  test('a destroyed window or a throwing addon call is skipped', () => {
    const { guard, calls, window } = rig()
    expect(guard.apply(window(true))).toBe(false)
    expect(calls).toHaveLength(0)
    const throwing = rig({ addon: { preventActivation: () => { throw new Error('bad handle') } } })
    expect(throwing.guard.apply(throwing.window())).toBe(false)
    expect(throwing.warnings).toHaveLength(1)
  })
})
