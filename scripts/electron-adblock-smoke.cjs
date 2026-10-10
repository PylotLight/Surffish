const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createServer } = require('node:http')
const { app, BrowserWindow, session } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const NETWORK_ONLY_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: false,
  loadCSPFilters: false,
  enableHtmlFiltering: false,
  enableMutationObserver: false,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false
}

const requests = []
let server
let window
let browserSession

async function run() {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'sockfish-adblock-smoke-')))
  await app.whenReady()

  server = createServer((request, response) => {
    requests.push(request.url)
    if (request.url === '/page') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><script src="/blocked.js"></script><script src="/allowed.js"></script>')
      return
    }
    if (request.url === '/blocked.js' || request.url === '/allowed.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(request.url === '/blocked.js' ? 'window.blockedLoaded = true' : 'window.allowedLoaded = true')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const blocker = ElectronBlocker.parse(`http://127.0.0.1:${address.port}/blocked.js$script`, NETWORK_ONLY_CONFIG)
  browserSession = session.fromPartition('smoke-test')
  blocker.enableBlockingInSession(browserSession)

  window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      sandbox: true
    }
  })
  await window.loadURL(`http://127.0.0.1:${address.port}/page`)

  const deadline = Date.now() + 5000
  let pageState
  do {
    pageState = await window.webContents.executeJavaScript('({ allowed: window.allowedLoaded === true, blocked: window.blockedLoaded === true })')
    if (pageState.allowed) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.equal(pageState?.allowed, true, 'the non-matching script should reach Chromium and execute')
  assert.equal(pageState?.blocked, false, 'the matching script should not execute')
  assert.ok(requests.includes('/allowed.js'), 'the allowed request should reach the local HTTP server')
  assert.ok(!requests.includes('/blocked.js'), 'Ghostery should cancel the matching request before it reaches the server')

  blocker.disableBlockingInSession(browserSession)
  console.log('Electron + Ghostery request-blocking smoke test passed:', JSON.stringify({ requests }))
}

async function cleanup() {
  if (window && !window.isDestroyed()) window.destroy()
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  if (app.isReady()) app.quit()
}

run().then(cleanup).catch(async (error) => {
  console.error('Electron + Ghostery request-blocking smoke test failed:', error)
  process.exitCode = 1
  await cleanup()
})
