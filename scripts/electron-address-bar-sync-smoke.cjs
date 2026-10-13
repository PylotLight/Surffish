// Integration smoke for the address bar following the active tab: after the bar was focused (so
// the toolbar document's activeElement is the input) and focus moved to the page, pushState,
// replaceState, hash changes and server redirects still reach the bar. A focused-but-untouched bar
// follows the tab too; half-typed text survives until Esc. Runs the production build:
// `bun run build && bun run test:electron-address-bar-sync`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-address-bar-sync-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-address-sync-smoke-${process.pid}`)

const server = createServer((request, response) => {
  const path = (request.url || '/').split('?')[0]
  if (path === '/login') {
    response.writeHead(302, { Location: '/app/projects', 'Cache-Control': 'no-store' })
    response.end()
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>${path}</title><body><input id="field"><h1>${path}</h1></body>`)
})

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
  const origin = `http://127.0.0.1:${server.address().port}`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/auth`], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar').webContents
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const state = () => evaluate(toolbar, 'window.api.browser.state()')
  await waitFor(async () => { const current = await state(); return current.url === `${origin}/auth` && !current.loading }, 'the /auth page')
  const page = await waitFor(() => allWebContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL().startsWith(origin)), 'the page contents')

  const INPUT = 'document.querySelector(".browser-toolbar input[type=text]")'
  const bar = () => evaluate(toolbar, `${INPUT}.value`)
  const expectBar = (path, description) => waitFor(async () => (await bar()) === `${origin}${path}`, `${description}: bar shows ${path}`).catch(async (error) => {
    throw new Error(`${error.message} — bar actually shows ${JSON.stringify(await bar())}`)
  })
  const focusBar = async () => {
    toolbar.focus()
    await evaluate(toolbar, `(() => { ${INPUT}.focus(); ${INPUT}.select() })()`)
    await waitFor(() => evaluate(toolbar, `document.activeElement === ${INPUT} && document.hasFocus()`), 'the focused address bar')
  }
  const focusPage = async () => {
    page.focus()
    await waitFor(() => evaluate(toolbar, '!document.hasFocus()'), 'focus to leave the toolbar view')
    // The bug's precondition: Chromium keeps the input as activeElement once its view loses focus.
    assert.equal(await evaluate(toolbar, `document.activeElement === ${INPUT}`), true, 'activeElement sticks to the input')
  }

  await expectBar('/auth', 'start')

  // --- focus the bar, click into the page, then the page navigates on its own (the stuck case)
  await focusBar()
  await focusPage()
  await evaluate(page, 'history.pushState(null, "", "/app/chat"); 1')
  await expectBar('/app/chat', 'pushState with focus on the page')
  await evaluate(page, 'history.replaceState(null, "", "/app/chat?tab=2"); 1')
  await expectBar('/app/chat?tab=2', 'replaceState')
  await evaluate(page, 'location.hash = "#projects"; 1')
  await expectBar('/app/chat?tab=2#projects', 'hash change')
  await evaluate(page, 'location.href = "/login"; 1')
  await expectBar('/app/projects', 'server redirect')

  // --- the bar is focused (and its view too) but untouched: it still follows the tab
  await focusBar()
  await evaluate(page, 'history.pushState(null, "", "/app/settings"); 1')
  await expectBar('/app/settings', 'pushState while the bar is focused but untouched')
  assert.equal(await evaluate(toolbar, `${INPUT}.selectionStart === 0 && ${INPUT}.selectionEnd === ${INPUT}.value.length`), true, 'the new URL stays fully selected')

  // --- half-typed text survives navigations while typing; Esc goes back to the tab URL
  toolbar.insertText('half typed')
  await waitFor(async () => (await bar()) === 'half typed', 'the typed text')
  await evaluate(page, 'history.pushState(null, "", "/app/typing"); 1')
  await delay(400)
  assert.equal(await bar(), 'half typed', 'typing is not overwritten')
  toolbar.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  toolbar.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await expectBar('/app/typing', 'Esc')

  // --- typed text left behind gives way to the next navigation once the user is in the page
  toolbar.insertText('left behind')
  await waitFor(async () => (await bar()) === 'left behind', 'the typed text')
  await focusPage()
  await delay(200)
  assert.equal(await bar(), 'left behind', 'clicking away keeps typed text (Chrome does too)')
  await evaluate(page, 'history.pushState(null, "", "/app/after"); 1')
  await expectBar('/app/after', 'navigation after leaving typed text')

  // --- a new tab opened on a URL keeps focus on its page; only a blank New Tab focuses the bar
  // (It used to focus the bar too, flashing its suggestions, until the page took focus back on load.)
  await focusPage()
  await evaluate(toolbar, `(() => { window.__barFocuses = 0; ${INPUT}.addEventListener('focus', () => { window.__barFocuses++ }); return 1 })()`)
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/opened`)})`)
  const opened = await waitFor(() => allWebContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL() === `${origin}/opened` && !contents.isLoading()), 'the tab opened on a URL')
  await waitFor(() => opened.isFocused(), 'focus in the page opened in a new tab')
  await delay(300)
  assert.equal(await evaluate(toolbar, 'window.__barFocuses'), 0, 'a tab opened on a URL never focuses the address bar')
  await evaluate(toolbar, 'window.api.browser.tabs.create()')
  // On the New Tab page the content surface draws the address bar.
  const content = surface('content').webContents
  await waitFor(() => evaluate(content, 'document.hasFocus() && document.activeElement?.tagName === "INPUT"'), 'a blank New Tab focuses the address bar')

  console.log('Address bar sync smoke passed.')
}

run().then(() => {
  server.close()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  server.close()
  app.exit(1)
})
