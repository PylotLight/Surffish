// Session restore bench: one cold launch on a seeded multi-tab session, one JSON sample.
//   PERF_APP_DIR=<repo with out/> RESTORE_TABS=40 PERF_OUT=sample.json electron scripts/perf/restore-bench.cjs
// Local only (not part of the CI perf job). Seeds a profile whose browser-session.json holds
// RESTORE_TABS tabs on a local fixture site (active tab first). RESTORE_PREPARE=1 with
// PERF_USER_DATA instead opens the tabs the measurement selects in that profile (so each gets a
// wake snapshot) and quits, and RESTORE_KEEP_PROFILE=1 then measures that profile. Measures: cold start → window,
// → active tab painted, → every sidebar row drawn; processes, page views and memory a few seconds
// after start-up; then selecting background tabs: select → picture on screen and → page painted.
const T_PROCESS_START = Date.now() - process.uptime() * 1000
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents } = require('electron')

const APP_DIR = resolve(process.env.PERF_APP_DIR || process.cwd())
const OUT = process.env.PERF_OUT || ''
const TABS = Number(process.env.RESTORE_TABS || 40)
// A fixed port keeps a prepared profile's URLs valid across launches.
const PORT = Number(process.env.RESTORE_PORT || 0)
const PREPARE = process.env.RESTORE_PREPARE === '1'
const WAKE_INDEXES = [5, 17, 29]
const userData = process.env.PERF_USER_DATA || join(tmpdir(), `surffish-restore-${process.pid}`)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (t) => process.stderr.write(`[restore] ${((Date.now() - T_PROCESS_START) / 1000).toFixed(2)}s ${t}\n`)
const round = (n) => Math.round(n)
const isLinux = process.platform === 'linux'
const mainCpuMs = () => { const u = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage(); return (u.user + u.system) / 1000 }

// A page with some weight (layout, a script that builds DOM, some heap) so each loaded tab costs a renderer.
const PAGE = (path) => `<!doctype html><html><head><title>Page ${path}</title><style>body{font:15px system-ui;margin:24px;background:#fdfcf8}.c{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.c div{background:hsl(${path.length * 37 % 360} 60% 85%);padding:12px;border-radius:6px}</style></head>
<body><h1>Fixture ${path}</h1><div class="c" id="c"></div>
<script>const c=document.getElementById('c');for(let i=0;i<600;i++){const d=document.createElement('div');d.textContent='Cell '+i+' of ${path} '+'lorem ipsum dolor sit amet '.repeat(3);c.appendChild(d)};window.__blob=new Array(200000).fill(0).map((_,i)=>i*2)</script></body></html>`
// RESTORE_PAGE_DELAY_MS: every page answers this late (a slow site / network), so the restored tabs' pictures have something to cover.
const PAGE_DELAY_MS = Number(process.env.RESTORE_PAGE_DELAY_MS || 0)
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return }
  if (PAGE_DELAY_MS > 0) await delay(PAGE_DELAY_MS)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': PAGE_DELAY_MS > 0 ? 'no-store' : 'max-age=3600' })
  res.end(PAGE(req.url))
})

function pssKB(pid) {
  try { return Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))[1]) } catch { return 0 }
}
function memory() {
  const m = app.getAppMetrics()
  const kb = m.reduce((n, e) => n + (isLinux ? pssKB(e.pid) : (e.memory?.workingSetSize || 0)), 0)
  return { totalMB: Math.round(kb / 1024), processes: m.length, renderers: m.filter((e) => e.type === 'Tab').length }
}
async function waitFor(pred, what, timeout = 20000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { const v = await pred(); if (v) return v } catch (e) { last = e } await delay(5) }
  throw new Error(`timeout: ${what} ${last || ''}`)
}
function surfaceOf(c) { try { return new URL(c.getURL()).searchParams.get('surface') } catch { return null } }
const fcpOf = (wc) => wc.executeJavaScript(`new Promise((r) => { const f = () => { const e = performance.getEntriesByName('first-contentful-paint')[0]; if (e) r(performance.timeOrigin + e.startTime); else setTimeout(f, 5) }; f() })`)
const twoFrames = (wc) => wc.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))')
const pageContents = (origin) => webContents.getAllWebContents().filter((c) => !c.isDestroyed() && c.getURL().startsWith(origin))

async function seedProfile(origin) {
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  const tabs = Array.from({ length: TABS }, (_, i) => `${origin}/p${i}`)
  writeFileSync(join(userData, 'browser-session.json'), `${JSON.stringify({ version: 1, windows: [{ tabs, activeIndex: 0, pinnedTabs: [] }], focusedWindow: 0 })}\n`, { mode: 0o600 })
  // An empty offline ad-filter engine (scripts/perf/bench.cjs seeds a fixture one), so nothing downloads lists.
  const mod = await import(pathToFileURL(join(APP_DIR, 'out/main/adblock-engine.js')).href)
  const { engine } = await mod.buildFilterEngine(async (url) => new Response(url.endsWith('.json') ? JSON.stringify({ redirects: [], scriptlets: [] }) : '! surffish restore bench\n'), mod.FILTER_LIST_SOURCES)
  writeFileSync(join(userData, 'adblock-engine-v2.bin'), engine.serialize())
}

async function run() {
  app.setPath('userData', userData)
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const keep = PREPARE || (process.env.RESTORE_KEEP_PROFILE === '1' && existsSync(join(userData, 'browser-session.json')))
  if (!keep) await seedProfile(origin)
  const cpu0 = mainCpuMs()
  await import(pathToFileURL(join(APP_DIR, 'out/main/index.js')).href)
  await app.whenReady()
  const win = await waitFor(() => BaseWindow.getAllWindows()[0], 'window', 30000)
  const tWindow = Date.now()
  const toolbar = await waitFor(() => win.contentView.children.find((v) => surfaceOf(v.webContents) === 'toolbar'), 'toolbar', 30000)
  await waitFor(() => toolbar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'toolbar api', 30000)
  const api = (expr) => toolbar.webContents.executeJavaScript(expr)
  if (PREPARE) {
    // Every tab on screen long enough for its wake snapshot (≥1.5 s, then switched away), then a normal quit.
    // Only the tabs the measured launch opens (WAKE_INDEXES), then back to the first.
    const tabs = (await api('window.api.browser.tabs.get()')).filter((t) => t.url.startsWith(origin))
    for (const tab of [...WAKE_INDEXES.filter((i) => i < tabs.length).map((i) => tabs[i]), tabs[0]]) {
      await api(`window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`)
      const wc = await waitFor(() => pageContents(origin).find((c) => c.getURL() === tab.url && !c.isLoading()), `load ${tab.url}`, 20000)
      await twoFrames(wc)
      await delay(1700)
    }
    await delay(1500)
    step(`prepared ${tabs.length} tabs`)
    app.quit()
    return null
  }
  // When the restored active tab's saved picture (if any) first shows in the toolbar surface.
  let activePictureAt = NaN
  let watching = true
  void (async () => {
    while (watching && Date.now() - T_PROCESS_START < 15000) {
      const shown = await toolbar.webContents.executeJavaScript(`Boolean(document.querySelector('img.wake-snapshot'))`).catch(() => false)
      if (shown) { activePictureAt = Date.now(); return }
      await delay(5)
    }
  })()
  const tabsNow = (await api('window.api.browser.tabs.get()')).filter((t) => t.url.startsWith(origin))
  const activeUrl = `${origin}/p0`
  const active = await waitFor(() => pageContents(origin).find((c) => c.getURL() === activeUrl), 'active tab contents', 30000)
  const tActiveFcp = await Promise.race([fcpOf(active), delay(15000).then(() => NaN)])
  watching = false
  const sidebar = win.contentView.children.find((v) => surfaceOf(v.webContents) === 'sidebar')
  const rowsReady = sidebar
    ? await waitFor(() => sidebar.webContents.executeJavaScript(`document.querySelectorAll('[data-browser-tab-id]').length >= ${tabsNow.length} ? Date.now() : 0`), 'sidebar rows', 20000).catch(() => NaN)
    : NaN
  const cpuAtPaint = mainCpuMs() - cpu0
  await delay(3000)
  const early = { ...memory(), pageViews: pageContents(origin).length, mainCpuToPaintMs: round(cpuAtPaint), mainCpuStartupMs: round(mainCpuMs() - cpu0) }
  await delay(4000)
  const settled = { ...memory(), pageViews: pageContents(origin).length }
  // Select background tabs: select → something on screen (wake snapshot or the page), → page painted.
  const wakes = []
  for (const index of WAKE_INDEXES.filter((i) => i < tabsNow.length)) {
    const tab = tabsNow[index]
    const s = Date.now()
    await api(`window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`)
    const shown = await waitFor(() => toolbar.webContents.executeJavaScript(`Boolean(document.querySelector('img.wake-snapshot'))`), 'snapshot', 400).then(() => Date.now(), () => NaN)
    const wc = await waitFor(() => pageContents(origin).find((c) => c.getURL() === tab.url), 'woken contents', 20000)
    const fcp = await Promise.race([fcpOf(wc), delay(15000).then(() => NaN)])
    await twoFrames(wc)
    wakes.push({ index, snapshotMs: Number.isFinite(shown) ? shown - s : null, fcpMs: round(fcp - s), paintedMs: Date.now() - s })
    await delay(600)
  }
  const result = {
    tabs: tabsNow.length,
    windowMs: round(tWindow - T_PROCESS_START),
    activeTabFcpMs: round(tActiveFcp - T_PROCESS_START),
    activeTabPictureMs: Number.isFinite(activePictureAt) ? round(activePictureAt - T_PROCESS_START) : null,
    sidebarRowsMs: Number.isFinite(rowsReady) ? round(rowsReady - T_PROCESS_START) : null,
    early,
    settled,
    wakes
  }
  step(JSON.stringify(result))
  return result
}

run().then((result) => {
  if (result && OUT) writeFileSync(OUT, JSON.stringify(result, null, 2))
  if (result) app.exit(0)
}, (error) => {
  step(`FAILED ${error.stack || error}`)
  app.exit(1)
})
