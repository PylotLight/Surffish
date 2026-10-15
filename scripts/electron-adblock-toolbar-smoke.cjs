// Integration smoke for the toolbar ad-blocker button (uBlock Origin-style popup), against the
// production build with a seeded filter engine:
//   - the button counts requests blocked on the tab's page (page + cross-site iframe)
//   - the popover lists them by domain and shows the site's switch
//   - "off for this site" is saved per site and, after the popover's Reload, disables every layer:
//     network (page and its iframes), cosmetic hiding and scriptlets; the count goes to 0
//   - back on + Reload blocks again; the switch is the same as Settings → This site
//   - "Ad blocking settings…" opens This site; Escape closes the popover
// `bun run build && bun run test:electron-adblock-toolbar`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-adblock-toolbar-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents: allWebContents } = require('electron')

const userData = join(tmpdir(), `surffish-adblock-toolbar-smoke-${process.pid}`)

const RESOURCES = JSON.stringify({
  redirects: [],
  scriptlets: [{
    name: 'surffish-record.js',
    aliases: [],
    body: 'function surffishRecord(name, value) { window[name] = value === undefined ? true : value }',
    dependencies: []
  }]
})

const script = (response, body) => {
  response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(body)
}
const html = (response, body) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(body)
}

// The embed on another site ("localhost" vs the page's 127.0.0.1): its ad request is the page's too.
const frameServer = createServer((request, response) => {
  if (request.url === '/ad.js') return script(response, 'window.frameAdLoaded = true')
  html(response, '<!doctype html><title>Embed</title><p>embed</p><script src="/ad.js"></script>')
})
let frameOrigin = ''
const pageServer = createServer((request, response) => {
  if (request.url === '/ad.js') return script(response, 'window.adLoaded = true')
  if (request.url === '/tracker.js') return script(response, 'window.trackerLoaded = true')
  if (request.url === '/ads') {
    return html(response, `<!doctype html><title>Ads fixture</title>
      <div class="ad-banner" id="ad">ad</div><p id="content">content</p>
      <script src="/ad.js"></script><script src="/tracker.js"></script>
      <iframe id="embed" src="${frameOrigin}/embed" style="width:300px;height:80px;border:0"></iframe>`)
  }
  html(response, '<!doctype html><title>Start</title><h1>Start</h1>')
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
const pageContents = (predicate) => allWebContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getType() !== 'remote' && predicate(contents.getURL(), contents))

async function seedEngine(pagePort, framePort) {
  const engineModule = await import(pathToFileURL(resolve(__dirname, '../out/main/adblock-engine.js')).href)
  const lists = {
    'https://fixture.invalid/main.txt': [
      `||127.0.0.1:${pagePort}/ad.js$script`,
      `||127.0.0.1:${pagePort}/tracker.js$script`,
      `||localhost:${framePort}/ad.js$script`,
      '127.0.0.1##.ad-banner',
      '127.0.0.1##+js(surffish-record, surffishScriptlet, yes)'
    ].join('\n'),
    'https://fixture.invalid/quick.txt': '! quick fixes',
    'https://fixture.invalid/easylist.txt': '! easylist'
  }
  const fixtureFetch = async (url) => {
    if (url.endsWith('/resources.json')) return new Response(RESOURCES)
    if (lists[url] !== undefined) return new Response(lists[url])
    return new Response('missing', { status: 404 })
  }
  const { engine } = await engineModule.buildFilterEngine(fixtureFetch, [
    { id: 'ublock-filters', url: 'https://fixture.invalid/main.txt' },
    { id: 'ublock-quick-fixes', url: 'https://fixture.invalid/quick.txt' },
    { id: 'easylist', url: 'https://fixture.invalid/easylist.txt' }
  ])
  // A fresh cache under the real name: the app loads it and never downloads lists.
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), engine.serialize(), { mode: 0o600 })
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => frameServer.listen(0, '127.0.0.1', resolvePromise))
  frameOrigin = `http://localhost:${frameServer.address().port}`
  await new Promise((resolvePromise) => pageServer.listen(0, '127.0.0.1', resolvePromise))
  const pageOrigin = `http://127.0.0.1:${pageServer.address().port}`
  const fixtureUrl = `${pageOrigin}/ads`
  await seedEngine(pageServer.address().port, frameServer.address().port)
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [fixtureUrl], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()

  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  await waitFor(() => smoke.evaluate(toolbar.webContents, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const inToolbar = (code) => smoke.evaluate(toolbar.webContents, code)
  const state = () => inToolbar('window.api.browser.state()')
  const fixture = await waitFor(() => pageContents((url) => url === fixtureUrl), 'the fixture page contents')
  const embedFrame = () => fixture.mainFrame.framesInSubtree.find((frame) => frame.url.startsWith(`${frameOrigin}/embed`))
  const page = () => smoke.evaluate(fixture, `({
    ad: window.adLoaded === true,
    tracker: window.trackerLoaded === true,
    scriptlet: window.surffishScriptlet === 'yes',
    adHidden: getComputedStyle(document.getElementById('ad')).display === 'none',
    content: getComputedStyle(document.getElementById('content')).display !== 'none'
  })`)
  const frameAd = async () => Boolean(embedFrame()) && await embedFrame().executeJavaScript('window.frameAdLoaded === true')
  const loaded = async () => { const current = await state(); return current.url === fixtureUrl && !current.loading }
  const buttonBlocked = () => inToolbar('Number(document.querySelector(".adblock-button")?.dataset.blocked ?? -1)')
  const popoverOpen = () => inToolbar('Boolean(document.querySelector("#adblock-popover .adblock-switch-row"))')
  const click = (selector) => inToolbar(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true })()`)
  const siteBlocks = async () => (await inToolbar(`window.api.browser.siteSettings.get(${JSON.stringify(pageOrigin)})`)).blockAds

  smoke.step('blocking on: the button counts the page\'s and its iframe\'s blocked requests')
  await waitFor(loaded, 'the fixture page')
  await waitFor(() => embedFrame(), 'the cross-site embed')
  await waitFor(async () => (await buttonBlocked()) === 3, 'the toolbar button to count 3 blocked requests')
  assert.equal(await inToolbar('document.querySelector(".adblock-badge")?.textContent'), '3')
  const on = await page()
  assert.deepEqual(on, { ad: false, tracker: false, scriptlet: true, adHidden: true, content: true }, 'network, cosmetic and scriptlet layers are on')
  assert.equal(await frameAd(), false, 'the iframe\'s ad is blocked too')

  smoke.step('the popover lists blocked requests by domain and the site switch')
  assert.equal(await click('.adblock-button'), true)
  await waitFor(popoverOpen, 'the ad-blocker popover')
  const rows = await waitFor(async () => {
    const list = await inToolbar('Array.from(document.querySelectorAll("#adblock-popover .adblock-host-row"), (row) => [row.dataset.host, Number(row.querySelector(".adblock-host-count").textContent)])')
    return list.length === 2 ? list : null
  }, 'two domains in the popover')
  assert.deepEqual(rows, [['127.0.0.1', 2], ['localhost', 1]])
  assert.equal(await inToolbar('document.querySelector("#adblock-popover .adblock-total").textContent'), '3')
  assert.equal(await inToolbar('document.querySelector(".adblock-site-switch").checked'), true)
  assert.equal(await inToolbar('document.querySelector("#adblock-popover .adblock-host").textContent'), '127.0.0.1')

  smoke.step('off for this site: saved per site, Reload applies it to every layer')
  assert.equal(await click('.adblock-site-switch'), true)
  await waitFor(async () => (await siteBlocks()) === false, 'the site setting to save blockAds=false')
  await waitFor(() => inToolbar('Boolean(document.querySelector("#adblock-popover .adblock-reload-button"))'), 'the reload prompt')
  await waitFor(() => inToolbar('document.querySelector(".adblock-button").classList.contains("is-off")'), 'the button to show blocking off')
  assert.equal(await inToolbar('document.querySelector(".adblock-badge")'), null, 'no count badge while off')
  assert.equal(await click('#adblock-popover .adblock-reload-button'), true)
  await waitFor(async () => (await page()).ad === true, 'the page to reload with ads allowed')
  await waitFor(loaded, 'the reload to finish')
  const off = await waitFor(async () => { const now = await page(); return now.tracker ? now : null }, 'the tracker to load too')
  assert.deepEqual(off, { ad: true, tracker: true, scriptlet: false, adHidden: false, content: true }, 'off disables network, cosmetic and scriptlet layers')
  await waitFor(frameAd, 'the iframe\'s ad to load with the site off')
  await waitFor(async () => (await buttonBlocked()) === 0, 'the count to reset to 0')
  assert.equal(await popoverOpen(), true, 'the popover stays open across its Reload')
  assert.equal(await inToolbar('Boolean(document.querySelector("#adblock-popover .adblock-reload-button"))'), false, 'the reload prompt is gone')
  assert.equal(await inToolbar('document.querySelector("#adblock-popover .adblock-total").textContent'), '0')
  assert.equal(await inToolbar('document.querySelector(".adblock-site-switch").checked'), false)

  smoke.step('back on + Reload blocks again')
  assert.equal(await click('.adblock-site-switch'), true)
  await waitFor(async () => (await siteBlocks()) === true, 'the site setting to save blockAds=true')
  assert.equal(await click('#adblock-popover .adblock-reload-button'), true)
  await waitFor(async () => (await buttonBlocked()) === 3, 'the count to come back to 3')
  await waitFor(loaded, 'the reload to finish')
  assert.deepEqual(await page(), on)

  smoke.step('Escape closes the popover; "Ad blocking settings…" opens This site')
  toolbar.webContents.focus()
  toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  toolbar.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor(async () => !(await popoverOpen()), 'Escape to close the popover')
  assert.equal(await click('.adblock-button'), true)
  await waitFor(popoverOpen, 'the popover again')
  assert.equal(await click('#adblock-popover .adblock-settings-link'), true)
  await waitFor(async () => !(await popoverOpen()), 'the popover to close for Settings')
  const siteView = await waitFor(async () => {
    for (const view of views()) {
      const found = await smoke.evaluate(view.webContents, 'Boolean(document.querySelector(".site-settings-view")) && document.querySelector(\'input[aria-label="Block ads and trackers on this site"]\')?.checked')
      if (found !== null && found !== false && found !== undefined) return { checked: found }
    }
    return null
  }, 'Settings → This site with the ad-block switch')
  assert.equal(siteView.checked, true, 'Settings → This site shows the same switch, on')

  console.log('Adblock toolbar smoke passed.')
}

run().then(() => {
  frameServer.close()
  pageServer.close()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  frameServer.close()
  pageServer.close()
  app.exit(1)
})
