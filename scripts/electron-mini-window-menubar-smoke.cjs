// Integration smoke for mini windows in the menu bar (Tray), against the production build. A Tray
// can't be clicked under Xvfb, so the smoke drives the icon through the app's test hook
// (globalThis.__surffishMiniMenuBar, set by the lazy mini window chunk), which runs the same code as
// the Tray's click and menu:
//   1. Settings saved before the menu bar existed migrate to "when in use"; a page that lived in the
//      menu bar last run is picked back out of the restored tabs into a (hidden) menu bar mini, and
//      the icon exists for it.
//   2. ⌘K "Send Mini Window to Menu Bar" on a floating mini: it drops in under the icon (anchored and
//      clamped to the work area), not movable; its header is the popout strip: always shown (28 px,
//      no panel), the page always under it and never moved by hovering it or the page's top; one tab
//      shows its favicon and title, ⋯ / Pin / Close (Tab order) and the ⋯ menu (Esc while it is up
//      never hides the popout); the page never reloads; a click on the icon hides it, again shows it;
//      hidden keeps the page and audio running (♪ in the title).
//   3. Esc hides it; a click elsewhere (blur) hides it unless pinned (header pin button); the icon click
//      that blurred it shut doesn't reopen it, the next one does.
//   4. Tabs grouping: another tab sent there joins the menu bar collection (one entry, +1) and its tab
//      chips sit in the same strip (still 28 px, the page doesn't move); switching
//      to Separate splits it into two menu bar minis (title "2"), the menu picks which one shows (one
//      popout at a time).
//   5. Right-click menu: Pin, Return to Window, Move to Edge (docks and tucks it), Settings, Hide icon.
//   6. What lives there is saved (never private pages); the icon goes once nothing is there ("when
//      in use"); "always" keeps it with nothing there; "never" removes it, floats menu bar minis out
//      and turns the command off.
// `bun run build && bun run test:electron-mini-window-menubar`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-menubar-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, screen, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-mini-window-menubar-smoke-${process.pid}`)
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><title>Bar ${n}</title>
<style>body{font:16px system-ui;margin:0;height:2000px}</style><body><p>Bar ${n}</p>
<script>window.loadId = Math.random()
window.startAudio = async () => { try { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0.05; osc.connect(gain).connect(ctx.destination); osc.start(); await ctx.resume(); window.tone = ctx; return ctx.state === 'running' } catch (error) { return String(error) } }
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

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const dataTitled = (title) => (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`)
const isMiniHeader = dataTitled('Mini Window')
const isHandlePage = dataTitled('Mini Window Handle')
const allWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed())
const miniWindows = () => allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()))
const handleWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Handle')
const panelWindows = () => allWindows().filter((win) => win.getTitle() === 'Mini Window Header')
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
const headerOf = (win) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && isMiniHeader(view.webContents))?.webContents
const bar = () => globalThis.__surffishMiniMenuBar
const trayExists = () => Boolean(bar()?.exists())
// setMovable is macOS/Windows only: on Linux "in the menu bar" is read from the header instead.
const inMenuBar = (win) => smoke.evaluate(headerOf(win), 'document.body.classList.contains("inmenubar")')
const popoutMenu = () => globalThis.__surffishMiniPopoutMenu
// The popout's always-on strip (shared/mini-window.ts MINI_WINDOW_POPOUT_STRIP_HEIGHT): it adds to the window.
const STRIP = 28
const headerViewOf = (win) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && isMiniHeader(view.webContents))
const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
// What a header shows: the ids of visible elements, and the keyboard's Tab order through it.
const SHOWN = `(() => { const shown = (el) => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const ids = ['back', 'reload', 'where', 'title', 'url', 'tuck', 'menubar', 'more', 'pin', 'return', 'returnAll', 'close', 'strip'].filter((id) => shown(document.getElementById(id)));
  const order = [...document.querySelectorAll('button, [tabindex="0"], input')].filter((el) => shown(el) && el.tabIndex >= 0).map((el) => el.id || (el.classList.contains('tab') ? 'tab' : el.closest('.tab') ? 'tab-close' : el.tagName.toLowerCase()));
  return { ids, order, title: document.getElementById('title').textContent, popout: document.body.classList.contains('popout'), tabs: document.querySelectorAll('#bar .tab').length, stripInRow: document.getElementById('strip').parentElement.id === 'bar', height: document.getElementById('bar').getBoundingClientRect().height } })()`
const menuBarFile = () => (existsSync(join(userData, 'mini-window-menubar.json')) ? JSON.parse(readFileSync(join(userData, 'mini-window-menubar.json'), 'utf8')) : null)

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  // Last run: p4 lived in the menu bar (saved as the window's last tab, like every mini window tab).
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`, `${origin}/p4`], activeIndex: 0 }))
  writeFileSync(join(userData, 'mini-window-menubar.json'), JSON.stringify({ size: { width: 380, height: 420 }, urls: [`${origin}/p4`] }))
  // v0.1.16-format settings: no menu bar icon yet.
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, grouping: 'tabs', headerPlacement: 'float' }))

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
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  const titleOf = () => bar()?.title()
  const menuLabels = () => bar().menu().map((item) => item.label)

  // --- 1. Migration and restore.
  smoke.step('v0.1.16 settings migrate to "when in use"; last run\'s menu bar page comes back there')
  assert.equal((await settings()).menuBarIcon, 'in-use', 'migrated to when in use')
  const p4 = await waitFor(() => pageContents((url, c) => url === `${origin}/p4` && !c.isLoading()), 'the restored menu bar page (p4)')
  const w4 = await waitFor(() => miniWindows().find((win) => viewOf(win, p4)), 'p4 in a mini window')
  await waitFor(() => trayExists(), 'the menu bar icon for it')
  await holds(() => !w4.isVisible(), 'restored hidden (in the menu bar, not on screen)', 500)
  assert.equal(handleWindows().length, 0, 'not docked')
  assert.ok(!(await tabs()).some((tab) => tab.url === `${origin}/p4`), 'no longer a browser tab')
  // The saved popout size applies; anchored under a 24 px icon near the right of the screen.
  const anchor = { x: wa.x + wa.width - 120, y: display.bounds.y, width: 24, height: Math.max(22, wa.y - display.bounds.y) }
  bar().click(anchor)
  await waitFor(() => w4.isVisible(), 'a click on the icon drops it in')
  // The saved size is the page's: the always-on strip adds to the window.
  await waitFor(() => { const b = w4.getBounds(); return b.width === 380 && b.height === 420 + STRIP && b.y === Math.max(anchor.y + anchor.height, wa.y) + 4 }, 'at the saved size (plus the strip), just below the menu bar', 3000)
  await waitFor(() => { const page = viewOf(w4, p4)?.getBounds(); return page && page.y === STRIP && page.height === 420 }, 'the page under the strip at the saved size', 3000)
  const b4 = w4.getBounds()
  assert.ok(b4.x + b4.width <= wa.x + wa.width - 8, `clamped inside the work area (${JSON.stringify(b4)})`)
  assert.ok(Math.abs(b4.x + b4.width / 2 - (anchor.x + 12)) <= 1 || b4.x + b4.width === wa.x + wa.width - 8, 'centred on the icon unless clamped')
  bar().click(anchor)
  await waitFor(() => !w4.isVisible(), 'a second click hides it')
  bar().menu()
  assert.ok(bar().clickMenu('Return to Window'), 'Return to Window from the icon menu')
  await waitFor(() => w4.isDestroyed() && viewOf(mainWindow, p4), 'p4 back in the browser window')
  await waitFor(() => !trayExists(), '"when in use": the icon goes with the last one')
  await waitFor(() => (menuBarFile()?.urls ?? []).length === 0, 'the saved list emptied')

  // --- 2. Send a floating mini there.
  smoke.step('⌘K Send Mini Window to Menu Bar: drops in under the icon, page intact, click toggles, audio keeps playing')
  const pages = []
  for (const n of [1, 2]) {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/p${n}`)})`)
    const contents = await waitFor(() => pageContents((url, c) => url === `${origin}/p${n}` && !c.isLoading()), `page p${n}`)
    await waitFor(() => smoke.evaluate(contents, 'document.readyState === "complete" && typeof window.loadId === "number"'), `page p${n} ready`)
    pages.push({ n, contents, loadId: await smoke.evaluate(contents, 'window.loadId'), id: (await tabs()).find((tab) => tab.url === `${origin}/p${n}`).id })
  }
  const [p1, p2] = pages
  const intact = async (where, entries) => {
    for (const entry of entries) {
      assert.equal(entry.contents.isDestroyed(), false, `${where}: p${entry.n} alive`)
      assert.equal(await smoke.evaluate(entry.contents, 'window.loadId'), entry.loadId, `${where}: p${entry.n} not reloaded`)
    }
  }
  const activate = async (entry) => {
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`)
    await waitFor(async () => (await tabs()).find((tab) => tab.active)?.id === entry.id, `p${entry.n} active`)
  }
  await activate(p1)
  await runCommand('miniWindow.popOut')
  const w1 = await waitFor(() => miniWindows().find((win) => viewOf(win, p1.contents)), 'p1 in a mini window')
  await waitFor(() => w1.isVisible(), 'floating')
  assert.equal(trayExists(), false, 'no icon while nothing lives in the menu bar')
  assert.equal((await command('miniWindow.menuBar'))?.enabled, true, 'the palette offers it')
  await runCommand('miniWindow.menuBar')
  await waitFor(() => trayExists(), 'the icon appears')
  await waitFor(async () => w1.isVisible() && await inMenuBar(w1), 'dropped in')
  if (process.platform !== 'linux') assert.equal(w1.isMovable(), false, 'not movable')
  await waitFor(() => { const b = w1.getBounds(); return b.y === Math.max(wa.y, display.bounds.y) + 4 || b.y >= wa.y }, 'inside the work area under the menu bar')
  assert.equal(panelWindows().filter((win) => win.isVisible()).length, 0, 'no floating header panel')
  const header1 = headerOf(w1)
  assert.ok(header1, 'the header lives in the popout')
  await waitFor(() => smoke.evaluate(header1, 'document.body.classList.contains("popout") && !document.getElementById("pin").hidden'), 'the header is the popout strip, with Pin')
  // Always there, before any hover: the strip at the top, the page under it.
  const [cw1, ch1] = w1.getContentSize()
  await waitFor(() => sameBounds(headerViewOf(w1).getBounds(), { x: 0, y: 0, width: cw1, height: STRIP }), 'the strip shown without a hover')
  const page1 = viewOf(w1, p1.contents).getBounds()
  assert.deepEqual(page1, { x: 0, y: STRIP, width: cw1, height: ch1 - STRIP }, 'the page under the strip')
  let shown = await smoke.evaluate(header1, SHOWN)
  assert.equal(shown.height, STRIP, 'the strip is 28 px')
  assert.deepEqual(shown.ids.filter((id) => ['more', 'pin', 'close'].includes(id)), ['more', 'pin', 'close'], `⋯, Pin and Close shown (${shown.ids})`)
  for (const id of ['back', 'reload', 'tuck', 'menubar', 'return', 'returnAll', 'url', 'strip']) assert.ok(!shown.ids.includes(id), `${id} folded away (${shown.ids})`)
  assert.ok(shown.ids.includes('where') && shown.title === 'Bar 1', `one tab: its title (${JSON.stringify(shown)})`)
  assert.deepEqual(shown.order, ['more', 'pin', 'close'], `Tab order (${shown.order})`)
  // Hovering the page's top and the strip itself never moves the page (or the strip).
  const headerBounds1 = headerViewOf(w1).getBounds()
  for (const y of [2, 10, 30, 44, 60]) p1.contents.sendInputEvent({ type: 'mouseMove', x: 120, y })
  headerViewOf(w1).webContents.sendInputEvent({ type: 'mouseMove', x: 60, y: 12 })
  await holds(() => sameBounds(viewOf(w1, p1.contents).getBounds(), page1) && sameBounds(headerViewOf(w1).getBounds(), headerBounds1), 'no bounds change on hover', 700)
  for (const y of [300, 5, 400]) p1.contents.sendInputEvent({ type: 'mouseMove', x: 200, y })
  await holds(() => sameBounds(viewOf(w1, p1.contents).getBounds(), page1) && sameBounds(headerViewOf(w1).getBounds(), headerBounds1), 'none after leaving it either', 700)
  // ⋯: the native menu with what the strip has no room for; Esc while it is up never hides the popout.
  await smoke.evaluate(header1, 'document.getElementById("more").click()')
  await waitFor(() => popoutMenu()?.open(), 'the ⋯ menu opens')
  const moreItems = popoutMenu().items()
  for (const label of ['Back', 'Reload', 'Pin', 'Float as Mini Window', 'Move to Edge', 'Return to Window', 'Grouping', 'Mini Window Settings…']) assert.ok(moreItems.some((item) => item.label === label), `⋯ has ${label} (${moreItems.map((item) => item.label)})`)
  assert.deepEqual(moreItems.find((item) => item.label === 'Grouping').submenu, ['Tabs', 'Stack', 'Separate'], 'Grouping: Tabs / Stack / Separate')
  assert.equal(moreItems.find((item) => item.label === 'Back').enabled, false, 'Back follows the page')
  assert.equal(await smoke.evaluate(header1, 'document.getElementById("more").getAttribute("aria-expanded")'), 'true', 'aria-expanded while open')
  header1.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  header1.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await holds(() => w1.isVisible(), 'Esc with the menu up: the popout stays', 400)
  popoutMenu().close()
  await waitFor(() => !popoutMenu().open(), 'the menu closed')
  await waitFor(() => smoke.evaluate(header1, 'document.getElementById("more").getAttribute("aria-expanded") === "false"'), 'aria-expanded back to false')
  assert.ok(w1.isVisible(), 'still shown after the menu closed')
  await intact('sent to the menu bar', [p1])
  const played = await p1.contents.executeJavaScript('window.startAudio()', true)
  const audioChecked = played === true
  if (!audioChecked) smoke.step(`note: no audio playback here (${played}); skipping the audio checks`)
  bar().click(anchor)
  await waitFor(() => !w1.isVisible(), 'icon click hides it')
  if (audioChecked) {
    await waitFor(() => p1.contents.isCurrentlyAudible(), 'audio keeps playing while hidden', 5000).catch(() => smoke.step('note: not audible under this runner'))
    if (p1.contents.isCurrentlyAudible()) await waitFor(() => titleOf() === '♪', 'the icon title says it plays', 5000)
    assert.equal(await smoke.evaluate(p1.contents, 'window.tone.state'), 'running', 'the AudioContext still runs while hidden')
  }
  assert.ok(menuBarFile().urls.includes(`${origin}/p1`), 'saved as living in the menu bar')

  // --- 3. Esc, blur, pin.
  smoke.step('Esc hides; a click elsewhere hides unless pinned; the click that blurred it shut does not reopen it')
  bar().click(anchor)
  await waitFor(() => w1.isVisible(), 'shown again')
  await delay(250)
  p1.contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  p1.contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor(() => !w1.isVisible(), 'Esc hides it')
  bar().click(anchor)
  await waitFor(() => w1.isVisible(), 'shown again')
  await delay(250)
  w1.emit('blur')
  await waitFor(() => !w1.isVisible(), 'losing focus hides it')
  // Pressing the icon is what blurred it: that click must not bring it straight back.
  bar().click(anchor)
  await holds(() => !w1.isVisible(), 'the click that blurred it closes it for good', 400)
  bar().click(anchor)
  await waitFor(() => w1.isVisible(), 'the next click shows it')
  await delay(250)
  await smoke.evaluate(header1, 'document.getElementById("pin").click()')
  await waitFor(() => smoke.evaluate(header1, 'document.getElementById("pin").classList.contains("on")'), 'pinned')
  w1.emit('blur')
  await holds(() => w1.isVisible(), 'pinned: stays open when focus goes elsewhere', 500)
  assert.equal(bar().menu().find((item) => item.label === 'Pin Mini Window')?.checked, true, 'the menu shows it pinned')
  assert.ok(bar().clickMenu('Pin Mini Window'), 'unpin from the menu')
  await waitFor(() => smoke.evaluate(header1, '!document.getElementById("pin").classList.contains("on")'), 'unpinned')
  w1.emit('blur')
  await waitFor(() => !w1.isVisible(), 'unpinned: hides on blur again')
  await intact('esc/blur/pin', [p1])

  // --- 4. Tabs grouping: a collection; Separate: two minis, one popout at a time.
  smoke.step('tabs: another tab joins the menu bar collection; separate splits it, the menu picks which shows')
  await activate(p2)
  await delay(500)
  await runCommand('miniWindow.menuBar')
  await waitFor(() => viewOf(w1, p2.contents) || miniWindows().some((win) => win !== w1 && viewOf(win, p2.contents)), 'p2 went to the menu bar')
  assert.equal(miniWindows().length, 1, 'tabs: one menu bar collection')
  await waitFor(() => w1.isVisible(), 'the collection drops in showing p2')
  let entries = bar().menu().filter((item) => item.label.startsWith('Bar '))
  assert.equal(entries.length, 1, `one entry for the collection (${menuLabels().join(' | ')})`)
  // Its tabs sit in the same strip: still 28 px, the page still right under it.
  await waitFor(async () => (await smoke.evaluate(header1, SHOWN)).tabs === 2, 'two tab chips in the strip')
  shown = await smoke.evaluate(header1, SHOWN)
  assert.ok(shown.stripInRow && shown.ids.includes('strip') && !shown.ids.includes('where'), `tabs replace the title, in the row (${JSON.stringify(shown)})`)
  assert.equal(shown.height, STRIP, 'still one 28 px strip')
  assert.equal(headerViewOf(w1).getBounds().height, STRIP, 'the header view stays 28 px')
  assert.equal(viewOf(w1, p2.contents).getBounds().y, STRIP, 'the page stays under it')
  assert.deepEqual(shown.order.filter((id) => !['tab', 'tab-close'].includes(id)), ['more', 'pin', 'close'], `tabs first, then ⋯ / Pin / Close (${shown.order})`)
  assert.equal(shown.order[0], 'tab', `Tab starts on the tabs (${shown.order})`)
  await smoke.evaluate(header1, 'document.getElementById("more").click()')
  await waitFor(() => popoutMenu()?.open(), 'the ⋯ menu opens for the collection')
  assert.ok(popoutMenu().items().some((item) => item.label === 'Return All to Window'), 'Return All for a collection')
  popoutMenu().close()
  await waitFor(() => !popoutMenu().open(), 'closed')
  assert.match(entries[0].label, /\(\+1\)$/, 'it says it holds another tab')
  assert.equal((await update({ grouping: 'separate' })).ok, true)
  await waitFor(() => miniWindows().length === 2, 'split into two menu bar minis')
  await waitFor(() => titleOf()?.startsWith('2'), 'the icon title counts two')
  const w2 = miniWindows().find((win) => viewOf(win, p2.contents)) ?? miniWindows().find((win) => win !== w1)
  const w1now = miniWindows().find((win) => viewOf(win, p1.contents))
  assert.ok(w2 && w1now && w2 !== w1now, 'one each')
  entries = bar().menu().filter((item) => item.label.startsWith('Bar '))
  assert.equal(entries.length, 2, 'the menu lists both')
  assert.ok(entries.every((item) => item.type === 'radio'), 'as a pick list')
  assert.ok(bar().clickMenu('Bar 1'), 'pick p1')
  await waitFor(() => w1now.isVisible() && !w2.isVisible(), 'p1 shows, alone')
  bar().menu()
  assert.ok(bar().clickMenu('Bar 2'), 'pick p2')
  await waitFor(() => w2.isVisible() && !w1now.isVisible(), 'p2 shows; p1 hid (one popout at a time)')
  await intact('regroup in the menu bar', [p1, p2])

  // --- 5. Menu: Move to Edge, Settings, Hide icon.
  smoke.step('menu: Move to Edge docks and tucks it; the rest stays in the menu bar')
  const labels = menuLabels()
  for (const label of ['Pin Mini Window', 'Return to Window', 'Move to Edge', 'Mini Window Settings…']) assert.ok(labels.includes(label), `the menu has ${label}`)
  assert.ok(labels.includes('Hide Menu Bar Icon') || labels.includes('Hide Tray Icon'), 'and Hide icon')
  assert.ok(bar().clickMenu('Move to Edge'), 'Move to Edge')
  await waitFor(() => handleWindows().some((win) => win.isVisible()), 'p2 docked with a handle')
  await waitFor(() => !w2.isVisible(), 'and tucked away')
  await waitFor(() => titleOf() === '' || titleOf() === '♪', 'one left in the menu bar')
  assert.ok(!menuBarFile().urls.includes(`${origin}/p2`), 'no longer saved as a menu bar page')
  // Its handle page has the right-click menu (a native menu, opened over IPC).
  await waitFor(async () => { const page = liveContents().find(isHandlePage); return page && !page.isLoading() && await smoke.evaluate(page, 'typeof window.miniWindow.handleMenu === "function"') }, 'the handle page with its menu bridge')

  // --- 6. Private pages are never saved; icon modes.
  smoke.step('a private tab may live there but is never saved; always/never icon modes')
  // p2 (docked) goes back to the browser first, so the command below acts on the current tab, not on it.
  await runCommand(`miniWindow.return:${p2.id}`)
  await waitFor(() => viewOf(mainWindow, p2.contents) && w2.isDestroyed(), 'p2 back in the browser window')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.createPrivate(${JSON.stringify(`${origin}/p3`)})`)
  const p3 = await waitFor(() => pageContents((url, c) => url === `${origin}/p3` && !c.isLoading()), 'the private page')
  await waitFor(async () => (await tabs()).find((tab) => tab.active)?.url === `${origin}/p3`, 'the private tab active')
  await runCommand('miniWindow.menuBar')
  await waitFor(async () => { const win = miniWindows().find((candidate) => viewOf(candidate, p3)); return win && await inMenuBar(win) }, 'the private page in the menu bar')
  await waitFor(() => titleOf()?.startsWith('2'), 'two there now')
  await delay(700)
  const saved = menuBarFile()
  assert.ok(saved.urls.includes(`${origin}/p1`), 'p1 saved')
  assert.ok(!saved.urls.includes(`${origin}/p3`), 'the private page is never saved')
  assert.equal((await update({ menuBarIcon: 'never' })).ok, true)
  await waitFor(() => !trayExists(), '"never": no icon')
  await waitFor(() => miniWindows().length === 2 && miniWindows().every((win) => win.isVisible()), 'menu bar minis floated out (on screen)')
  // Floating again: the usual auto-hiding header (here 'float': back in its panel, hidden), the page fills the window.
  await waitFor(async () => {
    for (const contents of liveContents().filter(isMiniHeader)) if (await smoke.evaluate(contents, 'document.body.classList.contains("popout")')) return false
    return true
  }, 'no header is a popout strip any more')
  for (const win of miniWindows()) {
    const header = headerViewOf(win)
    assert.ok(!header || header.getBounds().height === 0, `no header shown in the window until hovered (${JSON.stringify(header?.getBounds())})`)
    const page = win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && /\/p\d$/.test(view.webContents.getURL()))
    if (page) assert.equal(page.getBounds().y, 0, 'the page fills the window again')
  }
  if (process.platform !== 'linux') assert.ok(miniWindows().every((win) => win.isMovable()), 'movable again')
  assert.equal((await command('miniWindow.menuBar'))?.enabled, false, 'the command is off')
  assert.equal((await update({ menuBarIcon: 'always' })).ok, true)
  await waitFor(() => trayExists(), '"always": the icon shows with nothing there')
  assert.ok(menuLabels().includes('Open Current Tab in Menu Bar'), 'offering to send the current tab')
  assert.ok(bar().clickMenu(menuLabels().includes('Hide Menu Bar Icon') ? 'Hide Menu Bar Icon' : 'Hide Tray Icon'), 'Hide icon from its menu')
  await waitFor(async () => !trayExists() && (await settings()).menuBarIcon === 'never', 'hidden and saved as never')
  assert.equal((await update({ menuBarIcon: 'in-use' })).ok, true)
  await intact('end', [p1, p2])
  assert.equal(p3.isDestroyed(), false, 'the private page lives on')

  smoke.step('Return All leaves nothing behind')
  await runCommand('miniWindow.return')
  await waitFor(() => miniWindows().length === 0 && handleWindows().length === 0 && panelWindows().length === 0, 'all closed')
  await waitFor(() => !trayExists(), 'no icon')
  await waitFor(() => liveContents().filter((contents) => isHandlePage(contents) || isMiniHeader(contents)).length === 0, 'no handle or header webContents left', 5000)
  console.log('Electron mini window menu bar smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window menu bar smoke failed:', error)
  app.exit(1)
})
