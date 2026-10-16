// Integration smoke for tuck-to-screen-edge on the mini window, against the production build:
//   1. Dropped past each edge of the display (right, left, top, bottom) the mini window docks there and
//      tucks away (hidden, wholly past the display's edge, so none of it sits in a menu bar / Dock band),
//      leaving a small always-on-top handle window on the work area's edge; the dock is
//      saved; clicking the handle slides the window back out flush with the edge at its own size;
//      dragging it away from the edge undocks it (handle gone, saved dock cleared).
//   2. The header's tuck button tucks it to the nearest edge; the toggle command (what the global
//      shortcut runs) slides it out / tucks it while docked; the palette's Tuck command too.
//   3. While tucked the tab is never slept or archived (clock 13 h ahead, timed sleep + auto-archive
//      take an idle browser tab), never reloaded, and audio keeps playing.
//   4. Idle CPU while tucked: the static page's renderer and the handle's stay ~0.
//   5. Docked state survives Return/Pop Out: the next pop out opens against the same edge with its
//      handle; no handle window or webContents leaks after Return.
//   6. Settings → Tuck to screen edge off: undocks, hides the header's tuck button, edges don't dock.
//   7. Several docked at once (grouping 'separate'): three mini windows tucked to the same edge each get their own handle
//      (showing its page's favicon), spread along the edge without overlapping; each dock is saved in
//      its own slot; Show/Hide slides all out and tucks all back together; returning one re-spreads
//      the rest; Return All leaves no handle window or webContents behind.
//   8. Migration: a single-window dock file (pre multi-window) opens the first mini window docked.
// `bun run build && bun run test:electron-mini-window-dock`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-dock-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, screen, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-mini-window-dock-smoke-${process.pid}`)
const PAGE = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:0;padding:24px}</style>
<body><h1>${title}</h1>${body}<script>window.loadId = Math.random()</script></body>`
// A 30-second 440 Hz tone, looped, built in the page (no media file to serve).
const AUDIO = `<script>
window.startAudio = () => {
  const rate = 8000, samples = rate * 30, buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer)
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * 2 * Math.PI * 440) * 3000, true)
  const audio = new Audio(URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })))
  audio.loop = true
  window.tone = audio
  return audio.play().then(() => true, (error) => String(error))
}
</script>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const pages = {
    '/start': PAGE('Start', '<p>start</p>'),
    '/chat': PAGE('Chat', `<textarea id="prompt"></textarea>${AUDIO}`),
    '/idle': PAGE('Idle', '<p>idle</p>'),
    ...Object.fromEntries([1, 2, 3].map((n) => [`/d${n}`, PAGE(`Dock ${n}`, `<p>dock ${n}</p>`).replace('<title>', `<link rel="icon" href="/icon${n}.svg"><title>`)]))
  }
  if (/^\/icon\d\.svg$/.test(path)) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#2f6fed"/></svg>')
    return
  }
  response.writeHead(pages[path] ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(pages[path] ?? 'not found')
})

let mainWindow
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

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const dataTitled = (title) => (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`)
const isMiniHeader = dataTitled('Mini Window')
const isHandlePage = dataTitled('Mini Window Handle')
const windowsWith = (predicate) => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed() && win.contentView.children.some((view) => view.webContents && !view.webContents.isDestroyed() && predicate(view.webContents)))
const miniWindows = () => windowsWith(isMiniHeader)
const handleWindows = () => windowsWith(isHandlePage)
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
const handlePage = (win) => win.contentView.children.find((view) => view.webContents && isHandlePage(view.webContents))?.webContents
const readDockFile = () => existsSync(join(userData, 'mini-window-dock.json')) ? JSON.parse(readFileSync(join(userData, 'mini-window-dock.json'), 'utf8')) : {}
/** One window's saved docks (per display): `slot` of `{ slots: [...] }` (slot 0 is the first mini window). */
const readDocks = (slot = 0) => readDockFile().slots?.[slot] ?? {}

/** Where a window of `size` sits flush against `edge` of `wa` (the dock's "out" position), along-edge start not checked. */
function flushWith(bounds, edge, wa) {
  if (edge === 'left') return bounds.x === wa.x
  if (edge === 'right') return bounds.x + bounds.width === wa.x + wa.width
  if (edge === 'top') return bounds.y === wa.y
  return bounds.y + bounds.height === wa.y + wa.height
}

function handleOnEdge(bounds, edge, wa) {
  const side = edge === 'left' || edge === 'right'
  if (side ? bounds.width >= bounds.height : bounds.height >= bounds.width) return false
  if (edge === 'left') return bounds.x === wa.x
  if (edge === 'right') return bounds.x + bounds.width === wa.x + wa.width
  if (edge === 'top') return bounds.y === wa.y
  return bounds.y + bounds.height === wa.y + wa.height
}

/** Tucked: wholly past `edge` of the display's bounds (none of it in the band between work area and screen edge). */
function offDisplay(bounds, edge, screenBounds) {
  if (edge === 'left') return bounds.x + bounds.width <= screenBounds.x
  if (edge === 'right') return bounds.x >= screenBounds.x + screenBounds.width
  if (edge === 'top') return bounds.y + bounds.height <= screenBounds.y
  return bounds.y >= screenBounds.y + screenBounds.height
}

/** A drop with the window pushed 60 px past `edge`. */
function pastEdge(size, edge, wa) {
  const midX = Math.round(wa.x + (wa.width - size.width) / 2)
  const midY = Math.round(wa.y + (wa.height - size.height) / 2)
  if (edge === 'left') return { x: wa.x - 60, y: midY, ...size }
  if (edge === 'right') return { x: wa.x + wa.width - size.width + 60, y: midY, ...size }
  if (edge === 'top') return { x: midX, y: wa.y - 60, ...size }
  return { x: midX, y: wa.y + wa.height - size.height + 60, ...size }
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
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`, `${origin}/chat`, `${origin}/idle`], activeIndex: 1 }))
  // Header inside the window (the original 'overlay' placement), so the header view is the mini window's; 'float' / 'push': electron-mini-window-header-smoke.cjs.
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ headerPlacement: 'overlay' }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  const surface = (win, name) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && surfaceFor(view) === name)
  await waitFor(() => surface(mainWindow, 'content') && surface(mainWindow, 'toolbar'), 'the renderer surfaces')
  const toolbar = surface(mainWindow, 'toolbar').webContents
  const content = surface(mainWindow, 'content').webContents
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => smoke.evaluate(content, 'document.readyState === "complete" && Boolean(window.api)'), 'the content renderer')
  const tabs = () => smoke.evaluate(toolbar, 'window.api.browser.tabs.get()')
  const run = (id) => smoke.evaluate(toolbar, `window.api.browser.commands.run(${JSON.stringify(id)})`)
  const commandTitle = async (id) => (await smoke.evaluate(toolbar, 'window.api.browser.commands.list()')).commands.find((command) => command.id === id)

  const chat = await waitFor(() => pageContents((url, contents) => url === `${origin}/chat` && !contents.isLoading()), 'the chat page')
  await waitFor(() => smoke.evaluate(chat, 'document.readyState === "complete"'), 'the chat page to load')
  await smoke.evaluate(chat, 'window.marker = "kept"; document.querySelector("#prompt").value = "half-typed"; true')
  const loadId = await smoke.evaluate(chat, 'window.loadId')
  const untouched = async (where) => {
    assert.equal(chat.isDestroyed(), false, `${where}: the page was not destroyed`)
    assert.equal(await smoke.evaluate(chat, 'window.marker'), 'kept', `${where}: page state kept`)
    assert.equal(await smoke.evaluate(chat, 'window.loadId'), loadId, `${where}: same document (no reload)`)
  }

  smoke.step('pop out the chat tab')
  await run('miniWindow.popOut')
  const mini = await waitFor(() => miniWindows()[0], 'the mini window')
  await waitFor(() => viewOf(mini, chat) && mini.isVisible(), 'the chat page in the visible mini window')
  const header = await waitFor(() => liveContents().find(isMiniHeader), 'the header')
  await waitFor(() => smoke.evaluate(header, 'document.getElementById("title").textContent === "Chat"'), 'the header state')
  assert.equal(await smoke.evaluate(header, 'document.getElementById("tuck").hidden'), false, 'the header has a tuck button')
  assert.equal(handleWindows().length, 0, 'no handle until docked')
  const size = { width: mini.getBounds().width, height: mini.getBounds().height }
  const workArea = () => screen.getDisplayMatching(mini.getBounds()).workArea

  // --- 1. Each edge: drop past it → tucked behind a handle; click the handle → back out.
  for (const edge of ['right', 'left', 'top', 'bottom']) {
    smoke.step(`drop past the ${edge} edge: tucks away behind an on-top handle; the handle brings it back`)
    const wa = workArea()
    mini.setBounds(pastEdge(size, edge, wa))
    const handle = await waitFor(() => handleWindows()[0], `the handle window (${edge})`)
    await waitFor(() => !mini.isVisible() && handle.isVisible(), `the window tucked away (${edge})`)
    assert.equal(handle.isAlwaysOnTop(), true, 'the handle is always on top')
    assert.equal(handle.isFocusable?.() ?? false, false, 'the handle never takes focus')
    await waitFor(() => handleOnEdge(handle.getBounds(), edge, wa), `the handle on the ${edge} edge (got ${JSON.stringify(handle.getBounds())})`, 3000)
    // Past the display's own edge, not just the work area's: nothing left in a menu bar / Dock / taskbar band.
    const screenBounds = screen.getDisplayMatching(handle.getBounds()).bounds
    await waitFor(() => offDisplay(mini.getBounds(), edge, screenBounds), `the tucked window fully past the display's ${edge} edge (got ${JSON.stringify(mini.getBounds())}, display ${JSON.stringify(screenBounds)})`, 3000)
    const saved = Object.values(readDocks())
    assert.equal(saved.length, 1, 'one saved dock')
    assert.equal(saved[0].edge, edge, 'the saved dock edge')
    await untouched(`tucked ${edge}`)
    await waitFor(() => smoke.evaluate(handlePage(handle), `document.body.className === ${JSON.stringify(edge)}`), 'the handle page to know its edge')
    await clickHandle(handle)
    await waitFor(() => mini.isVisible() && flushWith(mini.getBounds(), edge, wa), `the window slid out flush with the ${edge} edge`)
    await delay(250)
    const out = mini.getBounds()
    assert.equal(out.width, size.width, 'same width after sliding out')
    assert.equal(out.height, size.height, 'same height after sliding out')
    assert.ok(out.x >= wa.x && out.y >= wa.y && out.x + out.width <= wa.x + wa.width && out.y + out.height <= wa.y + wa.height, 'fully on screen')
    assert.equal(handle.isVisible(), true, 'the handle stays, on the window\'s free side')
    assert.ok(!handleOnEdge(handle.getBounds(), edge, wa), 'the handle moved off the screen edge with the window')
    assert.equal(await smoke.evaluate(chat, 'document.visibilityState'), 'visible', 'the page is visible again')
    await untouched(`out ${edge}`)
    // Drag it away from the edge: undocks.
    await delay(600)
    mini.setBounds({ x: Math.round(wa.x + (wa.width - size.width) / 2), y: Math.round(wa.y + (wa.height - size.height) / 2), ...size })
    await waitFor(() => handleWindows().length === 0, 'dragging away undocks (handle gone)')
    await waitFor(() => Object.keys(readDocks()).length === 0, 'the saved dock cleared')
    assert.equal(mini.isVisible(), true, 'still showing after undock')
  }
  // The handle window's 'closed' handler closes its page, which is destroyed a tick or two later: wait for it.
  await waitFor(() => liveContents().filter(isHandlePage).length === 0, 'no leaked handle webContents after undocking', 5000)

  // --- 2. Header button, toggle command, palette command.
  smoke.step('header tuck button tucks to the nearest edge; toggle and palette slide it out and back')
  await delay(600)
  await smoke.evaluate(header, 'document.getElementById("tuck").click(); true')
  const handle = await waitFor(() => handleWindows()[0], 'the handle after the tuck button')
  await waitFor(() => !mini.isVisible(), 'tucked by the header button')
  const [savedEdge] = Object.values(readDocks()).map((dock) => dock.edge)
  assert.ok(savedEdge, 'docked to an edge')
  assert.ok(handleOnEdge(handle.getBounds(), savedEdge, workArea()), 'the handle sits on that edge')
  assert.equal((await commandTitle('miniWindow.tuck'))?.title, 'Slide Out Mini Window', 'the palette offers to slide it out')
  await run('miniWindow.toggle')
  await waitFor(() => mini.isVisible() && flushWith(mini.getBounds(), savedEdge, workArea()), 'toggle slides it out while docked')
  await untouched('toggle out')
  await delay(300)
  await run('miniWindow.toggle')
  await waitFor(() => !mini.isVisible() && handle.isVisible(), 'toggle tucks it again (handle stays)')
  await run('miniWindow.tuck')
  await waitFor(() => mini.isVisible(), 'palette Tuck command slides it out')
  await delay(300)
  await run('miniWindow.tuck')
  await waitFor(() => !mini.isVisible(), 'palette Tuck command tucks it')

  // --- 3. Tucked: never slept/archived/reloaded; audio keeps playing.
  smoke.step('tucked: tab sleep and auto-archive leave it alone; audio keeps playing')
  await run('miniWindow.toggle')
  await waitFor(() => mini.isVisible(), 'out to start audio')
  const played = await chat.executeJavaScript('window.startAudio()', true)
  const audioChecked = played === true
  if (!audioChecked) smoke.step(`note: no audio playback in this environment (${played}); skipping the audio check`)
  // How fast the clock runs on screen here (headless CI has no sound card: a fake output may run slow).
  const rate = async () => {
    const t1 = await smoke.evaluate(chat, 'window.tone.currentTime')
    await delay(1500)
    return (await smoke.evaluate(chat, 'window.tone.currentTime')) - t1
  }
  const visibleRate = audioChecked ? await rate() : 0
  await run('miniWindow.toggle')
  await waitFor(() => !mini.isVisible(), 'tucked with audio playing')
  if (audioChecked) {
    await delay(300)
    const tuckedRate = await rate()
    smoke.step(`audio clock over 1.5 s: on screen +${visibleRate.toFixed(2)} s, tucked +${tuckedRate.toFixed(2)} s`)
    assert.equal(await smoke.evaluate(chat, 'window.tone.paused'), false, 'audio not paused while tucked')
    assert.ok(tuckedRate > 0.1 && tuckedRate >= visibleRate * 0.6, `audio keeps playing while tucked (+${tuckedRate.toFixed(2)} s vs +${visibleRate.toFixed(2)} s on screen)`)
  }
  await smoke.evaluate(chat, 'window.tone && window.tone.pause(); true')
  const idle = (await tabs()).find((tab) => tab.url === `${origin}/idle`)
  const startTab = (await tabs()).find((tab) => tab.url === `${origin}/start`)
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(idle.id)})`)
  await waitFor(() => pageContents((url, contents) => url === `${origin}/idle` && !contents.isLoading()), 'the idle page to load')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(startTab.id)})`)
  await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === startTab.id, 'the start tab active again')
  const realNow = Date.now
  Date.now = () => realNow() + 13 * 60 * 60 * 1000
  try {
    await smoke.evaluate(toolbar, 'window.api.browser.setTabSleepMinutes(5)')
    await waitFor(async () => (await tabs()).find((tab) => tab.id === idle.id)?.sleeping, 'the idle background tab to sleep')
    await delay(500)
    await untouched('tucked, after timed sleep')
    await smoke.evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "12h", prompted: true })')
    await waitFor(async () => !(await tabs()).some((tab) => tab.id === idle.id), 'the idle tab to be archived')
    await delay(500)
    await untouched('tucked, after auto-archive')
    await smoke.evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "off" })')
    await smoke.evaluate(toolbar, 'window.api.browser.setTabSleepMinutes(0)')
  } finally {
    Date.now = realNow
  }

  // --- 4. Idle CPU while tucked.
  smoke.step('idle CPU while tucked')
  await delay(1000)
  const pids = { page: chat.getOSProcessId(), handle: handlePage(handle).getOSProcessId(), header: header.getOSProcessId() }
  app.getAppMetrics()
  await delay(3000)
  const metrics = app.getAppMetrics()
  const cpu = Object.fromEntries(Object.entries(pids).map(([name, pid]) => [name, metrics.find((metric) => metric.pid === pid)?.cpu.percentCPUUsage ?? 0]))
  const browserCpu = metrics.find((metric) => metric.type === 'Browser')?.cpu.percentCPUUsage ?? 0
  smoke.step(`cpu % over 3 s tucked: page ${cpu.page.toFixed(2)}, handle ${cpu.handle.toFixed(2)}, header ${cpu.header.toFixed(2)}, main ${browserCpu.toFixed(2)}`)
  assert.ok(cpu.page < 2, `the tucked static page idles (${cpu.page.toFixed(2)}%)`)
  assert.ok(cpu.handle < 2, `the handle idles (${cpu.handle.toFixed(2)}%)`)

  // --- 5. Docked state survives Return / Pop Out.
  smoke.step('return to browser closes the handle; the next pop out opens against the same edge')
  await run('miniWindow.return')
  await waitFor(() => viewOf(mainWindow, chat) && mini.isDestroyed(), 'back in the browser window')
  await waitFor(() => handleWindows().length === 0 && liveContents().filter(isHandlePage).length === 0, 'the handle window and its page gone')
  await untouched('returned')
  assert.equal(Object.values(readDocks())[0]?.edge, savedEdge, 'the dock is remembered')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify((await tabs()).find((tab) => tab.url === `${origin}/chat`).id)})`)
  await run('miniWindow.popOut')
  const again = await waitFor(() => miniWindows()[0], 'the mini window again')
  await waitFor(() => viewOf(again, chat) && again.isVisible(), 'shown')
  const wa2 = screen.getDisplayMatching(again.getBounds()).workArea
  assert.ok(flushWith(again.getBounds(), savedEdge, wa2), `opens flush with the remembered ${savedEdge} edge`)
  const handle2 = await waitFor(() => handleWindows()[0], 'its handle')
  await waitFor(() => handle2.isVisible(), 'the handle shows with it')
  await untouched('popped out again')

  // --- 6. Setting off.
  smoke.step('Tuck to screen edge off: undocks, no tuck button, edges do not dock')
  const header2 = await waitFor(() => liveContents().find(isMiniHeader), 'the new header')
  const off = await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ tuckToEdge: false })')
  assert.equal(off.ok, true)
  assert.equal(off.settings.tuckToEdge, false)
  assert.equal(JSON.parse(readFileSync(join(userData, 'browser-mini-window.json'), 'utf8')).tuckToEdge, false, 'saved')
  await waitFor(() => handleWindows().length === 0, 'turning it off undocks')
  await waitFor(() => Object.keys(readDocks()).length === 0, 'and forgets the dock')
  await waitFor(() => smoke.evaluate(header2, 'document.getElementById("tuck").hidden'), 'the tuck button hides')
  assert.equal((await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ tuckToEdge: "yes" })')).ok, false, 'non-boolean refused')
  await delay(600)
  again.setBounds(pastEdge(size, 'left', wa2))
  await delay(1200)
  assert.equal(handleWindows().length, 0, 'an edge drop does not dock when off')
  assert.equal(again.isVisible(), true, 'still showing')
  await run('miniWindow.toggle')
  await waitFor(() => !again.isVisible(), 'not docked: toggle hides as before')
  await run('miniWindow.toggle')
  await waitFor(() => again.isVisible(), 'and shows')
  await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ tuckToEdge: true })')
  await run('miniWindow.return')
  await waitFor(() => again.isDestroyed() && liveContents().filter((contents) => isMiniHeader(contents) || isHandlePage(contents)).length === 0, 'closed with nothing leaked')

  // --- 7. Several docked to the same edge (grouping 'separate'; tabs/stack: electron-mini-window-grouping-smoke.cjs).
  assert.equal((await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ grouping: "separate" })')).settings.grouping, 'separate')
  smoke.step('three mini windows tucked to the right edge: own handles, favicons, spread without overlapping')
  const docked = []
  for (const n of [1, 2, 3]) {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/d${n}`)})`)
    const contents = await waitFor(() => pageContents((url, c) => url === `${origin}/d${n}` && !c.isLoading()), `page d${n}`)
    await waitFor(() => smoke.evaluate(contents, 'typeof window.loadId === "number"'), `page d${n} ready`)
    const id = (await tabs()).find((tab) => tab.url === `${origin}/d${n}`).id
    await waitFor(async () => (await tabs()).find((tab) => tab.id === id)?.favicon || (await tabs()).find((tab) => tab.id === id)?.faviconUrl, `d${n} favicon`, 5000).catch(() => null)
    await smoke.evaluate(contents, `window.marker = "d${n}"; true`)
    docked.push({ n, id, contents, loadId: await smoke.evaluate(contents, 'window.loadId') })
  }
  const intactAll = async (where) => {
    for (const entry of docked) {
      assert.equal(entry.contents.isDestroyed(), false, `${where}: d${entry.n} alive`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.marker'), `d${entry.n}`, `${where}: d${entry.n} kept its state`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.loadId'), entry.loadId, `${where}: d${entry.n} not reloaded`)
    }
  }
  const miniOf = (contents) => miniWindows().find((win) => viewOf(win, contents))
  for (const entry of docked) {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`)
    await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === entry.id, `d${entry.n} active`)
    await run('miniWindow.popOut')
    entry.win = await waitFor(() => miniOf(entry.contents), `d${entry.n} in its own mini window`)
    await waitFor(() => entry.win.isVisible(), `d${entry.n} shown`)
  }
  assert.equal(miniWindows().length, 3, 'three mini windows')
  const wa3 = screen.getDisplayMatching(docked[0].win.getBounds()).workArea
  // Same size, same spot along the edge: their handles would sit on top of each other without spreading.
  for (const entry of docked) {
    await delay(600)
    entry.win.setBounds(pastEdge(size, 'right', wa3))
    await waitFor(() => !entry.win.isVisible(), `d${entry.n} tucked`)
  }
  const handleRects = () => handleWindows().filter((win) => win.isVisible()).map((win) => win.getBounds())
  const overlap = (r, q) => r.x < q.x + q.width && q.x < r.x + r.width && r.y < q.y + q.height && q.y < r.y + r.height
  const spread = () => {
    const rects = handleRects()
    return rects.every((r, i) => rects.every((q, j) => i === j || !overlap(r, q))) ? rects : null
  }
  await waitFor(() => handleRects().length === 3 && spread(), `three handles, none overlapping (got ${JSON.stringify(handleRects())})`)
  for (const rect of handleRects()) assert.ok(handleOnEdge(rect, 'right', wa3), `each handle on the right edge (${JSON.stringify(rect)})`)
  const slots = readDockFile().slots ?? []
  assert.equal(slots.filter((slot) => Object.values(slot).some((dock) => dock.edge === 'right')).length, 3, `each window's dock saved in its own slot (${JSON.stringify(slots)})`)
  for (const win of handleWindows()) {
    const page = handlePage(win)
    await waitFor(() => smoke.evaluate(page, 'document.getElementById("icon").hidden === false && document.getElementById("icon").src.length > 0 && document.getElementById("icon").complete'), 'each handle shows its page favicon', 5000)
  }
  await intactAll('three tucked')

  smoke.step('Show/Hide slides every docked window out together, and tucks them back together')
  await run('miniWindow.toggle')
  await waitFor(() => docked.every((entry) => entry.win.isVisible() && flushWith(entry.win.getBounds(), 'right', wa3)), 'all three slid out')
  await delay(300)
  await run('miniWindow.toggle')
  await waitFor(() => docked.every((entry) => !entry.win.isVisible()), 'all three tucked again')
  await waitFor(() => handleRects().length === 3 && spread(), 'handles spread again')
  await intactAll('toggled')

  smoke.step('returning one re-spreads the others; Return All leaves nothing behind')
  await run(`miniWindow.return:${docked[1].id}`)
  await waitFor(() => docked[1].win.isDestroyed(), 'd2 returned')
  await waitFor(() => handleWindows().length === 2 && handleRects().length === 2 && spread(), 'two handles left, still apart')
  // With the middle one gone the other two settle back toward their windows' centres (no gap left behind).
  await run('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0, 'all mini windows and handles closed')
  await waitFor(() => liveContents().filter((contents) => isMiniHeader(contents) || isHandlePage(contents)).length === 0, 'no header or handle webContents left')
  await intactAll('returned')

  // --- 8. Migration from the single-window dock file.
  smoke.step('a single-window dock file still docks the first mini window')
  const legacyKey = Object.keys(readDocks(0))[0]
  assert.ok(legacyKey, 'slot 0 remembered a dock')
  writeFileSync(join(userData, 'mini-window-dock.json'), JSON.stringify({ [legacyKey]: { edge: 'left', offset: 40 } }))
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(docked[0].id)})`)
  await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === docked[0].id, 'd1 active')
  await run('miniWindow.popOut')
  const migrated = await waitFor(() => miniOf(docked[0].contents), 'd1 in a mini window')
  await waitFor(() => migrated.isVisible() && flushWith(migrated.getBounds(), 'left', wa3), 'opens docked to the legacy left edge')
  await waitFor(() => handleWindows().length === 1, 'with its handle')
  await run('miniWindow.return')
  await waitFor(() => migrated.isDestroyed() && handleWindows().length === 0, 'closed again')

  console.log('Electron mini window dock smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window dock smoke failed:', error)
  app.exit(1)
})
