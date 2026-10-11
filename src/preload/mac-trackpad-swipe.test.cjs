'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  clampProgress,
  resolveScrollEdges,
  scrollEdgesAt,
  shouldYieldToPage
} = require('./mac-trackpad-swipe.cjs')

test('AppKit progress is clamped and invalid values never move the page', () => {
  assert.equal(clampProgress(-0.2), 0)
  assert.equal(clampProgress(0.48), 0.48)
  assert.equal(clampProgress(1.5), 1)
  assert.equal(clampProgress(Number.NaN), 0)
  assert.equal(clampProgress(undefined), 0)
})

test('two-finger Back and Forward defer to a page that can still scroll in that direction', () => {
  assert.equal(shouldYieldToPage('back', { canScrollLeft: true, canScrollRight: false }), true)
  assert.equal(shouldYieldToPage('forward', { canScrollLeft: false, canScrollRight: true }), true)
  assert.equal(shouldYieldToPage('back', { canScrollLeft: false, canScrollRight: true }), false)
  assert.equal(shouldYieldToPage('forward', { canScrollLeft: true, canScrollRight: false }), false)
  assert.equal(shouldYieldToPage('back', null), true)
})

test('nested horizontal scrollers hand the gesture to an outer scroller at their edge', () => {
  const inner = {
    scrollLeft: 0, scrollWidth: 500, clientWidth: 200,
    overflowX: 'auto', overscrollBehaviorX: 'auto', direction: 'ltr'
  }
  const outer = {
    scrollLeft: 150, scrollWidth: 700, clientWidth: 300,
    overflowX: 'auto', overscrollBehaviorX: 'auto', direction: 'ltr'
  }
  assert.deepEqual(resolveScrollEdges([inner, outer]), { canScrollLeft: true, canScrollRight: true })
  outer.scrollLeft = 0
  assert.deepEqual(resolveScrollEdges([inner, outer]), { canScrollLeft: false, canScrollRight: true })
})

test('LTR scroll edges track content movement without stealing the page scroll', () => {
  const scroller = {
    scrollLeft: 0, scrollWidth: 900, clientWidth: 300,
    overflowX: 'auto', overscrollBehaviorX: 'auto', direction: 'ltr'
  }
  assert.deepEqual(resolveScrollEdges([scroller]), { canScrollLeft: false, canScrollRight: true })
  scroller.scrollLeft = 300
  assert.deepEqual(resolveScrollEdges([scroller]), { canScrollLeft: true, canScrollRight: true })
  scroller.scrollLeft = 600
  assert.deepEqual(resolveScrollEdges([scroller]), { canScrollLeft: true, canScrollRight: false })
})

test('RTL negative scroll offsets, overscroll containment, and non-user-scrollable overflow are handled', () => {
  const rtl = {
    scrollLeft: 0, scrollWidth: 900, clientWidth: 300,
    overflowX: 'auto', overscrollBehaviorX: 'auto', direction: 'rtl'
  }
  assert.deepEqual(resolveScrollEdges([rtl]), { canScrollLeft: true, canScrollRight: false })
  rtl.scrollLeft = -300
  assert.deepEqual(resolveScrollEdges([rtl]), { canScrollLeft: true, canScrollRight: true })
  rtl.scrollLeft = -600
  assert.deepEqual(resolveScrollEdges([rtl]), { canScrollLeft: false, canScrollRight: true })
  assert.deepEqual(resolveScrollEdges([{ ...rtl, overscrollBehaviorX: 'contain' }]), { canScrollLeft: true, canScrollRight: true })
  assert.deepEqual(resolveScrollEdges([{ ...rtl, overflowX: 'hidden' }]), { canScrollLeft: false, canScrollRight: false })
  assert.deepEqual(resolveScrollEdges([{ ...rtl, overflowX: 'clip' }]), { canScrollLeft: false, canScrollRight: false })
})

test('the viewport can preserve vertical-page horizontal overscroll while unknown state remains conservative', () => {
  assert.deepEqual(resolveScrollEdges([{
    scrollLeft: 0, scrollWidth: 800, clientWidth: 500,
    overflowX: 'auto', overscrollBehaviorX: 'auto', direction: 'ltr', isViewport: true
  }]), { canScrollLeft: false, canScrollRight: true })
  assert.equal(shouldYieldToPage('forward', undefined), true)
})

test('embedded frame targets conservatively defer two-finger swipes to page content', () => {
  const frame = { nodeType: 1, tagName: 'IFRAME' }
  const win = { getComputedStyle: () => { throw new Error('frame content must not be inspected from the parent') } }
  const doc = { documentElement: {}, body: {} }
  const edges = scrollEdgesAt(frame, win, doc)
  assert.deepEqual(edges, { canScrollLeft: true, canScrollRight: true })
  assert.equal(shouldYieldToPage('back', edges), true)
  assert.equal(shouldYieldToPage('forward', edges), true)
})
