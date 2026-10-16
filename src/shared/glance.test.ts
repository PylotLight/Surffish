import { describe, expect, test } from 'bun:test'
import {
  GLANCE_HEADER_HEIGHT,
  glanceKeyAction,
  glanceLayout,
  glanceTitle,
  glanceUrlFromText,
  glanceWindowOpenAction,
  glanceZoomAction,
  isGlanceableUrl,
  isShiftClickLinkOpen,
  parseGlanceSettings,
  type GlanceKeyInput
} from './glance'

const key = (overrides: Partial<GlanceKeyInput>): GlanceKeyInput => ({ type: 'keyDown', key: 'a', shift: false, alt: false, control: false, meta: false, ...overrides })

describe('glance settings', () => {
  test('Shift-click → Glance defaults on, so it works without visiting Settings', () => {
    expect(parseGlanceSettings(null)).toEqual({ shiftClick: true })
    expect(parseGlanceSettings({})).toEqual({ shiftClick: true })
    expect(parseGlanceSettings({ shiftClick: 'no' })).toEqual({ shiftClick: true })
    expect(parseGlanceSettings('junk')).toEqual({ shiftClick: true })
  })
  test('only an explicit false turns it off', () => {
    expect(parseGlanceSettings({ shiftClick: false })).toEqual({ shiftClick: false })
    expect(parseGlanceSettings(false)).toEqual({ shiftClick: false })
    expect(parseGlanceSettings({ shiftClick: true })).toEqual({ shiftClick: true })
  })
})

describe('isShiftClickLinkOpen', () => {
  test('a Shift+clicked link is new-window without features', () => {
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: '' })).toBe(true)
    expect(isShiftClickLinkOpen({ disposition: 'new-window' })).toBe(true)
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: 'noopener' })).toBe(true)
  })
  test('script popups with size features stay popups', () => {
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: 'width=500,height=600' })).toBe(false)
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: 'popup' })).toBe(false)
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: 'noopener, popup=1' })).toBe(false)
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: 'left=10,top=10' })).toBe(false)
  })
  test('tabs, background tabs and form posts are not glances', () => {
    expect(isShiftClickLinkOpen({ disposition: 'foreground-tab', features: '' })).toBe(false)
    expect(isShiftClickLinkOpen({ disposition: 'background-tab', features: '' })).toBe(false)
    expect(isShiftClickLinkOpen({ disposition: 'default', features: '' })).toBe(false)
    expect(isShiftClickLinkOpen({ disposition: 'new-window', features: '', postBody: { data: [] } })).toBe(false)
  })
})

describe('urls', () => {
  test('only http(s) is glanceable', () => {
    expect(isGlanceableUrl('https://example.com/a')).toBe(true)
    expect(isGlanceableUrl('http://127.0.0.1:8080/')).toBe(true)
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'blob:https://x/1', 'chrome://gpu', 'not a url']) expect(isGlanceableUrl(url)).toBe(false)
  })
  test('copied link: one http(s) URL only', () => {
    expect(glanceUrlFromText('  https://example.com/a?b=1  ')).toBe('https://example.com/a?b=1')
    expect(glanceUrlFromText('https://example.com/a and more')).toBeNull()
    expect(glanceUrlFromText('example.com')).toBeNull()
    expect(glanceUrlFromText('')).toBeNull()
    expect(glanceUrlFromText(null)).toBeNull()
  })
  test('title falls back to the host', () => {
    expect(glanceTitle('  Story  ', 'https://example.com/a')).toBe('Story')
    expect(glanceTitle('', 'https://example.com/a')).toBe('example.com')
    expect(glanceTitle('https://example.com/a', 'https://example.com/a')).toBe('example.com')
    expect(glanceTitle('', 'nope')).toBe('nope')
  })
})

describe('glanceLayout', () => {
  test('the card is ~85% of the window, centred, with the page under the header', () => {
    const layout = glanceLayout(1200, 800)
    expect(layout.backdrop).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(layout.card).toEqual({ x: 90, y: 60, width: 1020, height: 680 })
    expect(layout.page).toEqual({ x: 90, y: 60 + GLANCE_HEADER_HEIGHT, width: 1020, height: 680 - GLANCE_HEADER_HEIGHT })
  })
  test('small windows keep a margin; nothing goes negative', () => {
    const layout = glanceLayout(100, 60)
    expect(layout.card.x).toBeGreaterThanOrEqual(12)
    expect(layout.card.width).toBe(76)
    expect(layout.page.height).toBe(0)
    const empty = glanceLayout(0, 0)
    expect(empty.card.width).toBe(0)
    expect(empty.page.height).toBe(0)
  })
})

describe('glanceKeyAction', () => {
  test('Esc closes, except in HTML fullscreen where it is the page’s', () => {
    expect(glanceKeyAction(key({ key: 'Escape' }), true)).toBe('close')
    expect(glanceKeyAction(key({ key: 'Escape' }), false)).toBe('close')
    expect(glanceKeyAction(key({ key: 'Escape' }), true, true)).toBeNull()
    expect(glanceKeyAction(key({ key: 'Escape', type: 'keyUp' }), true)).toBeNull()
  })
  test('Cmd/Ctrl+Enter promotes, with the platform’s primary modifier', () => {
    expect(glanceKeyAction(key({ key: 'Enter', meta: true }), true)).toBe('promote')
    expect(glanceKeyAction(key({ key: 'Enter', control: true }), false)).toBe('promote')
    expect(glanceKeyAction(key({ key: 'Enter', control: true }), true)).toBeNull()
    expect(glanceKeyAction(key({ key: 'Enter' }), true)).toBeNull()
  })
  test('close / reload / back / forward / zoom act on the glance', () => {
    expect(glanceKeyAction(key({ key: 'w', meta: true }), true)).toBe('close')
    expect(glanceKeyAction(key({ key: 'r', meta: true }), true)).toBe('reload')
    expect(glanceKeyAction(key({ key: '[', meta: true }), true)).toBe('back')
    expect(glanceKeyAction(key({ key: ']', meta: true }), true)).toBe('forward')
    expect(glanceKeyAction(key({ key: 'ArrowLeft', alt: true }), false)).toBe('back')
    expect(glanceKeyAction(key({ key: '=', control: true }), false)).toBe('zoom-in')
    expect(glanceKeyAction(key({ key: '-', control: true, isAutoRepeat: true }), false)).toBe('zoom-out')
    expect(glanceKeyAction(key({ key: '0', control: true }), false)).toBe('zoom-reset')
  })
  test('zoom keys map to the shared page-zoom steps (persisted per origin like a tab)', () => {
    expect(glanceZoomAction('zoom-in')).toBe('in')
    expect(glanceZoomAction('zoom-out')).toBe('out')
    expect(glanceZoomAction('zoom-reset')).toBe('reset')
    expect(glanceZoomAction('reload')).toBeNull()
    expect(glanceZoomAction(null)).toBeNull()
    expect(glanceZoomAction(glanceKeyAction(key({ key: '=', meta: true }), true))).toBe('in')
  })
  test('editing keys and typing stay with the page', () => {
    for (const k of ['a', 'c', 'v', 'x', 'z']) expect(glanceKeyAction(key({ key: k, meta: true }), true)).toBeNull()
    expect(glanceKeyAction(key({ key: 'z', meta: true, shift: true }), true)).toBeNull()
    expect(glanceKeyAction(key({ key: 'y', control: true }), false)).toBeNull()
    expect(glanceKeyAction(key({ key: 'k' }), true)).toBeNull()
    expect(glanceKeyAction(key({ key: 'Meta', meta: true }), true)).toBeNull()
  })
  test('other browser shortcuts close the glance first (new tab, palette, history on macOS)', () => {
    expect(glanceKeyAction(key({ key: 't', meta: true }), true)).toBe('close-and-forward')
    expect(glanceKeyAction(key({ key: 'k', control: true }), false)).toBe('close-and-forward')
    expect(glanceKeyAction(key({ key: 'y', meta: true }), true)).toBe('close-and-forward')
    expect(glanceKeyAction(key({ key: ']', meta: true, shift: true }), true)).toBe('close-and-forward')
    expect(glanceKeyAction(key({ key: 't', meta: true, isAutoRepeat: true }), true)).toBeNull()
  })
})

describe('glanceWindowOpenAction (links inside a glance)', () => {
  test('target=_blank and Shift+click navigate within the glance', () => {
    expect(glanceWindowOpenAction({ disposition: 'foreground-tab', url: 'https://a.example/' })).toBe('navigate')
    expect(glanceWindowOpenAction({ disposition: 'new-window', features: '', url: 'https://a.example/' })).toBe('navigate')
  })
  test('Cmd/Ctrl+click still makes a background tab; popups and odd schemes are denied', () => {
    expect(glanceWindowOpenAction({ disposition: 'background-tab', url: 'https://a.example/' })).toBe('background-tab')
    expect(glanceWindowOpenAction({ disposition: 'new-window', features: 'width=400', url: 'https://a.example/' })).toBe('deny')
    expect(glanceWindowOpenAction({ disposition: 'foreground-tab', url: 'javascript:void 0' })).toBe('deny')
  })
})
