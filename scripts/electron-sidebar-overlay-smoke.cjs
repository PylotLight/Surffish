const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, dialog, session, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-basewindow-overlay-smoke-${process.pid}`)
const screenshotDirectory = process.env.SURFFISH_SCREENSHOT_DIR
const fixtureTitle = 'Surffish BaseWindow overlay fixture'
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
let closeWindowConfirmationOptions = null
const showMessageBox = dialog.showMessageBox.bind(dialog)
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1)
  if (options?.message === 'Close the window?') {
    closeWindowConfirmationOptions = options
    return { response: options.cancelId ?? 1, checkboxChecked: false }
  }
  return showMessageBox(...args)
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
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
  assert.ok(display, 'DISPLAY is required when SURFFISH_SCREENSHOT_DIR is set')
  const { x, y, width, height } = mainWindow.getBounds()
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-video_size', `${width}x${height}`,
    '-i', `${display}.0+${x},${y}`, '-frames:v', '1', '-y', join(screenshotDirectory, basename(name))
  ])
}

function seedIsolatedProfile() {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', NETWORK_ONLY_CONFIG)
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
function pointerDown(x, y) {
  execFileSync('xdotool', ['mousemove', String(Math.round(x)), String(Math.round(y)), 'mousedown', '1'])
}
function pointerUp() {
  execFileSync('xdotool', ['mouseup', '1'])
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
  writeFileSync(join(userData, 'browser-preferences.json'), `${JSON.stringify({
    version: 1,
    pinnedSites: [
      { title: 'YouTube', url: 'https://www.youtube.com/', faviconUrl: 'https://www.youtube.com/favicon.ico' },
      { title: 'Google', url: 'https://www.google.com/', faviconUrl: 'https://www.google.com/favicon.ico' },
      { title: 'Gmail', url: 'https://mail.google.com/', faviconUrl: 'https://mail.google.com/favicon.ico' },
      { title: 'Maps', url: 'https://maps.google.com/', faviconUrl: 'https://maps.google.com/favicon.ico' }
    ]
  })}\n`, { mode: 0o600 })

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => {
    const candidate = BaseWindow.getAllWindows().find((window) => !window.isDestroyed())
    return candidate && candidate.isVisible() ? candidate : null
  }, 'the production Surffish BaseWindow', 45000)
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 620 })
  mainWindow.focus()

  await waitFor(() => {
    rendererViews = Object.fromEntries(mainWindow.contentView.children
      .filter((view) => view.webContents && !view.webContents.isDestroyed())
      .map((view) => [surfaceFor(view), view]).filter(([surface]) => surface))
    return rendererViews.content && rendererViews.toolbar && rendererViews.sidebar
  }, 'all three trusted renderer surfaces', 45000)
  await waitFor(() => evaluate(rendererViews.content, 'Boolean(document.querySelector(".new-tab-page"))'), 'the renderer-owned New Tab page')
  assert.equal(await evaluate(rendererViews.content, 'document.querySelector(".sidebar-heading .sidebar-icon-button")'), null, 'the header New Tab plus button is removed')
  assert.equal(await evaluate(rendererViews.content, 'document.querySelector(".sidebar-new-tab-row")?.getAttribute("aria-label")'), 'New tab', 'the bottom New Tab action is available in the sidebar')
  assert.equal(await evaluate(rendererViews.content, 'document.querySelector(".sidebar-collapse-button")'), null, 'the duplicate sidebar-header pin control is removed')
  assert.ok(await evaluate(rendererViews.content, 'document.querySelector(".toolbar-brand-icon")?.getBoundingClientRect().width >= 32'), 'the app brand mark is prominent in the top toolbar')
  const footerControls = await evaluate(rendererViews.content, `(() => [...document.querySelectorAll('.sidebar-footer-icon-button')].map((button) => ({ label: button.getAttribute('aria-label'), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })))()`)
  assert.deepEqual(footerControls.map(({ label }) => label), ['Keep sidebar open', 'Settings', 'Quit Surffish'], 'pin, Settings and Quit are compact footer actions')
  assert.ok(footerControls.every(({ width, height }) => width <= 36 && height <= 36), 'the footer controls do not consume full-width rows')
  assert.ok(await evaluate(rendererViews.toolbar, 'document.querySelector(".browser-toolbar-leading") && document.querySelector(".browser-toolbar-trailing")'), 'toolbar controls use distinct left and right groups')
  const initialShell = nativeViewState()
  assert.equal(mainWindow.contentView.children.length, 3, 'the initial New Tab has three app surfaces and no remote page view')
  assert.equal(rendererViews.content.getVisible(), true, 'the full React content surface remains visible for New Tab')
  assert.equal(rendererViews.toolbar.getVisible(), false)
  assert.equal(rendererViews.sidebar.getVisible(), false)

  if (screenshotDirectory) {
    mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 712 })
    await delay(250)
    await evaluate(rendererViews.content, 'window.api.browser.chrome.set({ sidebarMode: "tabs", sidebarPinned: true, sidebarHovered: false, sidebarFocused: false })')
    await waitFor(() => evaluate(rendererViews.content, 'document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'the New Tab sidebar for the product screenshot')
    await delay(350)
    pointerMove(mainWindow.getContentBounds().x + 1260, mainWindow.getContentBounds().y + 780)
    await delay(200)
    captureFullWindow('surffish-cover-new-tab.png')
    await evaluate(rendererViews.content, 'window.api.browser.chrome.set({ sidebarPinned: false, sidebarHovered: false, sidebarFocused: false })')
    await waitFor(() => evaluate(rendererViews.content, '!document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'the New Tab sidebar to close after the screenshot')
    mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 620 })
    await delay(250)
  }

  const firstTab = (await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')).find((tab) => tab.active)
  assert.ok(firstTab, 'the initial New Tab should be active')
  mainWindow.focus()
  rendererViews.content.webContents.focus()
  execFileSync('xdotool', ['key', 'ctrl+w'])
  await waitFor(() => closeWindowConfirmationOptions, 'the last-tab close confirmation prompt')
  assert.deepEqual(closeWindowConfirmationOptions.buttons, ['Close Window', 'Cancel'], 'the prompt offers an explicit cancel choice')
  assert.equal(closeWindowConfirmationOptions.cancelId, 1, 'cancel is the safe default for the smoke test')
  await waitFor(async () => {
    if (mainWindow.isDestroyed() || !mainWindow.isVisible()) return false
    const tabs = await evaluate(rendererViews.content, 'window.api.browser.tabs.get()')
    return tabs.length === 1 && tabs[0]?.id === firstTab.id
  }, 'canceling the last-tab prompt keeps the original New Tab and window open')

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

  assert.equal(await evaluate(rendererViews.content, `window.api.browser.navigate(${JSON.stringify(fixtureUrl)}).then((result) => result.ok)`), true, 'the app should open a synthetic loopback page')
  await waitFor(async () => (await evaluate(rendererViews.toolbar, 'window.api.browser.state()')).url === fixtureUrl, 'the synthetic page navigation')
  try {
    await waitFor(async () => {
      const tabs = await evaluate(rendererViews.toolbar, 'window.api.browser.tabs.get()')
      return tabs.find((tab) => tab.url === fixtureUrl)?.faviconUrl === `${new URL(fixtureUrl).origin}/favicon.svg`
    }, 'the page-declared favicon to appear in the active tab summary')
  } catch (error) {
    console.log('[overlay-smoke] DEBUG fixtureUrl:', fixtureUrl)
    console.log('[overlay-smoke] DEBUG tabs:', JSON.stringify(await evaluate(rendererViews.toolbar, 'window.api.browser.tabs.get().map((tab) => ({ url: tab.url, faviconUrl: tab.faviconUrl }))')))
    throw error
  }
  await waitFor(() => {
    fixturePageView = mainWindow.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL() === fixtureUrl)
    return fixturePageView && fixturePageView.getBounds().width > 0
  }, 'the native page view with full-width bounds', 45000)
  await delay(250)
  assert.equal(fixturePageView.webContents.session, session.fromPartition('persist:surffish-browser'), 'live pages use Surffish’s namespaced persistent site session')
  await fixturePageView.webContents.executeJavaScript("document.cookie = 'surffish-overlay-smoke=cookie-preserved; path=/; SameSite=Lax'")

  const contentSizeBeforeResize = mainWindow.getContentSize()
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => {
    const [width, height] = mainWindow.getContentSize()
    const siteBounds = fixturePageView.getBounds()
    return width > contentSizeBeforeResize[0]
      && height > contentSizeBeforeResize[1]
      && rendererViews.content.getBounds().width === width
      && rendererViews.toolbar.getBounds().width === width
      && rendererViews.sidebar.getBounds().height === height
      && siteBounds.width === width
      && siteBounds.height === Math.max(0, height - siteBounds.y)
  }, 'all native shell layers and the live page resize with the window')
  const toolbarLayout = await evaluate(rendererViews.toolbar, `(() => {
    const toolbar = document.querySelector('.browser-toolbar').getBoundingClientRect()
    const address = document.querySelector('.omnibox-wrap').getBoundingClientRect()
    const actions = document.querySelector('.browser-toolbar-trailing').getBoundingClientRect()
    return { toolbar: { left: toolbar.left, right: toolbar.right }, address: { left: address.left, right: address.right }, actions: { left: actions.left, right: actions.right } }
  })()`)
  const toolbarCenter = (toolbarLayout.toolbar.left + toolbarLayout.toolbar.right) / 2
  const addressCenter = (toolbarLayout.address.left + toolbarLayout.address.right) / 2
  assert.ok(Math.abs(toolbarCenter - addressCenter) <= 1, 'the address bar is centered in the toolbar')
  assert.ok(toolbarLayout.actions.right <= toolbarLayout.toolbar.right, 'toolbar icons stay within the right edge')
  assert.ok(toolbarLayout.address.right < toolbarLayout.actions.left, 'a gap separates the address bar from the right-aligned icons')

  mainWindow.maximize()
  await delay(250)
  await waitFor(() => {
    const [width, height] = mainWindow.getContentSize()
    const siteBounds = fixturePageView.getBounds()
    return width > 0 && height > 0
      && rendererViews.content.getBounds().width === width
      && rendererViews.toolbar.getBounds().width === width
      && rendererViews.sidebar.getBounds().height === height
      && siteBounds.width === width
      && siteBounds.height === Math.max(0, height - siteBounds.y)
  }, 'native shell layers and the live page match the size after maximize')
  const contentSize = mainWindow.getContentSize()
  pointerMove(mainWindow.getContentBounds().x + Math.floor(contentSize[0] / 2), mainWindow.getContentBounds().y + Math.floor(contentSize[1] / 2))
  await waitFor(() => nativeViewState().find((view) => view.surface === 'sidebar').bounds.width === 0, 'the full-height sidebar to hide after the pointer leaves the left reveal edge')
  const pageHiddenSidebar = fixturePageView.getBounds()
  const sidebarHiddenState = nativeViewState()
  assert.equal(pageHiddenSidebar.x, 0, 'a live page starts at the left edge without a reveal-strip inset')
  assert.equal(pageHiddenSidebar.width, contentSize[0], 'the live page spans the entire native content width')
  assert.equal(rendererViews.content.getVisible(), false, 'the full React renderer is hidden above the page and cannot intercept its input')
  assert.equal(rendererViews.toolbar.getVisible(), true)
  // Collapsed: zero-width *and* hidden, so nothing in it keeps painting over the page.
  assert.equal(rendererViews.sidebar.getVisible(), false, 'the collapsed sidebar overlay is hidden')
  assert.equal(sidebarHiddenState.find((view) => view.surface === 'sidebar').bounds.width, 0, 'the hidden sidebar has no native hit-test strip')
  assert.ok(sidebarHiddenState.find((view) => view.surface === 'toolbar').index > sidebarHiddenState.find((view) => view.url === fixtureUrl).index, 'the toolbar is layered above the live page')
  assert.ok(sidebarHiddenState.find((view) => view.surface === 'sidebar').index > sidebarHiddenState.find((view) => view.url === fixtureUrl).index, 'the sidebar is layered above the live page')
  captureFullWindow('sidebar-overlay-live-page-hidden.png')

  for (const selector of ['.tabs-sidebar-button', '.toolbar-brand']) {
    const hoverRect = await evaluate(rendererViews.toolbar, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
    const hoverPoint = screenPointForElement(rendererViews.toolbar, hoverRect)
    pointerMove(hoverPoint.x, hoverPoint.y)
    await delay(350)
    assert.equal(rendererViews.sidebar.getBounds().width, 0, `hovering ${selector} must not open or reset the sidebar`)
  }

  // A click inside the former 14px reveal strip must still reach the full-width live page.
  const edgePoint = { x: mainWindow.getContentBounds().x + 5, y: mainWindow.getContentBounds().y + pageHiddenSidebar.y + 245 }
  pointerClick(edgePoint.x, edgePoint.y)
  await waitFor(() => fixturePageView.webContents.executeJavaScript('window.edgeClickCount || 0'), 'the page click at the leftmost edge')
  await delay(250)
  assert.equal(await fixturePageView.webContents.executeJavaScript('window.edgeClickCount'), 1, 'the hidden sidebar must not intercept a click at x=5')
  assert.equal(rendererViews.sidebar.getBounds().width, 0, 'a click cancels the delayed hover reveal and leaves the page unobstructed')

  // The single top-toolbar Tabs control opens and pins the glass sidebar with native mouse input.
  await clickElement(rendererViews.toolbar, '.tabs-sidebar-button')
  await waitFor(() => rendererViews.sidebar.getBounds().width === Math.min(320, contentSize[0]), 'the pinned sidebar overlay to expand')
  await waitFor(() => evaluate(rendererViews.toolbar, 'document.querySelector(".browser-layout")?.classList.contains("is-sidebar-visible")'), 'shared visible sidebar state on the toolbar')
  await delay(300)

  // Keep the native view temporarily wide enough to capture pointer motion after the panel edge moves.
  const resizeRect = await evaluate(rendererViews.sidebar, `(() => { const r = document.querySelector('.sidebar-resize-handle').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`)
  const resizeStart = screenPointForElement(rendererViews.sidebar, resizeRect)
  const widthBeforeResize = rendererViews.sidebar.getBounds().width
  const widthAfterResize = Math.min(392, contentSize[0])
  pointerMove(resizeStart.x, resizeStart.y + 100)
  pointerDown(resizeStart.x, resizeStart.y + 100)
  await waitFor(() => rendererViews.sidebar.getBounds().width === Math.min(520, contentSize[0]), 'the native overlay to provide a temporary drag hit-test surface')
  pointerMove(resizeStart.x + widthAfterResize - widthBeforeResize, resizeStart.y + 100)
  await waitFor(() => evaluate(rendererViews.sidebar, `document.querySelector('.sidebar-resize-handle')?.getAttribute('aria-valuenow') === ${JSON.stringify(String(widthAfterResize))}`), 'the sidebar width to follow the captured drag')
  pointerUp()
  await waitFor(() => rendererViews.sidebar.getBounds().width === widthAfterResize, 'the native overlay bounds to match the resized panel')
  await waitFor(async () => (await evaluate(rendererViews.toolbar, 'window.api.browser.preferences.get()')).sidebarWidth === widthAfterResize, 'the resized sidebar width to persist')

  const pageVisibleSidebar = fixturePageView.getBounds()
  const sidebarView = rendererViews.sidebar.getBounds()
  assert.equal(pageVisibleSidebar.x, 0, 'opening the sidebar must not inset the page')
  assert.equal(pageVisibleSidebar.width, contentSize[0], 'opening the sidebar must not narrow the page')
  assert.equal(sidebarView.width, widthAfterResize)
  assert.equal(sidebarView.y, 0, 'the sidebar starts at the top edge of the window')
  assert.equal(sidebarView.height, contentSize[1], 'the sidebar covers the full window height')
  captureFullWindow('sidebar-overlay-live-page-visible.png')
  // This is an authentic app-window capture over the harness's loopback-only synthetic page.
  captureFullWindow('surffish-current-app.png')

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

  // The pin control now lives in the sidebar footer: ensure it is unpinned so the panel auto-hides on pointer exit.
  await evaluate(rendererViews.sidebar, `(() => { const unpin = document.querySelector('[aria-label="Auto-hide sidebar"]'); if (unpin) { unpin.click(); return true; } return Boolean(document.querySelector('[aria-label="Keep sidebar open"]')); })()`)
  await waitFor(() => evaluate(rendererViews.sidebar, 'Boolean(document.querySelector("[aria-label=\\"Keep sidebar open\\"]"))'), 'the sidebar pin control to show unpinned')
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

  // Create and return from the bottom sidebar action to verify the local React surface/tab lifecycle.
  // Hover-reveal the panel (the old toolbar toggle is gone), then pin it open via the footer control.
  assert.ok(await evaluate(rendererViews.content, '(() => { const layout = document.querySelector(".browser-layout"); if (!layout) return false; layout.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 200 })); return true; })()'), 'the browser layout should accept a hover at the reveal edge')
  await clickElement(rendererViews.sidebar, '[aria-label="Keep sidebar open"]')
  await waitFor(() => rendererViews.sidebar.getBounds().width === widthAfterResize, 'the sidebar to open for its bottom New Tab action')
  await waitFor(() => evaluate(rendererViews.sidebar, `(() => {
    const layout = document.querySelector('.browser-layout')
    const sidebar = document.querySelector('.browser-sidebar')
    const button = document.querySelector('.sidebar-new-tab-row')
    if (!layout?.classList.contains('is-sidebar-visible') || !sidebar || !button) return false
    const sidebarRect = sidebar.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    if (Math.abs(sidebarRect.left) > 0.5 || buttonRect.top < 0 || buttonRect.bottom > innerHeight) return false
    const hitTarget = document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2)
    return hitTarget?.closest('.sidebar-new-tab-row') === button
  })()`), 'the sidebar slide-in to finish with the bottom New Tab button hit-testable')
  const priorTabIds = new Set((await evaluate(rendererViews.sidebar, 'window.api.browser.tabs.get()')).map((tab) => tab.id))
  await evaluate(rendererViews.sidebar, `(() => {
    const button = document.querySelector('.sidebar-new-tab-row')
    window.__bottomNewTabClickCount = 0
    button?.addEventListener('click', () => { window.__bottomNewTabClickCount += 1 }, { once: true })
  })()`)
  await clickElement(rendererViews.sidebar, '.sidebar-new-tab-row')
  await waitFor(() => evaluate(rendererViews.sidebar, 'window.__bottomNewTabClickCount === 1'), 'the native pointer click to reach the bottom New Tab button')
  const newTabId = await waitFor(async () => {
    const tabs = await evaluate(rendererViews.sidebar, 'window.api.browser.tabs.get()')
    const active = tabs.find((tab) => tab.active)
    return active && !priorTabIds.has(active.id) ? active.id : null
  }, 'the bottom New Tab action to create and activate a tab')
  assert.ok(newTabId, 'the bottom New Tab control activates its new tab')
  await waitFor(async () => (await evaluate(rendererViews.content, 'window.api.browser.state()')).url.includes('surffish://quick-links'), 'the local New Tab')
  await waitFor(() => rendererViews.content.getVisible() && !rendererViews.toolbar.getVisible() && !rendererViews.sidebar.getVisible(), 'the original full-app surface when the active tab is New Tab')
  // Background tabs are detached from the window (so Chromium throttles them) but stay alive.
  assert.ok(webContents.getAllWebContents().some((contents) => !contents.isDestroyed() && contents.getURL() === fixtureUrl), 'the original live page tab remains alive')
  assert.ok(!mainWindow.contentView.children.some((view) => view.webContents && view.webContents.getURL() === fixtureUrl), 'the background page is detached while New Tab shows')
  assert.equal(await evaluate(rendererViews.content, `(async () => { const tab = (await window.api.browser.tabs.get()).find((candidate) => candidate.url === ${JSON.stringify(fixtureUrl)}); return tab ? window.api.browser.tabs.activate(tab.id) : false })()`), true)
  await waitFor(() => rendererViews.toolbar.getVisible() && !rendererViews.content.getVisible(), 'return to the full-width live page overlay')
  await waitFor(() => fixturePageView.getBounds().width === contentSize[0], 'the full-width page after tab activation')
  assert.match(await fixturePageView.webContents.executeJavaScript('document.cookie'), /surffish-overlay-smoke=cookie-preserved/, 'site cookies remain intact through the New Tab/tab lifecycle')
  captureFullWindow('sidebar-overlay-live-page-restored.png')

  assert.equal(fixturePageView.getBounds().x, 0)
  assert.equal(fixturePageView.getBounds().width, contentSize[0])
  console.log(`BaseWindow app integration passed: initial shell views=${initialShell.length}; resized live page x=${fixturePageView.getBounds().x}, width=${fixturePageView.getBounds().width}/${contentSize[0]}; persisted sidebar width=${sidebarView.width}; last-tab Command-W keeps the window open, Command-T focuses the address bar, and hover stability, pointer resize/persistence, x=5 click-through, overlay page input/wheel, delayed edge reveal, and tab/New Tab lifecycle verified.`)
}

async function cleanup() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await delay(300)
    if (!mainWindow.isDestroyed()) mainWindow.destroy()
  }
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
