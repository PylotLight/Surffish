// Integration smoke for Read Aloud (Settings → Integrations → Read Aloud, experimental, off by default).
//   1. Off at launch: no Cmd+K entries, the control IPC answers "read aloud disabled", no engine
//      window, nothing downloaded.
//   2. Settings: the section is its own Integrations tab (not under General → Features).
//   3. Download on enable (CI: SURFFISH_READ_ALOUD_TEST_MANIFEST points the download at small fixture
//      files on a local server, with their own hashes and a fake `phonon-tts` runtime): turning the
//      switch on starts it with a progress bar; Cancel, a failure + Retry, then "Ready · …". Turning it
//      off keeps the files (Delete offered), on again re-checks them and downloads nothing.
//   4. Voice tester: Play with the system voice (Linux runners usually have none: "No system voices
//      are available." is accepted) and with the (fake) Phonon runtime, which reports the timings.
//   5. A page without an article reports "No article found" in the player.
//   6. Delete download, then read an article from Reader view's Listen button: the player shows the
//      download progress and the reading starts once it's done. The hidden engine window runs on
//      surffish-tts://engine/ and is cross-origin isolated (wasm threads).
//   7. Navigating the tab stops the reading. Turning the feature off closes the engine window.
// READ_ALOUD_SMOKE_PHONON=1 skips the fixtures and downloads the real Phonon runtime + model (~71 MB)
// into the temp profile, and checks real speech: playing, pause/resume, next, the Reader highlight.
// Runs the production build: `bun run build && bun run test:electron-read-aloud`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-read-aloud-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { gzipSync } = require('node:zlib')
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

// --- Download fixtures (CI): a fake phonon-tts runtime that "speaks" silence, and model files.
const FAKE_RUNTIME = `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const PhononTTS = {
  async load() {
    await sleep(30)
    return {
      sampleRate: 24000, voices: ['default'], threads: 1, threadsReason: 'fixture', device: 'fixture',
      async addVoice(name) { this.voices.push(name) },
      stream(text, options = {}) {
        let cancelled = false
        const chunks = Math.max(2, Math.min(8, Math.ceil(String(text).length / 20)))
        return {
          done: Promise.resolve({ firstAudioMs: 5, cancelled: false }),
          cancel() { cancelled = true },
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < chunks && !cancelled && !(options.signal && options.signal.aborted); i += 1) {
              await sleep(10)
              yield new Float32Array(2400)
            }
          }
        }
      },
      dispose() {}
    }
  }
}
`
function tarEntry(name, body) {
  const data = Buffer.from(body)
  const header = Buffer.alloc(512)
  header.write(`package/${name}`, 0)
  header.write(data.length.toString(8).padStart(11, '0'), 124)
  header.write('0', 156)
  header.write('ustar', 257)
  return [header, Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)])]
}
const fixtures = {
  'runtime.tgz': gzipSync(Buffer.concat([...tarEntry('index.js', FAKE_RUNTIME), ...tarEntry('worker.js', '// fixture'), Buffer.alloc(1024)])),
  'model.q8.gguf': Buffer.alloc(3 * 1024 * 1024, 7),
  'tokenizer.json': Buffer.from('{"fixture":true}'),
  'config.json': Buffer.from('{"fixture":true}'),
  'default-voice.safetensors': Buffer.alloc(4096, 1)
}
const fixtureHits = []
const fixtureMode = { slow: false, fail: false }
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/2026/read-aloud-article') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><html lang="en"><head><title>Read Aloud Smoke Article</title></head><body><nav><a href="/">Home</a></nav><article><h1>Read Aloud Smoke Article</h1><p class="byline">By Smoke Test</p>${paragraphs.map((text) => `<p>${text} ${'Padding words keep Readability happy about the length of this paragraph. '.repeat(3)}</p>`).join('')}</article></body></html>`)
    return
  }
  if (url.pathname.startsWith('/fixture/')) {
    const name = url.pathname.slice('/fixture/'.length)
    const body = fixtures[name]
    fixtureHits.push(name)
    if (!body) { response.writeHead(404); response.end(); return }
    if (fixtureMode.fail && name === 'model.q8.gguf') { response.writeHead(503); response.end(); return }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length })
    // Slow mode: 32 KB every 40 ms (~4 s for the "weights"), so progress and Cancel can be seen.
    let offset = 0
    const step = () => {
      if (response.destroyed) return
      if (offset >= body.length) { response.end(); return }
      const size = fixtureMode.slow ? 32 * 1024 : 1024 * 1024
      response.write(body.subarray(offset, offset + size))
      offset += size
      setTimeout(step, fixtureMode.slow ? 40 : 0)
    }
    step()
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
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

function writeTestManifest(origin) {
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const file = (name) => ({ url: `${origin}/fixture/${name}`, bytes: fixtures[name].length, sha256: sha256(fixtures[name]) })
  const manifest = {
    runtime: { label: 'Phonon runtime', url: `${origin}/fixture/runtime.tgz`, bytes: fixtures['runtime.tgz'].length, integrity: `sha512-${createHash('sha512').update(fixtures['runtime.tgz']).digest('base64')}` },
    model: { 'model.q8.gguf': { ...file('model.q8.gguf'), label: 'Model weights' }, 'tokenizer.json': file('tokenizer.json'), 'config.json': file('config.json'), 'default-voice.safetensors': file('default-voice.safetensors') }
  }
  const path = join(root, 'read-aloud-manifest.json')
  writeFileSync(path, JSON.stringify(manifest))
  process.env.SURFFISH_READ_ALOUD_TEST_MANIFEST = path
  return Object.values(fixtures).reduce((sum, body) => sum + body.length, 0)
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
  const fixtureBytes = PHONON ? 0 : writeTestManifest(origin)
  const downloadDir = join(userData, 'read-aloud')

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 860 })
  await waitFor(() => surface('content') && surface('toolbar') && surface('sidebar'), 'the renderer surfaces')
  const toolbar = surface('toolbar')
  const content = surface('content')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const commandIds = async () => (await evaluate(toolbar, 'window.api.browser.commands.list()')).commands.map((command) => command.id)
  const state = () => evaluate(toolbar, 'window.api.browser.readAloud.getState()')
  const download = () => evaluate(toolbar, 'window.api.browser.readAloud.downloadInfo()')
  const page = (expression) => evaluate(content, expression)
  const modelRow = () => page('document.querySelector(".read-aloud-model-row")?.dataset.status ?? null')
  const modelText = () => page('document.querySelector(".read-aloud-model-row .read-aloud-model-status")?.textContent ?? ""')
  const clickButton = (scope, label) => page(`(() => { const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true })()`)
  const setSelect = (label, value) => page(`(() => { const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const openSettings = async (mode) => {
    await evaluate(toolbar, `window.api.browser.chrome.set({ sidebarMode: ${JSON.stringify(mode)} })`)
    await waitFor(() => page('Boolean(document.querySelector(".settings-view"))'), `the ${mode} settings page`)
  }

  // --- 1. Off at launch
  smoke.step('off at launch')
  assert.equal((await evaluate(toolbar, 'window.api.browser.readAloud.getSettings()')).enabled, false, 'Read Aloud is off by default')
  assert.equal((await commandIds()).some((id) => id.startsWith('readAloud.')), false, 'no Cmd+K entries while off')
  assert.deepEqual(await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")'), { ok: false, error: 'read aloud disabled' })
  assert.deepEqual(await evaluate(toolbar, 'window.api.browser.readAloud.test({ engine: "system" })'), { ok: false, error: 'read aloud disabled' })
  assert.equal((await state()).status, 'idle')
  assert.equal((await download()).status, 'absent')
  assert.equal(engineWindow(), undefined, 'no engine window while off')

  // --- 2. Settings → Integrations → Read Aloud (not General → Features)
  smoke.step('settings location')
  await openSettings('settings')
  await waitFor(() => page('Boolean(document.querySelector("#settings-category-features, [data-category=\\"features\\"]")) || document.querySelector(".settings-view")?.textContent.includes("Spellcheck")'), 'General → Features')
  assert.equal(await page('document.querySelector(".settings-view").textContent.includes("Enable Read Aloud")'), false, 'Read Aloud is no longer under General → Features')
  await openSettings('readaloud')
  await waitFor(() => page('Boolean(document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]"))'), 'the Read Aloud settings (lazy chunk)')
  assert.equal(await page('document.querySelector(".settings-page-header h1").textContent'), 'Integrations')
  assert.equal(await page('document.querySelector(".integrations-tabs [aria-selected=\\"true\\"]").textContent'), 'Read Aloud', 'its own Integrations tab')
  assert.deepEqual(await page('[...document.querySelectorAll(".integrations-tabs button")].map((b) => b.textContent)'), ['Extensions', 'Feeds', 'Read Aloud'])
  assert.equal(await page('Boolean(document.querySelector(".read-aloud-tester"))'), false, 'no tester while off')

  // --- 3. Download on enable
  smoke.step('download on enable')
  if (!PHONON) fixtureMode.slow = true
  await page('document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]").click(); true')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.readAloud.getSettings()')).enabled, 'Read Aloud to turn on')
  await waitFor(async () => (await commandIds()).includes('readAloud.page'), 'the Read Aloud command')
  if (!PHONON) {
    await waitFor(async () => (await modelRow()) === 'downloading' && /\d+%/.test(await modelText()), 'the download to start with a progress bar')
    const first = await download()
    assert.equal(first.status, 'downloading')
    assert.equal(first.total, fixtureBytes, 'progress counts every missing file')
    await waitFor(async () => (await download()).loaded > first.loaded, 'progress to move')
    assert.ok(await page('document.querySelector(".read-aloud-model-row progress").value > 0'), 'the bar fills')
    assert.match(await modelText(), /of .* · \d+%/, 'MB done / total and percent')
    // Cancel
    assert.equal(await clickButton('.read-aloud-model-row', 'Cancel'), true)
    await waitFor(async () => (await modelRow()) === 'cancelled', 'Cancel to stop the download')
    assert.equal(existsSync(join(downloadDir, 'ready.json')), false)
    // A failure, then Retry
    fixtureMode.fail = true
    assert.equal(await clickButton('.read-aloud-model-row', 'Download'), true)
    await waitFor(async () => (await modelRow()) === 'error', 'the failed download')
    assert.match(await modelText(), /HTTP 503/)
    fixtureMode.fail = false
    fixtureMode.slow = false
    assert.equal(await clickButton('.read-aloud-model-row', 'Retry'), true)
    await waitFor(async () => (await modelRow()) === 'ready', 'Retry to finish the download')
    assert.match(await modelText(), /^Ready · \d/, '"Ready · <size>"')
    assert.equal(existsSync(join(downloadDir, 'ready.json')), true)
    // Off keeps the files; on again re-checks them and fetches nothing.
    smoke.step('cache across off/on')
    const hits = fixtureHits.length
    await page('document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]").click(); true')
    await waitFor(async () => !(await evaluate(toolbar, 'window.api.browser.readAloud.getSettings()')).enabled, 'Read Aloud to turn off')
    await waitFor(() => page('Boolean(document.querySelector("[aria-label=\\"Delete the downloaded voice model\\"]"))'), 'Delete download offered while off')
    assert.equal(existsSync(join(downloadDir, 'ready.json')), true, 'turning off keeps the download')
    await page('document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]").click(); true')
    await waitFor(async () => (await download()).status === 'ready' && (await modelRow()) === 'ready', 'the cached model to be ready again')
    assert.equal(fixtureHits.length, hits, 'nothing downloaded again')
  } else {
    await waitFor(async () => (await download()).status === 'ready', 'the real model download', 8 * 60_000)
  }

  // --- 4. Voice tester
  smoke.step('voice tester: system voice')
  await waitFor(() => page('Boolean(document.querySelector(".read-aloud-tester"))'), 'the voice tester')
  assert.equal(await page('document.querySelector(".read-aloud-test-text textarea").value.length > 20'), true, 'a default sample sentence')
  assert.equal(await page('document.querySelectorAll("select[aria-label=\\"Read Aloud voice\\"] option").length >= 11'), true, 'Phonon voices listed')
  assert.equal(await setSelect('Voice tester engine', 'system'), true)
  await waitFor(() => page('!document.querySelector("select[aria-label=\\"Read Aloud voice\\"]")'), 'the voice picker to hide for the system engine')
  assert.equal(await clickButton('.read-aloud-tester', 'Play'), true)
  const systemTest = await waitFor(async () => { const value = await evaluate(toolbar, 'window.api.browser.readAloud.getTestState()'); return (value.status === 'finished' || value.status === 'error') && value }, 'the system-voice test to finish (or fail)', smoke.waitMs * 2)
  console.log(`system voice test: ${JSON.stringify(systemTest)}`)
  if (systemTest.status === 'error') assert.equal(systemTest.error, 'No system voices are available.', 'no voices on this runner, said plainly')
  else assert.ok(systemTest.stats && systemTest.stats.firstAudioMs !== null, 'first-audio time measured')
  await waitFor(() => page('Boolean(document.querySelector(".read-aloud-test-result"))'), 'the result line')
  const engineWin0 = engineWindow()
  assert.ok(engineWin0 && !engineWin0.isVisible(), 'the tester runs in the hidden engine window')
  assert.equal(await engineWin0.webContents.executeJavaScript('self.crossOriginIsolated === true'), true, 'the engine page is cross-origin isolated (wasm threads)')

  smoke.step('voice tester: Phonon')
  assert.equal(await setSelect('Voice tester engine', 'phonon'), true)
  await waitFor(() => page('Boolean(document.querySelector("select[aria-label=\\"Read Aloud voice\\"]"))'), 'the voice picker')
  assert.equal(await clickButton('.read-aloud-tester', 'Play'), true)
  const phononTest = await waitFor(async () => { const value = await evaluate(toolbar, 'window.api.browser.readAloud.getTestState()'); return (value.status === 'finished' || value.status === 'error') && value }, 'the Phonon test to finish', PHONON ? 3 * 60_000 : smoke.waitMs * 2)
  console.log(`phonon test: ${JSON.stringify(phononTest)}`)
  assert.equal(phononTest.status, 'finished', `the Phonon test finished (${phononTest.error})`)
  assert.equal(phononTest.engine, 'phonon')
  assert.equal(phononTest.fallbackReason, '', 'no fallback to the system voice')
  assert.ok(phononTest.stats.loadMs !== null && phononTest.stats.firstAudioMs !== null && phononTest.stats.audioSeconds > 0 && phononTest.stats.generateMs !== null, 'load, first audio and real-time factor measured')
  await waitFor(() => page('/\\d/.test(document.querySelector("[data-stat=\\"rtf\\"]")?.textContent ?? "") && /ms|s/.test(document.querySelector("[data-stat=\\"first-audio\\"]")?.textContent ?? "")'), 'the timings on screen')
  // Picking a voice there sets Read Aloud's default voice.
  assert.equal(await setSelect('Read Aloud voice', 'GgfEkEJtxZR7gnpy'), true)
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.readAloud.getSettings()')).voice === 'GgfEkEJtxZR7gnpy', 'the picked voice to become the default')
  await evaluate(toolbar, 'window.api.browser.readAloud.setSettings({ voice: "default" })')

  // --- 5. A page without an article
  smoke.step('no article')
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

  // --- 6. Reading before the download is done: progress in the player, then it starts.
  smoke.step('read an article while the model downloads')
  if (!PHONON) {
    await evaluate(toolbar, 'window.api.browser.readAloud.deleteDownloads()')
    assert.equal(existsSync(downloadDir), false, 'Delete download removes the files')
    assert.equal((await download()).status, 'absent')
    fixtureMode.slow = true
  }
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/2026/read-aloud-article`)})`)
  await waitFor(() => viewWithUrl(`${origin}/2026/read-aloud-article`), 'the article page')
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.state()')).reader === 'available', 'Reader view to be available')
  await evaluate(toolbar, 'window.api.browser.toggleReader()')
  const reader = await waitFor(() => viewWithUrl('surffish-reader://reader/'), 'the reader view')
  await waitFor(() => evaluate(reader, 'Boolean(document.querySelector(".reader-title")) && !document.getElementById("listen").hidden'), 'the Listen button in Reader view')
  await evaluate(reader, 'document.getElementById("listen").click(); true')
  if (!PHONON) {
    const waiting = await waitFor(async () => { const value = await state(); return value.status === 'downloading' && value.download && value.download.loaded > 0 && value.download.total === fixtureBytes && value }, 'the player to show the download progress')
    console.log(`player while downloading: ${JSON.stringify(waiting.download)}`)
    fixtureMode.slow = false
  }
  const timeout = PHONON ? Math.max(smoke.waitMs, 3 * 60_000) : smoke.waitMs
  const started = await waitFor(async () => { const value = await state(); return (value.status === 'playing' || value.status === 'error') && value }, 'the reading to start once the model is ready', timeout)
  console.log(`reading started: ${JSON.stringify({ status: started.status, engine: started.engine, total: started.total, error: started.error, fallbackReason: started.fallbackReason })}`)
  assert.equal(started.status, 'playing', `the reading started (${started.error})`)
  assert.equal(started.engine, 'phonon')
  assert.equal(started.fallbackReason, '', 'Phonon, no fallback')
  assert.ok(started.total >= paragraphs.length, `the article was split into sentences (${started.total})`)
  const engineWin = engineWindow()
  assert.ok(engineWin, 'the hidden engine window is open')
  assert.equal(engineWin.isVisible(), false, 'the engine window is never shown')
  assert.equal(await engineWin.webContents.executeJavaScript('self.crossOriginIsolated === true'), true)
  await waitFor(() => evaluate(reader, 'CSS.highlights.has("read-aloud")'), 'the spoken sentence highlight in Reader view')
  await evaluate(toolbar, 'window.api.browser.readAloud.control("pause")')
  await waitFor(async () => (await state()).status === 'paused', 'pause')
  await evaluate(toolbar, 'window.api.browser.readAloud.control("resume")')
  await waitFor(async () => (await state()).status === 'playing', 'resume')
  const before = (await state()).index
  await evaluate(toolbar, 'window.api.browser.readAloud.control("next")')
  await waitFor(async () => { const value = await state(); return value.index > before || value.status === 'idle' }, 'skip to the next sentence')

  // --- 7. Navigating the tab stops the reading.
  smoke.step('navigate away')
  if ((await state()).status !== 'idle') {
    await evaluate(toolbar, 'window.api.browser.toggleReader()')
    await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/plain`)})`)
    await waitFor(async () => (await state()).status === 'idle', 'navigation to stop the reading')
  }

  // --- Off again: the engine window closes, entries hide, the download stays.
  smoke.step('turn off')
  await evaluate(toolbar, 'window.api.browser.readAloud.setSettings({ enabled: false })')
  await waitFor(() => engineWindow() === undefined, 'the engine window to close')
  assert.equal((await commandIds()).some((id) => id.startsWith('readAloud.')), false)
  assert.equal((await download()).status, 'ready', 'turning off keeps the download')
  console.log('Electron Read Aloud smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron Read Aloud smoke failed:', error)
  app.exit(1)
})
