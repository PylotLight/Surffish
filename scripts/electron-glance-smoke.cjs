// Integration smoke for Glance (Shift+click link peek), against the production build:
//   1. Lazy: the glance module is a separate chunk only ever imported dynamically.
//   2. Shift+click a link (real input events) → a glance opens over the tab: no new tab, same session
//      as the tab, two views on top of the window, keyboard focus in the glance page, Diagnostics
//      lists it.
//   3. Links inside navigate within the glance (plain click and target=_blank), the tab is untouched,
//      the visit is in history.
//   4. Esc closes it and destroys both webContents (no leak: webContents and renderer process
//      counts back to where they were, Diagnostics no longer lists it).
//   5. Palette "Open Copied Link in Glance", navigate, then Cmd/Ctrl+Enter promotes it to a real tab
//      next to the source: the same webContents (no reload, a page-side marker survives), back
//      history kept, the header view destroyed.
//   6. A second glance replaces the first; a tab switch closes it; a backdrop click closes it.
//   7. Settings off: Shift+click opens nothing (the old behaviour); back on works again.
//   8. Private tab: the glance runs in the private session and writes no history.
// `bun run build && bun run test:electron-glance`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-glance-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, clipboard, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-glance-smoke-${process.pid}`)
const PAGE = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:0;padding:24px} a{display:inline-block;padding:12px 18px;margin:6px;background:#eef;font-size:18px}</style>
<body><h1>${title}</h1>${body}<script>window.loadId = Math.random()</script></body>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const pages = {
    '/start': PAGE('Start', '<a id="peek" href="/peek">Peek</a> <a id="other" href="/other">Other</a>'),
    '/peek': PAGE('Peek', '<a id="inner" href="/inner">Inner</a> <a id="blank" href="/blank" target="_blank">Blank</a>'),
    '/inner': PAGE('Inner', '<p>inside the glance</p>'),
    '/blank': PAGE('Blank', '<p>target blank landed here</p>'),
    '/other': PAGE('Other', '<p>other</p>'),
    '/private-peek': PAGE('Private Peek', '<p>private</p>')
  }
  response.writeHead(pages[path] ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(pages[path] ?? 'not found')
})

let mainWindow
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const IS_MAC = process.platform === 'darwin'

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
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => surfaceFor(view) === name)
const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const pathOf = (contents) => { try { return new URL(contents.getURL()).pathname } catch { return '' } }
const isGlanceChrome = (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes('<title>Glance</title>')
const glanceChromes = () => liveContents().filter(isGlanceChrome)
const rendererCount = () => app.getAppMetrics().filter((metric) => metric.type === 'Tab').length

/** Real mouse click (down + up) at the centre of `selector` in `contents`, with modifiers. */
async function clickElement(contents, selector, modifiers = []) {
  const rect = await smoke.evaluate(contents, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const base = { x: rect.x, y: rect.y, button: 'left', clickCount: 1, modifiers }
  contents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y, modifiers })
  contents.sendInputEvent({ type: 'mouseDown', ...base })
  contents.sendInputEvent({ type: 'mouseUp', ...base })
}

function key(contents, keyCode, modifiers = []) {
  contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
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

  // --- 1. Lazy: glance.ts is its own chunk, reached only through import().
  smoke.step('glance module is a lazy chunk')
  const outMain = resolve(__dirname, '../out/main')
  const glanceChunk = readdirSync(outMain).find((name) => /^glance-[A-Za-z0-9_-]+\.js$/.test(name) && !name.startsWith('glance-entry'))
  assert.ok(glanceChunk, 'out/main has a glance-*.js chunk')
  for (const name of readdirSync(outMain).filter((file) => file.endsWith('.js') && file !== glanceChunk)) {
    const source = readFileSync(join(outMain, name), 'utf8')
    if (!source.includes(glanceChunk)) continue
    assert.ok(!new RegExp(`from\\s+["']\\./${glanceChunk.replace('.', '\\.')}["']`).test(source), `${name} imports ${glanceChunk} statically`)
    assert.ok(source.includes(`import("./${glanceChunk}")`), `${name} references ${glanceChunk} only through import()`)
  }

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar').webContents
  const content = surface('content').webContents
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => smoke.evaluate(content, 'document.readyState === "complete" && Boolean(window.api)'), 'the content renderer')
  const state = () => smoke.evaluate(toolbar, 'window.api.browser.state()')
  const tabs = () => smoke.evaluate(toolbar, 'window.api.browser.tabs.get()')
  const history = () => smoke.evaluate(content, 'window.api.browser.history.get()')

  await waitFor(async () => { const current = await state(); return current.url === `${origin}/start` && !current.loading }, 'the start page')
  const start = await waitFor(() => pageContents((url) => url === `${origin}/start`), 'the start page contents')
  await waitFor(() => smoke.evaluate(start, 'document.readyState === "complete" && Boolean(document.querySelector("#peek"))'), 'the start page links')
  const startTabId = (await tabs()).find((tab) => tab.active).id
  // Let the lazily made overlays exist before the baseline: the link-status bubble (first link hover)
  // and the tab overview's detached preload (1.5 s after the window opens).
  const peekRect = await smoke.evaluate(start, '(() => { const r = document.querySelector("#peek").getBoundingClientRect(); return { x: Math.round(r.left + 5), y: Math.round(r.top + 5) } })()')
  start.sendInputEvent({ type: 'mouseMove', x: peekRect.x, y: peekRect.y })
  await delay(2000)
  start.sendInputEvent({ type: 'mouseMove', x: 600, y: 700 })
  await delay(300)
  const baseline = { contents: liveContents().length, renderers: rendererCount(), children: mainWindow.contentView.children.length }
  smoke.step(`baseline: ${baseline.contents} webContents, ${baseline.renderers} renderers, ${baseline.children} views`)

  const openedGlance = async (path, description) => {
    const page = await waitFor(() => pageContents((url, contents) => url === `${origin}${path}` && contents !== start && !contents.isLoading()), description)
    await waitFor(() => glanceChromes().length === 1, 'the glance header view')
    await waitFor(() => mainWindow.contentView.children.at(-1)?.webContents === page, 'the glance page view on top of the window')
    return page
  }
  const assertClosed = async (description) => {
    await delay(300)
    if (process.env.GLANCE_SMOKE_DEBUG) console.log('live:', liveContents().map((contents) => `${contents.id}:${contents.getType()}:${contents.getURL().slice(0, 60)}`).join(' | '))
    await waitFor(() => glanceChromes().length === 0 && liveContents().length === baseline.contents, `${description}: glance webContents destroyed (${liveContents().length} vs ${baseline.contents})`)
    await waitFor(() => mainWindow.contentView.children.length === baseline.children, `${description}: glance views gone from the window`)
    await waitFor(() => rendererCount() <= baseline.renderers, `${description}: glance renderer processes exit (${rendererCount()} vs ${baseline.renderers})`)
  }

  // --- 2. Shift+click opens a glance
  smoke.step('Shift+click opens a glance')
  await clickElement(start, '#peek', ['shift'])
  const glance = await openedGlance('/peek', 'a glance for the Shift+clicked link')
  assert.equal((await tabs()).length, 1, 'no new tab for a glance')
  assert.equal(glance.session, start.session, 'the glance runs in the tab session')
  assert.equal((await state()).url, `${origin}/start`, 'the tab still shows the start page')
  const top = mainWindow.contentView.children.slice(-2).map((view) => view.webContents)
  assert.ok(isGlanceChrome(top[0]) && top[1] === glance, 'header/backdrop view then the page, above every shell surface')
  const pageBounds = mainWindow.contentView.children.at(-1).getBounds()
  assert.ok(pageBounds.width > 900 && pageBounds.width < 1200 && pageBounds.x > 0, `the card is ~85% of the window (${JSON.stringify(pageBounds)})`)
  await waitFor(() => glance.isFocused(), 'keyboard focus in the glance page')
  if (process.env.GLANCE_SMOKE_SHOTS) {
    // Optional screenshots for a manual look: the header/backdrop view and the page view.
    await delay(400)
    const shots = process.env.GLANCE_SMOKE_SHOTS
    mkdirSync(shots, { recursive: true })
    const chromeView = mainWindow.contentView.children.at(-2)
    writeFileSync(join(shots, 'glance-chrome.png'), (await chromeView.webContents.capturePage()).toPNG())
    writeFileSync(join(shots, 'glance-page.png'), (await glance.capturePage()).toPNG())
    writeFileSync(join(shots, 'tab-page.png'), (await start.capturePage()).toPNG())
    writeFileSync(join(shots, 'layout.json'), JSON.stringify({ page: mainWindow.contentView.children.at(-1).getBounds(), chrome: chromeView.getBounds() }))
  }
  // Diagnostics (task manager) lists the glance while it is open.
  const diagnostics = await smoke.evaluate(content, 'window.api.browser.diagnostics.watch(true)')
  assert.ok(JSON.stringify(diagnostics).includes('Glance: 127.0.0.1'), 'Diagnostics lists the glance page')
  await smoke.evaluate(content, 'window.api.browser.diagnostics.watch(false)')

  // --- 3. Navigate inside
  smoke.step('links inside navigate within the glance')
  const glanceId = glance.id
  await clickElement(glance, '#blank')
  await waitFor(() => pathOf(glance) === '/blank' && !glance.isLoading(), 'target=_blank to load inside the glance')
  glance.navigationHistory.goBack()
  await waitFor(() => pathOf(glance) === '/peek' && !glance.isLoading(), 'back to /peek inside the glance')
  await waitFor(() => smoke.evaluate(glance, 'Boolean(document.querySelector("#inner"))'), 'the /peek links')
  // Right after a back navigation (often a back/forward-cache restore) the page can drop a synthetic
  // click that lands before it is hit-testable again; a real user just clicks again, so do we.
  await waitFor(async () => {
    if (pathOf(glance) === '/peek' && !glance.isLoading()) {
      await clickElement(glance, '#inner')
      await delay(700)
    }
    return pathOf(glance) === '/inner' && !glance.isLoading()
  }, 'a plain link to load inside the glance')
  assert.equal(glance.id, glanceId, 'same glance webContents')
  assert.equal((await tabs()).length, 1, 'still no new tab')
  assert.equal((await state()).url, `${origin}/start`, 'the tab is untouched')
  await waitFor(async () => (await history()).some((entry) => entry.url === `${origin}/inner`), 'the glance visit in history')

  // --- 4. Esc closes, nothing leaks
  smoke.step('Esc closes the glance and destroys it')
  key(glance, 'Escape')
  await assertClosed('Esc')
  assert.ok(glance.isDestroyed(), 'the glance page webContents is destroyed')
  await waitFor(() => start.isFocused(), 'focus back on the tab page')
  const afterClose = await smoke.evaluate(content, 'window.api.browser.diagnostics.watch(true)')
  assert.ok(!JSON.stringify(afterClose).includes('Glance:'), 'Diagnostics no longer lists a glance')
  await smoke.evaluate(content, 'window.api.browser.diagnostics.watch(false)')

  // --- 5. Palette entry + promote to tab (no reload, history kept)
  smoke.step('palette opens a glance; Cmd/Ctrl+Enter promotes it to a tab without reloading')
  clipboard.writeText(`${origin}/peek`)
  const commandIds = (await smoke.evaluate(toolbar, 'window.api.browser.commands.list()')).commands.map((command) => command.id)
  assert.ok(commandIds.includes('glance.openCopiedLink'), 'the palette lists Open Copied Link in Glance')
  assert.equal(await smoke.evaluate(toolbar, 'window.api.browser.commands.run("glance.openCopiedLink")'), true)
  const promoted = await openedGlance('/peek', 'a glance from the palette')
  await waitFor(() => smoke.evaluate(promoted, 'Boolean(document.querySelector("#inner"))'), 'the /peek links')
  await clickElement(promoted, '#inner')
  await waitFor(() => pathOf(promoted) === '/inner' && !promoted.isLoading(), 'navigation inside the glance before promoting')
  await smoke.evaluate(promoted, 'window.__glanceMarker = 4242; true')
  const loadId = await smoke.evaluate(promoted, 'window.loadId')
  smoke.step('promoting with Cmd/Ctrl+Enter')
  key(promoted, 'Enter', [IS_MAC ? 'meta' : 'control'])
  const promotedTab = await waitFor(async () => { const list = await tabs(); return list.length === 2 && list.find((tab) => tab.active && tab.url === `${origin}/inner`) }, 'the glance promoted to an active tab')
  const list = await tabs()
  assert.deepEqual(list.map((tab) => tab.id), [startTabId, promotedTab.id], 'the new tab sits right after the tab it came from')
  assert.ok(!promoted.isDestroyed(), 'the same webContents lives on as the tab')
  assert.equal(await smoke.evaluate(promoted, 'window.__glanceMarker'), 4242, 'no reload: page state survived')
  assert.equal(await smoke.evaluate(promoted, 'window.loadId'), loadId, 'no reload: same document')
  assert.equal(promoted.navigationHistory.canGoBack(), true, 'back history kept')
  await waitFor(() => glanceChromes().length === 0, 'the glance header view destroyed')
  const current = await state()
  assert.equal(current.url, `${origin}/inner`)
  assert.equal(current.canGoBack, true, 'the toolbar sees the back history')
  await waitFor(() => mainWindow.contentView.children.some((view) => view.webContents === promoted) && promoted.isFocused(), 'the promoted tab on screen with focus')
  // Back in the promoted tab goes to /peek, in the same webContents (it is a normal tab now).
  await smoke.evaluate(toolbar, 'window.api.browser.back()')
  await waitFor(() => pathOf(promoted) === '/peek', 'Back in the promoted tab')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.close(${JSON.stringify(promotedTab.id)})`)
  await waitFor(async () => (await tabs()).length === 1 && (await state()).url === `${origin}/start`, 'back to the start tab')
  await waitFor(() => promoted.isDestroyed(), 'the promoted tab destroyed with its tab')
  await assertClosed('promote + close tab')

  // --- 6. Replace, tab switch, backdrop click
  smoke.step('a second glance replaces the first; tab switch and backdrop close it')
  await clickElement(start, '#peek', ['shift'])
  const first = await openedGlance('/peek', 'glance #1')
  // Shift+click another link on the tab (as if from under the sheet): the new glance replaces the open one.
  await clickElement(start, '#other', ['shift'])
  const second = await openedGlance('/other', 'glance #2')
  await waitFor(() => first.isDestroyed(), 'glance #1 destroyed when #2 opened')
  assert.equal(glanceChromes().length, 1, 'one glance per window')
  assert.equal((await tabs()).length, 1)
  // Backdrop: a real press outside the card on the header/backdrop view.
  const chrome = glanceChromes()[0]
  chrome.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 })
  chrome.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 })
  await assertClosed('backdrop click')
  assert.ok(second.isDestroyed())
  // Tab switch: open a second tab while a glance is up.
  await clickElement(start, '#peek', ['shift'])
  const third = await openedGlance('/peek', 'glance #3')
  // Switching to another tab (here: a new one) closes the glance with its tab.
  await smoke.evaluate(toolbar, 'window.api.browser.tabs.create()')
  await waitFor(() => third.isDestroyed(), 'the glance closed with the tab switch')
  const newTab = (await tabs()).find((tab) => tab.active)
  await smoke.evaluate(toolbar, `window.api.browser.tabs.close(${JSON.stringify(newTab.id)})`)
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(startTabId)})`)
  await waitFor(async () => (await tabs()).length === 1, 'one tab again')
  const startAgain = start
  assert.ok(!startAgain.isDestroyed(), 'the start tab kept its page')
  await waitFor(() => startAgain.isFocused() || mainWindow.contentView.children.some((view) => view.webContents === startAgain), 'the start tab on screen again')
  await waitFor(() => glanceChromes().length === 0, 'no glance left')

  // Open in Split View (header button): the glance becomes a tab in a split next to the source, no reload.
  smoke.step('Open in Split View from the glance header')
  await clickElement(startAgain, '#peek', ['shift'])
  const toSplit = await openedGlance('/peek', 'a glance to split')
  await smoke.evaluate(toSplit, 'window.__splitMarker = 7; true')
  // Splitting closes the glance header itself, so its webContents can be destroyed before the reply arrives.
  await smoke.evaluate(glanceChromes()[0], 'window.glance.split(); true').catch((error) => {
    if (!error.destroyed) throw error
  })
  const split = await waitFor(async () => { const snapshot = await smoke.evaluate(toolbar, 'window.api.browser.split.get()'); return snapshot.visible && snapshot.splits[0] }, 'a split with the glance page')
  const splitTabs = await tabs()
  assert.equal(splitTabs.length, 2)
  assert.deepEqual(split.tabIds, [startTabId, splitTabs[1].id], 'source on the left, the glance page on the right')
  assert.equal(await smoke.evaluate(toSplit, 'window.__splitMarker'), 7, 'no reload when split')
  await waitFor(() => glanceChromes().length === 0, 'the glance header gone after splitting')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.close(${JSON.stringify(splitTabs[1].id)})`)
  await waitFor(async () => (await tabs()).length === 1 && toSplit.isDestroyed(), 'the split pane closed')

  // --- 7. Settings off: Shift+click keeps the old behaviour (no glance, no tab)
  smoke.step('Settings off: Shift+click opens nothing')
  assert.deepEqual(await smoke.evaluate(content, 'window.api.browser.glance.setShiftClick(false)'), { shiftClick: false })
  await clickElement(startAgain, '#peek', ['shift'])
  await delay(1500)
  assert.equal(glanceChromes().length, 0, 'no glance while off')
  assert.equal(pageContents((url) => url === `${origin}/peek`), undefined, 'nothing loaded the link')
  assert.equal((await tabs()).length, 1, 'no tab either (Shift+click popups stay blocked as before)')
  assert.equal(JSON.parse(readFileSync(join(userData, 'browser-glance.json'), 'utf8')).shiftClick, false)
  assert.deepEqual(await smoke.evaluate(content, 'window.api.browser.glance.setShiftClick(true)'), { shiftClick: true })
  await clickElement(startAgain, '#peek', ['shift'])
  const backOn = await openedGlance('/peek', 'a glance after turning it back on')
  key(backOn, 'w', [IS_MAC ? 'meta' : 'control'])
  await waitFor(() => backOn.isDestroyed(), 'Cmd/Ctrl+W closes the glance (not the tab)')
  assert.equal((await tabs()).length, 1, 'Cmd/Ctrl+W in a glance left the tab alone')

  // --- 8. Private tab: private session, no history
  smoke.step('private tab: glance in the private session, no history')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.createPrivate(${JSON.stringify(`${origin}/start`)})`)
  const privateStart = await waitFor(() => pageContents((url, contents) => url === `${origin}/start` && contents.session !== startAgain.session && !contents.isLoading()), 'the private start page')
  await waitFor(() => smoke.evaluate(privateStart, 'Boolean(document.querySelector("#peek"))'), 'the private start links')
  await smoke.evaluate(privateStart, 'document.querySelector("#peek").href = "/private-peek"; true')
  await clickElement(privateStart, '#peek', ['shift'])
  const privateGlance = await waitFor(() => pageContents((url) => url === `${origin}/private-peek`), 'a glance from the private tab')
  await waitFor(() => !privateGlance.isLoading(), 'the private glance to load')
  assert.equal(privateGlance.session, privateStart.session, 'the glance uses the private session')
  await delay(500)
  assert.ok(!(await history()).some((entry) => entry.url.includes('/private-peek')), 'a private glance writes no history')
  key(privateGlance, 'Escape')
  await waitFor(() => privateGlance.isDestroyed() && glanceChromes().length === 0, 'the private glance closed')

  console.log('Electron glance smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron glance smoke failed:', error)
  app.exit(1)
})
