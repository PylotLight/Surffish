import { describe, expect, test } from 'bun:test'
import { parseMiniWindowSettings } from './mini-window'
import {
  MINI_MENU_BAR_BLUR_CLICK_MS,
  MINI_MENU_BAR_DROP_MS,
  MINI_MENU_BAR_DROP_PX,
  MINI_MENU_BAR_GAP,
  MINI_MENU_BAR_MARGIN,
  createMenuBarPopout,
  menuBarDropFrame,
  menuBarPopoutBounds,
  menuBarTrayTitle,
  menuBarTrayTooltip,
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
    popout.close()
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
    expect(popout.blur(true)).toBe(false)
    expect(popout.shown()).toBe(true)
    expect(popout.blur(false)).toBe(true)
    expect(log.at(-1)).toBe('hide')
    // Pressing the icon blurred it: that click closes it for good.
    clock.advance(80)
    expect(popout.click()).toBe('none')
    // The next click opens it again.
    expect(popout.click()).toBe('show')
    popout.open(target, 'below', true)
    popout.blur(false)
    // A click on the icon well after a blur shows it.
    clock.advance(MINI_MENU_BAR_BLUR_CLICK_MS + 10)
    expect(popout.click()).toBe('show')
  })

  test('a blur while hidden does nothing', () => {
    const { popout, log } = rig()
    expect(popout.blur(false)).toBe(false)
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
