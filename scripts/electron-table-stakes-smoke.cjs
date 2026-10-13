// Integration smoke for find in page, per-site zoom, tab shortcuts, hover link status, WebRTC policy
// and middle-click close. Runs the production build: `bun run build && bun run test:electron-table-stakes`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-table-stakes-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-table-stakes-smoke-${process.pid}`)
const primary = process.platform === 'darwin' ? 'meta' : 'control'
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  const title = request.url === '/second' ? 'Second fixture' : 'Table stakes fixture'
  response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font:18px system-ui}#link{position:absolute;left:300px;top:200px;display:block;width:200px;height:40px;background:#ddd}</style>
<p>needle one</p><p>needle two</p><p>needle three</p>
<a id="link" href="https://example.com/target?utm_source=smoke">hover me</a>`)
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

function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get('surface')
  } catch {
    return null
  }
}

function views() {
  return mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
}

function surface(name) {
  return views().find((view) => surfaceFor(view) === name)
}

function pageView(urlPart) {
  return views().find((view) => view.webContents.getURL().includes(urlPart))
}

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}

function key(view, keyCode, modifiers = []) {
  view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
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
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')

  // --- navigate
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`)
  const page = await waitFor(() => pageView('/fixture'), 'the fixture page view')
  await waitFor(() => !page.webContents.isLoading() && page.webContents.getTitle() === 'Table stakes fixture', 'the fixture to load')
  await waitFor(() => page.getVisible(), 'the page to be on screen')

  // --- WebRTC policy follows the proxy toggle
  assert.equal(page.webContents.getWebRTCIPHandlingPolicy(), 'default', 'WebRTC is unrestricted with the proxy off')
  await evaluate(toolbar, 'window.api.browser.proxy.set({ enabled: true, host: "127.0.0.1", port: 1080 })')
  assert.equal(page.webContents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp', 'WebRTC cannot bypass the SOCKS5 proxy')
  await evaluate(toolbar, 'window.api.browser.proxy.set({ enabled: false, host: "127.0.0.1", port: 1080 })')
  assert.equal(page.webContents.getWebRTCIPHandlingPolicy(), 'default', 'WebRTC policy is restored when the proxy is off')

  // --- find in page (shortcut sent to the page, as if focus is in the site)
  page.webContents.focus()
  key(page, 'F', [primary])
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector("#find-bar input"))'), 'the find bar to open from the page')
  await waitFor(() => evaluate(toolbar, 'document.activeElement === document.querySelector("#find-bar input")'), 'the find field to take focus')
  toolbar.webContents.insertText('needle')
  const count = () => evaluate(toolbar, 'document.querySelector(".find-bar-count")?.textContent ?? ""')
  await waitFor(async () => (await count()) === '1 of 3', 'find to report 1 of 3')
  key(page, 'G', [primary])
  await waitFor(async () => (await count()) === '2 of 3', 'Cmd/Ctrl+G to move to 2 of 3')
  key(toolbar, 'Enter', ['shift'])
  await waitFor(async () => (await count()) === '1 of 3', 'Shift+Enter to move back to 1 of 3')
  key(toolbar, 'Escape')
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector("#find-bar"))')), 'Esc to close the find bar')

  // --- zoom, persisted per origin, with the omnibox pill
  key(page, '=', [primary])
  await waitFor(() => Math.abs(page.webContents.getZoomFactor() - 1.1) < 0.001, 'Cmd/Ctrl+= to zoom to 110%')
  await waitFor(async () => (await evaluate(toolbar, 'document.querySelector(".omnibox-zoom-pill")?.textContent')) === '110%', 'the 110% zoom pill')
  await waitFor(() => {
    // Saved to surffish.db (settings row zoom:<hash of origin>); browser-preferences.json is the
    // fallback copy and follows on a slow timer / at quit. With SURFFISH_STORE=json it is the file.
    if (!existsSync(join(userData, 'surffish.db'))) return JSON.parse(readFileSync(join(userData, 'browser-preferences.json'), 'utf8')).siteZoom?.[origin] === 1.1
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(join(userData, 'surffish.db'), { readOnly: true })
    try {
      const key = `zoom:${require('node:crypto').createHash('sha256').update(origin).digest('hex').slice(0, 32)}`
      const row = db.prepare('SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL').get(key)
      return row !== undefined && JSON.parse(row.value).factor === 1.1
    } finally {
      db.close()
    }
  }, 'the zoom level to be saved for the origin', 5000)
  key(page, '-', [primary])
  key(page, '-', [primary])
  await waitFor(() => Math.abs(page.webContents.getZoomFactor() - 0.9) < 0.001, 'Cmd/Ctrl+- twice to zoom to 90%')
  await waitFor(async () => (await evaluate(toolbar, 'document.querySelector(".omnibox-zoom-pill")?.textContent')) === '90%', 'the 90% zoom pill')
  await evaluate(toolbar, 'document.querySelector(".omnibox-zoom-pill").click()')
  await waitFor(() => Math.abs(page.webContents.getZoomFactor() - 1) < 0.001, 'the pill to reset zoom to 100%')
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector(".omnibox-zoom-pill"))')), 'the pill to hide at 100%')
  key(page, '=', [primary])
  await waitFor(() => Math.abs(page.webContents.getZoomFactor() - 1.1) < 0.001, 'zoom back to 110%')

  // --- hover link status pill
  // The zoom change just above re-lays the page out, and a single move that lands before that (or
  // while a hidden Mac CI window is still settling) never hovers the link: keep nudging the pointer
  // (1px back and forth, every ~250 ms) until the pill shows.
  let moves = 0
  const statusView = await waitFor(() => {
    if (moves++ % 5 === 0) page.webContents.sendInputEvent({ type: 'mouseMove', x: 400 + (moves % 2), y: 220 })
    return views().find((view) => view.webContents.getURL().startsWith('data:text/html') && view.getVisible() && view.getBounds().width > 0)
  }, 'the link status pill')
  const statusText = await evaluate(statusView, 'document.getElementById("pill").textContent')
  assert.equal(statusText, 'example.com/target?utm_source=smoke')
  const statusBounds = statusView.getBounds()
  const pageBounds = page.getBounds()
  assert.ok(statusBounds.height <= 24 && statusBounds.width < pageBounds.width / 2, 'the pill is small')
  assert.ok(statusBounds.y + statusBounds.height <= pageBounds.y + pageBounds.height && statusBounds.y > pageBounds.y + pageBounds.height - 40, 'the pill sits at the bottom of the page')
  const children = mainWindow.contentView.children
  assert.ok(children.indexOf(statusView) > children.indexOf(page), 'the pill is above the page')
  assert.ok(children.indexOf(statusView) < children.indexOf(toolbar), 'the pill is below the toolbar overlay')
  page.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 })
  await waitFor(() => !statusView.getVisible(), 'the pill to hide off the link')

  // --- a second tab: Cmd+1 / Cmd+9 / Cmd+Shift+[ ]
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/second`)})`)
  const second = await waitFor(() => pageView('/second'), 'the second tab')
  await waitFor(() => second.getVisible(), 'the second tab to be active')
  const activeUrl = async () => (await evaluate(toolbar, 'window.api.browser.state()')).url
  key(second, '1', [primary])
  await waitFor(async () => (await activeUrl()) === fixtureUrl, 'Cmd/Ctrl+1 to select the first tab')
  key(page, '9', [primary])
  await waitFor(async () => (await activeUrl()).endsWith('/second'), 'Cmd/Ctrl+9 to select the last tab')
  key(second, '[', [primary, 'shift'])
  await waitFor(async () => (await activeUrl()) === fixtureUrl, 'Cmd/Ctrl+Shift+[ to select the previous tab')
  key(page, ']', [primary, 'shift'])
  await waitFor(async () => (await activeUrl()).endsWith('/second'), 'Cmd/Ctrl+Shift+] to select the next tab')

  // --- history / downloads panel shortcuts
  const historyKey = process.platform === 'darwin' ? 'Y' : 'H'
  const sidebarMode = async () => (await evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode
  // A tab switch right before the shortcut: `tabs.activate` resolves once main has switched, before
  // the (per-frame coalesced) tab broadcast reaches the toolbar, and Cmd+Y follows at once. That late
  // broadcast used to close the History panel that opened after the switch, so the next Cmd+Y
  // reopened it instead of closing it (flaky "toggle history closed" on the Mac runner).
  const firstId = (await evaluate(toolbar, 'window.api.browser.tabs.get()')).find((tab) => !tab.url.endsWith('/second')).id
  await evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(firstId)})`)
  key(page, historyKey, [primary])
  await waitFor(async () => (await sidebarMode()) === 'history', 'the history shortcut to open history')
  await delay(300)
  assert.equal(await sidebarMode(), 'history', 'a tab switch from before History opened must not close it')
  key(page, historyKey, [primary])
  await waitFor(async () => (await sidebarMode()) === 'tabs', 'the history shortcut to toggle history closed')
  // A tab switch while History is open still closes it.
  key(page, historyKey, [primary])
  await waitFor(async () => (await sidebarMode()) === 'history', 'the history shortcut to reopen history')
  key(page, ']', [primary, 'shift'])
  await waitFor(async () => (await activeUrl()).endsWith('/second'), 'Cmd/Ctrl+Shift+] to select the next tab with History open')
  await waitFor(async () => (await sidebarMode()) === 'tabs', 'a tab switch to close the History panel')

  // --- middle-click a sidebar tab closes it
  const sidebar = surface('sidebar')
  const tabsBefore = await evaluate(toolbar, 'window.api.browser.tabs.get()')
  const before = tabsBefore.length
  const secondId = tabsBefore.find((tab) => tab.url.endsWith('/second')).id
  await waitFor(() => evaluate(sidebar, `Boolean(document.querySelector('[data-browser-tab-id="${secondId}"]'))`), 'the sidebar to list the second tab')
  await evaluate(sidebar, `document.querySelector('[data-browser-tab-id="${secondId}"]').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))`)
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.tabs.get()')).length === before - 1, 'middle-click to close the tab')

  console.log('Electron table-stakes smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron table-stakes smoke failed:', error)
  app.exit(1)
})
