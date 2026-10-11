'use strict'

const SETTLE_MS = 180
const RESET_FALLBACK_MS = 2_500
const SCROLL_EDGE_EPSILON = 1
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])
const NON_SCROLLING_OVERFLOW = new Set(['hidden', 'clip'])
const CONTAINING_OVERSCROLL = new Set(['contain', 'none'])

const SCROLL_EDGE_CHANNEL = 'browser:mac-trackpad-swipe:scroll-edge'
const BEGIN_CHANNEL = 'browser:mac-trackpad-swipe:begin'
const PROGRESS_CHANNEL = 'browser:mac-trackpad-swipe:progress'
const END_CHANNEL = 'browser:mac-trackpad-swipe:end'
const RESET_CHANNEL = 'browser:mac-trackpad-swipe:reset'

function resolveScrollEdges(candidates) {
  let canScrollLeft = false
  let canScrollRight = false

  for (const candidate of candidates) {
    const overflowX = candidate.overflowX || 'visible'
    const isViewport = candidate.isViewport === true
    if (isViewport ? NON_SCROLLING_OVERFLOW.has(overflowX) : !SCROLLABLE_OVERFLOW.has(overflowX)) continue

    if (CONTAINING_OVERSCROLL.has(candidate.overscrollBehaviorX)) {
      return { canScrollLeft: true, canScrollRight: true }
    }

    const width = Number(candidate.scrollWidth) - Number(candidate.clientWidth)
    if (!Number.isFinite(width) || width <= SCROLL_EDGE_EPSILON) continue
    const scrollLeft = Number.isFinite(candidate.scrollLeft) ? candidate.scrollLeft : 0

    if (candidate.direction === 'rtl') {
      canScrollLeft ||= -scrollLeft < width - SCROLL_EDGE_EPSILON
      canScrollRight ||= scrollLeft < -SCROLL_EDGE_EPSILON
    } else {
      canScrollLeft ||= scrollLeft > SCROLL_EDGE_EPSILON
      canScrollRight ||= width - scrollLeft > SCROLL_EDGE_EPSILON
    }

    if (canScrollLeft && canScrollRight) break
  }

  return { canScrollLeft, canScrollRight }
}

function shouldYieldToPage(direction, edges) {
  if (!edges || typeof edges !== 'object') return true
  if (direction === 'back') return edges.canScrollLeft !== false
  if (direction === 'forward') return edges.canScrollRight !== false
  return true
}

function clampProgress(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function parentAcrossShadowBoundary(node) {
  if (!node) return null
  if (node.parentElement) return node.parentElement
  const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null
  return root && root.host ? root.host : null
}

function scrollEdgesAt(target, win, doc) {
  if (!win || !doc || typeof win.getComputedStyle !== 'function') {
    return { canScrollLeft: true, canScrollRight: true }
  }

  if (target && target.nodeType === 1 && ['IFRAME', 'OBJECT', 'EMBED'].includes(target.tagName)) {
    return { canScrollLeft: true, canScrollRight: true }
  }

  const root = doc.scrollingElement || doc.documentElement
  let element = target && target.nodeType === 1 ? target : parentAcrossShadowBoundary(target)
  const seen = new Set()
  const candidates = []

  while (element && element !== root && element !== doc.body && !seen.has(element)) {
    seen.add(element)
    const style = win.getComputedStyle(element)
    candidates.push({
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: style.overflowX,
      overscrollBehaviorX: style.overscrollBehaviorX,
      direction: style.direction
    })
    element = parentAcrossShadowBoundary(element)
  }

  if (doc.body && doc.body !== root && !seen.has(doc.body)) {
    const style = win.getComputedStyle(doc.body)
    candidates.push({
      scrollLeft: doc.body.scrollLeft,
      scrollWidth: doc.body.scrollWidth,
      clientWidth: doc.body.clientWidth,
      overflowX: style.overflowX,
      overscrollBehaviorX: style.overscrollBehaviorX,
      direction: style.direction
    })
  }

  if (root) {
    const style = win.getComputedStyle(root)
    candidates.push({
      scrollLeft: root.scrollLeft,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflowX: style.overflowX,
      overscrollBehaviorX: style.overscrollBehaviorX,
      direction: style.direction,
      isViewport: true
    })
  }

  return resolveScrollEdges(candidates)
}

function startScrollEdgeReporter(ipcRenderer, win, doc, isMainFrame) {
  if (!isMainFrame) return
  let lastTarget = null
  let previous = null

  function publish(target = lastTarget) {
    lastTarget = target || null
    // With no pointer target yet (fresh page, pointer hasn't moved) measure the viewport
    // instead of reporting "can scroll both ways", which refused every swipe after a navigation.
    const edges = scrollEdgesAt(lastTarget || doc.documentElement, win, doc)
    if (previous && previous.canScrollLeft === edges.canScrollLeft
      && previous.canScrollRight === edges.canScrollRight) return
    previous = edges
    try {
      ipcRenderer.send(SCROLL_EDGE_CHANNEL, edges)
    } catch {
      // A frame can be torn down between the scroll event and IPC dispatch.
    }
  }

  function updateFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null
    publish((path && path[0]) || event.target || null)
  }

  win.addEventListener('pointermove', updateFromEvent, { capture: true, passive: true })
  win.addEventListener('pointerover', updateFromEvent, { capture: true, passive: true })
  win.addEventListener('wheel', updateFromEvent, { capture: true, passive: true })
  doc.addEventListener('scroll', () => publish(), { capture: true, passive: true })
  doc.addEventListener('DOMContentLoaded', () => publish(), { once: true })
  win.requestAnimationFrame(() => publish())
}

function startSwipePresentation(ipcRenderer, win, doc) {
  let active = null
  let overlay = null
  let savedRootStyles = null
  let finishTimer = null
  let resetTimer = null

  function clearTimers() {
    if (finishTimer) clearTimeout(finishTimer)
    if (resetTimer) clearTimeout(resetTimer)
    finishTimer = null
    resetTimer = null
  }

  function saveRootStyles() {
    if (savedRootStyles) return
    const root = doc.documentElement
    savedRootStyles = {
      translate: root.style.translate,
      transition: root.style.transition,
      willChange: root.style.willChange
    }
    root.style.willChange = 'translate'
  }

  function removeOverlay() {
    if (overlay?.shell?.parentNode) overlay.shell.parentNode.removeChild(overlay.shell)
    overlay = null
  }

  function restoreStyles() {
    const root = doc.documentElement
    if (savedRootStyles) {
      root.style.translate = savedRootStyles.translate
      root.style.transition = savedRootStyles.transition
      root.style.willChange = savedRootStyles.willChange
    }
    savedRootStyles = null
    removeOverlay()
  }

  function makeOverlay(direction) {
    removeOverlay()
    const isBack = direction === 'back'
    const shell = doc.createElement('div')
    shell.setAttribute('aria-hidden', 'true')
    shell.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'pointer-events:none',
      'opacity:0', 'color:#17202b', 'font:500 12px/1.2 -apple-system,BlinkMacSystemFont,sans-serif'
    ].join(';')

    const edge = doc.createElement('div')
    edge.style.cssText = [
      'position:absolute', 'top:0', 'bottom:0', isBack ? 'left:0' : 'right:0',
      'width:88px', 'display:flex', 'align-items:center', 'justify-content:center',
      `background:linear-gradient(to ${isBack ? 'right' : 'left'},rgba(20,25,32,.22),transparent)`
    ].join(';')

    const badge = doc.createElement('div')
    badge.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:center', 'gap:6px',
      'padding:9px 10px 8px', 'min-width:54px', 'border-radius:16px',
      'background:rgba(249,250,252,.95)', 'box-shadow:0 4px 18px rgba(0,0,0,.22)',
      'backdrop-filter:blur(16px)', 'white-space:nowrap'
    ].join(';')

    const arrow = doc.createElement('span')
    arrow.textContent = isBack ? '←' : '→'
    arrow.style.cssText = 'font-size:24px;line-height:24px;font-weight:400'
    const label = doc.createElement('span')
    label.textContent = isBack ? 'Back' : 'Forward'
    const track = doc.createElement('span')
    track.style.cssText = 'display:block;width:32px;height:2px;overflow:hidden;border-radius:2px;background:rgba(23,32,43,.16)'
    const fill = doc.createElement('span')
    fill.style.cssText = 'display:block;width:0;height:100%;border-radius:2px;background:#1684ff'
    track.appendChild(fill)
    badge.append(arrow, label, track)
    edge.appendChild(badge)
    shell.appendChild(edge)
    doc.documentElement.appendChild(shell)
    overlay = { shell, badge, fill, direction }
  }

  function render(progress, animate = false, complete = false) {
    if (!active || !overlay || !savedRootStyles) return
    const value = clampProgress(progress)
    const root = doc.documentElement
    const isBack = active.direction === 'back'
    const travel = complete ? Math.max(1, win.innerWidth * 0.94) : Math.min(win.innerWidth * 0.38, 320) * value
    const offset = isBack ? travel : -travel
    const transition = animate ? `translate ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1)` : 'none'
    root.style.transition = transition
    overlay.shell.style.transition = animate
      ? `translate ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${SETTLE_MS}ms ease`
      : 'opacity 70ms linear'
    overlay.badge.style.transition = animate
      ? `transform ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${SETTLE_MS}ms ease`
      : 'none'
    root.style.translate = `${offset}px 0px`
    overlay.shell.style.translate = `${-offset}px 0px`
    overlay.shell.style.opacity = String(Math.min(1, value * 1.8))
    const inset = (1 - value) * 36 * (isBack ? -1 : 1)
    overlay.badge.style.transform = `translateX(${inset}px) scale(${0.92 + value * 0.08})`
    overlay.badge.style.opacity = String(Math.min(1, value * 1.8))
    overlay.fill.style.width = `${Math.round(value * 100)}%`
  }

  function settleBack() {
    if (!active || !overlay || !savedRootStyles) {
      active = null
      restoreStyles()
      return
    }
    const current = active
    const root = doc.documentElement
    root.style.transition = `translate ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1)`
    overlay.shell.style.transition = `translate ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${SETTLE_MS}ms ease`
    overlay.badge.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(.2,.8,.2,1), opacity ${SETTLE_MS}ms ease`
    root.style.translate = '0px 0px'
    overlay.shell.style.translate = '0px 0px'
    overlay.shell.style.opacity = '0'
    overlay.badge.style.opacity = '0'
    overlay.badge.style.transform = `translateX(${current.direction === 'back' ? -36 : 36}px) scale(.92)`

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(finishTimer)
      root.removeEventListener('transitionend', onTransitionEnd)
      if (active === current) active = null
      restoreStyles()
    }
    const onTransitionEnd = (event) => {
      if (event.target === root && event.propertyName === 'translate') finish()
    }
    root.addEventListener('transitionend', onTransitionEnd)
    finishTimer = setTimeout(finish, SETTLE_MS + 80)
  }

  function begin(direction) {
    if (direction !== 'back' && direction !== 'forward') return
    clearTimers()
    if (active || savedRootStyles) {
      active = null
      restoreStyles()
    }
    active = { direction, progress: 0 }
    saveRootStyles()
    makeOverlay(direction)
    render(0)
  }

  function onEnd(payload) {
    if (!active || !payload || typeof payload.committed !== 'boolean') return
    clearTimers()
    if (!payload.committed) {
      settleBack()
      return
    }
    active.waitingForNavigation = true
    render(1, true, true)
    const current = active
    resetTimer = setTimeout(() => {
      if (active !== current || !current.waitingForNavigation) return
      settleBack()
    }, RESET_FALLBACK_MS)
  }

  function reset() {
    clearTimers()
    if (!active && !savedRootStyles) return
    settleBack()
  }

  ipcRenderer.on(BEGIN_CHANNEL, (_event, payload) => begin(payload && payload.direction))
  ipcRenderer.on(PROGRESS_CHANNEL, (_event, payload) => {
    if (!active || active.waitingForNavigation || !payload) return
    active.progress = clampProgress(payload.progress)
    render(active.progress)
  })
  ipcRenderer.on(END_CHANNEL, (_event, payload) => onEnd(payload))
  ipcRenderer.on(RESET_CHANNEL, reset)
  win.addEventListener('blur', reset)
  win.addEventListener('unload', () => {
    clearTimers()
    removeOverlay()
  }, { once: true })
}

function startPreload(ipcRenderer, win, doc, isMainFrame = true) {
  startScrollEdgeReporter(ipcRenderer, win, doc, isMainFrame)
  if (isMainFrame) startSwipePresentation(ipcRenderer, win, doc)
}

const BACKGROUND_AUTOPLAY_POLICY_CHANNEL = 'browser:background-youtube-autoplay:policy'
const BACKGROUND_AUTOPLAY_ALLOW_CHANNEL = 'browser:background-youtube-autoplay:allow'
const BACKGROUND_AUTOPLAY_RELEASE_KEY = '__surffishAllowBackgroundYouTubeAutoplay'

function isYouTubePageUrl(input) {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return hostname === 'youtu.be'
      || hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com')
      || hostname === 'youtube-nocookie.com'
      || hostname.endsWith('.youtube-nocookie.com')
  } catch {
    return false
  }
}

function backgroundAutoplayBlockScript() {
  return `(() => {
    const mediaPrototype = HTMLMediaElement.prototype
    const playDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, 'play')
    if (!playDescriptor || typeof playDescriptor.value !== 'function') return
    const autoplayDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, 'autoplay')
    let blocked = true

    const guardedPlay = function (...args) {
      if (blocked) return Promise.reject(new DOMException('Playback is blocked until this background tab is activated.', 'NotAllowedError'))
      return Reflect.apply(playDescriptor.value, this, args)
    }
    Object.defineProperty(mediaPrototype, 'play', { ...playDescriptor, value: guardedPlay })

    let guardedAutoplaySetter = null
    if (autoplayDescriptor && typeof autoplayDescriptor.set === 'function') {
      guardedAutoplaySetter = function (value) {
        if (blocked && value) {
          autoplayDescriptor.set.call(this, false)
          this.removeAttribute('autoplay')
          return
        }
        autoplayDescriptor.set.call(this, value)
      }
      Object.defineProperty(mediaPrototype, 'autoplay', { ...autoplayDescriptor, set: guardedAutoplaySetter })
    }

    const disableAutoplay = (media) => {
      if (!(media instanceof HTMLMediaElement)) return
      if (media.hasAttribute('autoplay')) media.removeAttribute('autoplay')
      if (media.autoplay) media.autoplay = false
      if (!media.paused && !media.ended) media.pause()
    }
    const inspectNode = (node) => {
      if (!node || node.nodeType !== 1) return
      disableAutoplay(node)
      for (const media of node.querySelectorAll('audio, video')) disableAutoplay(media)
    }
    const stopPlayEvent = (event) => {
      if (blocked && event.target instanceof HTMLMediaElement) event.target.pause()
    }
    document.addEventListener('play', stopPlayEvent, true)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') disableAutoplay(mutation.target)
        else for (const node of mutation.addedNodes) inspectNode(node)
      }
    })
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['autoplay'] })
    inspectNode(document.documentElement)

    const release = () => {
      if (!blocked) return
      blocked = false
      observer.disconnect()
      document.removeEventListener('play', stopPlayEvent, true)
      if (mediaPrototype.play === guardedPlay) Object.defineProperty(mediaPrototype, 'play', playDescriptor)
      if (guardedAutoplaySetter && Object.getOwnPropertyDescriptor(mediaPrototype, 'autoplay')?.set === guardedAutoplaySetter) {
        Object.defineProperty(mediaPrototype, 'autoplay', autoplayDescriptor)
      }
      delete window[${JSON.stringify(BACKGROUND_AUTOPLAY_RELEASE_KEY)}]
    }
    Object.defineProperty(window, ${JSON.stringify(BACKGROUND_AUTOPLAY_RELEASE_KEY)}, { value: release, configurable: true })
  })()`
}

function backgroundAutoplayReleaseScript() {
  return `window[${JSON.stringify(BACKGROUND_AUTOPLAY_RELEASE_KEY)}]?.()`
}

function startBackgroundAutoplayGuard(ipcRenderer, webFrame, isMainFrame = true, pageUrl = typeof window === 'undefined' ? '' : window.location.href) {
  if (!isMainFrame || !isYouTubePageUrl(pageUrl)) return

  let installed = false
  let allowRequested = false
  const release = () => {
    allowRequested = true
    if (!installed) return
    installed = false
    try {
      const result = webFrame.executeJavaScript(backgroundAutoplayReleaseScript())
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch {
      // The page may be navigating away.
    }
  }
  ipcRenderer.on(BACKGROUND_AUTOPLAY_ALLOW_CHANNEL, release)

  let shouldBlock = false
  try {
    shouldBlock = ipcRenderer.sendSync(BACKGROUND_AUTOPLAY_POLICY_CHANNEL) === true
  } catch {
    // A failed policy lookup must not prevent normal page loading.
  }
  if (!shouldBlock) {
    ipcRenderer.removeListener(BACKGROUND_AUTOPLAY_ALLOW_CHANNEL, release)
    return
  }

  try {
    const installation = webFrame.executeJavaScript(backgroundAutoplayBlockScript())
    Promise.resolve(installation).then(() => {
      installed = true
      if (allowRequested) release()
    }).catch(() => {
      ipcRenderer.removeListener(BACKGROUND_AUTOPLAY_ALLOW_CHANNEL, release)
    })
  } catch {
    ipcRenderer.removeListener(BACKGROUND_AUTOPLAY_ALLOW_CHANNEL, release)
  }
}

module.exports = {
  clampProgress,
  resolveScrollEdges,
  scrollEdgesAt,
  shouldYieldToPage,
  startBackgroundAutoplayGuard,
  isYouTubePageUrl,
  BACKGROUND_AUTOPLAY_POLICY_CHANNEL,
  BACKGROUND_AUTOPLAY_ALLOW_CHANNEL
}

if (process.versions.electron) {
  const { ipcRenderer, webFrame } = require('electron')
  const isMainFrame = process.isMainFrame !== false
  if (process.platform === 'darwin') startPreload(ipcRenderer, window, document, isMainFrame)
  startBackgroundAutoplayGuard(ipcRenderer, webFrame, isMainFrame)
}
