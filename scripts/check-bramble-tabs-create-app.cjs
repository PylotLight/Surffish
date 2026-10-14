// Full-app check: Bramble's own pages get a working chrome.tabs (create/query/update/…) routed through
// Surffish's tabs, so Settings → Restore and Settings → Import (openSetup('restore'|'import') →
// tabs.create({ url: 'options.html?screen=…' })) open Bramble's restore/import screen in a tab.
// Also prints which chrome.* APIs Bramble's pages call that are still missing.
// Not in CI (needs the Bramble build, like check-bramble-poc.ts). Run the production build first:
//   bun run build && electron scripts/check-bramble-tabs-create-app.cjs <unpacked bramble_firefox_X.zip dir>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-tabs-create-app.cjs <dir>)
// Set CHECK_SHOTS=<dir> to save screenshots.
'use strict'
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const http = require('node:http')
const { existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, BrowserWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const dist = resolve(process.argv.slice(2).filter((arg) => !arg.startsWith('-')).at(-1) || '')
const root = join(tmpdir(), `surffish-bramble-tabs-create-app-${process.pid}`)
const userData = join(root, 'user-data')
const MASTER = 'a long Bramble master password for the tabs.create check'
const shots = process.env.CHECK_SHOTS
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try { const value = await predicate(); if (value) return value } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}
const evaluate = (contents, code) => smoke.evaluate(contents, code)
const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }

async function shot(contents, name) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  const image = await contents.capturePage()
  writeFileSync(join(shots, `${name}.png`), image.toPNG())
}

// The chrome.* calls Bramble 1.29's popup/options pages make (static scan of its page chunks).
const PAGE_APIS = [
  'tabs.create', 'tabs.query', 'tabs.update', 'tabs.get', 'tabs.remove',
  'runtime.openOptionsPage', 'runtime.getURL', 'runtime.getManifest', 'runtime.sendMessage', 'runtime.connect', 'runtime.connectNative',
  'storage.local.get', 'storage.session.get', 'storage.session.onChanged.addListener', 'storage.onChanged.addListener',
  'permissions.contains', 'permissions.request', 'permissions.remove', 'i18n.getMessage'
]
const apiReport = (contents) => evaluate(contents, `(() => {
  const api = globalThis.browser || globalThis.chrome;
  const out = {};
  for (const path of ${JSON.stringify(PAGE_APIS)}) {
    let value = api;
    for (const key of path.split('.')) value = value == null ? undefined : value[key];
    out[path] = typeof value;
  }
  return out;
})()`)

async function run() {
  assert.ok(existsSync(join(dist, 'manifest.json')), 'pass the unpacked Bramble Firefox build directory')
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] })}\n`)
  process.env.SURFFISH_BRAMBLE_POC_DEV_AUTOLOAD = '1'
  process.env.SURFFISH_BRAMBLE_EXTENSION_DIR = dist

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows().find((win) => win.contentView && win.contentView.children.length > 0), 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  const surface = (name) => mainWindow.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && surfaceFor(view) === name)
  await waitFor(() => surface('toolbar') && surface('content'), 'the renderer surfaces')
  const toolbar = surface('toolbar').webContents
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const bramble = await waitFor(async () => { const state = await evaluate(toolbar, 'window.api.browser.bramble.get()'); return state.installed && state }, 'Bramble to load', 60000)
  smoke.step(`Bramble ${bramble.version} loaded`)

  const optionsTabs = () => webContents.getAllWebContents().filter((contents) => !contents.isDestroyed() && contents.getURL().startsWith('chrome-extension://') && contents.getURL().includes('/options.html'))
  const tabs = () => evaluate(toolbar, 'window.api.browser.tabs.get()')
  const activeTab = async () => (await tabs()).find((tab) => tab.active)
  const popupWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible() && win.webContents.getURL().endsWith('/popup.html'))

  // 1. Vault through Bramble's own setup page (Settings in the popup needs an unlocked vault).
  await evaluate(toolbar, 'window.api.browser.bramble.setup()')
  const options = await waitFor(() => optionsTabs()[0], 'Bramble options tab')
  await waitFor(() => evaluate(options, `!!document.querySelector('input[name="confirmPassword"]')`), 'the setup form')
  const optionsApis = await apiReport(options)
  console.log('Bramble page API availability (options tab):', JSON.stringify(optionsApis))
  if (process.env.CHECK_DEBUG) console.log('options tabs.query:', JSON.stringify(await evaluate(options, `Promise.resolve(chrome.tabs && chrome.tabs.query && chrome.tabs.query({})).then((t) => t && t.map((x) => [x.id, x.active, x.url]), (e) => 'ERR ' + e.message)`)))
  await options.executeJavaScriptInIsolatedWorld(1999, [{ code: `(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const name of ['masterPassword', 'confirmPassword']) {
      const input = document.querySelector('input[name="' + name + '"]');
      setter.call(input, ${JSON.stringify(MASTER)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const submit = document.querySelector('button[type="submit"]');
    submit.form.requestSubmit(submit);
  })()` }])
  await waitFor(() => evaluate(options, `[...document.querySelectorAll('button')].some((b) => /saved it/i.test(b.textContent))`), 'the recovery code screen', 60000)
  await evaluate(options, `[...document.querySelectorAll('button')].find((b) => /saved it/i.test(b.textContent)).click(); true`)
  smoke.step('vault created')

  const openSettings = async () => {
    await evaluate(toolbar, 'window.api.browser.bramble.open()')
    const popup = await waitFor(popupWindow, 'the Bramble popup', 15000)
    const settingsButton = `[...document.querySelectorAll('button, a')].find((b) => /settings/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + b.textContent))`
    try {
      await waitFor(() => evaluate(popup.webContents, `!!(${settingsButton})`), 'the popup Settings button', 30000)
    } catch (error) {
      console.log('popup buttons:', await evaluate(popup.webContents, `[...document.querySelectorAll('button, a')].map((b) => (b.getAttribute('aria-label') || '') + '|' + b.textContent.trim().slice(0, 40)).join('\\n')`))
      throw error
    }
    await evaluate(popup.webContents, `(${settingsButton}).click(); true`)
    if (process.env.CHECK_DEBUG) { await delay(1500); await shot(popup.webContents, 'after-settings-click'); console.log('after click:', await evaluate(popup.webContents, `location.href + '\\n' + [...document.querySelectorAll('button, a')].map((b) => (b.getAttribute('aria-label') || '') + '|' + b.textContent.trim().slice(0, 40)).join('\\n')`)) }
    // Restore and Import sit in Settings → Backups.
    const backupsTab = `[...document.querySelectorAll('button, a, [role="tab"]')].find((b) => b.textContent.trim() === 'Backups')`
    await waitFor(() => evaluate(popup.webContents, `!!(${backupsTab})`), 'Settings → Backups', 15000)
    await evaluate(popup.webContents, `(${backupsTab}).click(); true`)
    await waitFor(() => evaluate(popup.webContents, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restore')`), 'Settings → Backups → Restore', 15000)
    return popup
  }
  const clickInSettings = async (label, screen) => {
    const popup = await openSettings()
    const popupLog = []
    popup.webContents.on('console-message', (details) => popupLog.push(details.message))
    await shot(popup.webContents, `settings-before-${screen}`)
    await evaluate(popup.webContents, `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click(); true`)
    try {
      await waitFor(async () => (await activeTab())?.url.includes(`options.html?screen=${screen}`), `the ${label} screen tab to be active`, 15000)
    } catch (error) {
      console.log('popup console:', popupLog.join('\n'))
      console.log('tabs:', JSON.stringify((await tabs()).map((tab) => [tab.active, tab.url])))
      throw error
    }
    await waitFor(() => !popupWindow(), 'the popup to close (openSetup calls window.close())', 10000)
    const page = await waitFor(() => optionsTabs().find((contents) => contents.getURL().includes(`screen=${screen}`)), `the ${label} page`)
    await waitFor(() => evaluate(page, 'document.readyState === "complete" && document.body.innerText.trim().length > 0'), `the ${label} page to render`, 15000)
    await delay(500)
    await shot(page, `${screen}-page`)
    return page
  }

  // 2. Settings → Restore opens Bramble's restore screen in a Surffish tab, over a covering panel too.
  await evaluate(toolbar, 'window.api.browser.tabs.create("about:blank")')
  await waitFor(async () => !/options\.html/.test((await activeTab())?.url || 'options.html'), 'another tab to be active')
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "integrations" })')
  const restorePage = await clickInSettings('Restore', 'restore')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode === 'tabs', 'Settings to close so the restore page shows', 5000)
  const restoreText = await evaluate(restorePage, 'document.body.innerText')
  assert.match(restoreText, /restore|backup|\.bramble/i, 'the restore screen renders')
  assert.equal(optionsTabs().length, 1, 'the open Bramble tab is reused, no second tab')
  smoke.step('Settings → Restore opened the restore screen')

  // 3. Settings → Import opens the import screen.
  await evaluate(toolbar, 'window.api.browser.tabs.create("about:blank")')
  await waitFor(async () => !/options\.html/.test((await activeTab())?.url || 'options.html'), 'another tab to be active')
  const importPage = await clickInSettings('Import', 'import')
  const importText = await evaluate(importPage, 'document.body.innerText')
  assert.match(importText, /import|1password|bitwarden|csv/i, 'the import screen renders')
  smoke.step('Settings → Import opened the import screen')

  // 4. tabs.query from Bramble's popup sees Surffish's active tab (Bramble's getCurrentTabOrigin),
  //    and tabs.create with a web URL opens a normal tab.
  const server = http.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>probe</title>probe') })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const pageUrl = `http://127.0.0.1:${server.address().port}/probe`
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(pageUrl)})`)
  await waitFor(async () => (await activeTab())?.url === pageUrl, 'the probe page tab to be active')
  await evaluate(toolbar, 'window.api.browser.bramble.open()')
  const popup = await waitFor(popupWindow, 'the Bramble popup', 15000)
  await waitFor(() => evaluate(popup.webContents, 'document.readyState === "complete"'), 'the popup page')
  const popupApis = await apiReport(popup.webContents)
  const queried = await evaluate(popup.webContents, `chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs.map((tab) => ({ id: tab.id, url: tab.url, windowId: tab.windowId })))`)
  assert.equal(queried.length, 1, JSON.stringify(queried))
  assert.equal(queried[0].url, pageUrl, 'Bramble sees the page URL (it has <all_urls>)')
  const callbackStyle = await evaluate(popup.webContents, `new Promise((done) => chrome.tabs.query({ active: true }, (tabs) => done(Array.isArray(tabs) && tabs.length)))`)
  assert.equal(callbackStyle, 1, 'callback-style tabs.query works')
  smoke.step('tabs.query from the popup sees the active Surffish tab')

  console.log('Bramble page API availability (popup):', JSON.stringify(popupApis))
  for (const [where, report] of [['options', optionsApis], ['popup', popupApis]]) {
    for (const name of ['tabs.create', 'tabs.query', 'tabs.update']) assert.equal(report[name], 'function', `${where}: chrome.${name}`)
  }
  server.close()
  console.log('BRAMBLE TABS CREATE APP CHECK PASSED')
}

run().then(() => app.exit(0), (error) => {
  console.error('BRAMBLE TABS CREATE APP CHECK FAILED:', error && error.stack ? error.stack : error)
  app.exit(1)
}).finally(() => smoke.removeProfile?.(root))
