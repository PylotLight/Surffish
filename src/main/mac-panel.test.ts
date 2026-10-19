import { describe, expect, test } from 'bun:test'
import { createPanelActivationGuard, describeCollectionBehavior, describeSpaceShow, isSpaceReorderHide, noteSpaceReorder, type SpaceShowReport } from './mac-panel'

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

const report = (overrides: Partial<SpaceShowReport> = {}): SpaceShowReport => ({
  behaviorBefore: 0x101,
  behaviorJoined: 0x101,
  behaviorAfter: 0x101,
  wasVisible: false,
  wasOnActiveSpace: false,
  onActiveSpace: true,
  fallback: false,
  fallbackOnActiveSpace: false,
  rejoinedAllSpaces: false,
  onActiveSpaceAfter: true,
  preventsActivation: true,
  appActive: false,
  isKey: false,
  level: 3,
  occlusion: 8194,
  windowNumber: 42,
  ...overrides
})

function spaceRig(options: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; addon?: unknown; throws?: boolean } = {}) {
  const logs: Array<[string, string]> = []
  const warnings: string[] = []
  const handles: Buffer[] = []
  let loads = 0
  const guard = createPanelActivationGuard({
    platform: options.platform ?? 'darwin',
    env: options.env ?? {},
    load: () => {
      loads += 1
      if (options.throws) throw new Error('dlopen failed')
      return (options.addon === undefined
        ? { preventActivation: () => true, showOnActiveSpace: (handle: Buffer) => { handles.push(handle); return report() } }
        : options.addon) as never
    },
    warn: (message) => { warnings.push(message) },
    log: (kind, detail) => { logs.push([kind, detail]) }
  })
  const window = (destroyed = false) => ({ isDestroyed: () => destroyed, getNativeWindowHandle: () => Buffer.from([8, 7, 6, 5, 4, 3, 2, 1]) })
  return { guard, logs, warnings, handles, window, loads: () => loads }
}

describe('showing a panel on the active Space (menu bar popout on Space 1, browser on Space 2)', () => {
  test('macOS: hands the handle to the native showOnActiveSpace and logs what happened', () => {
    const { guard, handles, logs, window } = spaceRig()
    const result = guard.showOnActiveSpace(window(), '[mini 0 popout]')
    expect(result?.onActiveSpace).toBe(true)
    expect([...handles[0]!]).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
    expect(logs).toHaveLength(1)
    expect(logs[0]![0]).toBe('space')
    expect(logs[0]![1]).toContain('[mini 0 popout] on active Space')
    expect(logs[0]![1]).toContain('before=[0x101 CanJoinAllSpaces|FullScreenAuxiliary]')
  })

  test('not gated on SURFFISH_PANEL_ACTIVATION=allow (that is about activation, not Spaces)', () => {
    const { guard, handles, window } = spaceRig({ env: { SURFFISH_PANEL_ACTIVATION: 'allow' } })
    expect(guard.apply(window())).toBe(false)
    expect(guard.showOnActiveSpace(window(), 'x')).not.toBeNull()
    expect(handles).toHaveLength(1)
  })

  test('never on Linux/Windows', () => {
    for (const platform of ['linux', 'win32'] as const) {
      const { guard, loads, window } = spaceRig({ platform })
      expect(guard.showOnActiveSpace(window(), 'x')).toBeNull()
      expect(loads()).toBe(0)
    }
  })

  test('a stale addon with only preventActivation: still guards activation, warns once (and logs) about Spaces', () => {
    const { guard, warnings, logs, window } = spaceRig({ addon: { preventActivation: () => true } })
    expect(guard.apply(window())).toBe(true)
    expect(guard.showOnActiveSpace(window(), 'x')).toBeNull()
    expect(guard.showOnActiveSpace(window(), 'x')).toBeNull()
    expect(warnings).toHaveLength(1)
    expect(logs.filter(([kind]) => kind === 'panel')).toHaveLength(1)
  })

  test('addon load failures and a missing build reach the debug log, not just the console', () => {
    const failing = spaceRig({ throws: true })
    expect(failing.guard.showOnActiveSpace(failing.window(), 'x')).toBeNull()
    expect(failing.logs.some(([kind, detail]) => kind === 'panel' && detail.includes('dlopen failed'))).toBe(true)
    const missing = spaceRig({ addon: null })
    expect(missing.guard.showOnActiveSpace(missing.window(), 'x')).toBeNull()
    expect(missing.logs.some(([kind, detail]) => kind === 'panel' && detail.includes('not built'))).toBe(true)
    expect(missing.warnings).toEqual([])
  })

  test('a destroyed window, a refused handle or a throwing call: null, nothing breaks', () => {
    const { guard, handles, window } = spaceRig()
    expect(guard.showOnActiveSpace(window(true), 'x')).toBeNull()
    expect(handles).toHaveLength(0)
    const refused = spaceRig({ addon: { showOnActiveSpace: () => null } })
    expect(refused.guard.showOnActiveSpace(refused.window(), 'x')).toBeNull()
    expect(refused.logs.at(-1)?.[1]).toContain('refused')
    const throwing = spaceRig({ addon: { showOnActiveSpace: () => { throw new Error('bad handle') } } })
    expect(throwing.guard.showOnActiveSpace(throwing.window(), 'x')).toBeNull()
    expect(throwing.warnings).toHaveLength(1)
    expect(throwing.logs.at(-1)?.[1]).toContain('bad handle')
  })
})

describe('debug log lines', () => {
  test('collection behaviour bits by name', () => {
    expect(describeCollectionBehavior(0)).toBe('0x0 Default')
    expect(describeCollectionBehavior(0x101)).toBe('0x101 CanJoinAllSpaces|FullScreenAuxiliary')
    expect(describeCollectionBehavior(0x102)).toBe('0x102 MoveToActiveSpace|FullScreenAuxiliary')
    expect(describeCollectionBehavior(0x80 | (1 << 30))).toBe('0x40000080 FullScreenPrimary|+0x40000000')
    expect(describeCollectionBehavior(Number.NaN)).toBe('NaN')
  })

  test('says when the fallback ran and whether it worked', () => {
    expect(describeSpaceShow('[mini 0]', report())).toStartWith('[mini 0] on active Space;')
    const fixed = describeSpaceShow('[mini 0]', report({ onActiveSpace: false, fallback: true, fallbackOnActiveSpace: true, rejoinedAllSpaces: true }))
    expect(fixed).toContain('fallback MoveToActiveSpace: on active Space (rejoined all Spaces=true)')
    const stuck = describeSpaceShow('[mini 0]', report({ onActiveSpace: false, fallback: true, onActiveSpaceAfter: false, behaviorAfter: 0x102 }))
    expect(stuck).toContain('STILL NOT on active Space')
    expect(stuck).toContain('after=[0x102 MoveToActiveSpace|FullScreenAuxiliary]')
  })

  test('a fallback reorder hide is recognised only for a moment', () => {
    const window = {}
    expect(isSpaceReorderHide(window)).toBe(false)
    noteSpaceReorder(window, true, 1_000)
    expect(isSpaceReorderHide(window, 1_100)).toBe(true)
    expect(isSpaceReorderHide(window, 1_600)).toBe(false)
    noteSpaceReorder(window, true, 2_000)
    noteSpaceReorder(window, false)
    expect(isSpaceReorderHide(window, 2_010)).toBe(false)
  })
})
