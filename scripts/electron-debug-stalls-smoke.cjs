// Integration smoke for Debug logging (main/stall-logger.ts), against the production build:
//   1. Off by default: an artificial main-thread stall writes nothing (no stalls.log at all).
//   2. On (Settings toggle over IPC; persisted): a "logging on" line, then an artificial ~1.2 s
//      main-thread stall writes a STALL line with a process / tab snapshot.
//   3. A crashed tab writes a RENDERER-GONE line naming the page by host only (no path).
//   4. Off again: "logging off", and a new stall writes nothing.
// `bun run build && bun run test:electron-debug-stalls`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-debug-stalls-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents: allWebContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-debug-stalls-smoke-${process.pid}`)
const logsDir = join(userData, 'logs-dir')
const logPath = join(logsDir, 'stalls.log')
const SECRET_PATH = '/fixture-secret-path'
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end('<!doctype html><meta charset="utf-8"><title>Stall fixture</title><p>fixture</p>')
})

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
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}
const pageContents = (predicate) => allWebContents.getAllWebContents().find((contents) => !contents.isDestroyed() && predicate(contents.getURL(), contents))
const readLog = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '')
const lines = (kind) => readLog().split('\n').filter((line) => new RegExp(`^\\S+ \\S+ [+-]\\d\\d:\\d\\d ${kind} `).test(line))
/** Block the main thread (this smoke runs in the app's main process) for `ms`. */
function blockMain(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) { /* busy */ }
}

async function run() {
  app.setPath('userData', userData)
  app.setAppLogsPath(logsDir)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const host = `127.0.0.1:${server.address().port}`
  const fixtureUrl = `http://${host}${SECRET_PATH}?view=inbox`
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [fixtureUrl], activeIndex: 0 }))

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  const toolbar = await waitFor(() => mainWindow.contentView.children.map((view) => view.webContents).find((contents) => contents && !contents.isDestroyed() && /[?&]surface=toolbar/.test(contents.getURL()) && !contents.isLoading()), 'the toolbar surface')
  const page = await waitFor(() => pageContents((url, contents) => url === fixtureUrl && !contents.isLoading()), 'the fixture tab')

  smoke.step('Off by default: a stall writes nothing')
  const initial = await smoke.evaluate(toolbar, 'window.api.browser.debugLogging.get()')
  assert.equal(initial.enabled, false)
  assert.equal(initial.active, false)
  assert.equal(initial.logPath, logPath, 'the log lives in the app logs folder')
  blockMain(900)
  await delay(800)
  assert.equal(existsSync(logPath), false, 'no stalls.log while debug logging is off')

  smoke.step('On: logging-on line, then a STALL line for a ~1.2 s main-thread block')
  const on = await smoke.evaluate(toolbar, 'window.api.browser.debugLogging.set({ enabled: true })')
  assert.equal(on.active, true)
  assert.deepEqual(JSON.parse(readFileSync(join(userData, 'browser-debug-logging.json'), 'utf8')), { enabled: true }, 'the setting is saved (survives a restart)')
  await waitFor(() => lines('DEBUG').some((line) => line.includes('logging on')), 'the "logging on" line')
  assert.equal(lines('STALL').length, 0, 'no stall before the artificial one')
  await delay(300)
  blockMain(1200)
  const stall = await waitFor(() => lines('STALL')[0], 'a STALL line')
  const ms = Number(/blocked ~(\d+)ms/.exec(stall)?.[1])
  assert.ok(ms >= 1100 && ms < 5000, `stall length ${ms} ms: ${stall}`)
  assert.match(stall, /procs=\d+ cpu=/, 'process snapshot')
  assert.match(stall, /Browser×1/, 'main process in the snapshot')
  assert.match(stall, /windows=1 \| tabs=1 awake=1/, 'window / tab counts')
  assert.match(stall, /prerender=0/, 'prerender count')
  assert.match(stall, /snapshotWrites=\d+/, 'wake snapshot writes')

  smoke.step('A crashed tab is logged by host only')
  page.forcefullyCrashRenderer()
  const gone = await waitFor(() => lines('RENDERER-GONE').find((line) => line.includes(host)), 'a RENDERER-GONE line for the fixture host')
  assert.match(gone, /webContents|window|view|backgroundPage|remote|webview|offscreen/, `names the webContents type: ${gone}`)
  assert.ok(!readLog().includes(SECRET_PATH) && !readLog().includes('view=inbox'), 'no page path or query in the log')

  smoke.step('Off again: nothing more is written')
  const off = await smoke.evaluate(toolbar, 'window.api.browser.debugLogging.set({ enabled: false })')
  assert.equal(off.active, false)
  await waitFor(() => lines('DEBUG').some((line) => line.includes('logging off')), 'the "logging off" line')
  const stallsBefore = lines('STALL').length
  blockMain(900)
  await delay(800)
  assert.equal(lines('STALL').length, stallsBefore, 'no STALL line while off')
  console.log('--- stalls.log ---\n' + readLog())
  console.log('Electron debug stalls smoke passed.')
}

run().then(() => {
  server.close()
  app.exit(0)
}).catch((error) => {
  console.error(error)
  console.error('--- stalls.log ---\n' + readLog())
  server.close()
  app.exit(1)
})
