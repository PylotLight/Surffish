'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const {
  BACKGROUND_AUTOPLAY_ALLOW_CHANNEL,
  BACKGROUND_AUTOPLAY_POLICY_CHANNEL,
  clampProgress,
  isYouTubePageUrl,
  resolveScrollEdges,
  scrollEdgesAt,
  shouldYieldToPage,
  startBackgroundAutoplayGuard
} = require('./mac-trackpad-swipe.cjs')

test('background YouTube autoplay is blocked at document start and released when activated', async () => {
  const listeners = new Map()
  const scripts = []
  const ipcRenderer = {
    sendSync: (channel) => {
      assert.equal(channel, BACKGROUND_AUTOPLAY_POLICY_CHANNEL)
      return true
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    }
  }
  const webFrame = {
    executeJavaScript: (script) => {
      scripts.push(script)
      return Promise.resolve()
    }
  }

  startBackgroundAutoplayGuard(ipcRenderer, webFrame, true, 'https://www.youtube.com/watch?v=test')
  assert.match(scripts[0], /HTMLMediaElement\.prototype/)
  assert.equal(listeners.has(BACKGROUND_AUTOPLAY_ALLOW_CHANNEL), true)

  class FakeMedia {
    constructor() {
      this.paused = true
      this.ended = false
      this._autoplay = false
      this.attributes = new Set()
      this.playCount = 0
      this.nodeType = 1
    }
    get autoplay() { return this._autoplay }
    set autoplay(value) {
      this._autoplay = Boolean(value)
      if (this._autoplay) this.attributes.add('autoplay')
      else this.attributes.delete('autoplay')
    }
    play() {
      this.playCount += 1
      this.paused = false
      return Promise.resolve()
    }
    pause() { this.paused = true }
    hasAttribute(name) { return this.attributes.has(name) }
    removeAttribute(name) {
      this.attributes.delete(name)
      if (name === 'autoplay') this._autoplay = false
    }
    querySelectorAll() { return [] }
  }
  const documentListeners = new Map()
  const document = {
    documentElement: { nodeType: 1, querySelectorAll: () => [] },
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (documentListeners.get(type) === listener) documentListeners.delete(type)
    },
    querySelectorAll: () => []
  }
  const window = {}
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  vm.runInNewContext(scripts[0], {
    window,
    document,
    HTMLMediaElement: FakeMedia,
    MutationObserver: FakeMutationObserver,
    Promise,
    DOMException
  })

  const media = new FakeMedia()
  media.autoplay = true
  assert.equal(media.autoplay, false)
  await assert.rejects(media.play(), { name: 'NotAllowedError' })
  assert.equal(media.playCount, 0)

  listeners.get(BACKGROUND_AUTOPLAY_ALLOW_CHANNEL)()
  await Promise.resolve()
  assert.match(scripts[1], /__surffishAllowBackgroundYouTubeAutoplay/)
  vm.runInNewContext(scripts[1], { window })
  await media.play()
  assert.equal(media.playCount, 1)
})

test('background autoplay policy is not queried from child frames', () => {
  let queried = false
  const ipcRenderer = {
    sendSync: () => { queried = true; return true },
    on() {},
    removeListener() {}
  }
  startBackgroundAutoplayGuard(ipcRenderer, { executeJavaScript() {} }, false, 'https://www.youtube.com/watch?v=test')
  assert.equal(queried, false)
})

test('background autoplay guard recognizes YouTube hosts and skips lookalikes', () => {
  assert.equal(isYouTubePageUrl('https://music.youtube.com/watch?v=test'), true)
  assert.equal(isYouTubePageUrl('https://www.youtube-nocookie.com/embed/test'), true)
  assert.equal(isYouTubePageUrl('https://youtu.be/test'), true)
  assert.equal(isYouTubePageUrl('https://youtube.com.attacker.example/watch'), false)
  assert.equal(isYouTubePageUrl('https://notyoutube.com/watch'), false)

  let queried = false
  const ipcRenderer = {
    sendSync: () => { queried = true; return true },
    on() {},
    removeListener() {}
  }
  startBackgroundAutoplayGuard(ipcRenderer, { executeJavaScript() {} }, true, 'https://example.com/')
  assert.equal(queried, false)
})

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
