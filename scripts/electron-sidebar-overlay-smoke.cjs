const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `sockfish-sidebar-overlay-smoke-${process.pid}`)
const screenshotDirectory = process.env.SOCKFISH_SCREENSHOT_DIR
const fixtureTitle = 'Sockfish native view overlay fixture'
const NETWORK_ONLY_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: false,
  loadCSPFilters: false,
  enableHtmlFiltering: false,
  enableMutationObserver: false,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false
}
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>${fixtureTitle}</title><style>html,body{margin:0;width:100%;height:100%;font:28px system-ui;color:#fff;background:repeating-linear-gradient(135deg,#145b55 0 56px,#2f8e78 56px 112px)}h1{margin:0;padding:24px;background:#b21e35}main{height:78vh;display:grid;place-items:center}strong{font-size:40px;text-shadow:0 2px 6px #000}</style><h1>LIVE SYNTHETIC PAGE — FULL-WIDTH OVERLAY TEST</h1><main><strong>Native WebContentsView layer</strong></main>`)
})
let mainWindow
let fixtureUrl
let evaluationId = 0

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function waitFor(predicate, description, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(50)
  }
  throw new Error(`Timed out while waiting for ${description}.`)
}

async function evaluate(expression) {
  assert.ok(mainWindow && !mainWindow.isDestroyed(), 'the production Sockfish window must be available')
  const key = `__sockfishOverlaySmoke${++evaluationId}`
  const keyLiteral = JSON.stringify(key)
  await mainWindow.webContents.executeJavaScript(`(() => {
    window[${keyLiteral}] = { ready: false }
    Promise.resolve().then(() => (${expression})).then(
      (value) => { window[${keyLiteral}] = { ready: true, json: JSON.stringify(value) } },
      (error) => { window[${keyLiteral}] = { ready: true, error: String(error) } }
    )
    return true
  })()`)
  const resultText = await waitFor(
    () => mainWindow.webContents.executeJavaScript(`window[${keyLiteral}]?.ready ? JSON.stringify(window[${keyLiteral}]) : null`),
    'the renderer-side IPC result',
    12000
  )
  const result = JSON.parse(resultText)
  if (result.error) throw new Error(result.error)
  return result.json === undefined ? undefined : JSON.parse(result.json)
}

function getNativeViewState() {
  const children = mainWindow.contentView.children
  return children.map((view, index) => ({
    index,
    kind: view.constructor?.name ?? 'unknown',
    bounds: view.getBounds(),
    webContentsId: view.webContents?.id ?? null
  }))
}

function captureFullWindow(name) {
  if (!screenshotDirectory) return
  mkdirSync(screenshotDirectory, { recursive: true })
  const display = process.env.DISPLAY
  assert.ok(display, 'DISPLAY is required when SOCKFISH_SCREENSHOT_DIR is set')
  const size = process.env.SOCKFISH_SCREENSHOT_SIZE || '1280x800'
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-video_size', size,
    '-i', `${display}.0`, '-frames:v', '1', '-y', join(screenshotDirectory, basename(name))
  ])
}

function seedIsolatedProfile() {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||sockfish-smoke-never-match.invalid^', NETWORK_ONLY_CONFIG)
  writeFileSync(join(userData, 'adblock-engine.bin'), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`, { mode: 0o600 })
}

async function run() {
  app.setPath('userData', userData)
  seedIsolatedProfile()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  fixtureUrl = `http://127.0.0.1:${address.port}/fixture`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => {
    const candidate = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    return candidate && candidate.isVisible() && !candidate.webContents.isLoadingMainFrame() ? candidate : null
  }, 'the production Sockfish window', 45000)
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 800 })

  await waitFor(() => evaluate('Boolean(document.querySelector(".new-tab-page"))'), 'the renderer-owned New Tab page')
  assert.equal(mainWindow.contentView.children.length, 0, 'New Tab is rendered in the shell, not a native site view')
  assert.equal(await evaluate('(() => { const button = document.querySelector(".sidebar-toggle-button"); if (!button) return false; button.click(); return true })()'), true, 'the New Tab sidebar toggle should exist')
  await waitFor(() => evaluate('document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'the New Tab sidebar overlay')
  await delay(350)
  captureFullWindow('sidebar-overlay-new-tab.png')
  assert.equal(await evaluate('(() => { const button = document.querySelector(".sidebar-collapse-button"); if (!button) return false; button.click(); return true })()'), true, 'the sidebar should be dismissible before testing a live page')
  await waitFor(() => evaluate('!document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'the New Tab sidebar to close')

  assert.equal(await evaluate(`window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`), true, 'the app should open a local synthetic HTTP page')
  await waitFor(async () => (await evaluate('window.api.browser.state()')).url === fixtureUrl, 'the synthetic page navigation')
  await waitFor(() => mainWindow.contentView.children.length === 1, 'one native WebContentsView for the synthetic page')
  await delay(250)

  const hiddenLayout = await evaluate(`(() => {
    const rect = document.querySelector('.browser-viewport').getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, screenWidth: innerWidth }
  })()`)
  const hiddenView = getNativeViewState()[0]
  assert.equal(hiddenView.kind, 'WebContentsView')
  assert.equal(hiddenView.bounds.x, Math.round(hiddenLayout.x) + 14, 'the current hidden-state reveal strip offsets the page view by 14px')
  assert.equal(hiddenView.bounds.width, Math.round(hiddenLayout.width) - 14, 'the current hidden-state reveal strip leaves the native page 14px narrower than the viewport')

  assert.equal(await evaluate('(() => { const button = document.querySelector(".sidebar-toggle-button"); if (!button) return false; button.click(); return true })()'), true, 'the sidebar toggle should exist')
  await waitFor(() => evaluate('document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'the visible sidebar')
  await delay(350)
  const visibleLayout = await evaluate(`(() => {
    const viewport = document.querySelector('.browser-viewport').getBoundingClientRect()
    const sidebar = document.querySelector('.browser-sidebar').getBoundingClientRect()
    return { viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }, sidebar: { x: sidebar.x, y: sidebar.y, width: sidebar.width, height: sidebar.height } }
  })()`)
  const visibleView = getNativeViewState()[0]
  assert.equal(visibleView.bounds.x, Math.round(visibleLayout.sidebar.width), 'current native page bounds begin beside, not beneath, the sidebar')
  assert.equal(visibleView.bounds.width, Math.round(visibleLayout.viewport.width - visibleLayout.sidebar.width), 'current native page width is reduced by the visible sidebar width')
  captureFullWindow('sidebar-overlay-site-current-bounds.png')

  await evaluate(`(() => {
    const rect = document.querySelector('.browser-viewport').getBoundingClientRect()
    return window.api.browser.setBounds({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) })
  })()`)
  await waitFor(() => {
    const view = getNativeViewState()[0]
    return view.bounds.x === Math.round(visibleLayout.viewport.x) && view.bounds.width === Math.round(visibleLayout.viewport.width)
  }, 'the deliberate full-viewport WebContentsView bounds trial')
  await delay(350)
  captureFullWindow('sidebar-overlay-site-full-width-trial.png')

  const finalView = getNativeViewState()[0]
  assert.equal(mainWindow.contentView.children.length, 1)
  assert.equal(finalView.index, 0)
  console.log(`Native view geometry reproduced: hidden x=${hiddenView.bounds.x}, width=${hiddenView.bounds.width}; visible x=${visibleView.bounds.x}, width=${visibleView.bounds.width}; full-width trial x=${finalView.bounds.x}, width=${finalView.bounds.width}.`)
  console.log('Full-width trial leaves the existing sidebar in BrowserWindow.webContents behind the native WebContentsView; see docs/screenshots/sidebar-overlay-site-full-width-trial.png.')
  console.log('Electron sidebar overlay smoke passed: production New Tab, synthetic local page, current bounds, and the full-width native-layer trial.')
}

async function cleanup() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
  if (server.listening) await new Promise((resolvePromise) => {
    server.closeAllConnections?.()
    server.close(() => resolvePromise())
  })
  if (app.isReady()) app.quit()
  try { rmSync(userData, { recursive: true, force: true }) } catch {}
}

run().then(cleanup).catch(async (error) => {
  console.error('Electron sidebar overlay smoke failed:', error instanceof Error ? error.stack : error)
  process.exitCode = 1
  await cleanup()
})
