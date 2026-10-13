// Integration smoke for Web Store extensions that use declarativeNetRequest + webNavigation + scripting
// (the shape of "I still don't care about cookies"). Runs the production build with the ad blocker
// attached (so Electron's native DNR engine is bypassed and Surffish's own enforcement is what's tested):
//   bun run build && bun run test:electron-extension-dnr
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/electron-extension-dnr-smoke.cjs)
//
// By default it installs a tiny extension generated here (no vendored code). To run it against the real
// extension instead:
//   bun scripts/fetch-web-store-extension.ts i-still-dont-care-about-cookies /tmp/isdcac
//   SURFFISH_DNR_SMOKE_EXTENSION=/tmp/isdcac electron scripts/electron-extension-dnr-smoke.cjs
//
// Verifies: a static-ruleset block rule stops a request (the server never sees it); webNavigation
// onCommitted/onCompleted reach the worker and scripting.insertCSS/executeScript hide a cookie banner in
// the page and in an iframe; a dynamic allow rule the extension adds (its "disable on this site" switch)
// lets the request through for that site only; and (generated extension) redirect + modifyHeaders.
// Prints the DNR gate's measured cost per request.
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createHash, generateKeyPairSync } = require('node:crypto')
const { createServer } = require('node:http')
const { cpSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

process.env.SURFFISH_SMOKE_DNR_STATS = '1'
const realExtension = process.env.SURFFISH_DNR_SMOKE_EXTENSION ? resolve(process.env.SURFFISH_DNR_SMOKE_EXTENSION) : null
const userData = join(tmpdir(), `surffish-extension-dnr-smoke-${process.pid}`)
const requests = []
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

const COOKIE_PAGE = `<!doctype html><meta charset="utf-8"><title>Cookie fixture</title>
<div id="cookie-law-info-bar" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#333;color:#fff">We use cookies <button>Accept</button></div>
<p id="content">content</p>
<script src="/iubenda_cs.js"></script>
<script src="/allowed.js"></script>
<script src="/old.js"></script>
<iframe id="frame" src="/frame"></iframe>`
const FRAME_PAGE = '<!doctype html><meta charset="utf-8"><div id="cookie-law-info-bar">frame banner</div>'

const server = createServer((request, response) => {
  requests.push({ host: request.headers.host, url: request.url, dnrHeader: request.headers['x-surffish-dnr'] })
  const send = (type, body, extra = {}) => {
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...extra })
    response.end(body)
  }
  if (request.url === '/cookies') return send('text/html; charset=utf-8', COOKIE_PAGE)
  if (request.url === '/frame') return send('text/html; charset=utf-8', FRAME_PAGE)
  if (request.url === '/iubenda_cs.js') return send('text/javascript', 'window.consentScriptLoaded = true')
  if (request.url === '/allowed.js') return send('text/javascript', 'window.allowedLoaded = true')
  if (request.url === '/old.js') return send('text/javascript', 'window.oldLoaded = true')
  if (request.url === '/new.js') return send('text/javascript', 'window.newLoaded = true')
  if (request.url === '/echo') return send('application/json', JSON.stringify({ dnr: request.headers['x-surffish-dnr'] ?? null }), { 'x-remove-me': 'present', 'x-keep-me': 'present' })
  response.writeHead(404)
  response.end()
})

/** Chrome's extension id for a public key: sha256 of the DER, first 32 hex digits mapped to a-p. */
function extensionIdForKey(base64Key) {
  return createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)))
}

/** A tiny MV3 extension shaped like the cookie extension, generated (and keyed) at run time. */
function writeFixtureExtension(directory, origin) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const manifest = {
    manifest_version: 3,
    name: 'Surffish DNR fixture',
    version: '1.0.0',
    key,
    permissions: ['tabs', 'storage', 'scripting', 'webNavigation', 'declarativeNetRequestWithHostAccess'],
    host_permissions: ['http://*/*', 'https://*/*'],
    background: { service_worker: 'surffish-extension-background.js', type: 'module' },
    declarative_net_request: { rule_resources: [{ id: 'ruleset_1', enabled: true, path: 'rules.json' }, { id: 'ruleset_off', enabled: false, path: 'off.json' }] }
  }
  const rules = [
    { id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/iubenda_cs', resourceTypes: ['script', 'stylesheet', 'xmlhttprequest', 'image'] } },
    { id: 2, priority: 1, action: { type: 'redirect', redirect: { transform: { path: '/new.js' } } }, condition: { urlFilter: '/old.js|', resourceTypes: ['script'] } },
    { id: 3, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'x-surffish-dnr', operation: 'set', value: 'yes' }], responseHeaders: [{ header: 'x-remove-me', operation: 'remove' }] }, condition: { urlFilter: '/echo', resourceTypes: ['xmlhttprequest'] } }
  ]
  const background = `
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || !d.url.startsWith('http')) return
  chrome.scripting.insertCSS({ target: { tabId: d.tabId, frameIds: [0] }, files: ['/hide.css'], origin: 'USER' })
  chrome.scripting.executeScript({ target: { tabId: d.tabId, frameIds: [0] }, files: ['/mark.js'] })
})
chrome.webNavigation.onCompleted.addListener((d) => {
  if (d.frameId > 0 && d.url.startsWith('http')) chrome.scripting.insertCSS({ target: { tabId: d.tabId, frameIds: [d.frameId] }, files: ['/hide.css'], origin: 'USER' })
})
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.command === 'allow') {
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1], addRules: [{ id: 1, priority: 1, action: { type: 'allow' }, condition: { urlFilter: '*', resourceTypes: ['script'], initiatorDomains: [message.domain] } }] })
      .then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }
  if (message && message.command === 'state') {
    Promise.all([chrome.tabs.query({}), chrome.declarativeNetRequest.getEnabledRulesets()]).then(([tabs, rulesets]) => sendResponse({ tabs: tabs.map((tab) => tab.url), rulesets }))
    return true
  }
  return undefined
})
`
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(directory, 'rules.json'), JSON.stringify(rules))
  writeFileSync(join(directory, 'off.json'), JSON.stringify([{ id: 1, action: { type: 'block' }, condition: { urlFilter: '/allowed.js' } }]))
  writeFileSync(join(directory, 'background.js'), background)
  writeFileSync(join(directory, 'hide.css'), '#cookie-law-info-bar { display: none !important; }')
  writeFileSync(join(directory, 'mark.js'), 'document.documentElement.dataset.fixtureInjected = "yes"')
  // What Surffish's staging leaves next to the package (the app rewrites the shim files at load).
  writeFileSync(join(directory, 'surffish-extension.json'), JSON.stringify({ worker: { original: 'background.js', wrapper: 'surffish-extension-background.js', module: true } }))
  void origin
  return { id: extensionIdForKey(key), version: manifest.version, name: manifest.name }
}

function seedExtension(origin) {
  const root = join(userData, 'extensions')
  let info
  if (realExtension) {
    const manifest = JSON.parse(readFileSync(join(realExtension, 'manifest.json'), 'utf8'))
    assert.ok(manifest.key, 'stage the real extension with scripts/fetch-web-store-extension.ts (it pins the store key)')
    info = { id: extensionIdForKey(manifest.key), version: manifest.version, name: 'I still don’t care about cookies' }
    cpSync(realExtension, join(root, info.id, info.version), { recursive: true })
  } else {
    const scratch = join(userData, 'fixture-source')
    info = writeFixtureExtension(scratch, origin)
    cpSync(scratch, join(root, info.id, info.version), { recursive: true })
  }
  const now = Date.now()
  writeFileSync(join(root, 'installed.json'), JSON.stringify({ version: 1, extensions: [{ ...info, enabled: true, installedAt: now, updatedAt: now, compatibility: 'partial', gaps: [], shimmed: [] }] }))
  return info
}

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

function views(win) {
  return win.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
}

function surface(win, name) {
  return views(win).find((view) => {
    try {
      return new URL(view.webContents.getURL()).searchParams.get('surface') === name
    } catch {
      return false
    }
  })
}

async function evaluate(contents, expression) {
  try {
    return await contents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  const extension = seedExtension(origin)
  console.log(`Installed ${realExtension ? 'the real extension' : 'the generated fixture extension'} ${extension.id} ${extension.version}`)

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const win = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  win.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  const toolbar = await waitFor(() => surface(win, 'toolbar'), 'the toolbar surface')
  await waitFor(() => evaluate(toolbar.webContents, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const extensionsState = await waitFor(async () => {
    const state = await evaluate(toolbar.webContents, 'window.api.browser.extensions ? window.api.browser.extensions.get() : null').catch(() => null)
    return state && state.extensions && state.extensions.find((entry) => entry.id === extension.id && entry.loaded) ? state : null
  }, 'the extension to load')
  const loadedEntry = extensionsState.extensions.find((entry) => entry.id === extension.id)
  assert.equal(loadedEntry.error, null, 'the extension loaded without errors')
  const bridge = await waitFor(() => webContents.getAllWebContents().find((contents) => contents.getURL() === `chrome-extension://${extension.id}/surffish-bridge.html`), 'the extension bridge page')
  await waitFor(() => evaluate(bridge, 'document.readyState === "complete"'), 'the bridge page to load')

  // --- 1. static ruleset block + banner hidden via webNavigation → scripting
  const statsBefore = globalThis.__surffishExtensionDnrStats()
  assert.ok(statsBefore.rules >= 1, `Surffish loaded the extension's static rules (${statsBefore.rules})`)
  await evaluate(toolbar.webContents, `window.api.browser.navigate(${JSON.stringify(`${origin}/cookies`)})`)
  const page = await waitFor(() => views(win).find((view) => view.webContents.getURL() === `${origin}/cookies`), 'the cookie page')
  await waitFor(async () => !page.webContents.isLoading() && await evaluate(page.webContents, 'window.allowedLoaded === true'), 'the cookie page to load')
  const bannerHidden = (frame) => `(() => { const doc = ${frame ? 'document.getElementById("frame").contentDocument' : 'document'}; const el = doc && doc.getElementById('cookie-law-info-bar'); return Boolean(el) && getComputedStyle(el).display === 'none' })()`
  await waitFor(() => evaluate(page.webContents, bannerHidden(false)), 'the cookie banner to be hidden by the extension')
  await waitFor(() => evaluate(page.webContents, bannerHidden(true)), 'the iframe cookie banner to be hidden (onCompleted with the frame id)')
  assert.equal(await evaluate(page.webContents, 'window.consentScriptLoaded === true'), false, 'the blocked consent script did not run')
  assert.ok(!requests.some((entry) => entry.url === '/iubenda_cs.js'), 'the blocked request never reached the server')
  console.log('ok: static block rule enforced, banner hidden in page and iframe')

  if (!realExtension) {
    assert.equal(await evaluate(page.webContents, 'document.documentElement.dataset.fixtureInjected'), 'yes', 'executeScript ran in the tab')
    assert.equal(await evaluate(page.webContents, 'window.newLoaded === true && window.oldLoaded !== true'), true, 'the redirect rule served /new.js')
    const echo = await evaluate(page.webContents, 'fetch("/echo").then(async (r) => ({ body: await r.json(), removed: r.headers.get("x-remove-me"), kept: r.headers.get("x-keep-me") }))')
    assert.deepEqual(echo, { body: { dnr: 'yes' }, removed: null, kept: 'present' }, 'modifyHeaders set the request header and removed the response header')
    const state = await evaluate(bridge, 'chrome.runtime.sendMessage({ command: "state" })')
    assert.deepEqual(state.rulesets, ['ruleset_1'], 'the native getEnabledRulesets() mirrors the manifest default')
    assert.ok(!state.tabs.some((url) => url.includes('surffish-bridge.html')), 'tabs.query in the worker hides the bridge page')
    assert.ok(state.tabs.includes(`${origin}/cookies`), 'tabs.query in the worker sees the tab')
    console.log('ok: executeScript, redirect, modifyHeaders (request + response), enabled rulesets, tabs.query')
  }

  // --- 2. the extension's per-site switch: a dynamic allow rule for one initiator domain
  if (realExtension) {
    await evaluate(bridge, `new Promise((done) => chrome.storage.local.set({ settings: { whitelistedDomains: { localhost: true }, statusIndicators: true } }, () => chrome.runtime.sendMessage('update_settings').then(done, done)))`)
  } else {
    const result = await evaluate(bridge, 'chrome.runtime.sendMessage({ command: "allow", domain: "localhost" })')
    assert.deepEqual(result, { ok: true })
  }
  const localhostUrl = `http://localhost:${port}/cookies`
  await waitFor(async () => {
    await evaluate(toolbar.webContents, `window.api.browser.navigate(${JSON.stringify(localhostUrl)})`)
    const view = await waitFor(() => views(win).find((candidate) => candidate.webContents.getURL() === localhostUrl), 'the localhost page', 5000)
    await waitFor(async () => !view.webContents.isLoading() && await evaluate(view.webContents, 'window.allowedLoaded === true'), 'the localhost page to load', 5000)
    return evaluate(view.webContents, 'window.consentScriptLoaded === true')
  }, 'the dynamic allow rule to let the consent script load on localhost')
  assert.ok(requests.some((entry) => entry.host === `localhost:${port}` && entry.url === '/iubenda_cs.js'), 'the allowed request reached the server')
  // Still blocked on the other site.
  requests.length = 0
  await evaluate(toolbar.webContents, `window.api.browser.navigate(${JSON.stringify(`${origin}/cookies`)})`)
  const again = await waitFor(() => views(win).find((view) => view.webContents.getURL() === `${origin}/cookies`), 'the cookie page again')
  await waitFor(async () => !again.webContents.isLoading() && await evaluate(again.webContents, 'window.allowedLoaded === true'), 'the cookie page to reload')
  assert.ok(!requests.some((entry) => entry.url === '/iubenda_cs.js'), 'the consent script is still blocked on 127.0.0.1')
  console.log('ok: dynamic allow rule (per-site switch) applied for localhost only')

  // --- 3. per-request cost of the DNR gate, warm (after the first loads JIT-compile the matcher)
  const cold = globalThis.__surffishExtensionDnrStats()
  for (let index = 0; index < 8; index += 1) {
    again.webContents.reloadIgnoringCache()
    await waitFor(async () => !again.webContents.isLoading() && await evaluate(again.webContents, 'window.allowedLoaded === true'), 'a reload to finish')
  }
  const stats = globalThis.__surffishExtensionDnrStats()
  const coldPerRequest = cold.evaluated > 0 ? cold.gateMicroseconds / cold.evaluated : 0
  const warmPerRequest = stats.evaluated > cold.evaluated ? (stats.gateMicroseconds - cold.gateMicroseconds) / (stats.evaluated - cold.evaluated) : 0
  console.log(`DNR gate: ${stats.rules} rules, ${stats.evaluated} requests evaluated, ${stats.blocked} blocked, ${stats.redirected} redirected, ${stats.allowed} allowed; ${warmPerRequest.toFixed(1)} µs per request warm (${coldPerRequest.toFixed(1)} µs over the first ${cold.evaluated}, incl. JIT warm-up) in the main-process webRequest handler`)
  console.log('Electron extension DNR smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron extension DNR smoke failed:', error)
  app.exit(1)
})
