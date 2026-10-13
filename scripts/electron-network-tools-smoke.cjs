// Integration smoke for per-site proxy routing and the Network inspector tools. Runs the production
// build: `bun run build && bun run test:electron-network-tools`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-network-tools-smoke.cjs`).
// Two tiny SOCKS5 servers stand in for the main and a named proxy; they log which host each
// CONNECT asked for and hand every connection to the local fixture server.
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createServer: createTcpServer, connect } = require('node:net')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, dialog } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-network-tools-smoke-${process.pid}`)
const server = createServer((request, response) => {
  if (request.url.startsWith('/api/')) {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify({ real: true, host: request.headers.host }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>Fixture ${request.headers.host}</title><p>${request.headers.host}</p>`)
})

/** Minimal SOCKS5 (no auth, CONNECT) that routes every destination to the fixture server. */
function socksServer(log) {
  return createTcpServer((socket) => {
    let stage = 0
    let buffer = Buffer.alloc(0)
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (stage === 0 && buffer.length >= 2 && buffer.length >= 2 + buffer[1]) {
        buffer = buffer.subarray(2 + buffer[1])
        socket.write(Buffer.from([5, 0]))
        stage = 1
      }
      if (stage === 1 && buffer.length >= 5) {
        const type = buffer[3]
        let host
        let end
        if (type === 3) {
          end = 5 + buffer[4] + 2
          if (buffer.length < end) return
          host = buffer.subarray(5, 5 + buffer[4]).toString()
        } else if (type === 1) {
          end = 10
          if (buffer.length < end) return
          host = [...buffer.subarray(4, 8)].join('.')
        } else {
          socket.destroy()
          return
        }
        log.push(host)
        stage = 2
        socket.off('data', onData)
        const upstream = connect(server.address().port, '127.0.0.1', () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          const rest = buffer.subarray(end)
          if (rest.length) upstream.write(rest)
          socket.pipe(upstream).pipe(socket)
        })
        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
      }
    }
    socket.on('data', onData)
    socket.on('error', () => {})
  })
}

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
async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 160)}: ${error.message}`)
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
const listen = (target, port) => new Promise((resolvePromise) => target.listen(port, '127.0.0.1', resolvePromise))

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', { loadNetworkFilters: true, loadCosmeticFilters: false })
  writeFileSync(join(userData, 'adblock-engine.bin'), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await listen(server, 0)
  const mainLog = []
  const workLog = []
  const mainPort = await freePort()
  const workPort = await freePort()
  const deadPort = await freePort()
  await listen(socksServer(mainLog), mainPort)
  await listen(socksServer(workLog), workPort)

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const api = (expression) => evaluate(toolbar, `window.api.browser.${expression}`)
  const activePage = () => views().find((view) => /^https?:/.test(view.webContents.getURL()) && view.getBounds().width > 0) ?? views().find((view) => /^https?:/.test(view.webContents.getURL()))

  // --- per-site routing
  await api(`proxy.set({ enabled: true, host: "127.0.0.1", port: ${mainPort} })`)
  const routing = await api(`proxy.routing.set(${JSON.stringify({
    proxies: [{ name: 'Work', host: '127.0.0.1', port: workPort }, { name: 'Dead', host: '127.0.0.1', port: deadPort }],
    rules: [{ pattern: '*.work.test', route: 'proxy:Work' }, { pattern: 'direct.test', route: 'direct' }, { pattern: '*.dead.test', route: 'proxy:Dead' }]
  })})`)
  assert.equal(routing.error, null, 'rules pass the resolveProxy self-check')
  assert.equal(routing.rules.length, 3)
  const session = require('electron').session.fromPartition('persist:surffish-browser')
  assert.equal(await session.resolveProxy('http://git.work.test/'), `SOCKS5 127.0.0.1:${workPort}`)
  assert.equal(await session.resolveProxy('http://other.test/'), `SOCKS5 127.0.0.1:${mainPort}`)
  assert.equal(await session.resolveProxy('http://direct.test/'), 'DIRECT')
  assert.equal(await session.resolveProxy('http://a.dead.test/'), `SOCKS5 127.0.0.1:${deadPort}`, 'a dead proxy still has no DIRECT fallback')

  const fixturePort = server.address().port
  const navigate = async (url) => {
    await api(`navigate(${JSON.stringify(url)})`)
    // A failed main-frame load shows Surffish's in-page error, which takes the page view off screen.
    const failedHere = async () => (await api('state()')).loadError?.url.startsWith(url.replace(/\/$/, ''))
    await waitFor(async () => activePage()?.webContents.getURL().startsWith(url.replace(/\/$/, '')) || activePage()?.webContents.getURL().startsWith('chrome-error') || await failedHere(), `navigation to ${url}`)
    await waitFor(async () => await failedHere() || !activePage().webContents.isLoading(), `${url} to finish loading`)
    await delay(200)
  }
  await navigate(`http://site.work.test:${fixturePort}/`)
  assert.equal(activePage().webContents.getTitle(), `Fixture site.work.test:${fixturePort}`, '*.work.test loads through the Work proxy')
  assert.ok(workLog.includes('site.work.test') && !mainLog.includes('site.work.test'), 'and only the Work proxy saw it')
  await navigate(`http://other.test:${fixturePort}/`)
  assert.equal(activePage().webContents.getTitle(), `Fixture other.test:${fixturePort}`, 'other sites use the main proxy')
  assert.ok(mainLog.includes('other.test'))

  const routeFor = await api(`proxy.routeFor("http://a.dead.test/")`)
  assert.deepEqual([routeFor.kind, routeFor.name], ['proxy', 'Dead'])
  const site = await api(`proxy.siteRoute.get("http://site.work.test/")`)
  assert.equal(site.pattern, '*.work.test')
  assert.equal(site.choice, 'proxy:Work')
  const flipped = await api(`proxy.siteRoute.set("http://site.work.test/", "direct")`)
  assert.equal(flipped.effective.kind, 'direct', 'the quick toggle sets a Direct rule')
  assert.equal(await session.resolveProxy('http://site.work.test/'), 'DIRECT')
  const restored = await api(`proxy.siteRoute.set("http://site.work.test/", "default")`)
  assert.equal(restored.choice, 'default')
  assert.equal(await session.resolveProxy('http://site.work.test/'), `SOCKS5 127.0.0.1:${mainPort}`, 'Default removes the rule')
  await api(`proxy.siteRoute.set("http://site.work.test/", "proxy:Work")`)

  // Proxied route with its proxy down: request fails, never goes direct.
  workLog.length = 0
  mainLog.length = 0
  await navigate(`http://x.dead.test:${fixturePort}/`)
  const deadState = await api('state()')
  assert.notEqual(deadState.title, `Fixture x.dead.test:${fixturePort}`, 'a dead proxy does not fall back to DIRECT')
  assert.equal(deadState.loadError?.viaProxy, true, 'the load error knows this site is routed through a proxy')

  // Kill switch: only the dead proxy's routes are blocked.
  await api('safety.proxyGuard.set(true)')
  const guard = await waitFor(async () => {
    const status = await api('safety.proxyGuard.get()')
    return status.blocking && status.endpoints.length === 3 ? status : null
  }, 'the kill switch to mark the Dead proxy down')
  assert.equal(guard.endpoint, `127.0.0.1:${deadPort}`)
  assert.deepEqual(guard.endpoints.filter((endpoint) => endpoint.state === 'up').map((endpoint) => endpoint.name).sort(), [null, 'Work'].sort())
  await navigate(`http://other.test:${fixturePort}/`)
  assert.equal(activePage().webContents.getTitle(), `Fixture other.test:${fixturePort}`, 'main-proxy sites keep working while another proxy is down')
  await api('safety.proxyGuard.set(false)')

  // WebRTC policy stays strict while any proxy is in use.
  assert.equal(activePage().webContents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp')
  await api(`proxy.set({ enabled: false, host: "127.0.0.1", port: ${mainPort} })`)
  assert.equal(activePage().webContents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp', 'proxied rules keep WebRTC locked down with the main proxy off')
  assert.equal(await session.resolveProxy('http://other.test/'), 'DIRECT')
  assert.equal(await session.resolveProxy('http://git.work.test/'), `SOCKS5 127.0.0.1:${workPort}`)
  await api('proxy.routing.set({ proxies: [], rules: [] })')
  assert.equal(activePage().webContents.getWebRTCIPHandlingPolicy(), 'default', 'no proxy at all relaxes WebRTC')

  // --- network tools (direct now; loopback fixture)
  // Set from another surface so the toolbar hears the storage event.
  await evaluate(surface('content'), 'localStorage.setItem("surffish.devtools.networkInspectorEnabled", "true")')
  await api('network.watch(true)')
  const fixture = `http://127.0.0.1:${fixturePort}/page`
  await navigate(fixture)
  const page = activePage()
  await evaluate(page, 'fetch("/api/data?x=1", { method: "POST", headers: { "Content-Type": "application/json", "X-Smoke": "it\'s" }, body: JSON.stringify({ a: 1 }) }).then((r) => r.text())')
  const rows = await waitFor(async () => {
    const requests = await api('network.get()')
    return requests.some((request) => request.url.includes('/api/data') && request.state === 'complete') ? requests : null
  }, 'the API request to be captured')
  const apiRow = rows.find((request) => request.url.includes('/api/data'))
  const curl = await api(`network.copyAs(${JSON.stringify(apiRow.id)}, "curl")`)
  assert.match(curl.text, /^curl 'http:\/\/127\.0\.0\.1:\d+\/api\/data\?x=1'/)
  assert.ok(curl.text.includes(`-H 'X-Smoke: it'\\''s'`), 'header quotes are escaped')
  assert.ok(curl.text.includes(`--data-raw '{"a":1}'`))
  const fetchSnippet = await api(`network.copyAs(${JSON.stringify(apiRow.id)}, "fetch")`)
  assert.ok(fetchSnippet.text.startsWith('fetch("http://127.0.0.1:'))
  const replay = await api(`network.replay(${JSON.stringify(apiRow.id)})`)
  assert.equal(replay.error, null)
  assert.equal(replay.status, 200)
  assert.ok(replay.sizeBytes > 0)

  // HAR export (the save dialog is stubbed).
  const harPath = join(userData, 'export.har')
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: harPath })
  const exported = await api('network.exportHar({ tabId: null, includeBodies: true })')
  assert.equal(exported.saved, true)
  const har = JSON.parse(readFileSync(harPath, 'utf8'))
  assert.equal(har.log.version, '1.2')
  const harEntry = har.log.entries.find((entry) => entry.request.url.includes('/api/data'))
  assert.equal(harEntry.request.method, 'POST')
  assert.equal(harEntry.request.postData.text, '{"a":1}')
  assert.ok(harEntry.response.content.text.includes('"real":true'))

  // Overrides via CDP Fetch on the inspector's own attachment.
  const overridden = await api(`network.overrides.set(${JSON.stringify([
    { id: 'mock1', enabled: true, urlPattern: '/api/data', method: 'GET', action: 'respond', status: 418, headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"mocked":true}' },
    { id: 'block1', enabled: true, urlPattern: '/api/blocked*', method: '*', action: 'block', status: 0, headers: [], body: '' }
  ])})`)
  assert.equal(overridden.active, true)
  assert.equal(page.webContents.debugger.isAttached(), true)
  const mocked = await evaluate(page, 'fetch("/api/data").then(async (r) => r.status + " " + await r.text())')
  assert.equal(mocked, '418 {"mocked":true}')
  const notMocked = await evaluate(page, 'fetch("/api/data", { method: "POST", body: "x" }).then((r) => r.status)')
  assert.equal(notMocked, 200, 'method has to match')
  const blocked = await evaluate(page, 'fetch("/api/blocked/1").then(() => "ok", () => "blocked")')
  assert.equal(blocked, 'blocked')
  await waitFor(() => evaluate(toolbar, 'document.querySelector(".network-overrides-badge")?.textContent.includes("Overrides active")'), 'the Overrides active badge in the toolbar')
  const state = await waitFor(async () => {
    const next = await api('network.overrides.get()')
    return next.hits.mock1 >= 1 && next.hits.block1 >= 1 ? next : null
  }, 'override hit counts')
  assert.ok(state.active)
  await api('network.overrides.set([])')
  assert.equal(await evaluate(page, 'fetch("/api/data").then((r) => r.status)'), 200, 'removing the rules stops interception')
  await waitFor(async () => !(await evaluate(toolbar, 'Boolean(document.querySelector(".network-overrides-badge"))')), 'the badge to go away')
  await api('network.disable()')
  assert.equal(page.webContents.debugger.isAttached(), false, 'switching the inspector off detaches CDP')
  assert.equal((await api('network.overrides.get()')).active, false)

  console.log('Network tools smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error(error)
  app.exit(1)
})
