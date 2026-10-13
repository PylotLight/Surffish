// Integration smoke for the session tables in surffish.db: open tabs are saved to the database (and
// still to browser-session.json), a restart restores from the database, and a browser-session.json
// written by something else (a fallback run / older build) wins over the database. Three launches
// on one profile. Runs the production build:
// `bun run build && bun run test:electron-sqlite-session` (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-sqlite-session-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const phase = (process.argv.find((arg) => arg.startsWith('--phase=')) ?? '--phase=main').slice(8)
const userData = process.env.SURFFISH_SESSION_SMOKE_DIR || join(tmpdir(), `surffish-session-smoke-${process.pid}`)
const port = Number(process.env.SURFFISH_SESSION_SMOKE_PORT || 0)
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>Session ${request.url}</title><p>hi</p>`)
})

let mainWindow
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
const views = () => mainWindow.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed())
const surface = (name) => views().find((view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') === name } catch { return false } })
async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}
function sqlite(sql, ...params) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(join(userData, 'surffish.db'))
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}
const sessionFile = join(userData, 'browser-session.json')

async function launch() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  await waitFor(() => surface('toolbar'), 'the toolbar surface')
  const toolbar = surface('toolbar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  return { toolbar, origin: `http://127.0.0.1:${port}` }
}

const tabUrls = (toolbar) => evaluate(toolbar, 'window.api.browser.tabs.get().then((tabs) => tabs.map((tab) => tab.url))')

function runPhase(nextPhase, serverPort) {
  const child = spawn(process.execPath, [...process.argv.slice(1).filter((arg) => !arg.startsWith('--phase')), `--phase=${nextPhase}`], {
    env: { ...process.env, SURFFISH_SESSION_SMOKE_DIR: userData, SURFFISH_SESSION_SMOKE_PORT: String(serverPort) },
    stdio: 'inherit'
  })
  return new Promise((resolvePromise) => child.once('exit', resolvePromise))
}

async function runSave() {
  const { toolbar, origin } = await launch()
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(`${origin}/one`)})`)
  await evaluate(toolbar, `window.api.browser.tabs.create(${JSON.stringify(`${origin}/two`)})`)
  await waitFor(async () => (await tabUrls(toolbar)).includes(`${origin}/two`), 'the second tab')
  await waitFor(() => sqlite('SELECT url FROM session_tabs WHERE deleted_at IS NULL ORDER BY position').map((row) => row.url).join(' ') === `${origin}/one ${origin}/two`, 'both tabs in session_tabs')
  assert.ok(readFileSync(sessionFile, 'utf8').includes(`${origin}/two`), 'browser-session.json is still written')
  const ids = sqlite('SELECT id FROM session_tabs WHERE deleted_at IS NULL ORDER BY position').map((row) => row.id)
  writeFileSync(join(userData, 'ids.json'), JSON.stringify(ids))
  console.log('[session-smoke] save phase passed')
}

async function runRestore() {
  // Change a tab URL in the database only. The JSON file is untouched (still marked as ours), so
  // restoring /edited proves the database was the source.
  const { origin: expectedOrigin } = { origin: `http://127.0.0.1:${port}` }
  sqlite("UPDATE session_tabs SET url = ? WHERE url = ? AND deleted_at IS NULL", `${expectedOrigin}/edited`, `${expectedOrigin}/two`)
  const { toolbar } = await launch()
  await waitFor(async () => (await tabUrls(toolbar)).join(' ') === `${expectedOrigin}/one ${expectedOrigin}/edited`, 'tabs restored from the database')
  await delay(1500)
  const ids = sqlite('SELECT id FROM session_tabs WHERE deleted_at IS NULL ORDER BY position').map((row) => row.id)
  assert.deepEqual(ids, JSON.parse(readFileSync(join(userData, 'ids.json'), 'utf8')), 'restored tabs keep their row ids')
  console.log('[session-smoke] restore phase passed')
}

async function runJsonWins() {
  // Something else (a fallback run, an older build) rewrote browser-session.json: it wins.
  const origin = `http://127.0.0.1:${port}`
  writeFileSync(sessionFile, JSON.stringify({ version: 1, tabs: [`${origin}/from-json`], activeIndex: 0, pinnedTabs: [] }))
  const { toolbar } = await launch()
  await waitFor(async () => (await tabUrls(toolbar)).join(' ') === `${origin}/from-json`, 'tabs restored from the changed JSON file')
  await waitFor(() => sqlite('SELECT url FROM session_tabs WHERE deleted_at IS NULL').map((row) => row.url).join(' ') === `${origin}/from-json`, 'the database to take the JSON session')
  console.log('[session-smoke] json-wins phase passed')
}

async function main() {
  if (phase === 'save') return runSave()
  if (phase === 'restore') return runRestore()
  if (phase === 'json-wins') return runJsonWins()
  // Orchestrator: serves the fixture pages and runs each launch as its own Electron process.
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const serverPort = server.address().port
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  for (const next of ['save', 'restore', 'json-wins']) assert.equal(await runPhase(next, serverPort), 0, `the ${next} phase passed`)
  console.log('Electron SQLite session smoke passed.')
}

main().then(() => app.exit(0), (error) => {
  console.error(`Electron SQLite session smoke failed (${phase}):`, error)
  app.exit(1)
})
