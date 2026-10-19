// Toolbar pin / overflow smoke (shared/toolbar-layout.ts), against the production build:
//   1. defaults: Bookmarks, Ad blocker and Extensions on the toolbar; Cast and Downloads folded
//      (no media, no downloads); Reading List and History only in the Surffish menu
//   2. the Surffish menu lists what isn't on the toolbar, opens it (popover anchored at the menu
//      button), is keyboard reachable and gives focus back on Escape
//   3. right-click a button → Unpin; the menu's pin button pins one back
//   4. drag to reorder (real mouse input) persists across a toolbar reload
//   5. a narrow window folds buttons into the menu lowest priority first, without flicker, and
//      unfolds them when it widens again
//   6. Settings → Appearance → Toolbar lists every button; Reset to defaults restores them
//   7. a page playing media sets BrowserState.media; Cast stays folded with no Chromecast around
// `bun run build && bun run test:electron-toolbar-overflow`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-toolbar-overflow-smoke.cjs`).
// TOOLBAR_SHOTS=1 prints `TOOLBAR_SHOT <name> <base64 png>` lines (PR screenshots).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-toolbar-overflow-${process.pid}`)
const SHOTS = process.env.TOOLBAR_SHOTS === '1'
const LAYOUT_KEY = 'surffish.toolbar.layout'
const PRIORITY = { downloads: 90, cast: 85, adblock: 70, bookmarks: 60, extensions: 50, 'reading-list': 40, history: 30 }

/** Two seconds of 8 kHz 8-bit mono silence: enough for media-started-playing. */
function silentWav() {
  const samples = 16000
  const buffer = Buffer.alloc(44 + samples, 0x80)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28); buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples, 40)
  return buffer
}
const WAV = silentWav()
const server = createServer((request, response) => {
  if (request.url === '/tone.wav') {
    response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length, 'Cache-Control': 'no-store' })
    return response.end(WAV)
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  if (request.url === '/media') return response.end('<!doctype html><meta charset="utf-8"><title>Media</title><audio id="a" src="/tone.wav" autoplay muted loop></audio><p>media</p>')
  response.end(`<!doctype html><meta charset="utf-8"><title>Page ${request.url}</title><p>${request.url}</p>`)
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

function surfaceOf(contents) {
  try {
    return new URL(contents.getURL()).searchParams.get('surface')
  } catch {
    return null
  }
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG).serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`], activeIndex: 0 }))

  app.on('web-contents-created', (_e, wc) => {
    wc.on('focus', () => console.log('[tb-debug] focus ->', Date.now() % 100000, wc.getURL().slice(-40), 'winFocused', BaseWindow.getAllWindows()[0]?.isFocused()))
    const focusFn = wc.focus.bind(wc)
    wc.focus = () => { console.log('[tb-debug] focus() call', Date.now() % 100000, new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/\(.*\/out\/main\//, '(')).join(' | ')); return focusFn() }
    wc.on('did-finish-load', () => console.log('[tb-debug] loaded', Date.now() % 100000, wc.getURL().slice(-40)))
  })
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 760 })
  console.log('[tb-debug] window found focused', mainWindow.isFocused(), Date.now() % 100000)
  mainWindow.on('focus', () => console.log('[tb-debug] window focus event', Date.now() % 100000))
  mainWindow.on('blur', () => console.log('[tb-debug] window blur event', Date.now() % 100000))
  const viewFor = (surface) => mainWindow.contentView.children.find((view) => surfaceOf(view.webContents) === surface)
  const toolbar = await waitFor(() => viewFor('toolbar'), 'the toolbar surface')
  const sidebar = await waitFor(() => viewFor('sidebar'), 'the sidebar surface')
  const content = await waitFor(() => viewFor('content'), 'the content surface')
  const ready = (view) => waitFor(() => smoke.evaluate(view.webContents, 'document.readyState === "complete" && Boolean(window.api?.browser)'), `the ${surfaceOf(view.webContents)} renderer`)
  toolbar.webContents.on('console-message', (...args) => { const m = String(args[0]?.message ?? args[2]); if (m.includes('tb-debug')) console.log('[toolbar]', Date.now() % 100000, m) })
  toolbar.webContents.on('did-start-navigation', (d) => console.log('[tb-debug] toolbar navigation', Date.now() % 100000, d?.url ?? ''))
  await ready(toolbar)
  await ready(sidebar)
  // The restored tab's page takes keyboard focus on its own once it attaches, a moment after the
  // window shows (natively, no focus() call), which blurs the toolbar and light-dismisses whatever
  // popover a fast test had already opened there. Start once the page has loaded and owns focus.
  const page = await waitFor(() => mainWindow.contentView.children.find((view) => view.webContents.getURL().startsWith(origin)), 'the restored page view')
  await waitFor(() => !page.webContents.isLoading() && page.webContents.isFocused(), 'the restored page to load and take focus')
  const inToolbar = (expression) => smoke.evaluate(toolbar.webContents, expression)
  await waitFor(() => inToolbar('Boolean(document.querySelector(".toolbar-items .toolbar-slot"))'), 'the toolbar buttons')
  const shown = () => inToolbar('[...document.querySelectorAll(".toolbar-items > .toolbar-slot:not(.is-folded)")].map((slot) => slot.dataset.toolbarItem)')
  const folded = () => inToolbar('[...document.querySelectorAll(".toolbar-items > .toolbar-slot.is-folded")].map((slot) => slot.dataset.toolbarItem)')
  const storedLayout = () => inToolbar(`JSON.parse(localStorage.getItem(${JSON.stringify(LAYOUT_KEY)}) || 'null')`)
  // Written from another surface: the toolbar picks it up through the storage event (like Settings).
  const writeLayout = (layout) => smoke.evaluate(sidebar.webContents, `localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(JSON.stringify(layout))})`)
  const center = (selector) => inToolbar(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`)
  const mouse = (type, point, button = 'left', extra = {}) => toolbar.webContents.sendInputEvent({ type, x: point.x, y: point.y, button, clickCount: 1, ...extra })
  const clickAt = async (selector, button = 'left') => {
    const point = await waitFor(() => center(selector), `${selector} on screen`)
    toolbar.webContents.focus()
    mouse('mouseDown', point, button)
    mouse('mouseUp', point, button)
  }
  const key = (keyCode) => {
    toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    toolbar.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  }
  const shot = async (name, view = toolbar, rect) => {
    if (!SHOTS) return
    await delay(350)
    const bounds = view.getBounds()
    const image = await view.webContents.capturePage(rect ?? { x: 0, y: 0, width: bounds.width, height: bounds.height })
    console.log(`TOOLBAR_SHOT ${name} ${image.toPNG().toString('base64')}`)
  }
  const rightPart = () => {
    const { width, height } = toolbar.getBounds()
    return { x: Math.max(0, width - 560), y: 0, width: Math.min(560, width), height }
  }
  const openMenu = async () => {
    // Spaced out so it never counts towards the logo's triple-click easter egg (450 ms bursts).
    await delay(500)
    console.log('[tb-debug] test clicks brand', Date.now() % 100000)
    await clickAt('.toolbar-brand strong')
    await waitFor(() => inToolbar('Boolean(document.querySelector("#surffish-menu"))'), 'the Surffish menu')
  }
  const menuItems = () => inToolbar('[...document.querySelectorAll("#surffish-menu .surffish-menu-item[data-toolbar-item]")].map((item) => item.dataset.toolbarItem)')

  smoke.step('defaults: Bookmarks, Ad blocker, Extensions on the toolbar; the rest folded')
  assert.equal(await storedLayout(), null, 'nothing stored yet (a profile from before this change)')
  await waitFor(async () => JSON.stringify(await shown()) === JSON.stringify(['bookmarks', 'adblock', 'extensions']), 'the default pins (bookmarks, adblock, extensions)')
  assert.equal(await inToolbar('document.querySelector(".downloads-toolbar-button").hidden'), true, 'Downloads folded with no downloads')
  assert.equal(await inToolbar('document.querySelector("button[aria-label=\\"Browsing history\\"]").hidden'), true, 'History in the menu by default')
  assert.equal(await inToolbar('document.querySelector(".reading-list-button").hidden'), true, 'Reading List in the menu by default')
  const castEnabled = (await inToolbar('window.api.browser.cast.snapshot()')).enabled
  if (castEnabled) assert.equal(await inToolbar('document.querySelector(".cast-button")?.hidden'), true, 'Cast folded: no media on the page, no Chromecast')
  await shot('toolbar-wide', toolbar, rightPart())

  smoke.step('the Surffish menu: everything not on the toolbar, keyboard and Escape')
  await openMenu()
  const expected = ['reading-list', ...(castEnabled ? ['cast'] : []), 'history', 'downloads']
  assert.deepEqual(await menuItems(), expected)
  assert.equal(await inToolbar('document.querySelector(".toolbar-brand").getAttribute("aria-expanded")'), 'true')
  assert.ok(await inToolbar('[...document.querySelectorAll("#surffish-menu [role=menuitem]")].map((item) => item.textContent).join("|").includes("Customize toolbar…")'), 'Customize toolbar… in the menu')
  assert.ok(await inToolbar('[...document.querySelectorAll("#surffish-menu, #surffish-menu *")].every((el) => !el.textContent.trim() || parseFloat(getComputedStyle(el).fontSize) >= 11)'), 'menu text is at least 11px')
  await waitFor(() => inToolbar('document.activeElement?.closest("#surffish-menu") !== null && document.activeElement.getAttribute("role") === "menuitem"'), 'focus to move into the menu')
  assert.equal(await inToolbar('document.activeElement?.dataset.toolbarItem'), expected[0], 'focus starts on the first item')
  // Input events and executeJavaScript travel on different pipes: the key can land after the next
  // read, so wait for the focus to move rather than reading it straight away.
  key('Down')
  await waitFor(async () => (await inToolbar('document.activeElement?.dataset.toolbarItem')) === expected[1], `arrow keys to move through the items (to ${expected[1]})`)
  // The toolbar view grows to fit the menu once the renderer reports its extent (next frame + an
  // IPC round trip to main), so the view height is read until it catches up.
  const menuBottom = () => inToolbar('Math.ceil(document.querySelector("#surffish-menu").getBoundingClientRect().bottom)')
  await waitFor(async () => (await menuBottom()) <= toolbar.getBounds().height, 'the toolbar view to grow to fit the menu', 10000)
    .catch(async (error) => { throw new Error(`${error.message} (menu bottom ${await menuBottom()}, view height ${toolbar.getBounds().height})`) })
  await shot('surffish-menu', toolbar, rightPart())
  key('Escape')
  await waitFor(() => inToolbar('!document.querySelector("#surffish-menu") && document.activeElement?.classList.contains("toolbar-brand")'), 'Escape to close the menu and focus the menu button')

  smoke.step('a folded button opens from the menu, anchored at the menu button')
  await openMenu()
  await inToolbar('document.querySelector("#surffish-menu [data-toolbar-item=\\"reading-list\\"]").click()')
  await waitFor(() => inToolbar('Boolean(document.querySelector("#reading-list-popover")) && !document.querySelector("#surffish-menu")'), 'the Reading List popover')
  const anchor = await inToolbar('(() => { const p = document.querySelector("#reading-list-popover").getBoundingClientRect(); const b = document.querySelector(".toolbar-brand").getBoundingClientRect(); return { popoverRight: p.right, brandRight: b.right, popoverLeft: p.left } })()')
  assert.ok(Math.abs(anchor.popoverRight - anchor.brandRight) < 24 && anchor.popoverLeft >= 0, `the popover hangs under the menu button (${JSON.stringify(anchor)})`)
  key('Escape')
  await waitFor(() => inToolbar('!document.querySelector("#reading-list-popover") && document.activeElement?.classList.contains("toolbar-brand")'), 'Escape to close it, focus back on the menu button')

  smoke.step('right-click → Unpin; the menu pin button pins one back')
  await delay(200)
  await clickAt('.bookmarks-menu-button', 'right')
  await waitFor(() => inToolbar('document.querySelector("#toolbar-item-menu [data-action=unpin]")?.textContent.startsWith("Unpin")'), 'the toolbar button menu with Unpin')
  await shot('right-click-menu', toolbar, rightPart())
  await inToolbar('document.querySelector("#toolbar-item-menu [data-action=unpin]").click()')
  await waitFor(async () => !(await shown()).includes('bookmarks'), 'Bookmarks unpinned')
  assert.equal((await storedLayout()).placement.bookmarks, 'menu')
  await openMenu()
  assert.ok((await menuItems()).includes('bookmarks'), 'Bookmarks is in the menu now')
  await inToolbar('document.querySelector("#surffish-menu [data-toolbar-item=\\"history\\"]").closest(".surffish-menu-row").querySelector(".surffish-menu-pin").click()')
  await waitFor(async () => (await shown()).includes('history'), 'History pinned from the menu')
  key('Escape')
  await waitFor(() => inToolbar('!document.querySelector("#surffish-menu")'), 'the menu to close')

  smoke.step('drag to reorder (real mouse), persisted across a reload')
  const before = await shown()
  assert.deepEqual(before, ['adblock', 'history', 'extensions'])
  const from = await center('.toolbar-slot[data-toolbar-item="history"] button')
  const to = await inToolbar('(() => { const r = document.querySelector(".toolbar-slot[data-toolbar-item=\\"adblock\\"]").getBoundingClientRect(); return { x: Math.round(r.left + 3), y: Math.round(r.top + r.height / 2) } })()')
  toolbar.webContents.focus()
  mouse('mouseDown', from)
  for (let index = 1; index <= 6; index += 1) {
    mouse('mouseMove', { x: Math.round(from.x + ((to.x - from.x) * index) / 6), y: from.y }, 'left', { modifiers: ['leftButtonDown'] })
    await delay(30)
  }
  await waitFor(() => inToolbar('Boolean(document.querySelector(".toolbar-slot.is-drag-source"))'), 'the drag to start')
  mouse('mouseUp', to)
  await waitFor(async () => JSON.stringify(await shown()) === JSON.stringify(['history', 'adblock', 'extensions']), 'History to land before the ad blocker')
  assert.equal(await inToolbar('window.api.browser.chrome.get().then((chrome) => chrome.sidebarMode)'), 'tabs', 'the drop does not click the dragged button')
  const order = (await storedLayout()).order
  assert.ok(order.indexOf('history') < order.indexOf('adblock'), `order saved (${order.join(',')})`)
  toolbar.webContents.reload()
  await waitFor(() => inToolbar('document.readyState === "complete" && Boolean(document.querySelector(".toolbar-items .toolbar-slot"))'), 'the reloaded toolbar')
  await waitFor(async () => JSON.stringify(await shown()) === JSON.stringify(['history', 'adblock', 'extensions']), 'the order to survive a reload')

  smoke.step('narrow window: buttons fold lowest priority first, no flicker, and come back')
  await writeLayout({ version: 1, order: ['bookmarks', 'reading-list', 'adblock', 'cast', 'history', 'extensions', 'downloads'], placement: { bookmarks: 'pinned', 'reading-list': 'pinned', adblock: 'pinned', cast: 'pinned', history: 'pinned', extensions: 'pinned', downloads: 'pinned' } })
  const all = ['bookmarks', 'reading-list', 'adblock', ...(castEnabled ? ['cast'] : []), 'history', 'extensions', 'downloads']
  await waitFor(async () => JSON.stringify(await shown()) === JSON.stringify(all), 'every button pinned and shown at 1280px')
  await shot('toolbar-all-pinned', toolbar, rightPart())
  mainWindow.setMinimumSize(400, 400)
  mainWindow.setBounds({ x: 0, y: 0, width: 600, height: 760 })
  await waitFor(async () => (await folded()).length > 0, 'something to fold at 600px')
  await delay(400)
  const samples = []
  for (let index = 0; index < 12; index += 1) {
    samples.push(JSON.stringify(await folded()))
    await delay(60)
  }
  assert.equal(new Set(samples).size, 1, `the folded set holds still (${[...new Set(samples)].join(' / ')})`)
  const narrowFolded = await folded()
  const narrowShown = await shown()
  assert.ok(narrowShown.length > 0 || narrowFolded.length === all.length)
  const lowestShown = Math.min(...narrowShown.map((id) => PRIORITY[id]))
  const highestFolded = Math.max(...narrowFolded.map((id) => PRIORITY[id]))
  assert.ok(narrowShown.length === 0 || lowestShown > highestFolded, `folds lowest priority first (shown ${narrowShown}, folded ${narrowFolded})`)
  const overlap = await inToolbar('(() => { const o = document.querySelector(".omnibox-wrap").getBoundingClientRect(); const t = document.querySelector(".browser-toolbar-trailing").getBoundingClientRect(); return o.right - t.left })()')
  assert.ok(overlap <= 1, `the address bar and the buttons don't overlap (${overlap}px)`)
  await shot('toolbar-narrow', toolbar)
  await openMenu()
  const narrowMenu = await menuItems()
  for (const id of narrowFolded) assert.ok(narrowMenu.includes(id), `${id} (folded) is in the menu`)
  assert.equal(await inToolbar(`document.querySelector('#surffish-menu [data-toolbar-item="${narrowFolded[0]}"]').closest('.surffish-menu-row').querySelector('.surffish-menu-pin').getAttribute('aria-pressed')`), 'true', 'a folded pinned button shows as pinned in the menu')
  await shot('surffish-menu-narrow', toolbar)
  key('Escape')
  await waitFor(() => inToolbar('!document.querySelector("#surffish-menu")'), 'the menu to close')
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 760 })
  await waitFor(async () => (await folded()).length === 0, 'everything back at 1280px')

  smoke.step('Settings → Appearance → Toolbar; Reset to defaults')
  await inToolbar('window.api.browser.settings.open({ section: "settings", focus: "appearance" })')
  await waitFor(() => smoke.evaluate(content.webContents, 'document.querySelectorAll(".toolbar-settings-row").length === 7'), 'the Toolbar settings rows')
  assert.deepEqual(await smoke.evaluate(content.webContents, '[...document.querySelectorAll(".toolbar-settings-row [role=radiogroup]")].map((group) => group.getAttribute("aria-label"))'), ['Bookmarks placement', 'Reading List placement', 'Ad blocker placement', 'Cast placement', 'History placement', 'Extensions placement', 'Downloads placement'])
  await smoke.evaluate(content.webContents, 'document.querySelector(".toolbar-settings").scrollIntoView({ block: "center" })')
  await shot('settings-toolbar', content)
  // Settings changes reach the toolbar (storage event): History → Menu.
  await smoke.evaluate(content.webContents, '[...document.querySelectorAll(".toolbar-settings-row[data-toolbar-item=history] [role=radio]")].find((b) => b.textContent === "Menu").click()')
  await waitFor(async () => !(await shown()).includes('history'), 'History moved to the menu from Settings')
  await smoke.evaluate(content.webContents, '[...document.querySelectorAll(".toolbar-settings button")].find((b) => b.textContent === "Reset to defaults").click()')
  await waitFor(async () => JSON.stringify(await shown()) === JSON.stringify(['bookmarks', 'adblock', 'extensions']), 'the defaults back on the toolbar')
  assert.equal(await smoke.evaluate(content.webContents, '[...document.querySelectorAll(".toolbar-settings button")].find((b) => b.textContent === "Reset to defaults").disabled'), true)

  smoke.step('a page playing media sets BrowserState.media; Cast stays folded with no Chromecast')
  await inToolbar(`window.api.browser.navigate(${JSON.stringify(`${origin}/media`)})`)
  await waitFor(async () => (await inToolbar('window.api.browser.state()')).media === true, 'the media flag for the playing page')
  if (castEnabled) assert.equal(await inToolbar('document.querySelector(".cast-button")?.hidden'), true, 'no Chromecast known: Cast stays folded')
  await inToolbar(`window.api.browser.navigate(${JSON.stringify(`${origin}/quiet`)})`)
  await waitFor(async () => !(await inToolbar('window.api.browser.state()')).media, 'the flag to clear on the next page')

  console.log('Toolbar overflow smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Toolbar overflow smoke failed:', error)
  app.exit(1)
})
