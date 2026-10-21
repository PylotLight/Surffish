// Screenshot harness (not part of the repo): mini window New Tab, overlay tabbed / menu bar popout tabbed / narrow.
// Usage: SF_REPO=<repo> electron --no-sandbox <this> <outDir> <label>
const REPO = process.env.SF_REPO
const smoke = require(`${REPO}/scripts/smoke-harness.cjs`)
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, screen, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require(require.resolve('@ghostery/adblocker-electron', { paths: [REPO] }))

const OUT = process.argv[process.argv.length - 2]
const LABEL = process.argv[process.argv.length - 1]
const userData = join(tmpdir(), `surffish-shots-${process.pid}`)
const SITES = [['GitHub', '#24292f'], ['Mail', '#d93025'], ['News', '#ff6600'], ['Docs', '#1a73e8'], ['Music', '#1db954'], ['Maps', '#34a853'], ['Weather', '#4285f4']]
const icon = (letter, color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="22" font-family="sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`
function serve(title, color) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><link rel="icon" href="${icon(title[0], color)}"><style>body{font:16px system-ui;margin:0;padding:24px;background:#fafafa}</style><h1>${title}</h1><p>Lorem ipsum dolor sit amet.</p>`)
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)))
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(predicate, description, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const v = await predicate(); if (v) return v } catch (e) { last = e }
    await delay(60)
  }
  throw new Error(`Timed out waiting for ${description}. ${last ?? ''}`)
}
const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const liveContents = () => allWebContents.getAllWebContents().filter((c) => !c.isDestroyed())
const dataPage = (c, title) => c.getURL().startsWith('data:text/html') && decodeURIComponent(c.getURL()).includes(`<title>${title}</title>`)
const isMiniHeader = (c) => dataPage(c, 'Mini Window')
const isMiniNewTab = (c) => dataPage(c, 'Mini Window New Tab')
const childViews = (win) => win.contentView.children.filter((v) => v.webContents && !v.webContents.isDestroyed())
const miniWindows = () => BaseWindow.getAllWindows().filter((w) => !w.isDestroyed() && childViews(w).some((v) => isMiniHeader(v.webContents)))
const headerViewOf = (win) => childViews(win).find((v) => isMiniHeader(v.webContents))
const newTabViewOf = (win) => childViews(win).find((v) => isMiniNewTab(v.webContents))

/** Every visible child view of `win` (z order), captured, plus its bounds: composited by compose.py. */
async function capture(win, name) {
  const size = win.getContentSize()
  const parts = []
  let index = 0
  for (const view of win.contentView.children) {
    if (!view.webContents || view.webContents.isDestroyed()) continue
    const b = view.getBounds()
    if (b.width <= 0 || b.height <= 0 || view.getVisible?.() === false) continue
    const image = await view.webContents.capturePage()
    const file = join(OUT, `${LABEL}-${name}-part${index++}.png`)
    writeFileSync(file, image.toPNG())
    parts.push({ file, x: b.x, y: b.y, width: b.width, height: b.height })
  }
  writeFileSync(join(OUT, `${LABEL}-${name}.json`), JSON.stringify({ width: size[0], height: size[1], parts }, null, 1))
  console.log('captured', name, JSON.stringify(parts.map((p) => [p.x, p.y, p.width, p.height])))
}

async function run() {
  mkdirSync(OUT, { recursive: true })
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  const origins = []
  for (const [title, color] of SITES) origins.push(await serve(title, color))
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: origins.map((o) => `${o}/`), activeIndex: 0 }))
  writeFileSync(join(userData, 'browser-mini-window.json'), JSON.stringify({ defaultUrl: '', shortcut: '', opacity: 1, tuckToEdge: false, peekOnHover: false, throwMomentum: false, grouping: 'tabs', headerPlacement: 'overlay' }))
  await import(pathToFileURL(resolve(REPO, 'out/main/index.js')).href)
  await app.whenReady()
  let cursor = null
  const realCursor = screen.getCursorScreenPoint.bind(screen)
  screen.getCursorScreenPoint = () => cursor ?? realCursor()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 800 })
  const surface = (name) => mainWindow.contentView.children.find((v) => v.webContents && !v.webContents.isDestroyed() && surfaceFor(v) === name)
  await waitFor(() => surface('content') && surface('toolbar'), 'surfaces')
  const toolbar = surface('toolbar').webContents
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'toolbar')
  const tabs = () => smoke.evaluate(toolbar, 'window.api.browser.tabs.get()')
  const runCommand = (id) => smoke.evaluate(toolbar, `window.api.browser.commands.run(${JSON.stringify(id)})`)
  await smoke.evaluate(toolbar, 'window.api.browser.setTabSleepMinutes(0)')
  for (const [i, o] of origins.entries()) {
    const tab = await waitFor(async () => (await tabs()).find((t) => t.url.startsWith(o)), `tab ${o}`)
    await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`)
    const page = await waitFor(() => liveContents().find((c) => c.getURL().startsWith(o) && !c.isLoading()), `page ${o}`)
    for (let n = 0; n < (i < 3 ? 2 : 0); n++) { await page.loadURL(`${o}/?v=${n}`).catch(() => {}); await delay(150) }
    await delay(150)
  }
  const tabFor = async (o) => (await tabs()).find((t) => t.url.startsWith(o))
  await smoke.evaluate(toolbar, `window.api.browser.tabs.activate(${JSON.stringify((await tabFor(origins[0])).id)})`)
  await delay(300)
  await runCommand('miniWindow.popOut')
  const mini = await waitFor(() => miniWindows()[0], 'mini window')
  mini.setBounds({ x: 960, y: 120, width: 420, height: 560 })
  const header = () => headerViewOf(mini).webContents
  await waitFor(() => smoke.evaluate(header(), 'document.readyState === "complete" && Boolean(window.miniWindow)'), 'header')
  const clickInHeader = async (selector) => {
    const at = await smoke.evaluate(header(), `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width } })()`)
    if (!(at.w > 0)) throw new Error(`${selector} hidden`)
    const content = mini.getContentBounds()
    const view = headerViewOf(mini).getBounds()
    cursor = { x: content.x + view.x + at.x, y: content.y + view.y + at.y }
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) header().sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
  }
  const reveal = async () => {
    const page = childViews(mini).find((v) => !isMiniHeader(v.webContents))
    const b = mini.getContentBounds()
    cursor = { x: b.x + 150, y: b.y + 8 }
    page.webContents.sendInputEvent({ type: 'mouseMove', x: 150, y: 8 })
    await waitFor(() => headerViewOf(mini).getBounds().height >= 36, 'header revealed')
    await delay(100)
  }
  const chipCount = () => smoke.evaluate(header(), 'document.querySelectorAll("#strip .tab").length')
  const enter = (c) => { c.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); c.sendInputEvent({ type: 'char', keyCode: '\r' }); c.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }) }
  const backspace = (n) => { for (let i = 0; i < n; i++) { header().sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' }); header().sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' }) } }
  await reveal()
  await clickInHeader('#plus')
  await waitFor(async () => (await chipCount()) === 2, 'two chips')
  await waitFor(() => newTabViewOf(mini), 'new tab page')
  await delay(400)
  header().insertText(`${origins[1]}/`)
  await delay(150)
  enter(header())
  await waitFor(() => !newTabViewOf(mini), 'Mail loaded')
  await delay(500)
  await reveal()
  await clickInHeader('#strip .strip-plus')
  await waitFor(async () => (await chipCount()) === 3, 'three chips')
  await waitFor(() => newTabViewOf(mini), 'new tab page')
  await waitFor(() => smoke.evaluate(newTabViewOf(mini).webContents, 'document.readyState === "complete" && document.querySelectorAll("button").length > 2'), 'tiles')
  await delay(1500)
  await capture(mini, 'overlay-tabbed')
  header().insertText('ma')
  await delay(700)
  await capture(mini, 'overlay-tabbed-typing')
  backspace(2)
  await delay(300)
  mini.focus()
  await runCommand('miniWindow.menuBar')
  await waitFor(() => smoke.evaluate(header(), 'document.body.classList.contains("popout")'), 'popout strip')
  await waitFor(() => mini.isVisible(), 'popout shown')
  await delay(800)
  if (!(await smoke.evaluate(header(), 'document.body.classList.contains("addressing")'))) {
    const blank = newTabViewOf(mini).webContents
    for (const type of ['mouseDown', 'mouseUp']) blank.sendInputEvent({ type, x: 200, y: 400, button: 'left', clickCount: 1 })
  }
  await waitFor(() => smoke.evaluate(header(), 'document.body.classList.contains("addressing")'), 'popout field open')
  await delay(900)
  await capture(mini, 'popout-tabbed')
  header().insertText('ma')
  await delay(700)
  await capture(mini, 'popout-tabbed-typing')
  backspace(2)
  mini.setContentSize(300, 460)
  await delay(900)
  await capture(mini, 'popout-narrow')
  console.log('shots done')
}

run().then(() => app.exit(0), (error) => { console.error('shots failed:', error); app.exit(1) })
