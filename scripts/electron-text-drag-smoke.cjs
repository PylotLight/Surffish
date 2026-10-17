// Integration smoke for dragging a text selection out of a page tab (Chrome behaviour):
//   - press on selected text and move: the page starts a drag carrying the text. Checked with CDP
//     drag interception, so this covers Blink and everything Surffish hooks on page mouse input
//     (before-mouse-event, preloads, injected CSS), not the OS drag session itself.
//   - dropping it on a textarea in the same page inserts the text; the tab doesn't navigate and no
//     tab opens.
//   - SURFFISH_DEBUG_DRAG=1 logs the drag (page-drag-debug.ts).
// The macOS NSDraggingSession can't run under xvfb: check that on a Mac by hand (PR notes).
// `bun run build && bun run test:electron-text-drag`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-text-drag-smoke.cjs`).
process.env.SURFFISH_DEBUG_DRAG = '1'
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-text-drag-smoke-${process.pid}`)

const FIXTURE = `<!doctype html><meta charset="utf-8"><title>Text drag fixture</title>
<body style="font:32px system-ui;padding:24px;margin:0">
<p id="source">hello dragtext world</p>
<textarea id="target" style="display:block;width:420px;height:120px;font:20px system-ui"></textarea>
<script>
  window.dragLog = []
  for (const type of ['dragstart', 'dragend', 'drop']) document.addEventListener(type, () => window.dragLog.push(type), true)
</script>`

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(FIXTURE)
})

// What page-drag-debug.ts printed.
const debugLines = []
const originalLog = console.log
console.log = (...args) => {
  const line = args.map(String).join(' ')
  if (line.startsWith('[surffish-drag]')) debugLines.push(line)
  originalLog(...args)
}

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

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/drag`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [fixtureUrl], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()

  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  await waitFor(() => smoke.evaluate(toolbar.webContents, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const state = () => smoke.evaluate(toolbar.webContents, 'window.api.browser.state()')
  const tabs = () => smoke.evaluate(toolbar.webContents, 'window.api.browser.tabs.get()')

  await waitFor(async () => { const current = await state(); return current.url === fixtureUrl && !current.loading }, 'the fixture page')
  const page = await waitFor(() => pageContents((url) => url === fixtureUrl), 'the fixture page contents')
  await waitFor(() => smoke.evaluate(page, 'Boolean(document.querySelector("#target")) && Array.isArray(window.dragLog)'), 'the fixture DOM')
  const tabCount = (await tabs()).length

  smoke.step('select text in the page')
  const points = await smoke.evaluate(page, `(() => {
    const text = document.getElementById('source').firstChild
    const range = document.createRange()
    range.setStart(text, 6)
    range.setEnd(text, 14)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
    const box = range.getBoundingClientRect()
    const target = document.getElementById('target').getBoundingClientRect()
    return { from: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, to: { x: target.x + 40, y: target.y + 30 }, selected: String(getSelection()) }
  })()`)
  assert.equal(points.selected, 'dragtext')

  const dbg = page.debugger
  dbg.attach('1.3')
  let intercepted = null
  dbg.on('message', (_event, method, params) => { if (method === 'Input.dragIntercepted') intercepted = params.data })
  await dbg.sendCommand('Input.setInterceptDrags', { enabled: true })
  const mouse = (type, point, held = true) => dbg.sendCommand('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: held || type === 'mouseReleased' ? 'left' : 'none',
    buttons: held && type !== 'mouseReleased' ? 1 : 0,
    clickCount: held ? 1 : 0
  })

  smoke.step('press on the selection and move: a drag should start')
  await mouse('mouseMoved', points.from, false)
  await mouse('mousePressed', points.from)
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', { x: points.from.x + ((points.to.x - points.from.x) * i) / steps, y: points.from.y + ((points.to.y - points.from.y) * i) / steps })
    await delay(16)
  }
  const data = await waitFor(() => intercepted, 'the page to start a drag from the selection (Input.dragIntercepted)')
  const plain = data.items.find((item) => item.mimeType === 'text/plain')
  assert.equal(plain?.data, 'dragtext', 'the drag carries the selected text')
  assert.ok((await smoke.evaluate(page, 'window.dragLog')).includes('dragstart'), 'the page saw dragstart')

  smoke.step('drop the selection on the textarea')
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await dbg.sendCommand('Input.dispatchDragEvent', { type, x: points.to.x, y: points.to.y, data, modifiers: 0 })
  }
  await mouse('mouseReleased', points.to)
  await waitFor(() => smoke.evaluate(page, 'document.getElementById("target").value.includes("dragtext")'), 'the dropped text in the textarea')

  await delay(500)
  assert.equal((await state()).url, fixtureUrl, 'a text drop on a page input does not navigate the tab')
  assert.equal((await tabs()).length, tabCount, 'a text drop on a page input does not open a tab')
  dbg.detach()

  smoke.step('SURFFISH_DEBUG_DRAG logged the drag')
  await waitFor(() => debugLines.some((line) => /mousedown at .* on the selection/.test(line)), 'the debug log of the press on the selection')
  await waitFor(() => debugLines.some((line) => /dragstart at .* types=.*text\/plain/.test(line)), 'the debug log of dragstart')
  console.log('Text drag smoke passed.')
}

run().then(() => {
  server.close()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  server.close()
  app.exit(1)
})
