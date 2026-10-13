// Hidden smoke mode for the self-hosted Mac CI runner (someone's laptop, in use while CI runs).
// Required by smoke-harness.cjs and scripts/perf/bench.cjs before the app is imported, so it never
// ships in the app and the perf base build gets exactly the same treatment as the PR.
// macOS only; elsewhere it's a no-op (the Linux lanes run under xvfb anyway). Unset: does nothing.
//
// SURFFISH_SMOKE_HIDDEN=2 (v2, never shown):
//   - app.setActivationPolicy('accessory') before any window: no Dock icon, not in Cmd+Tab, no menu bar
//   - windows are never ordered on screen: show()/showInactive() never reach the OS, and every window
//     is made non-focusable (setFocusable(false)), so it can't become key either. maximize(),
//     setFullScreen(), minimize() and restore() would bring a hidden window on screen on macOS, so
//     they're virtual too (maximize resizes to the display's work area instead).
//   - visibility, focus, minimized/maximized/full-screen state are virtual: show() marks the window
//     visible and emits 'show' (+ 'focus'), focus() moves the virtual focus and emits 'focus'/'blur',
//     and isVisible()/isFocused()/getFocusedWindow() answer from that, so the app's window logic and
//     the smokes still check real behaviour
//   - a never-shown window's web contents count as hidden, so Chromium would stop painting them (no
//     rAF, no frames to capture). setBackgroundThrottling(false) keeps them rendering:
//       SURFFISH_SMOKE_HIDDEN_THROTTLE=all (default): every webContents, plus the switches
//         --disable-renderer-backgrounding / --disable-background-timer-throttling. For smokes.
//       SURFFISH_SMOKE_HIDDEN_THROTTLE=visible: only views that would be on screen in a shown window
//         (attached to a window and visible); a view keeps its own setting again once it's detached
//         or hidden, so background tabs are throttled exactly like in a visible window. For perf,
//         which measures background-tab throttling and idle CPU.
//   - SURFFISH_SMOKE_HIDDEN_FOCUSABLE=1 (diagnostic): leave windows focusable.
//
// SURFFISH_SMOKE_HIDDEN=1 (v1, near-invisible but on screen):
//   - accessory policy as above; win.show() becomes showInactive(), and every shown window is
//     near-invisible (opacity 0.01), click-through and floats above other apps on every Space: an
//     inactive app's window behind the user's windows counts as occluded (no vsync, ~1 frame/s: tab
//     switch to painted went 22 ms -> 1014 ms on the runner). prevent-app-suspension is held.
//   - win.focus(), app.focus() and app.show() never touch the OS; window focus is virtual as above.
//
// Both: an in-process monitor polls the real (native) isVisible()/isFocused() of every window, and at
// exit one line says whether a window was ever on screen, natively focused, or the app activated.
// SURFFISH_SMOKE_HIDDEN_FORCE=1 runs the mode off macOS too (only to test this file under xvfb).
'use strict'

const OPACITY = 0.01
const POLL_MS = 300

/** The hidden mode to install: 0 (off), 1 or 2. Pure, for the unit test. */
function hiddenMode(env = process.env, platform = process.platform) {
  const value = String(env.SURFFISH_SMOKE_HIDDEN ?? '').trim()
  if (value !== '1' && value !== '2') return 0
  if (platform !== 'darwin' && env.SURFFISH_SMOKE_HIDDEN_FORCE !== '1') return 0
  return Number(value)
}

/** Which web contents v2 keeps unthrottled: 'all' (smokes) or 'visible' (perf). */
function throttleMode(env = process.env) {
  return env.SURFFISH_SMOKE_HIDDEN_THROTTLE === 'visible' ? 'visible' : 'all'
}

const mode = hiddenMode()

function install() {
  const electron = require('electron')
  const { app, BaseWindow, BrowserWindow, View, screen } = electron
  const v2 = mode === 2
  const throttle = throttleMode()
  const focusable = process.env.SURFFISH_SMOKE_HIDDEN_FOCUSABLE === '1'
  const stats = {
    mode, throttle: v2 ? throttle : null, focusable: v2 ? focusable : null,
    shown: 0, virtualFocus: 0, realKey: 0, activations: 0, fullScreen: 0,
    blocked: { appFocus: 0, appShow: 0, maximize: 0, fullScreen: 0, minimize: 0, restore: 0 },
    nativeVisibleSamples: 0, nativeVisibleWindows: 0, nativeFocusedSamples: 0, polls: 0, unthrottled: 0
  }
  const prepared = new WeakSet()
  const state = new WeakMap() // v2 virtual window state
  const everVisible = new WeakSet()
  let focused = null
  let emitting = false
  let applyToWindow = () => {}

  // Native methods, captured before patching (the monitor needs the real answers).
  const native = {}
  for (const name of ['show', 'showInactive', 'isVisible', 'isFocused', 'hide', 'maximize', 'unmaximize', 'isMaximized',
    'minimize', 'restore', 'isMinimized', 'setFullScreen', 'isFullScreen']) native[name] = BaseWindow.prototype[name]

  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  if (v2 && throttle === 'all') {
    app.commandLine.appendSwitch('disable-renderer-backgrounding')
    app.commandLine.appendSwitch('disable-background-timer-throttling')
  }
  const accessory = () => { try { app.setActivationPolicy('accessory') } catch { /* not available yet */ } }
  accessory()
  app.whenReady().then(() => {
    accessory()
    try { app.dock?.hide() } catch { /* ignore */ }
    try { electron.powerSaveBlocker.start('prevent-app-suspension') } catch { /* ignore */ }
  })

  const live = (win) => win && !win.isDestroyed()
  const emit = (win, ...args) => {
    emitting = true
    try { if (live(win)) win.emit(...args) } finally { emitting = false }
  }
  function setVirtualFocus(win) {
    if (focused === win) return
    const previous = focused
    focused = win
    if (live(previous)) emit(previous, 'blur')
    if (live(win)) emit(win, 'focus')
  }
  const vstate = (win) => {
    let s = state.get(win)
    if (!s) { s = { visible: false, minimized: false, maximized: false, fullScreen: false, restoreBounds: null }; state.set(win, s) }
    return s
  }

  function prepare(win) {
    if (prepared.has(win) || !live(win)) return
    prepared.add(win)
    if (v2) {
      vstate(win)
      if (!focusable) { try { win.setFocusable(false) } catch { /* ignore */ } }
    } else {
      try { win.setOpacity(OPACITY) } catch { /* ignore */ }
      try { win.setIgnoreMouseEvents(true) } catch { /* ignore */ }
      try { win.setAlwaysOnTop(true, 'floating') } catch { /* ignore */ }
      try { win.setVisibleOnAllWorkspaces(true) } catch { /* ignore */ }
    }
    win.on('focus', () => {
      if (emitting) return
      stats.realKey++
      focused = win // the OS made it key: keep the virtual state truthful
    })
    win.on('enter-full-screen', () => { if (!emitting) stats.fullScreen++ })
    win.on('closed', () => { if (focused === win) focused = null })
  }

  const protos = [BaseWindow.prototype, BrowserWindow.prototype]
  const patch = (name, make) => {
    for (const proto of protos) {
      if (proto !== BaseWindow.prototype && !Object.prototype.hasOwnProperty.call(proto, name)) continue
      proto[name] = make(proto[name])
    }
  }

  // --- focus (both modes)
  patch('focus', () => function hiddenFocus() {
    if (!live(this)) return
    prepare(this)
    stats.virtualFocus++
    setVirtualFocus(this)
  })
  patch('isFocused', () => function hiddenIsFocused() { return live(this) && focused === this })
  const focusedOf = (Type) => () => (live(focused) && focused instanceof Type ? focused : null)
  BrowserWindow.getFocusedWindow = focusedOf(BrowserWindow)

  if (!v2) {
    patch('show', () => function hiddenShow() {
      prepare(this)
      if (!native.isVisible.call(this)) stats.shown++
      const result = native.showInactive.call(this)
      // a shown window becomes "focused" for the app's logic, like a real show() would
      setVirtualFocus(this)
      return result
    })
    patch('showInactive', () => function hiddenShowInactive() {
      prepare(this)
      if (!native.isVisible.call(this)) stats.shown++
      return native.showInactive.call(this)
    })
  } else {
    BaseWindow.getFocusedWindow = focusedOf(BaseWindow)
    const virtualShow = (activate) => function virtualShow() {
      if (!live(this)) return
      prepare(this)
      const s = vstate(this)
      if (s.minimized) { s.minimized = false; emit(this, 'restore') }
      if (!s.visible) { s.visible = true; stats.shown++; emit(this, 'show') }
      applyToWindow(this)
      if (activate) setVirtualFocus(this)
    }
    patch('show', () => virtualShow(true))
    patch('showInactive', () => virtualShow(false))
    patch('hide', () => function virtualHide() {
      if (!live(this)) return
      const s = vstate(this)
      if (!s.visible) return
      s.visible = false
      if (focused === this) setVirtualFocus(null)
      emit(this, 'hide')
    })
    patch('isVisible', () => function virtualIsVisible() { return live(this) && vstate(this).visible && !vstate(this).minimized })
    patch('maximize', () => function virtualMaximize() {
      if (!live(this)) return
      prepare(this)
      stats.blocked.maximize++
      const s = vstate(this)
      if (s.maximized) return
      s.restoreBounds = this.getBounds()
      try { this.setBounds(screen.getDisplayMatching(s.restoreBounds).workArea) } catch { /* ignore */ }
      s.maximized = true
      emit(this, 'maximize')
      if (!s.visible) { s.visible = true; stats.shown++; emit(this, 'show') } // maximize() shows a hidden window
    })
    patch('unmaximize', () => function virtualUnmaximize() {
      if (!live(this)) return
      const s = vstate(this)
      if (!s.maximized) return
      s.maximized = false
      if (s.restoreBounds) { try { this.setBounds(s.restoreBounds) } catch { /* ignore */ } }
      emit(this, 'unmaximize')
    })
    patch('isMaximized', () => function virtualIsMaximized() { return live(this) && vstate(this).maximized })
    patch('minimize', () => function virtualMinimize() {
      if (!live(this)) return
      stats.blocked.minimize++
      const s = vstate(this)
      if (s.minimized) return
      s.minimized = true
      if (focused === this) setVirtualFocus(null)
      emit(this, 'minimize')
    })
    patch('restore', () => function virtualRestore() {
      if (!live(this)) return
      stats.blocked.restore++
      const s = vstate(this)
      if (s.minimized) { s.minimized = false; emit(this, 'restore') }
      if (!s.visible) { s.visible = true; stats.shown++; emit(this, 'show') }
    })
    patch('isMinimized', () => function virtualIsMinimized() { return live(this) && vstate(this).minimized })
    patch('setFullScreen', () => function virtualSetFullScreen(flag) {
      if (!live(this)) return
      stats.blocked.fullScreen++
      const s = vstate(this)
      if (Boolean(flag) === s.fullScreen) return
      s.fullScreen = Boolean(flag)
      emit(this, s.fullScreen ? 'enter-full-screen' : 'leave-full-screen')
    })
    patch('isFullScreen', () => function virtualIsFullScreen() { return live(this) && vstate(this).fullScreen })

    // Keep the never-shown windows' web contents rendering. setBackgroundThrottling(false) also tells
    // a renderer Chromium already hid (its window was never shown) that it's shown again, and a
    // navigation can bring a fresh, hidden renderer widget, so it's re-applied when a view is
    // attached or made visible, when its window is (virtually) shown, and after each page load.
    const original = new WeakMap() // webContents -> its own backgroundThrottling setting
    const attached = new WeakSet()
    const watched = new WeakSet()
    const onScreen = (view) => { try { return attached.has(view) && view.getVisible() } catch { return false } }
    const applyTo = (view) => {
      const contents = view?.webContents
      if (!contents || contents.isDestroyed()) return
      try {
        if (!original.has(contents)) original.set(contents, typeof contents.getBackgroundThrottling === 'function' ? contents.getBackgroundThrottling() : true)
        if (throttle === 'all' || onScreen(view)) {
          // true then false: a widget content left "shown" (it swallowed the hide) but whose page is
          // hidden is hidden properly first, then un-hidden into painting (kHiddenButPainting)
          if (contents.getBackgroundThrottling() === false) contents.setBackgroundThrottling(true)
          contents.setBackgroundThrottling(false)
          stats.unthrottled++
        } else if (contents.getBackgroundThrottling() !== original.get(contents)) {
          contents.setBackgroundThrottling(original.get(contents)) // detached/hidden: throttled like in a shown window
        }
        if (!watched.has(contents)) {
          watched.add(contents)
          const again = () => { if (!contents.isDestroyed() && (throttle === 'all' || onScreen(view))) applyTo(view) }
          contents.on('did-finish-load', again)
          contents.on('dom-ready', again)
        }
      } catch { /* ignore */ }
    }
    applyToWindow = (win) => {
      try { for (const view of win.contentView.children) if (view.webContents) applyTo(view) } catch { /* ignore */ }
    }
    if (throttle === 'all') {
      app.on('web-contents-created', (_event, contents) => { try { contents.setBackgroundThrottling(false) } catch { /* ignore */ } })
    }
    const addChildView = View.prototype.addChildView
    View.prototype.addChildView = function hiddenAddChildView(view, ...rest) {
      for (const win of BaseWindow.getAllWindows()) prepare(win) // BaseWindow has no 'created' event
      const result = addChildView.call(this, view, ...rest)
      if (view?.webContents) { attached.add(view); applyTo(view) }
      return result
    }
    const removeChildView = View.prototype.removeChildView
    View.prototype.removeChildView = function hiddenRemoveChildView(view, ...rest) {
      const result = removeChildView.call(this, view, ...rest)
      if (view?.webContents) { attached.delete(view); applyTo(view) }
      return result
    }
    const setVisible = View.prototype.setVisible
    View.prototype.setVisible = function hiddenSetVisible(...args) {
      const result = setVisible.apply(this, args)
      if (this.webContents) applyTo(this)
      return result
    }
  }

  app.focus = () => { stats.blocked.appFocus++ }
  app.show = () => { stats.blocked.appShow++ }
  app.on('did-become-active', () => { stats.activations++ })
  // BrowserWindows created with the default show: true (e.g. a window.open popup)
  app.on('browser-window-created', (_event, win) => {
    prepare(win)
    if (v2 && native.isVisible.call(win)) {
      // it was ordered in by its constructor: take it straight back off screen, it counts below
      try { native.hide.call(win) } catch { /* ignore */ }
      vstate(win).visible = true
    }
  })

  // Monitor: what the OS actually sees (native isVisible / isFocused), sampled.
  const monitor = setInterval(() => {
    stats.polls++
    let visible = false
    let key = false
    for (const win of BaseWindow.getAllWindows()) {
      if (!live(win)) continue
      prepare(win)
      try {
        if (native.isVisible.call(win)) {
          visible = true
          if (!everVisible.has(win)) { everVisible.add(win); stats.nativeVisibleWindows++ }
        }
        if (native.isFocused.call(win)) key = true
      } catch { /* ignore */ }
    }
    if (visible) stats.nativeVisibleSamples++
    if (key) stats.nativeFocusedSamples++
  }, POLL_MS)
  monitor.unref?.()

  // Frame probe (smokes only, not perf): requestAnimationFrame rate of each view in the first window,
  // a few seconds in and again later. A hidden window Chromium stops painting shows 0/s here.
  const probes = []
  const probeFrames = !process.env.PERF_APP_DIR && process.env.SURFFISH_SMOKE_HIDDEN_PROBE !== '0'
  const wait = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.() })
  const RAF_1S = 'new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n) }; requestAnimationFrame(f) })'
  async function frameProbe(label) {
    const win = BaseWindow.getAllWindows().find(live)
    if (!win) return
    const results = await Promise.all(win.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed()).map(async (view) => {
      const contents = view.webContents
      let name = '?'
      try { const url = new URL(contents.getURL()); name = url.searchParams.get('surface') || url.host || url.protocol } catch { /* ignore */ }
      const frames = await Promise.race([contents.executeJavaScript(RAF_1S), wait(2500).then(() => 0)]).catch(() => -1)
      let shape = ''
      try { const b = view.getBounds(); shape = `${view.getVisible() ? '' : ' hidden-view'}${b.width && b.height ? '' : ' 0-size'}` } catch { /* ignore */ }
      return `${name}${shape} ${frames}/s`
    }))
    probes.push(`${label}: ${results.join(', ') || 'no views'}`)
  }
  if (probeFrames) {
    app.whenReady().then(async () => {
      await wait(4000)
      await frameProbe('4s').catch(() => {})
      await wait(12000)
      await frameProbe('17s').catch(() => {})
    })
  }

  process.once('exit', () => {
    const stole = stats.activations > 0 || stats.fullScreen > 0
    const onScreen = stats.nativeVisibleWindows > 0
    let line
    if (v2) {
      line = `[smoke-hidden] v2 (never shown, throttle=${throttle}${focusable ? ', focusable' : ''}): ${stats.shown} virtual show(s), ` +
        `${stats.virtualFocus} virtual focus call(s), ${stats.unthrottled} webContents unthrottled; ` +
        `native: on screen in ${stats.nativeVisibleSamples}/${stats.polls} samples (${stats.nativeVisibleWindows} window(s)), ` +
        `key in ${stats.nativeFocusedSamples}/${stats.polls}, became key ${stats.realKey}x, app activated ${stats.activations}x, full screen ${stats.fullScreen}x` +
        (stole ? ' -> STOLE FOCUS' : onScreen ? ' -> A WINDOW WAS ON SCREEN' : ' -> never on screen, never took focus')
    } else {
      line = `[smoke-hidden] ${stats.shown} window show(s) (inactive, opacity ${OPACITY}, click-through, floating), ` +
        `${stats.virtualFocus} virtual focus call(s), app.focus blocked ${stats.blocked.appFocus}x, app.show blocked ${stats.blocked.appShow}x; ` +
        `app activated ${stats.activations}x, full screen entered ${stats.fullScreen}x, a window became key inside the (inactive) app ${stats.realKey}x` +
        `; native: visible in ${stats.nativeVisibleSamples}/${stats.polls} samples, key in ${stats.nativeFocusedSamples}/${stats.polls}` +
        (stole ? ' -> STOLE FOCUS' : ' -> never took focus')
    }
    try {
      process.stderr.write(`${stole && process.env.GITHUB_ACTIONS ? '::warning::' : ''}${line}\n`)
      if (probes.length) process.stderr.write(`[smoke-hidden] frames (rAF/s per view): ${probes.join(' | ')}\n`)
      process.stderr.write(`[smoke-hidden-json] ${JSON.stringify({ ...stats, stole, onScreen, frames: probes })}\n`)
    } catch { /* ignore */ }
  })
}

if (mode) install()

module.exports = { enabled: mode > 0, mode, hiddenMode, throttleMode }
