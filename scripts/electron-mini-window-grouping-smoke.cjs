// Integration smoke for mini window grouping (Settings → Mini window grouping), against the production build:
//   1. Migration: settings and dock files in the #203 format (no grouping key; per-slot docks) read as
//      'tabs' grouping, and the first collection opens docked to the saved edge.
//   2. Tabs: popping out tabs adds them to the same window (one window, one handle with a count badge,
//      a tab strip in the header); the hidden tab is never slept (clock 13 h ahead) and keeps playing
//      audio; clicking a strip tab switches; no reloads anywhere.
//   3. Tabs: dragging a tab out of the strip splits it into its own window under the pointer; dropping
//      that window's header on the collection's header merges it back; splitting again and docking it
//      to the edge the collection holds merges it too (one handle, count 2).
//   4. Tabs: Return returns the active tab (the strip goes with one tab left); Return All in the header
//      returns the rest and closes the window; the cap counts tabs (six, the seventh refused).
//   5. Switch tabs → stack (palette command) with a tucked 3-tab collection: three windows, all tucked
//      on that edge behind ONE handle (count 3); its click slides the whole group out stacked along the
//      edge without overlapping; dragging the first window along the edge moves the others; dragging one
//      away removes it from the group (count 2), docking it to that edge adds it back (count 3);
//      Show/Hide tucks and slides the group together.
//   6. Switch stack → tabs: the three docked windows merge into one collection (count 3).
//   7. Switch tabs → separate: the collection splits into three windows, each with its own handle.
//   8. Return All leaves no mini window, handle window or header/handle webContents behind.
// `bun run build && bun run test:electron-mini-window-grouping`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-grouping-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, screen, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-mini-window-grouping-smoke-${process.pid}`)
const COLORS = ['#2f6fed', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f']
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
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><link rel="icon" href="/icon${n}.svg"><title>Group ${n}</title>
<style>body{font:16px system-ui;margin:0;padding:24px}</style>
<body><h1>Group ${n}</h1>${n === 1 ? AUDIO : ''}<script>window.loadId = Math.random()</script></body>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const icon = /^\/icon(\d)\.svg$/.exec(path)
  if (icon) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${COLORS[Number(icon[1]) - 1]}"/></svg>`)
    return
  }
  const page = /^\/g(\d)$/.exec(path)
  const body = path === '/start' ? '<!doctype html><title>Start</title><p>start</p>' : path === '/idle' ? '<!doctype html><title>Idle</title><p>idle</p>' : page ? PAGE(Number(page[1])) : null
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

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const dataTitled = (title) => (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`)
const isMiniHeader = dataTitled('Mini Window')
const isHandlePage = dataTitled('Mini Window Handle')
const windowsWith = (predicate) => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed() && win.contentView.children.some((view) => view.webContents && !view.webContents.isDestroyed() && predicate(view.webContents)))
const miniWindows = () => windowsWith(isMiniHeader)
const handleWindows = () => windowsWith(isHandlePage)
const visibleHandles = () => handleWindows().filter((win) => win.isVisible())
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
const headerOf = (win) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && isMiniHeader(view.webContents))?.webContents
const handlePage = (win) => win.contentView.children.find((view) => view.webContents && isHandlePage(view.webContents))?.webContents
const handleCount = async (win) => {
  const page = handlePage(win)
  if (!page || page.isLoading()) return null
  return smoke.evaluate(page, 'document.getElementById("count").textContent')
}

function flushRight(bounds, wa) {
  return bounds.x + bounds.width === wa.x + wa.width
}

function pastRight(bounds, wa) {
  return { x: wa.x + wa.width - bounds.width + 60, y: Math.round(wa.y + (wa.height - bounds.height) / 2), width: bounds.width, height: bounds.height }
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
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`, `${origin}/idle`], activeIndex: 0 }))
  // #203-format settings: no grouping key. The header stays inside the window ('overlay') so it is the
  // mini window's view; the floating header's drags and drops: electron-mini-window-header-smoke.cjs.
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: false, peekDelayMs: 350, headerPlacement: 'overlay' }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 800 })
  const surface = (win, name) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && surfaceFor(view) === name)
  await waitFor(() => surface(mainWindow, 'content') && surface(mainWindow, 'toolbar'), 'the renderer surfaces')
  const toolbar = surface(mainWindow, 'toolbar').webContents
  const content = surface(mainWindow, 'content').webContents
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => smoke.evaluate(content, 'document.readyState === "complete" && Boolean(window.api)'), 'the content renderer')
  const tabs = () => smoke.evaluate(toolbar, 'window.api.browser.tabs.get()')
  const run = (id) => smoke.evaluate(toolbar, `window.api.browser.commands.run(${JSON.stringify(id)})`)
  const setGrouping = async (grouping) => {
    const result = await smoke.evaluate(content, `window.api.browser.miniWindow.update({ grouping: ${JSON.stringify(grouping)} })`)
    assert.equal(result.ok, true, `switched to ${grouping}`)
    assert.equal(result.settings.grouping, grouping)
  }

  const wa = screen.getPrimaryDisplay().workArea
  const displayKey = `${Math.round(wa.x)},${Math.round(wa.y)},${Math.round(wa.width)}x${Math.round(wa.height)}`
  // #203-format dock file: slot 0 docked to the right edge, slot 1 too (the pile of handles #203 left).
  writeFileSync(join(userData, 'mini-window-dock.json'), JSON.stringify({ slots: [{ [displayKey]: { edge: 'right', offset: 40 } }, { [displayKey]: { edge: 'right', offset: 400 } }] }))

  // Seven pages, each loaded in its own browser tab (g3..g7 only after the sleep/archive check, which would take them).
  const pages = []
  const makePage = async (n) => {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/g${n}`)})`)
    const contents = await waitFor(() => pageContents((url, c) => url === `${origin}/g${n}` && !c.isLoading()), `page g${n}`)
    await waitFor(() => smoke.evaluate(contents, 'document.readyState === "complete" && typeof window.loadId === "number"'), `page g${n} ready`)
    await smoke.evaluate(contents, `window.marker = "g${n}"; true`)
    const entry = { n, contents, loadId: await smoke.evaluate(contents, 'window.loadId'), id: (await tabs()).find((tab) => tab.url === `${origin}/g${n}`).id }
    pages.push(entry)
    return entry
  }
  const g1 = await makePage(1)
  const g2 = await makePage(2)
  const intact = async (where, entries = pages) => {
    for (const entry of entries) {
      assert.equal(entry.contents.isDestroyed(), false, `${where}: g${entry.n} alive`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.marker'), `g${entry.n}`, `${where}: g${entry.n} kept its state`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.loadId'), entry.loadId, `${where}: g${entry.n} not reloaded`)
    }
  }
  const popOut = async (entry) => {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`)
    await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === entry.id, `g${entry.n} active`)
    await run('miniWindow.popOut')
  }
  const stripTabs = async (win) => {
    const header = headerOf(win)
    return header ? smoke.evaluate(header, '[...document.querySelectorAll(".tab")].map((tab) => tab.dataset.tabId)') : []
  }
  const holds = async (win, entries) => {
    const ids = await stripTabs(win)
    return ids.length === entries.length && entries.every((entry) => ids.includes(entry.id))
  }

  // --- 1. Migration.
  smoke.step('#203 settings read as tabs grouping; the first collection opens docked to the saved edge')
  assert.equal((await smoke.evaluate(content, 'window.api.browser.miniWindow.getSettings()')).settings.grouping, 'tabs', 'migrated settings: tabs')
  await popOut(g1)
  const w1 = await waitFor(() => miniWindows()[0], 'the first collection')
  await waitFor(() => viewOf(w1, g1.contents) && w1.isVisible() && flushRight(w1.getBounds(), wa), 'opens docked out against the saved right edge')
  await waitFor(() => visibleHandles().length === 1, 'with one handle')

  // --- 2. Tabs: add.
  smoke.step('tabs: a second pop out joins the same window; strip, count badge, no reload')
  const played = await g1.contents.executeJavaScript('window.startAudio()', true)
  const audioChecked = played === true
  if (!audioChecked) smoke.step(`note: no audio playback here (${played}); skipping the audio check`)
  await popOut(g2)
  await waitFor(() => viewOf(w1, g2.contents), 'g2 shown in the same window')
  assert.equal(miniWindows().length, 1, 'still one mini window')
  await waitFor(() => holds(w1, [g1, g2]), 'the strip lists both tabs')
  assert.equal(viewOf(w1, g1.contents), undefined, 'g1 is the hidden tab (its view detached)')
  await waitFor(async () => (await handleCount(visibleHandles()[0])) === '2', 'the handle shows a count of 2')
  assert.equal(visibleHandles().length, 1, 'one handle for the collection')
  assert.ok(!(await tabs()).some((tab) => tab.id === g1.id || tab.id === g2.id), 'neither is listed in the browser window')
  await intact('two tabs in one window', [g1, g2])

  smoke.step('tabs: the hidden tab keeps playing audio and is never slept or archived')
  if (audioChecked) {
    const t1 = await smoke.evaluate(g1.contents, 'window.tone.currentTime')
    await delay(1500)
    const t2 = await smoke.evaluate(g1.contents, 'window.tone.currentTime')
    smoke.step(`hidden tab audio clock over 1.5 s: +${(t2 - t1).toFixed(2)} s`)
    assert.equal(await smoke.evaluate(g1.contents, 'window.tone.paused'), false, 'not paused')
    assert.ok(t2 - t1 > 0.1, 'audio keeps playing in the hidden tab')
    await smoke.evaluate(g1.contents, 'window.tone.pause(); true')
  }
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
    await smoke.evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "12h", prompted: true })')
    await waitFor(async () => !(await tabs()).some((tab) => tab.id === idle.id), 'the idle tab to be archived')
    await delay(500)
    await intact('hidden collection tab after timed sleep and auto-archive', [g1, g2])
    await smoke.evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "off" })')
    await smoke.evaluate(toolbar, 'window.api.browser.setTabSleepMinutes(0)')
  } finally {
    Date.now = realNow
  }

  smoke.step('tabs: clicking a strip tab switches to it')
  const header1 = headerOf(w1)
  g2.contents.sendInputEvent({ type: 'mouseMove', x: 100, y: 10 })
  await waitFor(() => header1 && viewOf(w1, header1).getBounds().height > 40, 'the header and its tab strip revealed')
  const rect = await smoke.evaluate(header1, `(() => { const r = document.querySelector('.tab[data-tab-id="${g1.id}"] .label').getBoundingClientRect(); return { x: Math.round(r.x + 4), y: Math.round(r.y + r.height / 2) } })()`)
  header1.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y })
  header1.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  header1.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await waitFor(() => viewOf(w1, g1.contents) && !viewOf(w1, g2.contents), 'g1 shown, g2 hidden')
  await intact('switched tabs', [g1, g2])

  const [g3, g4, g5, g6, g7] = [await makePage(3), await makePage(4), await makePage(5), await makePage(6), await makePage(7)]

  // --- 3. Split and merge.
  smoke.step('tabs: dragging a tab out of the strip splits it into its own window under the pointer')
  // Open desktop under the pointer: the browser window narrowed out of the way while splitting (a drop
  // over a browser window puts the tab back in its sidebar instead).
  const mainBounds = mainWindow.getBounds()
  mainWindow.setBounds({ ...mainBounds, width: 200 })
  const splitAt = { x: wa.x + 300, y: wa.y + 300 }
  await smoke.evaluate(header1, `window.miniWindow.tabOut(${JSON.stringify(g2.id)}, ${splitAt.x}, ${splitAt.y}); true`)
  const w2 = await waitFor(() => miniWindows().find((win) => win !== w1 && viewOf(win, g2.contents)), 'g2 in a window of its own')
  await waitFor(() => w2.isVisible(), 'the split-off window shows')
  const b2 = w2.getBounds()
  assert.ok(splitAt.x >= b2.x && splitAt.x < b2.x + b2.width && splitAt.y >= b2.y && splitAt.y < b2.y + 60, `opens with its header under the pointer (${JSON.stringify(b2)})`)
  await waitFor(async () => (await stripTabs(w1)).length === 0 && viewOf(w1, g1.contents), 'the collection keeps g1 (no strip for one tab)')
  await intact('split', [g1, g2])

  smoke.step('tabs: dropping its header on the collection\'s header merges it back')
  await delay(600)
  const b1 = w1.getBounds()
  w2.setBounds({ x: b1.x - 100, y: b1.y + 2, width: b2.width, height: b2.height })
  await waitFor(() => w2.isDestroyed() && miniWindows().length === 1, 'the dropped window merged and closed')
  await waitFor(() => holds(w1, [g1, g2]) && viewOf(w1, g2.contents), 'both tabs in the collection, the dropped one active')
  await intact('merged by header drop', [g1, g2])

  smoke.step('tabs: docking a split-off window to the edge the collection holds merges it')
  await smoke.evaluate(headerOf(w1), `window.miniWindow.tabOut(${JSON.stringify(g2.id)}, ${splitAt.x}, ${splitAt.y}); true`)
  const w3 = await waitFor(() => miniWindows().find((win) => win !== w1 && viewOf(win, g2.contents)), 'split off again')
  await waitFor(() => w3.isVisible(), 'shown')
  await delay(600)
  w3.setBounds(pastRight(w3.getBounds(), wa))
  await waitFor(() => w3.isDestroyed() && miniWindows().length === 1, 'docking it to the right edge merged it into the collection')
  await waitFor(() => holds(w1, [g1, g2]), 'both tabs again')
  await waitFor(() => handleWindows().length === 1 && visibleHandles().length === 1, 'one handle for the edge')
  await waitFor(async () => (await handleCount(visibleHandles()[0])) === '2', 'count 2 on the handle')
  await intact('merged by docking', [g1, g2])
  mainWindow.setBounds(mainBounds)

  // --- 4. Return, Return All, cap.
  smoke.step('tabs: Return sends the active tab back; Return All empties and closes the collection')
  await smoke.evaluate(headerOf(w1), 'document.getElementById("return").click(); true')
  await waitFor(async () => (await tabs()).some((tab) => tab.id === g2.id), 'the active tab (g2) back in the browser')
  await waitFor(() => !w1.isDestroyed() && viewOf(w1, g1.contents), 'the collection keeps g1')
  await waitFor(async () => (await stripTabs(w1)).length === 0, 'no strip with one tab left')
  await popOut(g3)
  await waitFor(() => holds(w1, [g1, g3]), 'g3 joins')
  await waitFor(() => smoke.evaluate(headerOf(w1), 'getComputedStyle(document.getElementById("returnAll")).display !== "none"'), 'Return All shows with two tabs')
  await smoke.evaluate(headerOf(w1), 'document.getElementById("returnAll").click(); true')
  await waitFor(() => w1.isDestroyed() && miniWindows().length === 0, 'Return All closed the collection')
  await waitFor(async () => [g1, g3].every((entry) => true) && (await tabs()).filter((tab) => [g1.id, g3.id].includes(tab.id)).length === 2, 'both back in the browser')
  await waitFor(() => handleWindows().length === 0 && liveContents().filter((c) => isMiniHeader(c) || isHandlePage(c)).length === 0, 'nothing leaked')

  smoke.step('tabs: the cap counts tabs (six in one collection, the seventh refused)')
  for (const entry of [g1, g2, g3, g4, g5, g6]) {
    await popOut(entry)
    await waitFor(() => miniWindows().some((win) => viewOf(win, entry.contents)), `g${entry.n} in the collection`)
  }
  assert.equal(miniWindows().length, 1, 'six tabs, one window')
  const cw = miniWindows()[0]
  await waitFor(() => holds(cw, [g1, g2, g3, g4, g5, g6]), 'six tabs in the strip')
  await popOut(g7)
  await delay(800)
  assert.ok(!(await stripTabs(cw)).includes(g7.id), 'the seventh is refused')
  assert.ok((await tabs()).some((tab) => tab.id === g7.id), 'and stays in the browser')
  await run('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0, 'Return All Mini Windows empties it')
  await intact('after the cap')

  // --- 5. Stack.
  smoke.step('tucked 3-tab collection, then the palette switches to Stack: three windows behind one handle')
  for (const entry of [g1, g2, g3]) {
    await popOut(entry)
    await waitFor(() => miniWindows().some((win) => viewOf(win, entry.contents)), `g${entry.n} popped out`)
  }
  const col = miniWindows()[0]
  assert.equal(miniWindows().length, 1)
  await waitFor(() => col.isVisible() && flushRight(col.getBounds(), wa), 'docked out on the right')
  // Short windows, so three fit along the edge.
  col.setBounds({ ...col.getBounds(), height: 300 })
  await delay(600)
  await run('miniWindow.tuck')
  await waitFor(() => !col.isVisible(), 'the collection tucked')
  const listed = (await smoke.evaluate(toolbar, 'window.api.browser.commands.list()')).commands
  assert.ok(listed.some((command) => command.id === 'miniWindow.grouping.stack' && command.title === 'Mini Window Grouping: Stack'), 'the palette offers Stack grouping')
  assert.equal(listed.find((command) => command.id === 'miniWindow.grouping.tabs')?.enabled, false, 'the current grouping is not offered')
  await run('miniWindow.grouping.stack')
  await waitFor(async () => (await smoke.evaluate(content, 'window.api.browser.miniWindow.getSettings()')).settings.grouping === 'stack', 'grouping saved as stack')
  const stackWin = (entry) => miniWindows().find((win) => viewOf(win, entry.contents))
  await waitFor(() => miniWindows().length === 3 && [g1, g2, g3].every((entry) => stackWin(entry)), 'one window per tab')
  const stack = () => [g1, g2, g3].map(stackWin)
  await waitFor(() => stack().every((win) => !win.isVisible()), 'all three tucked')
  await waitFor(() => visibleHandles().length === 1 && handleWindows().length === 1, 'one handle for the group')
  await waitFor(async () => (await handleCount(visibleHandles()[0])) === '3', 'count 3 on the group handle')
  await waitFor(() => smoke.evaluate(handlePage(visibleHandles()[0]), 'document.querySelectorAll("#icons img").length === 3'), 'the handle fans three favicons')
  await intact('switched to stack', [g1, g2, g3])

  const disjointStack = () => {
    const rects = stack().map((win) => win.getBounds()).sort((a, b) => a.y - b.y)
    if (!rects.every((r) => flushRight(r, wa) && r.y >= wa.y && r.y + r.height <= wa.y + wa.height)) return false
    return rects.every((r, i) => i === 0 || r.y >= rects[i - 1].y + rects[i - 1].height) ? rects : false
  }
  smoke.step('stack: the handle slides the whole group out, stacked along the edge without overlapping')
  await clickHandle(visibleHandles()[0])
  await waitFor(() => stack().every((win) => win.isVisible()) && disjointStack(), `all three out, stacked (got ${JSON.stringify(stack().map((win) => win.getBounds()))})`)
  // Moves within half a second of the dock placing a window are its own (not a user drag).
  await delay(700)
  assert.equal(visibleHandles().length, 1, 'still one handle')

  smoke.step('stack: dragging the first window along the edge moves the others with it')
  const leader = stack().map((win) => ({ win, y: win.getBounds().y })).sort((a, b) => a.y - b.y)[0].win
  const before = stack().map((win) => win.getBounds())
  const lb = leader.getBounds()
  const shift = lb.y - wa.y > 60 ? -50 : 50
  leader.setBounds({ ...lb, y: lb.y + shift })
  await waitFor(() => {
    const now = stack().map((win) => win.getBounds())
    return disjointStack() && now.every((r, i) => r.y !== before[i].y)
  }, `the group followed the leader (before ${JSON.stringify(before)}, now ${JSON.stringify(stack().map((win) => win.getBounds()))})`)
  await delay(800)
  assert.ok(disjointStack(), 'still stacked after the drop')

  smoke.step('stack: dragging one away removes it from the group; docking it back adds it')
  const loner = stack().find((win) => win !== leader)
  const lonerSize = loner.getBounds()
  loner.setBounds({ x: wa.x + 200, y: wa.y + 200, width: lonerSize.width, height: lonerSize.height })
  await waitFor(async () => visibleHandles().length === 1 && (await handleCount(visibleHandles()[0])) === '2', 'the group handle now counts 2')
  assert.equal(loner.isVisible(), true, 'the removed window stays on screen, undocked')
  await delay(600)
  loner.setBounds(pastRight(loner.getBounds(), wa))
  await waitFor(async () => visibleHandles().length === 1 && (await handleCount(visibleHandles()[0])) === '3', 'docking it to the edge adds it back (count 3)')
  await waitFor(() => stack().every((win) => win.isVisible()) && disjointStack(), 'it joins the group out, stacked with the others')
  await intact('stack add/remove', [g1, g2, g3])

  smoke.step('stack: Show/Hide tucks and slides out the group together')
  await delay(400)
  await run('miniWindow.toggle')
  await waitFor(() => stack().every((win) => !win.isVisible()) && visibleHandles().length === 1, 'all tucked behind the one handle')
  await run('miniWindow.toggle')
  await waitFor(() => stack().every((win) => win.isVisible()) && disjointStack(), 'all out again, stacked')
  await delay(400)
  await run('miniWindow.toggle')
  await waitFor(() => stack().every((win) => !win.isVisible()), 'tucked again')

  // --- 6. Stack → tabs.
  smoke.step('switching to tabs merges the windows docked to that edge into one collection')
  await setGrouping('tabs')
  await waitFor(() => miniWindows().length === 1, 'one collection')
  const merged = miniWindows()[0]
  await waitFor(() => holds(merged, [g1, g2, g3]), 'holding all three tabs')
  await waitFor(async () => visibleHandles().length === 1 && (await handleCount(visibleHandles()[0])) === '3', 'one handle, count 3')
  await intact('stack → tabs', [g1, g2, g3])

  // --- 7. Tabs → separate.
  smoke.step('switching to separate splits the collection: three windows, each with its own handle')
  await setGrouping('separate')
  await waitFor(() => miniWindows().length === 3 && [g1, g2, g3].every((entry) => stackWin(entry)), 'one window per tab')
  await waitFor(() => visibleHandles().length === 3, 'three handles (one each)')
  await waitFor(async () => (await Promise.all(visibleHandles().map(handleCount))).every((count) => count === ''), 'no count badge on a single window\'s handle')
  await intact('tabs → separate', [g1, g2, g3])

  // --- 8. Nothing left behind.
  smoke.step('Return All leaves nothing behind')
  await run('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0, 'all mini windows and handles closed')
  await waitFor(() => liveContents().filter((contents) => isMiniHeader(contents) || isHandlePage(contents)).length === 0, 'no header or handle webContents left', 5000)
  await intact('returned')

  console.log('Electron mini window grouping smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window grouping smoke failed:', error)
  app.exit(1)
})
