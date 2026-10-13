// Integration smoke for the SQLite profile store (surffish.db): browsing-history.json is imported on
// first open, new visits land in the database, Clear history empties both the database and the
// legacy JSON copy, and SURFFISH_STORE=json falls back to the JSON file. Runs the production build:
// `bun run build && bun run test:electron-sqlite-store` (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-sqlite-store-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const phase = process.argv.includes('--phase=fallback') ? 'fallback' : 'sqlite'
const userData = process.env.SURFFISH_STORE_SMOKE_DIR || join(tmpdir(), `surffish-store-smoke-${process.pid}`)
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>Store fixture ${request.url}</title><p>hi</p>`)
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

function readDb(sql) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(join(userData, 'surffish.db'), { readOnly: true })
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

const legacyFile = join(userData, 'browsing-history.json')

async function launch() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  await waitFor(() => surface('toolbar'), 'the toolbar surface')
  const toolbar = surface('toolbar')
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  return { toolbar, origin: `http://127.0.0.1:${server.address().port}` }
}

async function visit(toolbar, url) {
  await evaluate(toolbar, `window.api.browser.navigate(${JSON.stringify(url)})`)
  await waitFor(async () => (await evaluate(toolbar, 'window.api.browser.history.get()')).some((entry) => entry.url === url && entry.title.startsWith('Store fixture')), `a titled history entry for ${url}`)
}

async function runSqlite() {
  // An existing profile from before the database: two visits in browsing-history.json.
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(legacyFile, JSON.stringify([
    { id: 'legacy-2', url: 'https://legacy-two.test/', title: 'Legacy two', visitedAt: Date.now() - 60_000 },
    { id: 'legacy-1', url: 'https://legacy-one.test/', title: 'Legacy one', visitedAt: Date.now() - 120_000 }
  ]))
  const { toolbar, origin } = await launch()

  const history = await evaluate(toolbar, 'window.api.browser.history.get()')
  assert.deepEqual(history.slice(-2).map((entry) => entry.id), ['legacy-2', 'legacy-1'], 'legacy visits are imported, newest first')
  assert.ok(existsSync(join(userData, 'surffish.db')), 'surffish.db is created')
  assert.equal(readDb('PRAGMA journal_mode')[0].journal_mode, 'wal')

  await visit(toolbar, `${origin}/one`)
  const rows = readDb('SELECT id, url, title FROM history_visits ORDER BY visited_at DESC')
  assert.equal(rows[0].url, `${origin}/one`, 'a new visit is written to the database right away')
  assert.match(rows[0].title, /^Store fixture/, 'with its title')
  assert.ok(rows.some((row) => row.id === 'legacy-1'))
  assert.ok(readDb("SELECT count(*) AS n FROM oplog WHERE entity = 'history_visit'")[0].n >= 3, 'visits are in the change log')
  const legacyBefore = readFileSync(legacyFile, 'utf8')
  assert.ok(!legacyBefore.includes('/one'), 'the legacy JSON file is no longer written')

  // Forget one site, then clear everything: both stores, and the change log keeps no URLs.
  const removed = await evaluate(toolbar, 'window.api.browser.safety.siteData.forget("https://legacy-two.test", true)')
  assert.ok(removed, 'Forget this site ran')
  assert.ok(!readFileSync(legacyFile, 'utf8').includes('legacy-two'), 'the forgotten site is scrubbed from the legacy file too')
  assert.equal(readDb("SELECT count(*) AS n FROM history_visits WHERE url LIKE '%legacy-two%'")[0].n, 0)
  await evaluate(toolbar, 'window.api.browser.safety.privacy.clear({ range: "all", history: true, downloads: false, cookies: false, cache: false, permissions: false, zoom: false })')
  assert.equal((await evaluate(toolbar, 'window.api.browser.history.get()')).length, 0, 'history cleared')
  assert.equal(readDb('SELECT count(*) AS n FROM history_visits')[0].n, 0, 'database cleared')
  assert.equal(readFileSync(legacyFile, 'utf8'), '[]', 'legacy JSON cleared')
  assert.ok(!JSON.stringify(readDb("SELECT * FROM oplog WHERE entity = 'history_visit'")).includes('127.0.0.1'), 'no visited URL left in the history change log')

  await visit(toolbar, `${origin}/two`)
  console.log('[store-smoke] sqlite phase passed; relaunching with SURFFISH_STORE=json')

  // Fallback: the same profile with the database switched off reads and writes JSON again.
  const child = spawn(process.execPath, [...process.argv.slice(1).filter((arg) => !arg.startsWith('--phase')), '--phase=fallback'], {
    env: { ...process.env, SURFFISH_STORE: 'json', SURFFISH_STORE_SMOKE_DIR: join(userData, 'fallback') },
    stdio: 'inherit'
  })
  const code = await new Promise((resolvePromise) => child.once('exit', resolvePromise))
  assert.equal(code, 0, 'the fallback phase passed')
  console.log('Electron SQLite store smoke passed.')
}

async function runFallback() {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(legacyFile, JSON.stringify([{ id: 'json-1', url: 'https://json-only.test/', title: 'JSON only', visitedAt: Date.now() - 1000 }]))
  const { toolbar, origin } = await launch()
  assert.deepEqual((await evaluate(toolbar, 'window.api.browser.history.get()')).map((entry) => entry.id), ['json-1'])
  await visit(toolbar, `${origin}/fallback`)
  await waitFor(() => readFileSync(legacyFile, 'utf8').includes('/fallback'), 'the visit to be written to browsing-history.json')
  await evaluate(toolbar, `window.api.browser.bookmarks.create({ parentId: 'favourites', title: 'Fallback mark', url: ${JSON.stringify(`${origin}/mark`)} })`)
  await waitFor(() => existsSync(join(userData, 'bookmarks.json')) && readFileSync(join(userData, 'bookmarks.json'), 'utf8').includes('Fallback mark'), 'the bookmark to be written to bookmarks.json')
  assert.ok(!existsSync(join(userData, 'surffish.db')), 'no database is created when switched off')
  console.log('[store-smoke] fallback phase passed')
}

;(phase === 'fallback' ? runFallback() : runSqlite()).then(() => app.exit(0), (error) => {
  console.error(`Electron SQLite store smoke failed (${phase}):`, error)
  app.exit(1)
})
