// Resource probe: opens a few busy fixture tabs (rAF loop, fast timer, a page that never stops
// loading), switches away from them and samples what keeps running in the background.
// Prints a JSON report and asserts background tabs are hidden and throttled.
// Runs the production build: `bun run build && bun run test:electron-perf`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-perf-probe.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-perf-probe-${process.pid}`)
const REPORT_ONLY = process.argv.includes('--report-only')
const COUNTERS = `<script>
window.__raf = 0; window.__ticks = 0;
(function frame() { window.__raf++; requestAnimationFrame(frame) })();
setInterval(() => { window.__ticks++ }, 10);
</script>`
const server = createServer((request, response) => {
  if (request.url === '/hang') {
    // Never finishes, so the tab stays "loading" (spinner on) for as long as the probe runs.
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.write('.')
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  const body = request.url === '/loading'
    ? `<title>Forever loading</title>${COUNTERS}<iframe src="/hang"></iframe>`
    : `<title>Busy ${request.url}</title>${COUNTERS}<div style="width:40px;height:40px;background:red;animation:s 1s linear infinite"></div><style>@keyframes s{to{transform:rotate(360deg)}}</style>`
  response.end(`<!doctype html><meta charset="utf-8">${body}`)
})

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
let mainWindow

async function waitFor(predicate, description, timeout = 20000) {
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

function surfaceOf(contents) {
  try {
    return new URL(contents.getURL()).searchParams.get('surface')
  } catch {
    return null
  }
}

function attachedContents() {
  return new Map(mainWindow.contentView.children.filter((view) => view.webContents).map((view) => [view.webContents, view]))
}

function label(contents) {
  const surface = surfaceOf(contents)
  if (surface) return `shell:${surface}`
  const url = contents.getURL()
  if (url.startsWith('data:')) return 'overlay:data'
  return url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '') || '(blank)'
}

async function counters(contents) {
  try {
    // A frozen or crashed page never answers; don't let it hang the probe.
    return await Promise.race([
      contents.executeJavaScript('({ raf: window.__raf ?? -1, ticks: window.__ticks ?? -1, visibility: document.visibilityState })'),
      delay(1500).then(() => null)
    ])
  } catch {
    return null
  }
}

async function sample(seconds) {
  const pages = webContents.getAllWebContents().filter((contents) => !contents.isDestroyed())
  const before = new Map()
  for (const contents of pages) before.set(contents.id, await counters(contents))
  app.getAppMetrics()
  await delay(seconds * 1000)
  const metrics = app.getAppMetrics()
  const attached = attachedContents()
  const rows = []
  for (const contents of pages) {
    if (contents.isDestroyed()) continue
    const start = before.get(contents.id)
    const end = await counters(contents)
    const pid = contents.getOSProcessId()
    const metric = metrics.find((entry) => entry.pid === pid)
    rows.push({
      label: label(contents),
      type: contents.getType(),
      pid,
      attached: attached.has(contents),
      viewVisible: attached.get(contents)?.getVisible() ?? false,
      throttled: contents.getBackgroundThrottling(),
      visibility: end?.visibility ?? null,
      rafPerSecond: start && end && start.raf >= 0 ? Math.round((end.raf - start.raf) / seconds) : null,
      ticksPerSecond: start && end && start.ticks >= 0 ? Math.round((end.ticks - start.ticks) / seconds) : null,
      cpu: metric ? Math.round(metric.cpu.percentCPUUsage * 10) / 10 : null,
      wakeups: metric?.cpu.idleWakeupsPerSecond ?? null
    })
  }
  const processes = metrics.map((entry) => ({ pid: entry.pid, type: entry.type, name: entry.name ?? entry.serviceName ?? '', cpu: Math.round(entry.cpu.percentCPUUsage * 10) / 10, wakeups: entry.cpu.idleWakeupsPerSecond, memoryMB: Math.round(entry.memory.workingSetSize / 1024) }))
  return { rows, processes }
}

const step = (text) => process.stderr.write(`[perf-probe] ${text}\n`)

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  const toolbar = await waitFor(() => mainWindow.contentView.children.find((view) => surfaceOf(view.webContents) === 'toolbar'), 'the toolbar surface')
  await waitFor(() => toolbar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')

  step('shell ready')
  const api = (expression) => toolbar.webContents.executeJavaScript(expression)
  await api(`window.api.browser.navigate(${JSON.stringify(`${origin}/busy-a`)})`)
  await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/busy-b`)})`)
  if (!process.env.PROBE_NO_LOADING) await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/loading`)})`)
  await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/busy-c`)})`)
  await waitFor(() => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith('/busy-c') && !contents.isLoading()), 'the last tab to load')
  step('tabs loaded')
  await delay(1500)

  const report = { onSite: await sample(3) }
  // New Tab: every site view is hidden behind the content surface.
  await api('window.api.browser.tabs.create()')
  await delay(1000)
  report.onNewTab = await sample(3)
  // Diagnostics: the Task Manager page samples, labels and lists every process.
  const content = mainWindow.contentView.children.find((view) => surfaceOf(view.webContents) === 'content')
  await api('window.api.browser.chrome.set({ sidebarMode: "diagnostics" })')
  await waitFor(() => content.webContents.executeJavaScript('document.querySelectorAll(".diagnostics-table tbody tr").length > 3'), 'the Diagnostics table to fill')
  await delay(2500)
  if (process.env.SURFFISH_PERF_SCREENSHOT) writeFileSync(process.env.SURFFISH_PERF_SCREENSHOT, (await content.webContents.capturePage()).toPNG())
  report.diagnostics = await content.webContents.executeJavaScript(`({
    labels: [...document.querySelectorAll('.diagnostics-label')].map((node) => node.textContent),
    totals: [...document.querySelectorAll('.diagnostics-totals strong')].map((node) => node.textContent)
  })`)
  report.tabHint = await content.webContents.executeJavaScript('[...document.querySelectorAll("[data-browser-tab-id]")].map((node) => node.title).join("\\n---\\n")')
  // Kill a background tab's renderer: the tab goes to sleep (reloads when selected). With same-site process
  // sharing its same-site tabs share that renderer and go with it; other sites and the UI never do.
  const victim = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith('/busy-a'))
  report.killed = await content.webContents.executeJavaScript(`window.api.browser.diagnostics.kill(${victim.getOSProcessId()})`)
  report.sleepingAfterKill = await waitFor(async () => {
    const tabs = await api('window.api.browser.tabs.get()')
    return tabs.find((tab) => tab.url.endsWith('/busy-a') && tab.sleeping) ? true : null
  }, 'the killed tab to go to sleep', 5000).catch(() => false)
  report.shellKillRefused = !(await content.webContents.executeJavaScript(`window.api.browser.diagnostics.kill(${content.webContents.getOSProcessId()})`))
  await api('window.api.browser.chrome.set({ sidebarMode: "tabs" })')
  await delay(300)
  report.hintAfterClose = await content.webContents.executeJavaScript('[...document.querySelectorAll("[data-browser-tab-id]")].some((node) => node.title.includes("CPU"))')
  console.log(`PERF_REPORT ${JSON.stringify(report)}`)

  if (!REPORT_ONLY) {
    const background = report.onSite.rows.filter((row) => /^\/busy-[ab]$|^\/loading$/.test(row.label))
    assert.equal(background.length, 3, 'three background fixture tabs')
    for (const row of background) {
      assert.equal(row.attached, false, `${row.label} is detached from the window while in the background`)
      assert.equal(row.throttled, true, `${row.label} allows background throttling`)
      // The never-finishing page can't run executeJavaScript (Electron waits for load); it is still detached.
      if (row.label === '/loading') continue
      assert.equal(row.visibility, 'hidden', `${row.label} reports document.visibilityState hidden`)
      assert.ok(row.rafPerSecond !== null && row.rafPerSecond <= 1, `${row.label} runs no animation frames in the background (${row.rafPerSecond}/s)`)
    }
    const active = report.onSite.rows.find((row) => row.label === '/busy-c')
    assert.ok(active && active.attached && active.visibility === 'visible', 'the active tab stays attached and visible')
    for (const row of report.onNewTab.rows.filter((entry) => /^\/busy-|^\/loading$/.test(entry.label))) {
      assert.equal(row.attached, false, `${row.label} is detached behind New Tab`)
    }
    const sidebar = report.onSite.rows.find((entry) => entry.label === 'shell:sidebar')
    assert.ok(sidebar && !sidebar.viewVisible, 'the collapsed sidebar overlay is hidden, not just zero-width')
    const content = report.onNewTab.rows.find((entry) => entry.label === 'shell:content')
    assert.ok(content && content.wakeups < 40, `New Tab with a loading tab in the collapsed sidebar stays quiet (${content?.wakeups} wakeups/s)`)
    const labels = report.diagnostics.labels
    for (const expected of ['Browser (main process)', 'GPU process']) {
      assert.ok(labels.includes(expected), `Diagnostics lists ${expected}`)
    }
    // One renderer per surface, or one shared by all of them with same-site process sharing (file://).
    for (const surface of ['toolbar', 'sidebar', 'content']) {
      assert.ok(labels.some((text) => text.startsWith('Surffish UI: ') && text.slice('Surffish UI: '.length).split(', ').includes(surface)), `Diagnostics lists Surffish UI: ${surface}`)
    }
    assert.ok(labels.some((text) => /Busy \/busy-a/.test(text)), 'Diagnostics names tabs by title')
    assert.ok(labels.some((text) => text.startsWith('Utility: ')), 'Diagnostics names utility processes')
    assert.ok(report.diagnostics.totals.every((text) => text && text !== '—'), 'Diagnostics totals are filled in')
    assert.match(report.tabHint, /MB · \d+\.\d% CPU/, 'tab tooltips show memory/CPU while Diagnostics samples')
    assert.equal(report.hintAfterClose, false, 'tab tooltips drop the hint once sampling stops')
    assert.equal(report.killed, true, 'Kill ends a background tab renderer')
    assert.equal(report.sleepingAfterKill, true, 'a killed background tab goes to sleep instead of holding a dead view')
    assert.equal(report.shellKillRefused, true, 'the app UI renderer cannot be killed')
    console.log('Perf probe passed.')
  }
}

run().then(() => app.exit(0), (error) => {
  console.error(error)
  app.exit(1)
})
