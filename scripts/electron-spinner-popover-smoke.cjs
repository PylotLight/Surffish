// Spinner + popover smoke.
// 1. Selecting a sleeping tab must not freeze the sidebar's loading spinner.
// Discards a background tab (the same suspend path memory saver, tab sleep and Diagnostics use), selects it from the sidebar and records, around the wake:
//   - mainMaxGapMs: the longest main-process event-loop stall (a 1 ms interval's worst gap)
//   - spinner: how long the arc sat still after the spinner mounted (`frozenMs`), sampled every
//     frame in the sidebar renderer from the arc's live dash offset
//   - compositor layers in the sidebar while spinning vs idle (the arc must stay paint-only)
// Prints WAKE_REPORT {...} and asserts the spinner starts turning within a frame budget.
// 2. Toolbar popovers (site menu, bookmarks dropdown) close on a press on the page view (a separate
// WebContentsView the toolbar never hears), on Escape, when the toolbar loses focus, and on a
// press elsewhere in the toolbar, not only by clicking their button again.
// Runs the production build: `bun run build && bun run test:electron-spinner-popover`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-spinner-popover-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-spinner-popover-${process.pid}`)
const REPORT_ONLY = process.argv.includes('--report-only')
const ROUNDS = Number(process.env.WAKE_ROUNDS) || 3
const server = createServer((request, response) => {
  // Slow first byte keeps the woken tab "loading" long enough to watch the spinner turn.
  setTimeout(() => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><meta charset="utf-8"><title>Page ${request.url}</title><p>${request.url}</p>`)
  }, request.url.startsWith('/slow') ? 1500 : 0)
})

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const step = (text) => process.stderr.write(`[spinner-popover] ${text}\n`)

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

function surfaceOf(contents) {
  try {
    return new URL(contents.getURL()).searchParams.get('surface')
  } catch {
    return null
  }
}

// Runs in the sidebar renderer: every frame, note whether the woken tab shows a spinner and the arc's angle.
const RECORDER = (tabId) => `(() => {
  const samples = []
  const t0 = performance.now()
  let stop = false
  // Where the arc is round the ring, in degrees: from its dash offset (pathLength 100 = 360°), or
  // from an animated rotation if the spinner is ever drawn that way again.
  const angleOf = () => {
    const row = document.querySelector('[data-browser-tab-id="${tabId}"]')
    const arc = row && row.querySelector('.tab-spinner .tab-spinner-arc')
    if (!arc) return null
    const g = arc.parentNode
    if (g && g.transform && g.transform.animVal.numberOfItems > 0) {
      const m = g.transform.animVal.getItem(g.transform.animVal.numberOfItems - 1).matrix
      return Math.round(Math.atan2(m.b, m.a) * 1800 / Math.PI) / 10
    }
    return Math.round(-parseFloat(getComputedStyle(arc).strokeDashoffset || '0') * 36) / 10
  }
  const frame = () => {
    if (stop) return
    samples.push([Math.round(performance.now() - t0), angleOf()])
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  window.__wakeProbe = { done: () => { stop = true; return samples } }
  return true
})()`

async function layerCount(contents) {
  const devtools = contents.debugger
  if (!devtools.isAttached()) devtools.attach('1.3')
  const layers = await Promise.race([
    new Promise((resolveLayers) => {
      const onMessage = (_event, method, params) => {
        if (method !== 'LayerTree.layerTreeDidChange' || !params.layers) return
        devtools.removeListener('message', onMessage)
        resolveLayers(params.layers)
      }
      devtools.on('message', onMessage)
      // An idle page sends no layer tree until it paints again.
      void devtools.sendCommand('LayerTree.enable').then(() => contents.executeJavaScript(`(() => {
        const root = document.documentElement
        const before = root.style.outlineColor
        root.style.outlineColor = 'rgb(1, 2, 3)'
        requestAnimationFrame(() => { root.style.outlineColor = before })
      })()`))
    }),
    delay(3000).then(() => null)
  ])
  await devtools.sendCommand('LayerTree.disable').catch(() => {})
  return layers ? layers.length : null
}

function analyse(samples) {
  // samples: [ms, angle|null] per sidebar frame
  const firstSpinner = samples.findIndex(([, angle]) => angle !== null)
  let maxFrameGap = 0
  for (let index = 1; index < samples.length; index += 1) maxFrameGap = Math.max(maxFrameGap, samples[index][0] - samples[index - 1][0])
  if (firstSpinner < 0) return { spinnerShown: false, maxFrameGapMs: maxFrameGap }
  const mountedAt = samples[firstSpinner][0]
  const startAngle = samples[firstSpinner][1]
  const moved = samples.slice(firstSpinner).find(([, angle]) => angle !== null && Math.abs(angle - startAngle) > 1)
  const lastSpinner = [...samples].reverse().find(([, angle]) => angle !== null)
  return {
    spinnerShown: true,
    mountedAtMs: mountedAt,
    spinnerVisibleMs: lastSpinner[0] - mountedAt,
    frozenMs: moved ? moved[0] - mountedAt : lastSpinner[0] - mountedAt,
    turned: Boolean(moved),
    maxFrameGapMs: maxFrameGap
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
  const origin = `http://127.0.0.1:${server.address().port}`

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 })
  const viewFor = (surface) => mainWindow.contentView.children.find((view) => surfaceOf(view.webContents) === surface)
  const toolbar = await waitFor(() => viewFor('toolbar'), 'the toolbar surface')
  await waitFor(() => toolbar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const api = (expression) => toolbar.webContents.executeJavaScript(expression)
  await api('window.api.browser.chrome.set({ sidebarPinned: true })')
  const sidebar = await waitFor(() => viewFor('sidebar'), 'the sidebar surface')
  await waitFor(() => sidebar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'the sidebar renderer')
  const content = await waitFor(() => viewFor('content'), 'the content surface')
  step('shell ready')

  await api(`window.api.browser.navigate(${JSON.stringify(`${origin}/home`)})`)
  const rounds = []
  for (let round = 0; round < ROUNDS; round += 1) {
    const path = `/slow-${round}`
    await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}${path}`)})`)
    await waitFor(() => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith(path) && !contents.isLoading()), `${path} to load`)
    // Back to the first tab, then discard the new one (the memory saver / Diagnostics "Discard" path).
    const tabs = await api('window.api.browser.tabs.get()')
    const target = tabs.find((tab) => tab.url.endsWith(path))
    await api(`window.api.browser.tabs.activate(${JSON.stringify(tabs[0].id)})`)
    await delay(300)
    assert.ok(await content.webContents.executeJavaScript(`window.api.browser.diagnostics.discardTab(${JSON.stringify(target.id)})`), 'discard a background tab')
    await waitFor(async () => (await api('window.api.browser.tabs.get()')).find((tab) => tab.id === target.id && tab.sleeping), `${path} to sleep`)
    await waitFor(() => sidebar.webContents.executeJavaScript(`Boolean(document.querySelector('[data-browser-tab-id="${target.id}"]'))`), 'the sleeping tab row')
    await delay(600)

    // Main-process stall meter around the wake.
    let last = performance.now()
    let maxGap = 0
    const meter = setInterval(() => {
      const t = performance.now()
      maxGap = Math.max(maxGap, t - last)
      last = t
    }, 1)
    await sidebar.webContents.executeJavaScript(RECORDER(target.id))
    await delay(150)
    // Same IPC a click on the sidebar row sends.
    void sidebar.webContents.executeJavaScript(`window.api.browser.tabs.activate(${JSON.stringify(target.id)})`)
    await delay(700)
    // The spinner must not cost a compositor layer (a rasterised arc wobbles at favicon size).
    const spinningLayers = await layerCount(sidebar.webContents)
    if (process.env.WAKE_SCREENSHOT) {
      for (let shot = 0; shot < 4; shot += 1) {
        writeFileSync(`${process.env.WAKE_SCREENSHOT}-${round}-${shot}.png`, (await sidebar.webContents.capturePage({ x: 0, y: 0, width: 320, height: 200 })).toPNG())
        await delay(110)
      }
    }
    await delay(600)
    clearInterval(meter)
    const samples = await sidebar.webContents.executeJavaScript('window.__wakeProbe.done()')
    await waitFor(() => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith(path) && !contents.isLoading()), `${path} to finish loading`)
    await delay(300)
    const idleLayers = await layerCount(sidebar.webContents)
    rounds.push({ mainMaxGapMs: Math.round(maxGap), ...analyse(samples), spinningLayers, idleLayers })
    step(`round ${round}: ${JSON.stringify(rounds.at(-1))}`)
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const report = {
    rounds,
    medianMainMaxGapMs: median(rounds.map((entry) => entry.mainMaxGapMs)),
    medianFrozenMs: median(rounds.map((entry) => entry.frozenMs ?? Infinity))
  }
  console.log(`WAKE_REPORT ${JSON.stringify(report)}`)

  // ---- 2. Popover light-dismiss (the active tab is a live page, so the toolbar is its own overlay view).
  const page = webContents.getAllWebContents().find((contents) => contents.getURL().endsWith(`/slow-${ROUNDS - 1}`))
  assert.ok(page, 'the live page under the toolbar')
  const inToolbar = (expression) => toolbar.webContents.executeJavaScript(expression)
  const isOpen = (selector) => inToolbar(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
  const openPopover = async (button, popover) => {
    if (!(await isOpen(popover))) await inToolbar(`document.querySelector(${JSON.stringify(button)}).click()`)
    await waitFor(() => isOpen(popover), `${popover} to open`)
    // Main learns the toolbar now draws below itself (toolbarExtent) before it forwards page presses.
    await delay(250)
  }
  const pressPage = () => {
    page.sendInputEvent({ type: 'mouseDown', x: 400, y: 400, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', x: 400, y: 400, button: 'left', clickCount: 1 })
  }
  const closesOn = async (label, button, popover, act) => {
    await openPopover(button, popover)
    await act()
    const closed = await waitFor(async () => !(await isOpen(popover)), `${popover} to close on ${label}`, 3000).then(() => true, () => false)
    popovers.push({ popover, on: label, closed })
    step(`${popover} closes on ${label}: ${closed}`)
  }
  const popovers = []
  const SITE = ['.site-actions-button', '#site-actions-menu']
  const BOOKMARKS = ['.bookmarks-menu-button', '#bookmarks-menu']
  await closesOn('a press on the page', ...SITE, pressPage)
  await closesOn('Escape', ...SITE, () => toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }))
  await closesOn('a press elsewhere in the toolbar', ...SITE, () => inToolbar(`document.querySelector('.omnibox input').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`))
  await closesOn('the toolbar losing focus', ...SITE, async () => {
    toolbar.webContents.focus()
    await delay(100)
    page.focus()
  })
  await closesOn('a press on the page', ...BOOKMARKS, pressPage)
  // The globe still toggles it shut, and a press inside the menu does not close it.
  await openPopover(...SITE)
  await inToolbar(`document.querySelector('#site-actions-menu').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  await delay(200)
  const staysOpenOnInsidePress = await isOpen(SITE[1])
  await inToolbar(`document.querySelector('.site-actions-button').click()`)
  const togglesShut = await waitFor(async () => !(await isOpen(SITE[1])), 'the globe to close the menu', 3000).then(() => true, () => false)
  console.log(`POPOVER_REPORT ${JSON.stringify({ popovers, staysOpenOnInsidePress, togglesShut })}`)

  if (!REPORT_ONLY) {
    for (const entry of popovers) assert.ok(entry.closed, `${entry.popover} closes on ${entry.on}`)
    assert.ok(staysOpenOnInsidePress, 'a press inside the site menu keeps it open')
    assert.ok(togglesShut, 'the globe still closes the site menu')
    for (const entry of rounds) {
      assert.ok(entry.spinnerShown, 'the woken tab shows a loading spinner')
      assert.ok(entry.turned, 'the spinner turns while the tab loads')
      if (entry.spinningLayers !== null && entry.idleLayers !== null) assert.ok(entry.spinningLayers <= entry.idleLayers, `the spinner adds no compositor layer (${entry.spinningLayers} spinning vs ${entry.idleLayers} idle)`)
    }
    // Software rendering under xvfb is slow; a frozen spinner sat still for ~1 s.
    const budget = Number(process.env.WAKE_FROZEN_BUDGET_MS) || 250
    assert.ok(report.medianFrozenMs <= budget, `the spinner starts turning within ${budget} ms of appearing (median ${report.medianFrozenMs} ms)`)
    console.log('Spinner + popover smoke passed.')
  }
}

run().then(() => app.exit(0), (error) => {
  console.error(error)
  app.exit(1)
})
