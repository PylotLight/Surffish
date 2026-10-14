// Surffish perf bench: one cold launch of a production build, one JSON sample.
// Launched by scripts/perf/run.ts (`bun run perf`), not usually by hand:
//   PERF_APP_DIR=<repo with out/> PERF_OUT=sample.json electron scripts/perf/bench.cjs
// The app's own Electron runs it, the app's out/main/index.js is imported after the
// instrumentation below is in place, so IPC and main-process timers are counted from the start.
// Works on Linux (PSS from /proc) and macOS (working set from app.getAppMetrics()).
const T_PROCESS_START = Date.now() - process.uptime() * 1000
const T_BENCH_START = Date.now()
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents, ipcMain, contentTracing } = require('electron')
// SURFFISH_SMOKE_HIDDEN=1|2 (Mac CI only): windows never take focus (2: never shown); applies to base and PR alike
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
const SITE_TABS = cfg.siteTabs ?? 16
const SITES = cfg.sites ?? 4
const ADBLOCK_NAVS = cfg.adblockNavigations ?? 4
// PERF_USER_DATA: a profile kept across launches (run.ts: the warm-up launch, then the warm starts
// reuse it, so the renderer's V8 code cache and the HTTP cache are warm like a returning user's).
const KEEP_PROFILE = Boolean(process.env.PERF_USER_DATA)
const userData = process.env.PERF_USER_DATA || join(tmpdir(), `surffish-perf-${process.pid}`)
// PERF_TRACE=<file.json>: opt-in Chrome trace (contentTracing) from app ready to the first window's
// deferred start-up (open in https://ui.perfetto.dev or chrome://tracing). Off in CI by default.
const TRACE_FILE = process.env.PERF_TRACE || ''
let tAppReady = NaN
app.once('ready', () => {
  tAppReady = Date.now()
  if (TRACE_FILE) {
    contentTracing.startRecording({
      included_categories: ['toplevel', 'v8', 'blink', 'blink.user_timing', 'loading', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-v8.compile', 'electron'],
      excluded_categories: ['*']
    }).catch((e) => step(`trace not started: ${e.message}`))
  }
})
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
ipcMain.handle = (channel, fn) => origHandle(channel, (event, ...a) => { bump(`invoke ${channel}`, a); if (adblock.counting && channel === ADBLOCK_FRAME_UPDATE) adblock.updates++; return fn(event, ...a) })
// Ad-filter frame-start (sync IPC every frame makes at document start): handler time and reply size.
const ADBLOCK_FRAME_START = 'surffish:adblock:frame-start'
const ADBLOCK_FRAME_UPDATE = 'surffish:adblock:frame-update'
const adblock = { counting: false, starts: 0, bytes: 0, ms: 0, updates: 0 }
const payloadBytes = (p) => (typeof p?.styles === 'string' ? p.styles.length : 0) + (Array.isArray(p?.scripts) ? p.scripts.reduce((n, x) => n + (typeof x === 'string' ? x.length : 0), 0) : 0)
const origOn = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, fn) => origOn(channel, (event, ...a) => {
  bump(`on ${channel}`, a)
  if (channel !== ADBLOCK_FRAME_START || !adblock.counting) return fn(event, ...a)
  // event.returnValue is a write-only reply setter: watch it through a proxy.
  let reply
  const proxied = new Proxy(event, {
    set(target, key, value) { if (key === 'returnValue') reply = value; target[key] = value; return true },
    get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value }
  })
  const t0 = performance.now()
  try { return fn(proxied, ...a) } finally { adblock.ms += performance.now() - t0; adblock.starts++; adblock.bytes += payloadBytes(reply) }
})
app.on('web-contents-created', (_e, contents) => {
  const send = contents.send.bind(contents)
  contents.send = (channel, ...a) => { bump(`send ${channel}`, a); return send(channel, ...a) }
})
// The bench's own timers (event-loop monitor below) use the unpatched setTimeout, so they never count as app timer fires.
const rawSetTimeout = global.setTimeout
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
// Main-process CPU in ms (getrusage: every thread of the browser process), µs resolution where
// getAppMetrics() counts in 10 ms scheduler ticks: per-switch/per-close numbers need the precision.
const mainCpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0)
const top = (m, n = 8) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n))

// ---- main-process responsiveness: event-loop blocks ----
// A 10 ms tick on the unpatched setTimeout; how late each tick fires is how long the main thread was
// busy (JS or native work on the UI thread: IPC, capturePage results, JPEG encodes, view layout).
// Input, IPC and paint scheduling for every window wait behind such a block, so this is what a
// user feels as a hitch. A tick later than LONG_TASK_MS counts as a long task (like the renderer's
// Long Tasks API); blockedMs sums the part of each long task over LONG_TASK_MS (total blocking time).
// Only on while a phase is measured: never during idle, so idle CPU and timer counts stay clean.
const LOOP_TICK_MS = 10
const LONG_TASK_MS = 50
const loop = { on: false, phase: '', stats: new Map(), hang: { maxBlockMs: 0, phase: '' } }
const loopStats = () => ({ maxBlockMs: 0, longTasks: 0, blockedMs: 0, ticks: 0 })
function loopTick() {
  const t0 = performance.now()
  rawSetTimeout(() => {
    if (!loop.on) return
    const lag = Math.max(0, performance.now() - t0 - LOOP_TICK_MS)
    const s = loop.stats.get(loop.phase)
    s.ticks++
    if (lag > s.maxBlockMs) s.maxBlockMs = lag
    if (lag > LONG_TASK_MS) { s.longTasks++; s.blockedMs += lag - LONG_TASK_MS }
    if (lag > loop.hang.maxBlockMs) { loop.hang.maxBlockMs = lag; loop.hang.phase = loop.phase }
    loopTick()
  }, LOOP_TICK_MS)
}
function startLoop(phase) {
  loop.phase = phase
  if (!loop.stats.has(phase)) loop.stats.set(phase, loopStats())
  if (!loop.on) { loop.on = true; loopTick() }
}
/** Stop monitoring; the phase's {maxBlockMs, longTasks, blockedMs}. */
function stopLoop(phase = loop.phase) {
  loop.on = false
  const s = loop.stats.get(phase) || loopStats()
  return { maxBlockMs: round(s.maxBlockMs), longTasks: s.longTasks, blockedMs: round(s.blockedMs) }
}

// ---- shell UI jank: long animation frames in the toolbar/sidebar/content renderers ----
// The Long Animation Frames API (Chromium 123+) reports every frame (or task) that took over 50 ms
// from start to paint in that renderer: a hitch in the toolbar or sidebar while tabs switch, open
// or close. No rAF loop, so measuring costs the renderers nothing between long frames. Event Timing
// entries (input -> next paint, 16 ms+) are kept too, for the keyboard tab switch.
const SHELL_OBSERVER = `(() => {
  if (window.__perfFrames) return true
  const f = window.__perfFrames = { loaf: [], events: [] }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) f.loaf.push([performance.timeOrigin + e.startTime, e.duration, e.blockingDuration || 0]) }).observe({ type: 'long-animation-frame' }) } catch { f.noLoaf = true }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) f.events.push([performance.timeOrigin + e.startTime, e.duration, e.name]) }).observe({ type: 'event', durationThreshold: 16 }) } catch {}
  return true
})()`
async function observeShell() {
  for (const c of webContents.getAllWebContents()) {
    if (c.isDestroyed() || !surfaceOf(c)) continue
    await c.executeJavaScript(SHELL_OBSERVER).catch(() => {})
  }
}
/** Long frames in every shell renderer between two epoch times: count, longest, summed blocking. */
async function shellJank(t0, t1) {
  let longFrames = 0; let maxFrameMs = 0; let blockingMs = 0
  for (const c of webContents.getAllWebContents()) {
    if (c.isDestroyed() || !surfaceOf(c)) continue
    const entries = await c.executeJavaScript(`(window.__perfFrames?.loaf || []).filter((e) => e[0] >= ${t0} && e[0] < ${t1})`).catch(() => [])
    // A long frame with no blocking time is a renderer waiting for its turn to draw (hidden or
    // throttled surface), not a hitch: count only frames whose tasks blocked input.
    for (const [, d, b] of entries) { if (!(b > 0)) continue; longFrames++; maxFrameMs = Math.max(maxFrameMs, d); blockingMs += b }
  }
  return { shellLongFrames: longFrames, shellMaxFrameMs: round(maxFrameMs), shellBlockingMs: round(blockingMs) }
}

// ---- fixture site ----
const PAGE = (n) => `<!doctype html><meta charset="utf-8"><title>Page ${n}</title><style>body{font:16px system-ui;margin:40px}</style>
<h1>Fixture page ${n}</h1>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. </p>'.repeat(40)}
<img src="/img.svg" width="300" height="120"><script>window.__t=0;setInterval(()=>{window.__t++},1000)</script>`
// Video fixture page: a classed layout like a real site, so the frame's DOM observer has work to report.
const VIDEO_PAGE = (n) => `<!doctype html><meta charset="utf-8"><title>Video ${n}</title><div class="app-shell"><header id="masthead" class="masthead"><a href="/home">Home</a></header>
<main class="watch-grid">${Array.from({ length: 30 }, (_, i) => `<div class="card card-${i}" id="v${i}"><a class="thumb" href="/v${i}">Video ${i}</a></div>`).join('')}<div class="perf-ad-7">ad</div></main></div>`
const server = createServer((req, res) => {
  if (/^\/v\d+$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(VIDEO_PAGE(req.url)); return }
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
// Memory of the given processes (MB): PSS on Linux, working set elsewhere, like memory().
function processMB(pids) {
  const kb = app.getAppMetrics().filter((e) => pids.has(e.pid)).reduce((n, e) => n + (isLinux ? pssKB(e.pid) : (e.memory?.workingSetSize || 0)), 0)
  return Math.round(kb / 1024)
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

// Fixture filters shaped like uBO's: generic hiding, site CSS, and scriptlets on video.localhost that
// share helpers (uBO's YouTube rules inject ~30 scriptlets that all inline safeSelf & co.).
const fixtureHelper = (name, size) => `function ${name}(){if(${name}.v)return ${name}.v;const t={${Array.from({ length: size }, (_, i) => `k${i}:${i}`).join(',')}};${name}.v=t;return t}`
const FIXTURE_SCRIPTLETS = JSON.stringify({
  redirects: [],
  scriptlets: [
    { name: 'safe-self.fn', aliases: [], body: fixtureHelper('safeSelf', 600), dependencies: [] },
    { name: 'match-props.fn', aliases: [], body: fixtureHelper('matchPropsFn', 250), dependencies: ['safe-self.fn'] },
    { name: 'proxy-apply.fn', aliases: [], body: fixtureHelper('proxyApplyFn', 200), dependencies: ['safe-self.fn'] },
    { name: 'prune-object.fn', aliases: [], body: fixtureHelper('pruneObjectFn', 300), dependencies: ['match-props.fn'] },
    { name: 'perf-prune.js', aliases: [], body: 'function perfPrune(a){safeSelf();pruneObjectFn();window.__perfPrune=(window.__perfPrune||0)+1}', dependencies: ['prune-object.fn', 'safe-self.fn'] },
    { name: 'perf-fetch.js', aliases: [], body: 'function perfFetch(a){safeSelf();proxyApplyFn();matchPropsFn();window.__perfFetch=a}', dependencies: ['proxy-apply.fn', 'match-props.fn', 'safe-self.fn'] },
    { name: 'perf-set.js', aliases: [], body: 'function perfSet(a,b){safeSelf();window[a]=b}', dependencies: ['safe-self.fn'] }
  ]
})
const FIXTURE_FILTERS = [
  '! surffish perf fixture', '||ads.invalid^', '##.perf-fixture-ad',
  ...Array.from({ length: 300 }, (_, i) => `##.perf-ad-${i}`),
  ...Array.from({ length: 40 }, (_, i) => `##div[id^="perf-gpt-${i}"]`),
  ...Array.from({ length: 20 }, (_, i) => `video.localhost##.perf-promo-${i}`),
  ...Array.from({ length: 6 }, (_, i) => `video.localhost##+js(perf-prune, playerResponse.adSlots${i})`),
  ...Array.from({ length: 6 }, (_, i) => `video.localhost##+js(perf-fetch, /ad${i}/)`),
  ...Array.from({ length: 6 }, (_, i) => `video.localhost##+js(perf-set, perfFlag${i}, true)`)
].join('\n')

// Seed an offline ad-filter engine built by the app's own adblock module (tiny fixture lists),
// so the bench never downloads filter lists and both builds start from the same state.
// PERF_ADBLOCK_ENGINE=<adblock-engine-v2.bin> seeds a real prebuilt engine instead.
async function seedProfile() {
  if (KEEP_PROFILE && existsSync(join(userData, 'adblock-engine-v2.bin'))) return 'kept'
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  const dest = join(userData, 'adblock-engine-v2.bin')
  if (process.env.PERF_ADBLOCK_ENGINE && existsSync(process.env.PERF_ADBLOCK_ENGINE)) { copyFileSync(process.env.PERF_ADBLOCK_ENGINE, dest); return 'prebuilt' }
  try {
    const mod = await import(pathToFileURL(join(APP_DIR, 'out/main/adblock-engine.js')).href)
    // The fixture rules in the first list only (every list is fetched; duplicates would multiply the scriptlets).
    const firstList = mod.FILTER_LIST_SOURCES?.[0]?.url
    const fetch = async (url) => new Response(url.endsWith('.json') ? FIXTURE_SCRIPTLETS : url === firstList ? FIXTURE_FILTERS : '! surffish perf fixture\n')
    const { engine } = await mod.buildFilterEngine(fetch, mod.FILTER_LIST_SOURCES)
    writeFileSync(dest, engine.serialize())
    return 'fixture'
  } catch (e) {
    step(`adblock fixture engine not seeded (${e.message}); the app may fetch lists`)
    return 'none'
  }
}

// Cold-start phases, all in ms since process start with the bench's own profile seeding cut out
// (like windowMs/firstPaintMs). Main-process marks come from the app's traceStartup()
// (src/main/startup-defer.ts, globalThis.__surffishStartupMarks); builds without it report NaN (n/a).
const APP_MARKS = {
  profileReadyMs: 'profile ready',
  windowCreatedMs: 'windows created',
  windowPaintedMs: 'first window painted',
  adblockReadyMs: 'adblock engine ready',
  extensionsReadyMs: 'extensions ready, page requests released'
}
const appMarks = () => globalThis.__surffishStartupMarks
const markAt = (label) => appMarks()?.find((m) => m[0] === label)?.[1] ?? NaN
// A shell surface's start-up user-timing mark (src/renderer/src/main.tsx) as epoch ms; NaN if absent.
// surffish:first-commit = first React commit (script loaded, compiled, run); surffish:first-frame = a frame produced after it (visible surfaces only).
const userMarkOf = (wc, name, timeoutMs) => wc.executeJavaScript(`new Promise((r) => { const end = Date.now() + ${timeoutMs}; const f = () => { const e = performance.getEntriesByName(${JSON.stringify(name)})[0]; if (e) r(performance.timeOrigin + e.startTime); else if (Date.now() > end) r(null); else setTimeout(f, 5) }; f() })`).then((v) => (v == null ? NaN : v), () => NaN)
// Inside one surface's renderer: its navigation start to its first React commit (fetch, compile and run
// the shell bundle, first render), free of process-launch scheduling noise. NaN without the mark.
const commitSinceNavOf = (wc) => wc.executeJavaScript(`(() => { const e = performance.getEntriesByName('surffish:first-commit')[0]; return e ? e.startTime : null })()`).then((v) => (v == null ? NaN : round(v)), () => NaN)
const loadEndOf = (wc) => wc.executeJavaScript(`(() => { const n = performance.getEntriesByType('navigation')[0]; return n && n.loadEventEnd > 0 ? performance.timeOrigin + n.loadEventEnd : null })()`).then((v) => (v == null ? NaN : v), () => NaN)

async function run() {
  const result = { platform: process.platform, arch: process.arch, electron: process.versions.electron }
  app.setPath('userData', userData)
  const seedStart = Date.now()
  result.adblockEngine = await seedProfile()
  const seedEnd = Date.now()
  const seedMs = seedEnd - seedStart // excluded from startup timings
  // An event's time on the cold-start timeline: before the seed as is, during it clamped, after it minus the seed.
  const at = (t) => !Number.isFinite(t) ? NaN : Math.round(t <= seedStart ? t - T_PROCESS_START : t < seedEnd ? seedStart - T_PROCESS_START : t - T_PROCESS_START - seedMs)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  counting = true // startup IPC
  const tImport = performance.now()
  await import(pathToFileURL(join(APP_DIR, 'out/main/index.js')).href)
  const mainImportMs = performance.now() - tImport
  const tMainLoaded = Date.now()
  await app.whenReady()
  win = await waitFor(() => BaseWindow.getAllWindows()[0], 'window', 30000)
  const tWindow = Date.now() - T_PROCESS_START - seedMs
  const toolbar = await waitFor(() => win.contentView.children.find((v) => surfaceOf(v.webContents) === 'toolbar'), 'toolbar', 30000)
  const content = await waitFor(() => win.contentView.children.find((v) => surfaceOf(v.webContents) === 'content'), 'content', 30000)
  await waitFor(() => toolbar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'toolbar api', 30000)
  // First contentful paint of the New Tab page (the toolbar surface never reports FCP).
  const contentFcp = await Promise.race([fcpOf(content.webContents), delay(10000).then(() => NaN)])
  result.startup = { windowMs: Math.round(tWindow), firstPaintMs: Math.round(contentFcp - T_PROCESS_START - seedMs), mainImportMs: round(mainImportMs) }
  step('first paint')
  // Phases. The toolbar's mark is normally long there by now; a build without marks gets a short grace.
  // The toolbar is hidden behind a New Tab page (the page draws its own bar), so its start-up number is
  // its first React commit: script loaded, compiled and run, ready to show.
  const hasMarks = Array.isArray(appMarks())
  const toolbarReady = await userMarkOf(toolbar.webContents, 'surffish:first-commit', hasMarks ? 5000 : 300)
  const phases = {
    electronBootMs: at(T_BENCH_START),
    electronReadyMs: at(tAppReady),
    mainLoadedMs: at(tMainLoaded),
    profileReadyMs: at(markAt(APP_MARKS.profileReadyMs)),
    windowCreatedMs: at(markAt(APP_MARKS.windowCreatedMs)),
    toolbarReadyMs: at(toolbarReady),
    newTabLoadMs: at(await loadEndOf(content.webContents)),
    windowPaintedMs: NaN,
    adblockReadyMs: NaN,
    extensionsReadyMs: NaN
  }
  // Deferred start-up (ad filter, extensions) finishes after the first paint: wait for its last mark.
  if (hasMarks) await waitFor(() => Number.isFinite(markAt(APP_MARKS.extensionsReadyMs)), 'deferred start-up', 20000).catch(() => step('deferred start-up mark not seen'))
  for (const key of ['windowPaintedMs', 'adblockReadyMs', 'extensionsReadyMs']) phases[key] = at(markAt(APP_MARKS[key]))
  result.startup.phases = phases
  result.startup.renderer = { toolbarCommitMs: await commitSinceNavOf(toolbar.webContents), contentCommitMs: await commitSinceNavOf(content.webContents) }
  step(`phases ${JSON.stringify(phases)}`)
  if (TRACE_FILE) {
    await contentTracing.stopRecording(TRACE_FILE).then((f) => step(`trace written: ${f}`), (e) => step(`trace failed: ${e.message}`))
  }
  // Warm-up launch (run.ts, discarded): only pays the first-launch costs, so stop here.
  if (process.env.PERF_WARMUP === '1') return result
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
  result.startup.ipcTop = top(ipc.channels, 12)
  result.mem1 = memory()
  await observeShell()

  await openTabs(1, TABS_MID - 1)
  await delay(1500)
  result.memMid = { tabs: TABS_MID, ...memory() }
  step(`${TABS_MID} tabs`)

  // IPC while opening the next batch of tabs (20 by default).
  resetIpc(); counting = true
  const c0 = cpuSeconds(); const w0 = Date.now()
  startLoop('openTabs')
  await openTabs(TABS_MID, TABS_MAX - TABS_MID)
  await delay(1000)
  counting = false
  const c1 = cpuSeconds()
  const openLoop = stopLoop()
  result.openTabs = { tabs: TABS_MAX - TABS_MID, ipcCount: ipc.count, ipcBytes: ipc.bytes, wallMs: Date.now() - w0, mainCpuMs: Math.round((c1.main - c0.main) * 1000), loop: openLoop, ...(await shellJank(w0, Date.now())), top: top(ipc.channels) }
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
  const s0 = cpuSeconds(); const sm0 = mainCpuMs(); const sw0 = Date.now()
  startLoop('tabSwitch')
  for (let i = 0; i < SWITCHES; i++) {
    const tab = tabs[i % tabs.length]
    const wc = byPath(new URL(tab.url).pathname)
    const s = performance.now()
    await api(`window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`)
    if (wc) { await waitFor(() => attached().get(wc)?.getVisible(), 'attached', 5000); await twoFrames(wc) }
    sw.push(performance.now() - s)
    await delay(100)
  }
  const s1 = cpuSeconds(); const sm1 = mainCpuMs()
  const switchLoop = stopLoop()
  result.tabSwitch = {
    medianMs: round(median(sw)), samples: sw.length,
    // Main/shell CPU per switch: the activation, the outgoing tab's capture (overview thumbnail, wake
    // snapshot) and the broadcasts the shell renders.
    mainCpuMsPerSwitch: round((sm1 - sm0) / SWITCHES), shellCpuMsPerSwitch: round(((s1.shell - s0.shell) * 1000) / SWITCHES),
    loop: switchLoop, ...(await shellJank(sw0, Date.now()))
  }
  step('tab switch')

  // Keyboard tab switch (Ctrl/Cmd+1..3 sent to the page, like a user): keystroke -> the tab's view
  // attached -> two frames painted. The bench marks every tab as on screen long enough for its picture
  // to be kept (SURFFISH_WAKE_SNAPSHOT_MIN_SHOWN_MS=0), and waits KEY_SWITCH_GAP_MS between keys so
  // the deferred wake-snapshot encode lands inside the switch that caused it: main CPU per switch is
  // then the full cost of leaving a tab you were reading. Three tabs, cycled twice: the second
  // cycle leaves tabs that haven't changed since their last picture.
  const KEY_SWITCHES = cfg.keySwitches ?? 5
  const KEY_SWITCH_GAP_MS = 420
  const primary = process.platform === 'darwin' ? 'meta' : 'control'
  const visiblePage = () => [...attached()].find(([c, v]) => !c.isDestroyed() && !surfaceOf(c) && v.getVisible())?.[0]
  process.env.SURFFISH_WAKE_SNAPSHOT_MIN_SHOWN_MS = '0'
  const ks = []
  const k0 = mainCpuMs(); const kw0 = Date.now()
  startLoop('keySwitch')
  for (let i = 0; i < KEY_SWITCHES; i++) {
    const n = (i % 3) + 1
    const wc = byPath(`/p${n - 1}`)
    const from = visiblePage()
    if (!wc || !from) break
    const s = performance.now()
    from.sendInputEvent({ type: 'keyDown', keyCode: String(n), modifiers: [primary] })
    from.sendInputEvent({ type: 'keyUp', keyCode: String(n), modifiers: [primary] })
    const ok = await waitFor(() => attached().get(wc)?.getVisible(), 'key switch', 3000).then(() => true, () => false)
    if (ok) { await twoFrames(wc); if (from !== wc) ks.push(performance.now() - s) }
    await delay(Math.max(0, KEY_SWITCH_GAP_MS - (performance.now() - s)))
  }
  await delay(100)
  const k1 = mainCpuMs()
  const keyLoop = stopLoop()
  delete process.env.SURFFISH_WAKE_SNAPSHOT_MIN_SHOWN_MS
  result.keySwitch = {
    medianMs: round(median(ks)), samples: ks.length,
    mainCpuMsPerSwitch: ks.length ? round((k1 - k0) / ks.length) : NaN,
    loop: keyLoop, ...(await shellJank(kw0, Date.now()))
  }
  step(`key switch ${JSON.stringify(result.keySwitch)}`)

  // Pointer over a page: moving the mouse and scrolling with the wheel. Every mouse event a page gets
  // also reaches main (before-mouse-event: sidebar edge reveal, popover dismiss), and real input is
  // routed through the main (UI) thread, so main CPU and blocks here are what pointer input costs.
  const page = visiblePage()
  if (page) {
    await page.executeJavaScript(`(() => { window.__perfScrolls = 0; addEventListener('scroll', () => window.__perfScrolls++, { passive: true }); scrollTo(0, 0); return true })()`).catch(() => {})
    const bounds = attached().get(page)?.getBounds() || { width: 800, height: 600 }
    const POINTER_EVENTS = 48
    const pc0 = mainCpuMs(); const pw0 = Date.now()
    startLoop('pointer')
    for (let i = 0; i < POINTER_EVENTS; i++) {
      const x = Math.round(bounds.width * (0.3 + 0.4 * (i / POINTER_EVENTS))); const y = Math.round(bounds.height / 2)
      if (i % 4 === 3) page.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: i < POINTER_EVENTS / 2 ? -100 : 100, canScroll: true })
      else page.sendInputEvent({ type: 'mouseMove', x, y })
      await delay(8)
    }
    await delay(200)
    const pc1 = mainCpuMs()
    const pointerLoop = stopLoop()
    const scrolls = await page.executeJavaScript('window.__perfScrolls || 0').catch(() => 0)
    result.pointer = { events: POINTER_EVENTS, scrollEvents: scrolls, mainCpuMs: round(pc1 - pc0), loop: pointerLoop, ...(await shellJank(pw0, Date.now())) }
    step(`pointer ${JSON.stringify(result.pointer)}`)
  }

  // New tab with a site: create -> first contentful paint in the new tab.
  const nt = []
  const created = []
  const nw0 = Date.now()
  startLoop('newTab')
  for (let i = 0; i < NEW_TABS; i++) {
    const s = performance.now()
    created.push(await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/n${i}`)})`))
    const wc = await waitFor(() => byPath(`/n${i}`), 'new tab', 10000)
    const paint = await fcpOf(wc)
    nt.push(paint - (performance.timeOrigin + s))
    await delay(100)
  }
  const blank = []
  for (let i = 0; i < 3; i++) {
    const s = performance.now()
    created.push(await api('window.api.browser.tabs.create()'))
    await waitFor(() => attached().get(content.webContents)?.getVisible(), 'new tab page', 5000)
    await twoFrames(content.webContents)
    blank.push(performance.now() - s)
    await delay(100)
  }
  const newTabLoop = stopLoop()
  result.newTab = { siteFirstPaintMs: round(median(nt)), newTabPageMs: round(median(blank)), loop: newTabLoop, ...(await shellJank(nw0, Date.now())) }
  step('new tab')

  // Closing tabs: the tabs the new-tab step opened, one at a time, each close activating the next
  // (close -> next tab on screen, the shell re-rendering its list).
  const toClose = created.filter(Boolean).reverse()
  const cl = []
  const cc0 = mainCpuMs(); const cw0 = Date.now()
  startLoop('closeTabs')
  for (const t of toClose) {
    const s = performance.now()
    await api(`window.api.browser.tabs.close(${JSON.stringify(t)})`)
    const shown = visiblePage() ?? (attached().get(content.webContents)?.getVisible() ? content.webContents : null)
    if (shown) await twoFrames(shown).catch(() => {})
    cl.push(performance.now() - s)
    await delay(100)
  }
  const cc1 = mainCpuMs()
  const closeLoop = stopLoop()
  result.closeTabs = { closed: cl.length, medianMs: round(median(cl)), mainCpuMsPerClose: cl.length ? round((cc1 - cc0) / cl.length) : NaN, loop: closeLoop, ...(await shellJank(cw0, Date.now())) }
  step(`close tabs ${JSON.stringify(result.closeTabs)}`)
  // Shell jank over every tab operation above (open, switch by API and by key, new tab, close).
  const tabOps = ['openTabs', 'tabSwitch', 'keySwitch', 'newTab', 'closeTabs'].map((k) => result[k]).filter(Boolean)
  result.shell = {
    longFrames: tabOps.reduce((n, r) => n + (r.shellLongFrames || 0), 0),
    blockingMs: round(tabOps.reduce((n, r) => n + (r.shellBlockingMs || 0), 0)),
    maxFrameMs: round(Math.max(0, ...tabOps.map((r) => r.shellMaxFrameMs || 0)))
  }

  // Window open/close cycles: anything left behind is a leak.
  const count = () => ({ windows: BaseWindow.getAllWindows().length, webContents: webContents.getAllWebContents().length, shell: webContents.getAllWebContents().filter((c) => !c.isDestroyed() && surfaceOf(c)).length, ...memory() })
  // Before each sample, every app-UI renderer gets a major GC and a critical memory-pressure
  // notification (what macOS sends under pressure), so growth counts only memory that can't be
  // reclaimed: a leak. Where the UI surfaces of several windows share one renderer (process-per-site),
  // a closed window's documents stay in that renderer's V8 heap until the next major GC (~10 s of
  // idle), and Blink's caches/allocator keep its native memory until pressure: +60-90 MB after 3
  // cycles in the PR #159 build, +2-6 MB once reclaimed. The unreclaimed number is kept as
  // windowCycles.memGrowthBeforeGcMB (diagnostic, not checked).
  const collectShellGarbage = async () => {
    const was = memory().totalMB
    const seen = new Set()
    for (const c of webContents.getAllWebContents()) {
      if (c.isDestroyed() || !surfaceOf(c) || seen.has(c.getOSProcessId())) continue
      seen.add(c.getOSProcessId())
      try {
        c.debugger.attach('1.3')
        await c.debugger.sendCommand('HeapProfiler.collectGarbage')
        await c.debugger.sendCommand('Memory.simulatePressureNotification', { level: 'critical' })
      } catch (e) {
        step(`window cycles: GC in the UI renderer skipped (${e.message})`)
      } finally {
        try { c.debugger.detach() } catch {}
      }
    }
    await delay(300)
    step(`window cycles: reclaimed in ${seen.size} UI renderer(s): ${was} -> ${memory().totalMB} MB`)
  }
  await delay(200)
  await collectShellGarbage()
  const before = count()
  startLoop('windowCycles')
  for (let i = 0; i < WINDOW_CYCLES; i++) {
    await api('window.api.browser.tabs.newWindow(false)')
    const w2 = await waitFor(() => BaseWindow.getAllWindows().find((w) => w !== win && w.isVisible()), 'second window', 15000)
    await delay(400)
    w2.close()
    await waitFor(() => BaseWindow.getAllWindows().length === 1, 'window closed', 15000)
    await delay(200)
  }
  const windowLoop = stopLoop()
  await delay(600)
  const afterBeforeGc = memory().totalMB
  await collectShellGarbage()
  const after = count()
  result.windowCycles = { cycles: WINDOW_CYCLES, processesGrowth: after.processes - before.processes, webContentsGrowth: after.webContents - before.webContents, shellGrowth: after.shell - before.shell, memGrowthMB: after.totalMB - before.totalMB, memGrowthBeforeGcMB: afterBeforeGc - before.totalMB, loop: windowLoop }
  step('window cycles')
  // Hang detection: the longest the main thread was blocked in any measured phase (after start-up).
  result.hang = { maxBlockMs: round(loop.hang.maxBlockMs), phase: loop.hang.phase, longTasks: [...loop.stats.values()].reduce((n, s) => n + s.longTasks, 0) }

  // Mixed sites: SITE_TABS tabs over SITES sites (*.localhost, separate sites to Chromium). How many
  // renderers host them (their pages and iframes) and those processes' memory.
  const siteTabUrl = (i) => `http://site${i % SITES}.localhost:${server.address().port}/s${i}`
  const isSiteTab = (c) => /\/\/site\d+\.localhost:\d+\/s\d+$/.test(c.getURL())
  for (let i = 0; i < SITE_TABS; i++) await api(`window.api.browser.tabs.create(${JSON.stringify(siteTabUrl(i))})`)
  await waitFor(() => webContents.getAllWebContents().filter((c) => !c.isDestroyed() && isSiteTab(c) && !c.isLoading()).length >= SITE_TABS, 'site tabs loaded', 60000)
  await delay(1000)
  const sitePids = new Set()
  for (const c of webContents.getAllWebContents()) {
    if (c.isDestroyed() || !isSiteTab(c)) continue
    try { for (const f of c.mainFrame.framesInSubtree) if (f.osProcessId > 0) sitePids.add(f.osProcessId) } catch { sitePids.add(c.getOSProcessId()) }
  }
  result.sites = { tabs: SITE_TABS, sites: SITES, renderers: sitePids.size, memMB: processMB(sitePids) }
  step('mixed sites')

  // Ad-filter cosmetics: what one navigation to a page with site CSS + scriptlets costs (bytes sent to
  // the frame, main-process time answering it), and that same-document navigations inject nothing.
  const videoUrl = (i) => `http://video.localhost:${server.address().port}/v${i}`
  const isVideo = (c, i) => c.getURL() === videoUrl(i)
  adblock.counting = true
  for (let i = 0; i < ADBLOCK_NAVS; i++) {
    await api(`window.api.browser.navigate(${JSON.stringify(videoUrl(i))})`)
    await waitFor(() => webContents.getAllWebContents().find((c) => !c.isDestroyed() && isVideo(c, i) && !c.isLoading()), `video ${i}`, 15000)
    await delay(150)
  }
  const navStarts = adblock.starts
  const video = webContents.getAllWebContents().find((c) => !c.isDestroyed() && isVideo(c, ADBLOCK_NAVS - 1))
  if (video) await video.executeJavaScript(`for (let i = 0; i < 3; i++) history.pushState({}, '', '/spa' + i); location.hash = 'x'`)
  await delay(300)
  adblock.counting = false
  result.adblock = {
    navigations: ADBLOCK_NAVS,
    frameStartBytes: Math.round(adblock.bytes / ADBLOCK_NAVS),
    frameStartMainMs: round(adblock.ms / ADBLOCK_NAVS, 2),
    frameStarts: round(navStarts / ADBLOCK_NAVS, 2),
    frameUpdates: round(adblock.updates / ADBLOCK_NAVS, 2),
    sameDocFrameStarts: adblock.starts - navStarts
  }
  step('adblock cosmetics')
  return result
}

run().then((r) => {
  const json = JSON.stringify(r)
  if (OUT) writeFileSync(OUT, json)
  console.log(`PERF_SAMPLE ${json}`)
  server.close()
  if (!KEEP_PROFILE) rmSync(userData, { recursive: true, force: true })
  // A kept profile: let the session flush (cookies, V8 code cache) before exiting, like a real quit.
  if (KEEP_PROFILE) app.quit()
  else app.exit(0)
}, (e) => { console.error('[perf] FAILED', e); if (!KEEP_PROFILE) rmSync(userData, { recursive: true, force: true }); app.exit(1) })
