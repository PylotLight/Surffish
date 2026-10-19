import { describe, expect, test } from 'bun:test'
import { MINI_WINDOW_POPOUT_STRIP_HEIGHT, parseMiniWindowSettings } from './mini-window'
import {
  MINI_MENU_BAR_BLUR_CLICK_MS,
  MINI_MENU_BAR_CLOSE_MS,
  MINI_MENU_BAR_SPACE_BLUR_MS,
  MINI_MENU_BAR_SPACE_SETTLE_MS,
  MINI_MENU_BAR_DEFAULT_SIZE,
  MINI_MENU_BAR_DROP_MS,
  MINI_MENU_BAR_DROP_PX,
  MINI_MENU_BAR_GAP,
  MINI_MENU_BAR_MARGIN,
  MINI_MENU_BAR_OPEN_BLUR_GRACE_MS,
  createMenuBarPopout,
  menuBarCloseFrame,
  menuBarDropFrame,
  menuBarPopoutFrame,
  spaceChangeExplainsBlur,
  menuBarPageSize,
  menuBarPopoutBounds,
  menuBarTrayTitle,
  menuBarTrayTooltip,
  menuBarWindowSize,
  parseMenuBarSaved,
  pickMenuBarMini,
  pickRestoredMenuBarTabs,
  wantsMenuBarTray
} from './mini-window-menubar'
import { createFrameLoop } from './mini-window-motion'

/** Fake time: timeouts fire as the clock advances. */
function fakeClock() {
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
}

// A 1512×982 MacBook with a notch: the menu bar is 37 px tall.
const MAC = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 } }
const SIZE = { width: 400, height: 560 }

describe('menu bar icon setting', () => {
  test('defaults to "when in use"; old files migrate; bad values fall back', () => {
    expect(parseMiniWindowSettings(null).menuBarIcon).toBe('in-use')
    // v0.1.16 settings (no menu bar yet).
    expect(parseMiniWindowSettings({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, grouping: 'tabs', headerPlacement: 'float' }).menuBarIcon).toBe('in-use')
    expect(parseMiniWindowSettings({ menuBarIcon: 'always' }).menuBarIcon).toBe('always')
    expect(parseMiniWindowSettings({ menuBarIcon: 'never' }).menuBarIcon).toBe('never')
    expect(parseMiniWindowSettings({ menuBarIcon: 'sometimes' }).menuBarIcon).toBe('in-use')
  })

  test('the Tray exists only when wanted (none at all while nothing is in the menu bar with "when in use")', () => {
    expect(wantsMenuBarTray('in-use', 0)).toBe(false)
    expect(wantsMenuBarTray('in-use', 1)).toBe(true)
    expect(wantsMenuBarTray('always', 0)).toBe(true)
    expect(wantsMenuBarTray('never', 3)).toBe(false)
  })

  test('title: a count when several live there, a note while one plays', () => {
    expect(menuBarTrayTitle(1, false)).toBe('')
    expect(menuBarTrayTitle(0, false)).toBe('')
    expect(menuBarTrayTitle(2, false)).toBe('2')
    expect(menuBarTrayTitle(1, true)).toBe('♪')
    expect(menuBarTrayTitle(3, true)).toBe('3 ♪')
  })

  test('tooltip lists a few titles', () => {
    expect(menuBarTrayTooltip([], false)).toBe('Surffish mini window')
    expect(menuBarTrayTooltip(['Claude'], true)).toBe('Claude (playing)')
    expect(menuBarTrayTooltip(['a', 'b', 'c', 'd', 'e'], false)).toBe('a, b, c +2 more')
    expect(menuBarTrayTooltip(['x'.repeat(80)], false).length).toBe(60)
  })
})

describe('popout placement', () => {
  test('centred under the icon, just below a notched menu bar', () => {
    const { bounds, side } = menuBarPopoutBounds({ x: 1100, y: 0, width: 24, height: 37 }, { x: 0, y: 0 }, SIZE, MAC)
    expect(side).toBe('below')
    expect(bounds).toEqual({ x: 1112 - 200, y: 37 + MINI_MENU_BAR_GAP, width: 400, height: 560 })
  })

  test('the work area top wins when the icon reports a shorter bar', () => {
    const { bounds } = menuBarPopoutBounds({ x: 700, y: 0, width: 22, height: 24 }, { x: 0, y: 0 }, SIZE, MAC)
    expect(bounds.y).toBe(37 + MINI_MENU_BAR_GAP)
  })

  test('clamped to the work area near the right edge (and the left)', () => {
    const right = menuBarPopoutBounds({ x: 1490, y: 0, width: 22, height: 37 }, { x: 0, y: 0 }, SIZE, MAC).bounds
    expect(right.x + right.width).toBe(1512 - MINI_MENU_BAR_MARGIN)
    const left = menuBarPopoutBounds({ x: 2, y: 0, width: 22, height: 37 }, { x: 0, y: 0 }, SIZE, MAC).bounds
    expect(left.x).toBe(MINI_MENU_BAR_MARGIN)
  })

  test('a second display to the left with a negative origin', () => {
    const display = { bounds: { x: -1920, y: -200, width: 1920, height: 1080 }, workArea: { x: -1920, y: -175, width: 1920, height: 1055 } }
    const { bounds, side } = menuBarPopoutBounds({ x: -300, y: -200, width: 22, height: 25 }, { x: 0, y: 0 }, SIZE, display)
    expect(side).toBe('below')
    expect(bounds).toEqual({ x: -289 - 200, y: -175 + MINI_MENU_BAR_GAP, width: 400, height: 560 })
  })

  test('a taskbar at the bottom (Windows): above the icon', () => {
    const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
    const { bounds, side } = menuBarPopoutBounds({ x: 1700, y: 1044, width: 24, height: 32 }, { x: 0, y: 0 }, SIZE, display)
    expect(side).toBe('above')
    expect(bounds).toEqual({ x: 1512, y: 1040 - 560 - MINI_MENU_BAR_GAP, width: 400, height: 560 })
  })

  test('no tray bounds (Linux): anchored at the pointer', () => {
    const display = { bounds: { x: 0, y: 0, width: 1600, height: 1000 }, workArea: { x: 0, y: 28, width: 1600, height: 972 } }
    const { bounds, side } = menuBarPopoutBounds({ x: 0, y: 0, width: 0, height: 0 }, { x: 900, y: 10 }, SIZE, display)
    expect(side).toBe('below')
    expect(bounds.x).toBe(900 - 200)
    expect(bounds.y).toBe(28 + MINI_MENU_BAR_GAP)
    expect(menuBarPopoutBounds(null, { x: 900, y: 990 }, SIZE, display).side).toBe('above')
  })

  test('too big for a small display: fitted, never below the minimum', () => {
    const small = { bounds: { x: 0, y: 0, width: 800, height: 500 }, workArea: { x: 0, y: 25, width: 800, height: 475 } }
    const { bounds } = menuBarPopoutBounds({ x: 400, y: 0, width: 20, height: 25 }, { x: 0, y: 0 }, { width: 2000, height: 2000 }, small)
    expect(bounds.width).toBe(800 - 2 * MINI_MENU_BAR_MARGIN)
    expect(bounds.height).toBe(475 - 2 * MINI_MENU_BAR_GAP)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(500)
    expect(menuBarPopoutBounds({ x: 400, y: 0, width: 20, height: 25 }, { x: 0, y: 0 }, { width: 10, height: 10 }, MAC).bounds).toMatchObject({ width: 280, height: 200 })
  })
})

describe('popout strip sizing', () => {
  test('the strip adds to the window: the page keeps the remembered size', () => {
    expect(menuBarWindowSize(MINI_MENU_BAR_DEFAULT_SIZE)).toEqual({ width: 400, height: 560 + MINI_WINDOW_POPOUT_STRIP_HEIGHT })
    expect(menuBarWindowSize({ width: 380, height: 420 })).toEqual({ width: 380, height: 448 })
  })

  test('a resized popout is remembered as its page size (round trip)', () => {
    expect(menuBarPageSize({ width: 380, height: 448 })).toEqual({ width: 380, height: 420 })
    expect(menuBarPageSize(menuBarWindowSize({ width: 512, height: 700 }))).toEqual({ width: 512, height: 700 })
    expect(menuBarPageSize({ width: 300, height: 10 }).height).toBe(1)
  })
})

describe('drop-in', () => {
  const target = { x: 100, y: 41, width: 400, height: 560 }
  test('starts above (below for a bottom taskbar), transparent; ends in place at full opacity', () => {
    expect(menuBarDropFrame(target, 'below', 0, 1)).toEqual({ rect: { ...target, y: 41 - MINI_MENU_BAR_DROP_PX }, opacity: 0 })
    expect(menuBarDropFrame(target, 'above', 0, 1).rect.y).toBe(41 + MINI_MENU_BAR_DROP_PX)
    expect(menuBarDropFrame(target, 'below', 1, 0.8)).toEqual({ rect: target, opacity: 0.8 })
    const mid = menuBarDropFrame(target, 'below', 0.5, 1)
    expect(mid.rect.y).toBeGreaterThan(41 - MINI_MENU_BAR_DROP_PX)
    expect(mid.rect.y).toBeLessThanOrEqual(41)
    expect(mid.opacity).toBeGreaterThan(0.5)
  })
})

describe('popout frames', () => {
  const target = { x: 100, y: 41, width: 400, height: 560 }
  test('one frame function for both ways: whole-px offset toward the icon, fade scaled', () => {
    expect(menuBarPopoutFrame(target, 'below', 0, 1)).toEqual({ rect: { ...target, y: 41 - MINI_MENU_BAR_DROP_PX }, opacity: 0 })
    expect(menuBarPopoutFrame(target, 'above', 1, 0.9)).toEqual({ rect: target, opacity: 0.9 })
    expect(menuBarPopoutFrame(target, 'below', 2, 1).rect).toEqual(target)
    expect(menuBarPopoutFrame(target, 'below', Number.NaN, 1).opacity).toBe(0)
    for (let v = 0; v <= 1; v += 0.05) expect(Number.isInteger(menuBarPopoutFrame(target, 'below', v, 1).rect.y)).toBe(true)
  })
  test('drop-in eases out (most of the slide early), close eases in toward the icon', () => {
    // A fifth of the way in time, the slide is mostly done and it is mostly opaque.
    const early = menuBarDropFrame(target, 'below', 0.2, 1)
    expect(early.opacity).toBeGreaterThan(0.6)
    expect(target.y - early.rect.y).toBeLessThanOrEqual(3)
    // Going away: barely moved at first, gone at the end, back toward the icon (up for 'below').
    expect(menuBarCloseFrame(target, 'below', 0, 1)).toEqual({ rect: target, opacity: 1 })
    expect(menuBarCloseFrame(target, 'below', 0.2, 1).opacity).toBeGreaterThan(0.95)
    expect(menuBarCloseFrame(target, 'below', 1, 1)).toEqual({ rect: { ...target, y: 41 - MINI_MENU_BAR_DROP_PX }, opacity: 0 })
    expect(menuBarCloseFrame(target, 'above', 1, 1).rect.y).toBe(41 + MINI_MENU_BAR_DROP_PX)
    // From half way in (an interrupted drop-in): starts there.
    expect(menuBarCloseFrame(target, 'below', 0, 1, 0.5).opacity).toBe(0.5)
  })
  test('durations stay snappy', () => {
    expect(MINI_MENU_BAR_DROP_MS).toBeGreaterThanOrEqual(180)
    expect(MINI_MENU_BAR_DROP_MS).toBeLessThanOrEqual(240)
    expect(MINI_MENU_BAR_CLOSE_MS).toBeGreaterThanOrEqual(140)
    expect(MINI_MENU_BAR_CLOSE_MS).toBeLessThanOrEqual(180)
  })
})

describe('Space change vs click-away', () => {
  test('a Space change explains a blur within the window either side, never one from the future', () => {
    expect(spaceChangeExplainsBlur(null, 1000, 1000)).toBe(false)
    expect(spaceChangeExplainsBlur(Number.NaN, 1000, 1000)).toBe(false)
    expect(spaceChangeExplainsBlur(1000 - MINI_MENU_BAR_SPACE_BLUR_MS, 1000, 1000)).toBe(true)
    expect(spaceChangeExplainsBlur(1000 - MINI_MENU_BAR_SPACE_BLUR_MS - 1, 1000, 1000)).toBe(false)
    // Notified after the blur (the swipe animation): counts once it has happened.
    expect(spaceChangeExplainsBlur(1300, 1000, 1400)).toBe(true)
    expect(spaceChangeExplainsBlur(1300, 1000, 1200)).toBe(false)
    expect(spaceChangeExplainsBlur(1000 + MINI_MENU_BAR_SPACE_BLUR_MS + 1, 1000, 5000)).toBe(false)
    // A held blur waits less than the window, so a change any time while held explains it.
    expect(MINI_MENU_BAR_SPACE_SETTLE_MS).toBeLessThanOrEqual(MINI_MENU_BAR_SPACE_BLUR_MS)
  })
})

describe('which mini a click shows', () => {
  test('the last shown while it is still there, else the newest', () => {
    expect(pickMenuBarMini([1, 2, 3], 2)).toBe(2)
    expect(pickMenuBarMini([1, 3], 2)).toBe(3)
    expect(pickMenuBarMini([], null)).toBe(null)
  })
})

function rig(options: { reduced?: boolean; opacity?: boolean } = {}) {
  const clock = fakeClock()
  const loop = createFrameLoop({ now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, interval: () => 1000 / 60 })
  const log: string[] = []
  const places: Array<{ x: number; y: number; width: number; height: number }> = []
  const opacities: number[] = []
  const popout = createMenuBarPopout({
    now: clock.now,
    loop,
    place: (rect) => { places.push(rect); log.push(`place ${rect.y}`) },
    setOpacity: options.opacity === false ? null : (value) => { opacities.push(value) },
    opacity: () => 1,
    show: (focus) => log.push(`show ${focus}`),
    hide: () => log.push('hide'),
    reducedMotion: () => options.reduced ?? false
  })
  return { clock, loop, log, places, opacities, popout }
}

describe('popout (fake timers)', () => {
  const target = { x: 100, y: 41, width: 400, height: 560 }

  test('drops in on the frame loop, then the loop goes idle', () => {
    const { clock, loop, places, opacities, popout, log } = rig()
    popout.open(target, 'below', true)
    expect(log.slice(0, 2)).toEqual([`place ${41 - MINI_MENU_BAR_DROP_PX}`, 'show true'])
    expect(popout.shown()).toBe(true)
    expect(popout.animating()).toBe(true)
    clock.advance(MINI_MENU_BAR_DROP_MS + 40)
    expect(popout.animating()).toBe(false)
    expect(places.at(-1)).toEqual(target)
    expect(opacities.at(-1)).toBe(1)
    // Every frame moves toward the target, never past it.
    for (let i = 1; i < places.length; i++) expect(places[i]!.y).toBeGreaterThanOrEqual(places[i - 1]!.y)
    // ~140 ms at 60 Hz: a handful of frames, not hundreds.
    expect(places.length).toBeGreaterThan(4)
    expect(places.length).toBeLessThan(15)
    expect(loop.running()).toBe(false)
    expect(clock.pending()).toBe(0)
  })

  test('reduced motion: straight into place; no opacity on Linux still drops', () => {
    const reduced = rig({ reduced: true })
    reduced.popout.open(target, 'below', false)
    expect(reduced.places).toEqual([target])
    expect(reduced.log).toEqual(['place 41', 'show false'])
    expect(reduced.loop.running()).toBe(false)
    const linux = rig({ opacity: false })
    linux.popout.open(target, 'below', true)
    linux.clock.advance(400)
    expect(linux.places.at(-1)).toEqual(target)
  })

  test('click toggles; hiding mid-drop stops the animation', () => {
    const { clock, popout, log, loop } = rig()
    expect(popout.click()).toBe('show')
    popout.open(target, 'below', true)
    clock.advance(30)
    expect(popout.click()).toBe('hide')
    popout.close(false)
    expect(log.at(-1)).toBe('hide')
    expect(popout.animating()).toBe(false)
    clock.advance(500)
    expect(loop.running()).toBe(false)
    expect(popout.click()).toBe('show')
  })

  test('a click elsewhere hides it unless pinned; the icon click that blurred it does not reopen it', () => {
    const { clock, popout, log } = rig()
    popout.open(target, 'below', true)
    clock.advance(300)
    expect(popout.blur(true)).toBe('ignored')
    expect(popout.shown()).toBe(true)
    expect(popout.blur(false)).toBe('hide')
    expect(popout.shown()).toBe(false)
    expect(popout.closing()).toBe(true)
    clock.advance(MINI_MENU_BAR_CLOSE_MS + 40)
    expect(log).toContain('hide')
    // Pressing the icon blurred it: that click closes it for good.
    clock.advance(80)
    expect(popout.click()).toBe('none')
    // The next click opens it again.
    expect(popout.click()).toBe('show')
    popout.open(target, 'below', true)
    clock.advance(MINI_MENU_BAR_OPEN_BLUR_GRACE_MS)
    expect(popout.blur(false)).toBe('hide')
    // A click on the icon well after a blur (counted from when the fade-out ended) shows it.
    clock.advance(MINI_MENU_BAR_CLOSE_MS + MINI_MENU_BAR_BLUR_CLICK_MS + 40)
    expect(popout.click()).toBe('show')
  })

  test('a blur right as it opens is held: focus back keeps it open, else it hides when the grace is up', () => {
    const { clock, popout, log } = rig()
    // macOS took the key window away for a moment while it came up (a Space change, Surffish activating).
    popout.open(target, 'below', true)
    clock.advance(20)
    expect(popout.blur(false)).toBe('hold-open')
    expect(popout.shown()).toBe(true)
    expect(popout.blurPendingMs()).toBe(MINI_MENU_BAR_OPEN_BLUR_GRACE_MS - 20)
    popout.focused()
    expect(popout.blurPendingMs()).toBe(0)
    clock.advance(MINI_MENU_BAR_OPEN_BLUR_GRACE_MS)
    expect(popout.settle(false)).toBe('none')
    expect(popout.shown()).toBe(true)
    popout.close()
    // Never got the focus back: hides when the grace is up, and that counts as a blur for the icon click.
    log.length = 0
    clock.advance(1000)
    popout.open(target, 'below', true)
    clock.advance(10)
    expect(popout.blur(false)).toBe('hold-open')
    clock.advance(popout.blurPendingMs())
    expect(popout.settle(false)).toBe('hide')
    expect(popout.shown()).toBe(false)
    clock.advance(MINI_MENU_BAR_CLOSE_MS + 40)
    expect(log).toContain('hide')
    expect(popout.click()).toBe('none')
    expect(popout.click()).toBe('show')
    // Pinned meanwhile, or already closed: settling does nothing.
    popout.open(target, 'below', true)
    expect(popout.blur(false)).toBe('hold-open')
    expect(popout.settle(true)).toBe('none')
    expect(popout.shown()).toBe(true)
    expect(popout.blurPendingMs()).toBe(0)
    expect(popout.blur(false)).toBe('hold-open')
    popout.close()
    expect(popout.blurPendingMs()).toBe(0)
    expect(popout.settle(false)).toBe('none')
    // Re-anchored without focus while up (open again, unfocused) does not restart the grace.
    clock.advance(1000)
    popout.open(target, 'below', true)
    clock.advance(MINI_MENU_BAR_OPEN_BLUR_GRACE_MS + 5)
    popout.open({ ...target, x: 300 }, 'below', false)
    expect(popout.blur(false)).toBe('hide')
  })

  test('macOS: a blur next to a Space change keeps it shown (swiping desktops never hides it)', () => {
    const { clock, popout, log } = rig()
    popout.open(target, 'below', true)
    clock.advance(1000)
    log.length = 0
    // The change was notified just before the blur reached us.
    expect(popout.blur(false, { mouseDown: false, spaceChangedAt: clock.now() - 40 })).toBe('space')
    expect(popout.shown()).toBe(true)
    expect(popout.blurPendingMs()).toBe(0)
    expect(log).toEqual([])
    // Even with a button down (a swipe started mid-click), the Space change wins.
    expect(popout.blur(false, { mouseDown: true, spaceChangedAt: clock.now() - 10 })).toBe('space')
    expect(popout.shown()).toBe(true)
  })

  test('macOS: a blur with no click behind it waits for the Space change; one arriving keeps it', () => {
    const { clock, popout, log } = rig()
    popout.open(target, 'below', true)
    clock.advance(1000)
    log.length = 0
    expect(popout.blur(false, { mouseDown: false, spaceChangedAt: null })).toBe('hold-space')
    expect(popout.blurPendingMs()).toBe(MINI_MENU_BAR_SPACE_SETTLE_MS)
    clock.advance(200)
    expect(popout.settle(false, null)).toBe('pending')
    // The Space change notification lands mid-hold.
    const changedAt = clock.now() + 100
    clock.advance(popout.blurPendingMs())
    expect(popout.settle(false, changedAt)).toBe('space')
    expect(popout.shown()).toBe(true)
    expect(log).toEqual([])
    expect(popout.blurPendingMs()).toBe(0)
  })

  test('macOS: no Space change while held (⌘Tab): it hides once the hold is up', () => {
    const { clock, popout, log } = rig()
    popout.open(target, 'below', true)
    clock.advance(1000)
    expect(popout.blur(false, { mouseDown: false, spaceChangedAt: clock.now() - 5000 })).toBe('hold-space')
    clock.advance(MINI_MENU_BAR_SPACE_SETTLE_MS)
    expect(popout.settle(false, clock.now() - 5600)).toBe('hide')
    expect(popout.shown()).toBe(false)
    clock.advance(MINI_MENU_BAR_CLOSE_MS + 40)
    expect(log).toContain('hide')
    // Focus coming back while held keeps it.
    clock.advance(1000)
    popout.open(target, 'below', true)
    clock.advance(1000)
    expect(popout.blur(false, { mouseDown: false, spaceChangedAt: null })).toBe('hold-space')
    popout.focused()
    clock.advance(MINI_MENU_BAR_SPACE_SETTLE_MS)
    expect(popout.settle(false, null)).toBe('none')
    expect(popout.shown()).toBe(true)
    // Pinned while held: settling does nothing.
    expect(popout.blur(false, { mouseDown: false, spaceChangedAt: null })).toBe('hold-space')
    clock.advance(MINI_MENU_BAR_SPACE_SETTLE_MS)
    expect(popout.settle(true, null)).toBe('none')
    expect(popout.shown()).toBe(true)
  })

  test('macOS: a blur with a mouse button down is a click elsewhere: hides at once; pinned never', () => {
    const { clock, popout } = rig()
    popout.open(target, 'below', true)
    clock.advance(1000)
    expect(popout.blur(true, { mouseDown: true, spaceChangedAt: null })).toBe('ignored')
    expect(popout.blur(false, { mouseDown: true, spaceChangedAt: clock.now() - 5000 })).toBe('hide')
    expect(popout.shown()).toBe(false)
  })

  test('macOS: right as it opens, a blur is still held only for the open grace (then settled as before)', () => {
    const { clock, popout } = rig()
    popout.open(target, 'below', true)
    clock.advance(20)
    expect(popout.blur(false, { mouseDown: false, spaceChangedAt: null })).toBe('hold-open')
    expect(popout.blurPendingMs()).toBe(MINI_MENU_BAR_OPEN_BLUR_GRACE_MS - 20)
    clock.advance(popout.blurPendingMs())
    expect(popout.settle(false, null)).toBe('hide')
  })

  test('close fades + slides toward the icon on the loop, then hides; reopening mid-close turns back from there', () => {
    const { clock, loop, popout, log, places, opacities } = rig()
    popout.open(target, 'below', true)
    clock.advance(MINI_MENU_BAR_DROP_MS + 40)
    places.length = 0
    opacities.length = 0
    log.length = 0
    popout.close()
    expect(popout.shown()).toBe(false)
    expect(popout.closing()).toBe(true)
    expect(popout.animating()).toBe(true)
    expect(log).not.toContain('hide')
    clock.advance(MINI_MENU_BAR_CLOSE_MS + 40)
    expect(log).toContain('hide')
    expect(popout.closing()).toBe(false)
    // Faded all the way, never brighter on the way out; ends back at the target for next time.
    for (let i = 1; i < opacities.length; i++) expect(opacities[i]!).toBeLessThanOrEqual(opacities[i - 1]!)
    expect(opacities.at(-1)).toBe(0)
    expect(places.at(-1)).toEqual(target)
    // Few window moves: the slide is whole px, so frames repeat the rect (skipped by the frame loop).
    expect(new Set(places.map((rect) => rect.y)).size).toBeLessThanOrEqual(MINI_MENU_BAR_DROP_PX + 1)
    expect(loop.running()).toBe(false)
    // Mid-close, a click shows it again: no jump back to transparent, it turns back from where it was.
    popout.open(target, 'below', true)
    clock.advance(MINI_MENU_BAR_DROP_MS + 40)
    popout.close()
    clock.advance(MINI_MENU_BAR_CLOSE_MS * 0.6)
    const before = opacities.at(-1)!
    expect(before).toBeGreaterThan(0)
    log.length = 0
    popout.open(target, 'below', true)
    expect(popout.shown()).toBe(true)
    expect(opacities.at(-1)).toBeCloseTo(before, 1)
    clock.advance(MINI_MENU_BAR_DROP_MS + 40)
    expect(opacities.at(-1)).toBe(1)
    expect(places.at(-1)).toEqual(target)
    expect(log).not.toContain('hide')
  })

  test('close(false) mid fade-out hides at once; reduced motion and no-opacity platforms hide at once', () => {
    const fading = rig()
    fading.popout.open(target, 'below', true)
    fading.clock.advance(400)
    fading.popout.close()
    fading.popout.close(false)
    expect(fading.log.at(-1)).toBe('hide')
    expect(fading.popout.closing()).toBe(false)
    fading.clock.advance(400)
    expect(fading.log.filter((entry) => entry === 'hide')).toHaveLength(1)
    const reduced = rig({ reduced: true })
    reduced.popout.open(target, 'below', true)
    reduced.popout.close()
    expect(reduced.log.at(-1)).toBe('hide')
    const linux = rig({ opacity: false })
    linux.popout.open(target, 'below', true)
    linux.clock.advance(400)
    linux.popout.close()
    expect(linux.log.at(-1)).toBe('hide')
  })

  test('an Esc / icon close after an old blur does not swallow the next icon click', () => {
    const { clock, popout } = rig()
    popout.open(target, 'below', true)
    clock.advance(1000)
    expect(popout.blur(false)).toBe('hide')
    clock.advance(2000)
    expect(popout.click()).toBe('show')
    popout.open(target, 'below', true)
    clock.advance(1000)
    popout.close()
    clock.advance(MINI_MENU_BAR_CLOSE_MS + 40)
    expect(popout.click()).toBe('show')
  })

  test('a blur while hidden does nothing', () => {
    const { popout, log } = rig()
    expect(popout.blur(false)).toBe('ignored')
    expect(log).toEqual([])
  })

  test('open while shown re-anchors without a second drop-in', () => {
    const { clock, popout, log } = rig()
    popout.open(target, 'below', true)
    clock.advance(300)
    log.length = 0
    popout.open({ ...target, x: 300 }, 'below', false)
    expect(log).toEqual(['place 41'])
    expect(popout.animating()).toBe(false)
  })
})

describe('remembered across restarts', () => {
  test('size and urls; junk dropped; private never saved (the caller never passes them)', () => {
    expect(parseMenuBarSaved(null)).toEqual({ size: null, urls: [] })
    expect(parseMenuBarSaved({ size: { width: 420.4, height: 600 }, urls: ['https://claude.ai/', 'file:///etc/passwd', 42, 'about:blank', 'http://x.test/a'] })).toEqual({ size: { width: 420, height: 600 }, urls: ['https://claude.ai/', 'http://x.test/a'] })
    expect(parseMenuBarSaved({ size: { width: 10, height: 600 } }).size).toBe(null)
    expect(parseMenuBarSaved({ urls: Array.from({ length: 10 }, (_, i) => `https://e${i}.test/`) }).urls.length).toBe(6)
  })

  test('restored tabs are picked from the end, each once', () => {
    const candidates = [
      { tabId: 'a', url: 'https://claude.ai/' },
      { tabId: 'b', url: 'https://news.test/' },
      { tabId: 'c', url: 'https://claude.ai/' },
      { tabId: 'd', url: 'https://music.test/' }
    ]
    expect(pickRestoredMenuBarTabs(['https://claude.ai/', 'https://music.test/'], candidates)).toEqual(['c', 'd'])
    expect(pickRestoredMenuBarTabs(['https://claude.ai/', 'https://claude.ai/', 'https://claude.ai/'], candidates)).toEqual(['c', 'a'])
    expect(pickRestoredMenuBarTabs(['https://gone.test/'], candidates)).toEqual([])
  })
})
