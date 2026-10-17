// Integration smoke: the menu bar popout's strip stays still over an idle chat app, against the
// production build. One tab (a Hark-like chat SPA) in the menu bar popout, sitting idle while it does
// what such apps do in the background without the user touching anything:
//   - a WebSocket open the whole time, pinged every 500 ms;
//   - a hidden iframe (auth refresh / analytics) reloaded every 1.5 s, each load ~400 ms on the wire;
//   - the same document.title re-set every 250 ms, and its icon <link>s (several sizes) re-added;
//   - a requestAnimationFrame-driven CSS animation and a backdrop-filter bar right under the strip;
//   - a long-poll fetch that is always pending.
// Nothing the strip shows changes, so it must get: zero DOM writes (body classes included: the
// popout's accent loading line is a class), zero state pushes, zero setBounds / setVisible /
// addChildView / removeChildView / setBackgroundColor / setOpacity on any window or view, and no
// header reload. Then the header debug log (SURFFISH_DEBUG_HEADER=1) is checked to hold the events
// a real change writes (a retitle: one push, one DOM write).
// `bun run build && bun run test:electron-mini-window-popout-idle`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-popout-idle-smoke.cjs`).
process.env.SURFFISH_DEBUG_HEADER = '1'
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createHash } = require('node:crypto')
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, View, WebContentsView, webContents: allWebContents } = require('electron')
// Turning the trace off shows the log in Finder / the file manager: not on a CI runner.
let revealed = 0
require('electron').shell.showItemInFolder = () => { revealed += 1 }
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-mini-window-popout-idle-smoke-${process.pid}`)
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 8l14-7-4 14-3-5z" fill="#111"/></svg>'
const PAGE = `<!doctype html><meta charset="utf-8"><link rel="icon" sizes="32x32" href="/icon.svg"><link rel="icon" sizes="16x16" href="/icon.svg?16"><link rel="apple-touch-icon" href="/icon.svg?180"><title>Chat · Hark</title>
<style>
  body { margin: 0; height: 100vh; background: linear-gradient(160deg, #9cc3f0, #4f7fbf); font: 14px system-ui; }
  #nav { position: fixed; top: 0; left: 0; right: 0; height: 60px; backdrop-filter: blur(18px) saturate(1.4); background: rgba(255,255,255,.35); }
  #blob { position: absolute; top: 20px; left: 40px; width: 120px; height: 120px; border-radius: 50%; background: #fff8; filter: blur(30px); }
  #input { position: fixed; bottom: 16px; left: 16px; right: 16px; height: 48px; border-radius: 24px; background: #fffc; }
</style>
<body><div id="blob"></div><div id="nav">Home · Chat · Projects</div><div id="input" contenteditable="true"></div>
<iframe id="frame" hidden src="/frame"></iframe><script>
window.loadId = Math.random()
window.stats = { wsPings: 0, frameLoads: 0, titleSets: 0, frames: 0 }
window.startIdle = () => {
  const ws = new WebSocket('ws://' + location.host + '/ws')
  ws.onmessage = () => { window.stats.wsPings += 1 }
  window.ws = ws
  window.wsTimer = setInterval(() => { if (ws.readyState === 1) ws.send('ping') }, 500)
  const frame = document.getElementById('frame')
  frame.addEventListener('load', () => { window.stats.frameLoads += 1 })
  let n = 0
  window.frameTimer = setInterval(() => { frame.src = '/frame?' + (++n) }, 1500)
  window.titleTimer = setInterval(() => {
    document.title = 'Chat · Hark'
    window.stats.titleSets += 1
    for (const link of [...document.querySelectorAll('link[rel~=icon]')]) { const again = link.cloneNode(); link.remove(); document.head.append(again) }
  }, 250)
  const blob = document.getElementById('blob')
  const tick = (t) => { window.stats.frames += 1; blob.style.transform = 'translateX(' + Math.round(40 * Math.sin(t / 400)) + 'px)'; window.raf = requestAnimationFrame(tick) }
  window.raf = requestAnimationFrame(tick)
  const poll = () => fetch('/poll').then((r) => r.text()).then(poll, () => setTimeout(poll, 500))
  poll()
  return true
}
window.stopIdle = () => { clearInterval(window.wsTimer); clearInterval(window.frameTimer); clearInterval(window.titleTimer); cancelAnimationFrame(window.raf); try { window.ws.close() } catch {} ; return window.stats }
</script></body>`

let slowChat = false
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/chat' && slowChat) {
    // A real reload of the page: its main frame takes a while.
    slowChat = false
    setTimeout(() => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(PAGE) }, 900)
    return
  }
  if (path === '/icon.svg') {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
      response.end(ICON)
    }, 120)
    return
  }
  if (path === '/frame') {
    // A real auth/analytics frame is a network round trip or two away.
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
      response.end('<!doctype html><title>frame</title><p>ok</p>')
    }, 400)
    return
  }
  if (path === '/poll') {
    // Long poll: answered after 4 s, then asked again.
    const timer = setTimeout(() => { response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end('{}') }, 4000)
    request.on('close', () => clearTimeout(timer))
    return
  }
  const body = path === '/start' ? '<!doctype html><title>Start</title><p>start</p>' : path === '/chat' ? PAGE : null
  response.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(body ?? 'not found')
})
// A minimal WebSocket echo (text frames, client → server masked): enough for a ping/pong.
server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key']
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  socket.on('data', (buffer) => {
    if ((buffer[0] & 0x0f) === 0x8) return socket.end()
    socket.write(Buffer.from([0x81, 4, ...Buffer.from('pong')]))
  })
  socket.on('error', () => {})
})

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
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}

const liveContents = () => allWebContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
const pageContents = (predicate) => liveContents().find((contents) => predicate(contents.getURL(), contents))
const isMiniHeader = (contents) => contents.getURL().startsWith('data:text/html') && decodeURIComponent(contents.getURL()).includes('<title>Mini Window</title>')
const allWindows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed())
const miniWindows = () => allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()))
const viewOf = (win, contents) => win.contentView.children.find((view) => view.webContents === contents)
const headerOf = (win) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && isMiniHeader(view.webContents))?.webContents
const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }

// Every native call that could restack, resize, hide or repaint a window or view.
let nativeCalls = []
const watched = [
  [View.prototype, ['setBounds', 'setVisible', 'addChildView', 'removeChildView', 'setBackgroundColor']],
  [BaseWindow.prototype, ['setBounds', 'setBackgroundColor', 'setOpacity', 'setVibrancy', 'setBackgroundMaterial', 'showInactive', 'show', 'hide', 'setAlwaysOnTop', 'setVisibleOnAllWorkspaces', 'setContentView']]
]
for (const [proto, names] of watched) {
  for (const name of names) {
    const original = proto[name]
    if (typeof original !== 'function') continue
    proto[name] = function (...args) {
      nativeCalls.push(`${this.constructor?.name ?? 'view'}.${name}`)
      return original.apply(this, args)
    }
  }
}
void WebContentsView

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/start`], activeIndex: 0 }))
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: 'CommandOrControl+Shift+Space', opacity: 1, tuckToEdge: true, peekOnHover: true, peekDelayMs: 350, grouping: 'tabs', headerPlacement: 'float', menuBarIcon: 'in-use' }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => allWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 700 })
  const surface = (win, name) => win.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && surfaceFor(view) === name)
  await waitFor(() => surface(mainWindow, 'content') && surface(mainWindow, 'toolbar'), 'the renderer surfaces')
  const toolbar = surface(mainWindow, 'toolbar').webContents
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const tabs = () => smoke.evaluate(toolbar, 'window.api.browser.tabs.get()')
  const runCommand = (id) => smoke.evaluate(toolbar, `window.api.browser.commands.run(${JSON.stringify(id)})`)
  const bar = () => globalThis.__surffishMiniMenuBar

  smoke.step('one idle chat tab in the menu bar popout')
  await smoke.evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/chat`)})`)
  const chat = await waitFor(() => pageContents((url, c) => url === `${origin}/chat` && !c.isLoading()), 'the chat page')
  await waitFor(() => smoke.evaluate(chat, 'document.readyState === "complete" && typeof window.loadId === "number"'), 'chat ready')
  const chatId = (await tabs()).find((tab) => tab.url === `${origin}/chat`).id
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(chatId)})`)
  await runCommand('miniWindow.menuBar')
  await waitFor(() => bar()?.exists(), 'the menu bar icon')
  const win = await waitFor(() => miniWindows().find((w) => viewOf(w, chat)), 'chat in the menu bar mini window')
  await waitFor(() => win.isVisible(), 'the popout shows')
  const header = await waitFor(() => headerOf(win), 'the popout strip')
  await waitFor(() => smoke.evaluate(header, 'document.body.classList.contains("popout") && document.getElementById("title").textContent === "Chat · Hark" && !document.getElementById("icon").hidden'), 'the strip shows the chat title and icon')
  // A chat that has been used has history (Back enabled).
  await smoke.evaluate(chat, 'history.pushState(null, "", location.pathname); true')
  await delay(1200)

  let headerReloads = 0
  for (const name of ['did-start-loading', 'did-finish-load', 'dom-ready']) header.on(name, () => { headerReloads += 1 })
  const pageEvents = {}
  for (const name of ['did-start-loading', 'did-stop-loading', 'did-frame-navigate', 'did-frame-finish-load', 'page-title-updated', 'page-favicon-updated', 'did-navigate-in-page']) chat.on(name, () => { pageEvents[name] = (pageEvents[name] ?? 0) + 1 })
  let loadingSamples = { isLoading: 0, isLoadingMainFrame: 0, samples: 0 }
  const sampler = setInterval(() => {
    if (chat.isDestroyed()) return
    loadingSamples.samples += 1
    if (chat.isLoading()) loadingSamples.isLoading += 1
    if (chat.isLoadingMainFrame()) loadingSamples.isLoadingMainFrame += 1
  }, 20)

  await smoke.evaluate(header, `(() => {
    window.__log = { mutations: 0, detail: [] }
    window.__observer = new MutationObserver((records) => { for (const r of records) {
      window.__log.mutations += 1
      if (window.__log.detail.length < 16) window.__log.detail.push(r.type + ' ' + (r.target.id || r.target.nodeName) + ' ' + (r.attributeName || '') + ' ' + (r.attributeName === 'class' ? r.target.className : ''))
    } })
    window.__observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true }); return true })()`)
  let sends = 0
  const send = header.send.bind(header)
  header.send = (channel, ...args) => { if (channel === 'mini-window:state') sends += 1; return send(channel, ...args) }
  const take = async () => {
    const strip = await smoke.evaluate(header, '(() => { const l = window.__log; window.__log = { mutations: 0, detail: [] }; return l })()')
    const counts = {}
    for (const call of nativeCalls) counts[call] = (counts[call] ?? 0) + 1
    const out = { ...strip, sends, native: counts, headerReloads }
    nativeCalls = []
    sends = 0
    headerReloads = 0
    return out
  }
  await take()

  smoke.step('idle: WebSocket pings, hidden frame reloads (~400 ms each), same title + icons re-set, rAF animation, long poll')
  await smoke.evaluate(chat, 'window.startIdle()')
  await delay(6000)
  const stats = await smoke.evaluate(chat, 'window.stopIdle()')
  await delay(700)
  clearInterval(sampler)
  const idle = await take()
  console.log(`[idle] page: ${JSON.stringify(stats)} events: ${JSON.stringify(pageEvents)} loading: ${JSON.stringify(loadingSamples)}`)
  console.log(`[idle] strip: ${JSON.stringify(idle)}`)

  smoke.step('a real retitle: one push, the title written, and the debug log has it')
  await smoke.evaluate(chat, 'document.title = "Renamed · Hark"; true')
  await waitFor(() => smoke.evaluate(header, 'document.getElementById("title").textContent === "Renamed · Hark"'), 'the new title in the strip')
  await delay(500)
  const retitle = await take()
  console.log(`[idle] retitle: ${JSON.stringify(retitle)}`)
  const logFile = join(userData, 'logs', 'mini-header-debug.log')
  await waitFor(() => existsSync(logFile) && /push .*title/.test(readFileSync(logFile, 'utf8')), 'the header debug log to record the push')
  const log = readFileSync(logFile, 'utf8')
  console.log(`[idle] debug log: ${log.split('\n').length} lines; tail:\n${log.trim().split('\n').slice(-6).join('\n')}`)

  smoke.step('a real reload of the page still shows loading in the strip')
  await smoke.evaluate(header, `(() => { window.__sawLoading = false; new MutationObserver(() => { if (document.body.classList.contains('loading')) window.__sawLoading = true }).observe(document.body, { attributes: true }); return true })()`)
  slowChat = true
  chat.reload()
  await waitFor(() => smoke.evaluate(header, 'window.__sawLoading === true'), 'the loading line during a real reload', 5000)
  await waitFor(() => !chat.isLoading() && smoke.evaluate(header, '!document.body.classList.contains("loading")'), 'loading to clear after the reload')
  console.log('[idle] reload: loading shown and cleared')

  if (process.env.IDLE_MEASURE_ONLY !== '1') {
    assert.ok(stats.frameLoads >= 2 && stats.wsPings >= 4 && stats.titleSets >= 10, `the page really did its idle work (${JSON.stringify(stats)})`)
    assert.equal(idle.mutations, 0, `idle: no strip DOM writes (${idle.detail.join(' | ')})`)
    assert.equal(idle.sends, 0, 'idle: no state pushes')
    assert.deepEqual(idle.native, {}, 'idle: no native view/window calls')
    assert.equal(idle.headerReloads, 0, 'idle: the header page never reloads')
    assert.equal(retitle.sends, 1, 'retitle: one push')
    assert.ok(retitle.mutations >= 1 && retitle.mutations <= 2, `retitle: the title written (${retitle.detail.join(' | ')})`)
    assert.match(log, /dom .*title/, 'debug log: the header DOM write')
    assert.match(log, /page .*did-frame-navigate subframe/, 'debug log: the page events')
  }

  smoke.step('⌘K turns the trace off and on again mid-session (header page and native tracers follow)')
  await runCommand('miniWindow.debugHeader')
  await delay(300)
  const offAt = readFileSync(logFile, 'utf8').length
  await smoke.evaluate(chat, 'document.title = "Quiet · Hark"; true')
  await waitFor(() => smoke.evaluate(header, 'document.getElementById("title").textContent === "Quiet · Hark"'), 'the quiet retitle')
  await delay(600)
  assert.equal(readFileSync(logFile, 'utf8').length, offAt, 'off: nothing more is logged')
  assert.equal(revealed, 1, 'off: the log is shown in the file manager')
  await runCommand('miniWindow.debugHeader')
  await smoke.evaluate(chat, 'document.title = "Loud · Hark"; true')
  await waitFor(() => /dom .*trace on/.test(readFileSync(logFile, 'utf8').slice(offAt)) && /dom .*Loud · Hark/.test(readFileSync(logFile, 'utf8').slice(offAt)), 'the trace back on (header page and push)')
  win.setBounds(win.getBounds())
  await waitFor(() => /native \[mini 0 popout\]\.setBounds/.test(readFileSync(logFile, 'utf8').slice(offAt)), 'the native tracer back on')

  smoke.step('Return leaves nothing behind')
  await runCommand('miniWindow.return')
  await waitFor(() => miniWindows().length === 0, 'all closed')
  server.closeAllConnections?.()
  console.log('Electron mini window popout idle smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron mini window popout idle smoke failed:', error)
  app.exit(1)
})
