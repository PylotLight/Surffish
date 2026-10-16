// Settings search smoke, against the production build:
//   1. "/" focuses the field; typing filters General to the matching rows (synonyms too: "tray" →
//      the menu bar / tray icon row), highlights the matched characters (CSS Custom Highlight API),
//      counts matches, and the jump list shows only categories with matches.
//   2. A match inside a closed disclosure opens it while searching and closes it again after,
//      without saving that as the user's choice; row-less lists (search keywords) match too.
//   3. Nothing here: "Also in" chips name the pages that have matches; a chip opens that page with the
//      query kept and filtered there.
//   4. Esc clears the query (settings stay open); Esc on an empty field leaves settings.
//   5. Index drift: every label in the cross-page index (src/shared/settings-search.ts) is on its page.
// `bun run build && bun run test:electron-settings-search` (headless Linux: xvfb-run -a electron --no-sandbox ...).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-settings-search-smoke-${process.pid}`)
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(40)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ''}`)
}

/** The cross-page index, read from the source (labels per mode) so the smoke can't drift from it. */
function readIndex() {
  const source = readFileSync(resolve(__dirname, '../src/shared/settings-search.ts'), 'utf8')
  const index = {}
  for (const match of source.matchAll(/\.\.\.entries\('(\w+)', \[([\s\S]*?)\]\)(?:,|\n)/g)) {
    index[match[1]] = [...match[2].matchAll(/\['([^']+)'/g)].map((label) => label[1])
  }
  return index
}

async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG).serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows()[0], 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 860 })
  const surface = (name) => mainWindow.contentView.children.find((view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') === name } catch { return false } })
  await waitFor(() => surface('content') && surface('toolbar'), 'the renderer surfaces')
  const toolbar = surface('toolbar').webContents
  const content = surface('content').webContents
  const ev = (expression) => smoke.evaluate(content, expression)
  const mode = async () => (await smoke.evaluate(toolbar, 'window.api.browser.chrome.get()')).sidebarMode
  const type = (text) => ev(`(() => { const input = document.querySelector('.settings-search input'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const key = (target, name) => ev(`${target}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true, cancelable: true }))`)
  const visibleRows = () => ev('[...document.querySelectorAll(".settings-view .settings-row")].filter((row) => row.checkVisibility()).map((row) => row.querySelector(".settings-row-label")?.textContent ?? "")')
  const status = () => ev('document.querySelector(".settings-search-status .settings-search-count")?.textContent ?? null')
  await waitFor(() => smoke.evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api?.browser?.chrome)'), 'the toolbar renderer')

  smoke.step('Index drift: every indexed label is on its page')
  const index = readIndex()
  assert.ok(Object.keys(index).length >= 6 && index.settings?.length > 20, `index parsed (${Object.keys(index).join(', ')})`)
  for (const page of ['settings', 'newtab', 'integrations', 'feeds', 'privacy', 'watchers']) {
    await smoke.evaluate(toolbar, `window.api.browser.chrome.set({ sidebarMode: ${JSON.stringify(page)} })`)
    const missing = await waitFor(async () => {
      const gone = await ev(`${JSON.stringify(index[page])}.filter((label) => !(document.querySelector('.settings-view')?.textContent ?? '').includes(label))`)
      return gone.length === 0 ? [] : null
    }, `every ${page} label from the index (${index[page].join(', ')})`).catch(async (error) => {
      const gone = await ev(`${JSON.stringify(index[page])}.filter((label) => !(document.querySelector('.settings-view')?.textContent ?? '').includes(label))`)
      throw new Error(`${error.message} Missing: ${gone.join(', ')}`)
    })
    assert.deepEqual(missing, [])
  }

  smoke.step('"/" focuses the field; a query filters, counts and highlights')
  await smoke.evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "settings" })')
  await waitFor(() => ev('Boolean(document.querySelector(\'[aria-label="Mini window grouping"]\'))'), 'General loaded')
  await key('document.body', '/')
  assert.equal(await ev('document.activeElement === document.querySelector(".settings-search input")'), true, '"/" focuses search')
  await type('tray')
  await waitFor(async () => JSON.stringify(await visibleRows()) === JSON.stringify(['Tray icon']), '"tray" to leave only the tray icon row')
  assert.equal(await status(), '1 match for “tray”')
  assert.deepEqual(await ev('[...document.querySelectorAll(".settings-toc button")].map((b) => b.textContent)'), ['Mini window1'], 'jump list: only the category with matches, with its count')
  assert.ok(await ev('CSS.highlights.get("settings-search")?.size >= 1'), 'matched text highlighted')
  assert.equal(await ev('[...document.querySelectorAll(".settings-category")].filter((c) => c.checkVisibility()).length'), 1, 'other categories hidden')

  smoke.step('Matches inside a closed disclosure open it, then it closes again')
  assert.equal(await ev('document.querySelector(\'details[data-disclosure="mini-window-tuck"]\').open'), false)
  await type('hover delay')
  await waitFor(async () => JSON.stringify(await visibleRows()) === JSON.stringify(['Hover delay']), '"hover delay" to find the row in Edge tuck & peek')
  assert.equal(await ev('document.querySelector(\'details[data-disclosure="mini-window-tuck"]\').open'), true, 'the disclosure opened for the match')
  assert.equal(await ev('Boolean(document.querySelector(\'details[data-disclosure="mini-window-windows"]\').checkVisibility())'), false, 'a disclosure without matches is hidden')
  await type('youtube')
  await waitFor(() => ev('document.querySelector(\'details[data-disclosure="search-keywords-list"]\').open && Boolean(document.querySelector(\'[aria-label="Edit YouTube"]\')?.checkVisibility())'), 'the keyword list to open for "youtube"')
  assert.equal(await ev('document.querySelector(\'details[data-disclosure="mini-window-tuck"]\').open'), false, 'the tuck disclosure closed again once it had no match')
  await type('')
  await waitFor(() => ev('!document.querySelector(".settings-search-status") && document.querySelectorAll("[data-search-miss]").length === 0'), 'clearing to restore the page')
  assert.equal(await ev('document.querySelector(\'details[data-disclosure="search-keywords-list"]\').open'), false, 'search never leaves a disclosure open')
  assert.equal(await ev('localStorage.getItem("surffish.settings.open.search-keywords-list")'), null, 'and never saves search-opened state')
  assert.equal(await ev('CSS.highlights.get("settings-search")?.size ?? 0'), 0, 'highlights cleared')

  smoke.step('Nothing here: "Also in" chips open the page with the query kept')
  await type('clock')
  await waitFor(async () => (await status()) === 'Nothing on this page matches “clock”', 'the empty state')
  assert.deepEqual(await visibleRows(), [])
  const chips = await ev('[...document.querySelectorAll(".settings-search-chip")].map((chip) => chip.textContent)')
  assert.deepEqual(chips, ['New Tab 5'], 'New Tab offered with its match count (clock display options added Oct 2026)')
  await ev('document.querySelector(".settings-search-chip").click()')
  await waitFor(async () => (await mode()) === 'newtab', 'the chip to open New Tab')
  await waitFor(async () => {
    const rows = await visibleRows()
    return rows.includes('Show clock') && !rows.includes('Show site names')
  }, 'New Tab filtered to the clock rows')
  assert.equal(await ev('document.querySelector(".settings-search input").value'), 'clock', 'query kept across pages')

  smoke.step('Esc clears, Esc again leaves settings')
  await key('document.querySelector(".settings-search input")', 'Escape')
  await waitFor(() => ev('document.querySelector(".settings-search input").value === "" && !document.querySelector(".settings-search-status")'), 'Esc to clear the query')
  assert.equal(await mode(), 'newtab', 'still in settings after the first Esc')
  await key('document.querySelector(".settings-search input")', 'Escape')
  await waitFor(async () => (await mode()) === 'tabs', 'the second Esc to close settings')
  console.log('Electron settings search smoke passed.')
}

run().then(() => app.exit(0), (error) => {
  console.error('Electron settings search smoke failed:', error)
  app.exit(1)
})
