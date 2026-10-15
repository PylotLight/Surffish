// Integration smoke for the mini window (a tab's live page in a small always-on-top window), against
// the production build:
//   1. Lazy: the mini-window module is a separate chunk only ever imported dynamically.
//   2. Palette "Pop Out to Mini Window": the active tab's own webContents moves into a second,
//      frameless, always-on-top window (no reload: a page-side marker and typed text survive), the
//      browser window no longer lists it and shows its neighbour, the header strip is collapsed
//      until the pointer nears the top of the page, then revealed.
//   3. Never treated as a background tab: with the clock 13 h ahead, timed tab sleep and auto-archive
//      take an idle tab in the browser window but leave the mini window's tab loaded and visible.
//   4. "Return Mini Window to Browser": the same webContents back in the browser window (no reload),
//      the mini window closed, no leaked header webContents.
//   5. Cmd/Ctrl+Shift+M pops the active tab out; the same keys pressed in the mini page put it back.
//   6. The toggle shortcut path: the default global shortcut is registered with the OS; with a pinned
//      default page set, "Toggle Mini Window" (what the shortcut runs) opens it in the normal profile
//      session (a cookie set in a browser tab is there), then hides and shows it.
//   7. Closing the browser window keeps the mini window (and its page) alive; Return then opens a
//      new browser window with the tab in it.
//   8. A private tab pops out and back and stays in the private session.
// `bun run build && bun run test:electron-mini-window`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, globalShortcut, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-mini-window-smoke-${process.pid}`)
const PAGE = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:0;padding:24px;min-height:1500px}</style>
<body><h1>${title}</h1>${body}<script>window.loadId = Math.random()</script></body>`
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const pages = {
    '/start': PAGE('Start', '<p>start</p>'),
    '/chat': PAGE('Chat', '<textarea id="prompt"></textarea>'),
    '/idle': PAGE('Idle', '<p>idle</p>'),
    '/pinned': PAGE('Pinned', '<p>pinned page</p>'),
    '/private': PAGE('Private', '<p>private</p>')
  }
  response.writeHead(pages[path] ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(pages[path] ?? 'not found')
})

let mainWindow
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const IS_MAC = process.platform === 'darwin'
const PRIMARY = IS_MAC ? 'meta' : 'control'

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
const isMiniHeader = (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes('<title>Mini Window</title>')
const miniHeaders = () => liveContents().filter(isMiniHeader)
const browserWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed() && win.contentView.children.some((view) => surfaceFor(view) === 'toolbar'))
const miniWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed() && win.contentView.children.some((view) => view.webContents && !view.webContents.isDestroyed() && isMiniHeader(view.webContents)))
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)

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
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`, `${origin}/chat`, `${origin}/idle`], activeIndex: 1 }))

  // --- 1. Lazy: mini-window.ts is its own chunk, reached only through import().
  smoke.step('mini window module is a lazy chunk')
  const outMain = resolve(__dirname, '../out/main')
  const chunk = readdirSync(outMain).find((name) => /^mini-window-[A-Za-z0-9_-]+\.js$/.test(name) && !name.startsWith('mini-window-entry') && !name.startsWith('mini-window-page'))
  assert.ok(chunk, 'out/main has a mini-window-*.js chunk')
  for (const name of readdirSync(outMain).filter((file) => file.endsWith('.js') && file !== chunk)) {
    const source = readFileSync(join(outMain, name), 'utf8')
    if (!source.includes(chunk)) continue
    assert.ok(!new RegExp(`from\\s+["']\\./${chunk.replace('.', '\\.')}["']`).test(source), `${name} imports ${chunk} statically`)
    assert.ok(source.includes(`import("./${chunk}")`), `${name} references ${chunk} only through import()`)
  }

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
  const tabs = (contents = toolbar) => smoke.evaluate(contents, 'window.api.browser.tabs.get()')
  const run = (id, contents = toolbar) => smoke.evaluate(contents, `window.api.browser.commands.run(${JSON.stringify(id)})`)

  const chat = await waitFor(() => pageContents((url, contents) => url === `${origin}/chat` && !contents.isLoading()), 'the chat page')
  await waitFor(() => smoke.evaluate(chat, 'document.readyState === "complete"'), 'the chat page to load')
  const chatTabId = (await tabs()).find((tab) => tab.active).id
  // Page state that a reload would lose.
  await smoke.evaluate(chat, 'window.marker = "kept"; document.querySelector("#prompt").value = "half-typed question"; true')
  const loadId = await smoke.evaluate(chat, 'window.loadId')
  const baselineIds = new Set(liveContents().map((contents) => contents.id))

  // --- 2. Pop out from the palette.
  smoke.step('pop out the active tab: same webContents, no reload, always on top')
  assert.ok((await smoke.evaluate(toolbar, 'window.api.browser.commands.list()')).commands.some((command) => command.id === 'miniWindow.popOut' && command.enabled !== false), 'the palette lists Pop Out to Mini Window')
  await run('miniWindow.popOut')
  const mini = await waitFor(() => miniWindows()[0], 'the mini window')
  await waitFor(() => viewOf(mini, chat), 'the chat page view in the mini window')
  await waitFor(() => mini.isVisible(), 'the mini window to show')
  assert.equal(chat.isDestroyed(), false, 'the page was not recreated')
  assert.equal(await smoke.evaluate(chat, 'window.marker'), 'kept', 'page state survived (no reload)')
  assert.equal(await smoke.evaluate(chat, 'window.loadId'), loadId, 'same document (no reload)')
  assert.equal(await smoke.evaluate(chat, 'document.querySelector("#prompt").value'), 'half-typed question', 'typed text survived')
  assert.equal(mini.isAlwaysOnTop(), true, 'the mini window is always on top')
  assert.equal(viewOf(mainWindow, chat), undefined, 'the page view left the browser window')
  const afterPopOut = await tabs()
  assert.ok(!afterPopOut.some((tab) => tab.id === chatTabId), 'the browser window no longer lists the tab')
  assert.equal(afterPopOut.length, 2, 'the other tabs stay')
  assert.ok(afterPopOut.some((tab) => tab.active), 'the browser window shows another tab')
  const [miniWidth, miniHeight] = mini.getContentSize()
  assert.ok(miniWidth < 1200 && miniHeight < 800 && miniWidth >= 280, `a small window (${miniWidth}x${miniHeight})`)
  assert.deepEqual(viewOf(mini, chat).getBounds(), { x: 0, y: 0, width: miniWidth, height: miniHeight }, 'the page fills the mini window')
  assert.equal(await smoke.evaluate(chat, 'document.visibilityState'), 'visible', 'the page is visible in the mini window')
  // Header: collapsed until the pointer nears the top of the page.
  const header = await waitFor(() => miniHeaders()[0], 'the mini window header')
  const headerView = viewOf(mini, header)
  assert.ok(headerView, 'the header view is in the mini window')
  assert.equal(headerView.getBounds().height, 0, 'the header starts collapsed')
  await waitFor(() => smoke.evaluate(header, 'document.getElementById("title").textContent === "Chat"'), 'the header to show the page title')
  chat.sendInputEvent({ type: 'mouseMove', x: 120, y: 10 })
  await waitFor(() => headerView.getBounds().height > 0, 'the header to reveal near the top')
  chat.sendInputEvent({ type: 'mouseMove', x: 120, y: 300 })
  await waitFor(() => headerView.getBounds().height === 0, 'the header to hide again', 5000)
  // Diagnostics names it.
  const diagnostics = await smoke.evaluate(content, 'window.api.browser.diagnostics ? window.api.browser.diagnostics.get?.() ?? null : null').catch(() => null)
  if (diagnostics?.tabs) assert.ok(diagnostics.tabs.some((entry) => String(entry.title).startsWith('Mini Window:')), 'Task Manager lists the mini window tab')

  // --- 3. Never background: timed sleep and auto-archive skip it.
  smoke.step('tab sleep and auto-archive leave the mini window tab alone')
  const idle = await waitFor(() => (async () => (await tabs()).find((tab) => tab.url === `${origin}/idle`))(), 'the idle tab')
  const startTab = (await tabs()).find((tab) => tab.url === `${origin}/start`)
  // Load the idle tab once (a restored, never-loaded tab has nothing to sleep), then leave it.
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
    assert.equal(chat.isDestroyed(), false, 'the mini window tab was not slept')
    assert.equal(await smoke.evaluate(chat, 'window.marker'), 'kept', 'the mini window page is untouched')
    await smoke.evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "12h", prompted: true })')
    await waitFor(async () => !(await tabs()).some((tab) => tab.id === idle.id), 'the idle tab to be archived')
    await delay(500)
    assert.equal(chat.isDestroyed(), false, 'the mini window tab was not archived')
    await smoke.evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "off" })')
    await smoke.evaluate(toolbar, 'window.api.browser.setTabSleepMinutes(0)')
  } finally {
    Date.now = realNow
  }

  // --- 4. Return to the browser: same webContents again.
  smoke.step('return to browser: same webContents, mini window closed')
  await run('miniWindow.return')
  await waitFor(() => viewOf(mainWindow, chat), 'the chat page back in the browser window')
  await waitFor(() => miniWindows().length === 0 && mini.isDestroyed(), 'the mini window to close')
  await waitFor(() => miniHeaders().length === 0, 'the header webContents to be destroyed')
  assert.equal(await smoke.evaluate(chat, 'window.marker'), 'kept', 'no reload on the way back')
  assert.equal(await smoke.evaluate(chat, 'window.loadId'), loadId, 'same document on the way back')
  const returned = await tabs()
  assert.equal(returned.find((tab) => tab.active)?.id, chatTabId, 'the returned tab is active in the browser window')
  // Only webContents the browser itself made meanwhile (the idle tab's load, overlays) may be new; nothing of the mini window's.
  const extra = liveContents().filter((contents) => !baselineIds.has(contents.id))
  assert.ok(!extra.some(isMiniHeader), 'no leaked mini window header')

  // --- 5. Keyboard shortcut both ways.
  smoke.step('Cmd/Ctrl+Shift+M pops out and puts back')
  key(chat, 'M', [PRIMARY, 'shift'])
  const keyed = await waitFor(() => miniWindows()[0], 'the mini window from the shortcut')
  await waitFor(() => viewOf(keyed, chat), 'the page in the mini window (shortcut)')
  key(chat, 'M', [PRIMARY, 'shift'])
  await waitFor(() => viewOf(mainWindow, chat) && keyed.isDestroyed(), 'the shortcut in the mini window to put it back')
  assert.equal(await smoke.evaluate(chat, 'window.marker'), 'kept', 'still no reload')

  // --- 6. Toggle shortcut path with a pinned default page.
  smoke.step('global toggle: registered; opens the pinned page in the normal profile, hides and shows')
  const initial = await smoke.evaluate(content, 'window.api.browser.miniWindow.getSettings()')
  assert.equal(initial.settings.defaultUrl, '', 'no default page out of the box')
  assert.equal(initial.settings.shortcut, 'CommandOrControl+Shift+Space')
  if (initial.status.registered) assert.equal(globalShortcut.isRegistered('CommandOrControl+Shift+Space'), true, 'the OS shortcut is registered')
  else smoke.step(`note: global shortcut not registered here (${initial.status.error})`)
  const bad = await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ shortcut: "CmdOrCtrl+K" })')
  assert.equal(bad.ok, true)
  assert.equal(bad.status.registered, false, 'a shortcut Surffish already uses is not registered')
  assert.match(String(bad.status.error), /Surffish/)
  await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ shortcut: "CommandOrControl+Shift+Space" })')
  assert.equal((await smoke.evaluate(content, 'window.api.browser.miniWindow.update({ defaultUrl: "javascript:alert(1)" })')).ok, false, 'non-web default pages are refused')
  const saved = await smoke.evaluate(content, `window.api.browser.miniWindow.update({ defaultUrl: ${JSON.stringify(`${origin}/pinned`)} })`)
  assert.equal(saved.ok, true)
  assert.equal(JSON.parse(readFileSync(join(userData, 'browser-mini-window.json'), 'utf8')).defaultUrl, `${origin}/pinned`)
  await smoke.evaluate(chat, 'document.cookie = "profile=normal; path=/"; true')
  const tabCountBefore = (await tabs()).length
  await run('miniWindow.toggle')
  const pinnedWindow = await waitFor(() => miniWindows()[0], 'the mini window with the pinned page')
  const pinned = await waitFor(() => pageContents((url, contents) => url === `${origin}/pinned` && !contents.isLoading()), 'the pinned page')
  await waitFor(() => viewOf(pinnedWindow, pinned) && pinnedWindow.isVisible(), 'the pinned page shown in the mini window')
  assert.equal(await smoke.evaluate(pinned, 'document.cookie'), 'profile=normal', 'the pinned page has the normal profile cookies')
  assert.equal(pinned.session, chat.session, 'the normal profile session')
  assert.equal((await tabs()).length, tabCountBefore, 'the pinned page is not a browser-window tab')
  await run('miniWindow.toggle')
  await waitFor(() => !pinnedWindow.isVisible(), 'toggle hides the mini window')
  assert.equal(pinned.isDestroyed(), false, 'hiding keeps the page')
  await run('miniWindow.toggle')
  await waitFor(() => pinnedWindow.isVisible(), 'toggle shows it again')
  // A link opened from the mini window goes to the browser window, not into the mini window.
  await smoke.evaluate(pinned, `window.open(${JSON.stringify(`${origin}/start?from-mini`)}, '_blank'); true`)
  await waitFor(async () => (await tabs()).some((tab) => tab.url === `${origin}/start?from-mini`), 'a link from the mini window to open in the browser window')
  assert.equal(pinnedWindow.contentView.children.filter((view) => view.webContents && !isMiniHeader(view.webContents)).length, 1, 'the mini window still holds one page')

  // --- 7. Closing the browser window keeps the mini window.
  smoke.step('closing the browser window keeps the mini window; Return opens a new browser window')
  mainWindow.close()
  await waitFor(() => mainWindow.isDestroyed(), 'the browser window to close')
  await delay(500)
  assert.equal(pinnedWindow.isDestroyed(), false, 'the mini window survives')
  assert.equal(pinned.isDestroyed(), false, 'its page survives')
  assert.equal(await smoke.evaluate(pinned, 'document.title'), 'Pinned')
  // The header's Return button.
  const pinnedHeader = miniHeaders()[0]
  await smoke.evaluate(pinnedHeader, 'document.getElementById("return").click(); true')
  mainWindow = await waitFor(() => browserWindows().find((win) => viewOf(win, pinned)), 'a new browser window with the returned tab')
  await waitFor(() => pinnedWindow.isDestroyed(), 'the mini window to close after Return')
  assert.equal(await smoke.evaluate(pinned, 'document.title'), 'Pinned', 'the returned page did not reload away')
  const toolbar2 = await waitFor(() => surface(mainWindow, 'toolbar')?.webContents, 'the new window toolbar')
  await waitFor(() => smoke.evaluate(toolbar2, 'document.readyState === "complete" && Boolean(window.api)'), 'the new toolbar renderer')
  await waitFor(async () => (await tabs(toolbar2)).some((tab) => tab.url === `${origin}/pinned` && tab.active), 'the pinned page as the active tab of the new window')

  // --- 8. Private tab stays private.
  smoke.step('a private tab pops out and back in the private session')
  await smoke.evaluate(toolbar2, `window.api.browser.tabs.createPrivate(${JSON.stringify(`${origin}/private`)})`)
  const privatePage = await waitFor(() => pageContents((url, contents) => url === `${origin}/private` && !contents.isLoading()), 'the private page')
  assert.notEqual(privatePage.session, pinned.session, 'a private session')
  await waitFor(async () => (await tabs(toolbar2)).find((tab) => tab.active)?.url === `${origin}/private`, 'the private tab active')
  await run('miniWindow.popOut', toolbar2)
  const privateMini = await waitFor(() => miniWindows()[0], 'the mini window for the private tab')
  await waitFor(() => viewOf(privateMini, privatePage), 'the private page in the mini window')
  const privateHeader = miniHeaders()[0]
  await waitFor(() => smoke.evaluate(privateHeader, 'document.body.classList.contains("private")'), 'the header to say Private')
  assert.equal(await smoke.evaluate(privatePage, 'document.cookie'), '', 'no normal-profile cookies in the private page')
  await run('miniWindow.return', toolbar2)
  await waitFor(() => viewOf(mainWindow, privatePage) && privateMini.isDestroyed(), 'the private tab back in the browser window')
  assert.notEqual(privatePage.session, pinned.session, 'still the private session')

  console.log('Electron mini window smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window smoke failed:', error)
  app.exit(1)
})
