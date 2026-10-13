// Integration smoke for split view: Cmd+Shift+= splits the active tab with the last used one, both
// pages sit side by side with the divider between them, dragging the divider resizes the panes,
// focus/zoom act on the focused pane, swap / pop out / unsplit / close pane behave, a split entry
// moves to a new window as one, and a split (with its ratio) comes back on relaunch.
// Runs the production build: `bun run build && bun run test:electron-split-view`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-split-view-smoke.cjs`).
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
const phase = phaseArg ? phaseArg.slice('--phase='.length) : 'main'
const dirArg = process.argv.find((arg) => arg.startsWith('--user-data='))
const userData = dirArg ? dirArg.slice('--user-data='.length) : join(tmpdir(), `surffish-split-view-smoke-${process.pid}`)
const originArg = process.argv.find((arg) => arg.startsWith('--origin='))
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

const viewsOf = (win) => win.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (win, name) => viewsOf(win).find((view) => surfaceFor(view) === name)
const windows = () => BaseWindow.getAllWindows().filter((win) => !win.isDestroyed() && surface(win, 'toolbar'))
const pageView = (win, path) => viewsOf(win).find((view) => { try { return new URL(view.webContents.getURL()).pathname === path } catch { return false } })
const splitSurface = (win) => viewsOf(win).find((view) => view.webContents.getURL().startsWith('data:text/html') && view.webContents.getURL().includes('__layout'))

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}

async function ready(win) {
  await waitFor(() => surface(win, 'content') && surface(win, 'toolbar') && surface(win, 'sidebar'), 'the renderer surfaces')
  const toolbar = surface(win, 'toolbar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  return toolbar
}

const api = (win, call) => evaluate(surface(win, 'toolbar'), `window.api.browser.${call}`)
const tabsOf = (win) => api(win, 'tabs.get()')
const splitOf = (win) => api(win, 'split.get()')
const sessionFile = () => JSON.parse(readFileSync(join(userData, 'browser-session.json'), 'utf8'))
const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function writeFixtures() {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', { loadNetworkFilters: true, loadCosmeticFilters: false })
  writeFileSync(join(userData, 'adblock-engine.bin'), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
}

async function startApp() {
  app.setPath('userData', userData)
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
}

/** Both panes' page views are on screen exactly where split.get() says, and the surface sits under them. */
async function assertPanesOnScreen(win, leftPath, rightPath) {
  const state = await waitFor(async () => {
    const value = await splitOf(win)
    if (!value.visible) return null
    const left = pageView(win, leftPath)
    const right = pageView(win, rightPath)
    if (!left || !right || !left.getVisible() || !right.getVisible()) return null
    return sameBounds(left.getBounds(), value.visible.panes[0]) && sameBounds(right.getBounds(), value.visible.panes[1]) ? value : null
  }, `${leftPath} | ${rightPath} side by side`)
  const [leftPane, rightPane] = state.visible.panes
  const [divider] = state.visible.dividers
  assert.ok(leftPane.x + leftPane.width <= divider.x, 'left pane ends before the divider')
  assert.ok(divider.x + divider.width <= rightPane.x, 'right pane starts after the divider')
  assert.ok(leftPane.width > 100 && rightPane.width > 100, 'both panes have room')
  const under = await waitFor(() => splitSurface(win), 'the split surface')
  assert.equal(win.contentView.children[0], under, 'the split surface sits under every page view')
  assert.ok(under.getVisible(), 'the split surface is shown')
  return state
}

async function mainPhase() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><meta charset="utf-8"><title>Page ${request.url.slice(1)}</title><p>${request.url}</p>`)
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  // Chromium zooms per host, so /b lives on another host name to show zoom stays with its pane.
  const otherOrigin = `http://localhost:${server.address().port}`
  writeFixtures()
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/a`, `${otherOrigin}/b`, `${origin}/c`, `${origin}/d`], activeIndex: 0, pinnedTabs: [3] }))
  writeFileSync(join(userData, 'window-state.json'), JSON.stringify({ bounds: { x: 40, y: 40, width: 1200, height: 760 }, maximized: false, fullScreen: false }))
  await startApp()

  const win = await waitFor(() => windows()[0], 'the window')
  await ready(win)
  let tabs = await waitFor(async () => { const value = await tabsOf(win); return value.length === 4 ? value : null }, 'the restored tabs')
  const id = Object.fromEntries(tabs.map((tab) => [new URL(tab.url).pathname.slice(1), tab.id]))
  await waitFor(() => pageView(win, '/a')?.getBounds().width > 0, 'page /a on screen')

  // --- MRU: /b, then back to /a; Cmd+Shift+= (split.toggle) splits /a with /b, /a focused on the left
  await api(win, `tabs.activate(${JSON.stringify(id.b)})`)
  await waitFor(() => pageView(win, '/b')?.getBounds().width > 0, 'page /b on screen')
  await api(win, `tabs.activate(${JSON.stringify(id.a)})`)
  assert.equal(await api(win, 'split.toggle()'), true, 'split with the last used tab')
  let state = await assertPanesOnScreen(win, '/a', '/b')
  assert.equal(state.visible.focusedTabId, id.a, 'the tab you were on stays focused')
  assert.deepEqual(state.splits[0].tabIds, [id.a, id.b])
  tabs = await tabsOf(win)
  assert.deepEqual(tabs.filter((tab) => tab.split).map((tab) => [tab.id, tab.split.index]), [[id.a, 0], [id.b, 1]], 'tab summaries carry the split')
  assert.equal((await api(win, 'state()')).url, `${origin}/a`, 'the address bar shows the focused pane')

  // --- the sidebar draws the split as one entry with both titles
  const sidebar = surface(win, 'sidebar')
  const entry = await waitFor(() => evaluate(sidebar, `(() => { const el = document.querySelector('.tab-split-entry'); return el ? [...el.querySelectorAll('[data-browser-pane-id]')].map((pane) => pane.getAttribute('data-browser-pane-id')) : null })()`), 'the split sidebar entry')
  assert.deepEqual(entry, [id.a, id.b])
  assert.equal(await evaluate(sidebar, 'document.querySelectorAll(".tab-list [data-browser-tab-id]").length'), 2, 'split entry + /c (the pinned tab is in the strip)')

  // --- pinned tabs don't split, and the Cmd+Shift+= toggle unsplits again
  assert.equal(await api(win, `split.with(${JSON.stringify(id.c)}, ${JSON.stringify(id.d)})`), false, 'a pinned tab cannot be a pane')

  // --- drag the divider (mouse input on the surface under the panes): the left pane shrinks
  const under = splitSurface(win)
  const pageArea = under.getBounds()
  const divider = state.visible.dividers[0]
  const startX = divider.x + divider.width / 2 - pageArea.x
  const y = Math.round(pageArea.height / 2)
  const targetX = Math.round(startX - 200)
  under.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(startX), y, button: 'left', clickCount: 1 })
  for (const step of [0.25, 0.5, 0.75, 1]) {
    under.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(startX + (targetX - startX) * step), y, button: 'left', modifiers: ['leftButtonDown'] })
    await delay(20)
  }
  under.webContents.sendInputEvent({ type: 'mouseUp', x: targetX, y, button: 'left', clickCount: 1 })
  state = await waitFor(async () => { const value = await splitOf(win); return value.splits[0]?.sizes[0] < 0.45 ? value : null }, 'the divider drag to resize the panes')
  const draggedDivider = state.visible.dividers[0]
  assert.ok(Math.abs(draggedDivider.x + draggedDivider.width / 2 - (targetX + pageArea.x)) <= 2, `divider follows the pointer (${draggedDivider.x})`)
  await assertPanesOnScreen(win, '/a', '/b')
  const savedRatio = state.splits[0].sizes[0]

  // --- clicking the right pane's margin focuses it; zoom acts on the focused pane only
  const rightPane = state.visible.panes[1]
  under.webContents.sendInputEvent({ type: 'mouseDown', x: rightPane.x - pageArea.x + 20, y: 1, button: 'left', clickCount: 1 })
  under.webContents.sendInputEvent({ type: 'mouseUp', x: rightPane.x - pageArea.x + 20, y: 1, button: 'left', clickCount: 1 })
  await waitFor(async () => (await splitOf(win)).visible?.focusedTabId === id.b, 'the right pane to take focus')
  assert.equal((await api(win, 'state()')).url, `${otherOrigin}/b`)
  await api(win, 'zoom("in")')
  await waitFor(() => pageView(win, '/b').webContents.getZoomFactor() > 1.01, 'the focused pane to zoom')
  assert.ok(Math.abs(pageView(win, '/a').webContents.getZoomFactor() - 1) < 0.001, 'the other pane keeps its zoom')
  await api(win, 'zoom("reset")')
  // Keyboard: focus the left pane again.
  assert.equal(await api(win, 'split.focusPane(-1)'), true)
  await waitFor(async () => (await splitOf(win)).visible?.focusedTabId === id.a, 'the left pane to take focus back')

  // --- the session file keeps the split and its ratio (older builds just see four tabs)
  const saved = await waitFor(() => {
    const value = sessionFile()
    const split = value.windows?.[0]?.splits?.[0]
    return split && Math.abs(split.sizes[0] - savedRatio) < 0.001 ? value : null
  }, 'the split in browser-session.json', 8000)
  assert.deepEqual(saved.windows[0].splits[0].tabs.map((index) => new URL(saved.windows[0].tabs[index]).pathname), ['/a', '/b'])
  assert.equal(saved.tabs.length, 4, 'top-level tabs still list every tab for older builds')

  // --- swap: the pages trade places, the ratio stays
  assert.equal(await api(win, 'split.swap()'), true)
  state = await assertPanesOnScreen(win, '/b', '/a')
  assert.ok(Math.abs(state.splits[0].sizes[0] - savedRatio) < 0.001, 'swap keeps the layout')
  await api(win, 'split.swap()')
  await assertPanesOnScreen(win, '/a', '/b')

  // --- Open in Split View (drop on the right edge): /c replaces the right pane
  assert.equal(await api(win, `split.drop(${JSON.stringify(id.c)}, 'right')`), true)
  state = await assertPanesOnScreen(win, '/a', '/c')
  assert.equal(state.visible.focusedTabId, id.c, 'the dropped tab is focused')
  await waitFor(() => !pageView(win, '/b') || !pageView(win, '/b').getVisible() || pageView(win, '/b').getBounds().width === 0, '/b to leave the screen')

  // --- pop out: /c becomes its own tab (shown alone, right after /a); unsplit leaves /a alone
  assert.equal(await api(win, `split.popOut(${JSON.stringify(id.c)})`), true)
  state = await splitOf(win)
  assert.equal(state.splits.length, 0, 'popping out a pane of two unsplits')
  await waitFor(() => pageView(win, '/c')?.getBounds().width > 0 && !pageView(win, '/a')?.getVisible(), '/c alone on screen')
  assert.equal(splitSurface(win), undefined, 'no split surface without a split')

  // --- split with + close the focused pane: its partner stays, alone and focused
  assert.equal(await api(win, `split.with(${JSON.stringify(id.a)}, ${JSON.stringify(id.b)})`), true)
  await assertPanesOnScreen(win, '/a', '/b')
  await api(win, `tabs.close(${JSON.stringify(id.a)})`)
  await waitFor(async () => {
    const value = await splitOf(win)
    const b = pageView(win, '/b')
    return value.splits.length === 0 && b && b.getBounds().width > 0 && (await tabsOf(win)).find((tab) => tab.id === id.b)?.active
  }, '/b alone and focused after closing /a')

  // --- a split entry moves to a new window as one, with its ratio
  assert.equal(await api(win, `split.with(${JSON.stringify(id.b)}, ${JSON.stringify(id.c)})`), true)
  await assertPanesOnScreen(win, '/b', '/c')
  assert.equal(await api(win, `tabs.moveToNewWindow(${JSON.stringify(id.c)})`), true)
  const second = await waitFor(() => windows().find((candidate) => candidate !== win), 'the new window')
  await ready(second)
  await waitFor(async () => (await tabsOf(second)).length === 2, 'both panes in the new window')
  state = await assertPanesOnScreen(second, '/b', '/c')
  assert.equal(state.visible.focusedTabId, id.b, 'the focused pane stays focused')
  assert.ok((await tabsOf(win)).every((tab) => tab.id !== id.b && tab.id !== id.c), 'both panes left the first window')

  // --- leave a resized split in window 2 for the restore phase
  const surface2 = splitSurface(second)
  const area2 = surface2.getBounds()
  const div2 = state.visible.dividers[0]
  const from2 = div2.x + div2.width / 2 - area2.x
  surface2.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(from2), y: 200, button: 'left', clickCount: 1 })
  surface2.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from2 + 150), y: 200, button: 'left', modifiers: ['leftButtonDown'] })
  surface2.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(from2 + 150), y: 200, button: 'left', clickCount: 1 })
  const ratio2 = (await waitFor(async () => { const value = await splitOf(second); return value.splits[0]?.sizes[0] > 0.55 ? value : null }, 'window 2 divider drag')).splits[0].sizes[0]
  await waitFor(() => {
    const value = sessionFile()
    return value.windows?.some((saved) => saved.splits?.some((split) => Math.abs(split.sizes[0] - ratio2) < 0.001)) ? value : null
  }, 'window 2 split saved', 8000)

  // --- relaunch: the split comes back with its ratio
  app.releaseSingleInstanceLock()
  const exitCode = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [...process.execArgv, ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []), __filename, '--phase=restore', `--user-data=${userData}`, `--origin=${origin}`, `--ratio=${ratio2}`], { stdio: 'inherit' })
    child.on('exit', (code) => resolvePromise(code))
  })
  server.close()
  assert.equal(exitCode, 0, 'the restore phase passed')
  rmSync(userData, { recursive: true, force: true })
  console.log('Electron split view smoke passed.')
}

async function restorePhase() {
  const ratio = Number(process.argv.find((arg) => arg.startsWith('--ratio='))?.slice('--ratio='.length))
  await startApp()
  const restored = await waitFor(() => windows().length === 2 ? windows() : null, 'two restored windows')
  for (const win of restored) await ready(win)
  const withSplit = await waitFor(async () => {
    for (const win of restored) {
      const state = await splitOf(win)
      if (state.splits.length === 1) return { win, state }
    }
    return null
  }, 'the restored split')
  assert.ok(Math.abs(withSplit.state.splits[0].sizes[0] - ratio) < 0.001, `ratio restored (${withSplit.state.splits[0].sizes[0]} vs ${ratio})`)
  const tabs = await tabsOf(withSplit.win)
  const paths = withSplit.state.splits[0].tabIds.map((tabId) => new URL(tabs.find((tab) => tab.id === tabId).url).pathname)
  assert.deepEqual(paths, ['/b', '/c'])
  await assertPanesOnScreen(withSplit.win, '/b', '/c')
  console.log('Electron split view restore phase passed.')
}

const run = phase === 'restore' ? restorePhase : mainPhase
run().then(() => app.exit(0), (error) => {
  console.error(`Electron split view smoke failed (${phase}):`, error)
  app.exit(1)
})
