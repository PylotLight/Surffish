// Integration smoke for the screenshot tool: Cmd/Ctrl+Shift+S region select, the preview popover
// (Copy / Save), annotate, full page through CDP (and coexisting with another debugger client).
// Runs the production build:
// `bun run build && bun run test:electron-screenshot`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-screenshot-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, nativeImage } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-screenshot-smoke-${process.pid}`)
const savePath = join(userData, 'smoke-shot.png')
process.env.SURFFISH_SCREENSHOT_SMOKE_SAVE_PATH = savePath
const primary = process.platform === 'darwin' ? 'meta' : 'control'
const PAGE_HEIGHT = 3000
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  if (request.url.startsWith('/inner')) {
    // An app-style page: the document doesn't scroll, an inner container with a sticky header does.
    response.end(`<!doctype html><meta charset="utf-8"><title>Inner scroller fixture</title>
<style>html,body{margin:0;height:100%;overflow:hidden}#top{height:50px;background:rgb(80,80,80)}
#s{position:absolute;top:50px;left:0;right:0;bottom:0;overflow:auto}#s>header{position:sticky;top:0;height:40px;background:rgb(255,255,0)}#s>div{height:1000px}</style>
<div id="top"></div><div id="s"><header></header><div style="background:rgb(0,0,255)"></div><div style="background:rgb(0,255,0)"></div><div style="background:rgb(255,0,0)"></div></div>`)
    return
  }
  response.end(`<!doctype html><meta charset="utf-8"><title>Screenshot fixture</title>
<style>html,body{margin:0}div{height:${PAGE_HEIGHT / 3}px}</style>
<div style="background:rgb(0,0,255)"></div><div style="background:rgb(0,255,0)"></div><div style="background:rgb(255,0,0)"></div>`)
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
const pageView = (urlPart) => views().find((view) => view.webContents.getURL().includes(urlPart))
const overlayView = () => views().find((view) => view.webContents.getURL().startsWith('data:text/html') && view.webContents.getURL().includes('surffishScreenshot'))

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}

function key(view, keyCode, modifiers = []) {
  view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

async function drag(view, from, to) {
  const contents = view.webContents
  contents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y })
  contents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
  for (let step = 1; step <= 5; step += 1) {
    contents.sendInputEvent({ type: 'mouseMove', x: from.x + ((to.x - from.x) * step) / 5, y: from.y + ((to.y - from.y) * step) / 5, button: 'left', modifiers: ['leftButtonDown'] })
    await delay(16)
  }
  contents.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
}

const mode = (overlay) => evaluate(overlay, `['select','busy','preview','annotate','scrolling'].find((id) => !document.getElementById(id).hidden) ?? 'hidden'`)
const dims = (overlay) => evaluate(overlay, 'document.getElementById("dims").textContent')

function savedImage() {
  assert.ok(existsSync(savePath), 'the screenshot was saved')
  const bytes = readFileSync(savePath)
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', 'saved as PNG')
  return { bytes, image: nativeImage.createFromBuffer(bytes) }
}

let toolbarView
async function downloadsListed() {
  const downloads = await evaluate(toolbarView, 'window.api.browser.downloads.get()')
  return downloads.length > 0
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  toolbarView = toolbar
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')

  const snapshot = await evaluate(toolbar, 'window.api.browser.commands.list()')
  const command = snapshot.commands.find((entry) => entry.id === 'view.screenshot')
  assert.ok(command, 'the palette lists Take Screenshot…')
  assert.equal(command.accelerator, 'CmdOrCtrl+Shift+S')
  assert.ok(snapshot.commands.some((entry) => entry.id === 'view.screenshotFull'), 'the palette lists Screenshot Full Page')

  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`)
  const page = await waitFor(() => pageView('/fixture'), 'the fixture page view')
  await waitFor(() => !page.webContents.isLoading() && page.webContents.getTitle() === 'Screenshot fixture', 'the fixture to load')
  await waitFor(() => page.getBounds().width > 0, 'the page to be on screen')
  await delay(300)
  const pageBounds = page.getBounds()

  // --- Cmd/Ctrl+Shift+S from the page: frozen selector over the page area
  page.webContents.focus()
  key(page, 'S', [primary, 'shift'])
  const overlay = await waitFor(() => overlayView(), 'the screenshot overlay')
  await waitFor(async () => (await mode(overlay)) === 'select', 'select mode')
  await waitFor(() => overlay.getVisible() && overlay.getBounds().width === pageBounds.width, 'the overlay to cover the page')
  assert.deepEqual(overlay.getBounds(), pageBounds, 'select overlay sits exactly over the page')
  assert.equal(mainWindow.contentView.children.at(-1), overlay, 'the overlay is the topmost view')

  // Esc cancels.
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close the selector')

  // --- drag a region
  page.webContents.focus()
  key(page, 'S', [primary, 'shift'])
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'select mode again')
  await delay(150)
  await drag(overlay, { x: 100, y: 100 }, { x: 300, y: 200 })
  await waitFor(async () => (await mode(overlay)) === 'preview', 'the region to open the preview')
  const ratio = await waitFor(async () => {
    const text = await dims(overlay)
    const match = /^(\d+) × (\d+)/.exec(text)
    return match && { width: Number(match[1]), height: Number(match[2]) }
  }, 'the preview size label')
  const scale = ratio.width / 200
  assert.ok(Math.abs(ratio.height - 100 * scale) <= 1, `region keeps its aspect (${ratio.width}×${ratio.height})`)
  const popover = overlay.getBounds()
  assert.ok(popover.width <= 340 && popover.height <= 300, 'the preview is a small popover')
  assert.equal(popover.x + popover.width, pageBounds.x + pageBounds.width - 16, 'popover sits at the bottom-right of the page')

  // Save (dialog bypassed in unpackaged smoke runs) lands in the downloads list.
  rmSync(savePath, { force: true })
  await evaluate(overlay, 'document.getElementById("btn-save").click()')
  await waitFor(() => existsSync(savePath) && readFileSync(savePath).length > 8 && downloadsListed(), 'Save to write the PNG')
  const region = savedImage()
  assert.deepEqual(region.image.getSize(), { width: ratio.width, height: ratio.height }, 'saved region has the previewed size')
  const regionPixel = region.image.crop({ x: 5, y: 5, width: 1, height: 1 }).toBitmap()
  assert.ok(regionPixel[0] > 200 && regionPixel[1] < 60 && regionPixel[2] < 60, 'region is from the blue band (BGRA)')
  const downloads = await evaluate(toolbar, 'window.api.browser.downloads.get()')
  assert.ok(downloads.some((entry) => entry.filename === 'smoke-shot.png' && entry.state === 'completed'), 'saved screenshot is listed in downloads')

  // Copy puts an image on the clipboard.
  await evaluate(overlay, 'document.getElementById("btn-copy").click()')
  await waitFor(async () => /Copied/.test(await evaluate(overlay, 'document.getElementById("status").textContent')), 'Copy to confirm')

  // --- annotate: draw a box, Done, save again
  await evaluate(overlay, 'document.getElementById("btn-annotate").click()')
  await waitFor(async () => (await mode(overlay)) === 'annotate', 'annotate mode')
  await waitFor(() => overlay.getBounds().width === pageBounds.width, 'annotate to use the page area')
  await waitFor(() => evaluate(overlay, 'document.getElementById("canvas").width > 0'), 'the canvas')
  const canvasRect = await evaluate(overlay, '(() => { const r = document.getElementById("draft").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()')
  await evaluate(overlay, 'document.querySelector("[data-tool=redact]").click()')
  await drag(overlay, { x: Math.round(canvasRect.x + 2), y: Math.round(canvasRect.y + 2) }, { x: Math.round(canvasRect.x + canvasRect.width / 2), y: Math.round(canvasRect.y + canvasRect.height / 2) })
  await waitFor(() => evaluate(overlay, '!document.getElementById("btn-undo").disabled'), 'the redact box to be recorded')
  await evaluate(overlay, 'document.getElementById("btn-annotate-done").click()')
  await waitFor(async () => (await mode(overlay)) === 'preview', 'Done to return to the preview')
  rmSync(savePath, { force: true })
  await evaluate(overlay, 'document.getElementById("btn-save").click()')
  await waitFor(() => existsSync(savePath) && readFileSync(savePath).length > 8 && downloadsListed(), 'Save after annotating')
  const annotated = savedImage()
  const redacted = annotated.image.crop({ x: 5, y: 5, width: 1, height: 1 }).toBitmap()
  assert.ok(redacted[0] < 30 && redacted[1] < 30 && redacted[2] < 30, 'the redact box is burned into the saved PNG')
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close the preview')

  // --- full page through the palette (CDP, nobody else attached: we detach afterwards)
  assert.equal(page.webContents.debugger.isAttached(), false)
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotFull")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'preview', 'the full-page preview', 30000)
  const fullText = await dims(overlay)
  const full = /^(\d+) × (\d+)/.exec(fullText)
  assert.ok(full && Number(full[2]) >= PAGE_HEIGHT * scale - 2, `full page covers the whole document (${fullText})`)
  assert.equal(page.webContents.debugger.isAttached(), false, 'our own debugger session is detached again')
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- full page while another client (e.g. the network inspector) holds the debugger: shared, never detached
  page.webContents.debugger.attach('1.3')
  let detached = false
  page.webContents.debugger.once('detach', () => { detached = true })
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotFull")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'preview', 'the shared-debugger full-page preview', 30000)
  assert.equal(page.webContents.debugger.isAttached(), true, 'the other client keeps its session')
  assert.equal(detached, false, 'the other client was never detached')
  page.webContents.debugger.detach()
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- scroll-and-stitch fallback (what runs when CDP can't attach): same size, bands in order
  process.env.SURFFISH_SCREENSHOT_SMOKE_FORCE_STITCH = '1'
  await evaluate(page, 'window.scrollTo(0, 700)')
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotFull")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'preview', 'the stitched full-page preview', 30000)
  const stitchedText = await dims(overlay)
  const stitched = /^(\d+) × (\d+)/.exec(stitchedText)
  assert.ok(stitched && Math.abs(Number(stitched[2]) - PAGE_HEIGHT * scale) <= 2, `stitched page covers the whole document (${stitchedText})`)
  rmSync(savePath, { force: true })
  await evaluate(overlay, 'document.getElementById("btn-save").click()')
  await waitFor(() => existsSync(savePath) && readFileSync(savePath).length > 8, 'Save the stitched page')
  const stitchedImage = savedImage().image
  const sample = (y) => stitchedImage.crop({ x: 10, y: Math.round(y * scale), width: 1, height: 1 }).toBitmap()
  assert.ok(sample(500)[0] > 200, 'top band is blue')
  assert.ok(sample(1500)[1] > 200, 'middle band is green')
  assert.ok(sample(2900)[2] > 200, 'bottom band is red')
  assert.equal(await evaluate(page, 'scrollY'), 700, 'the page scroll position is restored')
  delete process.env.SURFFISH_SCREENSHOT_SMOKE_FORCE_STITCH
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- scrolling screenshot (palette): Enter starts at the top of the view, scroll, Done
  assert.ok(snapshot.commands.some((entry) => entry.id === 'view.screenshotScrolling'), 'the palette lists Scrolling Screenshot')
  const viewportHeight = await evaluate(page, 'innerHeight')
  const sizeOf = async () => {
    const match = /^(\d+) × (\d+)/.exec(await dims(overlay))
    return match && { width: Number(match[1]), height: Number(match[2]) }
  }
  await evaluate(page, 'window.scrollTo(0, 0)')
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotScrolling")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'the scrolling picker')
  assert.equal(await evaluate(overlay, 'document.getElementById("btn-scroll-top").hidden'), false, 'the picker offers Start at Top')
  key(overlay, 'Return')
  await waitFor(async () => (await mode(overlay)) === 'scrolling', 'scrolling mode')
  await waitFor(() => overlay.getBounds().height <= 60 && overlay.getBounds().width <= 600, 'the overlay to shrink to a bar')
  await evaluate(page, 'window.scrollTo(0, 1600)')
  await waitFor(async () => /× \d+/.test(await evaluate(overlay, 'document.getElementById("scroll-dims").textContent')), 'the live size readout')
  await evaluate(overlay, 'document.getElementById("btn-scroll-done").click()')
  await waitFor(async () => (await mode(overlay)) === 'preview', 'the scrolling preview', 30000)
  let size = await waitFor(sizeOf, 'the scrolling size label')
  assert.ok(Math.abs(size.height - (1600 + viewportHeight) * scale) <= 2, `scrolling capture runs from the top to the bottom of the view (${size.width}×${size.height})`)
  rmSync(savePath, { force: true })
  await evaluate(overlay, 'document.getElementById("btn-save").click()')
  await waitFor(() => existsSync(savePath) && readFileSync(savePath).length > 8, 'Save the scrolling capture')
  let shot = savedImage().image
  const at = (image, y, x = 10) => image.crop({ x: Math.round(x * scale), y: Math.round(y * scale), width: 1, height: 1 }).toBitmap()
  assert.ok(at(shot, 500)[0] > 200 && at(shot, 1500)[1] > 200, 'scrolling capture has the blue then green bands')
  assert.equal(await evaluate(page, 'scrollY'), 1600, 'the scroll position the user stopped at is kept')
  assert.equal(await evaluate(page, 'Boolean(window.__surffishScrollShot)'), false, 'the page script is gone from the main world')
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- region band + click on the page to mark the end (the click must not reach the page)
  await evaluate(page, 'window.scrollTo(0, 0); window.__clicks = 0; addEventListener("click", () => { window.__clicks += 1 })')
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotScrolling")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'the scrolling picker again')
  await delay(150)
  await drag(overlay, { x: 100, y: 100 }, { x: 400, y: 200 })
  await waitFor(async () => (await mode(overlay)) === 'scrolling', 'the band to start scrolling')
  await delay(200)
  await evaluate(page, 'window.scrollTo(0, 1000)')
  await delay(200)
  page.webContents.sendInputEvent({ type: 'mouseMove', x: 250, y: 300 })
  page.webContents.sendInputEvent({ type: 'mouseDown', x: 250, y: 300, button: 'left', clickCount: 1 })
  page.webContents.sendInputEvent({ type: 'mouseUp', x: 250, y: 300, button: 'left', clickCount: 1 })
  await waitFor(async () => (await mode(overlay)) === 'preview', 'the click to end the capture', 30000)
  size = await waitFor(sizeOf, 'the band size label')
  assert.ok(Math.abs(size.width - 300 * scale) <= 2, `band keeps the dragged width (${size.width})`)
  assert.ok(Math.abs(size.height - 1200 * scale) <= 2, `band runs from the drag's top to the clicked row (${size.height})`)
  assert.equal(await evaluate(page, 'window.__clicks'), 0, 'the end-marking click never reached the page')
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- Esc while scrolling cancels and cleans up
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotScrolling")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'the picker for cancel')
  key(overlay, 'Return')
  await waitFor(async () => (await mode(overlay)) === 'scrolling', 'scrolling for cancel')
  await delay(200)
  key(page, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc on the page to cancel the scrolling capture')
  await delay(200)
  await evaluate(page, 'window.__clicks = 0; document.body.click()')
  assert.equal(await evaluate(page, 'window.__clicks'), 1, 'clicks reach the page again after cancelling')

  // --- auto-scroll moves the page, Done captures whatever it reached
  await evaluate(page, 'window.scrollTo(0, 0)')
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotScrolling")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'the picker for auto-scroll')
  key(overlay, 'Return')
  await waitFor(async () => (await mode(overlay)) === 'scrolling', 'scrolling for auto-scroll')
  await delay(200)
  await evaluate(overlay, 'document.getElementById("btn-scroll-auto").click()')
  await waitFor(async () => (await evaluate(page, 'scrollY')) > 300, 'auto-scroll to move the page')
  await waitFor(async () => (await evaluate(overlay, 'document.getElementById("btn-scroll-auto").getAttribute("aria-pressed")')) === 'true', 'the Auto-scroll button to show it is running')
  await evaluate(overlay, 'document.getElementById("btn-scroll-done").click()')
  await waitFor(async () => (await mode(overlay)) === 'preview', 'the auto-scrolled preview', 30000)
  size = await waitFor(sizeOf, 'the auto-scrolled size label')
  assert.ok(size.height > (300 + viewportHeight) * scale, `auto-scrolled capture is taller than the view (${size.height})`)
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- forced scroll-and-stitch on the document: same rows as CDP
  process.env.SURFFISH_SCREENSHOT_SMOKE_FORCE_STITCH = '1'
  await evaluate(page, 'window.scrollTo(0, 0)')
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotScrolling")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'the picker for stitching')
  key(overlay, 'Return')
  await waitFor(async () => (await mode(overlay)) === 'scrolling', 'scrolling for stitching')
  await evaluate(page, 'window.scrollTo(0, 1600)')
  await delay(200)
  key(page, 'Return')
  await waitFor(async () => (await mode(overlay)) === 'preview', 'the stitched scrolling preview', 30000)
  size = await waitFor(sizeOf, 'the stitched scrolling size label')
  assert.ok(Math.abs(size.height - (1600 + viewportHeight) * scale) <= 2, `stitched scrolling capture has the same height (${size.height})`)
  rmSync(savePath, { force: true })
  await evaluate(overlay, 'document.getElementById("btn-save").click()')
  await waitFor(() => existsSync(savePath) && readFileSync(savePath).length > 8, 'Save the stitched scrolling capture')
  shot = savedImage().image
  assert.ok(at(shot, 500)[0] > 200 && at(shot, 1500)[1] > 200, 'stitched scrolling capture has the bands in order')
  assert.equal(await evaluate(page, 'scrollY'), 1600, 'stitching puts the scroll back')
  delete process.env.SURFFISH_SCREENSHOT_SMOKE_FORCE_STITCH
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  // --- inner scroll container with a sticky header: stitched, header only in the first frame
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(fixtureUrl.replace('/fixture', '/inner'))})`)
  const inner = await waitFor(() => pageView('/inner'), 'the inner-scroller page view')
  await waitFor(() => !inner.webContents.isLoading() && inner.webContents.getTitle() === 'Inner scroller fixture', 'the inner fixture to load')
  await delay(300)
  await evaluate(toolbar, 'window.api.browser.commands.run("view.screenshotScrolling")')
  await waitFor(async () => overlay.getVisible() && (await mode(overlay)) === 'select', 'the picker on the inner page')
  await delay(150)
  // Band across the scroller, starting at its top edge.
  await drag(overlay, { x: 50, y: 50 }, { x: 450, y: 300 })
  await waitFor(async () => (await mode(overlay)) === 'scrolling', 'scrolling on the inner page')
  await evaluate(inner, 'document.getElementById("s").scrollTop = 1200')
  await waitFor(async () => /× \d+/.test(await evaluate(overlay, 'document.getElementById("scroll-dims").textContent')), 'the inner readout')
  const boxHeight = await evaluate(inner, 'document.getElementById("s").clientHeight')
  await evaluate(overlay, 'document.getElementById("btn-scroll-done").click()')
  await waitFor(async () => (await mode(overlay)) === 'preview', 'the inner preview', 30000)
  size = await waitFor(sizeOf, 'the inner size label')
  assert.ok(Math.abs(size.height - (1200 + boxHeight) * scale) <= 2, `inner capture runs the scroller's content to the bottom of its box (${size.height}, box ${boxHeight})`)
  assert.ok(Math.abs(size.width - 400 * scale) <= 2, `inner capture keeps the band width (${size.width})`)
  rmSync(savePath, { force: true })
  await evaluate(overlay, 'document.getElementById("btn-save").click()')
  await waitFor(() => existsSync(savePath) && readFileSync(savePath).length > 8, 'Save the inner capture')
  shot = savedImage().image
  const yellow = (pixel) => pixel[0] < 60 && pixel[1] > 200 && pixel[2] > 200
  assert.ok(yellow(at(shot, 20)), 'the sticky header is in the first frame')
  assert.ok(!yellow(at(shot, boxHeight + 20)), 'the sticky header is not repeated in the next frame')
  assert.ok(at(shot, 500)[0] > 200 && at(shot, 1100)[1] > 200, 'inner bands are stitched in order')
  assert.equal(await evaluate(inner, 'document.getElementById("s").scrollTop'), 1200, 'the inner scroll position is put back')
  assert.equal(await evaluate(inner, 'getComputedStyle(document.querySelector("#s > header")).visibility'), 'visible', 'the sticky header is shown again')
  key(overlay, 'Escape')
  await waitFor(() => !overlay.getVisible(), 'Esc to close')

  console.log('Electron screenshot smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron screenshot smoke failed:', error)
  app.exit(1)
})
