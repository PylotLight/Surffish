const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, session } = require('electron')
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
const userData = join(tmpdir(), `surffish-download-smoke-${process.pid}`)
const downloadDirectory = join(userData, 'synthetic-downloads')
const screenshotDirectory = process.env.SURFFISH_SCREENSHOT_DIR
const totalBytes = 2 * 1024 * 1024
const servers = []
let mainWindow
let rendererViews = {}
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

function sendAttachment(response, filename, start = 0) {
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(totalBytes - start),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }
  if (start > 0) headers['Content-Range'] = `bytes ${start}-${totalBytes - 1}/${totalBytes}`
  response.writeHead(start > 0 ? 206 : 200, headers)
  let sent = start
  const timer = setInterval(() => {
    if (response.destroyed) {
      clearInterval(timer)
      return
    }
    const chunk = Buffer.alloc(Math.min(48 * 1024, totalBytes - sent), 0x53)
    sent += chunk.length
    if (sent >= totalBytes) {
      clearInterval(timer)
      response.end(chunk)
    } else {
      response.write(chunk)
    }
  }, 25)
  response.on('close', () => clearInterval(timer))
}

function createDownloadFixtureServer() {
  return createServer((request, response) => {
    if (request.url?.startsWith('/synthetic.bin')) {
      const range = request.headers.range?.match(/^bytes=(\d+)-/)
      const start = range ? Number(range[1]) : 0
      return sendAttachment(response, 'synthetic-test.bin', start)
    }
    if (request.url === '/broken.bin') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="synthetic-failed.bin"',
        'Content-Length': String(totalBytes),
        'Cache-Control': 'no-store'
      })
      response.write(Buffer.alloc(24 * 1024, 0x46))
      setTimeout(() => response.destroy(), 30)
      return
    }
    response.writeHead(404)
    response.end('Not found')
  })
}

function createSyntheticSiteServer(label, color) {
  return createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="${color}"/><text x="32" y="43" text-anchor="middle" font-size="34" font-family="sans-serif" fill="white">${label[0]}</text></svg>`)
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><title>${label} synthetic site</title><h1>${label} synthetic site</h1>`)
  })
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  servers.push(server)
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

function surfaceFor(view) {
  if (!view?.webContents || view.webContents.isDestroyed()) return null
  try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null }
}

function activeUiView() {
  assert.ok(mainWindow && !mainWindow.isDestroyed(), 'Surffish window must be ready')
  for (const view of [rendererViews.toolbar, rendererViews.content, rendererViews.sidebar]) {
    if (view?.getVisible() && !view.webContents.isDestroyed()) return view
  }
  throw new Error('No trusted Surffish renderer surface is visible.')
}

async function evaluateIn(view, expression) {
  assert.ok(view?.webContents && !view.webContents.isDestroyed(), 'Surffish renderer surface must be ready')
  const key = `__surffishSmokeResult${++evaluationId}`
  const keyLiteral = JSON.stringify(key)
  await view.webContents.executeJavaScript(`(() => {
    window[${keyLiteral}] = { ready: false }
    Promise.resolve().then(() => (${expression})).then(
      (value) => { window[${keyLiteral}] = { ready: true, json: JSON.stringify(value) } },
      (error) => { window[${keyLiteral}] = { ready: true, error: String(error) } }
    )
    return true
  })()`)
  const resultText = await waitFor(
    () => view.webContents.executeJavaScript(`window[${keyLiteral}]?.ready ? JSON.stringify(window[${keyLiteral}]) : null`),
    'the renderer-side IPC result',
    12000
  )
  const result = JSON.parse(resultText)
  if (result.error) throw new Error(result.error)
  return result.json === undefined ? undefined : JSON.parse(result.json)
}

async function evaluate(expression) {
  return evaluateIn(activeUiView(), expression)
}

async function getHistory() {
  return evaluate(`window.api.browser.downloads.get().then((entries) => entries.map((entry) => ({
    id: entry.id,
    filename: entry.filename,
    source: entry.source,
    state: entry.state,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    receivedBytes: entry.receivedBytes,
    totalBytes: entry.totalBytes,
    canResume: entry.canResume === true,
    fileAvailable: entry.fileAvailable === true,
    message: entry.message,
    hasFilePath: typeof entry.filePath === 'string',
    hasFullUrl: typeof entry.url === 'string'
  })))`)
}

async function navigate(url) {
  const accepted = await evaluate(`window.api.browser.navigate(${JSON.stringify(url)})`)
  if (accepted !== true) {
    const state = await evaluate('Promise.all([window.api.browser.state(), window.api.browser.tabs.get()]).then(([current, tabs]) => ({ current, tabs }))')
    const safeState = {
      url: state.current?.url ? `${new URL(state.current.url).origin}${new URL(state.current.url).pathname}` : null,
      error: state.current?.error,
      tabs: state.tabs?.map((tab) => ({ active: tab.active, sleeping: tab.sleeping, url: `${new URL(tab.url).origin}${new URL(tab.url).pathname}` }))
    }
    throw new Error(`Surffish rejected synthetic local navigation ${new URL(url).pathname}: ${JSON.stringify(safeState)}`)
  }
}

async function clickSelector(selector) {
  const selectorLiteral = JSON.stringify(selector)
  for (const view of [rendererViews.sidebar, rendererViews.toolbar, rendererViews.content]) {
    if (!view?.getVisible() || view.webContents.isDestroyed()) continue
    const visible = await view.webContents.executeJavaScript(`(() => { const element = document.querySelector(${selectorLiteral}); if (!element) return false; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; })()`)
    if (visible) return evaluateIn(view, `(() => { const element = document.querySelector(${selectorLiteral}); if (!element) return false; element.click(); return true; })()`)
  }
  return false
}

async function captureScreenshot(name) {
  if (!screenshotDirectory) return
  mkdirSync(screenshotDirectory, { recursive: true })
  assert.ok(process.env.DISPLAY, 'DISPLAY is required to capture the composed BaseWindow surfaces')
  const { x, y, width, height } = mainWindow.getBounds()
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-video_size', `${width}x${height}`,
    '-i', `${process.env.DISPLAY}.0+${x},${y}`, '-frames:v', '1', '-y', join(screenshotDirectory, name)
  ])
}

async function waitForHistory(predicate, description) {
  return waitFor(async () => predicate(await getHistory()), description)
}

function seedOfflineProfile() {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  mkdirSync(downloadDirectory, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', NETWORK_ONLY_CONFIG)
  writeFileSync(join(userData, 'adblock-engine.bin'), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`, { mode: 0o600 })
}

async function seedNewTabDemo(siteBases) {
  for (const [index, url] of [`${siteBases[0]}/`, `${siteBases[1]}/`].entries()) {
    await navigate(url)
    await waitFor(async () => {
      const state = await evaluate('window.api.browser.state()')
      return state.url === url ? state : null
    }, `synthetic page ${new URL(url).host} to navigate`)
    await waitFor(async () => evaluateIn(rendererViews.toolbar, 'Boolean(document.querySelector("[aria-label=\\\"Bookmark this page\\\"]") && !document.querySelector("[aria-label=\\\"Bookmark this page\\\"]").disabled)'), 'the Bookmark this page control in the toolbar renderer')
    assert.equal(await evaluateIn(rendererViews.toolbar, '(() => { const button = document.querySelector("[aria-label=\\\"Bookmark this page\\\"]"); if (!button || button.disabled) return false; button.click(); return true })()'), true, 'the current synthetic site should be bookmarkable')
    await waitFor(async () => evaluateIn(rendererViews.sidebar, `document.querySelectorAll(".sidebar-pinned-list .pinned-site-icon-button").length >= ${index + 1}`), `synthetic pin ${index + 1}`)
  }
  for (const url of [`${siteBases[2]}/`, `${siteBases[3]}/`]) {
    await navigate(url)
    await waitFor(async () => {
      const state = await evaluate('window.api.browser.state()')
      return state.url === url ? state : null
    }, `synthetic page ${new URL(url).host} to navigate`)
    await waitFor(async () => {
      const history = await evaluate('window.api.browser.history.get()')
      return history.some((entry) => entry.url === url)
    }, `synthetic history for ${new URL(url).host}`)
  }
  const newTabId = await evaluate('window.api.browser.tabs.create()')
  await delay(300)
  const fixtureStatus = await evaluate('Promise.all([window.api.browser.state(), window.api.browser.tabs.get(), window.api.browser.pinnedSites.get()]).then(([state, tabs, pins]) => ({ page: state.url, error: state.error, activeTabs: tabs.filter((tab) => tab.active).map((tab) => tab.url), pins: pins.map((pin) => ({ title: pin.title, origin: new URL(pin.url).origin })), localNewTab: Boolean(document.querySelector(".new-tab-page")), iconGrid: Boolean(document.querySelector(".new-tab-icon-grid")), emptyMessage: document.querySelector(".new-tab-empty")?.textContent ?? null }))')
  const newTabTileLabels = await waitFor(async () => {
    const labels = await evaluateIn(rendererViews.content, 'Array.from(document.querySelectorAll(".new-tab-icon-grid .new-tab-icon-tile")).map((tile) => tile.getAttribute("aria-label"))')
    return labels.some((label) => label?.startsWith('Open Alpha synthetic site')) && labels.some((label) => label?.startsWith('Open Beta synthetic site')) ? labels : null
  }, 'pinned sites to synchronize into the separate New Tab renderer')
  assert.ok(newTabId, 'the app should create a synthetic Quick Links tab')
  assert.equal(fixtureStatus.localNewTab, true)
  assert.equal(fixtureStatus.iconGrid, true)
  assert.equal(fixtureStatus.pins.length, 2)
  assert.ok(newTabTileLabels.some((label) => label?.startsWith('Open Alpha synthetic site')))
  assert.ok(newTabTileLabels.some((label) => label?.startsWith('Open Beta synthetic site')))
  await waitFor(async () => evaluate('Boolean(document.querySelector(".new-tab-page"))'), 'the local New Tab page')
  await waitFor(async () => evaluate('Boolean(document.querySelector(".new-tab-icon-grid"))'), 'the local New Tab grid')
  await delay(350)
  await captureScreenshot('new-tab-page.png')
  await clickSelector('[aria-label="Show next background"]')
  await delay(900)
  await captureScreenshot('new-tab-photo-rotation.png')
  assert.equal(await evaluate('(() => { const layout = document.querySelector(".browser-layout"); if (!layout) return false; layout.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 200 })); return true; })()'), true, 'the browser layout should accept a hover at the reveal edge')
  await waitFor(async () => evaluate('document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'the tabs sidebar to reveal on hover')
  assert.equal(await clickSelector('[aria-label="Keep sidebar open"]'), true, 'the sidebar pin control should keep the sidebar open')
  await waitFor(async () => evaluate('Boolean(document.querySelector("[aria-label=\\"Auto-hide sidebar\\"]"))'), 'the sidebar to stay pinned open')
  await delay(300)
  await captureScreenshot('tabs-sidebar.png')
  if (screenshotDirectory) {
    assert.equal(await clickSelector('[aria-label="Browsing history"]'), true, 'the browsing-history control should be available')
    await waitFor(async () => evaluateIn(rendererViews.sidebar, 'document.querySelectorAll(".history-list .history-item").length >= 2'), 'synthetic records in the History sidebar')
    await delay(300)
    await captureScreenshot('history-sidebar.png')
  }
}

async function captureDownloadViews() {
  if (!screenshotDirectory) return
  assert.equal(await clickSelector('.downloads-toolbar-button'), true, 'Downloads toolbar button should be present')
  await waitFor(async () => evaluate('Boolean(document.querySelector("#downloads-popup"))'), 'the Downloads popup')
  await waitFor(async () => evaluate('document.querySelectorAll("#downloads-popup .download-row").length >= 3'), 'synthetic history in the Downloads popup')
  await waitFor(async () => evaluate('document.querySelector("#downloads-popup")?.getBoundingClientRect().height > 100'), 'the visible anchored Downloads popup')
  assert.equal(await evaluate('document.querySelector("#downloads-popup")?.innerText.includes("synthetic-test.bin")'), true, 'the popup should show recent synthetic download records')
  await delay(350)
  await captureScreenshot('downloads-popover.png')
  assert.equal(await clickSelector('.downloads-show-all'), true, 'Downloads popup should offer Show all')
  await waitFor(async () => evaluate('Boolean(document.querySelector(".downloads-page"))'), 'the full Downloads page')
  await waitFor(async () => evaluate('document.querySelectorAll(".downloads-page .download-row").length >= 3'), 'synthetic history in the full Downloads page')
  assert.equal(await evaluate('document.querySelector(".downloads-page")?.innerText.includes("synthetic-test.bin")'), true, 'the full page should show recent synthetic download records')
  await delay(500)
  await captureScreenshot('downloads-page.png')
}

async function run() {
  app.setPath('userData', userData)
  seedOfflineProfile()

  const downloadsServer = createDownloadFixtureServer()
  const downloadsBase = await listen(downloadsServer)
  const siteBases = await Promise.all([
    listen(createSyntheticSiteServer('Alpha', '#2d7f69')),
    listen(createSyntheticSiteServer('Beta', '#5871a8')),
    listen(createSyntheticSiteServer('Gamma', '#9a6740')),
    listen(createSyntheticSiteServer('Delta', '#7a568d'))
  ])

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const browserSession = session.fromPartition('persist:surffish-browser')
  browserSession.on('will-download', (_event, item) => {
    const destination = join(downloadDirectory, `${Date.now()}-${Math.random().toString(16).slice(2)}-${basename(item.getFilename())}`)
    item.setSavePath(destination)
  })

  mainWindow = await waitFor(() => {
    const window = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.isVisible())
    if (!window) return null
    rendererViews = Object.fromEntries(window.contentView.children
      .filter((view) => view.webContents && !view.webContents.isDestroyed())
      .map((view) => [surfaceFor(view), view]).filter(([surface]) => surface))
    if (!rendererViews.content || !rendererViews.toolbar || !rendererViews.sidebar) return null
    if (Object.values(rendererViews).some((view) => view.webContents.isLoadingMainFrame())) return null
    return window
  }, 'the production Surffish BaseWindow and its renderer surfaces', 45000)
  await evaluate('window.api.browser.downloads.get()')
  assert.equal(await clickSelector('.downloads-toolbar-button'), true, 'Downloads should open from its toolbar button')
  await waitFor(async () => evaluate('document.querySelector("#downloads-popup .downloads-empty")?.textContent.includes("No downloads yet")'), 'the empty Downloads state')
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await waitFor(async () => evaluate('document.querySelector(".downloads-toolbar-button")?.getAttribute("aria-expanded") === "false"'), 'Escape to close Downloads and restore the toolbar state')

  const firstUrl = `${downloadsBase}/synthetic.bin?case=complete`
  await navigate(firstUrl)
  const first = await waitForHistory((entries) => entries.find((entry) => entry.filename === 'synthetic-test.bin' && entry.state === 'progressing'), 'a real synthetic Electron download to start')
  assert.equal(first.source, '127.0.0.1')
  assert.equal(first.hasFilePath, false, 'renderer history must not expose local file paths')
  assert.equal(first.hasFullUrl, false, 'renderer history must not expose full URLs')
  assert.equal(await evaluate(`window.api.browser.downloads.pause(${JSON.stringify(first.id)})`), true, 'active transfer should pause')
  await waitForHistory((entries) => entries.find((entry) => entry.id === first.id)?.state === 'paused', 'the first download to pause')
  assert.equal(await evaluate(`window.api.browser.downloads.resume(${JSON.stringify(first.id)})`), true, 'paused transfer should resume')
  await waitForHistory((entries) => entries.some((entry) => entry.id === first.id && entry.state === 'completed'), 'the first download to complete')
  const completed = (await getHistory()).find((entry) => entry.id === first.id)
  assert.ok(completed, 'completed download should remain in history')
  assert.equal(completed.fileAvailable, true)
  const savedFile = readdirSync(downloadDirectory).map((name) => join(downloadDirectory, name)).find((file) => file.endsWith('synthetic-test.bin'))
  assert.ok(savedFile && existsSync(savedFile), 'the synthetic completed file should be saved locally')

  const beforeCancel = new Set([first.id])
  await navigate(`${downloadsBase}/synthetic.bin?case=cancel`)
  const cancelledCandidate = await waitForHistory((entries) => entries.find((entry) => !beforeCancel.has(entry.id) && entry.filename === 'synthetic-test.bin' && entry.state === 'progressing'), 'a second transfer to start')
  assert.equal(await evaluate(`window.api.browser.downloads.cancel(${JSON.stringify(cancelledCandidate.id)})`), true, 'active transfer should cancel')
  await waitForHistory((entries) => entries.find((entry) => entry.id === cancelledCandidate.id)?.state === 'cancelled', 'the second transfer to cancel')

  await navigate(`${downloadsBase}/broken.bin`)
  const failed = await waitForHistory((entries) => entries.find((entry) => entry.filename === 'synthetic-failed.bin' && (entry.state === 'failed' || entry.state === 'interrupted')), 'a truncated transfer to fail safely')
  assert.ok(failed.message, 'failed/interrupted history should have a user-facing explanation')

  await seedNewTabDemo(siteBases)
  const activeUrl = `${downloadsBase}/synthetic.bin?case=popup`
  await navigate(activeUrl)
  const active = await waitForHistory((entries) => entries.find((entry) => entry.id !== first.id && entry.filename === 'synthetic-test.bin' && entry.state === 'progressing'), 'an active transfer for the popup')
  assert.equal(await evaluate(`window.api.browser.downloads.pause(${JSON.stringify(active.id)})`), true)
  const pausedActive = await waitForHistory((entries) => {
    const entry = entries.find((candidate) => candidate.id === active.id)
    return entry?.state === 'paused' ? entry : null
  }, 'the popup fixture transfer to pause')
  assert.equal(pausedActive.fileAvailable, false, 'a partial paused file must not appear ready to open or reveal')
  await waitFor(async () => evaluate('!document.querySelector(".browser-error")'), 'direct attachment navigation to avoid a false page-error banner')

  if (screenshotDirectory) await captureDownloadViews()

  assert.equal(await evaluate(`window.api.browser.downloads.remove(${JSON.stringify(first.id)})`), true, 'completed history should be removable')
  assert.equal(existsSync(savedFile), true, 'removing history must not delete the downloaded file')
  assert.equal((await getHistory()).some((entry) => entry.id === first.id), false)
  assert.equal(await evaluate(`window.api.browser.downloads.cancel(${JSON.stringify(active.id)})`), true)
  await waitForHistory((entries) => entries.find((entry) => entry.id === active.id)?.state === 'cancelled', 'the popup fixture transfer to cancel')
  await waitFor(async () => {
    try {
      const onDisk = JSON.parse(readFileSync(join(userData, 'downloads-history.json'), 'utf8'))
      return onDisk.some((entry) => entry.state === 'cancelled') && !onDisk.some((entry) => entry.id === first.id) ? onDisk : null
    } catch { return null }
  }, 'safe download metadata (with the removal applied) to persist on disk')
  const persistedHistory = JSON.parse(readFileSync(join(userData, 'downloads-history.json'), 'utf8'))
  assert.ok(persistedHistory.some((entry) => entry.state === 'cancelled'), 'safe download metadata should persist on disk')
  assert.ok(persistedHistory.some((entry) => entry.state === 'interrupted' || entry.state === 'failed'))
  assert.ok(persistedHistory.every((entry) => typeof entry.filePath === 'string' && !entry.source.includes('://') && !entry.source.includes('?')))
  assert.equal(persistedHistory.some((entry) => entry.id === first.id), false, 'removing history should persist without deleting the file')

  console.log('Production Electron Downloads smoke passed: pause/resume, completion, cancellation, truncated-transfer failure, private renderer metadata, non-destructive removal and optional real-app screenshots.')
}

async function cleanup() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await delay(300)
    if (!mainWindow.isDestroyed()) mainWindow.destroy()
  }
  for (const server of servers) {
    server.closeAllConnections?.()
    await new Promise((resolvePromise) => server.close(() => resolvePromise()))
  }
  if (app.isReady()) app.quit()
  try { rmSync(userData, { recursive: true, force: true }) } catch {}
}

run().then(cleanup).catch(async (error) => {
  console.error('Electron Downloads smoke failed:', error instanceof Error ? error.stack : error)
  await cleanup()
  app.exit(1)
})
