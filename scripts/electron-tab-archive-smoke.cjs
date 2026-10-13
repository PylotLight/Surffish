// Integration smoke for the tab archive: auto-archive (restart-safe idle time, pinned tabs kept),
// Archive Tab + restore (with its back list), the sidebar section, the palette's Archived group,
// Close Duplicate Tabs and "switch to open tab" from the omnibox. Runs the production build:
// `bun run build && bun run test:electron-tab-archive`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-tab-archive-smoke.cjs`).
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-tab-archive-smoke-${process.pid}`)
const primary = process.platform === 'darwin' ? 'meta' : 'control'
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  const name = (request.url || '/').slice(1).replace(/[^\w-]/g, '') || 'root'
  response.end(`<!doctype html><meta charset="utf-8"><title>Fixture ${name}</title><p>${name}</p>`)
})

let mainWindow
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function waitFor(predicate, description, timeout = 20000) {
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

const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => surfaceFor(view) === name)

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
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', { loadNetworkFilters: true, loadCosmeticFilters: false })
  writeFileSync(join(userData, 'adblock-engine.bin'), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  const url = (name) => `${origin}/${name}`

  // A saved session where /old and the pinned tab were last used 13h ago (before "the restart").
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [url('old'), url('pinned'), url('fresh')], activeIndex: 2, pinnedTabs: [1] }))
  const hoursAgo = (hours) => now - hours * 3_600_000
  writeFileSync(join(userData, 'tab-archive.json'), JSON.stringify({
    version: 1,
    settings: { archiveAfter: 'off', prompted: false, switchToOpenTab: false },
    tabs: [],
    activity: { [url('old')]: hoursAgo(13), [url('pinned')]: hoursAgo(13), [url('fresh')]: hoursAgo(1) }
  }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const sidebar = surface('sidebar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => evaluate(sidebar, 'document.readyState === "complete" && Boolean(window.api)'), 'the sidebar renderer')
  const tabs = () => evaluate(toolbar, 'window.api.browser.tabs.get()')
  const archive = () => evaluate(toolbar, 'window.api.browser.tabArchive.get()')
  const activeUrl = async () => (await evaluate(toolbar, 'window.api.browser.state()')).url

  await waitFor(async () => (await tabs()).length === 3, 'the restored session')
  const initial = await archive()
  assert.equal(initial.settings.archiveAfter, 'off', 'auto-archive is off by default')
  assert.equal(initial.settings.prompted, false)

  // --- auto-archive: 12h takes /old (idle 13h across the restart) but not the pinned or active tab
  await evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "12h", prompted: true })')
  await waitFor(async () => (await tabs()).length === 2, 'the idle tab to be archived')
  const afterAuto = await tabs()
  assert.deepEqual(afterAuto.map((tab) => tab.url).sort(), [url('fresh'), url('pinned')].sort())
  const auto = await archive()
  assert.equal(auto.tabs.length, 1)
  assert.equal(auto.tabs[0].url, url('old'))
  assert.equal(auto.tabs[0].reason, 'auto')
  const reopen = (await evaluate(toolbar, 'window.api.browser.commands.list()')).commands.find((command) => command.id === 'tab.reopenClosed')
  assert.equal(reopen.enabled, false, 'archived tabs stay off the Reopen Closed Tab stack')
  await evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ archiveAfter: "off" })')

  // --- the sidebar shows an Archived section
  await waitFor(() => evaluate(sidebar, 'Boolean(document.querySelector(".sidebar-archived"))'), 'the Archived sidebar section')
  assert.match(await evaluate(sidebar, 'document.querySelector(".sidebar-archived .sidebar-archived-count").textContent'), /^1$/)

  // --- restore from the archive
  await evaluate(toolbar, `window.api.browser.tabArchive.restore(${JSON.stringify(auto.tabs[0].id)})`)
  await waitFor(async () => (await activeUrl()) === url('old'), 'the restored tab to be active')
  assert.equal((await archive()).tabs.length, 0, 'restored tabs leave the archive')
  await waitFor(async () => !(await evaluate(sidebar, 'Boolean(document.querySelector(".sidebar-archived"))')), 'the empty Archived section to hide')

  // --- Archive Tab keeps the back list: /hist1 -> /hist2, archive, restore, Back works
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(url('hist1'))})`)
  await waitFor(async () => (await tabs()).some((tab) => tab.active && tab.title === 'Fixture hist1' && !tab.loading), 'hist1 to load')
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(url('hist2'))})`)
  await waitFor(async () => (await activeUrl()) === url('hist2') && (await evaluate(toolbar, 'window.api.browser.state()')).canGoBack && (await tabs()).some((tab) => tab.active && tab.title === 'Fixture hist2'), 'hist2 with history')
  const histTab = (await tabs()).find((tab) => tab.active)
  assert.equal(await evaluate(toolbar, `window.api.browser.tabArchive.archive(${JSON.stringify(histTab.id)})`), true, 'the active tab can be archived manually')
  const manual = await archive()
  assert.equal(manual.tabs[0].url, url('hist2'))
  assert.equal(manual.tabs[0].reason, 'manual')
  assert.equal(manual.tabs[0].history.entries.length, 2, 'the back list was kept')
  await evaluate(toolbar, `window.api.browser.tabArchive.restore(${JSON.stringify(manual.tabs[0].id)})`)
  await waitFor(async () => (await activeUrl()) === url('hist2') && (await evaluate(toolbar, 'window.api.browser.state()')).canGoBack, 'the restored tab to have its back list')

  // --- the palette's tab search lists archived tabs in their own group, Enter restores
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(url('palette'))})`)
  const paletteTab = await waitFor(async () => (await tabs()).find((tab) => tab.active && tab.title === 'Fixture palette'), 'the palette fixture')
  await evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(afterAuto.find((tab) => tab.url === url('fresh')).id)})`)
  await evaluate(toolbar, `window.api.browser.tabArchive.archive(${JSON.stringify(paletteTab.id)})`)
  await waitFor(async () => (await archive()).tabs.some((tab) => tab.url === url('palette')), 'the palette fixture to be archived')
  await evaluate(toolbar, 'window.api.browser.commands.run("tab.searchArchived")')
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector("#command-palette input"))'), 'tab search to open')
  await delay(150)
  toolbar.webContents.insertText('Fixture palette')
  await waitFor(() => evaluate(toolbar, 'document.querySelector(".command-palette-group")?.textContent === "Archived"'), 'the Archived group in tab search')
  await waitFor(async () => (await evaluate(toolbar, 'document.querySelector(".command-palette-item.is-selected .command-palette-tag")?.textContent')) === 'Restore', 'the archived row to be selected')
  key(toolbar, 'Enter')
  await waitFor(async () => (await activeUrl()) === url('palette'), 'Enter to restore the archived tab')

  // --- Close Duplicate Tabs (ignores #fragments, keeps the active tab)
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(url('dup'))})`)
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${url('dup')}#part`)})`)
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(url('dup'))})`)
  await waitFor(async () => (await tabs()).filter((tab) => tab.url.startsWith(url('dup'))).length === 3, 'three duplicate tabs')
  const activeDup = (await tabs()).find((tab) => tab.active)
  assert.ok(await evaluate(toolbar, 'window.api.browser.commands.run("tab.closeDuplicates")'))
  await waitFor(async () => (await tabs()).filter((tab) => tab.url.startsWith(url('dup'))).length === 1, 'duplicates to close')
  assert.equal((await tabs()).find((tab) => tab.url.startsWith(url('dup'))).id, activeDup.id, 'the active copy is kept')

  // --- switch to open tab from the omnibox (a blank New Tab you typed into closes)
  assert.equal(await evaluate(toolbar, `window.api.browser.tabArchive.switchToOpenTab(${JSON.stringify(url('fresh'))})`), false, 'off by default')
  await evaluate(toolbar, 'window.api.browser.tabArchive.setSettings({ switchToOpenTab: true })')
  await evaluate(toolbar, 'window.api.browser.tabs.create()')
  const countWithBlank = (await tabs()).length
  await waitFor(async () => (await tabs()).find((tab) => tab.active)?.url === 'surffish://quick-links', 'a blank New Tab')
  assert.equal(await evaluate(toolbar, `window.api.browser.tabArchive.switchToOpenTab(${JSON.stringify(url('fresh'))})`), true)
  await waitFor(async () => (await activeUrl()) === url('fresh'), 'the omnibox to switch to the open tab')
  assert.equal((await tabs()).length, countWithBlank - 1, 'the blank New Tab was closed')

  // --- private tabs are never archived
  await evaluate(toolbar, `window.api.browser.tabs.createPrivate(${JSON.stringify(url('secret'))})`)
  const privateTab = await waitFor(async () => (await tabs()).find((tab) => tab.private), 'a private tab')
  assert.equal(await evaluate(toolbar, `window.api.browser.tabArchive.archive(${JSON.stringify(privateTab.id)})`), false)
  assert.ok(!(await archive()).tabs.some((tab) => tab.url.includes('secret')))

  // --- clearing history clears the archive too
  await evaluate(toolbar, `(async () => { const tab = (await window.api.browser.tabs.get()).find((t) => t.url === ${JSON.stringify(url('hist2'))}); return window.api.browser.tabArchive.archive(tab.id) })()`)
  await waitFor(async () => (await archive()).tabs.length === 1, 'one archived tab')
  await evaluate(toolbar, 'window.api.browser.history.clear()')
  await waitFor(async () => (await archive()).tabs.length === 0, 'clearing history to empty the archive')

  console.log('Electron tab archive smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron tab archive smoke failed:', error)
  app.exit(1)
})
