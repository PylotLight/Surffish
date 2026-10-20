// Integration smoke for Read Aloud (Settings → Features, experimental, off by default).
//   1. Off at launch: no Cmd+K entries, the control IPC answers "read aloud disabled", no engine window.
//   2. On: entries appear. A page without an article reports "No article found" in the player.
//   3. An article (from Reader view's Listen button): the hidden engine window starts on
//      surffish-tts://engine/, is cross-origin isolated (wasm threads) and reads the sentences.
//      CI (no model download): the system-voice engine; Linux runners usually have no voices, so
//      "No system voices are available." is accepted there. READ_ALOUD_SMOKE_PHONON=1 downloads the
//      real Phonon runtime + model (~71 MB) into the temp profile and checks Phonon speaks: playing,
//      pause/resume, next sentence, the Reader highlight, and the first-audio numbers.
//   4. Navigating the tab stops the reading. Turning the feature off closes the engine window.
// Runs the production build: `bun run build && bun run test:electron-read-aloud`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-read-aloud-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, BrowserWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const PHONON = process.env.READ_ALOUD_SMOKE_PHONON === '1'
const root = join(tmpdir(), `surffish-read-aloud-smoke-${process.pid}`)
const userData = process.env.READ_ALOUD_SMOKE_PROFILE || join(root, 'user-data')
const paragraphs = [
  'Surffish can read this article out loud. The voice runs on this computer, so nothing is sent anywhere.',
  'Dr. Smith tested it on Monday at 9 a.m. with a cup of coffee. It cost $4.50, which was fine.',
  'The third paragraph is here so the reading has a few sentences to skip through. Skipping works per sentence.',
  'Readers like short sentences. They are easy to follow. They also make the highlight jump often.'
]
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  if (url.pathname === '/2026/read-aloud-article') {
    response.end(`<!doctype html><html lang="en"><head><title>Read Aloud Smoke Article</title></head><body><nav><a href="/">Home</a></nav><article><h1>Read Aloud Smoke Article</h1><p class="byline">By Smoke Test</p>${paragraphs.map((text) => `<p>${text} ${'Padding words keep Readability happy about the length of this paragraph. '.repeat(3)}</p>`).join('')}</article></body></html>`)
    return
  }
  if (url.pathname === '/empty') {
    response.end('<!doctype html><title></title><body></body>')
    return
  }
  response.end('<!doctype html><title>Plain</title><p>hi</p>')
})

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
    await delay(80)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}

const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => surfaceFor(view) === name)
const viewWithUrl = (prefix) => views().find((view) => view.webContents.getURL().startsWith(prefix))
const engineWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().startsWith('surffish-tts://'))

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
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
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const commandIds = async () => (await evaluate(toolbar, 'window.api.browser.commands.list()')).commands.map((command) => command.id)
  const state = () => evaluate(toolbar, 'window.api.browser.readAloud.getState()')

  // --- 1. Off at launch
  smoke.step('off at launch')
  assert.equal((await evaluate(toolbar, 'window.api.browser.readAloud.getSettings()')).enabled, false, 'Read Aloud is off by default')
  assert.equal((await commandIds()).some((id) => id.startsWith('readAloud.')), false, 'no Cmd+K entries while off')
  assert.deepEqual(await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")'), { ok: false, error: 'read aloud disabled' })
  assert.equal((await state()).status, 'idle')
  assert.equal(engineWindow(), undefined, 'no engine window while off')

  // --- 2. On; a page without an article
  smoke.step('turn on')
  const engine = PHONON ? 'phonon' : 'system'
  await evaluate(toolbar, `window.api.browser.readAloud.setSettings({ enabled: true, engine: ${JSON.stringify(engine)} })`)
  await waitFor(async () => (await commandIds()).includes('readAloud.page'), 'the Read Aloud command')
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/empty`)})`)
  await waitFor(() => viewWithUrl(`${origin}/empty`), 'the empty page')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.state()')).loading === false, 'the empty page to load')
  assert.equal(await evaluate(toolbar, 'window.api.browser.commands.run("readAloud.page")'), true)
  const failed = await waitFor(async () => { const value = await state(); return value.status === 'error' && value }, 'the no-article error')
  assert.equal(failed.error, 'No article found on this page.')
  await waitFor(() => evaluate(toolbar, 'Boolean(document.querySelector(".read-aloud-button.is-error"))'), 'the player button to show the problem')
  await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")')
  await waitFor(async () => (await state()).status === 'idle', 'dismissing the error')
  await waitFor(() => evaluate(toolbar, '!document.querySelector(".read-aloud-button")'), 'the player button to go away when idle')

  // --- 3. An article, started from Reader view's Listen button
  smoke.step('read an article')
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/2026/read-aloud-article`)})`)
  await waitFor(() => viewWithUrl(`${origin}/2026/read-aloud-article`), 'the article page')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.state()')).reader === 'available', 'Reader view to be available')
  await evaluate(toolbar, 'window.api.browser.toggleReader()')
  const reader = await waitFor(() => viewWithUrl('surffish-reader://reader/'), 'the reader view')
  await waitFor(() => evaluate(reader, 'Boolean(document.querySelector(".reader-title")) && !document.getElementById("listen").hidden'), 'the Listen button in Reader view')
  await evaluate(reader, 'document.getElementById("listen").click(); true')
  const timeout = PHONON ? Math.max(smoke.waitMs, 8 * 60_000) : smoke.waitMs
  const started = await waitFor(async () => { const value = await state(); return (value.status === 'playing' || value.status === 'error') && value }, 'the reading to start (or fail)', timeout)
  const engineWin = engineWindow()
  assert.ok(engineWin, 'the hidden engine window is open')
  assert.equal(engineWin.isVisible(), false, 'the engine window is never shown')
  assert.equal(await engineWin.webContents.executeJavaScript('self.crossOriginIsolated === true'), true, 'the engine page is cross-origin isolated (wasm threads)')
  console.log(`reading started: ${JSON.stringify({ status: started.status, engine: started.engine, total: started.total, error: started.error, fallbackReason: started.fallbackReason })}`)
  if (!PHONON && started.status === 'error') {
    assert.equal(started.error, 'No system voices are available.', 'system engine without voices fails clearly')
    console.log('no system voices on this runner: the engine page, isolation and extraction are checked; audio is not')
  } else {
    assert.equal(started.status, 'playing')
    assert.equal(started.engine, engine)
    assert.ok(started.total >= paragraphs.length, `the article was split into sentences (${started.total})`)
    if (PHONON) await waitFor(() => evaluate(reader, 'CSS.highlights.has("read-aloud")'), 'the spoken sentence highlight in Reader view')
    await evaluate(toolbar, 'window.api.browser.readAloud.control("pause")')
    await waitFor(async () => (await state()).status === 'paused', 'pause')
    await evaluate(toolbar, 'window.api.browser.readAloud.control("resume")')
    await waitFor(async () => (await state()).status === 'playing', 'resume')
    const before = (await state()).index
    await evaluate(toolbar, 'window.api.browser.readAloud.control("next")')
    await waitFor(async () => (await state()).index > before, 'skip to the next sentence')
    // 4. Navigating the tab stops the reading.
    smoke.step('navigate away')
    await evaluate(toolbar, 'window.api.browser.toggleReader()')
    await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/plain`)})`)
    await waitFor(async () => (await state()).status === 'idle', 'navigation to stop the reading')
  }

  // --- Off again: the engine window closes and entries hide.
  smoke.step('turn off')
  await evaluate(toolbar, 'window.api.browser.readAloud.setSettings({ enabled: false })')
  await waitFor(() => engineWindow() === undefined, 'the engine window to close')
  assert.equal((await commandIds()).some((id) => id.startsWith('readAloud.')), false)
  console.log('Electron Read Aloud smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron Read Aloud smoke failed:', error)
  app.exit(1)
})
