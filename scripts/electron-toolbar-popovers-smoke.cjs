// Toolbar popover smoke: every toolbar popover (downloads + its … menu, extensions, bookmarks,
// site menu, history panel, the Surffish menu) must
//   1. close on a press on the page (a separate WebContentsView the toolbar never hears), a press on
//      the sidebar view, a press elsewhere in the toolbar, Escape, the window losing focus, and a
//      tab switch, and stay open on a press inside itself;
//   2. fit inside the toolbar view (the view is sized to the popover; a clipped bottom row is a fail);
//   3. use the shared popover type scale (13px body).
// Opens each one with a real mouse click on its button (sendInputEvent), not element.click().
// Runs the production build: `bun run build && bun run test:electron-toolbar-popovers`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-toolbar-popovers-smoke.cjs`).
// `--report-only` prints POPOVERS_REPORT without asserting.
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const userData = join(tmpdir(), `surffish-toolbar-popovers-${process.pid}`)
const REPORT_ONLY = process.argv.includes('--report-only')
const SHOTS = process.env.POPOVER_SCREENSHOTS || ''
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(`<!doctype html><meta charset="utf-8"><title>Page ${request.url}</title><body style="height:2000px"><p>${request.url}</p>`)
})

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const step = (text) => process.stderr.write(`[toolbar-popovers] ${text}\n`)

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
  // Short enough that a fixed-height popover would run past the window.
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 640 })
  const viewFor = (surface) => mainWindow.contentView.children.find((view) => surfaceOf(view.webContents) === surface)
  const toolbar = await waitFor(() => viewFor('toolbar'), 'the toolbar surface')
  await waitFor(() => toolbar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const inToolbar = (expression) => toolbar.webContents.executeJavaScript(expression)
  await inToolbar('window.api.browser.chrome.set({ sidebarPinned: true })')
  const sidebar = await waitFor(() => viewFor('sidebar'), 'the sidebar surface')
  await waitFor(() => sidebar.webContents.executeJavaScript('document.readyState === "complete" && Boolean(window.api)'), 'the sidebar renderer')
  step('shell ready')
  // Downloads (contextual) and History (in the Surffish menu by default) get pinned, so each has a
  // toolbar button to click (shared/toolbar-layout.ts). Written from another surface: the toolbar
  // picks it up through the storage event, like a change made in Settings.
  await sidebar.webContents.executeJavaScript(`localStorage.setItem('surffish.toolbar.layout', JSON.stringify({ version: 1, placement: { downloads: 'pinned', history: 'pinned' } }))`)
  await waitFor(() => toolbar.webContents.executeJavaScript('document.querySelector(".downloads-toolbar-button")?.hidden === false && document.querySelector("button[aria-label=\\"Browsing history\\"]")?.hidden === false'), 'Downloads and History pinned to the toolbar')

  // A few bookmarks and downloads-free history so the menus have rows.
  await inToolbar(`window.api.browser.navigate(${JSON.stringify(`${origin}/one`)})`)
  await waitFor(() => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith('/one') && !contents.isLoading()), '/one to load')
  await inToolbar(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/two`)})`)
  await waitFor(() => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith('/two') && !contents.isLoading()), '/two to load')
  await waitFor(async () => (await inToolbar('Boolean(document.querySelector(".extension-overflow-button"))')), 'the extensions button')
  const pageOf = async () => {
    const tabs = await inToolbar('window.api.browser.tabs.get()')
    const active = tabs.find((tab) => tab.active) ?? tabs.at(-1)
    return webContents.getAllWebContents().find((contents) => contents.getURL() === active.url && surfaceOf(contents) === null)
  }

  const isOpen = (selector) => inToolbar(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
  const historyOpen = async () => (await inToolbar('window.api.browser.chrome.get()')).sidebarMode === 'history'
  const clickInToolbar = async (selector) => {
    const box = await inToolbar(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    toolbar.webContents.focus()
    toolbar.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    toolbar.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  }

  // Each popover: how to open it, how to tell it is open, and its last row (must not be clipped).
  const POPOVERS = [
    { name: 'downloads', open: () => clickInToolbar('.downloads-toolbar-button'), isOpen: () => isOpen('#downloads-popup'), selector: '#downloads-popup', lastRow: '#downloads-popup > :last-child' },
    {
      name: 'downloads … menu',
      open: async () => {
        if (!(await isOpen('#downloads-popup'))) await clickInToolbar('.downloads-toolbar-button')
        await waitFor(() => isOpen('#downloads-popup .downloads-menu-control button'), 'the downloads … button')
        await clickInToolbar('#downloads-popup .downloads-menu-control button')
      },
      isOpen: () => isOpen('#downloads-popup .downloads-menu'),
      selector: '#downloads-popup .downloads-menu',
      lastRow: '#downloads-popup .downloads-menu > :last-child'
    },
    { name: 'extensions', open: () => clickInToolbar('.extension-overflow-button'), isOpen: () => isOpen('#extensions-menu'), selector: '#extensions-menu', lastRow: '#extensions-menu .extensions-menu-manage' },
    { name: 'bookmarks', open: () => clickInToolbar('.bookmarks-menu-button'), isOpen: () => isOpen('#bookmarks-menu'), selector: '#bookmarks-menu', lastRow: '#bookmarks-menu .bookmarks-menu-footer > :last-child' },
    { name: 'site menu', open: () => clickInToolbar('.site-actions-button'), isOpen: () => isOpen('#site-actions-menu'), selector: '#site-actions-menu', lastRow: '#site-actions-menu > :last-child' },
    { name: 'history', open: () => clickInToolbar('button[aria-label="Browsing history"]'), isOpen: historyOpen, selector: null, lastRow: null },
    // Spaced out so back-to-back opens never add up to the logo's triple-click easter egg (450 ms bursts).
    { name: 'surffish menu', open: async () => { await delay(500); await clickInToolbar('.toolbar-brand strong') }, isOpen: () => isOpen('#surffish-menu'), selector: '#surffish-menu', lastRow: '#surffish-menu > :last-child' }
  ]

  const pressPage = async () => {
    const page = await pageOf()
    page.sendInputEvent({ type: 'mouseDown', x: 700, y: 420, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', x: 700, y: 420, button: 'left', clickCount: 1 })
  }
  const DISMISSERS = [
    ['a press on the page', pressPage],
    ['a press on the sidebar', () => {
      sidebar.webContents.sendInputEvent({ type: 'mouseDown', x: 60, y: 300, button: 'left', clickCount: 1 })
      sidebar.webContents.sendInputEvent({ type: 'mouseUp', x: 60, y: 300, button: 'left', clickCount: 1 })
    }],
    ['a press elsewhere in the toolbar', () => clickInToolbar('.omnibox > input[type=text]')],
    ['Escape', () => {
      toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      toolbar.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    }],
    // No window manager under xvfb, so the OS-level blur is emitted directly (main's handler is what runs on a Mac).
    ['the window losing focus', () => mainWindow.emit('blur')],
    ['a tab switch', async () => {
      const tabs = await inToolbar('window.api.browser.tabs.get()')
      const other = tabs.find((tab) => !tab.active)
      await inToolbar(`window.api.browser.tabs.activate(${JSON.stringify(other.id)})`)
    }]
  ]

  const results = []
  const fits = []
  const typeScale = []
  for (const popover of POPOVERS) {
    for (const [label, act] of DISMISSERS) {
      // Escape in the history panel goes to whichever surface has focus; it lives in the sidebar.
      await popover.open()
      const opened = await waitFor(popover.isOpen, `${popover.name} to open`, 3000).then(() => true, () => false)
      if (!opened) {
        results.push({ popover: popover.name, on: label, closed: false, note: 'did not open' })
        step(`${popover.name}: did not open`)
        break
      }
      // Let the entry animation settle and main learn the new toolbar extent.
      await delay(350)
      if (label === DISMISSERS[0][0]) {
        if (popover.selector) {
          const box = await inToolbar(`(() => {
            const el = document.querySelector(${JSON.stringify(popover.selector)})
            const last = document.querySelector(${JSON.stringify(popover.lastRow)})
            const r = el.getBoundingClientRect(), l = last ? last.getBoundingClientRect() : r
            const body = getComputedStyle(last || el).fontSize
            const title = el.querySelector('strong, h2, header')
            return { bottom: Math.ceil(r.bottom), lastBottom: Math.ceil(l.bottom), scrollable: el.scrollHeight > el.clientHeight + 1 || Boolean(el.querySelector('[data-popover-scroll]')), viewport: innerHeight, body: parseFloat(body), title: title ? parseFloat(getComputedStyle(title).fontSize) : null }
          })()`)
          const viewHeight = toolbar.getBounds().height
          const fit = { popover: popover.name, ...box, viewHeight, windowHeight: mainWindow.getContentBounds().height, fits: box.bottom <= viewHeight && box.lastBottom <= viewHeight }
          fits.push(fit)
          typeScale.push({ popover: popover.name, body: box.body, title: box.title })
          step(`${popover.name} fit: ${JSON.stringify(fit)}`)
          if (SHOTS) writeFileSync(`${SHOTS}-${popover.name.replace(/[^a-z]+/g, '-')}.png`, (await toolbar.webContents.capturePage()).toPNG())
        }
        // A press inside the popover keeps it open.
        if (popover.selector) {
          await inToolbar(`document.querySelector(${JSON.stringify(popover.selector)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
          await delay(150)
          const stays = await popover.isOpen()
          results.push({ popover: popover.name, on: 'a press inside it', closed: !stays, expectOpen: true })
          step(`${popover.name} stays open on a press inside: ${stays}`)
        }
      }
      await act()
      // The History panel is drawn in the sidebar view: a press there is a press inside it.
      if (popover.name === 'history' && label === 'a press on the sidebar') {
        await delay(400)
        const stays = await popover.isOpen()
        results.push({ popover: popover.name, on: 'a press inside it (the sidebar)', closed: !stays, expectOpen: true })
        step(`${popover.name} stays open on a press inside it (the sidebar): ${stays}`)
        await inToolbar(`window.api.browser.chrome.set({ sidebarMode: 'tabs' })`)
        await delay(200)
        continue
      }
      const closed = await waitFor(async () => !(await popover.isOpen()), `${popover.name} to close on ${label}`, 2500).then(() => true, () => false)
      results.push({ popover: popover.name, on: label, closed })
      step(`${popover.name} closes on ${label}: ${closed}`)
      if (!closed) {
        // Reset for the next case.
        if (popover.name === 'history') await inToolbar(`window.api.browser.chrome.set({ sidebarMode: 'tabs' })`)
        else await clickInToolbar('.omnibox > input[type=text]')
        await delay(200)
      }
      // A press on the page/omnibox may leave the address bar focused; start each case clean.
      await delay(150)
    }
  }
  // ---- Logo easter egg: triple-click the Surffish logo.
  const eggOpen = () => inToolbar(`Boolean(document.querySelector('.surffish-egg'))`)
  const tripleClickBrand = async () => {
    const box = await inToolbar(`(() => { const r = document.querySelector('.toolbar-brand-icon').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    toolbar.webContents.focus()
    for (let click = 1; click <= 3; click += 1) {
      toolbar.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: click })
      toolbar.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: click })
      await delay(60)
    }
  }
  // Two clicks do nothing.
  const brandBox = await inToolbar(`(() => { const r = document.querySelector('.toolbar-brand-icon').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  for (let click = 1; click <= 2; click += 1) {
    toolbar.webContents.sendInputEvent({ type: 'mouseDown', x: brandBox.x, y: brandBox.y, button: 'left', clickCount: click })
    toolbar.webContents.sendInputEvent({ type: 'mouseUp', x: brandBox.x, y: brandBox.y, button: 'left', clickCount: click })
  }
  await delay(600)
  const egg = { doubleClickOpens: await eggOpen() }
  await tripleClickBrand()
  egg.tripleClickOpens = await waitFor(eggOpen, 'the logo easter egg', 3000).then(() => true, () => false)
  if (egg.tripleClickOpens) {
    await delay(700)
    const windowHeight = mainWindow.getContentBounds().height
    egg.viewHeight = toolbar.getBounds().height
    egg.windowHeight = windowHeight
    egg.box = await inToolbar(`(() => { const r = document.querySelector('.surffish-egg').getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width), animated: getComputedStyle(document.querySelector('.surffish-egg-logo')).animationName } })()`)
    egg.nearWindowSized = egg.box.height >= windowHeight - 60 && egg.viewHeight >= windowHeight - 2
    if (SHOTS) writeFileSync(`${SHOTS}-easter-egg.png`, (await toolbar.webContents.capturePage()).toPNG())
    toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    egg.closesOnEscape = await waitFor(async () => !(await eggOpen()), 'the egg to close on Escape', 2500).then(() => true, () => false)
    await tripleClickBrand()
    await waitFor(eggOpen, 'the egg again', 3000)
    await delay(500)
    toolbar.webContents.sendInputEvent({ type: 'mouseDown', x: 500, y: 300, button: 'left', clickCount: 1 })
    toolbar.webContents.sendInputEvent({ type: 'mouseUp', x: 500, y: 300, button: 'left', clickCount: 1 })
    egg.closesOnClick = await waitFor(async () => !(await eggOpen()), 'the egg to close on a click', 2500).then(() => true, () => false)
    await delay(400)
    egg.viewShrinksBack = toolbar.getBounds().height < 200
  }
  step(`easter egg: ${JSON.stringify(egg)}`)

  const report = { results, fits, typeScale, egg }
  console.log(`POPOVERS_REPORT ${JSON.stringify(report)}`)
  if (!REPORT_ONLY) {
    for (const entry of results) {
      if (entry.expectOpen) assert.ok(!entry.closed, `${entry.popover} stays open on ${entry.on}`)
      else assert.ok(entry.closed, `${entry.popover} closes on ${entry.on}${entry.note ? ` (${entry.note})` : ''}`)
    }
    for (const fit of fits) assert.ok(fit.fits, `${fit.popover} fits inside the toolbar view (bottom ${fit.bottom}/${fit.lastBottom}px, view ${fit.viewHeight}px)`)
    for (const scale of typeScale) assert.ok(scale.body >= 13, `${scale.popover} body text is at least 13px (got ${scale.body}px)`)
    assert.ok(!egg.doubleClickOpens, 'a double-click on the logo does nothing')
    assert.ok(egg.tripleClickOpens, 'a triple-click on the logo opens the easter egg')
    assert.ok(egg.nearWindowSized, `the easter egg is near window-sized (${JSON.stringify(egg.box)}, view ${egg.viewHeight}/${egg.windowHeight})`)
    assert.ok(egg.closesOnEscape, 'the easter egg closes on Escape')
    assert.ok(egg.closesOnClick, 'the easter egg closes on a click')
    assert.ok(egg.viewShrinksBack, 'the toolbar view shrinks back after the easter egg closes')
    console.log('Toolbar popovers smoke passed.')
  }
}

run().then(() => app.exit(0), (error) => {
  console.error(error)
  app.exit(1)
})
