// Integration smoke for the perceived-speed pair:
//  1. Wake snapshots: a tab that went to sleep shows its last picture at once when opened again
//     (drawn by the toolbar surface stretched over the page area), the picture is still up while
//     the page's response is held back, then it is taken down once the page has painted and the
//     toolbar view shrinks back. A press on the picture goes to the page (never to the picture)
//     and takes it down at once.
//  2. Speculative preconnect: typing in the address bar preconnects the top suggestion's origin
//     once, ~150 ms after the last keystroke (nothing while typing, nothing for one character,
//     nothing twice in the cooldown, only the engine origin for a search); resting on a link for
//     ~200 ms preconnects its origin; the Settings toggle turns both off; private tabs never do.
// Runs the production build: `bun run build && bun run test:electron-perceived-perf`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-perceived-perf-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, session, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-perceived-perf-smoke-${process.pid}`)

// Response delay for the next /wake load (ms), so the reload is slow enough to watch.
let wakeDelayMs = 0
let wakeServedAt = 0
let linkOrigin = ''
const server = createServer((request, response) => {
  const name = (request.url || '/').slice(1).replace(/[^\w-]/g, '') || 'root'
  const send = () => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    if (name === 'wake') {
      wakeServedAt = Date.now()
      response.end('<!doctype html><meta charset="utf-8"><title>Fixture wake</title><body style="margin:0;background:#c81e1e;color:#fff;font:48px sans-serif"><h1 style="margin:40px">Wake me</h1></body>')
    } else if (name === 'links') {
      response.end(`<!doctype html><meta charset="utf-8"><title>Fixture links</title><body style="margin:0;font:20px sans-serif">
        <a id="one" href="${linkOrigin}/one" style="position:absolute;left:40px;top:40px;display:block;width:300px;height:60px;background:#eef">one</a>
        <a id="two" href="${linkOrigin.replace('localhost', '127.0.0.2')}/two" style="position:absolute;left:40px;top:160px;display:block;width:300px;height:60px;background:#efe">two</a>
      </body>`)
    } else {
      response.end(`<!doctype html><meta charset="utf-8"><title>Fixture ${name}</title><p>${name}</p>`)
    }
  }
  if (name === 'wake' && wakeDelayMs > 0) {
    const delayMs = wakeDelayMs
    wakeDelayMs = 0
    setTimeout(send, delayMs)
  } else {
    send()
  }
})

let mainWindow
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function waitFor(predicate, description, timeout = smoke.waitMs, interval = 25) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(interval)
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

async function evaluate(target, expression, userGesture = false) {
  const contents = target.webContents ?? target
  try {
    return await contents.executeJavaScript(expression, userGesture)
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
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`
  linkOrigin = `http://localhost:${port}`
  const url = (name) => `${origin}/${name}`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [url('wake')], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()

  // Every page session shares Session's prototype: record preconnects (and still make them).
  const preconnects = []
  const sessionProto = Object.getPrototypeOf(session.defaultSession)
  const realPreconnect = sessionProto.preconnect
  sessionProto.preconnect = function recordPreconnect(options) {
    preconnects.push({ url: options.url, numSockets: options.numSockets, at: Date.now(), storagePath: this.storagePath ?? null })
    return realPreconnect.call(this, options)
  }

  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('toolbar'), 'the toolbar surface')
  const toolbarView = surface('toolbar')
  const toolbar = toolbarView.webContents
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const tabs = () => evaluate(toolbar, 'window.api.browser.tabs.get()')
  const tabFor = async (name) => (await tabs()).find((tab) => tab.url === url(name))
  await waitFor(async () => (await tabFor('wake'))?.title === 'Fixture wake', 'the wake tab')
  const pageFor = (name) => allWebContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL() === url(name))
  // Let the first page settle and paint so the switch-away capture has pixels.
  await waitFor(() => pageFor('wake') && !pageFor('wake').isLoading(), 'the wake page to finish loading')
  await delay(600)
  const contentHeight = () => mainWindow.getContentSize()[1]

  const snapshotState = () => evaluate(toolbar, `(() => {
    const image = document.querySelector('img.wake-snapshot')
    return image ? { src: image.src.slice(0, 23), opacity: getComputedStyle(image).opacity, rect: image.getBoundingClientRect().toJSON() } : null
  })()`)

  /** Front tab on screen, wake tab asleep. */
  async function sendWakeTabToSleep() {
    const front = await tabFor('front')
    if (front) await evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(front.id)})`)
    else await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(url('front'))})`)
    await waitFor(async () => (await tabFor('front'))?.active && (await tabFor('front')).title === 'Fixture front', 'the front tab')
    // The switch-away capture is async (capturePage + encode).
    await delay(500)
    // Hibernate Tab (the same path the memory saver discards through).
    assert.equal(await evaluate(toolbar, `window.api.browser.diagnostics.discardTab(${JSON.stringify((await tabFor('wake')).id)})`), true)
    await waitFor(async () => (await tabFor('wake'))?.sleeping, 'the wake tab to sleep')
    assert.equal(pageFor('wake'), undefined, 'the sleeping tab has no page')
  }

  // ---------------------------------------------------------------- 1. wake snapshot, shown then removed
  smoke.step('wake snapshot: shown at once, held while the page loads, removed after paint')
  await sendWakeTabToSleep()
  const toolbarHeightBefore = toolbarView.getBounds().height
  assert.ok(toolbarHeightBefore < contentHeight() / 2, `the toolbar view is its own height before (${toolbarHeightBefore})`)
  wakeDelayMs = 2500
  wakeServedAt = 0
  const activatedAt = Date.now()
  await evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify((await tabFor('wake')).id)})`)
  const shown = await waitFor(() => snapshotState(), 'the wake snapshot to show', 2400, 10)
  const shownAt = Date.now()
  assert.equal(shown.src, 'data:image/jpeg;base64,', 'the snapshot is an in-memory JPEG')
  assert.ok(shown.rect.width > 600 && shown.rect.height > 400, `the snapshot covers the page area (${JSON.stringify(shown.rect)})`)
  assert.equal(wakeServedAt, 0, 'the snapshot showed before the page had even been served')
  assert.ok(shownAt - activatedAt < 2000, `the snapshot showed promptly (${shownAt - activatedAt} ms)`)
  assert.equal(toolbarView.getBounds().height, contentHeight(), 'the toolbar view covers the window while the snapshot shows')
  // A press in the page area lands on the transparent shell layers (so it goes to the page), never on toolbar UI.
  const hit = await evaluate(toolbar, `(() => { const r = document.querySelector('img.wake-snapshot').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? { tag: e.tagName, id: e.id, cls: String(e.className) } : null })()`)
  assert.ok(!hit || hit.tag === 'HTML' || hit.tag === 'BODY' || hit.id === 'root' || /app-shell|browser-layout|browser-main/.test(hit.cls), `the page area of the toolbar surface is only shell layers (hit ${JSON.stringify(hit)})`)
  await delay(500)
  assert.ok(await snapshotState(), 'the snapshot is still up while the response is held back')
  await waitFor(() => wakeServedAt > 0, 'the wake page to be served')
  await waitFor(async () => (await snapshotState()) === null, 'the snapshot to be removed after the page painted', 10000, 10)
  const removedAt = Date.now()
  assert.ok(removedAt >= wakeServedAt, 'removed only after the page arrived')
  assert.ok(removedAt - wakeServedAt < 4000, `removed soon after the page arrived (${removedAt - wakeServedAt} ms)`)
  await waitFor(() => toolbarView.getBounds().height === toolbarHeightBefore, `the toolbar view to shrink back (now ${toolbarView.getBounds().height})`, 3000)
  assert.equal((await tabFor('wake')).title, 'Fixture wake')
  console.log(`[perceived-perf] snapshot shown after ${shownAt - activatedAt} ms, page served ${wakeServedAt - activatedAt} ms, removed ${removedAt - activatedAt} ms after the switch`)

  // ---------------------------------------------------------------- 1b. input goes to the page, never the picture
  smoke.step('wake snapshot: a press on the picture goes to the page and takes it down')
  await sendWakeTabToSleep()
  wakeDelayMs = 4000
  await evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify((await tabFor('wake')).id)})`)
  const pressed = await waitFor(() => snapshotState(), 'the wake snapshot to show again', 3000, 10)
  // The woken tab's new view sits at the bottom of the window (index 0), under every shell surface.
  const shellIds = new Set(['toolbar', 'sidebar', 'content'].map((name) => surface(name)?.webContents.id))
  const bottom = mainWindow.contentView.children[0]
  const waking = bottom?.webContents && !shellIds.has(bottom.webContents.id) ? bottom.webContents : null
  assert.ok(waking, 'the waking page view is attached under the snapshot')
  const pageInputs = []
  const onInput = (_event, input) => { if (input.type === 'mouseDown' || input.type === 'mouseUp') pageInputs.push(input.type) }
  waking.on('input-event', onInput)
  const x = Math.round(pressed.rect.left + 200)
  const y = Math.round(pressed.rect.top + 200)
  const pressAt = Date.now()
  toolbar.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  toolbar.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await waitFor(async () => (await snapshotState()) === null, 'the press to take the snapshot down', 2000, 10)
  assert.ok(Date.now() - pressAt < 1500, `taken down at once (${Date.now() - pressAt} ms), not after the 4 s load`)
  await waitFor(() => pageInputs.includes('mouseDown') && pageInputs.includes('mouseUp'), `the press and release to reach the page (got ${JSON.stringify(pageInputs)})`, 3000)
  await waitFor(() => toolbarView.getBounds().height === toolbarHeightBefore, 'the toolbar view to shrink back after the press', 3000)
  waking.off('input-event', onInput)
  await waitFor(async () => (await tabFor('wake'))?.title === 'Fixture wake' && !(await tabFor('wake')).loading, 'the slow wake page to finish', 15000)

  // ---------------------------------------------------------------- 2. preconnect while typing
  smoke.step('preconnect: typing debounced to one origin preconnect')
  const INPUT = 'document.querySelector(".browser-toolbar input[type=text]")'
  const focusBar = async () => {
    toolbar.focus()
    await evaluate(toolbar, `(() => { ${INPUT}.focus(); ${INPUT}.select() })()`)
    await waitFor(() => evaluate(toolbar, `document.activeElement === ${INPUT} && document.hasFocus()`), 'the focused address bar')
  }
  const blurBar = async () => {
    await evaluate(toolbar, `(() => { ${INPUT}.blur(); return true })()`)
    await delay(200)
  }
  await focusBar()
  preconnects.length = 0
  // One character: never.
  await toolbar.insertText('F')
  await delay(450)
  assert.equal(preconnects.length, 0, `one typed character never preconnects (${JSON.stringify(preconnects)})`)
  // Keep typing faster than the debounce: nothing until it goes quiet, then exactly one.
  let lastKeyAt = Date.now()
  for (const piece of ['i', 'x', 't', 'u', 'r', 'e']) {
    await toolbar.insertText(piece)
    const gap = Date.now() - lastKeyAt
    lastKeyAt = Date.now()
    await delay(50)
    // Only meaningful while keys really come faster than the debounce (a loaded CI pod can stall).
    if (gap < 100 && Date.now() - lastKeyAt < 100) assert.equal(preconnects.length, 0, 'nothing while typing faster than the debounce')
  }
  await waitFor(() => preconnects.length > 0, 'a preconnect after typing stops', 3000, 10)
  const typed = preconnects[0]
  assert.ok(typed.at - lastKeyAt >= 120, `debounced (${typed.at - lastKeyAt} ms after the last key)`)
  assert.equal(typed.url, origin, `the top suggestion's origin only (got ${typed.url})`)
  assert.equal(typed.numSockets, 1)
  await delay(500)
  assert.equal(preconnects.length, 1, `exactly one preconnect (${JSON.stringify(preconnects.map((p) => p.url))})`)
  // More typing toward the same origin inside the cooldown: no second socket.
  await toolbar.insertText(' w')
  await delay(500)
  assert.equal(preconnects.length, 1, 'the same origin is not preconnected again inside the cooldown')

  smoke.step('preconnect: a search query reaches only the engine origin')
  await focusBar()
  await toolbar.insertText('zqxj vbnm kwpt')
  await waitFor(() => preconnects.length > 1, 'a preconnect for the search query', 3000, 10)
  const search = new URL(preconnects[1].url)
  assert.equal(search.pathname, '/', 'only an origin is preconnected for a search')
  assert.equal(preconnects[1].url, search.origin, `no query text leaves as a URL (${preconnects[1].url})`)
  assert.ok(!preconnects.some((p) => p.url.includes('zqxj')), 'the search text never appears in a preconnect')
  await blurBar()

  // ---------------------------------------------------------------- 3. preconnect on link hover
  smoke.step('preconnect: resting on a link preconnects its origin after ~200 ms')
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(url('links'))})`)
  await waitFor(async () => (await tabFor('links'))?.title === 'Fixture links' && !(await tabFor('links')).loading, 'the links page')
  const links = await waitFor(() => pageFor('links'), 'the links page contents')
  await delay(300)
  const before = preconnects.length
  links.sendInputEvent({ type: 'mouseMove', x: 120, y: 70 })
  await delay(80)
  assert.equal(preconnects.length, before, 'no preconnect before the dwell time')
  await waitFor(() => preconnects.length > before, 'a hover preconnect', 3000, 10)
  assert.equal(preconnects[before].url, linkOrigin, `the link's origin (${preconnects[before].url})`)

  smoke.step('preconnect: the Settings toggle turns it off')
  const off = await evaluate(toolbar, 'window.api.browser.preconnect.set({ enabled: false })')
  assert.equal(off.enabled, false)
  const beforeOff = preconnects.length
  links.sendInputEvent({ type: 'mouseMove', x: 400, y: 400 })
  await delay(100)
  links.sendInputEvent({ type: 'mouseMove', x: 120, y: 190 })
  await delay(600)
  assert.equal(preconnects.length, beforeOff, 'no hover preconnect with the setting off')
  await focusBar()
  await toolbar.insertText('example.org')
  await delay(500)
  assert.equal(preconnects.length, beforeOff, 'no typing preconnect with the setting off')
  await blurBar()
  const on = await evaluate(toolbar, 'window.api.browser.preconnect.set({ enabled: true })')
  assert.equal(on.enabled, true)
  assert.equal((await evaluate(toolbar, 'window.api.browser.preconnect.get()')).enabled, true, 'the choice is read back')

  smoke.step('preconnect: never from a private tab')
  await evaluate(toolbar, `window.api.browser.tabs.createPrivate(${JSON.stringify(url('private'))})`)
  await waitFor(async () => (await tabs()).some((tab) => tab.active && tab.private && tab.title === 'Fixture private'), 'the private tab')
  const beforePrivate = preconnects.length
  await focusBar()
  await toolbar.insertText('example.net')
  await delay(600)
  assert.equal(preconnects.length, beforePrivate, `no preconnect from a private tab (${JSON.stringify(preconnects.slice(beforePrivate))})`)
  await blurBar()

  console.log(`[perceived-perf] preconnects: ${preconnects.map((p) => p.url).join(', ')}`)
  console.log('Perceived-speed smoke passed: wake snapshot shown then removed (and input goes to the page), preconnect debounced, deduped, origin-only, toggle and private respected.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron perceived-perf smoke failed:', error)
  app.exit(1)
})
