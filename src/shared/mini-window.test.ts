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
  MINI_WINDOW_PEEK_DELAYS,
  isMiniWindowPeekDelay,
  snapMiniToCorner,
  MINI_WINDOW_HEADER_HEIGHT,
  MINI_WINDOW_TAB_STRIP_HEIGHT,
  miniHeaderHeight,
  miniMergeTarget,
  miniSplitBounds,
  miniTabDrop,
  planMiniRegroup,
  inMiniRevealZone,
  miniHeaderPanelRect,
  miniPageBounds,
  planMiniHeader,
  unionMiniRect
} from './mini-window'

const workArea = { x: 0, y: 25, width: 1440, height: 875 }

describe('mini window settings', () => {
  test('defaults: no pinned page, the default shortcut, opaque', () => {
    expect(parseMiniWindowSettings(null)).toEqual({ defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, throwMomentum: true, grouping: 'tabs', headerPlacement: 'float', menuBarIcon: 'in-use' })
    expect(parseMiniWindowSettings({ shortcut: 'nonsense', opacity: 'x' })).toEqual({ defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, throwMomentum: true, grouping: 'tabs', headerPlacement: 'float', menuBarIcon: 'in-use' })
  })

  test('tuck to edge is on and peek off by default; booleans are kept', () => {
    expect(parseMiniWindowSettings({ tuckToEdge: false, peekOnHover: false, peekDelayMs: 600 })).toMatchObject({ tuckToEdge: false, peekOnHover: false, peekDelayMs: 600 })
    expect(parseMiniWindowSettings({ tuckToEdge: 'no', peekOnHover: 1 })).toMatchObject({ tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, grouping: 'tabs', headerPlacement: 'float', menuBarIcon: 'in-use' })
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

describe('grouping', () => {
  test('settings from before grouping (the #203 format) read as tabs; bad values fall back', () => {
    const v203 = { defaultUrl: 'https://claude.ai/', shortcut: 'CommandOrControl+Shift+Space', opacity: 0.9, tuckToEdge: true, peekOnHover: true }
    expect(parseMiniWindowSettings(v203)).toEqual({ ...v203, peekDelayMs: 350, throwMomentum: true, grouping: 'tabs', headerPlacement: 'float', menuBarIcon: 'in-use' })
    expect(parseMiniWindowSettings({ grouping: 'stack' }).grouping).toBe('stack')
    expect(parseMiniWindowSettings({ grouping: 'separate' }).grouping).toBe('separate')
    expect(parseMiniWindowSettings({ grouping: 'piles' }).grouping).toBe('tabs')
  })

  test('the #203 slot files still read slot by slot (and the single-window format as slot 0)', () => {
    const rect = { x: 10, y: 40, width: 420, height: 620 }
    expect(parseMiniSlots({ slots: [{ a: rect }, {}, { b: rect }] }, parseMiniGeometry)).toEqual([{ a: rect }, {}, { b: rect }])
    expect(parseMiniSlots({ a: rect }, parseMiniGeometry)).toEqual([{ a: rect }])
  })

  test('the tab strip only shows in tabs mode with two or more tabs', () => {
    expect(miniHeaderHeight(1, 'tabs')).toBe(MINI_WINDOW_HEADER_HEIGHT)
    expect(miniHeaderHeight(2, 'tabs')).toBe(MINI_WINDOW_HEADER_HEIGHT + MINI_WINDOW_TAB_STRIP_HEIGHT)
    expect(miniHeaderHeight(3, 'stack')).toBe(MINI_WINDOW_HEADER_HEIGHT)
    expect(miniHeaderHeight(3, 'separate')).toBe(MINI_WINDOW_HEADER_HEIGHT)
  })

  test('a header dropped on another window\'s header band merges; on its page it does not', () => {
    const a = { id: 1, bounds: { x: 100, y: 100, width: 400, height: 600 } }
    const b = { id: 2, bounds: { x: 600, y: 100, width: 400, height: 600 } }
    expect(miniMergeTarget({ x: 300, y: 120 }, [a, b])).toBe(a)
    expect(miniMergeTarget({ x: 700, y: 143 }, [a, b])).toBe(b)
    expect(miniMergeTarget({ x: 300, y: 400 }, [a, b])).toBeNull()
    expect(miniMergeTarget({ x: 550, y: 120 }, [a, b])).toBeNull()
  })

  test('a tab dragged out: onto another window moves it, inside its own does nothing, elsewhere splits', () => {
    const own = { x: 0, y: 0, width: 400, height: 600 }
    const other = { id: 9, bounds: { x: 800, y: 0, width: 400, height: 600 } }
    expect(miniTabDrop({ x: 900, y: 300 }, own, 2, [other])).toEqual({ kind: 'merge', into: other })
    expect(miniTabDrop({ x: 200, y: 300 }, own, 2, [other])).toEqual({ kind: 'none' })
    expect(miniTabDrop({ x: 600, y: 300 }, own, 2, [other])).toEqual({ kind: 'split' })
    expect(miniTabDrop({ x: 600, y: 300 }, own, 1, [other])).toEqual({ kind: 'none' })
  })

  test('a split-off window opens under the pointer, inside the work area', () => {
    expect(miniSplitBounds({ x: 700, y: 300 }, { width: 400, height: 600 }, workArea)).toEqual({ x: 500, y: 282, width: 400, height: 600 })
    expect(miniSplitBounds({ x: 1430, y: 890 }, { width: 400, height: 600 }, workArea)).toEqual({ x: 1040, y: 300, width: 400, height: 600 })
  })

  test('switching to tabs merges windows docked to the same edge into the oldest; undocked ones stay', () => {
    const windows = [
      { id: 1, tabs: 1, dockKey: '7:right' },
      { id: 2, tabs: 1, dockKey: null },
      { id: 3, tabs: 1, dockKey: '7:right' },
      { id: 4, tabs: 1, dockKey: '7:left' },
      { id: 5, tabs: 1, dockKey: '7:right' }
    ]
    expect(planMiniRegroup('tabs', windows)).toEqual({ merge: [{ into: 1, from: [3, 5] }], split: [] })
  })

  test('switching away from tabs splits every window holding several tabs', () => {
    const windows = [{ id: 1, tabs: 3, dockKey: '7:right' }, { id: 2, tabs: 1, dockKey: null }, { id: 3, tabs: 2, dockKey: null }]
    expect(planMiniRegroup('stack', windows)).toEqual({ merge: [], split: [1, 3] })
    expect(planMiniRegroup('separate', windows)).toEqual({ merge: [], split: [1, 3] })
  })
})

describe('header placement', () => {
  const wa = { x: 0, y: 25, width: 1440, height: 875 }
  const win = { x: 600, y: 300, width: 420, height: 400 }

  test('settings without a header placement (the #206 format) read as float; bad values fall back', () => {
    const v206 = { defaultUrl: '', shortcut: DEFAULT_MINI_WINDOW_SHORTCUT, opacity: 1, tuckToEdge: true, peekOnHover: false, grouping: 'tabs' as const }
    // Saved before hover peek defaulted on (no peekDelayMs next to it): the stored false was just the old default.
    expect(parseMiniWindowSettings(v206)).toEqual({ ...v206, peekOnHover: true, peekDelayMs: 350, throwMomentum: true, headerPlacement: 'float', menuBarIcon: 'in-use' })
    expect(parseMiniWindowSettings({ headerPlacement: 'push' }).headerPlacement).toBe('push')
    expect(parseMiniWindowSettings({ headerPlacement: 'overlay' }).headerPlacement).toBe('overlay')
    expect(parseMiniWindowSettings({ headerPlacement: 'sideways' }).headerPlacement).toBe('float')
  })

  test('float sits above the window, touching its top edge, same x and width', () => {
    expect(planMiniHeader('float', win, 64, wa, null)).toEqual({ kind: 'above', panel: { x: 600, y: 236, width: 420, height: 64 } })
    // Exactly enough room still fits.
    expect(planMiniHeader('float', { ...win, y: wa.y + 36 }, 36, wa, null).kind).toBe('above')
  })

  test('no room above (top of the work area, or docked to the top edge) flips it below', () => {
    expect(planMiniHeader('float', { ...win, y: wa.y + 10 }, 36, wa, null)).toEqual({ kind: 'below', panel: { x: 600, y: 435, width: 420, height: 36 } })
    expect(planMiniHeader('float', win, 36, wa, 'top')).toEqual({ kind: 'below', panel: miniHeaderPanelRect(win, 36, 'below') })
    // Docked to a side or the bottom: above is fine.
    expect(planMiniHeader('float', win, 36, wa, 'right').kind).toBe('above')
    expect(planMiniHeader('float', win, 36, wa, 'bottom').kind).toBe('above')
  })

  test('no room either side falls back to push', () => {
    const tall = { x: 0, y: wa.y, width: 420, height: wa.height }
    expect(planMiniHeader('float', tall, 36, wa, null)).toEqual({ kind: 'push' })
    expect(planMiniHeader('float', { ...win, y: wa.y + 10, height: wa.height - 20 }, 36, wa, null)).toEqual({ kind: 'push' })
    // Docked to the top with the bottom out of room.
    expect(planMiniHeader('float', { ...win, y: wa.y, height: wa.height - 20 }, 36, wa, 'top')).toEqual({ kind: 'push' })
    // Docked to the bottom with no room above.
    expect(planMiniHeader('float', { ...win, y: wa.y + 20, height: wa.height - 20 }, 36, wa, 'bottom')).toEqual({ kind: 'push' })
  })

  test('a locked side (dragging by the header) never flips, even off the work area', () => {
    expect(planMiniHeader('float', { ...win, y: wa.y }, 36, wa, null, 'above')).toEqual({ kind: 'above', panel: { x: 600, y: wa.y - 36, width: 420, height: 36 } })
    expect(planMiniHeader('float', win, 36, wa, null, 'below').kind).toBe('below')
  })

  test('push and overlay ignore room', () => {
    expect(planMiniHeader('push', win, 36, wa, null)).toEqual({ kind: 'push' })
    expect(planMiniHeader('overlay', { ...win, y: wa.y }, 36, wa, 'top')).toEqual({ kind: 'overlay' })
  })

  test('the reveal zone is the top edge, or the bottom edge when the header floats below', () => {
    expect(inMiniRevealZone('above', 10, 400)).toBe(true)
    expect(inMiniRevealZone('above', 200, 400)).toBe(false)
    expect(inMiniRevealZone('push', 44, 400)).toBe(true)
    expect(inMiniRevealZone('overlay', 45, 400)).toBe(false)
    expect(inMiniRevealZone('below', 10, 400)).toBe(false)
    expect(inMiniRevealZone('below', 380, 400)).toBe(true)
    expect(inMiniRevealZone('above', -1, 400)).toBe(false)
    expect(inMiniRevealZone('below', 400, 400)).toBe(false)
  })

  test('push moves the page under the revealed header; everything else gives it the whole window', () => {
    const size = { width: 420, height: 400 }
    expect(miniPageBounds('push', true, size, 64)).toEqual({ x: 0, y: 64, width: 420, height: 336 })
    expect(miniPageBounds('push', false, size, 64)).toEqual({ x: 0, y: 0, width: 420, height: 400 })
    expect(miniPageBounds('overlay', true, size, 64)).toEqual({ x: 0, y: 0, width: 420, height: 400 })
    expect(miniPageBounds('above', true, size, 64)).toEqual({ x: 0, y: 0, width: 420, height: 400 })
    // Never a zero-height page.
    expect(miniPageBounds('push', true, { width: 300, height: 30 }, 64).height).toBe(1)
  })

  test('union and the merge band over a floating header', () => {
    expect(unionMiniRect({ x: 600, y: 236, width: 420, height: 64 }, win)).toEqual({ x: 600, y: 236, width: 420, height: 464 })
    const others = [{ id: 'a', bounds: win }]
    expect(miniMergeTarget({ x: 700, y: 280 }, others)).toBeNull()
    expect(miniMergeTarget({ x: 700, y: 280 }, others, MINI_WINDOW_HEADER_HEIGHT)?.id).toBe('a')
    expect(miniMergeTarget({ x: 700, y: 250 }, others, MINI_WINDOW_HEADER_HEIGHT)).toBeNull()
    expect(miniMergeTarget({ x: 700, y: 320 }, others, MINI_WINDOW_HEADER_HEIGHT)?.id).toBe('a')
  })
})

describe('hover peek settings', () => {
  test('missing values migrate to the default (on, 350 ms)', () => {
    expect(parseMiniWindowSettings({ tuckToEdge: true, peekOnHover: false })).toMatchObject({ peekOnHover: true, peekDelayMs: 350 })
    expect(parseMiniWindowSettings({})).toMatchObject({ peekOnHover: true, peekDelayMs: 350 })
  })
  test('a stored choice saved with the delay is kept', () => {
    expect(parseMiniWindowSettings({ peekOnHover: false, peekDelayMs: 350 })).toMatchObject({ peekOnHover: false, peekDelayMs: 350 })
    expect(parseMiniWindowSettings({ peekOnHover: true, peekDelayMs: 1000 })).toMatchObject({ peekOnHover: true, peekDelayMs: 1000 })
  })
  test('only the offered delays are accepted', () => {
    expect(MINI_WINDOW_PEEK_DELAYS).toEqual([200, 350, 600, 1000])
    for (const bad of [0, 10, 351, -200, '600', null, Number.NaN]) expect(parseMiniWindowSettings({ peekDelayMs: bad }).peekDelayMs).toBe(350)
    expect(isMiniWindowPeekDelay(200)).toBe(true)
    expect(isMiniWindowPeekDelay(250)).toBe(false)
  })
})

describe('throw with momentum setting', () => {
  test('missing or unreadable values migrate to the default (on)', () => {
    expect(parseMiniWindowSettings({}).throwMomentum).toBe(true)
    expect(parseMiniWindowSettings({ tuckToEdge: true, peekOnHover: false, peekDelayMs: 350, grouping: 'stack' }).throwMomentum).toBe(true)
    expect(parseMiniWindowSettings({ throwMomentum: 'no' }).throwMomentum).toBe(true)
  })
  test('a stored choice is kept', () => {
    expect(parseMiniWindowSettings({ throwMomentum: false }).throwMomentum).toBe(false)
    expect(parseMiniWindowSettings({ throwMomentum: true }).throwMomentum).toBe(true)
  })
})
