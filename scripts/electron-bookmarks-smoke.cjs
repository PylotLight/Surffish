// Integration smoke for bookmarks: pinned-strip migration, Cmd+D + star popover, Cmd+Shift+D,
// sidebar tree, manager page (Cmd+Opt+B), omnibox suggestions and a Chromium profile import.
// Runs the production build: `bun run build && bun run test:electron-bookmarks`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-bookmarks-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots of the sidebar and the manager.
const smoke = require('./smoke-harness.cjs')
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
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(join(profile, 'History'))
  db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
    INSERT INTO urls (url, title, last_visit_time) VALUES ('https://history-one.test/', 'History one', ${chrome(Date.UTC(2024, 1, 1))}), ('https://history-two.test/', 'History two', ${chrome(Date.UTC(2024, 1, 2))});`)
  db.close()
}

async function run() {
  process.env.XDG_CONFIG_HOME = configHome
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  // An older profile: the 12-site strip lives in preferences and there is no bookmarks.json yet.
  writeFileSync(join(userData, 'browser-preferences.json'), JSON.stringify({ version: 1, pinnedSites: [{ title: 'Seed', url: 'https://seed.test/' }] }))
  // Not awaited here: awaiting before importing the app could let Electron become ready first (then
  // the app's registerSchemesAsPrivileged throws). The fixture is only read when the import below runs.
  const chromeProfileSeeded = seedChromeProfile()
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
  await waitFor(() => !page.webContents.isLoading() && page.getVisible(), 'the fixture to load')
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
  await waitFor(() => second.getVisible() && !second.webContents.isLoading(), 'the second tab to load')
  key(second, 'D', [primary, 'shift'])
  const folder = await waitFor(async () => {
    const nodes = (await evaluate(toolbar, 'window.api.browser.bookmarks.get()')).nodes
    const tabsFolder = nodes.find((node) => node.type === 'folder' && node.title.startsWith('Tabs ·'))
    return tabsFolder && nodes.filter((node) => node.parentId === tabsFolder.id).length === 2 ? tabsFolder : null
  }, 'Cmd/Ctrl+Shift+D to bookmark both tabs into a folder')
  assert.equal(folder.parentId, 'root')

  // --- bookmarks left the sidebar: no BOOKMARKS section there any more
  const sidebar = surface('sidebar')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarPinned: true })')
  await waitFor(() => evaluate(sidebar, 'Boolean(document.querySelector(".browser-layout.is-sidebar-visible .tab-list, .browser-layout.is-sidebar-visible .tab-item"))'), 'the pinned sidebar')
  assert.equal(await evaluate(sidebar, 'document.querySelector(".sidebar-bookmarks:not(.sidebar-archived)") === null'), true, 'the sidebar has no bookmarks tree')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarPinned: false })')

  // --- the toolbar bookmarks dropdown: Favourites first, folders open as submenus
  await evaluate(toolbar, 'document.querySelector(".bookmarks-menu-button").click()')
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector("#bookmarks-menu"))'), 'the bookmarks dropdown')
  const menuTitles = await evaluate(toolbar, '[...document.querySelectorAll("#bookmarks-menu > .bookmarks-menu-scroll > .bookmarks-menu-item .bookmarks-menu-title")].map((node) => node.textContent)')
  assert.equal(menuTitles[0], 'Seed', 'Favourites contents lead the dropdown')
  assert.ok(menuTitles.includes('Renamed fixture'), `the new bookmark is in the dropdown (got ${JSON.stringify(menuTitles)})`)
  assert.ok(menuTitles.some((title) => title.startsWith('Tabs ·')), 'top-level folders are listed')
  const footer = await evaluate(toolbar, '[...document.querySelectorAll("#bookmarks-menu .bookmarks-menu-footer .bookmarks-menu-title")].map((node) => node.textContent)')
  assert.deepEqual(footer, ['Bookmark manager…', 'Import…', 'Show bookmarks bar'])
  // The toolbar view grows to cover the dropdown, so the page can't clip it.
  const menuBottom = await evaluate(toolbar, 'document.querySelector("#bookmarks-menu").getBoundingClientRect().bottom')
  await waitFor(() => toolbar.getBounds().height >= Math.floor(menuBottom), 'the toolbar view to cover the dropdown')
  await evaluate(toolbar, `(() => { const row = [...document.querySelectorAll('#bookmarks-menu .bookmarks-menu-item.is-folder')].find((node) => node.textContent.startsWith('Tabs ·')); row.click(); return true })()`)
  await waitFor(async () => (await evaluate(toolbar, '[...document.querySelectorAll(".bookmarks-menu-submenu .bookmarks-menu-item .bookmarks-menu-title")].map((node) => node.textContent)')).length >= 2, 'the folder submenu')
  const submenuOpenAll = await evaluate(toolbar, '[...document.querySelectorAll(".bookmarks-menu-submenu .bookmarks-menu-item.is-action")].map((node) => node.textContent).join("|")')
  assert.match(submenuOpenAll, /Open all \(2\)/)
  await screenshot(toolbar, 'bookmarks-toolbar-menu.png')
  // Clicking a bookmark in a submenu opens it here and closes the menu.
  await evaluate(toolbar, `(() => { const row = [...document.querySelectorAll('.bookmarks-menu-submenu .bookmarks-menu-item')].find((node) => node.title.includes('/second')); row.click(); return true })()`)
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector("#bookmarks-menu"))')), 'the dropdown to close after opening a bookmark')

  // --- ⌘/Ctrl+Shift+B: the optional bookmarks bar (off by default) shifts the page down
  assert.equal(await evaluate(toolbar, 'window.api.browser.bookmarks.bar.get()'), false, 'the bar is off by default')
  // The bookmark click above reloads the page; a shortcut sent mid-navigation can be dropped.
  await waitFor(() => !second.webContents.isLoading(), 'the bookmark to finish loading')
  const pageTopBefore = second.getBounds().y
  key(second, 'B', [primary, 'shift'])
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector(".bookmarks-bar"))'), 'Cmd/Ctrl+Shift+B to show the bookmarks bar')
  await waitFor(async () => (await evaluate(toolbar, '[...document.querySelectorAll(".bookmarks-bar > .bookmarks-bar-item span:last-child")].map((node) => node.textContent).join("|")')).includes('Renamed fixture'), 'Favourites on the bar')
  await waitFor(() => second.getBounds().y > pageTopBefore, 'the page to move below the bar')
  await screenshot(toolbar, 'bookmarks-bar.png')
  key(second, 'B', [primary, 'shift'])
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector(".bookmarks-bar"))')), 'Cmd/Ctrl+Shift+B to hide the bar')
  await waitFor(() => second.getBounds().y === pageTopBefore, 'the page to move back up')

  await chromeProfileSeeded
  // --- Import… from the dropdown opens the manager with its import panel
  await evaluate(toolbar, 'document.querySelector(".bookmarks-menu-button").click()')
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector("#bookmarks-menu"))'), 'the dropdown again')
  await evaluate(toolbar, `(() => { const row = [...document.querySelectorAll('#bookmarks-menu .bookmarks-menu-footer .bookmarks-menu-item')].find((node) => node.textContent.startsWith('Import')); row.click(); return true })()`)
  await waitFor(() => evaluate(content, 'Boolean(document.querySelector(".bookmarks-manager-import"))'), 'the manager with its import panel')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "tabs" })')
  await waitFor(() => second.getVisible(), 'the page back after closing the manager')

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
  await waitFor(() => !second.getVisible(), 'the page view to hide behind the manager')
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

  // --- persisted through the deferred writer: surffish.db after the edit burst, bookmarks.json
  // (the fallback copy, rewritten on a slow timer) at the latest when the app quits.
  await waitFor(() => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(join(userData, 'surffish.db'), { readOnly: true })
    try {
      return db.prepare("SELECT count(*) AS n FROM bookmarks WHERE url = 'https://imported-two.test/' AND deleted_at IS NULL").get().n === 1
    } finally {
      db.close()
    }
  }, 'the bookmarks table to be written', 5000)
  app.emit('will-quit', { preventDefault() {} })
  const saved = JSON.parse(readFileSync(join(userData, 'bookmarks.json'), 'utf8'))
  assert.ok(saved.version === 1 && saved.nodes.some((node) => node.url === 'https://imported-two.test/'), 'bookmarks.json is written at quit')

  console.log('Electron bookmarks smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron bookmarks smoke failed:', error)
  app.exit(1)
})
