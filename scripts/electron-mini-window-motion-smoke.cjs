// Motion smoke for mini windows (real pointer under Xvfb), against the production build. Every
// BaseWindow.setBounds call is traced (time, window, rect) while the windows move, then:
//   1. Stack group slide-out (handle click) and tuck: each window steps at the frame rate (p95 gap),
//      every window of the group moves in the same tick (skew), one setBounds per window per tick.
//   2. Peek slide-out: same.
//   3. Dragging the leader by its floating header: the panel and the follower move in the same tick as
//      the window, coalesced to one move per frame.
//   4. Handle re-spread (two handles on one edge, one slides out): the other handle glides, not jumps.
// Prints the numbers (MOTION_OUT=<file> also writes them as JSON). SURFFISH_MOTION_REPORT=1 only
// reports (used to measure the old build); otherwise the thresholds below are asserted.
// `bun run build && bun run test:electron-mini-window-motion` (headless Linux: xvfb-run; needs xdotool).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { execFile, execFileSync } = require('node:child_process')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, screen, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const REPORT_ONLY = process.env.SURFFISH_MOTION_REPORT === '1'
const userData = join(tmpdir(), `surffish-mini-window-motion-smoke-${process.pid}`)
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><title>Motion ${n}</title><body style="margin:0;font:16px system-ui"><p>Motion ${n}</p><script>window.loadId = Math.random()</script></body>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const page = /^\/m(\d)$/.exec(path)
  const body = path === '/start' ? '<!doctype html><title>Start</title><p>start</p>' : page ? PAGE(Number(page[1])) : null
  response.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(body ?? 'not found')
})

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}
function pointerMove(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))])
}

// --- setBounds trace.
let trace = null
const realSetBounds = BaseWindow.prototype.setBounds
BaseWindow.prototype.setBounds = function setBounds(rect, ...rest) {
  if (!trace || this.isDestroyed()) return realSetBounds.call(this, rect, ...rest)
  const entry = { t: performance.now(), end: 0, id: this.id, rect: { ...rect } }
  trace.push(entry)
  try {
    return realSetBounds.call(this, rect, ...rest)
  } finally {
    entry.end = performance.now()
  }
}
const startTrace = () => { trace = [] }
const stopTrace = () => { const out = trace; trace = null; return out }

const pct = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
const round = (n) => Math.round(n * 10) / 10
/** Per window: its steps (setBounds that changed the rect), gaps between them, and calls that landed in the same ms burst. */
function analyse(events, ids) {
  const per = {}
  for (const id of ids) {
    const mine = events.filter((event) => event.id === id)
    const gaps = []
    let dupes = 0
    for (let i = 1; i < mine.length; i++) {
      const gap = mine[i].t - mine[i - 1].t
      if (gap < 2) dupes++
      else gaps.push(gap)
    }
    per[id] = { steps: mine.length, gaps, dupes }
  }
  return per
}
/**
 * For each step of `lead`, how far the nearest step of `other` was, not counting time spent inside
 * setBounds calls in between (a same-tick commit is back-to-back setBounds: ≈ 0; separate timers: up to a frame).
 */
function skew(events, lead, other) {
  const a = events.filter((event) => event.id === lead)
  const b = events.filter((event) => event.id === other)
  if (a.length === 0 || b.length === 0) return []
  const busy = (from, to) => events.filter((event) => event.t >= from && event.t < to).reduce((sum, event) => sum + (Math.min(event.end, to) - event.t), 0)
  return a.map((x) => Math.min(...b.map((y) => {
    const [first, second] = x.t <= y.t ? [x, y] : [y, x]
    return Math.max(0, second.t - first.t - busy(first.t, second.t))
  })))
}
const results = {}
function report(name, events, windows, extras = {}) {
  const ids = windows.map((entry) => entry.id)
  const per = analyse(events, ids)
  const row = { name }
  for (const entry of windows) {
    const data = per[entry.id]
    row[entry.label] = { steps: data.steps, p50: round(pct(data.gaps, 50)), p95: round(pct(data.gaps, 95)), max: round(pct(data.gaps, 100)), dupes: data.dupes }
  }
  for (const [label, [lead, other]] of Object.entries(extras)) {
    const values = skew(events, lead, other)
    row[label] = { p95: round(pct(values, 95)), max: round(pct(values, 100)) }
  }
  results[name] = row
  console.log(`MOTION ${JSON.stringify(row)}`)
  return row
}

const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const dataTitled = (title) => (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`)
const isHandlePage = dataTitled('Mini Window Handle')
const isMiniHeader = dataTitled('Mini Window')
const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const allWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed())
const miniWindows = () => allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()))
const handleWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Handle')
const visibleHandles = () => handleWindows().filter((win) => win.isVisible())
const panelWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Header')
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
const hostOf = (contents) => allWindows().find((win) => viewOf(win, contents))
const handlePage = (win) => win.contentView.children.find((view) => view.webContents && isHandlePage(view.webContents))?.webContents
const centre = (r) => ({ x: r.x + Math.floor(r.width / 2), y: r.y + Math.floor(r.height / 2) })

async function clickHandle(win) {
  const contents = handlePage(win)
  await waitFor(() => !contents.isLoading() && smoke.evaluate(contents, 'Boolean(window.miniWindow) && document.body.className.length > 0'), 'the handle page')
  const { width, height } = win.getContentBounds()
  const x = Math.floor(width / 2)
  const y = Math.floor(height / 2)
  contents.sendInputEvent({ type: 'mouseMove', x, y })
  contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`], activeIndex: 0 }))
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 200, grouping: 'stack', headerPlacement: 'float' }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => allWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 700 })
  const surface = (win, name) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && surfaceFor(view) === name)
  await waitFor(() => surface(mainWindow, 'content') && surface(mainWindow, 'toolbar'), 'the renderer surfaces')
  const toolbar = surface(mainWindow, 'toolbar').webContents
  const content = surface(mainWindow, 'content').webContents
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => smoke.evaluate(content, 'document.readyState === "complete" && Boolean(window.api)'), 'the content renderer')
  const tabs = () => smoke.evaluate(toolbar, 'window.api.browser.tabs.get()')
  const runCommand = (id) => smoke.evaluate(toolbar, `window.api.browser.commands.run(${JSON.stringify(id)})`)
  const update = (patch) => smoke.evaluate(content, `window.api.browser.miniWindow.update(${JSON.stringify(patch)})`)
  const wa = screen.getPrimaryDisplay().workArea
  const frameMs = 1000 / (screen.getPrimaryDisplay().displayFrequency || 60)
  const park = async () => {
    pointerMove(wa.x + 290, wa.y + 395)
    await delay(100)
    pointerMove(wa.x + 300, wa.y + 400)
    await delay(100)
  }
  await park()

  const pages = []
  for (const n of [1, 2]) {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/m${n}`)})`)
    const contents = await waitFor(() => pageContents((url, c) => url === `${origin}/m${n}` && !c.isLoading()), `page m${n}`)
    pages.push({ n, contents, id: (await tabs()).find((tab) => tab.url === `${origin}/m${n}`).id })
  }
  const miniWith = (entry) => miniWindows().find((win) => viewOf(win, entry.contents))
  const popOut = async (entry) => {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`)
    await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === entry.id, `m${entry.n} active`)
    await runCommand('miniWindow.popOut')
    const win = await waitFor(() => miniWith(entry), `mini m${entry.n}`)
    await waitFor(() => win.isVisible(), 'shown')
    return win
  }
  const [m1, m2] = pages
  const w1 = await popOut(m1)
  w1.setBounds({ x: wa.x + wa.width - 420 + 60, y: wa.y + 160, width: 420, height: 300 })
  await waitFor(() => !w1.isVisible() && visibleHandles().length === 1, 'm1 tucked')
  await delay(500)
  const w2 = await popOut(m2)
  w2.setBounds({ x: wa.x + wa.width - 420 + 60, y: wa.y + 520, width: 420, height: 300 })
  await waitFor(() => !w2.isVisible() && visibleHandles().length === 1, 'the stack tucked behind one handle')
  await delay(800)
  const handle = visibleHandles()[0]
  // The handle rides the group's leader (the first docked: m1).
  const stackLeader = () => w1
  const settle = () => delay(700)

  smoke.step('stack group slide-out and tuck')
  startTrace()
  await clickHandle(handle)
  await waitFor(() => w1.isVisible() && w2.isVisible(), 'the group out')
  await settle()
  const slideOut = report('group slide-out', stopTrace(), [{ id: w1.id, label: 'w1' }, { id: w2.id, label: 'w2' }, { id: handle.id, label: 'handle' }], { 'skew w1-w2': [w1.id, w2.id], 'skew lead-handle': [stackLeader().id, handle.id] })
  startTrace()
  await runCommand('miniWindow.toggle')
  await waitFor(() => !w1.isVisible() && !w2.isVisible(), 'the group tucked')
  await settle()
  const tuck = report('group tuck', stopTrace(), [{ id: w1.id, label: 'w1' }, { id: w2.id, label: 'w2' }], { 'skew w1-w2': [w1.id, w2.id] })

  smoke.step('peek slide-out')
  await delay(300)
  const hc = centre(handle.getBounds())
  startTrace()
  pointerMove(hc.x, hc.y - 4)
  await delay(40)
  pointerMove(hc.x, hc.y)
  await waitFor(() => w1.isVisible() && w2.isVisible(), 'peeked', 3000)
  await settle()
  const peek = report('peek slide-out', stopTrace(), [{ id: w1.id, label: 'w1' }, { id: w2.id, label: 'w2' }], { 'skew w1-w2': [w1.id, w2.id] })
  // Pin it out (click inside) for the drag.
  const leaderWin = [w1, w2].sort((a, b) => a.getBounds().y - b.getBounds().y)[0]
  const followerWin = leaderWin === w1 ? w2 : w1
  const lead = leaderWin === w1 ? m1 : m2
  lead.contents.sendInputEvent({ type: 'mouseDown', x: 100, y: 100, button: 'left', clickCount: 1 })
  lead.contents.sendInputEvent({ type: 'mouseUp', x: 100, y: 100, button: 'left', clickCount: 1 })
  await park()
  await delay(800)
  assert.ok(w1.isVisible() && w2.isVisible(), 'pinned out')

  smoke.step('drag the leader by its floating header')
  const lb = leaderWin.getContentBounds()
  pointerMove(lb.x + 150, lb.y + 8)
  lead.contents.sendInputEvent({ type: 'mouseMove', x: 150, y: 8 })
  const panel = await waitFor(() => panelWindows().find((win) => win.isVisible()), 'the floating header', 3000)
  const header = liveContents().find((contents) => isMiniHeader(contents) && hostOf(contents) === panel)
  const at = await smoke.evaluate(header, '(() => { const r = document.getElementById("where").getBoundingClientRect(); return { x: Math.round(r.x + 12), y: Math.round(r.y + r.height / 2) } })()')
  const pb = panel.getContentBounds()
  const start = { x: pb.x + at.x, y: pb.y + at.y }
  pointerMove(start.x, start.y)
  header.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y })
  await delay(100)
  header.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  await delay(100)
  startTrace()
  // ~250 px down in many small, fast pointer moves (faster than the frame rate).
  // One xdotool process (async: a blocking exec would stall main's own timers) moving every 4 ms.
  const glide = []
  for (let i = 1; i <= 60; i++) glide.push('mousemove', String(start.x), String(start.y + i * 4), 'sleep', '0.004')
  await new Promise((resolvePromise, reject) => execFile('xdotool', glide, (error) => (error ? reject(error) : resolvePromise())))
  await delay(150)
  const drag = report('header drag', stopTrace(), [{ id: leaderWin.id, label: 'leader' }, { id: panel.id, label: 'panel' }, { id: followerWin.id, label: 'follower' }], { 'skew leader-panel': [leaderWin.id, panel.id], 'skew leader-follower': [leaderWin.id, followerWin.id] })
  header.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  await park()
  await delay(900)

  smoke.step('handle re-spread')
  assert.equal((await update({ grouping: 'separate' })).ok, true)
  await delay(500)
  await runCommand('miniWindow.toggle')
  await waitFor(() => !w1.isVisible() && !w2.isVisible() && visibleHandles().length === 2, 'two handles on the edge')
  await delay(800)
  // Slide m2 out and drop it back past the edge just above m1: the handles would overlap, so m1's makes room.
  const edgeX = wa.x + wa.width
  const onEdge = (win) => win.getBounds().x + win.getBounds().width === edgeX
  const handleOf = (win) => visibleHandles().filter(onEdge).sort((a, b) => Math.abs(centre(a.getBounds()).y - centre(win.getBounds()).y) - Math.abs(centre(b.getBounds()).y - centre(win.getBounds()).y))[0]
  await runCommand('miniWindow.toggle')
  await waitFor(() => w1.isVisible() && w2.isVisible(), 'both out')
  await delay(800)
  await runCommand('miniWindow.toggle')
  await waitFor(() => !w1.isVisible() && !w2.isVisible(), 'both tucked again')
  await delay(800)
  const h1 = handleOf(w1)
  const before = h1.getBounds()
  // m2 out on its own (its handle click), then dropped back right next to m1.
  await clickHandle(handleOf(w2))
  await waitFor(() => w2.isVisible() && !w1.isVisible(), 'm2 out')
  await delay(800)
  startTrace()
  w2.setBounds({ x: edgeX - 420 + 60, y: w1.getBounds().y - 20, width: 420, height: 300 })
  await waitFor(() => !w2.isVisible(), 'm2 tucked just above m1')
  await settle()
  const respread = report('handle re-spread', stopTrace(), [{ id: h1.id, label: 'other handle' }])
  assert.notDeepEqual(h1.getBounds(), before, 'm1\'s handle moved to make room')

  console.log(`MOTION frame ${round(frameMs)} ms`)
  if (process.env.MOTION_OUT) writeFileSync(process.env.MOTION_OUT, JSON.stringify({ frameMs, results }, null, 2))

  if (!REPORT_ONLY) {
    const budget = frameMs * 1.75
    for (const [name, row, labels] of [['group slide-out', slideOut, ['w1', 'w2']], ['group tuck', tuck, ['w1', 'w2']], ['peek', peek, ['w1', 'w2']], ['drag', drag, ['leader', 'panel', 'follower']]]) {
      for (const label of labels) {
        assert.ok(row[label].steps >= 4, `${name}: ${label} animated (${row[label].steps} steps)`)
        assert.ok(row[label].p95 <= budget, `${name}: ${label} p95 gap ${row[label].p95} ms <= ${round(budget)} ms`)
        assert.equal(row[label].dupes, 0, `${name}: ${label} one setBounds per tick`)
      }
    }
    for (const [name, row] of [['group slide-out', slideOut], ['group tuck', tuck], ['peek', peek], ['drag', drag]]) {
      for (const [key, value] of Object.entries(row)) if (key.startsWith('skew')) assert.ok(value.p95 <= 2, `${name}: ${key} same tick (p95 ${value.p95} ms)`)
    }
    assert.ok(respread['other handle'].steps >= 4, `the other handle glides to its new place (${respread['other handle'].steps} steps)`)
  }

  await runCommand('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0, 'all closed')
  console.log('Electron mini window motion smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window motion smoke failed:', error)
  app.exit(1)
})
