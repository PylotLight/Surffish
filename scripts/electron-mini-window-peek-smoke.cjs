// Integration smoke for hover peek on a tucked mini window, against the production build (real pointer):
//   1. Settings saved before hover peek defaulted on (peekOnHover: false, no delay) migrate to on, 350 ms.
//   2. Tucked to the right edge: the pointer resting on the handle peeks the window out after the delay
//      (not before); a quick pass over the handle never peeks.
//   3. Peeked: it stays while the pointer is on the window (and on its floating header panel); with the
//      pointer away for the grace period it tucks back in. Audio keeps playing throughout.
//   4. A mousedown inside the peeked page pins it out (pointer away, it stays); the toggle tucks it again.
//      Clicking the handle still slides it out / tucks it.
//   5. The hover delay setting applies live (1 s: nothing at 600 ms, out after 1 s).
//   6. Setting off (⌘K command): resting on the handle never peeks; back on (Settings) peeks again.
//   7. Stack: two windows tucked to the same edge share one handle and peek out together.
// `bun run build && bun run test:electron-mini-window-peek`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-peek-smoke.cjs`; needs xdotool).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, screen, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-mini-window-peek-smoke-${process.pid}`)
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><title>Peek ${n}</title>
<style>body{font:16px system-ui;margin:0;height:2000px}</style><body><p>Peek ${n}</p>
<script>window.loadId = Math.random()
window.startAudio = async () => { try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0.0001; osc.connect(gain).connect(ctx.destination); osc.start(); await ctx.resume(); window.tone = ctx; return ctx.state === 'running' } catch (error) { return String(error) } }
</script></body>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const page = /^\/p(\d)$/.exec(path)
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

/** Stays true for `ms` (polling). */
async function holds(predicate, description, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    assert.ok(await predicate(), description)
    await delay(25)
  }
}

function pointerMove(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))])
}

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const dataTitled = (title) => (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`)
const isHandlePage = dataTitled('Mini Window Handle')
const isMiniHeader = dataTitled('Mini Window')
const allWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed())
const miniWindows = () => allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()))
const handleWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Handle')
const visibleHandles = () => handleWindows().filter((win) => win.isVisible())
const panelWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Header')
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
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
  // v0.1.15-format settings: peek was off by default and written on every save, no delay yet.
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: false, grouping: 'separate', headerPlacement: 'float' }))

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
  const command = async (id) => (await smoke.evaluate(toolbar, 'window.api.browser.commands.list()')).commands.find((entry) => entry.id === id)
  const settings = async () => (await smoke.evaluate(content, 'window.api.browser.miniWindow.getSettings()')).settings
  const update = (patch) => smoke.evaluate(content, `window.api.browser.miniWindow.update(${JSON.stringify(patch)})`)
  const wa = screen.getPrimaryDisplay().workArea
  // Somewhere on the browser window, clear of every mini window. Two hops: under Xvfb the first warp
  // after the pointer left a frameless window can go unseen, leaving Electron's cursor point stale.
  const park = async () => {
    pointerMove(wa.x + 290, wa.y + 395)
    await delay(100)
    pointerMove(wa.x + 300, wa.y + 400)
    await delay(100)
  }
  /** Rest the real pointer on the middle of the handle (a couple of tiny moves so it registers as hovering). */
  const restOn = async (handle) => {
    const c = centre(handle.getBounds())
    pointerMove(c.x - 1, c.y - 6)
    await delay(40)
    pointerMove(c.x, c.y - 5)
    await delay(40)
    pointerMove(c.x, c.y)
    return Date.now()
  }
  await park()

  const pages = []
  for (const n of [1, 2]) {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/p${n}`)})`)
    const contents = await waitFor(() => pageContents((url, c) => url === `${origin}/p${n}` && !c.isLoading()), `page p${n}`)
    await waitFor(() => smoke.evaluate(contents, 'document.readyState === "complete" && typeof window.loadId === "number"'), `page p${n} ready`)
    pages.push({ n, contents, loadId: await smoke.evaluate(contents, 'window.loadId'), id: (await tabs()).find((tab) => tab.url === `${origin}/p${n}`).id })
  }
  const [p1, p2] = pages
  const intact = async (where, entries = [p1]) => {
    for (const entry of entries) {
      assert.equal(entry.contents.isDestroyed(), false, `${where}: p${entry.n} alive`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.loadId'), entry.loadId, `${where}: p${entry.n} not reloaded`)
    }
  }
  const popOut = async (entry) => {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`)
    await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === entry.id, `p${entry.n} active`)
    await runCommand('miniWindow.popOut')
  }
  const miniWith = (entry) => miniWindows().find((win) => viewOf(win, entry.contents))

  // --- 1. Migration.
  smoke.step('v0.1.15 settings migrate to hover peek on, 350 ms')
  const migrated = await settings()
  assert.equal(migrated.peekOnHover, true, 'peek on after migration')
  assert.equal(migrated.peekDelayMs, 350, 'default delay')
  assert.equal((await command('miniWindow.togglePeek'))?.title, 'Turn Off Mini Window Peek on Hover', 'the palette offers to turn it off')

  // --- 2. Tuck, rest on the handle → peek after the delay; a pass over → nothing.
  smoke.step('tucked: resting on the handle peeks after the delay; a quick pass over does not')
  await popOut(p1)
  const w1 = await waitFor(() => miniWith(p1), 'the mini window')
  await waitFor(() => w1.isVisible(), 'shown')
  const size = { width: 420, height: 400 }
  w1.setBounds({ x: wa.x + wa.width - size.width + 60, y: wa.y + 250, ...size })
  const handle = await waitFor(() => handleWindows()[0], 'the handle')
  await waitFor(() => !w1.isVisible() && handle.isVisible(), 'tucked to the right edge')
  await waitFor(() => !handlePage(handle).isLoading() && smoke.evaluate(handlePage(handle), 'document.body.className === "right"'), 'the handle page')
  await delay(600)
  const played = await p1.contents.executeJavaScript('window.startAudio()', true)
  const audioChecked = played === true
  if (!audioChecked) smoke.step(`note: no audio playback here (${played}); skipping the audio check`)
  const audioRunning = async () => !audioChecked || await smoke.evaluate(p1.contents, 'window.tone.state === "running"')

  // Quick pass: across the handle in ~120 ms.
  const hb = handle.getBounds()
  for (let y = hb.y - 20; y <= hb.y + hb.height + 20; y += 15) {
    pointerMove(hb.x + Math.floor(hb.width / 2), y)
    await delay(15)
  }
  await park()
  await holds(() => !w1.isVisible(), 'a quick pass over the handle never peeks', 1200)

  const rested = await restOn(handle)
  await holds(() => !w1.isVisible(), 'not before the delay', 200)
  await waitFor(() => w1.isVisible(), 'peeked out after resting on the handle', 3000)
  const took = Date.now() - rested
  assert.ok(took >= 300, `peeked after the delay (${took} ms)`)
  await waitFor(() => w1.getBounds().x + w1.getBounds().width === wa.x + wa.width, 'slid out flush with the edge')
  assert.ok(await audioRunning(), 'audio still playing while peeked')

  // --- 3. Stays while the pointer is on the window / its floating header; away → tucks.
  smoke.step('peeked: stays while the pointer is on it (and its floating header), tucks once away')
  await delay(250)
  const out = w1.getBounds()
  pointerMove(out.x + 200, out.y + 200)
  await delay(40)
  pointerMove(out.x + 202, out.y + 210)
  await holds(() => w1.isVisible(), 'stays while the pointer is on the window', 1500)
  // Near the top: the floating header reveals above the window; on it, still out.
  pointerMove(out.x + 150, out.y + 8)
  p1.contents.sendInputEvent({ type: 'mouseMove', x: 150, y: 8 })
  const panel = await waitFor(() => panelWindows().find((win) => win.isVisible()), 'the floating header above the peeked window', 3000)
  const pb = panel.getBounds()
  pointerMove(pb.x + 60, pb.y + Math.floor(pb.height / 2))
  await holds(() => w1.isVisible(), 'stays while the pointer is on its floating header', 1200)
  await park()
  await waitFor(() => !w1.isVisible() && handle.isVisible(), 'tucked back in once the pointer left', 3000)
  assert.ok(await audioRunning(), 'audio still playing after tucking')
  await intact('peek and tuck')

  // --- 4. Mousedown inside pins it out.
  smoke.step('a mousedown inside the peeked window pins it out; the toggle tucks it again')
  await delay(500)
  await restOn(handle)
  await waitFor(() => w1.isVisible(), 'peeked again', 3000)
  await delay(300)
  const b = w1.getBounds()
  pointerMove(b.x + 200, b.y + 250)
  await delay(80)
  p1.contents.sendInputEvent({ type: 'mouseDown', x: 200, y: 250, button: 'left', clickCount: 1 })
  p1.contents.sendInputEvent({ type: 'mouseUp', x: 200, y: 250, button: 'left', clickCount: 1 })
  await delay(80)
  await park()
  await holds(() => w1.isVisible(), 'pinned: stays out with the pointer away', 1500)
  await runCommand('miniWindow.toggle')
  await waitFor(() => !w1.isVisible(), 'the toggle tucks it')
  // Clicking the handle still toggles.
  await delay(400)
  await clickHandle(handle)
  await waitFor(() => w1.isVisible(), 'a handle click slides it out')
  await delay(400)
  await holds(() => w1.isVisible(), 'and it stays out (not a peek)', 1000)
  await clickHandle(handle)
  await waitFor(() => !w1.isVisible(), 'a handle click tucks it')

  // --- 5. Hover delay, live.
  smoke.step('hover delay 1 s applies live')
  assert.equal((await update({ peekDelayMs: 1000 })).ok, true)
  assert.equal((await update({ peekDelayMs: 250 })).ok, false, 'only the offered delays')
  await delay(400)
  const restedLong = await restOn(handle)
  await holds(() => !w1.isVisible(), 'nothing at 600 ms', 600)
  await waitFor(() => w1.isVisible(), 'peeked after 1 s', 3000)
  assert.ok(Date.now() - restedLong >= 950, `waited the longer delay (${Date.now() - restedLong} ms)`)
  await park()
  await waitFor(() => !w1.isVisible(), 'tucked back', 3000)
  assert.equal((await update({ peekDelayMs: 350 })).ok, true)

  // --- 6. Off: no peek.
  smoke.step('turned off (palette): resting on the handle never peeks; back on peeks again')
  await runCommand('miniWindow.togglePeek')
  await waitFor(async () => (await settings()).peekOnHover === false, 'saved off')
  assert.equal((await command('miniWindow.togglePeek'))?.title, 'Turn On Mini Window Peek on Hover')
  await delay(300)
  await restOn(handle)
  await holds(() => !w1.isVisible(), 'no peek while off', 1500)
  await park()
  assert.equal((await update({ peekOnHover: true })).ok, true)
  await delay(300)
  await restOn(handle)
  await waitFor(() => w1.isVisible(), 'peeks again once back on', 3000)
  await park()
  await waitFor(() => !w1.isVisible(), 'tucked back', 3000)

  // --- 7. Stack: the group peeks together.
  smoke.step('stack: two windows tucked to one edge share a handle and peek out together')
  assert.equal((await update({ grouping: 'stack' })).ok, true)
  await popOut(p2)
  const w2 = await waitFor(() => { const win = miniWith(p2); return win && win !== w1 ? win : null }, 'the second mini window')
  await waitFor(() => w2.isVisible(), 'shown')
  w2.setBounds({ x: wa.x + wa.width - 360 + 60, y: wa.y + 150, width: 360, height: 300 })
  await waitFor(() => !w2.isVisible() && visibleHandles().length === 1, 'both tucked behind one handle')
  await delay(600)
  const shared = visibleHandles()[0]
  await waitFor(() => !handlePage(shared).isLoading() && smoke.evaluate(handlePage(shared), 'document.body.classList.contains("stacked")'), 'the stacked handle')
  await restOn(shared)
  await waitFor(() => w1.isVisible() && w2.isVisible(), 'the whole group peeked out', 3000)
  await delay(400)
  const s1 = w1.getBounds()
  const s2 = w2.getBounds()
  const lower = s1.y > s2.y ? s1 : s2
  // On the lower window (not the one under the handle): the group stays out.
  pointerMove(lower.x + 100, lower.y + lower.height - 40)
  await delay(40)
  pointerMove(lower.x + 104, lower.y + lower.height - 44)
  await holds(() => w1.isVisible() && w2.isVisible(), 'stays out while the pointer is on any window of the group', 1200)
  await park()
  await waitFor(() => !w1.isVisible() && !w2.isVisible(), 'the group tucked back together', 3000)
  await intact('stack peek', [p1, p2])

  smoke.step('Return All leaves nothing behind')
  await runCommand('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0 && panelWindows().length === 0, 'all closed')
  await waitFor(() => liveContents().filter((contents) => isHandlePage(contents) || isMiniHeader(contents)).length === 0, 'no handle or header webContents left', 5000)
  console.log('Electron mini window peek smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window peek smoke failed:', error)
  app.exit(1)
})
