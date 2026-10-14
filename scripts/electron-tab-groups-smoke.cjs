// Integration smoke for tab groups (Spaces off, then on): new group from tabs, add / remove,
// rename / recolour, collapse / expand (the sidebar hides the run and the active tab leaves it),
// sidebar drops into and out of a group, a split joining a group as one, dragging a whole group
// (reorder + to a new window), palette commands and the tab context menu, the archive's group
// label, ungroup / close group (asks first), groups inside a Space, and session restore.
// Runs the production build: `bun run build && bun run test:electron-tab-groups`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-tab-groups-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, dialog, Menu } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
const phase = phaseArg ? phaseArg.slice('--phase='.length) : 'main'
const dirArg = process.argv.find((arg) => arg.startsWith('--user-data='))
const userData = dirArg ? dirArg.slice('--user-data='.length) : join(tmpdir(), `surffish-tab-groups-smoke-${process.pid}`)
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
const json = (value) => JSON.stringify(value)
const tabsOf = (win) => api(win, 'tabs.get()')
const pathOf = (tab) => { try { return new URL(tab.url).pathname } catch { return tab.url } }
const order = async (win) => (await tabsOf(win)).map(pathOf)
const sessionFile = () => JSON.parse(readFileSync(join(userData, 'browser-session.json'), 'utf8'))
const sidebarRows = (win) => evaluate(surface(win, 'sidebar'), '[...document.querySelectorAll(".tab-list > [data-browser-tab-id]")].map((el) => el.classList.contains("tab-group-header") ? "header:" + (el.querySelector(".tab-group-chip")?.textContent ?? "").trim() : el.classList.contains("is-grouped") ? "g" : "t")')
const commands = async (win) => (await api(win, 'commands.list()')).commands

const asked = []
dialog.showMessageBox = async (...args) => {
  const options = args.find((arg) => arg && typeof arg === 'object' && 'buttons' in arg)
  asked.push(options?.message ?? '')
  return { response: 0, checkboxChecked: false }
}

// Record the native menus built since the last reset, so the tab context menu's group items can be
// checked. Every one, not just the last: the app menu is rebuilt too (focus/tab changes) and could
// land right after the tab menu.
let menus = []
const buildFromTemplate = Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate = (template) => {
  const menu = buildFromTemplate(template)
  menus.push(template)
  menu.popup = () => undefined
  return menu
}

function writeFixtures() {
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  const now = Date.now()
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`)
}

async function startApp() {
  app.setPath('userData', userData)
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
}

async function mainPhase() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(`<!doctype html><meta charset="utf-8"><title>Page ${request.url.slice(1)}</title><p>${request.url}</p>`)
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const origin = `http://127.0.0.1:${server.address().port}`
  writeFixtures()
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `${origin}/${name}`), activeIndex: 0, pinnedTabs: [] }))
  writeFileSync(join(userData, 'window-state.json'), JSON.stringify({ bounds: { x: 40, y: 40, width: 1200, height: 760 }, maximized: false, fullScreen: false }))
  await startApp()

  const win = await waitFor(() => windows()[0], 'the window')
  await ready(win)
  let tabs = await waitFor(async () => { const value = await tabsOf(win); return value.length === 6 ? value : null }, 'the restored tabs')
  const id = Object.fromEntries(tabs.map((tab) => [pathOf(tab).slice(1), tab.id]))
  assert.equal((await api(win, 'spaces.get()')).enabled, false, 'Spaces are off (groups work without them)')

  // --- new group from two tabs; header + rail in the sidebar
  const groupId = await api(win, `tabGroups.create(${json([id.b, id.c])}, { name: 'News' })`)
  assert.ok(groupId, 'group created')
  tabs = await tabsOf(win)
  assert.deepEqual(tabs.filter((tab) => tab.group).map((tab) => [pathOf(tab), tab.group.index, tab.group.count, tab.group.name]), [['/b', 0, 2, 'News'], ['/c', 1, 2, 'News']])
  await waitFor(async () => (await sidebarRows(win)).join('|') === 't|header:News|g|g|t|t|t', 'the group in the sidebar')

  // --- add (moves to the group's end), rename, recolour
  assert.equal(await api(win, `tabGroups.add([${json(id.e)}], ${json(groupId)})`), true)
  assert.deepEqual(await order(win), ['/a', '/b', '/c', '/e', '/d', '/f'])
  assert.equal(await api(win, `tabGroups.update(${json(groupId)}, { name: 'Reading', color: 'green' })`), true)
  tabs = await tabsOf(win)
  assert.ok(tabs.filter((tab) => tab.group).every((tab) => tab.group.name === 'Reading' && tab.group.color === 'green' && tab.group.count === 3))

  // --- sidebar drops: between two group tabs joins; after the last one leaves
  assert.equal(await api(win, `tabGroups.moveTab(${json(id.a)}, ${json(id.c)}, ${json(groupId)})`), true)
  assert.deepEqual(await order(win), ['/b', '/a', '/c', '/e', '/d', '/f'])
  assert.equal((await tabsOf(win)).find((tab) => tab.id === id.a).group?.id, groupId, 'dropped into the group')
  assert.equal(await api(win, `tabGroups.moveTab(${json(id.a)}, null, null)`), true)
  assert.equal((await tabsOf(win)).find((tab) => tab.id === id.a).group, undefined, 'dragged out of the group')
  assert.deepEqual(await order(win), ['/b', '/c', '/e', '/d', '/f', '/a'])

  // --- a split joins as one: split /c (grouped) with /d (not) -> /d joins the group
  assert.equal(await api(win, `split.with(${json(id.c)}, ${json(id.d)})`), true)
  tabs = await tabsOf(win)
  assert.equal(tabs.find((tab) => tab.id === id.d).group?.id, groupId, 'the split partner joined the group')
  // Removing one pane takes the whole split out.
  assert.equal(await api(win, `tabGroups.remove([${json(id.d)}])`), true)
  tabs = await tabsOf(win)
  assert.ok(!tabs.find((tab) => tab.id === id.c).group && !tabs.find((tab) => tab.id === id.d).group, 'both panes left')
  await api(win, `split.unsplit(${json(id.c)})`)
  await api(win, `tabGroups.add([${json(id.c)}], ${json(groupId)})`)

  // --- collapse while a group tab is active: you land outside it; the run is hidden
  await api(win, `tabs.activate(${json(id.b)})`)
  assert.equal(await api(win, `tabGroups.toggle(${json(groupId)})`), true)
  tabs = await tabsOf(win)
  assert.ok(!tabs.find((tab) => tab.active).group, 'the active tab moved out of the collapsed group')
  await waitFor(async () => { const rows = await sidebarRows(win); return rows.includes('header:Reading') && !rows.includes('g') }, 'the collapsed run hidden')
  // Activating a tab in it expands it again.
  await api(win, `tabs.activate(${json(id.e)})`)
  assert.equal((await tabsOf(win)).find((tab) => tab.id === id.e).group.collapsed, false, 'activating expands')

  // --- drag the header: the whole group moves (before /a: to the end, then to the front)
  assert.equal(await api(win, `tabGroups.move(${json(groupId)}, ${json(id.a)})`), true)
  let paths = await order(win)
  assert.equal(paths.at(-1), '/a', 'the group landed before /a')
  assert.ok(paths.indexOf('/b') < paths.indexOf('/a') && paths.indexOf('/d') < paths.indexOf('/b'), 'moved as one block')
  assert.equal(await api(win, `tabGroups.move(${json(groupId)}, ${json(id.d)})`), true)
  paths = await order(win)
  assert.equal((await tabsOf(win))[0].group?.id, groupId, 'group first')

  // Optional: SURFFISH_SMOKE_SHOT=/path.png saves the sidebar (for eyeballing).
  if (process.env.SURFFISH_SMOKE_SHOT) {
    await api(win, 'chrome.set({ sidebarPinned: true })')
    await delay(800)
    const shown = viewsOf(win).filter((view) => ['sidebar', 'content'].includes(surfaceFor(view))).find((view) => view.getVisible() && view.getBounds().width > 0)
    if (shown) writeFileSync(process.env.SURFFISH_SMOKE_SHOT, (await shown.webContents.capturePage()).toPNG())
  }

  // --- palette commands and the tab context menu
  const list = await commands(win)
  for (const command of ['group.new', 'group.remove', 'group.collapse', 'group.ungroup', 'group.close']) assert.ok(list.some((entry) => entry.id === command), `palette has ${command}`)
  await api(win, `tabs.activate(${json(id.f)})`)
  assert.equal(await api(win, `commands.run(${json(`group.add:${groupId}`)})`), true, 'Add Tab to Group from the palette')
  assert.equal((await tabsOf(win)).find((tab) => tab.id === id.f).group?.id, groupId)
  // The tab menu: main resolves the row under the right-click with elementFromPoint.
  await api(win, 'chrome.set({ sidebarPinned: true })')
  // The synthetic right-click is resolved again in main (elementFromPoint) a moment after we look.
  // Rows move while the pinned sidebar slides in and while the group re-sorts (tab f just joined
  // it), so wait for the row to sit still under its own centre, and if main still saw another row
  // (its menu has no "Remove from Group"), look again and re-send: a real right-click always hits
  // what is under the pointer, only this replay can go stale.
  let sidebarView
  let box
  let tabMenu = null
  const rowBox = () => evaluate(sidebarView, `(() => { const r = document.querySelector('[data-browser-tab-id=${json(id.f)}]').getBoundingClientRect(); const x = Math.round(r.x + 20); const y = Math.round(r.y + r.height / 2); return { x, y, hit: document.elementFromPoint(x, y)?.closest('[data-browser-tab-id]')?.getAttribute('data-browser-tab-id') ?? null } })()`)
  for (let attempt = 1; attempt <= 4 && !tabMenu; attempt += 1) {
    let previous = null
    await waitFor(async () => {
      sidebarView = viewsOf(win).filter((view) => ['sidebar', 'content'].includes(surfaceFor(view))).find((view) => view.getVisible() && view.getBounds().width > 0) ?? surface(win, 'sidebar')
      box = await rowBox()
      const settled = box.hit === id.f && previous !== null && previous.x === box.x && previous.y === box.y
      previous = box
      if (!settled) await delay(100)
      return settled
    }, 'the tab row to sit still under the pointer in the pinned sidebar').catch((error) => {
      throw new Error(`${error.message} Last: ${surfaceFor(sidebarView)} view ${JSON.stringify(sidebarView?.getBounds())}, row ${JSON.stringify(box)}`)
    })
    menus = []
    sidebarView.webContents.emit('context-menu', { preventDefault() {} }, { x: box.x, y: box.y })
    tabMenu = await waitFor(() => menus.find((template) => template.some((item) => item.label === 'Remove from Group')), 'the tab menu with group items', 3000).catch(() => null)
    if (!tabMenu) smoke.step(`right-click attempt ${attempt} built ${JSON.stringify(menus.map((template) => template.map((item) => item.label).filter(Boolean).slice(0, 4)))}; retrying`)
  }
  assert.ok(tabMenu, 'the tab menu with group items (Remove from Group)')
  assert.ok(tabMenu.some((item) => item.label === 'Add Tab to New Group'))

  // --- the archive keeps the group label
  assert.equal(await api(win, `tabArchive.archive(${json(id.f)})`), true)
  const archived = (await api(win, 'tabArchive.get()')).tabs[0]
  assert.equal(archived.groupName, 'Reading')
  assert.equal(archived.groupColor, 'green')

  // --- move the whole group to a new window
  const before = new Set(windows())
  assert.equal(await api(win, `tabGroups.moveToNewWindow(${json(groupId)})`), true)
  const second = await waitFor(() => windows().find((candidate) => !before.has(candidate)), 'the new window')
  await ready(second)
  tabs = await waitFor(async () => { const value = await tabsOf(second); return value.length >= 3 ? value : null }, 'the group in the new window')
  assert.ok(tabs.every((tab) => tab.group?.id === groupId && tab.group.name === 'Reading'), 'still one group there')
  assert.ok((await tabsOf(win)).every((tab) => !tab.group), 'gone from the first window')

  // --- ungroup + close group (asks first) in window 2
  const secondGroup = await api(second, `tabGroups.create(${json([tabs[0].id])}, { name: 'Solo' })`)
  assert.equal(await api(second, `tabGroups.ungroup(${json(secondGroup)})`), true)
  assert.ok((await tabsOf(second)).every((tab) => tab.group?.id !== secondGroup), 'ungrouped')
  asked.length = 0
  const remaining = (await tabsOf(second)).length
  await api(second, `tabs.create(${json(`${origin}/keep`)})`)
  assert.equal(await api(second, `tabGroups.close(${json(groupId)})`), true)
  assert.ok(asked.some((message) => message.includes('Close the')), 'close group asked first')
  // Left: /keep and the tab that went Solo then got ungrouped.
  tabs = await waitFor(async () => { const value = await tabsOf(second); return value.length === 2 ? value : null }, 'group tabs closed')
  assert.ok(tabs.some((tab) => pathOf(tab) === '/keep') && tabs.every((tab) => !tab.group))
  assert.ok(remaining >= 3)

  // --- groups inside a Space; moving a tab to another Space leaves its group
  await api(win, 'spaces.setEnabled(true)')
  const workId = await api(win, 'spaces.create({ name: "Work" })')
  await api(win, `tabs.create(${json(`${origin}/w1`)})`)
  await api(win, `tabs.create(${json(`${origin}/w2`)})`)
  tabs = await tabsOf(win)
  const w1 = tabs.find((tab) => tab.url.endsWith('/w1')).id
  const w2 = tabs.find((tab) => tab.url.endsWith('/w2')).id
  const workGroup = await api(win, `tabGroups.create(${json([w1, w2])}, { name: 'Sprint', color: 'purple' })`)
  assert.ok(workGroup)
  assert.equal(await api(win, `spaces.moveTab(${json(w2)}, "default")`), true)
  await api(win, 'spaces.switch("default")')
  assert.equal((await tabsOf(win)).find((tab) => tab.id === w2).group, undefined, 'moving to another Space leaves the group')
  await api(win, `spaces.switch(${json(workId)})`)
  await api(win, `tabGroups.update(${json(workGroup)}, { collapsed: true })`)
  // Close window 2 so the restore phase has one window.
  second.close()
  await waitFor(() => windows().length === 1, 'window 2 closed')
  await waitFor(() => {
    const saved = sessionFile().windows?.[0]
    return saved?.groups?.some((group) => group.name === 'Sprint' && group.collapsed && group.color === 'purple') ? saved : null
  }, 'groups saved', 8000)

  app.releaseSingleInstanceLock()
  const exitCode = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [...process.execArgv, ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []), __filename, '--phase=restore', `--user-data=${userData}`, `--work=${workId}`], { stdio: 'inherit' })
    child.on('exit', (code) => resolvePromise(code))
  })
  server.close()
  assert.equal(exitCode, 0, 'the restore phase passed')
  smoke.removeProfile(userData)
  console.log('Electron tab groups smoke passed.')
}

async function restorePhase() {
  const workId = process.argv.find((arg) => arg.startsWith('--work=')).slice('--work='.length)
  await startApp()
  const win = await waitFor(() => windows()[0], 'the restored window')
  await ready(win)
  await waitFor(async () => (await api(win, 'spaces.get()')).activeSpaceId === workId, 'Work restored')
  const tabs = await waitFor(async () => { const value = await tabsOf(win); return value.some((tab) => tab.group) ? value : null }, 'the restored group')
  const grouped = tabs.filter((tab) => tab.group)
  assert.equal(grouped.length, 1)
  assert.deepEqual({ name: grouped[0].group.name, color: grouped[0].group.color, collapsed: grouped[0].group.collapsed }, { name: 'Sprint', color: 'purple', collapsed: true })
  console.log('Electron tab groups restore phase passed.')
}

const run = phase === 'restore' ? restorePhase : mainPhase
run().then(() => app.exit(0), (error) => {
  console.error(`Electron tab groups smoke failed (${phase}):`, error)
  app.exit(1)
})
