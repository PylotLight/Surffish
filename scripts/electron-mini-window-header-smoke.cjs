// Integration smoke for Settings → Mini window header (where the auto-hiding header + tab strip show),
// against the production build:
//   1. Migration: #206-format settings (no headerPlacement) read as 'float'; the palette offers the others.
//   2. Float: the header lives in its own always-on-top panel touching the window's top edge (same x and
//      width), never over the page (page view = the whole window, page and header rects disjoint);
//      hovering the panel keeps it up, leaving hides it. Header buttons carry no native tooltip (hints
//      show in the title's place instead, so nothing drops over the tab strip).
//   3. Float with a tab strip (two tabs): the panel grows to fit it. Dragging the header (pointer) moves
//      the window and the panel stays attached. Near the top of the work area the panel flips below the
//      window (revealed from the bottom edge); a window as tall as the work area falls back to push.
//   4. Float: a tab dragged out of the floating strip but let go on its own panel stays; let go elsewhere
//      it splits off; dragging that window's floating header onto the collection's header band merges it
//      back (and its panel goes with it).
//   5. Push (live switch, palette): the panel closes, the header moves into the window (same header page,
//      no reload) and the page moves down under it (no overlap, scroll position kept, no bounce while the
//      pointer rests there).
//   6. Overlay: the header lies over the page's top (the original behaviour).
//   7. Float again: tucking hides the panel with the window; sliding out and revealing puts it back above.
//   8. Stack: dragging the leader by its floating header moves the rest of its group along the edge.
//   Also: a floating header dragged up into the menu bar band stops at the work area's top (never under the bar).
//   9. Return All leaves no mini window, panel, handle, or header/handle webContents behind.
// `bun run build && bun run test:electron-mini-window-header`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-header-smoke.cjs`; needs xdotool).
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

const userData = join(tmpdir(), `surffish-mini-window-header-smoke-${process.pid}`)
const COLORS = ['#2f6fed', '#e5484d', '#30a46c']
// A page with its own nav bar pinned to the top: what an overlaying header used to cover.
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><link rel="icon" href="/icon${n}.svg"><title>Head ${n}</title>
<style>body{font:16px system-ui;margin:0;height:4000px}#nav{position:fixed;top:0;left:0;right:0;height:40px;background:${COLORS[n - 1]};color:#fff}</style>
<body><div id="nav">nav ${n}</div><p style="margin-top:60px">Head ${n}</p><script>window.loadId = Math.random()</script></body>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const icon = /^\/icon(\d)\.svg$/.exec(path)
  if (icon) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${COLORS[Number(icon[1]) - 1]}"/></svg>`)
    return
  }
  const page = /^\/h(\d)$/.exec(path)
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
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}

// The real pointer (main polls it while revealed and while dragging by the header).
function pointerMove(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))])
}

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const dataTitled = (title) => (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`)
const isMiniHeader = dataTitled('Mini Window')
const isHandlePage = dataTitled('Mini Window Handle')
const allWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed())
const panelWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Header')
const visiblePanels = () => panelWindows().filter((win) => win.isVisible())
const miniWindows = () => allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()))
const handleWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Handle')
const visibleHandles = () => handleWindows().filter((win) => win.isVisible())
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
const hostOf = (contents) => allWindows().find((win) => viewOf(win, contents))
const handlePage = (win) => win.contentView.children.find((view) => view.webContents && isHandlePage(view.webContents))?.webContents
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const screenRect = (win, view) => {
  const content = win.getContentBounds()
  const bounds = view.getBounds()
  return { x: content.x + bounds.x, y: content.y + bounds.y, width: bounds.width, height: bounds.height }
}

function flushRight(bounds, wa) {
  return bounds.x + bounds.width === wa.x + wa.width
}

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
  // #206-format settings: grouping but no headerPlacement.
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: false, peekDelayMs: 350, grouping: 'tabs' }))

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
  const run = (id) => smoke.evaluate(toolbar, `window.api.browser.commands.run(${JSON.stringify(id)})`)
  const settings = async () => (await smoke.evaluate(content, 'window.api.browser.miniWindow.getSettings()')).settings
  const wa = screen.getPrimaryDisplay().workArea
  // Somewhere on the browser window's page, clear of every mini window and panel. Two hops: under Xvfb the
  // first warp after the pointer left a frameless window can go unseen, leaving Electron's cursor point stale.
  const park = () => {
    pointerMove(wa.x + 290, wa.y + 95)
    execFileSync('sleep', ['0.15'])
    pointerMove(wa.x + 300, wa.y + 100)
  }
  park()

  const pages = []
  for (const n of [1, 2, 3]) {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/h${n}`)})`)
    const contents = await waitFor(() => pageContents((url, c) => url === `${origin}/h${n}` && !c.isLoading()), `page h${n}`)
    await waitFor(() => smoke.evaluate(contents, 'document.readyState === "complete" && typeof window.loadId === "number"'), `page h${n} ready`)
    await smoke.evaluate(contents, `window.marker = "h${n}"; true`)
    pages.push({ n, contents, loadId: await smoke.evaluate(contents, 'window.loadId'), id: (await tabs()).find((tab) => tab.url === `${origin}/h${n}`).id })
  }
  const [h1, h2, h3] = pages
  const intact = async (where, entries = pages) => {
    for (const entry of entries) {
      assert.equal(entry.contents.isDestroyed(), false, `${where}: h${entry.n} alive`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.marker'), `h${entry.n}`, `${where}: h${entry.n} kept its state`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.loadId'), entry.loadId, `${where}: h${entry.n} not reloaded`)
    }
  }
  const popOut = async (entry) => {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`)
    await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === entry.id, `h${entry.n} active`)
    await run('miniWindow.popOut')
  }
  const miniWith = (entry) => miniWindows().find((win) => viewOf(win, entry.contents))
  /** The header page of the mini window `win` (its title is the window's active page's). */
  const headerOf = async (win) => {
    for (const contents of liveContents().filter(isMiniHeader)) {
      if (contents.isLoading()) continue
      const title = await smoke.evaluate(contents, 'document.getElementById("title").textContent')
      if (title && win.getTitle() === `${title} — Mini Window`) return contents
    }
    return null
  }
  /** Bring the header up the way a pointer does: on the page near the window's edge (top, or bottom when it floats below). */
  const reveal = (win, entry, edge = 'top', real = true) => {
    const b = win.getContentBounds()
    const y = edge === 'top' ? 10 : b.height - 10
    if (real) pointerMove(b.x + 120, b.y + y)
    entry.contents.sendInputEvent({ type: 'mouseMove', x: 120, y })
  }
  const pageRect = (win, entry) => screenRect(win, viewOf(win, entry.contents))
  /** Press the floating header's title area, move the real pointer to `to` (screen), let go. */
  const dragHeader = async (header, to) => {
    const panel = hostOf(header)
    assert.ok(panel && panel.getTitle() === 'Mini Window Header', 'dragging a floating header')
    const at = await smoke.evaluate(header, '(() => { const r = document.getElementById("where").getBoundingClientRect(); return { x: Math.round(r.x + 12), y: Math.round(r.y + r.height / 2) } })()')
    const pb = panel.getContentBounds()
    const start = { x: pb.x + at.x, y: pb.y + at.y }
    pointerMove(start.x, start.y)
    header.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y })
    await delay(100)
    header.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await delay(100)
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      pointerMove(start.x + ((to.x - start.x) * i) / steps, start.y + ((to.y - start.y) * i) / steps)
      await delay(40)
    }
    await delay(200)
    header.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    return { dx: to.x - start.x, dy: to.y - start.y }
  }

  // --- 1. Migration.
  smoke.step('#206 settings read as float; the palette offers push and overlay')
  assert.equal((await settings()).headerPlacement, 'float', 'migrated settings: float')
  const listed = (await smoke.evaluate(toolbar, 'window.api.browser.commands.list()')).commands
  assert.ok(listed.some((command) => command.id === 'miniWindow.header.push' && command.title === 'Mini Window Header: Push Content' && command.enabled !== false), 'the palette offers Push Content')
  assert.ok(listed.some((command) => command.id === 'miniWindow.header.overlay' && command.enabled !== false), 'the palette offers Overlay')
  assert.equal(listed.find((command) => command.id === 'miniWindow.header.float')?.enabled, false, 'the current placement is not offered')

  // --- 2. Float basics.
  smoke.step('float: the header shows in a panel above the window, never over the page')
  await popOut(h1)
  const w1 = await waitFor(() => miniWith(h1), 'the mini window')
  await waitFor(() => w1.isVisible(), 'shown')
  const home = { x: wa.x + 700, y: wa.y + 300, width: 420, height: 400 }
  w1.setBounds(home)
  await delay(600)
  const header = await waitFor(() => headerOf(w1), 'its header')
  const panel = await waitFor(() => { const host = hostOf(header); return host && host.getTitle() === 'Mini Window Header' ? host : null }, 'the header in its own panel')
  assert.equal(viewOf(w1, header), undefined, 'the header view is not in the mini window')
  assert.equal(await smoke.evaluate(header, 'document.body.classList.contains("floating")'), true, 'the header knows it floats')
  assert.equal(panel.isVisible(), false, 'hidden until revealed')
  assert.equal(panel.isAlwaysOnTop(), true, 'the panel is always on top like the window')
  assert.equal(panel.isFocusable(), false, 'the panel never takes focus')
  reveal(w1, h1)
  await waitFor(() => panel.isVisible(), 'the panel to reveal from the top edge')
  let wb = w1.getBounds()
  assert.deepEqual(panel.getBounds(), { x: wb.x, y: wb.y - 36, width: wb.width, height: 36 }, 'attached above the window, same x and width')
  assert.deepEqual(viewOf(w1, h1.contents).getBounds(), { x: 0, y: 0, width: wb.width, height: wb.height }, 'the page keeps the whole window')
  assert.ok(!intersects(panel.getBounds(), pageRect(w1, h1)), 'the header never covers the page')
  assert.equal(viewOf(panel, header).getBounds().height, 36, 'the header view fills the panel')
  smoke.step('float: hovering the panel keeps it up, leaving hides it; hints replace native tooltips')
  pointerMove(wb.x + 200, wb.y - 18)
  header.sendInputEvent({ type: 'mouseMove', x: 200, y: 18 })
  await delay(1500)
  assert.equal(panel.isVisible(), true, 'still shown while the pointer is on the panel')
  assert.equal(await smoke.evaluate(header, '[...document.querySelectorAll("header button")].every((button) => !button.title)'), true, 'no native tooltips on the header row')
  const returnAt = await smoke.evaluate(header, '(() => { const r = document.getElementById("return").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()')
  header.sendInputEvent({ type: 'mouseMove', x: returnAt.x, y: returnAt.y })
  await waitFor(() => smoke.evaluate(header, 'document.body.classList.contains("hinting") && document.getElementById("hint").textContent === "Return to Browser"'), 'the button hint in the title\'s place')
  header.sendInputEvent({ type: 'mouseMove', x: 200, y: 18 })
  park()
  header.sendInputEvent({ type: 'mouseLeave', x: 200, y: 60 })
  await waitFor(() => !panel.isVisible(), 'the panel hides after the pointer leaves', 5000)

  // --- 3. Float with a tab strip: drag, flip, push fallback.
  smoke.step('float: a second tab adds the strip; the panel grows to fit, still outside the window')
  await popOut(h2)
  await waitFor(() => miniWith(h2) === w1, 'h2 joins the collection')
  // h2 is active now; switch back to h1 (the header follows the active tab's title).
  await smoke.evaluate(header, `window.miniWindow.activateTab(${JSON.stringify(h1.id)}); true`)
  await waitFor(() => w1.getTitle() === 'Head 1 — Mini Window', 'h1 active again')
  reveal(w1, h1)
  await waitFor(() => panel.isVisible() && panel.getBounds().height === 64, 'the panel with header row + tab strip')
  wb = w1.getBounds()
  assert.deepEqual(panel.getBounds(), { x: wb.x, y: wb.y - 64, width: wb.width, height: 64 }, 'still above, touching the top edge')
  assert.ok(!intersects(panel.getBounds(), pageRect(w1, h1)), 'the strip never covers the page either')
  assert.equal(await smoke.evaluate(header, 'document.querySelectorAll(".tab").length'), 2, 'two tabs in the strip')

  smoke.step('float: dragging the header moves the window; the panel stays attached')
  const before = w1.getBounds()
  const target = { x: panel.getBounds().x + 12 + 40 - 100, y: panel.getBounds().y + 18 + 60 }
  const moved = await dragHeader(header, target)
  await waitFor(() => { const b = w1.getBounds(); return Math.abs(b.x - (before.x + moved.dx)) <= 2 && Math.abs(b.y - (before.y + moved.dy)) <= 2 }, `the window followed the pointer (before ${JSON.stringify(before)}, now ${JSON.stringify(w1.getBounds())}, by ${JSON.stringify(moved)})`)
  await delay(600)
  wb = w1.getBounds()
  assert.ok(Math.abs(wb.x - (before.x + moved.dx)) <= 2 && Math.abs(wb.y - (before.y + moved.dy)) <= 2, 'dropped where it was let go (no snap)')
  await waitFor(() => panel.isVisible() && panel.getBounds().y === w1.getBounds().y - 64 && panel.getBounds().x === w1.getBounds().x, 'the panel still attached above')
  await intact('dragged by the header', [h1, h2])

  smoke.step('float: dragged up into the menu bar band, the header stops at the top of the work area (never under the bar)')
  {
    const display = screen.getDisplayMatching(w1.getBounds())
    // Into the band above the work area (a macOS menu bar), short of pressing the screen's top edge (which tucks).
    const up = await dragHeader(header, { x: panel.getBounds().x + 12 + 40, y: display.bounds.y + 6 })
    await delay(600)
    wb = w1.getBounds()
    assert.equal(wb.y, display.workArea.y + 64, `the window stopped with its header just under the work area's top (moved ${JSON.stringify(up)}, now ${JSON.stringify(wb)}, work area ${JSON.stringify(display.workArea)})`)
    await waitFor(() => panel.isVisible() && panel.getBounds().y === display.workArea.y && panel.getBounds().y === w1.getBounds().y - 64, `the panel still above, at the work area's top (got ${JSON.stringify(panel.getBounds())})`)
    assert.equal(w1.isVisible(), true, 'not tucked (the pointer never pressed the screen edge)')
    await intact('dragged up to the menu bar', [h1, h2])
  }

  smoke.step('float: no room above (top of the work area) flips the panel below the window')
  park()
  await waitFor(() => !panel.isVisible(), 'hidden', 5000)
  w1.setBounds({ ...home, y: wa.y + 10 })
  await delay(600)
  reveal(w1, h1, 'top')
  await delay(500)
  assert.equal(panel.isVisible(), false, 'the top edge doesn\'t reveal it when it would show below')
  reveal(w1, h1, 'bottom')
  await waitFor(() => panel.isVisible(), 'revealed from the bottom edge')
  wb = w1.getBounds()
  assert.deepEqual(panel.getBounds(), { x: wb.x, y: wb.y + wb.height, width: wb.width, height: 64 }, 'attached below the window')
  assert.ok(!intersects(panel.getBounds(), pageRect(w1, h1)), 'below, still not over the page')
  park()
  await waitFor(() => !panel.isVisible(), 'hidden again', 5000)

  smoke.step('float: no room either side falls back to pushing the page down')
  w1.setBounds({ x: home.x, y: wa.y, width: home.width, height: wa.height })
  await delay(600)
  reveal(w1, h1)
  await waitFor(() => viewOf(w1, header) && viewOf(w1, header).getBounds().height === 64, 'the header inside the window')
  assert.equal(panel.isVisible(), false, 'no panel')
  await waitFor(() => viewOf(w1, h1.contents).getBounds().y === 64, 'the page pushed under it')
  assert.ok(!intersects(screenRect(w1, viewOf(w1, header)), pageRect(w1, h1)), 'pushed: no overlap')
  park()
  await waitFor(() => viewOf(w1, h1.contents).getBounds().y === 0, 'the page back at the top once hidden', 5000)
  w1.setBounds(home)
  await delay(600)
  await waitFor(() => hostOf(header) === panel, 'back in its panel with room above')

  // --- 4. Tab drag-out and header-drop merge with a floating header.
  smoke.step('float: a tab let go on its own panel stays; elsewhere it splits off')
  reveal(w1, h1)
  await waitFor(() => panel.isVisible(), 'revealed')
  const onPanel = { x: panel.getBounds().x + 300, y: panel.getBounds().y + 10 }
  await smoke.evaluate(header, `window.miniWindow.tabOut(${JSON.stringify(h2.id)}, ${onPanel.x}, ${onPanel.y}); true`)
  await delay(600)
  assert.equal(miniWindows().length, 1, 'let go on its own panel: nothing happens')
  const splitAt = { x: wa.x + 300, y: wa.y + 360 }
  await smoke.evaluate(header, `window.miniWindow.tabOut(${JSON.stringify(h2.id)}, ${splitAt.x}, ${splitAt.y}); true`)
  const w2 = await waitFor(() => { const win = miniWith(h2); return win && win !== w1 ? win : null }, 'h2 in a window of its own')
  await waitFor(() => w2.isVisible(), 'the split window shows')
  park()
  await delay(900)
  smoke.step('float: dragging its header onto the collection\'s header band merges it back, panel and all')
  const header2 = await waitFor(() => headerOf(w2), 'the split window\'s header')
  reveal(w2, h2)
  const panel2 = await waitFor(() => { const host = hostOf(header2); return host && host !== panel && host.getTitle() === 'Mini Window Header' && host.isVisible() ? host : null }, 'its own floating panel')
  const w1b = w1.getBounds()
  // The band just above the collection's top edge (where its floating header shows).
  await dragHeader(header2, { x: w1b.x + 200, y: w1b.y - 18 })
  await waitFor(() => w2.isDestroyed() && miniWindows().length === 1, 'the dropped window merged and closed')
  await waitFor(() => panel2.isDestroyed() && panelWindows().length === 1, 'its panel closed with it')
  await waitFor(() => header2.isDestroyed(), 'its header webContents destroyed')
  await intact('merged by a floating header drop', [h1, h2])

  // --- 5. Push.
  smoke.step('push (palette, live): the panel closes, the header moves in, the page moves down under it')
  park()
  await waitFor(() => !panel.isVisible(), 'hidden', 5000)
  w1.setBounds(home)
  await delay(600)
  await smoke.evaluate(toolbar, `window.api.browser.tabs.get()`)
  const headerId = header.id
  await run('miniWindow.header.push')
  await waitFor(async () => (await settings()).headerPlacement === 'push', 'saved as push')
  await waitFor(() => panel.isDestroyed() && panelWindows().length === 0, 'the panel closed')
  await waitFor(() => viewOf(w1, header), 'the same header page now in the window')
  assert.equal(header.id, headerId, 'header not recreated')
  assert.equal(await smoke.evaluate(header, 'document.body.classList.contains("floating")'), false, 'not floating')
  const active = await waitFor(async () => (await smoke.evaluate(header, '[...document.querySelectorAll(".tab.active")].map((tab) => tab.dataset.tabId)'))[0], 'the active strip tab')
  const pushed = pages.find((entry) => entry.id === active)
  await smoke.evaluate(pushed.contents, 'window.scrollTo(0, 500); true')
  await waitFor(() => smoke.evaluate(pushed.contents, 'window.scrollY === 500'), 'scrolled')
  reveal(w1, pushed)
  await waitFor(() => viewOf(w1, header).getBounds().height === 64 && viewOf(w1, pushed.contents).getBounds().y === 64, 'revealed: the page moved down by the header')
  wb = w1.getBounds()
  assert.deepEqual(viewOf(w1, pushed.contents).getBounds(), { x: 0, y: 64, width: wb.width, height: wb.height - 64 }, 'the page sits under the header')
  assert.ok(!intersects(screenRect(w1, viewOf(w1, header)), pageRect(w1, pushed)), 'no overlap')
  // Resting near the top: no bounce (the page doesn't jump back and forth).
  const samples = []
  for (let i = 0; i < 12; i++) {
    samples.push(viewOf(w1, pushed.contents).getBounds().y)
    await delay(100)
  }
  assert.ok(samples.every((y) => y === 64), `no jitter while resting (${samples.join(',')})`)
  assert.equal(await smoke.evaluate(pushed.contents, 'window.scrollY'), 500, 'scroll position kept')
  park()
  pushed.contents.sendInputEvent({ type: 'mouseLeave', x: 120, y: 300 })
  await waitFor(() => viewOf(w1, pushed.contents).getBounds().y === 0 && viewOf(w1, header).getBounds().height === 0, 'hidden: the page back at the top', 5000)
  await delay(300)
  assert.equal(viewOf(w1, pushed.contents).getBounds().y, 0, 'stays put after hiding')
  assert.equal(await smoke.evaluate(pushed.contents, 'window.scrollY'), 500, 'scroll position kept after hiding')
  await intact('push', [h1, h2])

  // --- 6. Overlay.
  smoke.step('overlay: the header lies over the top of the page (the original behaviour)')
  await run('miniWindow.header.overlay')
  await waitFor(async () => (await settings()).headerPlacement === 'overlay', 'saved as overlay')
  // Page events only (the real pointer stays parked, so the poll hides it again on its own).
  reveal(w1, pushed, 'top', false)
  await waitFor(() => viewOf(w1, header).getBounds().height === 64, 'revealed inside the window')
  assert.equal(viewOf(w1, pushed.contents).getBounds().y, 0, 'the page stays under it')
  assert.ok(intersects(screenRect(w1, viewOf(w1, header)), pageRect(w1, pushed)), 'overlay covers the page top')
  assert.equal(panelWindows().length, 0, 'no panel')
  pushed.contents.sendInputEvent({ type: 'mouseMove', x: 120, y: 300 })
  await waitFor(() => viewOf(w1, header).getBounds().height === 0, 'hidden', 5000)

  // --- 7. Float again: tuck and slide out.
  smoke.step('float (live) again: tucking hides the panel with the window; sliding out brings it back above')
  await run('miniWindow.header.float')
  await waitFor(async () => (await settings()).headerPlacement === 'float', 'saved as float')
  const panel3 = await waitFor(() => { const host = hostOf(header); return host && host.getTitle() === 'Mini Window Header' ? host : null }, 'back in a panel')
  // Nearest the right edge, so the tuck button docks it there.
  w1.setBounds({ ...home, x: wa.x + wa.width - home.width - 80 })
  await delay(600)
  reveal(w1, pushed)
  await waitFor(() => panel3.isVisible(), 'revealed above')
  await smoke.evaluate(header, 'document.getElementById("tuck").click(); true')
  await waitFor(() => !w1.isVisible() && visibleHandles().length === 1, 'tucked behind its handle')
  assert.equal(panel3.isVisible(), false, 'the panel went with it')
  await clickHandle(visibleHandles()[0])
  await waitFor(() => w1.isVisible(), 'slid out')
  await delay(500)
  const docked = w1.getBounds()
  reveal(w1, pushed)
  await waitFor(() => panel3.isVisible(), 'revealed again')
  assert.deepEqual(panel3.getBounds(), { x: docked.x, y: docked.y - 64, width: docked.width, height: 64 }, 'above the docked window')
  park()
  await waitFor(() => !panel3.isVisible(), 'hidden', 5000)

  // --- 8. Stack: drag the leader by its floating header.
  smoke.step('stack: dragging the leader by its floating header moves the group along the edge')
  w1.setBounds({ ...w1.getBounds(), height: 300 })
  await delay(600)
  const result = await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ grouping: "stack" })')
  assert.equal(result.ok, true, 'switched to stack')
  const stack = () => [h1, h2].map(miniWith)
  await waitFor(() => miniWindows().length === 2 && stack().every((win) => win?.isVisible() && flushRight(win.getBounds(), wa)), 'two windows out on the right edge')
  await delay(800)
  const leader = stack().sort((a, b) => a.getBounds().y - b.getBounds().y)[0]
  const follower = stack().find((win) => win !== leader)
  const lead = leader === miniWith(h1) ? h1 : h2
  const leaderHeader = await waitFor(() => headerOf(leader), 'the leader\'s header')
  reveal(leader, lead)
  await waitFor(() => { const host = hostOf(leaderHeader); return host && host.getTitle() === 'Mini Window Header' && host.isVisible() }, 'the leader\'s floating header')
  const lb = leader.getBounds()
  const fb = follower.getBounds()
  const lp = hostOf(leaderHeader).getBounds()
  await dragHeader(leaderHeader, { x: lp.x + 50, y: lp.y + 18 + 80 })
  await waitFor(() => leader.getBounds().y >= lb.y + 70 && follower.getBounds().y >= fb.y + 70, `the follower came along (leader ${JSON.stringify(leader.getBounds())}, follower ${JSON.stringify(follower.getBounds())})`)
  await delay(800)
  assert.ok(flushRight(leader.getBounds(), wa) && flushRight(follower.getBounds(), wa), 'both still docked on the edge')
  assert.ok(follower.getBounds().y >= leader.getBounds().y + leader.getBounds().height, 'still stacked under the leader')
  await intact('stack drag', [h1, h2])

  // --- 9. Nothing left behind.
  smoke.step('Return All leaves nothing behind (windows, panels, handles, header webContents)')
  park()
  await run('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0, 'all mini windows and handles closed')
  await waitFor(() => panelWindows().length === 0, 'every header panel closed')
  await waitFor(() => liveContents().filter((contents) => isMiniHeader(contents) || isHandlePage(contents)).length === 0, 'no header or handle webContents left', 5000)
  await intact('returned')
  assert.equal(h3.contents.isDestroyed(), false)

  console.log('Electron mini window header smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window header smoke failed:', error)
  app.exit(1)
})
