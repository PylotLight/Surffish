// Hidden smoke mode for the self-hosted Mac CI runner (someone's laptop, in use while CI runs).
// SURFFISH_SMOKE_HIDDEN=1 (set by the Mac smoke + perf jobs only) makes a smoke or perf run stay out of
// the user's way. Required by smoke-harness.cjs and scripts/perf/bench.cjs before the app is imported,
// so it never ships in the app and the perf base build gets exactly the same treatment as the PR.
// Unset: this module does nothing.
//
// What it does (macOS only; elsewhere it's a no-op, the Linux lanes run under xvfb anyway):
//   - app.setActivationPolicy('accessory'): no Dock icon, not in Cmd+Tab, no menu bar takeover
//   - win.show() becomes showInactive(), and every shown window is near-invisible (opacity 0.01) and
//     click-through, so it keeps its real size/position and keeps rendering, but nobody sees or hits it.
//     It also floats above other apps' windows on every Space: an inactive app's window ends up behind
//     the user's windows, macOS then treats it as occluded (no vsync, ~1 frame/s: tab switch to painted
//     went 22 ms -> 1014 ms on the runner) and can App Nap the process, so prevent-app-suspension is held
//   - win.focus(), app.focus() (incl. { steal: true }) and app.show() never touch the OS. Window focus
//     is virtual instead: focus() marks that window focused, emits its 'focus' event (and 'blur' on the
//     previous one), and isFocused() / BrowserWindow.getFocusedWindow() answer from that, so the app's
//     "current window" logic and the smokes still check real behaviour
//   - occlusion doesn't background the windows (an invisible window counts as occluded on macOS), so
//     pages keep painting like a visible window; background tab throttling is untouched
// At exit it prints whether the app was ever activated or went full screen (what would still steal focus),
// and how often a window became key inside the inactive app (webContents.focus() does that natively; an
// inactive app's key window doesn't take the keyboard from the user's app).
'use strict'

const OPACITY = 0.01
const enabled = process.env.SURFFISH_SMOKE_HIDDEN === '1' && process.platform === 'darwin'

function install() {
  const { app, BaseWindow, BrowserWindow } = require('electron')
  const stats = { shown: 0, virtualFocus: 0, realKey: 0, activations: 0, fullScreen: 0, blocked: { appFocus: 0, appShow: 0 } }
  const prepared = new WeakSet()
  let focused = null
  let emitting = false

  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  const accessory = () => { try { app.setActivationPolicy('accessory') } catch { /* not available yet */ } }
  accessory()
  app.whenReady().then(() => {
    accessory()
    try { app.dock?.hide() } catch { /* ignore */ }
    try { require('electron').powerSaveBlocker.start('prevent-app-suspension') } catch { /* ignore */ }
  })

  const live = (win) => win && !win.isDestroyed()
  function setVirtualFocus(win) {
    if (focused === win) return
    const previous = focused
    focused = win
    emitting = true
    try {
      if (live(previous)) previous.emit('blur')
      if (live(win)) win.emit('focus')
    } finally { emitting = false }
  }

  function prepare(win) {
    if (prepared.has(win) || !live(win)) return
    prepared.add(win)
    try { win.setOpacity(OPACITY) } catch { /* ignore */ }
    try { win.setIgnoreMouseEvents(true) } catch { /* ignore */ }
    try { win.setAlwaysOnTop(true, 'floating') } catch { /* ignore */ }
    try { win.setVisibleOnAllWorkspaces(true) } catch { /* ignore */ }
    win.on('focus', () => {
      if (emitting) return
      stats.realKey++
      focused = win // the OS made it key: keep the virtual state truthful
    })
    win.on('enter-full-screen', () => { stats.fullScreen++ })
    win.on('closed', () => { if (focused === win) focused = null })
  }

  for (const proto of [BaseWindow.prototype, BrowserWindow.prototype]) {
    for (const name of ['show', 'showInactive', 'focus', 'isFocused']) {
      if (!Object.prototype.hasOwnProperty.call(proto, name)) continue
      if (name === 'show' || name === 'showInactive') {
        const showInactive = Object.prototype.hasOwnProperty.call(proto, 'showInactive') ? proto.showInactive : BaseWindow.prototype.showInactive
        proto[name] = function hiddenShow() {
          prepare(this)
          if (!this.isVisible()) stats.shown++
          const result = showInactive.call(this)
          // a shown window becomes "focused" for the app's logic, like a real show() would
          if (name === 'show') setVirtualFocus(this)
          return result
        }
      } else if (name === 'focus') {
        proto.focus = function hiddenFocus() {
          if (!live(this)) return
          stats.virtualFocus++
          setVirtualFocus(this)
        }
      } else {
        proto.isFocused = function hiddenIsFocused() {
          return live(this) && focused === this
        }
      }
    }
  }
  if (BrowserWindow) {
    BrowserWindow.getFocusedWindow = () => (live(focused) && focused instanceof BrowserWindow ? focused : null)
  }

  {
    app.focus = () => { stats.blocked.appFocus++ }
    app.show = () => { stats.blocked.appShow++ }
    app.on('did-become-active', () => { stats.activations++ })
    // BrowserWindows created with the default show: true (e.g. a window.open popup)
    app.on('browser-window-created', (_event, win) => { prepare(win) })
  }

  process.once('exit', () => {
    const stole = stats.activations > 0 || stats.fullScreen > 0
    const line = `[smoke-hidden] ${stats.shown} window show(s) (inactive, opacity ${OPACITY}, click-through, floating), ` +
      `${stats.virtualFocus} virtual focus call(s), app.focus blocked ${stats.blocked.appFocus}x, app.show blocked ${stats.blocked.appShow}x; ` +
      `app activated ${stats.activations}x, full screen entered ${stats.fullScreen}x, a window became key inside the (inactive) app ${stats.realKey}x` +
      (stole ? ' -> STOLE FOCUS' : ' -> never took focus')
    try { process.stderr.write(`${stole && process.env.GITHUB_ACTIONS ? '::warning::' : ''}${line}\n`) } catch { /* ignore */ }
  })
}

if (enabled) install()

module.exports = { enabled }
