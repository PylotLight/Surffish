// Integration smoke for Settings → General → "Enable page watchers".
//   1. Launch with the feature off and two saved watchers: no watcher fetches, every watcher IPC call
//      answers { ok: false, error: 'watchers disabled' } (never throws), and the Watchers section,
//      Window → Page Watchers and the Cmd+K "Page Watchers" command are hidden.
//   2. Turn it on from the General toggle: entries come back, the saved watchers list again and a
//      due watcher is checked right away (no restart, no startup hold).
//   3. Turn it off again before the second watcher is due (while Settings → Watchers is open): the
//      section falls back to General, its timer is cancelled (no fetch after its due time), and
//      page-watchers.json still has both watchers.
//   4. Turn it back on: the second watcher resumes and is checked.
// Runs the production build: `bun run build && bun run test:electron-watchers-toggle`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-watchers-toggle-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, Menu } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const root = join(tmpdir(), `surffish-watchers-toggle-smoke-${process.pid}`)
const userData = join(root, 'user-data')
const hits = { first: 0, second: 0 }
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/first') hits.first += 1
  if (url.pathname === '/second') hits.second += 1
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><title>${url.pathname}</title><main><h1>Watched ${url.pathname}</h1><p>Price: $10</p></main>`)
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
    await delay(60)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => surfaceFor(view) === name)

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}

function menuHasPageWatchers() {
  const menu = Menu.getApplicationMenu()
  const walk = (items) => items.some((item) => item.label === 'Page Watchers' || (item.submenu && walk(item.submenu.items)))
  return Boolean(menu && walk(menu.items))
}

const watcher = (id, url, nextCheckAt, now) => ({
  id, url, title: id, selector: null, intervalMinutes: 15, renderJs: false, paused: false, createdAt: now,
  lastCheckedAt: null, lastChangedAt: null, nextCheckAt, lastError: null, consecutiveErrors: 0, snapshot: null, lastDiff: null, unseen: false
})

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  // "first" is overdue; "second" falls due a while after launch (its timer is what turning off must cancel).
  const secondDueAt = now + Math.max(20_000, Math.min(smoke.waitMs / 3, 45_000))
  writeFileSync(join(userData, 'page-watchers.json'), `${JSON.stringify({ version: 1, watchers: [watcher('first', `${origin}/first`, now - 60_000, now), watcher('second', `${origin}/second`, secondDueAt, now)] })}\n`)
  writeFileSync(join(userData, 'browser-page-watchers-feature.json'), `${JSON.stringify({ enabled: false })}\n`)

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const content = surface('content')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => evaluate(content, 'document.readyState === "complete" && Boolean(window.api)'), 'the content renderer')

  const subnavHasWatchers = () => evaluate(content, '[...document.querySelectorAll(".settings-subnav button")].some((button) => button.textContent.startsWith("Watchers"))')
  const subnavReady = () => evaluate(content, 'document.querySelectorAll(".settings-subnav button").length > 2')
  const commandIds = async () => (await evaluate(toolbar, 'window.api.browser.commands.list()')).commands.map((command) => command.id)
  const toggle = 'document.querySelector("input[aria-label=\\"Enable page watchers\\"]")'
  const clickToggle = async (expected) => {
    await waitFor(() => evaluate(content, `Boolean(${toggle}) && !${toggle}.disabled && ${toggle}.checked === ${!expected}`), `the Enable page watchers toggle (currently ${!expected})`)
    await evaluate(content, `${toggle}.click(); true`)
    await waitFor(() => evaluate(content, `${toggle}.checked === ${expected}`), `the toggle to read ${expected}`)
  }

  // --- 1. Off at launch
  assert.equal((await evaluate(content, 'window.api.browser.watchers.getEnabled()')).enabled, false)
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "settings" })')
  await waitFor(subnavReady, 'the settings sub-nav')
  assert.equal(await subnavHasWatchers(), false, 'Settings → Watchers is hidden while off')
  assert.equal(menuHasPageWatchers(), false, 'Window → Page Watchers is hidden while off')
  assert.equal((await commandIds()).includes('settings.watchers'), false, 'Cmd+K Page Watchers is hidden while off')
  assert.equal(await evaluate(toolbar, 'window.api.browser.commands.run("settings.watchers")'), false, 'the command does not run while off')
  const disabled = { ok: false, error: 'watchers disabled' }
  assert.deepEqual(await evaluate(content, 'window.api.browser.watchers.list()'), disabled)
  assert.deepEqual(await evaluate(content, `window.api.browser.watchers.add({ url: ${JSON.stringify(`${origin}/third`)} })`), disabled)
  assert.deepEqual(await evaluate(content, 'window.api.browser.watchers.update("first", { paused: true })'), disabled)
  assert.deepEqual(await evaluate(content, 'window.api.browser.watchers.checkNow("first")'), disabled)
  assert.deepEqual(await evaluate(content, 'window.api.browser.watchers.remove("first")'), disabled)
  await delay(1500)
  assert.deepEqual(hits, { first: 0, second: 0 }, 'no watcher fetches while off')
  console.log('off at launch: entries hidden, IPC answers watchers disabled, no fetches')

  // --- 2. On, live
  await clickToggle(true)
  await waitFor(subnavHasWatchers, 'the Watchers section to appear')
  await waitFor(() => menuHasPageWatchers(), 'Window → Page Watchers to come back')
  assert.ok((await commandIds()).includes('settings.watchers'), 'Cmd+K Page Watchers is back')
  const listed = await waitFor(async () => { const snapshot = await evaluate(content, 'window.api.browser.watchers.list()'); return Array.isArray(snapshot.watchers) && snapshot }, 'the watcher list')
  assert.deepEqual(listed.watchers.map((entry) => entry.id).sort(), ['first', 'second'], 'saved watchers are kept')
  await waitFor(() => hits.first > 0, 'the overdue watcher to be checked right after turning on')
  console.log('turned on: entries back, overdue watcher checked')

  // --- 3. Off again, from Settings → Watchers
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "watchers" })')
  await waitFor(() => evaluate(content, 'Boolean(document.querySelector(".watcher-item"))'), 'the Watchers section')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "settings" })')
  await waitFor(() => evaluate(content, `Boolean(${toggle})`), 'General settings')
  await clickToggle(false)
  const offAt = Date.now()
  assert.ok(offAt < secondDueAt, `turned off before the second watcher was due (${secondDueAt - offAt} ms left); the run was too slow to test the timer`)
  await waitFor(async () => !(await subnavHasWatchers()), 'the Watchers section to disappear')
  assert.equal(menuHasPageWatchers(), false)
  assert.equal((await commandIds()).includes('settings.watchers'), false)
  // Opening the hidden section falls back to General.
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "watchers" })')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode === 'settings', 'Settings → Watchers to fall back to General')
  const firstHits = hits.first
  console.log(`turned off; waiting ${Math.max(0, secondDueAt - Date.now()) + 3000} ms past the second watcher's due time`)
  await delay(Math.max(0, secondDueAt - Date.now()) + 3000)
  assert.equal(hits.second, 0, 'no polling while off: the second watcher was not checked at its due time')
  assert.equal(hits.first, firstHits)
  const saved = JSON.parse(readFileSync(join(userData, 'page-watchers.json'), 'utf8'))
  assert.deepEqual(saved.watchers.map((entry) => entry.id).sort(), ['first', 'second'], 'watchers stay on disk while off')
  assert.equal(JSON.parse(readFileSync(join(userData, 'browser-page-watchers-feature.json'), 'utf8')).enabled, false)

  // --- 4. Back on: resumes
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "settings" })')
  await clickToggle(true)
  await waitFor(() => hits.second > 0, 'the second (now overdue) watcher to resume')
  assert.equal(JSON.parse(readFileSync(join(userData, 'browser-page-watchers-feature.json'), 'utf8')).enabled, true)

  console.log('Electron watchers toggle smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron watchers toggle smoke failed:', error)
  app.exit(1)
})
