const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createHash, X509Certificate } = require('node:crypto')
const { createServer: createHttpServer } = require('node:http')
const { createServer: createTlsServer } = require('node:https')
const { createServer: createSocksServer, connect } = require('node:net')
const { execFileSync } = require('node:child_process')
const { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, session } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const root = resolve(__dirname, '..')
const userData = join(tmpdir(), `surffish-security-smoke-${process.pid}`)
const servers = []
const openSockets = new Set()
const requests = []
const socksRequests = []
let mainWindow = null
let views = {}
let profileCleaned = false

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function waitFor(predicate, description, timeout = Number(process.env.SMOKE_WAIT_MS || 30000)) {
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

function seedProfile(legacySessionUrl) {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-security-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`, { mode: 0o600 })
  writeFileSync(join(userData, 'browser-session.json'), `${JSON.stringify({ version: 1, tabs: [legacySessionUrl], activeIndex: 0, pinnedTabs: [] })}\n`, { mode: 0o644 })
}

async function listen(server) {
  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.once('close', () => openSockets.delete(socket))
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  servers.push(server)
  return server.address().port
}

async function closeServer(server) {
  if (!server?.listening) return
  await new Promise((resolveClose) => server.close(() => resolveClose()))
}

function makeReleaseFixture() {
  const archive = Buffer.from('synthetic invalid Bramble archive used only to exercise proxy transport')
  const archiveDigest = createHash('sha256').update(archive).digest('hex')
  const zipName = 'bramble_firefox_1.28.0.zip'
  const checksums = Buffer.from(`${archiveDigest}  ${zipName}\n`)
  const checksumsDigest = createHash('sha256').update(checksums).digest('hex')
  const base = 'https://github.com/flythenimbus/bramble/releases/download/1.28.0-firefox'
  const release = {
    tag_name: '1.28.0-firefox',
    draft: false,
    prerelease: false,
    assets: [
      { name: zipName, size: archive.length, digest: `sha256:${archiveDigest}`, browser_download_url: `${base}/${zipName}` },
      { name: 'SHA256SUMS', size: checksums.length, digest: `sha256:${checksumsDigest}`, browser_download_url: `${base}/SHA256SUMS` }
    ]
  }
  return { archive, checksums, release }
}

function startTlsReleaseFixture(profile) {
  const keyPath = join(profile, 'test-proxy-key.pem')
  const certPath = join(profile, 'test-proxy-cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=localhost'
  ], { stdio: 'ignore' })
  chmodSync(keyPath, 0o600)
  const key = readFileSync(keyPath)
  const cert = readFileSync(certPath)
  // Trust this one test certificate in Chromium itself. setCertificateVerifyProc alone is racy: when the
  // app fetches two assets from one host in parallel, Chromium coalesces the two verifications and the
  // joined request sometimes gets the raw ERR_CERT_AUTHORITY_INVALID instead of the proc's answer.
  // (Chromium only honours the SPKI list when --user-data-dir is set too; this runs before app ready.)
  const spki = createHash('sha256').update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  app.commandLine.appendSwitch('user-data-dir', profile)
  app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', spki)
  const fixture = makeReleaseFixture()
  const server = createTlsServer({ key, cert }, (request, response) => {
    requests.push({ host: request.headers.host, path: request.url })
    const json = Buffer.from(JSON.stringify([fixture.release]))
    if (request.url === '/repos/flythenimbus/bramble/releases?per_page=100') {
      response.writeHead(200, { 'content-type': 'application/vnd.github+json', 'content-length': json.length, 'cache-control': 'no-store' })
      response.end(json)
      return
    }
    if (request.url === '/flythenimbus/bramble/releases/download/1.28.0-firefox/bramble_firefox_1.28.0.zip') {
      if (String(request.headers.host).split(':')[0].toLowerCase() === 'github.com') {
        response.writeHead(302, { location: `https://release-assets.githubusercontent.com${request.url}`, 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': fixture.archive.length, 'cache-control': 'no-store' })
      response.end(fixture.archive)
      return
    }
    if (request.url === '/flythenimbus/bramble/releases/download/1.28.0-firefox/SHA256SUMS') {
      if (String(request.headers.host).split(':')[0].toLowerCase() === 'github.com') {
        response.writeHead(302, { location: `https://release-assets.githubusercontent.com${request.url}`, 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': fixture.checksums.length, 'cache-control': 'no-store' })
      response.end(fixture.checksums)
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  return { server, fixture }
}

function startSocksForwarder(targetPort) {
  const server = createSocksServer((client) => {
    openSockets.add(client)
    client.once('close', () => openSockets.delete(client))
    let stage = 'greeting'
    let pending = Buffer.alloc(0)
    let upstream = null
    client.on('error', () => upstream?.destroy())
    client.on('close', () => upstream?.destroy())
    client.on('data', (chunk) => {
      if (stage === 'connected') return
      pending = Buffer.concat([pending, chunk])
      if (stage === 'greeting') {
        if (pending.length < 2) return
        const methodsLength = pending[1]
        if (pending.length < 2 + methodsLength) return
        const methods = pending.subarray(2, 2 + methodsLength)
        if (!methods.includes(0)) {
          client.end(Buffer.from([5, 0xff]))
          return
        }
        client.write(Buffer.from([5, 0]))
        pending = pending.subarray(2 + methodsLength)
        stage = 'request'
      }
      if (stage !== 'request' || pending.length < 5) return
      const addressType = pending[3]
      let host
      let portOffset
      if (addressType === 1) {
        if (pending.length < 10) return
        host = [...pending.subarray(4, 8)].join('.')
        portOffset = 8
      } else if (addressType === 3) {
        const nameLength = pending[4]
        if (pending.length < 5 + nameLength + 2) return
        host = pending.subarray(5, 5 + nameLength).toString('utf8')
        portOffset = 5 + nameLength
      } else if (addressType === 4) {
        if (pending.length < 22) return
        host = pending.subarray(4, 20).toString('hex')
        portOffset = 20
      } else {
        client.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      if (pending[1] !== 1) {
        client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]))
        return
      }
      const port = pending.readUInt16BE(portOffset)
      const remaining = pending.subarray(portOffset + 2)
      socksRequests.push({ host, port })
      stage = 'connecting'
      upstream = connect({ host: '127.0.0.1', port: targetPort })
      openSockets.add(upstream)
      upstream.once('close', () => openSockets.delete(upstream))
      upstream.once('connect', () => {
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        if (remaining.length) upstream.write(remaining)
        stage = 'connected'
        client.pipe(upstream)
        upstream.pipe(client)
      })
      upstream.on('error', () => client.destroy())
    })
  })
  return server
}

function surfaceFor(view) {
  if (!view?.webContents || view.webContents.isDestroyed()) return null
  try {
    return new URL(view.webContents.getURL()).searchParams.get('surface')
  } catch {
    return null
  }
}

async function evaluate(view, expression) {
  assert.ok(view?.webContents && !view.webContents.isDestroyed(), 'the renderer surface must be alive')
  return view.webContents.executeJavaScript(expression)
}

async function run() {
  if (!existsSync(join(root, 'out/main/index.js'))) throw new Error('Missing out/main/index.js; run `bun run build` first.')
  app.setPath('userData', userData)

  const fixtureSite = createHttpServer((request, response) => {
    requests.push({ host: request.headers.host, path: request.url, type: 'site' })
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/page', 'cache-control': 'no-store' })
      response.end()
      return
    }
    if (request.url === '/frame') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><script>parent.postMessage({kind:"security-frame",apiType:typeof window.api},"*")</script>')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Surffish security fixture</title><h1>Local test page</h1>')
  })
  const fixturePort = await listen(fixtureSite)
  const fixtureUrl = `http://127.0.0.1:${fixturePort}`
  const legacySessionUrl = `${fixtureUrl}/page?q=prelaunch+restore&filter=recent&code=LEGACY-OAUTH-CODE&refresh_token=LEGACY-REFRESH-TOKEN#LEGACY-FRAGMENT`
  seedProfile(legacySessionUrl)

  const { server: tlsFixture, fixture: releaseFixture } = startTlsReleaseFixture(userData)
  const tlsPort = await listen(tlsFixture)
  const socksProxy = startSocksForwarder(tlsPort)
  const socksPort = await listen(socksProxy)

  await import(pathToFileURL(join(root, 'out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => {
    const candidate = BaseWindow.getAllWindows().find((window) => !window.isDestroyed() && window.isVisible())
    return candidate || null
  }, 'the production Surffish window', 45000)
  mainWindow.setBounds({ x: 0, y: 0, width: 920, height: 680 })
  views = await waitFor(() => {
    const found = Object.fromEntries(mainWindow.contentView.children
      .filter((view) => view.webContents && !view.webContents.isDestroyed())
      .map((view) => [surfaceFor(view), view]).filter(([surface]) => surface))
    return found.content && found.toolbar && found.sidebar ? found : null
  }, 'all trusted Surffish renderer surfaces', 45000)

  await waitFor(async () => evaluate(views.toolbar, `(() => {
    const button = document.querySelector('.bramble-toolbar-button')
    return button?.getAttribute('aria-label') === 'Install Bramble' && !button.hasAttribute('aria-haspopup')
  })()`), 'the Bramble install action in the toolbar')
  const toolbarSiteControls = await evaluate(views.toolbar, `(() => {
    const omnibox = document.querySelector('.omnibox')
    const siteActions = omnibox?.querySelector('.site-actions-control')
    const address = omnibox?.querySelector('input')
    const favorite = omnibox?.querySelector('.omnibox-favorite-button')
    return {
      siteActionsBeforeAddress: Boolean(siteActions && address && (siteActions.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING)),
      favoriteAfterAddress: Boolean(address && favorite && (address.compareDocumentPosition(favorite) & Node.DOCUMENT_POSITION_FOLLOWING))
    }
  })()`)
  assert.equal(toolbarSiteControls.siteActionsBeforeAddress, true, 'site actions sit to the left of the address input')
  assert.equal(toolbarSiteControls.favoriteAfterAddress, true, 'the bookmark star sits at the address bar trailing edge')
  await evaluate(views.toolbar, `document.querySelector('.site-actions-button').click()`)
  const siteActionsMenu = await waitFor(async () => evaluate(views.toolbar, `document.querySelector('#site-actions-menu')?.innerText || null`), 'the site-actions menu')
  assert.match(siteActionsMenu, /All site settings/)
  assert.match(siteActionsMenu, /Picture in Picture/)
  await evaluate(views.toolbar, `Array.from(document.querySelectorAll('#site-actions-menu [role="menuitem"]')).find((item) => item.textContent?.includes('All site settings'))?.click()`)
  const settingsSection = async (contents = views.toolbar) => (await evaluate(contents, 'window.api.browser.state()')).settings?.section ?? null
  await waitFor(async () => (await settingsSection()) === 'site', 'the All site settings menu action (Settings tab on Sites)')
  // Settings is a tab now: the gear focuses it (never closes it), and it closes like any tab.
  const gear = `document.querySelector('.sidebar-footer-icon-button[aria-label="Settings"]')`
  await waitFor(() => evaluate(views.content, `${gear}?.getAttribute('aria-current') === 'page'`), 'the Settings gear to show the Settings tab as current')
  await evaluate(views.content, `${gear}.click()`)
  await delay(200)
  assert.equal(await settingsSection(), 'site', 'the gear on the Settings tab keeps it open')
  const settingsTabId = (await evaluate(views.toolbar, 'window.api.browser.tabs.get()')).find((tab) => tab.url === 'surffish://settings')?.id
  assert.ok(settingsTabId, 'one Settings tab')
  await evaluate(views.toolbar, `window.api.browser.tabs.close(${JSON.stringify(settingsTabId)})`)
  await waitFor(async () => (await settingsSection()) === null, 'closing the Settings tab returning to the page')
  // The sidebar renderer gets the closed-tab state a beat after main (slow on macOS CI): until then its
  // gear still points at the closed tab's section (Sites), so wait for it to stop showing Settings as current.
  await waitFor(() => evaluate(views.sidebar, `Boolean(${gear}) && ${gear}.getAttribute('aria-current') !== 'page'`), 'the sidebar Settings gear (Settings tab closed)')
  await evaluate(views.sidebar, `${gear}.click()`)
  await waitFor(async () => (await settingsSection()) === 'settings', 'the Settings gear action')
  const gearTitle = await evaluate(views.sidebar, `${gear}?.title || null`)
  assert.match(gearTitle || '', /^Settings/)
  await evaluate(views.toolbar, `window.api.browser.chrome.set({ sidebarMode: 'tabs', sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })`)
  const browserSession = session.fromPartition('persist:surffish-browser')
  const trustedReleaseHosts = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com'])
  browserSession.setCertificateVerifyProc((certificateRequest, callback) => {
    callback(trustedReleaseHosts.has(certificateRequest.hostname.toLowerCase()) ? 0 : -3)
  })
  const proxyResult = await evaluate(views.toolbar, `window.api.browser.proxy.set({ enabled: true, host: '127.0.0.1', port: ${socksPort} })`)
  assert.equal(proxyResult.enabled, true, 'the temporary SOCKS proxy is accepted by the browser setting')
  await evaluate(views.toolbar, `document.querySelector('.bramble-toolbar-button').click()`)
  const brambleState = await waitFor(async () => {
    const state = await evaluate(views.toolbar, 'window.api.browser.bramble.get()')
    return state.error?.match(/ZIP|archive|directory/i) ? state : null
  }, 'the toolbar Bramble install request to reject the deliberately invalid archive')
  assert.equal((await evaluate(views.toolbar, 'window.api.browser.state()')).settings?.section, 'integrations', 'the Bramble toolbar install action opens Integrations')
  assert.match(brambleState.error || '', /ZIP|archive|directory/i, 'the synthetic release is fetched and rejected before activation because its archive is deliberately invalid')

  const savedSessionPath = join(userData, 'browser-session.json')
  const migratedSession = await waitFor(() => {
    try {
      const parsed = JSON.parse(readFileSync(savedSessionPath, 'utf8'))
      return parsed.tabs?.some((url) => url.includes('prelaunch+restore')) ? parsed : null
    } catch {
      return null
    }
  }, 'the legacy session file to be rewritten at startup')
  const migratedUrl = migratedSession.tabs.find((url) => url.includes('prelaunch+restore'))
  assert.match(migratedUrl, /q=prelaunch\+restore/, 'startup migration preserves ordinary search queries')
  assert.match(migratedUrl, /filter=recent/, 'startup migration preserves ordinary filter queries')
  assert.doesNotMatch(migratedUrl, /LEGACY-OAUTH-CODE|LEGACY-REFRESH-TOKEN|LEGACY-FRAGMENT|[?&](code|refresh_token)=/i, 'startup migration removes existing credential-like URL data')
  if (process.platform !== 'win32') assert.equal(statSync(savedSessionPath).mode & 0o077, 0, 'startup migration tightens existing session file permissions')

  for (const [surface, view] of Object.entries(views)) {
    const expectedUrl = view.webContents.getURL()
    assert.equal(await evaluate(view, 'typeof window.api?.browser?.state'), 'function', `${surface} keeps its isolated preload bridge`)
    const state = await evaluate(view, 'window.api.browser.state()')
    assert.ok(state && typeof state.url === 'string', `${surface} can complete a privileged IPC round trip`)
    await evaluate(view, `window.location.assign(${JSON.stringify(`${fixtureUrl}/redirect`)})`)
    await delay(200)
    assert.equal(view.webContents.getURL(), expectedUrl, `${surface} rejects renderer navigation to an external page`)
    assert.equal(await evaluate(view, 'typeof window.api?.browser?.state'), 'function', `${surface} bridge stays only on the trusted document`)
    assert.ok(await evaluate(view, 'window.api.browser.state()'), `${surface} remains functional after the blocked navigation`)
  }
  assert.equal(requests.filter((request) => request.type === 'site' && request.path === '/redirect').length, 0, 'blocked renderer navigations never reach the redirect endpoint')

  const frameProbe = await evaluate(views.content, `(() => {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    const probe = new Promise((resolvePromise) => {
      frame.addEventListener('load', () => resolvePromise(typeof frame.contentWindow.api), { once: true });
      setTimeout(() => resolvePromise('timeout'), 3000);
    });
    frame.src = 'about:blank';
    document.body.appendChild(frame);
    return probe;
  })()`)
  assert.equal(frameProbe, 'undefined', 'untrusted subframes do not receive the shell preload bridge')

  const privateUrl = `${fixtureUrl}/page?q=regression+coverage&filter=recent&code=TEST-OAUTH-CODE&access_token=TEST-ACCESS-TOKEN#TEST-FRAGMENT`
  await evaluate(views.content, `window.api.browser.tabs.create(${JSON.stringify(privateUrl)})`)
  const savedSession = await waitFor(() => {
    if (!existsSync(savedSessionPath)) return null
    try {
      const parsed = JSON.parse(readFileSync(savedSessionPath, 'utf8'))
      return parsed.tabs?.some((url) => url.includes('regression+coverage')) ? parsed : null
    } catch {
      return null
    }
  }, 'the saved tab session to be written')
  const persistedTarget = savedSession.tabs.find((url) => url.includes('regression+coverage'))
  assert.ok(persistedTarget, 'ordinary tabs continue to persist')
  assert.match(persistedTarget, /q=regression\+coverage/, 'ordinary search queries remain restorable')
  assert.match(persistedTarget, /filter=recent/, 'ordinary filter queries remain restorable')
  assert.doesNotMatch(persistedTarget, /TEST-OAUTH-CODE|TEST-ACCESS-TOKEN|TEST-FRAGMENT|[?&](code|access_token)=/i, 'secret-like query values and URL fragments are absent from the session file')
  assert.equal(statSync(savedSessionPath).mode & 0o077, 0, 'saved session data is owner-only on POSIX')

  await evaluate(views.content, 'window.api.browser.chrome.set({ sidebarMode: "settings", sidebarPinned: true, sidebarHovered: false, sidebarFocused: false })')
  const settingsView = await waitFor(async () => {
    for (const view of Object.values(views)) {
      if (await evaluate(view, 'Boolean(document.querySelector(\'[aria-label="Clear saved session"]\'))').catch(() => false)) return view
    }
    return null
  }, 'the saved-session privacy control')
  // Settings sections (#56 and later): extensions live under "Integrations" (Extensions | Feeds tabs,
  // opening on Extensions) and New Tab got its own section; site ad blocking lives under "This site".
  const subnavLabels = await evaluate(settingsView, `Array.from(document.querySelectorAll('.settings-subnav button')).map((button) => button.textContent.trim())`)
  assert.ok(subnavLabels.includes('Integrations') && subnavLabels.includes('New Tab') && !subnavLabels.includes('Feeds'), `Settings exposes separate Integrations and New Tab sections (${subnavLabels.join(', ')})`)
  await evaluate(settingsView, `Array.from(document.querySelectorAll('.settings-subnav button')).find((button) => button.textContent.trim() === 'Integrations')?.click()`)
  await waitFor(() => evaluate(settingsView, `document.querySelector('.settings-page-heading-copy h1')?.textContent === 'Integrations'`), 'the Integrations page heading')
  const extensionsControls = await evaluate(settingsView, `({
    bramble: Boolean(document.querySelector('.bramble-settings-section')),
    generalOnly: Boolean(document.querySelector('[aria-label="Clear saved session"]')),
    tab: document.querySelector('.integrations-tabs [aria-selected="true"]')?.textContent.trim() ?? null,
    feedsMounted: Boolean(document.querySelector('.feed-items-group'))
  })`)
  assert.deepEqual(extensionsControls, { bramble: true, generalOnly: false, tab: 'Extensions', feedsMounted: false }, 'Integrations opens on Extensions (Bramble), apart from General, without mounting Feeds')
  await evaluate(settingsView, `Array.from(document.querySelectorAll('.settings-subnav button')).find((button) => button.textContent.trim() === 'New Tab')?.click()`)
  await waitFor(() => evaluate(settingsView, `Boolean(document.querySelector('[aria-label="Default new tab page"]') && document.querySelector('[aria-label="Show local clock"]'))`), 'the New Tab settings page')
  await evaluate(settingsView, `Array.from(document.querySelectorAll('.settings-subnav button')).find((button) => button.textContent.trim() === 'General')?.click()`)
  await waitFor(() => evaluate(settingsView, `Boolean(document.querySelector('[aria-label="Clear saved session"]'))`), 'the General settings page')
  const disclosure = await evaluate(settingsView, `document.querySelector('[aria-label="Clear saved session"]')?.closest('.settings-row')?.innerText || ''`)
  assert.match(disclosure, /restore on next launch/i, 'Settings disclose that tabs are saved for the next launch')
  assert.match(disclosure, /credential-like URL parts are stripped/i, 'Settings explain that credential-like URL data is stripped')
  await evaluate(settingsView, `window.confirm = () => true; document.querySelector('[aria-label="Clear saved session"]').click()`)
  await waitFor(() => {
    try { return JSON.parse(readFileSync(savedSessionPath, 'utf8')).tabs?.length === 0 } catch { return false }
  }, 'the clear-saved-session button to empty the restore list')
  const liveTabsAfterClear = await evaluate(settingsView, 'window.api.browser.tabs.get()')
  assert.ok(liveTabsAfterClear.length >= 2, 'clearing saved tabs does not close live tabs')
  await evaluate(settingsView, `window.api.browser.tabs.create(${JSON.stringify(`${fixtureUrl}/page?q=still-live`)})`)
  await delay(250)
  assert.equal(JSON.parse(readFileSync(savedSessionPath, 'utf8')).tabs.length, 0, 'cleared URLs are not silently written back during the same run')
  assert.equal(statSync(savedSessionPath).mode & 0o077, 0, 'cleared session file remains owner-only on POSIX')

  assert.ok(socksRequests.some(({ host, port }) => host === 'api.github.com' && port === 443), 'Bramble release metadata uses the configured SOCKS proxy')
  assert.ok(socksRequests.some(({ host, port }) => host === 'github.com' && port === 443), 'Bramble release assets use the configured SOCKS proxy')
  assert.ok(socksRequests.some(({ host, port }) => host === 'release-assets.githubusercontent.com' && port === 443), 'redirected Bramble release assets use the configured SOCKS proxy')
  assert.ok(requests.some(({ path }) => path === '/repos/flythenimbus/bramble/releases?per_page=100'), 'the synthetic release API received the metadata request')
  assert.ok(requests.some(({ path }) => path?.endsWith('/bramble_firefox_1.28.0.zip')), 'the synthetic release API received the archive request')
  assert.ok(requests.some(({ path }) => path?.endsWith('/SHA256SUMS')), 'the synthetic release API received the checksums request')
  assert.ok(requests.some(({ host, path }) => String(host).startsWith('release-assets.githubusercontent.com') && path?.endsWith('/bramble_firefox_1.28.0.zip')), 'the archive was fetched from GitHub’s redirected asset host')
  assert.ok(requests.some(({ host, path }) => String(host).startsWith('release-assets.githubusercontent.com') && path?.endsWith('/SHA256SUMS')), 'the checksums were fetched from GitHub’s redirected asset host')

  await browserSession.setProxy({ mode: 'direct' })
  console.log('[security-smoke] trusted renderer navigation, IPC, subframe isolation, session privacy/clear, and Bramble SOCKS transport passed')
}

async function cleanup() {
  for (const socket of openSockets) socket.destroy()
  openSockets.clear()
  for (const server of servers) server.closeAllConnections?.()
  await Promise.all(servers.map((server) => closeServer(server).catch(() => undefined)))
  // app.quit() ends the process with code 0, so a failed run must exit with its code instead.
  if (app.isReady() && !process.exitCode) {
    app.quit()
    await delay(250)
  }
  if (!profileCleaned) {
    profileCleaned = true
    try { rmSync(userData, { recursive: true, force: true }) } catch { /* best-effort disposable-profile cleanup */ }
  }
  if (app.isReady()) app.exit(process.exitCode ?? 0)
}

run().catch((error) => {
  console.error('[security-smoke] failed:', error?.stack || error)
  process.exitCode = 1
}).finally(() => cleanup())
