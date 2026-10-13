import { describe, expect, test } from 'bun:test'
import { blurDismissesPopover, pagePressDismissesPopovers, POPOVER_DISMISS_CHANNEL, POPOVER_DISMISS_EVENT } from './popover-dismiss'

const open = { overlayMode: true, toolbarHeight: 50, toolbarExtent: 180 }

describe('popover light-dismiss', () => {
  test('a press on the page closes a popover hanging below the toolbar', () => {
    expect(pagePressDismissesPopovers('mouseDown', open)).toBe(true)
  })

  test('moves, releases and wheel events never do', () => {
    for (const type of ['mouseMove', 'mouseUp', 'mouseWheel', 'mouseEnter', 'mouseLeave']) {
      expect(pagePressDismissesPopovers(type, open)).toBe(false)
    }
  })

  test('nothing below the toolbar: no IPC for ordinary page clicks', () => {
    expect(pagePressDismissesPopovers('mouseDown', { ...open, toolbarExtent: 50 })).toBe(false)
  })

  test('off overlay mode the toolbar and page are one document (its own listener handles it)', () => {
    expect(pagePressDismissesPopovers('mouseDown', { ...open, overlayMode: false })).toBe(false)
  })

  test('focus leaving closes a popover, except while its own select list is open', () => {
    expect(blurDismissesPopover('BUTTON')).toBe(true)
    expect(blurDismissesPopover('input')).toBe(true)
    expect(blurDismissesPopover(null)).toBe(true)
    expect(blurDismissesPopover(undefined)).toBe(true)
    expect(blurDismissesPopover('SELECT')).toBe(false)
    expect(blurDismissesPopover('select')).toBe(false)
  })

  test('channel and event names are distinct and namespaced', () => {
    expect(POPOVER_DISMISS_CHANNEL.startsWith('browser:')).toBe(true)
    expect(POPOVER_DISMISS_EVENT).not.toBe(POPOVER_DISMISS_CHANNEL)
  })
})
