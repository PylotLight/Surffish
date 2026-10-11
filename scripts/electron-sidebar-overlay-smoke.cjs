const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, session } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `sockfish-basewindow-overlay-smoke-${process.pid}`)
const screenshotDirectory = process.env.SOCKFISH_SCREENSHOT_DIR
const fixtureTitle = 'Sockfish BaseWindow overlay fixture'
const NETWORK_ONLY_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: false,
  loadCSPFilters: false,
  enableHtmlFiltering: false,
  enableMutationObserver: false,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false
}
const server = createServer((request, response) => {
  if (request.url === '/favicon.svg') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#45b37c"/></svg>')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>${fixtureTitle}</title><style>html,body{margin:0;width:100%;min-height:180vh;font:20px system-ui;color:#fff;background:repeating-linear-gradient(135deg,#145b55 0 56px,#2f8e78 56px 112px)}h1{margin:0;padding:18px;background:#b21e35;font-size:20px}#target{position:absolute;top:112px;left:68vw;width:230px;height:78px;display:grid;place-items:center;background:#192e4a;border:3px solid #fff;border-radius:12px;cursor:pointer}#target strong{font-size:20px}#count{position:absolute;top:205px;left:68vw}#edge-target{position:absolute;top:230px;left:0;width:28px;height:48px;padding:0;background:#f0c419;color:#000;cursor:pointer}#page-input{position:absolute;top:270px;left:58vw;width:280px;height:42px;font:18px system-ui}</style><h1>LIVE SYNTHETIC PAGE — FULL-WIDTH OVERLAY TEST</h1><button id="target" onclick="window.clickCount=(window.clickCount||0)+1;document.querySelector('#count').textContent='Clicks: '+window.clickCount"><strong>Click page under overlay</strong></button><button id="edge-target" aria-label="Edge click target" onclick="window.edgeClickCount=(window.edgeClickCount||0)+1">edge</button><div id="count">Clicks: 0</div><input id="page-input" aria-label="Page input" placeholder="Real keyboard input test"><p style="margin-top:420px">Synthetic full-width web content</p>`)
})
let mainWindow
let fixtureUrl
let rendererViews = {}
let fixturePageView

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function waitFor(predicate, description, timeout = 30000) {
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
  throw new Error(`Timed out while waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}

function surfaceFor(view) {
  if (!view?.webContents || view.webContents.isDestroyed()) return null
  try {
    return new URL(view.webContents.getURL()).searchParams.get('surface')
  } catch {
    return null
  }
}

function nativeViewState() {
  return mainWindow.contentView.children.map((view, index) => ({
    index,
    kind: view.constructor?.name ?? 'unknown',
    bounds: view.getBounds(),
    visible: view.getVisible(),
    url: view.webContents && !view.webContents.isDestroyed() ? view.webContents.getURL() : null,
    surface: surfaceFor(view)
  }))
}

async function evaluate(view, expression) {
  assert.ok(view?.webContents && !view.webContents.isDestroyed(), 'the requested renderer surface must be available')
  return view.webContents.executeJavaScript(expression)
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

function pointerMove(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y))])
}

function pointerClick(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y)), 'click', '1'])
}

function pointerType(value) {
  execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '4', value])
}

function pointerScrollDown(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y)), 'click', '5'])
}

function screenPointForElement(view, rect) {
  const content = mainWindow.getContentBounds()
  const native = view.getBounds()
  return {
    x: content.x + native.x + rect.x + rect.width / 2,
    y: content.y + native.y + rect.y + rect.height / 2
  }
}

async function clickElement(view, selector) {
  const rect = await evaluate(view, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
  assert.ok(rect, `the ${selector} control must exist`)
  const point = screenPointForElement(view, rect)
  pointerClick(point.x, point.y)
  return point
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
    const candidate = BaseWindow.getAllWindows().find((window) => !window.isDestroyed())
    return candidate && candidate.isVisible() ? candidate : null
  }, 'the production Sockfish BaseWindow', 45000)
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 620 })
  mainWindow.focus()

  await waitFor(() => {
    rendererViews = Object.fromEntries(mainWindow.contentView.children
      .filter((view) => view.webContents && !view.webContents.isDestroyed())
      .map((view) => [surfaceFor(view), view]).filter(([surface]) => surface))
    return rendererViews.content && rendererViews.toolbar && rendererViews.sidebar
  }, 'all three trusted renderer surfaces', 45000)
  await waitFor(() => evaluate(rendererViews.content, 'Boolean(document.querySelector(".new-tab-page"))'), 'the renderer-owned New Tab page')
  const initialShell = nativeViewState()
  assert.equal(mainWindow.contentView.children.length, 3, 'the initial New Tab has three app surfaces and no remote page view')
  assert.equal(rendererViews.content.getVisible(), true, 'the full React content surface remains visible for New Tab')
  assert.equal(rendererViews.toolbar.getVisible(), false)
  assert.equal(rendererViews.sidebar.getVisible(), false)

  const firstTab = (await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')).find((tab) => tab.active)
  assert.ok(firstTab, 'the initial New Tab should be active')
  mainWindow.focus()
  rendererViews.content.webContents.focus()
  execFileSync('xdotool', ['key', 'ctrl+w'])
  await waitFor(async () => {
    if (mainWindow.isDestroyed() || !mainWindow.isVisible()) return false
    const tabs = await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')
    return tabs.length === 1 && tabs[0]?.id !== firstTab.id
  }, 'closing the only New Tab leaves the window open with a replacement tab')

  const replacementTab = (await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')).find((tab) => tab.active)
  assert.ok(replacementTab)
  rendererViews.content.webContents.focus()
  execFileSync('xdotool', ['key', 'ctrl+t'])
  await waitFor(async () => {
    const tabs = await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')
    return tabs.length === 2 && tabs.some((tab) => tab.active && tab.id !== replacementTab.id)
  }, 'Command-T creates and activates a new tab')
  await waitFor(() => evaluate(rendererViews.content, 'document.activeElement === document.querySelector(".omnibox input")'), 'the address field receives focus on the new tab')
  rendererViews.content.webContents.focus()
  execFileSync('xdotool', ['key', 'ctrl+w'])
  await waitFor(async () => {
    const tabs = await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')
    return tabs.length === 1 && tabs[0]?.id === replacementTab.id
  }, 'Command-W closes the active tab without closing the window')

  assert.equal(await evaluate(rendererViews.content, `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`), true, 'the app should open a synthetic loopback page')
  await waitFor(async () => (await evaluate(rendererViews.toolbar, 'window.api.browser.state()')).url === fixtureUrl, 'the synthetic page navigation')
  await waitFor(async () => {
    const tabs = await evaluate(rendererViews.toolbar, 'window.api.browser.tabs.get()')
    return tabs.find((tab) => tab.url === fixtureUrl)?.faviconUrl === `${new URL(fixtureUrl).origin}/favicon.svg`
  }, 'the page-declared favicon to appear in the active tab summary')
  await waitFor(() => {
    fixturePageView = mainWindow.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL() === fixtureUrl)
    return fixturePageView && fixturePageView.getBounds().width > 0
  }, 'the native page view with full-width bounds', 45000)
  await delay(250)
  assert.equal(fixturePageView.webContents.session, session.fromPartition('persist:fish-browser'), 'live pages retain Sockfish’s persistent site session and cookies')
  await fixturePageView.webContents.executeJavaScript("document.cookie = 'sockfish-overlay-smoke=cookie-preserved; path=/; SameSite=Lax'")

  const contentSizeBeforeMaximize = mainWindow.getContentSize()
  mainWindow.maximize()
  await waitFor(() => {
    if (!mainWindow.isMaximized()) return false
    const [width, height] = mainWindow.getContentSize()
    const siteBounds = fixturePageView.getBounds()
    return width > contentSizeBeforeMaximize[0]
      && rendererViews.content.getBounds().width === width
      && rendererViews.toolbar.getBounds().width === width
      && rendererViews.sidebar.getBounds().height === height
      && siteBounds.width === width
      && siteBounds.height === Math.max(0, height - siteBounds.y)
  }, 'all native shell layers and the live page resize to the maximized window')
  const contentSize = mainWindow.getContentSize()
  pointerMove(mainWindow.getContentBounds().x + Math.floor(contentSize[0] / 2), mainWindow.getContentBounds().y + Math.floor(contentSize[1] / 2))
  await waitFor(() => nativeViewState().find((view) => view.surface === 'sidebar').bounds.width === 0, 'the full-height sidebar to hide after the pointer leaves the left reveal edge')
  const pageHiddenSidebar = fixturePageView.getBounds()
  const sidebarHiddenState = nativeViewState()
  assert.equal(pageHiddenSidebar.x, 0, 'a live page starts at the left edge without a reveal-strip inset')
  assert.equal(pageHiddenSidebar.width, contentSize[0], 'the live page spans the entire native content width')
  assert.equal(rendererViews.content.getVisible(), false, 'the full React renderer is hidden above the page and cannot intercept its input')
  assert.equal(rendererViews.toolbar.getVisible(), true)
  assert.equal(rendererViews.sidebar.getVisible(), true)
  assert.equal(sidebarHiddenState.find((view) => view.surface === 'sidebar').bounds.width, 0, 'the hidden sidebar has no native hit-test strip')
  assert.ok(sidebarHiddenState.find((view) => view.surface === 'toolbar').index > sidebarHiddenState.find((view) => view.url === fixtureUrl).index, 'the toolbar is layered above the live page')
  assert.ok(sidebarHiddenState.find((view) => view.surface === 'sidebar').index > sidebarHiddenState.find((view) => view.url === fixtureUrl).index, 'the sidebar is layered above the live page')
  captureFullWindow('sidebar-overlay-live-page-hidden.png')

  // A click inside the former 14px reveal strip must still reach the full-width live page.
  const edgePoint = { x: mainWindow.getContentBounds().x + 5, y: mainWindow.getContentBounds().y + pageHiddenSidebar.y + 245 }
  pointerClick(edgePoint.x, edgePoint.y)
  await waitFor(() => fixturePageView.webContents.executeJavaScript('window.edgeClickCount || 0'), 'the page click at the leftmost edge')
  await delay(250)
  assert.equal(await fixturePageView.webContents.executeJavaScript('window.edgeClickCount'), 1, 'the hidden sidebar must not intercept a click at x=5')
  assert.equal(rendererViews.sidebar.getBounds().width, 0, 'a click cancels the delayed hover reveal and leaves the page unobstructed')

  // Exercise the existing toolbar control using native mouse input, then confirm the glass sidebar opens above a full-width page.
  await clickElement(rendererViews.toolbar, '.sidebar-toggle-button')
  await waitFor(() => rendererViews.sidebar.getBounds().width >= 300, 'the pinned sidebar overlay to expand')
  await waitFor(() => evaluate(rendererViews.toolbar, 'document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'shared visible sidebar state on the toolbar')
  await delay(300)
  const pageVisibleSidebar = fixturePageView.getBounds()
  const sidebarView = rendererViews.sidebar.getBounds()
  assert.equal(pageVisibleSidebar.x, 0, 'opening the sidebar must not inset the page')
  assert.equal(pageVisibleSidebar.width, contentSize[0], 'opening the sidebar must not narrow the page')
  assert.equal(sidebarView.width, Math.min(320, contentSize[0]))
  assert.equal(sidebarView.y, 0, 'the sidebar starts at the top edge of the window')
  assert.equal(sidebarView.height, contentSize[1], 'the sidebar covers the full window height')
  captureFullWindow('sidebar-overlay-live-page-visible.png')

  // A physical click on the live page outside the glass panel must reach the page while the sidebar is open.
  mainWindow.focus()
  const targetRect = await fixturePageView.webContents.executeJavaScript(`(() => { const r = document.querySelector('#target').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
  const targetPoint = screenPointForElement(fixturePageView, targetRect)
  pointerClick(targetPoint.x, targetPoint.y)
  await waitFor(() => fixturePageView.webContents.executeJavaScript('window.clickCount || 0'), 'the live page click behind the sidebar')
  assert.equal(await fixturePageView.webContents.executeJavaScript('window.clickCount || 0'), 1, 'the full-width site WebContentsView receives clicks with the sidebar above it')

  // Type into a focused site input; the native page keeps keyboard focus during the overlay.
  const inputRect = await fixturePageView.webContents.executeJavaScript(`(() => { const r = document.querySelector('#page-input').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
  const inputPoint = screenPointForElement(fixturePageView, inputRect)
  pointerClick(inputPoint.x, inputPoint.y)
  pointerType('native-page-input')
  await waitFor(() => fixturePageView.webContents.executeJavaScript('document.querySelector("#page-input").value'), 'real keyboard input in the live page')
  assert.equal(await fixturePageView.webContents.executeJavaScript('document.querySelector("#page-input").value'), 'native-page-input')
  const scrollBounds = fixturePageView.getBounds()
  const scrollPoint = { x: mainWindow.getContentBounds().x + contentSize[0] - 80, y: mainWindow.getContentBounds().y + scrollBounds.y + Math.floor(scrollBounds.height * 0.7) }
  pointerScrollDown(scrollPoint.x, scrollPoint.y)
  await waitFor(() => fixturePageView.webContents.executeJavaScript('window.scrollY > 0'), 'real mouse-wheel scrolling through the overlay')
  await fixturePageView.webContents.executeJavaScript('window.scrollTo(0, 0)')
  await waitFor(() => fixturePageView.webContents.executeJavaScript('window.scrollY === 0'), 'returning the synthetic page to its top before the remaining pointer checks')

  // Click the sidebar's collapse/pin control with a real pointer to confirm that this top layer is interactive.
  const collapsePoint = await clickElement(rendererViews.sidebar, '.sidebar-collapse-button')
  await waitFor(() => evaluate(rendererViews.sidebar, 'document.querySelector(".sidebar-collapse-button")?.getAttribute("aria-pressed") === "false"'), 'the sidebar pin control to toggle off')
  assert.ok(collapsePoint.x < mainWindow.getContentBounds().x + 340, 'the sidebar control is inside the glass panel')
  pointerMove(mainWindow.getContentBounds().x + Math.min(700, contentSize[0] - 10), mainWindow.getContentBounds().y + pageVisibleSidebar.y + 350)
  const resetTargetRect = await fixturePageView.webContents.executeJavaScript(`(() => { const r = document.querySelector('#target').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
  const resetTargetPoint = screenPointForElement(fixturePageView, resetTargetRect)
  pointerClick(resetTargetPoint.x, resetTargetPoint.y)
  await waitFor(async () => (await fixturePageView.webContents.executeJavaScript('window.clickCount || 0')) >= 2, 'the live page to receive a click after the sidebar releases focus')
  assert.equal(await fixturePageView.webContents.executeJavaScript('window.clickCount || 0'), 2)
  await waitFor(() => rendererViews.sidebar.getBounds().width === 0, 'the sidebar to auto-hide after pointer exit and focus release')

  // Hover over the leftmost 14px of the live page; delayed reveal must not reserve or occlude that area while hidden.
  const pageAfterHide = fixturePageView.getBounds()
  pointerMove(mainWindow.getContentBounds().x + 5, mainWindow.getContentBounds().y + pageAfterHide.y + 150)
  await waitFor(() => rendererViews.sidebar.getBounds().width >= 300, 'hover over the live-page edge to reopen the sidebar')
  assert.equal(fixturePageView.getBounds().width, contentSize[0], 'hover reveal keeps the live page full width')
  pointerMove(mainWindow.getContentBounds().x + Math.min(700, contentSize[0] - 10), mainWindow.getContentBounds().y + pageVisibleSidebar.y + 350)
  await waitFor(() => rendererViews.sidebar.getBounds().width === 0, 'the hover-only sidebar to hide again')

  // Create and return from New Tab to verify the local React surface/tab lifecycle still works.
  const newTabId = await evaluate(rendererViews.toolbar, 'window.api.browser.tabs.create()')
  assert.ok(newTabId, 'the app should create a new tab')
  await waitFor(async () => (await evaluate(rendererViews.content, 'window.api.browser.state()')).url.includes('sockfish://quick-links'), 'the local New Tab')
  await waitFor(() => rendererViews.content.getVisible() && !rendererViews.toolbar.getVisible() && !rendererViews.sidebar.getVisible(), 'the original full-app surface when the active tab is New Tab')
  assert.ok(mainWindow.contentView.children.some((view) => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL() === fixtureUrl), 'the original live page tab remains alive')
  assert.equal(await evaluate(rendererViews.content, `(async () => { const tab = (await window.api.browser.tabs.get()).find((candidate) => candidate.url === ${JSON.stringify(fixtureUrl)}); return tab ? window.api.browser.tabs.activate(tab.id) : false })()`), true)
  await waitFor(() => rendererViews.toolbar.getVisible() && rendererViews.sidebar.getVisible() && !rendererViews.content.getVisible(), 'return to the full-width live page overlay')
  await waitFor(() => fixturePageView.getBounds().width === contentSize[0], 'the full-width page after tab activation')
  assert.match(await fixturePageView.webContents.executeJavaScript('document.cookie'), /sockfish-overlay-smoke=cookie-preserved/, 'site cookies remain intact through the New Tab/tab lifecycle')
  captureFullWindow('sidebar-overlay-live-page-restored.png')

  assert.equal(fixturePageView.getBounds().x, 0)
  assert.equal(fixturePageView.getBounds().width, contentSize[0])
  console.log(`BaseWindow app integration passed: initial shell views=${initialShell.length}; maximized live page x=${fixturePageView.getBounds().x}, width=${fixturePageView.getBounds().width}/${contentSize[0]}; visible sidebar width=${sidebarView.width}; last-tab Command-W keeps the window open, Command-T focuses the address bar, and x=5 click-through, overlay page input/wheel, delayed hover reveal, and tab/New Tab lifecycle verified.`)
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
  console.error('Electron sidebar overlay integration smoke failed:', error instanceof Error ? error.stack : error)
  await cleanup()
  app.exit(1)
})
