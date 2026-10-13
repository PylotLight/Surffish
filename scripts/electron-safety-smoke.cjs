// Integration smoke for the safety pack: crashed-tab recovery, the proxy kill switch, clear browsing
// data / site data and the Clear Browsing Data shortcut. Runs the production build:
// `bun run build && bun run test:electron-safety` (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-safety-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createServer: createTcpServer } = require('node:net')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, Menu } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-safety-smoke-${process.pid}`)
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': 'smoke=1; Path=/; Max-Age=3600' })
  response.end('<!doctype html><meta charset="utf-8"><title>Safety fixture</title><textarea spellcheck="true">notifcations</textarea>')
})

let mainWindow
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
async function waitFor(predicate, description, timeout = Number(process.env.SMOKE_WAIT_MS || 20000)) {
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
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const surface = (name) => views().find((view) => surfaceFor(view) === name)
const pageView = (part) => views().find((view) => view.webContents.getURL().includes(part))
async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}
function freePort() {
  return new Promise((resolvePromise) => {
    const probe = createTcpServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolvePromise(port))
    })
  })
}
function findMenuItem(menu, label) {
  for (const item of menu.items) {
    if (item.label === label) return item
    if (item.submenu) {
      const found = findMenuItem(item.submenu, label)
      if (found) return found
    }
  }
  return null
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
  const fixtureUrl = `${origin}/fixture`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const content = surface('content')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`)
  const page = await waitFor(() => pageView('/fixture'), 'the fixture page')
  await waitFor(() => !page.webContents.isLoading() && page.webContents.getTitle() === 'Safety fixture', 'the fixture to load')

  // --- Not secure marker for http pages (loopback is exempt, like Chrome)
  assert.equal(await evaluate(toolbar, 'Boolean(document.querySelector(".omnibox-insecure-pill"))'), false, 'loopback http is not flagged')

  // --- spellcheck settings round-trip; private tabs default off
  const spell = await evaluate(toolbar, 'window.api.browser.safety.spellcheck.get()')
  assert.equal(spell.settings.enabled, true)
  assert.equal(spell.settings.privateTabs, false)
  assert.equal(page.webContents.session.isSpellCheckerEnabled(), true)
  await evaluate(toolbar, 'window.api.browser.safety.spellcheck.set({ enabled: false, languages: [], privateTabs: false })')
  assert.equal(page.webContents.session.isSpellCheckerEnabled(), false, 'turning spellcheck off applies to the session')
  await evaluate(toolbar, 'window.api.browser.safety.spellcheck.set({ enabled: true, languages: [], privateTabs: false })')

  // --- crashed tab: in-tab screen, sidebar marker, Reload recovers
  page.webContents.forcefullyCrashRenderer()
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.state()')).interstitial?.kind === 'crashed', 'the crash interstitial state')
  assert.equal((await evaluate(toolbar, 'window.api.browser.tabs.get()')).find((tab) => tab.active).crashed, true, 'the tab is marked crashed')
  await waitFor(() => evaluate(content, 'document.querySelector(".tab-interstitial h1")?.textContent === "This page crashed"'), 'the crash screen in the content surface')
  await waitFor(() => !page.getVisible(), 'the dead page view to be hidden')
  await evaluate(toolbar, 'window.api.browser.safety.tabRecovery("reload")')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.state()')).interstitial === null, 'Reload to clear the crash screen')
  await waitFor(() => !page.webContents.isLoading() && page.webContents.getTitle() === 'Safety fixture' && page.getVisible(), 'the page to come back')

  // --- site data: cookie count, Forget this site
  await waitFor(async () => (await evaluate(toolbar, `window.api.browser.safety.siteData.get(${JSON.stringify(origin)})`))?.cookies >= 1, 'the fixture cookie to be counted')
  const sites = await evaluate(toolbar, 'window.api.browser.safety.privacy.cookieSites()')
  assert.ok(sites.some((site) => site.site === '127.0.0.1'), 'the cookie list shows the fixture site')
  const forgotten = await evaluate(toolbar, `window.api.browser.safety.siteData.forget(${JSON.stringify(origin)}, true)`)
  assert.equal(forgotten.cookies, 0, 'Forget this site removes its cookies')
  const history = await evaluate(toolbar, 'window.api.browser.history.get()')
  assert.ok(!history.some((entry) => entry.url.startsWith(origin)), 'and its history entries')

  // --- clear browsing data (all time)
  page.webContents.reload()
  await waitFor(async () => (await page.webContents.session.cookies.get({})).length > 0, 'the cookie to be set again')
  // Let the reload finish (the fixture sets the cookie on every response, favicon included), so a
  // late response can't put it back after the clear below.
  await waitFor(() => !page.webContents.isLoading(), 'the reload to finish')
  await delay(500)
  const result = await evaluate(toolbar, 'window.api.browser.safety.privacy.clear({ range: "all", history: true, downloads: true, cookies: true, cache: true, permissions: true, zoom: true })')
  assert.equal(result.scopedOrigins, null)
  assert.equal((await page.webContents.session.cookies.get({})).length, 0, 'all cookies cleared')
  assert.equal((await evaluate(toolbar, 'window.api.browser.history.get()')).length, 0, 'history cleared')

  // --- Cmd/Ctrl+Shift+Backspace menu item opens Settings → Privacy
  const clearItem = findMenuItem(Menu.getApplicationMenu(), 'Clear Browsing Data…')
  assert.ok(clearItem, 'the menu has Clear Browsing Data…')
  assert.equal(clearItem.accelerator, 'CmdOrCtrl+Shift+Backspace')
  clearItem.click()
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode === 'privacy', 'the Privacy settings to open')
  await waitFor(() => evaluate(content, 'document.querySelector(".settings-view-privacy h1")?.textContent === "Privacy"'), 'the Privacy page to render')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "tabs" })')

  // --- proxy kill switch: unreachable proxy blocks traffic, resumes when it's back
  const proxyPort = await freePort()
  await evaluate(toolbar, `window.api.browser.proxy.set({ enabled: true, host: "127.0.0.1", port: ${proxyPort} })`)
  await evaluate(toolbar, 'window.api.browser.safety.proxyGuard.set(true)')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.safety.proxyGuard.get()')).blocking, 'the kill switch to trip on a dead proxy')
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector(".proxy-down-banner"))'), 'the Proxy down banner')
  const blocked = await evaluate(page, 'fetch("https://example.com/", { cache: "no-store" }).then(() => "loaded", (error) => "blocked: " + error.message)')
  assert.match(blocked, /^blocked/, 'off-machine traffic is cancelled')
  const fakeProxy = createTcpServer((socket) => socket.destroy())
  await new Promise((resolvePromise) => fakeProxy.listen(proxyPort, '127.0.0.1', resolvePromise))
  await waitFor(async () => !(await evaluate(toolbar, 'window.api.browser.safety.proxyGuard.get()')).blocking, 'traffic to resume when the proxy answers', 10000)
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector(".proxy-down-banner"))')), 'the banner to go away')
  await evaluate(toolbar, 'window.api.browser.safety.proxyGuard.set(false)')
  await evaluate(toolbar, `window.api.browser.proxy.set({ enabled: false, host: "127.0.0.1", port: ${proxyPort} })`)
  fakeProxy.close()

  console.log('Electron safety smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron safety smoke failed:', error)
  app.exit(1)
})
