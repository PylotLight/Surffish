// Integration smoke for bookmarks: pinned-strip migration, Cmd+D + star popover, Cmd+Shift+D,
// sidebar tree, manager page (Cmd+Opt+B), omnibox suggestions and a Chromium profile import.
// Runs the production build: `bun run build && bun run test:electron-bookmarks`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-bookmarks-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots of the sidebar and the manager.
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const root = join(tmpdir(), `surffish-bookmarks-smoke-${process.pid}`)
const userData = join(root, 'user-data')
const configHome = join(root, 'config')
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS
const primary = process.platform === 'darwin' ? 'meta' : 'control'
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>Bookmark fixture ${request.url}</title><p>fixture ${request.url}</p>`)
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

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => surfaceFor(view) === name)
const pageView = (urlPart) => views().find((view) => view.webContents.getURL().includes(urlPart))

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

async function screenshot(view, name) {
  if (!screenshots) return
  mkdirSync(screenshots, { recursive: true })
  await delay(600)
  const image = await view.webContents.capturePage()
  writeFileSync(join(screenshots, name), image.toPNG())
}

async function seedChromeProfile() {
  const profile = join(configHome, 'google-chrome', 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(configHome, 'google-chrome', 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Smoke person' } } } }))
  const chrome = (ms) => String((ms + 11_644_473_600_000) * 1000)
  writeFileSync(join(profile, 'Bookmarks'), JSON.stringify({
    version: 1,
    roots: {
      bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
        { type: 'url', name: 'Imported one', url: 'https://imported-one.test/', date_added: chrome(Date.UTC(2024, 0, 1)) },
        { type: 'url', name: 'Seed dupe', url: 'https://seed.test/' },
        { type: 'folder', name: 'Nested', children: [{ type: 'url', name: 'Imported two', url: 'https://imported-two.test/' }] }
      ] },
      other: { type: 'folder', name: 'Other bookmarks', children: [] }
    }
  }))
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
    INSERT INTO urls (url, title, last_visit_time) VALUES ('https://history-one.test/', 'History one', ${chrome(Date.UTC(2024, 1, 1))}), ('https://history-two.test/', 'History two', ${chrome(Date.UTC(2024, 1, 2))});`)
  writeFileSync(join(profile, 'History'), Buffer.from(db.export()))
  db.close()
}

async function run() {
  process.env.XDG_CONFIG_HOME = configHome
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', { loadNetworkFilters: true, loadCosmeticFilters: false })
  writeFileSync(join(userData, 'adblock-engine.bin'), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  // An older profile: the 12-site strip lives in preferences and there is no bookmarks.json yet.
  writeFileSync(join(userData, 'browser-preferences.json'), JSON.stringify({ version: 1, pinnedSites: [{ title: 'Seed', url: 'https://seed.test/' }] }))
  await seedChromeProfile()
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  const fixtureUrl = `${origin}/article?id=7`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const content = surface('content')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')

  // --- migration: the old strip became the Favourites folder, in its own file
  const snapshot = await evaluate(toolbar, 'window.api.browser.bookmarks.get()')
  const favourites = snapshot.nodes.filter((node) => node.parentId === 'favourites')
  assert.deepEqual(favourites.map((node) => node.url), ['https://seed.test/'], 'pinned sites migrate into Favourites')
  assert.ok(existsSync(join(userData, 'bookmarks.json')), 'bookmarks.json is written')
  const preferences = await evaluate(toolbar, 'window.api.browser.preferences.get()')
  assert.deepEqual(preferences.pinnedSites.map((site) => site.url), ['https://seed.test/'], 'the strip reads from Favourites')

  // --- Cmd/Ctrl+D on a page: bookmark the exact URL and open the popover
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`)
  const page = await waitFor(() => pageView('/article'), 'the fixture page view')
  await waitFor(() => !page.webContents.isLoading() && page.getBounds().width > 0, 'the fixture to load')
  page.webContents.focus()
  key(page, 'D', [primary])
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector("#bookmark-popover"))'), 'the bookmark popover to open from Cmd/Ctrl+D')
  const afterAdd = await evaluate(toolbar, 'window.api.browser.bookmarks.get()')
  const added = afterAdd.nodes.find((node) => node.url === fixtureUrl)
  assert.ok(added, 'the exact page URL is bookmarked')
  assert.equal(added.parentId, 'favourites')
  // Rename in the popover and close with Enter.
  await waitFor(() => evaluate(toolbar, 'document.activeElement?.closest?.("#bookmark-popover") !== null'), 'the popover name field to focus')
  await evaluate(toolbar, `(() => { const input = document.querySelector('#bookmark-popover input'); input.select(); return true })()`)
  toolbar.webContents.insertText('Renamed fixture')
  // insertText and key events travel separately; don't press Enter before the text landed.
  await waitFor(async () => (await evaluate(toolbar, 'document.querySelector("#bookmark-popover input")?.value')) === 'Renamed fixture', 'the new name to be typed')
  key(toolbar, 'Enter')
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector("#bookmark-popover"))')), 'Enter to close the popover')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.bookmarks.get()')).nodes.some((node) => node.url === fixtureUrl && node.title === 'Renamed fixture'), 'the popover rename to save')
  assert.equal(await evaluate(toolbar, 'document.querySelector(".omnibox-favorite-button").classList.contains("is-favorite")'), true, 'the star is filled')

  // --- omnibox: bookmarks are suggested
  toolbar.webContents.focus()
  await evaluate(toolbar, 'document.querySelector("input[role=combobox]").focus()')
  toolbar.webContents.insertText('renamed')
  await waitFor(async () => (await evaluate(toolbar, '[...document.querySelectorAll(".address-suggestion .suggestion-source")].map((node) => node.textContent).join(",")')).includes('Bookmark'), 'a Bookmark suggestion')
  key(toolbar, 'Escape')

  // --- Cmd/Ctrl+Shift+D: all tabs into a new folder
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/second`)})`)
  const second = await waitFor(() => pageView('/second'), 'the second tab')
  await waitFor(() => second.getBounds().width > 0 && !second.webContents.isLoading(), 'the second tab to load')
  key(second, 'D', [primary, 'shift'])
  const folder = await waitFor(async () => {
    const nodes = (await evaluate(toolbar, 'window.api.browser.bookmarks.get()')).nodes
    const tabsFolder = nodes.find((node) => node.type === 'folder' && node.title.startsWith('Tabs ·'))
    return tabsFolder && nodes.filter((node) => node.parentId === tabsFolder.id).length === 2 ? tabsFolder : null
  }, 'Cmd/Ctrl+Shift+D to bookmark both tabs into a folder')
  assert.equal(folder.parentId, 'root')

  // --- sidebar tree lists the folders
  const sidebar = surface('sidebar')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarPinned: true })')
  await waitFor(() => evaluate(sidebar, '[...document.querySelectorAll(".sidebar-bookmarks .bookmark-row-title")].map((node) => node.textContent).includes("Favourites")'), 'the sidebar bookmarks tree')
  await evaluate(sidebar, `(() => { const row = [...document.querySelectorAll('.sidebar-bookmarks .bookmark-row')].find((node) => node.textContent.includes('Favourites')); row.click(); return true })()`)
  await waitFor(() => evaluate(sidebar, '[...document.querySelectorAll(".sidebar-bookmarks .bookmark-row-title")].map((node) => node.textContent).includes("Renamed fixture")'), 'Favourites to expand in the sidebar')
  await screenshot(sidebar, 'bookmarks-sidebar.png')

  // --- Chromium import (bookmarks + history) through the same API Settings uses
  const sources = await evaluate(toolbar, 'window.api.browser.bookmarks.importSources()')
  const chrome = sources.find((source) => source.browser === 'chrome')
  assert.ok(chrome, `the seeded Chrome profile is found (got ${JSON.stringify(sources)})`)
  assert.equal(chrome.profileName, 'Smoke person')
  const summary = await evaluate(toolbar, `window.api.browser.bookmarks.importFrom(${JSON.stringify(chrome.id)}, { bookmarks: true, history: true })`)
  assert.deepEqual(summary.errors, [])
  assert.equal(summary.bookmarks.added, 2)
  assert.equal(summary.bookmarks.duplicates, 1)
  assert.equal(summary.bookmarks.folderTitle, 'Imported from Chrome')
  assert.deepEqual(summary.history, { found: 2, added: 2 })
  const history = await evaluate(toolbar, 'window.api.browser.history.get()')
  assert.ok(history.some((entry) => entry.url === 'https://history-two.test/'), 'imported history is browsable')

  // --- manager page
  key(second, 'B', [primary, 'alt'])
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode === 'bookmarks', 'Cmd/Ctrl+Opt+B to open the manager')
  await waitFor(() => evaluate(content, 'Boolean(document.querySelector(".bookmarks-manager"))'), 'the manager page to render')
  await waitFor(() => second.getBounds().width === 0, 'the page view to hide behind the manager')
  await evaluate(content, `(() => { const row = [...document.querySelectorAll('.bookmarks-folder-row')].find((node) => node.textContent.includes('Imported from Chrome')); row.click(); return true })()`)
  await waitFor(() => evaluate(content, '[...document.querySelectorAll(".bookmarks-manager-row strong")].map((node) => node.textContent).includes("Bookmarks bar")'), 'the imported folder in the manager')
  await screenshot(content, 'bookmarks-manager.png')
  // Search across folders.
  await evaluate(content, 'document.querySelector(".bookmarks-manager-search input").focus()')
  content.webContents.insertText('imported two')
  await waitFor(async () => (await evaluate(content, '[...document.querySelectorAll(".bookmarks-manager-row strong")].map((node) => node.textContent).join("|")')) === 'Imported two', 'search to find the nested import')
  await screenshot(content, 'bookmarks-manager-search.png')
  // Export renders Netscape HTML.
  const exported = await evaluate(content, 'window.api.browser.bookmarks.get()')
  assert.ok(exported.nodes.length >= 8)
  key(content, 'B', [primary, 'alt'])
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode === 'tabs', 'the shortcut to close the manager')

  // --- persisted through the deferred writer
  await waitFor(() => {
    const saved = JSON.parse(readFileSync(join(userData, 'bookmarks.json'), 'utf8'))
    return saved.version === 1 && saved.nodes.some((node) => node.url === 'https://imported-two.test/')
  }, 'bookmarks.json to be written', 5000)

  console.log('Electron bookmarks smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron bookmarks smoke failed:', error)
  app.exit(1)
})
