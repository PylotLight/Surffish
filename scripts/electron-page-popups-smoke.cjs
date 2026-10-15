// Integration smoke for script popups (sign-in windows), modelled on Disqus's embed login:
// a cross-site iframe calls window.open(loginUrl, '_blank', 'width=…,height=…') from its Login
// button; the popup posts the result back to window.opener (the iframe) and shares the iframe's
// third-party cookies. Checked against the production build:
//   - with no click/key press behind it, the popup stays blocked (no window)
//   - after a click it opens as a real popup window (not a tab) with window.opener intact,
//     postMessage reaches the iframe, the popup sees the cookie the iframe set
//   - the Disqus analytics beacon (juggler/event.js) being blocked by the ad filter doesn't matter
//   - one click buys one popup; Ctrl/Cmd+W in the popup closes the popup, not the tab
//   - closing the opener's tab closes its popup
// `bun run build && bun run test:electron-page-popups`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-page-popups-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, BrowserWindow, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-page-popups-smoke-${process.pid}`)

// The embed: "localhost" is a different site from the page's 127.0.0.1, so it is a cross-site
// (out-of-process) iframe, like disqus.com inside a blog.
const frameServer = createServer((request, response) => {
  const path = (request.url || '/').split('?')[0]
  if (path === '/juggler/event.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' })
    return response.end('/* beacon */')
  }
  if (path === '/login') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    return response.end(`<!doctype html><title>Log in</title><h1>Log in</h1><script>
      window.report = () => {
        const result = { type: 'login', hasOpener: Boolean(window.opener), cookie: document.cookie }
        if (window.opener) window.opener.postMessage(JSON.stringify(result), '*')
        return result
      }
      report()
    </script>`)
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Set-Cookie': 'dq_session=embed-cookie; SameSite=None; Secure; Path=/'
  })
  response.end(`<!doctype html><title>Embed</title><button id="login">Log in</button><script>
    window.messages = []
    window.addEventListener('message', (event) => { try { window.messages.push(JSON.parse(event.data)) } catch {} })
    window.beacon = 'none'
    window.openLogin = () => {
      fetch('/juggler/event.js?type=openLogin').then(() => { window.beacon = 'ok' }, () => { window.beacon = 'blocked' })
      const opened = window.open(location.origin + '/login?forum=smoke', '_blank', 'width=478,height=590,left=100,top=100,location=1,status=1,resizable=1,scrollbars=1')
      if (opened) window.popup = opened
      return Boolean(opened)
    }
    document.getElementById('login').onclick = () => window.openLogin()
  </script>`)
})
let frameOrigin = ''
const pageServer = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end((request.url || '/').startsWith('/post')
    ? `<!doctype html><title>Blog post</title><h1 style="margin:0;height:60px">Blog post</h1><iframe id="comments" src="${frameOrigin}/embed" style="width:600px;height:200px;border:0"></iframe>`
    : '<!doctype html><title>Start</title><h1>Start</h1>')
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
const popupWindows = () => BrowserWindow.getAllWindows().filter((window) => window instanceof BrowserWindow && !window.isDestroyed() && window.webContents.getURL().startsWith(`${frameOrigin}/login`))

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  // The ad filter blocks Disqus's analytics beacon, as uBO's lists do.
  const blocker = ElectronBlocker.parse('/juggler/event.js', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => frameServer.listen(0, '127.0.0.1', resolvePromise))
  frameOrigin = `http://localhost:${frameServer.address().port}`
  await new Promise((resolvePromise) => pageServer.listen(0, '127.0.0.1', resolvePromise))
  const fixtureUrl = `http://127.0.0.1:${pageServer.address().port}/post`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [fixtureUrl, `http://127.0.0.1:${pageServer.address().port}/start`], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()

  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  await waitFor(() => smoke.evaluate(toolbar.webContents, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const state = () => smoke.evaluate(toolbar.webContents, 'window.api.browser.state()')
  const tabs = () => smoke.evaluate(toolbar.webContents, 'window.api.browser.tabs.get()')
  const closeTab = (id) => smoke.evaluate(toolbar.webContents, `window.api.browser.tabs.close(${JSON.stringify(id)})`)

  await waitFor(async () => { const current = await state(); return current.url === fixtureUrl && !current.loading }, 'the fixture page')
  const fixture = await waitFor(() => pageContents((url) => url === fixtureUrl), 'the fixture page contents')
  const embedFrame = () => fixture.mainFrame.framesInSubtree.find((frame) => frame.url.startsWith(`${frameOrigin}/embed`))
  await waitFor(async () => embedFrame() && await embedFrame().executeJavaScript('typeof window.openLogin === "function"'), 'the cross-site embed iframe')
  assert.notEqual(embedFrame().processId, fixture.mainFrame.processId, 'the embed is an out-of-process (cross-site) iframe')
  const embed = (code) => embedFrame().executeJavaScript(code, true)
  const tabCount = (await tabs()).length
  // A real click on the page: main sees it as before-mouse-event, the user activation Chrome keys popups on.
  const clickPage = async () => {
    fixture.sendInputEvent({ type: 'mouseDown', x: 400, y: 20, button: 'left', clickCount: 1 })
    fixture.sendInputEvent({ type: 'mouseUp', x: 400, y: 20, button: 'left', clickCount: 1 })
    await delay(150)
  }

  smoke.step('popup with no click behind it stays blocked')
  assert.equal(await embed('window.openLogin()'), false, 'window.open returns null without a click')
  await delay(400)
  assert.equal(popupWindows().length, 0, 'no popup window')
  assert.equal((await tabs()).length, tabCount, 'and no tab')

  smoke.step('Login click opens a popup window with window.opener')
  await clickPage()
  assert.equal(await embed('window.openLogin()'), true, 'window.open returns the popup after a click')
  const popup = await waitFor(() => popupWindows()[0], 'the login popup window')
  await waitFor(() => smoke.evaluate(popup.webContents, 'document.readyState === "complete"'), 'the login page to load')
  const [width, height] = popup.getContentSize()
  assert.ok(Math.abs(width - 478) <= 2 && Math.abs(height - 590) <= 2, `popup is sized from its features (got ${width}x${height})`)
  assert.equal(popup.webContents.session, fixture.session, 'the popup runs in the opener session')
  assert.equal((await tabs()).length, tabCount, 'the popup is a window, not a tab')
  assert.equal(await smoke.evaluate(popup.webContents, 'Boolean(window.opener)'), true, 'window.opener is intact')
  const message = await waitFor(async () => (await embed('window.messages'))[0], 'the popup\'s postMessage to reach the embed iframe')
  assert.deepEqual(message, { type: 'login', hasOpener: true, cookie: 'dq_session=embed-cookie' }, 'the popup shares the embed\'s third-party cookie and reports back')
  assert.equal(await waitFor(() => embed('window.beacon !== "none" && window.beacon'), 'the analytics beacon to settle'), 'blocked', 'the ad filter still blocks the analytics beacon, and login works anyway')
  assert.equal(await embed('Boolean(window.popup && !window.popup.closed)'), true, 'the embed holds a live handle to its popup')

  smoke.step('one click buys one popup')
  assert.equal(await embed('window.openLogin()'), false, 'a second window.open off the same click is blocked')
  await delay(300)
  assert.equal(popupWindows().length, 1)

  smoke.step('Ctrl/Cmd+W in the popup closes the popup, not the tab')
  popup.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
  await waitFor(() => popup.isDestroyed(), 'the popup to close')
  await waitFor(() => embed('window.popup.closed'), 'the embed to see its popup closed')
  assert.equal((await tabs()).length, tabCount, 'the tab is still open')
  assert.equal((await state()).url, fixtureUrl)

  smoke.step('closing the opener tab closes its popup')
  await clickPage()
  assert.equal(await embed('window.openLogin()'), true)
  const second = await waitFor(() => popupWindows()[0], 'a second login popup')
  const fixtureTab = (await tabs()).find((tab) => tab.url === fixtureUrl)
  await closeTab(fixtureTab.id)
  await waitFor(() => second.isDestroyed(), 'the popup to close with its opener tab')

  console.log('Page popups smoke passed.')
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
