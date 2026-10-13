// Overlay sidebar legibility over busy live pages: which backdrop path is in force, that it is
// opaque enough (or blurred) to read, and before/after screenshots. No xdotool needed: the
// sidebar is revealed through the chrome-state API the hover handler uses.
//
//   SURFFISH_SIDEBAR_BACKDROP=solid|snapshot|native  path to test (default: the platform's own)
//   SURFFISH_SCREENSHOT_DIR=…                        save window captures (needs ffmpeg + X11)
//   SURFFISH_BACKDROP_LABEL=before                   only measure + capture (for an older build)
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, nativeImage } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-sidebar-backdrop-smoke-${process.pid}`)
const screenshotDirectory = process.env.SURFFISH_SCREENSHOT_DIR
const label = process.env.SURFFISH_BACKDROP_LABEL || process.env.SURFFISH_SIDEBAR_BACKDROP || 'default'
const measureOnly = label === 'before'

// A YouTube-ish page: dense left nav text, thumbnails, light and dark variants.
function busyPage(theme) {
  const dark = theme === 'dark'
  const nav = ['Home', 'Shorts', 'Subscriptions', 'You', 'History', 'Playlists', 'Your videos', 'Watch later', 'Liked videos', 'Trending', 'Shopping', 'Music', 'Movies & TV', 'Live', 'Gaming', 'News', 'Sports', 'Courses', 'Fashion', 'Podcasts']
  const thumbs = Array.from({ length: 24 }, (_, i) => `<div class="t" style="background:hsl(${(i * 47) % 360} 70% ${dark ? 35 : 55}%)"><b>Video title number ${i + 1} with a long name</b></div>`).join('')
  return `<!doctype html><meta charset="utf-8"><title>Busy ${theme}</title><style>
    body{margin:0;font:15px/1.35 system-ui,sans-serif;background:${dark ? '#0f0f0f' : '#fff'};color:${dark ? '#f1f1f1' : '#0f0f0f'}}
    nav{position:fixed;top:0;left:0;width:240px;bottom:0;padding:12px;overflow:hidden}
    nav a{display:block;padding:9px 12px;font-weight:600;color:inherit;text-decoration:none;border-radius:10px}
    nav a:nth-child(1){background:${dark ? '#272727' : '#f2f2f2'}}
    main{margin-left:250px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:14px}
    .t{height:150px;border-radius:12px;padding:8px;color:#fff}
  </style><nav>${nav.map((item) => `<a href="#">${item}</a>`).join('')}${nav.map((item) => `<a href="#">${item} again</a>`).join('')}</nav><main>${thumbs}</main>`
}

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(busyPage(request.url.includes('dark') ? 'dark' : 'light'))
})
let mainWindow

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
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
function surface(name) {
  return mainWindow.contentView.children.find((view) => {
    try { return view.webContents && new URL(view.webContents.getURL()).searchParams.get('surface') === name } catch { return false }
  })
}
const evaluate = (view, expression) => view.webContents.executeJavaScript(expression)

/** The whole window as X11 draws it (every native view composited), as a NativeImage. */
function captureWindow(name) {
  const dir = screenshotDirectory || join(userData, 'shots')
  mkdirSync(dir, { recursive: true })
  const { x, y, width, height } = mainWindow.getContentBounds()
  const file = join(dir, name)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'x11grab', '-video_size', `${width}x${height}`, '-i', `${process.env.DISPLAY}.0+${x},${y}`, '-frames:v', '1', '-y', file])
  return nativeImage.createFromPath(file)
}

/** Luminance spread inside a rect: how much page detail shows through an empty bit of the sidebar. */
function luminanceStdDev(image, rect) {
  const { width } = image.getSize()
  const bitmap = image.toBitmap() // BGRA
  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = rect.y; y < rect.y + rect.height; y += 2) {
    for (let x = rect.x; x < rect.x + rect.width; x += 2) {
      const i = (y * width + x) * 4
      const lum = 0.0722 * bitmap[i] + 0.7152 * bitmap[i + 1] + 0.2126 * bitmap[i + 2]
      sum += lum
      sumSquares += lum * lum
      count++
    }
  }
  const mean = sum / count
  return { mean, std: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) }
}

/** Smallest alpha among the rgba() stops of a computed background-image (1 when none). */
function minAlpha(backgroundImage, backgroundColor) {
  // The gradient is the card's paint; a transparent background-color under it doesn't count.
  const source = backgroundImage && backgroundImage !== 'none' ? backgroundImage : backgroundColor
  const alphas = [...`${source}`.matchAll(/rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\)/g)].map((match) => Number(match[1]))
  return alphas.length > 0 ? Math.min(...alphas) : 1
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(join(userData, 'adblock-engine.bin'), ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', { loadNetworkFilters: true, loadCosmeticFilters: false }).serialize())
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows().find((window) => !window.isDestroyed() && window.isVisible()), 'the main window', 45000)
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 800 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const sidebar = surface('sidebar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')

  let mode = 'unknown'
  if (!measureOnly) {
    const reported = await evaluate(toolbar, 'window.api.browser.sidebarBackdrop.get()')
    mode = reported.state.mode
    assert.equal(reported.settings.blur, true, 'Sidebar blur is on by default')
    const expected = process.env.SURFFISH_SIDEBAR_BACKDROP || (process.platform === 'darwin' ? 'native' : 'solid')
    assert.equal(mode, expected, 'the expected backdrop path is in force')
  }

  const results = []
  for (const theme of ['light', 'dark']) {
    await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/${theme}`)})`)
    await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.state()')).url.endsWith(`/${theme}`) && !(await evaluate(toolbar, 'window.api.browser.state()')).loading, `the ${theme} busy page`)
    await delay(500)
    // Reveal the overlay the way the left-edge hover does.
    await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarHovered: true })')
    await waitFor(() => sidebar.getVisible() && sidebar.getBounds().width > 0, 'the overlay sidebar to show')
    if (mode === 'snapshot') await waitFor(() => evaluate(sidebar, 'Boolean(document.querySelector(".sidebar-backdrop.is-ready"))'), 'the blurred page snapshot')
    await delay(700)
    const sidebarBounds = sidebar.getBounds()
    const card = await evaluate(sidebar, `(() => { const el = document.querySelector('.browser-sidebar'); const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { backgroundImage: s.backgroundImage, backgroundColor: s.backgroundColor, backdropFilter: s.backdropFilter || s.webkitBackdropFilter, className: el.className, top: r.top, bottom: r.bottom, tabsBottom: Math.max(0, ...[...el.querySelectorAll('.tab-item, .sidebar-new-tab-row, .sidebar-pinned-sites, .sidebar-archived')].map((node) => node.getBoundingClientRect().bottom)), footerTop: el.querySelector('.sidebar-footer')?.getBoundingClientRect().top ?? r.bottom } })()`)
    const image = captureWindow(`sidebar-backdrop-${label}-${theme}.png`)
    // An empty stretch of the card between the tab list and the footer, clear of the edges.
    const top = Math.round(sidebarBounds.y + card.tabsBottom + 24)
    const bottom = Math.round(sidebarBounds.y + card.footerTop - 24)
    const rect = { x: 24, y: top, width: Math.max(40, Math.min(sidebarBounds.width - 48, 200)), height: Math.max(20, bottom - top) }
    const behind = luminanceStdDev(image, rect)
    results.push({ theme, label, mode, std: Number(behind.std.toFixed(1)), mean: Number(behind.mean.toFixed(1)), minAlpha: minAlpha(card.backgroundImage, card.backgroundColor), backdropFilter: card.backdropFilter, bounds: sidebarBounds })

    if (!measureOnly) {
      assert.ok(!card.backdropFilter || card.backdropFilter === 'none', 'no CSS backdrop-filter on the overlay sidebar (it can only see its own transparent view)')
      assert.match(card.className, new RegExp(`has-backdrop-${mode}`), 'the card styles itself for the active path')
      if (mode === 'solid') assert.ok(results.at(-1).minAlpha >= 0.9, `solid tint is near-opaque (min alpha ${results.at(-1).minAlpha})`)
      if (mode === 'snapshot') {
        const tint = await evaluate(sidebar, 'getComputedStyle(document.querySelector(".sidebar-backdrop-tint")).backgroundImage')
        assert.ok(minAlpha(tint, '') >= 0.65, 'the snapshot is darkened enough to read on')
        assert.ok(await evaluate(sidebar, 'document.querySelector(".sidebar-backdrop-canvas").width > 0'), 'the snapshot canvas is drawn')
      }
      if (mode === 'native') {
        assert.equal(sidebarBounds.y, 10, 'the native-blur view is inset to the card')
        assert.ok(sidebarBounds.height <= mainWindow.getContentBounds().height - 20)
      }
      // The page's nav text and thumbnails must not read through: the empty card area stays flat.
      assert.ok(results.at(-1).std < 8, `page detail bleeds through the sidebar (${theme}: luminance std ${results.at(-1).std})`)
    }
    await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarHovered: false })')
    await waitFor(() => !sidebar.getVisible(), 'the overlay sidebar to hide')
    if (mode === 'snapshot') {
      // Hidden: no snapshot is kept around (and none is taken).
      await waitFor(() => evaluate(sidebar, '!document.querySelector(".sidebar-backdrop.is-ready")'), 'the snapshot to be dropped when hidden', 5000).catch(() => undefined)
    }
  }

  if (!measureOnly) {
    // Settings → Appearance → Sidebar blur off: always the solid tint.
    await evaluate(toolbar, 'window.api.browser.sidebarBackdrop.set({ blur: false })')
    await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.sidebarBackdrop.get()')).state.mode === 'solid', 'blur off to switch to solid')
    await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarHovered: true })')
    await waitFor(() => evaluate(sidebar, 'document.querySelector(".browser-sidebar").className.includes("has-backdrop-solid")'), 'the solid card')
    // A view that had the native blur keeps its card-sized frame (blur 0, opaque fill); others stay full height.
    assert.equal(sidebar.getBounds().y, mode === 'native' ? 10 : 0, 'the sidebar view frame after turning blur off')
    await delay(700)
    // Switched at runtime (e.g. native → solid): the card must still paint, over the dark page.
    const offImage = captureWindow(`sidebar-backdrop-${label}-blur-off.png`)
    const off = luminanceStdDev(offImage, { x: 24, y: 300, width: 200, height: 200 })
    assert.ok(off.std < 8, `blur off: page detail bleeds through (${off.std.toFixed(1)})`)
    const offPage = luminanceStdDev(offImage, { x: 340, y: 300, width: 200, height: 200 })
    assert.ok(Math.abs(off.mean - offPage.mean) > 5 || off.std < offPage.std, 'blur off: the sidebar card is drawn')
    await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarHovered: false })')
    await evaluate(toolbar, 'window.api.browser.sidebarBackdrop.set({ blur: true })')
  }
  console.log(`SIDEBAR_BACKDROP_RESULTS ${JSON.stringify(results)}`)
  console.log('Electron sidebar backdrop smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron sidebar backdrop smoke failed:', error)
  app.exit(1)
})
