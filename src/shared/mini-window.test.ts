import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_MINI_WINDOW_SHORTCUT,
  MINI_WINDOW_CASCADE_STEP,
  MINI_WINDOW_MARGIN,
  MINI_WINDOW_MAX,
  cascadeMiniBounds,
  freeMiniSlot,
  parseMiniSlots,
  withMiniSlot,
  acceleratorFromKeyEvent,
  canPopOutUrl,
  clampMiniBounds,
  clashingAppShortcut,
  formatAccelerator,
  initialMiniBounds,
  miniDisplayKey,
  miniHeaderUrl,
  normalizeAccelerator,
  normalizeMiniWindowUrl,
  parseMiniGeometry,
  parseMiniWindowSettings,
  snapMiniToCorner
} from './mini-window'

const workArea = { x: 0, y: 25, width: 1440, height: 875 }

describe('mini window settings', () => {
  test('defaults: no pinned page, the default shortcut, opaque', () => {
    expect(parseMiniWindowSettings(null)).toEqual({ defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1, tuckToEdge: true, peekOnHover: false })
    expect(parseMiniWindowSettings({ shortcut: 'nonsense', opacity: 'x' })).toEqual({ defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1, tuckToEdge: true, peekOnHover: false })
  })

  test('tuck to edge is on and peek off by default; booleans are kept', () => {
    expect(parseMiniWindowSettings({ tuckToEdge: false, peekOnHover: true })).toMatchObject({ tuckToEdge: false, peekOnHover: true })
    expect(parseMiniWindowSettings({ tuckToEdge: 'no', peekOnHover: 1 })).toMatchObject({ tuckToEdge: true, peekOnHover: false })
  })

  test('an explicit empty shortcut turns it off', () => {
    expect(parseMiniWindowSettings({ shortcut: '' }).shortcut).toBe('')
  })

  test('opacity is clamped and rounded', () => {
    expect(parseMiniWindowSettings({ opacity: 0.1 }).opacity).toBe(0.4)
    expect(parseMiniWindowSettings({ opacity: 3 }).opacity).toBe(1)
    expect(parseMiniWindowSettings({ opacity: 0.8333 }).opacity).toBe(0.83)
  })

  test('default page: bare hosts get https, other schemes are rejected', () => {
    expect(normalizeMiniWindowUrl('claude.ai')).toBe('https://claude.ai/')
    expect(normalizeMiniWindowUrl(' https://chatgpt.com/ ')).toBe('https://chatgpt.com/')
    expect(normalizeMiniWindowUrl('')).toBe('')
    expect(normalizeMiniWindowUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeMiniWindowUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeMiniWindowUrl('https://user:pw@example.com')).toBeNull()
    expect(normalizeMiniWindowUrl('two words')).toBeNull()
    expect(parseMiniWindowSettings({ defaultUrl: 'file:///x' }).defaultUrl).toBe('')
  })
})

describe('accelerators', () => {
  test('normalizes names and order', () => {
    expect(normalizeAccelerator('shift+cmd+space')).toBe('Command+Shift+Space')
    expect(normalizeAccelerator('CmdOrCtrl+Shift+Space')).toBe('CommandOrControl+Shift+Space')
    expect(normalizeAccelerator('ctrl+alt+m')).toBe('Control+Alt+M')
    expect(normalizeAccelerator('Alt+F5')).toBe('Alt+F5')
  })

  test('needs a non-Shift modifier and exactly one key', () => {
    expect(normalizeAccelerator('Space')).toBeNull()
    expect(normalizeAccelerator('Shift+A')).toBeNull()
    expect(normalizeAccelerator('Command+A+B')).toBeNull()
    expect(normalizeAccelerator('Command+Shift')).toBeNull()
    expect(normalizeAccelerator('Command+Banana')).toBeNull()
  })

  test('clashes with Surffish shortcuts are found per platform', () => {
    const app = ['CmdOrCtrl+K', 'CmdOrCtrl+Shift+M', '']
    expect(clashingAppShortcut('Command+K', app, true)).toBe('CmdOrCtrl+K')
    expect(clashingAppShortcut('Command+K', app, false)).toBeNull()
    expect(clashingAppShortcut('Control+Shift+M', app, false)).toBe('CmdOrCtrl+Shift+M')
    expect(clashingAppShortcut(DEFAULT_MINI_WINDOW_SHORTCUT, app, true)).toBeNull()
  })

  test('key presses become accelerators', () => {
    const press = (code: string, key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ code, key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
    expect(acceleratorFromKeyEvent(press('Space', ' ', { metaKey: true, shiftKey: true }), true)).toBe('Command+Shift+Space')
    expect(acceleratorFromKeyEvent(press('KeyM', 'µ', { altKey: true, ctrlKey: true }), false)).toBe('Control+Alt+M')
    expect(acceleratorFromKeyEvent(press('ShiftLeft', 'Shift', { shiftKey: true }), true)).toBeNull()
    expect(acceleratorFromKeyEvent(press('KeyA', 'a'), true)).toBeNull()
  })

  test('formatting', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Space', true)).toBe('⌘⇧Space')
    expect(formatAccelerator('CommandOrControl+Shift+Space', false)).toBe('Ctrl+Shift+Space')
    expect(formatAccelerator('', false)).toBe('Off')
  })
})

describe('geometry', () => {
  test('first open sits in the bottom-right corner', () => {
    const bounds = initialMiniBounds(workArea, undefined)
    expect(bounds.x + bounds.width).toBe(workArea.width - MINI_WINDOW_MARGIN)
    expect(bounds.y + bounds.height).toBe(workArea.y + workArea.height - MINI_WINDOW_MARGIN)
  })

  test('saved bounds are clamped onto the display', () => {
    expect(initialMiniBounds(workArea, { x: 5000, y: -50, width: 400, height: 300 })).toEqual({ x: 1040, y: 25, width: 400, height: 300 })
    expect(clampMiniBounds({ x: 0, y: 0, width: 50, height: 5000 }, workArea)).toEqual({ x: 0, y: 25, width: 280, height: 875 })
  })

  test('snaps into a corner only when near both edges', () => {
    expect(snapMiniToCorner({ x: 10, y: 40, width: 400, height: 300 }, workArea)).toEqual({ x: 16, y: 41, width: 400, height: 300 })
    expect(snapMiniToCorner({ x: 1030, y: 590, width: 400, height: 300 }, workArea)).toEqual({ x: 1024, y: 584, width: 400, height: 300 })
    expect(snapMiniToCorner({ x: 10, y: 300, width: 400, height: 300 }, workArea)).toBeNull()
    // Already in the corner: nothing to do.
    expect(snapMiniToCorner({ x: 16, y: 41, width: 400, height: 300 }, workArea)).toBeNull()
  })

  test('display keys and saved geometry parsing', () => {
    expect(miniDisplayKey(workArea)).toBe('0,25,1440x875')
    expect(parseMiniGeometry({ a: { x: 1, y: 2, width: 3, height: 4 }, b: { x: 'no' }, c: { x: 1, y: 1, width: 0, height: 9 } })).toEqual({ a: { x: 1, y: 2, width: 3, height: 4 } })
    expect(parseMiniGeometry('junk')).toEqual({})
  })
})

describe('pages', () => {
  test('header url and pop-out eligibility', () => {
    expect(miniHeaderUrl('https://claude.ai/new')).toBe('claude.ai/new')
    expect(miniHeaderUrl('https://claude.ai/')).toBe('claude.ai')
    expect(canPopOutUrl('https://example.com')).toBe(true)
    expect(canPopOutUrl('surffish://newtab')).toBe(false)
    expect(canPopOutUrl('chrome-extension://abc/popup.html')).toBe(false)
  })
})

describe('several mini windows', () => {
  test('slots: the lowest free one, none past the cap', () => {
    expect(freeMiniSlot([])).toBe(0)
    expect(freeMiniSlot([0, 1, 3])).toBe(2)
    expect(freeMiniSlot([1])).toBe(0)
    expect(freeMiniSlot([0, 1, 2, 3, 4, 5])).toBeNull()
    expect(MINI_WINDOW_MAX).toBe(6)
  })

  test('cascade: a free spot stays put; a taken one steps toward the middle', () => {
    const corner = initialMiniBounds(workArea, undefined)
    expect(cascadeMiniBounds(corner, [], workArea)).toEqual(corner)
    const second = cascadeMiniBounds(corner, [corner], workArea)
    expect(second).toEqual({ ...corner, x: corner.x - MINI_WINDOW_CASCADE_STEP, y: corner.y - MINI_WINDOW_CASCADE_STEP })
    const third = cascadeMiniBounds(corner, [corner, second], workArea)
    expect(third.x).toBe(corner.x - 2 * MINI_WINDOW_CASCADE_STEP)
    // Top-left windows step down and right.
    const topLeft = { x: workArea.x + 16, y: workArea.y + 16, width: 420, height: 620 }
    expect(cascadeMiniBounds(topLeft, [topLeft], workArea)).toMatchObject({ x: topLeft.x + MINI_WINDOW_CASCADE_STEP, y: topLeft.y + MINI_WINDOW_CASCADE_STEP })
  })

  test('cascade: six windows never share a spot and stay on screen', () => {
    const placed: Array<{ x: number; y: number; width: number; height: number }> = []
    for (let i = 0; i < MINI_WINDOW_MAX; i++) placed.push(cascadeMiniBounds(initialMiniBounds(workArea, placed.at(-1)), placed, workArea))
    const spots = new Set(placed.map((rect) => `${rect.x},${rect.y}`))
    expect(spots.size).toBe(MINI_WINDOW_MAX)
    for (const rect of placed) expect(clampMiniBounds(rect, workArea)).toEqual(rect)
  })

  test('cascade: stops when it cannot move (window fills the work area)', () => {
    const full = { ...workArea }
    expect(cascadeMiniBounds(full, [full], workArea)).toEqual(full)
  })

  test('slots: the single-window format reads as slot 0 (migration)', () => {
    const legacy = { '0,25,1440x875': { x: 10, y: 40, width: 400, height: 500 } }
    expect(parseMiniSlots(legacy, parseMiniGeometry)).toEqual([legacy])
    expect(parseMiniSlots({}, parseMiniGeometry)).toEqual([])
    expect(parseMiniSlots(null, parseMiniGeometry)).toEqual([])
    const two = { slots: [legacy, { '0,25,1440x875': { x: 50, y: 80, width: 400, height: 500 } }] }
    expect(parseMiniSlots(two, parseMiniGeometry)).toEqual(two.slots)
    expect(parseMiniSlots({ slots: [{ bad: 1 }, 'nope'] }, parseMiniGeometry)).toEqual([{}, {}])
    expect(parseMiniSlots({ slots: Array.from({ length: 20 }, () => legacy) }, parseMiniGeometry)).toHaveLength(MINI_WINDOW_MAX)
  })

  test('slots: write one, keep the rest, drop trailing empties', () => {
    const a = { k: { x: 1, y: 2, width: 300, height: 300 } }
    expect(withMiniSlot([], 2, a)).toEqual({ slots: [{}, {}, a] })
    expect(withMiniSlot([a, a], 1, {})).toEqual({ slots: [a] })
    expect(withMiniSlot([a], 0, {})).toEqual({ slots: [] })
    // Migrated legacy data written back keeps slot 0.
    expect(withMiniSlot(parseMiniSlots(a, (v) => v as Record<string, typeof a.k>), 1, a)).toEqual({ slots: [a, a] })
  })
})
