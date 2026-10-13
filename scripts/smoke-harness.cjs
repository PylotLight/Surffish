// Shared setup for the Electron smoke scripts. Require it first, before the app is imported:
//   const smoke = require('./smoke-harness.cjs')
// It only ever runs inside a smoke (never in the app), and does three things:
//   1. A hard overall timeout, so a smoke stuck on a hung renderer or a promise that never settles
//      fails fast with a useful message instead of eating the CI job budget.
//   2. Smoke-only Chromium switches that cut known-harmless log noise on the Linux CI runners
//      (smoke-chromium-args.cjs).
//   3. The file name + filter config for the pre-seeded adblock engine, so the app accepts it as its
//      cache and a smoke never downloads the real filter lists from the internet at launch.
'use strict'

const childProcess = require('node:child_process')
const { basename } = require('node:path')
const { app, BaseWindow } = require('electron')
const { smokeChromiumArgs } = require('./smoke-chromium-args.cjs')
// SURFFISH_SMOKE_HIDDEN=1 (Mac CI only): windows never show or take focus (no-op when unset)
require('./smoke-hidden.cjs')

/** Per-wait budget the smokes already honour (CI sets 90s for software rendering under xvfb). */
const waitMs = Number(process.env.SMOKE_WAIT_MS) || 20000
/** Whole-script budget: SMOKE_TIMEOUT_MS, else 4 waits (min 4 min). CI: 4 × 90s = 6 min. */
const overallMs = Number(process.env.SMOKE_TIMEOUT_MS) || Math.max(4 * waitMs, 240000)
const script = basename(process.argv.slice(1).find((arg) => !arg.startsWith('-') && /\.[cm]?[jt]s$/.test(arg)) ?? 'smoke')
const startedAt = Date.now()
const children = new Set()
let lastOutput = ''
let finished = false

// Remember the last line the smoke printed, so a timeout can say how far it got.
for (const method of ['log', 'error', 'warn']) {
  const original = console[method].bind(console)
  console[method] = (...args) => {
    const line = args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : String(arg))).join(' ').trim()
    if (line) lastOutput = line.split('\n')[0].slice(0, 300)
    original(...args)
  }
}

// Track child processes (e.g. a relaunch phase) so a timeout takes them down too.
for (const method of ['spawn', 'execFile']) {
  const original = childProcess[method]
  childProcess[method] = function trackedChild(...args) {
    const child = original.apply(this, args)
    children.add(child)
    child.once('exit', () => children.delete(child))
    return child
  }
}

function windowSummary() {
  try {
    return BaseWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win, index) => {
        const urls = win.contentView.children
          .filter((view) => view.webContents && !view.webContents.isDestroyed())
          .map((view) => {
            const contents = view.webContents
            const url = contents.getURL()
            const surface = /[?&]surface=([a-z-]+)/.exec(url)?.[1]
            return `${surface ?? url.slice(0, 80)}${contents.isCrashed() ? ' (crashed)' : ''}`
          })
        return `window ${index + 1}: ${urls.join(', ') || 'no views'}`
      })
      .join('; ') || 'no windows'
  } catch (error) {
    return `windows unavailable (${error.message})`
  }
}

const watchdog = setTimeout(() => {
  const seconds = Math.round((Date.now() - startedAt) / 1000)
  process.stderr.write(
    `\n${script} TIMED OUT after ${seconds}s (hard limit SMOKE_TIMEOUT_MS=${overallMs}, per-wait SMOKE_WAIT_MS=${waitMs}).\n` +
    `  last output: ${lastOutput || '(none)'}\n` +
    `  open: ${windowSummary()}\n` +
    '  A renderer or promise never settled; failing instead of hanging.\n'
  )
  for (const child of children) {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
  process.exit(124)
}, overallMs)
watchdog.unref()

// app.exit() can stall behind a hung child process; make sure the result still lands.
const originalExit = app.exit.bind(app)
app.exit = (code = 0) => {
  if (!finished) {
    finished = true
    clearTimeout(watchdog)
    setTimeout(() => process.exit(code), 10000).unref()
  }
  originalExit(code)
}

// Smoke-only switches against the per-renderer "Failed to adjust OOM score" log spam on Linux
// (see smoke-chromium-args.cjs). --no-zygote is read per renderer launch, so appending it here works.
for (const arg of smokeChromiumArgs(process.argv)) app.commandLine.appendSwitch(arg.slice(2))

const { ADBLOCK_CACHE_FILE, ADBLOCK_CONFIG } = require('./smoke-adblock-config.cjs')

module.exports = { ADBLOCK_CACHE_FILE, ADBLOCK_CONFIG, overallMs, waitMs }
