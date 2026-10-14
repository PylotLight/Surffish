// Integration smoke for certificate handling and local-network proxy bypass:
//   1. OS-trust fallback: a chain Chromium doesn't know (test root) that "the OS" trusts (passed in
//      with SURFFISH_TEST_TRUST_ANCHORS, honoured by unpackaged builds only) loads, and the site menu
//      shows "Connection is secure" + a certificate viewer with the full chain.
//   2. A self-signed certificate shows the full-page certificate interstitial; Advanced shows the
//      certificate facts; "Proceed (unsafe)" loads it, the address bar says Not secure and the site
//      menu's viewer says the certificate is not valid. The exception is per session partition
//      (a private tab gets the interstitial again).
//   3. Local-network addresses skip the SOCKS proxy (fixed-servers and PAC configs), and a proxy
//      failure is a full-page error with "Route <host> Direct".
// Runs the production build: `bun run build && bun run test:electron-certificates`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-certificates-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots.
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createServer: createTlsServer } = require('node:https')
const { createServer: createNetServer } = require('node:net')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, session } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const fixtures = resolve(__dirname, 'fixtures/certs')
const userData = join(tmpdir(), `surffish-certificates-smoke-${process.pid}`)
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS
// "The OS trusts the test root": only the unpackaged build reads this (certificate-inspect.ts).
process.env.SURFFISH_TEST_TRUST_ANCHORS = join(fixtures, 'test-root.pem')
// Every *.surffish.test name is this machine (no DNS, no network).
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.surffish.test 127.0.0.1')

const read = (name) => readFileSync(join(fixtures, name))
const page = (title) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;padding:24px;background:#f6f7f9"><h1>${title}</h1><p>Served by the certificates smoke.</p></body>`
const handler = (title) => (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(page(title))
}
const trustedServer = createTlsServer({ key: read('trusted-leaf.key'), cert: Buffer.concat([read('trusted-leaf.pem'), read('test-intermediate.pem')]) }, handler('UniFi Network (trusted chain)'))
const selfSignedServer = createTlsServer({ key: read('self-signed.key'), cert: read('self-signed.pem') }, handler('UniFi OS (self-signed)'))
const httpServer = createServer(handler('Plain fixture'))
// A port that accepts nothing: the SOCKS proxy is "down".
const deadProxy = createNetServer()

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
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => surfaceFor(view) === name)
const evaluate = (view, expression) => smoke.evaluate(view.webContents, expression)

async function screenshot(view, name, rect) {
  if (!screenshots) return
  mkdirSync(screenshots, { recursive: true })
  await delay(450)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const image = await view.webContents.capturePage(rect)
      writeFileSync(join(screenshots, name), image.toPNG())
      return
    } catch (error) {
      if (attempt === 2) console.warn(`[certificates] could not capture ${name}: ${error.message}`)
      await delay(400)
    }
  }
}

/** The whole window (toolbar + page area), composed from the surfaces. */
async function windowShot(name) {
  if (!screenshots) return
  mkdirSync(screenshots, { recursive: true })
  await delay(500)
  try {
    const { nativeImage } = require('electron')
    const bounds = mainWindow.getContentBounds()
    const canvas = Buffer.alloc(bounds.width * bounds.height * 4)
    const ordered = views().filter((view) => (typeof view.getVisible !== 'function' || view.getVisible()))
    for (const view of ordered) {
      const rect = view.getBounds()
      if (rect.width <= 0 || rect.height <= 0) continue
      const image = await view.webContents.capturePage()
      const sized = image.resize({ width: rect.width, height: rect.height })
      const bitmap = sized.toBitmap()
      for (let y = 0; y < rect.height; y += 1) {
        const ty = rect.y + y
        if (ty < 0 || ty >= bounds.height) continue
        for (let x = 0; x < rect.width; x += 1) {
          const tx = rect.x + x
          if (tx < 0 || tx >= bounds.width) continue
          const s = (y * rect.width + x) * 4
          const alpha = bitmap[s + 3]
          if (alpha === 0) continue
          const d = (ty * bounds.width + tx) * 4
          const a = alpha / 255
          for (let c = 0; c < 3; c += 1) canvas[d + c] = Math.round(bitmap[s + c] * a + canvas[d + c] * (1 - a))
          canvas[d + 3] = 255
        }
      }
    }
    writeFileSync(join(screenshots, name), nativeImage.createFromBitmap(canvas, { width: bounds.width, height: bounds.height }).toPNG())
  } catch (error) {
    console.warn(`[certificates] could not compose ${name}: ${error.message}`)
  }
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  const listen = (server) => new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  await Promise.all([listen(trustedServer), listen(selfSignedServer), listen(httpServer), listen(deadProxy)])
  // The dead proxy: close it again so connects are refused (port stays free for a while).
  const deadPort = deadProxy.address().port
  await new Promise((resolvePromise) => deadProxy.close(resolvePromise))
  const trustedUrl = `https://trusted.surffish.test:${trustedServer.address().port}/network/default`
  const selfSignedUrl = `https://selfsigned.surffish.test:${selfSignedServer.address().port}/`
  const httpOrigin = `http://127.0.0.1:${httpServer.address().port}`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${httpOrigin}/start`], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1180, height: 820 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const content = surface('content')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  await waitFor(() => evaluate(content, 'document.readyState === "complete" && Boolean(window.api)'), 'the content renderer')
  const state = () => evaluate(toolbar, 'window.api.browser.state()')
  await waitFor(async () => { const current = await state(); return current.url === `${httpOrigin}/start` && !current.loading }, 'the start page')

  const openSiteMenu = async () => {
    await evaluate(toolbar, 'document.querySelector("#site-actions-menu") || document.querySelector(".site-actions-button").click()')
    return waitFor(() => evaluate(toolbar, `(() => { const el = document.querySelector('#site-actions-menu'); return el ? { text: el.textContent, connection: el.querySelector('.site-connection')?.className ?? '', certRow: el.querySelector('.site-connection-cert')?.textContent ?? null } : null })()`), 'the site menu')
  }
  const closeSiteMenu = async () => {
    await evaluate(toolbar, 'document.querySelector("#site-actions-menu") && document.querySelector(".site-actions-button").click()')
    await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector("#site-actions-menu"))')), 'the site menu to close')
  }
  const openViewer = async () => {
    await evaluate(toolbar, 'document.querySelector(".site-connection-cert").click()')
    return waitFor(() => evaluate(toolbar, `(() => { const el = document.querySelector('#site-actions-menu .cert-viewer'); return el && el.querySelector('.cert-fields') ? { text: el.textContent, verdict: el.querySelector('.cert-verdict')?.className ?? '', chain: [...el.querySelectorAll('.cert-chain-entry')].map((entry) => entry.textContent) } : null })()`), 'the certificate viewer')
  }

  // --- 1. OS-trusted chain loads; site menu says secure; viewer shows the chain and fields
  smoke.step('OS-trust fallback')
  assert.deepEqual(await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(trustedUrl)})`), { ok: true }, 'a chain the OS trusts opens')
  const trustedState = await waitFor(async () => { const current = await state(); return current.url === trustedUrl && !current.loading && current.security ? current : null }, 'the OS-trusted page with its security state')
  assert.equal(trustedState.error, null)
  assert.equal(trustedState.security.level, 'os-trusted', 'Chromium rejected the unknown root; the OS trust store accepted it')
  assert.equal(trustedState.security.host, 'trusted.surffish.test')
  const secureMenu = await openSiteMenu()
  assert.match(secureMenu.connection, /is-secure/)
  assert.match(secureMenu.text, /Connection is secure/)
  assert.match(secureMenu.certRow, /Certificate is valid/)
  assert.ok(await evaluate(toolbar, 'Boolean(document.querySelector(".site-actions-button svg.site-actions-lock:not(.is-broken)"))'), 'the site button shows a lock')
  await windowShot('certificates-site-menu-secure.png')
  const secureViewer = await openViewer()
  assert.match(secureViewer.verdict, /is-valid/)
  assert.deepEqual(secureViewer.chain.map((entry) => entry.replace(/\s+/g, ' ')), ['Sitetrusted.surffish.test', 'IssuerSurffish Test Intermediate CA'])
  for (const expected of ['trusted.surffish.test', 'Surffish Test', 'Gateway', 'Surffish Test Intermediate CA', 'SHA-256', 'SHA-1', 'DNS:trusted.surffish.test', 'IP Address:127.0.0.1', 'EC (P-256)', 'TLS Web Server Authentication', 'Serial number', 'Expires on', 'keychain']) {
    assert.ok(secureViewer.text.includes(expected), `the viewer shows ${expected}`)
  }
  await windowShot('certificates-viewer-secure.png')
  // Select the intermediate in the chain: its own fields show.
  await evaluate(toolbar, 'document.querySelectorAll("#site-actions-menu .cert-chain-entry")[1].click()')
  await waitFor(() => evaluate(toolbar, `(() => { const el = document.querySelector('#site-actions-menu .cert-fields'); return el && el.textContent.includes('Surffish Test Root CA') && el.textContent.includes('Yes') })()`), 'the intermediate certificate fields (issuer = root, CA = yes)')
  await closeSiteMenu()

  // --- 2. Self-signed: full-page interstitial, Advanced, Proceed
  smoke.step('certificate interstitial')
  const failed = await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(selfSignedUrl)})`)
  assert.equal(failed.ok, false)
  assert.equal(failed.code, -202)
  const failedState = await waitFor(async () => { const current = await state(); return current.loadError && !current.loading ? current : null }, 'the certificate load error')
  assert.equal(failedState.loadError.name, 'ERR_CERT_AUTHORITY_INVALID')
  assert.equal(failedState.loadError.fullPage, true, 'a certificate failure is a full-page error')
  assert.equal(failedState.security ?? null, null)
  const interstitial = () => evaluate(content, `(() => { const el = document.querySelector('.tab-interstitial.is-certificate'); return el ? { title: el.querySelector('h1')?.textContent ?? '', text: el.textContent } : null })()`)
  const shown = await waitFor(interstitial, 'the certificate interstitial')
  assert.equal(shown.title, 'Your connection isn’t private')
  assert.match(shown.text, /selfsigned\.surffish\.test/)
  assert.match(shown.text, /ERR_CERT_AUTHORITY_INVALID/)
  assert.match(shown.text, /Advanced/)
  assert.doesNotMatch(shown.text, /Proceed to/, 'Proceed hides behind Advanced')
  assert.equal(await evaluate(toolbar, 'Boolean(document.querySelector("#browser-notice"))'), false, 'no toolbar toast on top of the error page')
  if (typeof content.getVisible === 'function') await waitFor(() => content.getVisible(), 'the content surface (interstitial) on screen')
  await windowShot('certificates-interstitial.png')
  // The site menu on the error page says not private and opens the failing certificate.
  const errorMenu = await openSiteMenu()
  assert.match(errorMenu.text, /Connection is not private/)
  const errorViewer = await openViewer()
  assert.match(errorViewer.verdict, /is-invalid/)
  assert.match(errorViewer.text, /Ubiquiti Inc\./)
  await closeSiteMenu()
  await evaluate(content, 'document.querySelector(".cert-advanced-toggle").click()')
  const advanced = await waitFor(() => evaluate(content, `(() => { const el = document.querySelector('.cert-advanced'); return el && el.querySelector('.cert-advanced-facts') && el.querySelector('.cert-proceed') ? el.textContent : null })()`), 'the Advanced details with Proceed')
  for (const expected of ['selfsigned.surffish.test', 'Issued by', '(self-signed)', 'SHA-256', 'Proceed to selfsigned.surffish.test (unsafe)', 'authority this computer trusts']) assert.ok(advanced.includes(expected), `Advanced shows ${expected}`)
  await windowShot('certificates-interstitial-advanced.png')
  await evaluate(content, '[...document.querySelectorAll(".cert-link")].find((button) => button.textContent === "View certificate").click()')
  await waitFor(() => evaluate(content, 'Boolean(document.querySelector(".cert-advanced-viewer .cert-fields"))'), 'the inline certificate viewer')
  await windowShot('certificates-interstitial-viewer.png')
  await evaluate(content, 'document.querySelector(".cert-proceed").click()')
  const bypassed = await waitFor(async () => { const current = await state(); return current.url === selfSignedUrl && !current.loading && current.error === null && current.security?.level === 'bypassed' ? current : null }, 'the page to load after Proceed (bypassed)')
  assert.equal(bypassed.security.error, 'ERR_CERT_AUTHORITY_INVALID')
  await waitFor(async () => (await interstitial()) === null, 'the interstitial to go away')
  await waitFor(() => evaluate(toolbar, 'document.querySelector(".omnibox-insecure-pill.is-cert-bypassed")?.textContent === "Not secure"'), 'the Not secure pill in the address bar')
  assert.ok(await evaluate(toolbar, 'Boolean(document.querySelector(".site-actions-button svg.site-actions-lock.is-broken"))'), 'the site button shows a struck lock')
  const bypassMenu = await openSiteMenu()
  assert.match(bypassMenu.connection, /is-not-secure/)
  assert.match(bypassMenu.text, /Connection is not secure/)
  assert.match(bypassMenu.certRow, /Certificate is not valid/)
  await windowShot('certificates-site-menu-bypassed.png')
  const bypassViewer = await openViewer()
  assert.match(bypassViewer.verdict, /is-invalid/)
  assert.match(bypassViewer.text, /chose to proceed/)
  await windowShot('certificates-viewer-bypassed.png')
  await closeSiteMenu()
  // The exception holds for the session: a reload doesn't bring the interstitial back.
  await evaluate(toolbar, 'window.api.browser.reload()')
  await delay(300)
  await waitFor(async () => { const current = await state(); return !current.loading && current.error === null && current.security?.level === 'bypassed' }, 'the bypassed page after reload')
  // ...but only in this session partition: a private tab asks again.
  smoke.step('private tab keeps its own exceptions')
  await evaluate(toolbar, `window.api.browser.tabs.createPrivate(${JSON.stringify(selfSignedUrl)})`)
  const privateState = await waitFor(async () => { const current = await state(); return current.private && current.loadError?.name === 'ERR_CERT_AUTHORITY_INVALID' ? current : null }, 'the certificate error again in a private tab')
  // A new tab's first load reports through loadURL's rejection too; it must still be the full-page error.
  assert.equal(privateState.loadError.fullPage, true, 'a new tab gets the full-page error, not a blank page + toast')
  await waitFor(interstitial, 'the interstitial in the private tab')
  const tabs = await evaluate(toolbar, 'window.api.browser.tabs.get()')
  await evaluate(toolbar, `window.api.browser.tabs.close(${JSON.stringify(tabs.find((tab) => tab.active).id)})`)
  await waitFor(async () => !(await state()).private, 'back to the normal tab')

  // --- 3. Local network skips the proxy; proxy failures get the full-page error with Route Direct
  smoke.step('local-network proxy bypass')
  const browserSession = session.fromPartition('persist:surffish-browser')
  const saved = await evaluate(toolbar, `window.api.browser.proxy.set({ enabled: true, host: '127.0.0.1', port: ${deadPort}, bypassLocalNetwork: true })`)
  assert.equal(saved.bypassLocalNetwork, true)
  for (const url of ['https://192.168.1.1/', 'http://10.0.0.5:8080/', 'https://172.20.1.1/', 'https://unifi.local/', 'http://[fd00::1]/', 'http://nas/']) {
    assert.equal(await browserSession.resolveProxy(url), 'DIRECT', `${url} goes direct (fixed servers)`)
  }
  assert.match(await browserSession.resolveProxy('https://example.com/'), /^SOCKS5 127\.0\.0\.1:\d+$/, 'public sites still use the proxy')
  // With a rule in force the PAC script does the same (and the rule itself still wins).
  await evaluate(toolbar, `window.api.browser.proxy.routing.set({ proxies: [], rules: [{ pattern: '192.168.1.50', route: 'proxy' }, { pattern: '*.direct.surffish.test', route: 'direct' }] })`)
  assert.equal(await browserSession.resolveProxy('https://192.168.1.1/'), 'DIRECT', '192.168.1.1 goes direct (PAC)')
  assert.equal(await browserSession.resolveProxy('https://unifi.local/'), 'DIRECT')
  assert.match(await browserSession.resolveProxy('https://192.168.1.50/'), /^SOCKS5 /, 'an explicit proxy rule for a LAN address wins')
  assert.match(await browserSession.resolveProxy('https://example.com/'), /^SOCKS5 /)
  await evaluate(toolbar, `window.api.browser.proxy.routing.set({ proxies: [], rules: [] })`)
  // Turned off: LAN addresses go through the tunnel too.
  await evaluate(toolbar, `window.api.browser.proxy.set({ enabled: true, host: '127.0.0.1', port: ${deadPort}, bypassLocalNetwork: false })`)
  assert.match(await browserSession.resolveProxy('https://192.168.1.1/'), /^SOCKS5 /, 'setting off: 192.168.1.1 uses the proxy')
  await evaluate(toolbar, `window.api.browser.proxy.set({ enabled: true, host: '127.0.0.1', port: ${deadPort}, bypassLocalNetwork: true })`)

  smoke.step('proxy error page')
  const proxiedUrl = `http://proxied.surffish.test:${httpServer.address().port}/via-proxy`
  const proxyFail = await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(proxiedUrl)})`)
  assert.equal(proxyFail.ok, false)
  const proxyState = await waitFor(async () => { const current = await state(); return current.loadError && !current.loading ? current : null }, 'the proxy load error')
  assert.equal(proxyState.loadError.viaProxy, true)
  assert.equal(proxyState.loadError.fullPage, true, 'proxy failures use the same full-page error (no white page + toast)')
  const proxyPage = await waitFor(() => evaluate(content, `(() => { const el = document.querySelector('.tab-interstitial.is-load-error.is-proxy'); return el ? el.textContent : null })()`), 'the full-page proxy error')
  assert.match(proxyPage, /Can’t reach the proxy/)
  assert.match(proxyPage, /Route Direct/)
  assert.match(await evaluate(content, '[...document.querySelectorAll(".tab-interstitial.is-proxy button")].find((button) => button.textContent === "Route Direct").title'), /proxied\.surffish\.test/)
  assert.equal(await evaluate(toolbar, 'Boolean(document.querySelector("#browser-notice"))'), false, 'no toast on top of the proxy error page')
  await windowShot('certificates-proxy-error.png')
  await evaluate(content, '[...document.querySelectorAll(".tab-interstitial.is-proxy button")].find((button) => button.textContent.startsWith("Route ")).click()')
  await waitFor(async () => { const current = await state(); return current.url === proxiedUrl && !current.loading && current.error === null }, 'Route Direct to load the page without the proxy')
  const routing = await evaluate(toolbar, 'window.api.browser.proxy.routing.get()')
  assert.ok(routing.rules.some((rule) => rule.route === 'direct' && /surffish\.test$/.test(rule.pattern)), 'a Direct rule was added for the site')
  await evaluate(toolbar, `window.api.browser.proxy.routing.set({ proxies: [], rules: [] })`)
  await evaluate(toolbar, `window.api.browser.proxy.set({ enabled: false, host: '127.0.0.1', port: 1080, bypassLocalNetwork: true })`)

  console.log('Certificates smoke passed.')
}

run().then(() => {
  trustedServer.close()
  selfSignedServer.close()
  httpServer.close()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  trustedServer.close()
  selfSignedServer.close()
  httpServer.close()
  app.exit(1)
})
