// Surffish perf bench: one cold launch of a production build, one JSON sample.
// Launched by scripts/perf/run.ts (`bun run perf`), not usually by hand:
//   PERF_APP_DIR=<repo with out/> PERF_OUT=sample.json electron scripts/perf/bench.cjs
// The app's own Electron runs it, the app's out/main/index.js is imported after the
// instrumentation below is in place, so IPC and main-process timers are counted from the start.
// Works on Linux (PSS from /proc) and macOS (working set from app.getAppMetrics()).
const T_PROCESS_START = Date.now() - process.uptime() * 1000
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents, ipcMain } = require('electron')
// SURFFISH_SMOKE_HIDDEN=1 (Mac CI only): windows never show or take focus; applies to base and PR alike
require('../smoke-hidden.cjs')

const APP_DIR = resolve(process.env.PERF_APP_DIR || process.cwd())
const OUT = process.env.PERF_OUT || ''
const cfg = JSON.parse(process.env.PERF_CONFIG || '{}')
const TABS_MID = cfg.tabsMid ?? 10
const TABS_MAX = cfg.tabsMax ?? 30
const IDLE_SECONDS = cfg.idleSeconds ?? 5
const SWITCHES = cfg.tabSwitches ?? 12
const NEW_TABS = cfg.newTabs ?? 5
const WINDOW_CYCLES = cfg.windowCycles ?? 3
const userData = join(tmpdir(), `surffish-perf-${process.pid}`)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const step = (t) => process.stderr.write(`[perf] ${((Date.now() - T_PROCESS_START) / 1000).toFixed(1)}s ${t}\n`)
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }
app.commandLine.appendSwitch('enable-precise-memory-info')

// ---- instrumentation, installed before the app's main module loads ----
let counting = false
const ipc = { count: 0, bytes: 0, channels: new Map() }
const resetIpc = () => { ipc.count = 0; ipc.bytes = 0; ipc.channels.clear() }
const size = (args) => { try { return JSON.stringify(args)?.length ?? 0 } catch { return 0 } }
const bump = (key, args) => {
  if (!counting) return
  ipc.count++
  ipc.bytes += size(args)
  ipc.channels.set(key, (ipc.channels.get(key) || 0) + 1)
}
const origHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => origHandle(channel, (event, ...a) => { bump(`invoke ${channel}`, a); return fn(event, ...a) })
const origOn = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, fn) => origOn(channel, (event, ...a) => { bump(`on ${channel}`, a); return fn(event, ...a) })
app.on('web-contents-created', (_e, contents) => {
  const send = contents.send.bind(contents)
  contents.send = (channel, ...a) => { bump(`send ${channel}`, a); return send(channel, ...a) }
})
// Main-process timer fires (setTimeout/setInterval), by call site.
const timers = new Map()
for (const name of ['setTimeout', 'setInterval']) {
  const orig = global[name]
  global[name] = function (fn, ms, ...rest) {
    if (typeof fn !== 'function') return orig.call(this, fn, ms, ...rest)
    const line = (new Error().stack.split('\n').slice(2).find((l) => l.includes('/out/main/')) || '').trim()
    const where = `${name}(${ms ?? 0}) ${line.replace(/^at /, '').replace(/.*\/out\/main\//, '')}`
    return orig.call(this, function (...a) { if (counting && line) timers.set(where, (timers.get(where) || 0) + 1); return fn.apply(this, a) }, ms, ...rest)
  }
}
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0)
const top = (m, n = 8) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n))

// ---- fixture site ----
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><title>Page ${n}</title><style>body{font:16px system-ui;margin:40px}</style>
<h1>Fixture page ${n}</h1>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. </p>'.repeat(40)}
<img src="/img.svg" width="300" height="120"><script>window.__t=0;setInterval(()=>{window.__t++},1000)</script>`
const server = createServer((req, res) => {
  if (req.url === '/img.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="teal"/></svg>'); return }
  if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(PAGE(req.url))
})

// ---- measurement helpers ----
function surfaceOf(c) { try { return new URL(c.getURL()).searchParams.get('surface') } catch { return null } }
let win
const attached = () => new Map(win.contentView.children.filter((v) => v.webContents).map((v) => [v.webContents, v]))
const isLinux = process.platform === 'linux'
function pssKB(pid) {
  try { return Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))[1]) } catch { return 0 }
}
// Total memory of every Surffish process in MB: PSS on Linux (shared pages split fairly),
// working set elsewhere (macOS has no cheap PSS; numbers are only comparable run to run).
function memory() {
  const m = app.getAppMetrics()
  const kb = m.reduce((n, e) => n + (isLinux ? pssKB(e.pid) : (e.memory?.workingSetSize || 0)), 0)
  const gpu = m.filter((e) => e.type === 'GPU').reduce((n, e) => n + (isLinux ? pssKB(e.pid) : (e.memory?.workingSetSize || 0)), 0)
  return { totalMB: Math.round(kb / 1024), gpuMB: Math.round(gpu / 1024), processes: m.length }
}
// Cumulative CPU seconds per process group (cross-platform via getAppMetrics).
function cpuSeconds() {
  const kindByPid = new Map()
  for (const c of webContents.getAllWebContents()) { if (!c.isDestroyed()) kindByPid.set(c.getOSProcessId(), surfaceOf(c) ? 'shell' : 'tabs') }
  const r = { main: 0, shell: 0, tabs: 0, gpu: 0, other: 0 }
  for (const e of app.getAppMetrics()) {
    const k = e.type === 'Browser' ? 'main' : e.type === 'GPU' ? 'gpu' : e.type === 'Tab' ? (kindByPid.get(e.pid) || 'other') : 'other'
    r[k] += e.cpu.cumulativeCPUUsage || 0
  }
  return r
}
async function waitFor(pred, what, timeout = 20000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { const v = await pred(); if (v) return v } catch (e) { last = e } await delay(5) }
  throw new Error(`timeout: ${what} ${last || ''}`)
}
const fcpOf = (wc) => wc.executeJavaScript(`new Promise((r) => { const f = () => { const e = performance.getEntriesByName('first-contentful-paint')[0]; if (e) r(performance.timeOrigin + e.startTime); else setTimeout(f, 5) }; f() })`)
const twoFrames = (wc) => wc.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))')

// Seed an offline ad-filter engine built by the app's own adblock module (tiny fixture lists),
// so the bench never downloads filter lists and both builds start from the same state.
// PERF_ADBLOCK_ENGINE=<adblock-engine-v2.bin> seeds a real prebuilt engine instead.
async function seedProfile() {
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  const dest = join(userData, 'adblock-engine-v2.bin')
  if (process.env.PERF_ADBLOCK_ENGINE && existsSync(process.env.PERF_ADBLOCK_ENGINE)) { copyFileSync(process.env.PERF_ADBLOCK_ENGINE, dest); return 'prebuilt' }
  try {
    const mod = await import(pathToFileURL(join(APP_DIR, 'out/main/adblock-engine.js')).href)
    const fetch = async (url) => new Response(url.endsWith('.json') ? '[]' : '! surffish perf fixture\n||ads.invalid^\n##.perf-fixture-ad\n')
    const { engine } = await mod.buildFilterEngine(fetch, mod.FILTER_LIST_SOURCES)
    writeFileSync(dest, engine.serialize())
    return 'fixture'
  } catch (e) {
    step(`adblock fixture engine not seeded (${e.message}); the app may fetch lists`)
    return 'none'
  }
}

async function run() {
  const result = { platform: process.platform, arch: process.arch, electron: process.versions.electron }
  app.setPath('userData', userData)
  const seedStart = Date.now()
  result.adblockEngine = await seedProfile()
  const seedMs = Date.now() - seedStart // excluded from startup timings
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  counting = true // startup IPC
  await import(pathToFileURL(join(APP_DIR, 'out/main/index.js')).href)
  await app.whenReady()
  win = await waitFor(() => BaseWindow.getAllWindows()[0], 'window', 30000)
  const tWindow = Date.now() - T_PROCESS_START - seedMs
  const toolbar = await waitFor(() => win.contentView.children.find((v) => surfaceOf(v.webContents) === 'toolbar'), 'toolbar', 30000)
  const content = await waitFor(() => win.contentView.children.find((v) => surfaceOf(v.webContents) === 'content'), 'content', 30000)
  await waitFor(() => toolbar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'toolbar api', 30000)
  // First contentful paint of the New Tab page (the toolbar surface never reports FCP).
  const contentFcp = await Promise.race([fcpOf(content.webContents), delay(10000).then(() => NaN)])
  result.startup = { windowMs: Math.round(tWindow), firstPaintMs: Math.round(contentFcp - T_PROCESS_START - seedMs) }
  step('first paint')
  const api = (expr) => toolbar.webContents.executeJavaScript(expr)
  const loadedTabs = () => webContents.getAllWebContents().filter((c) => !c.isDestroyed() && /\/p\d+$/.test(c.getURL()) && !c.isLoading()).length
  const openTabs = async (from, n) => {
    for (let i = from; i < from + n; i++) await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/p${i}`)})`)
    await waitFor(() => loadedTabs() >= from + n, `${from + n} tabs loaded`, 60000)
  }

  await api(`window.api.browser.navigate(${JSON.stringify(`${origin}/p0`)})`)
  await waitFor(() => loadedTabs() >= 1, 'p0')
  await delay(1500)
  counting = false
  result.startup.ipcCount = ipc.count
  result.mem1 = memory()

  await openTabs(1, TABS_MID - 1)
  await delay(1500)
  result.memMid = { tabs: TABS_MID, ...memory() }
  step(`${TABS_MID} tabs`)

  // IPC while opening the next batch of tabs (20 by default).
  resetIpc(); counting = true
  const c0 = cpuSeconds(); const w0 = Date.now()
  await openTabs(TABS_MID, TABS_MAX - TABS_MID)
  await delay(1000)
  counting = false
  const c1 = cpuSeconds()
  result.openTabs = { tabs: TABS_MAX - TABS_MID, ipcCount: ipc.count, ipcBytes: ipc.bytes, wallMs: Date.now() - w0, mainCpuMs: Math.round((c1.main - c0.main) * 1000), top: top(ipc.channels) }
  await delay(1500)
  result.memMax = { tabs: TABS_MAX, ...memory() }
  step(`${TABS_MAX} tabs`)

  // Idle with all tabs open (one foreground, the rest background): IPC, main timers, CPU.
  resetIpc(); timers.clear(); counting = true
  const i0 = cpuSeconds()
  await delay(IDLE_SECONDS * 1000)
  counting = false
  const i1 = cpuSeconds()
  const perSec = (k) => round(((i1[k] - i0[k]) * 1000) / IDLE_SECONDS)
  result.idle = { seconds: IDLE_SECONDS, ipcCount: ipc.count, timerFires: sum(timers), backgroundTabsCpuMsPerSec: perSec('tabs'), mainCpuMsPerSec: perSec('main'), shellCpuMsPerSec: perSec('shell'), ipcTop: top(ipc.channels, 5), timersTop: top(timers, 5) }
  step('idle')

  // Tab switch: activate -> view attached -> two frames painted in the tab.
  const tabs = (await api('window.api.browser.tabs.get()')).filter((t) => /\/p\d+$/.test(t.url)).slice(0, TABS_MID)
  const byPath = (p) => webContents.getAllWebContents().find((c) => !c.isDestroyed() && c.getURL().endsWith(p))
  const sw = []
  for (let i = 0; i < SWITCHES; i++) {
    const tab = tabs[i % tabs.length]
    const wc = byPath(new URL(tab.url).pathname)
    const s = performance.now()
    await api(`window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`)
    if (wc) { await waitFor(() => attached().get(wc)?.getVisible(), 'attached', 5000); await twoFrames(wc) }
    sw.push(performance.now() - s)
    await delay(100)
  }
  result.tabSwitch = { medianMs: round(median(sw)), samples: sw.length }
  step('tab switch')

  // New tab with a site: create -> first contentful paint in the new tab.
  const nt = []
  for (let i = 0; i < NEW_TABS; i++) {
    const s = performance.now()
    await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/n${i}`)})`)
    const wc = await waitFor(() => byPath(`/n${i}`), 'new tab', 10000)
    const paint = await fcpOf(wc)
    nt.push(paint - (performance.timeOrigin + s))
    await delay(150)
  }
  const blank = []
  for (let i = 0; i < 3; i++) {
    const s = performance.now()
    await api('window.api.browser.tabs.create()')
    await waitFor(() => attached().get(content.webContents)?.getVisible(), 'new tab page', 5000)
    await twoFrames(content.webContents)
    blank.push(performance.now() - s)
    await delay(150)
  }
  result.newTab = { siteFirstPaintMs: round(median(nt)), newTabPageMs: round(median(blank)) }
  step('new tab')

  // Window open/close cycles: anything left behind is a leak.
  const count = () => ({ windows: BaseWindow.getAllWindows().length, webContents: webContents.getAllWebContents().length, shell: webContents.getAllWebContents().filter((c) => !c.isDestroyed() && surfaceOf(c)).length, ...memory() })
  await delay(500)
  const before = count()
  for (let i = 0; i < WINDOW_CYCLES; i++) {
    await api('window.api.browser.tabs.newWindow(false)')
    const w2 = await waitFor(() => BaseWindow.getAllWindows().find((w) => w !== win && w.isVisible()), 'second window', 15000)
    await delay(400)
    w2.close()
    await waitFor(() => BaseWindow.getAllWindows().length === 1, 'window closed', 15000)
    await delay(300)
  }
  await delay(1500)
  const after = count()
  result.windowCycles = { cycles: WINDOW_CYCLES, processesGrowth: after.processes - before.processes, webContentsGrowth: after.webContents - before.webContents, shellGrowth: after.shell - before.shell, memGrowthMB: after.totalMB - before.totalMB }
  step('window cycles')
  return result
}

run().then((r) => {
  const json = JSON.stringify(r)
  if (OUT) writeFileSync(OUT, json)
  console.log(`PERF_SAMPLE ${json}`)
  server.close()
  rmSync(userData, { recursive: true, force: true })
  app.exit(0)
}, (e) => { console.error('[perf] FAILED', e); rmSync(userData, { recursive: true, force: true }); app.exit(1) })
