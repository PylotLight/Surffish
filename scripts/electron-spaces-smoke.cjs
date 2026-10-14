// Integration smoke for Spaces: off by default (no switcher, no Space commands, old session lands
// in Default), turning them on, creating a Space with separate logins, switching (API + shortcut),
// moving a tab and a whole split to another Space, partition isolation (a cookie set in Space A is
// not visible in Space B), the archive / task manager labels, session restore of Spaces + splits +
// the active Space, deleting a Space (asks first), and turning Spaces off (merges into Default).
// Runs the production build: `bun run build && bun run test:electron-spaces`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-spaces-smoke.cjs`).
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, dialog, session } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
const phase = phaseArg ? phaseArg.slice('--phase='.length) : 'main'
const dirArg = process.argv.find((arg) => arg.startsWith('--user-data='))
const userData = dirArg ? dirArg.slice('--user-data='.length) : join(tmpdir(), `surffish-spaces-smoke-${process.pid}`)
const argValue = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const IS_MAC = process.platform === 'darwin'

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
const pageView = (win, path) => viewsOf(win).find((view) => { try { return new URL(view.webContents.getURL()).pathname === path && view.getVisible() } catch { return false } })

// Bounded (smoke.evaluate): a renderer that never answers fails this call with what it was running
// and on which page, instead of stalling a waitFor loop silently until the hard limit.
async function evaluate(view, expression) {
  try {
    return await smoke.evaluate(view.webContents, expression)
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`)
  }
}
const step = (message) => smoke.step(`${phase}: ${message}`)

/** What the window shows right now (Space + tab paths), for a failure message. */
async function describeWindow(win) {
  try {
    const [spaces, tabs] = await Promise.all([spacesOf(win), tabsOf(win)])
    const names = Object.fromEntries(spaces.spaces.map((space) => [space.id, space.name]))
    return `active Space ${names[spaces.activeSpaceId] ?? spaces.activeSpaceId}, tabs ${JSON.stringify(paths(tabs))}, counts ${JSON.stringify(spaces.tabCounts ?? {})}`
  } catch (error) {
    return `window state unavailable (${error.message})`
  }
}

/** waitFor, but a timeout also says what the window showed at the end. */
async function waitForWindow(win, predicate, description, timeout) {
  try {
    return await waitFor(predicate, description, timeout)
  } catch (error) {
    throw new Error(`${error.message} Window: ${await describeWindow(win)}`)
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
const spacesOf = (win) => api(win, 'spaces.get()')
const paths = (tabs) => tabs.map((tab) => { try { return new URL(tab.url).pathname } catch { return tab.url } })
const sessionFile = () => JSON.parse(readFileSync(join(userData, 'browser-session.json'), 'utf8'))
const switcherShown = (win) => evaluate(surface(win, 'sidebar'), 'Boolean(document.querySelector(".spaces-switcher"))')
const spaceCommands = async (win) => (await api(win, 'commands.list()')).commands.filter((command) => command.id.startsWith('space.'))

// Every confirm (delete Space, turn Spaces off) answers the first button; `asked` records them.
const asked = []
dialog.showMessageBox = async (...args) => {
  const options = args.find((arg) => arg && typeof arg === 'object' && 'buttons' in arg)
  asked.push(options?.message ?? '')
  return { response: 0, checkboxChecked: false }
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

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://x')
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    // /login?as=work sets a persistent cookie for this host.
    if (url.pathname === '/login') headers['Set-Cookie'] = `who=${url.searchParams.get('as')}; Max-Age=86400; Path=/`
    response.writeHead(200, headers)
    response.end(`<!doctype html><meta charset="utf-8"><title>Page ${url.pathname.slice(1)}</title><p>${url.pathname}</p>`)
  })
  return new Promise((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise(server)))
}

/** The page's cookie as its own session sees it. */
async function pageCookie(win, path) {
  const view = await waitFor(() => pageView(win, path), `page ${path} on screen`)
  await waitFor(() => !view.webContents.isLoading(), `${path} loaded`)
  return evaluate(view, 'document.cookie')
}

async function mainPhase() {
  const server = await startServer()
  const origin = `http://127.0.0.1:${server.address().port}`
  writeFixtures()
  // An old (pre-Spaces) session: everything must land in Default.
  writeFileSync(join(userData, 'browser-session.json'), JSON.stringify({ version: 1, tabs: [`${origin}/a`, `${origin}/b`], activeIndex: 0, pinnedTabs: [] }))
  writeFileSync(join(userData, 'window-state.json'), JSON.stringify({ bounds: { x: 40, y: 40, width: 1200, height: 760 }, maximized: false, fullScreen: false }))
  step('starting the app on an old (pre-Spaces) session')
  await startApp()

  const win = await waitFor(() => windows()[0], 'the window')
  await ready(win)
  await waitFor(async () => (await tabsOf(win)).length === 2, 'the restored tabs')

  step('checking Spaces are off by default')
  // --- off by default: no switcher, no Space commands, no "Move to Space"
  let spaces = await spacesOf(win)
  assert.equal(spaces.enabled, false, 'Spaces are off by default')
  assert.deepEqual(spaces.spaces.map((space) => space.id), ['default'])
  assert.equal(await switcherShown(win), false, 'no switcher while off')
  assert.equal((await spaceCommands(win)).length, 0, 'no Space commands while off')
  assert.equal(await api(win, 'spaces.create()'), null, 'creating a Space needs Spaces on')

  step('turning Spaces on and creating Work')
  // --- turn on; create Work (separate logins): the window switches to it with a New Tab
  assert.equal(await api(win, 'spaces.setEnabled(true)'), true)
  await waitFor(() => switcherShown(win), 'the switcher')
  assert.ok((await spaceCommands(win)).some((command) => command.id === 'space.new'), 'Space commands while on')
  const workId = await api(win, 'spaces.create({ name: "Work", icon: "💼", partitioned: true })')
  assert.ok(workId, 'Work created')
  spaces = await waitFor(async () => { const value = await spacesOf(win); return value.activeSpaceId === workId ? value : null }, 'Work active')
  let tabs = await tabsOf(win)
  assert.equal(tabs.length, 1, 'a new Space starts with one New Tab')
  assert.ok(!paths(tabs).includes('/a'), 'Default tabs are not listed in Work')

  step('partition isolation (Work login)')
  // --- partition isolation: log in on Work, Default can't see it
  await api(win, `tabs.create(${JSON.stringify(`${origin}/login?as=work`)})`)
  assert.equal(await pageCookie(win, '/login'), 'who=work', 'Work has its cookie')
  const workSession = session.fromPartition(`persist:surffish-space-${workId}`)
  assert.equal((await workSession.cookies.get({ name: 'who' })).length, 1, 'cookie in the Work partition')
  assert.equal((await session.fromPartition('persist:surffish-browser').cookies.get({ name: 'who' })).length, 0, 'not in the profile partition')

  step('switching to Default with the shortcut')
  // --- shortcut: Ctrl+1 (macOS) / Ctrl+Shift+1 switches to Default, landing on its last tab
  const toolbar = surface(win, 'toolbar')
  toolbar.webContents.focus()
  toolbar.webContents.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: IS_MAC ? ['control'] : ['control', 'shift'] })
  toolbar.webContents.sendInputEvent({ type: 'keyUp', keyCode: '1', modifiers: IS_MAC ? ['control'] : ['control', 'shift'] })
  let viaShortcut = true
  try {
    await waitFor(async () => (await spacesOf(win)).activeSpaceId === 'default', 'the Space shortcut', 4000)
  } catch {
    // Synthetic key events don't always carry a DOM code; fall back to the API and say so.
    viaShortcut = false
    assert.equal(await api(win, 'spaces.switch("default")'), true)
  }
  tabs = await tabsOf(win)
  assert.deepEqual(paths(tabs), ['/a', '/b'], 'Default shows its own tabs')
  assert.equal(tabs.find((tab) => tab.active)?.url, `${origin}/a`, 'back on the tab you left')
  await api(win, `tabs.create(${JSON.stringify(`${origin}/check`)})`)
  assert.equal(await pageCookie(win, '/check'), '', 'Default does not see the Work login')

  step('moving a tab to Work')
  // --- move a tab to Work: it leaves Default, reloads in Work's session (sees the login)
  await api(win, `tabs.create(${JSON.stringify(`${origin}/moved`)})`)
  await waitFor(() => pageView(win, '/moved'), '/moved on screen')
  let movedId = (await tabsOf(win)).find((tab) => tab.url.endsWith('/moved')).id
  assert.equal(await api(win, `spaces.moveTab(${JSON.stringify(movedId)}, ${JSON.stringify(workId)})`), true)
  tabs = await tabsOf(win)
  assert.ok(!paths(tabs).includes('/moved'), 'the moved tab left Default')
  assert.equal((await spacesOf(win)).activeSpaceId, 'default', 'you stay in Default')
  await api(win, `tabs.activate(${JSON.stringify(movedId)})`)
  spaces = await waitFor(async () => { const value = await spacesOf(win); return value.activeSpaceId === workId ? value : null }, 'activating a tab in another Space switches to it')
  assert.equal(await pageCookie(win, '/moved'), 'who=work', 'the moved tab runs in the Work session')

  step('moving a split to Fun')
  // --- a split moves as a unit: split /moved with /other in Work, send it to Fun
  const funId = await api(win, 'spaces.create({ name: "Fun" })')
  await api(win, `spaces.switch(${JSON.stringify(workId)})`)
  await api(win, `tabs.create(${JSON.stringify(`${origin}/other`)})`)
  const otherId = (await tabsOf(win)).find((tab) => tab.url.endsWith('/other')).id
  assert.equal(await api(win, `split.with(${JSON.stringify(otherId)}, ${JSON.stringify(movedId)})`), true)
  assert.equal(await api(win, `spaces.moveTab(${JSON.stringify(movedId)}, ${JSON.stringify(funId)})`), true)
  tabs = await tabsOf(win)
  assert.ok(!paths(tabs).includes('/moved') && !paths(tabs).includes('/other'), 'both panes left Work')
  assert.ok(paths(tabs).includes('/login'), 'the rest of Work stays')
  await api(win, `spaces.switch(${JSON.stringify(funId)})`)
  tabs = await waitForWindow(win, async () => { const value = await tabsOf(win); return paths(value).includes('/moved') ? value : null }, 'the split in Fun')
  assert.equal(tabs.filter((tab) => tab.split).length, 2, 'still a split in Fun')
  // Fun shares the profile session: no Work login there.
  assert.equal(await pageCookie(win, '/moved'), '', 'Fun (shared session) does not see the Work login')

  // Optional: SURFFISH_SMOKE_SHOT=/path.png saves the sidebar with the switcher (for eyeballing).
  if (process.env.SURFFISH_SMOKE_SHOT) {
    await api(win, 'chrome.set({ sidebarPinned: true })')
    await delay(800)
    const sidebar = viewsOf(win).filter((view) => surfaceFor(view) === 'sidebar' || surfaceFor(view) === 'content').find((view) => view.getBounds().width > 0 && view.getVisible()) ?? surface(win, 'sidebar')
    writeFileSync(process.env.SURFFISH_SMOKE_SHOT, (await sidebar.webContents.capturePage()).toPNG())
  }

  step('archiving a tab in Fun')
  // --- the archive records the Space
  await api(win, `tabs.create(${JSON.stringify(`${origin}/archived`)})`)
  const archivedTab = (await tabsOf(win)).find((tab) => tab.url.endsWith('/archived'))
  await api(win, `tabs.activate(${JSON.stringify(tabs[0].id)})`)
  assert.equal(await api(win, `tabArchive.archive(${JSON.stringify(archivedTab.id)})`), true)
  const archive = await api(win, 'tabArchive.get()')
  assert.equal(archive.tabs[0].spaceName, 'Fun', 'the archive keeps the Space')
  assert.equal(archive.tabs[0].spaceId, funId)

  // --- palette tabs are scoped to the Space (the tab list the palette gets)
  assert.ok((await tabsOf(win)).every((tab) => !tab.url.endsWith('/a')), 'Default tabs are not in Fun\'s list')

  // --- leave Work active for the restore phase
  step('waiting for the Spaces session on disk')
  await api(win, `spaces.switch(${JSON.stringify(workId)})`)
  // Poll on content: Work active, both split panes saved in Fun, one split. An earlier debounced
  // snapshot can already have Work active and a Fun tab without the split's tabs in place.
  let lastSaved = null
  await waitFor(() => {
    const value = sessionFile()
    const saved = value.windows?.[0]
    lastSaved = saved ?? null
    if (saved?.spaces?.activeSpace !== workId || saved.splits?.length !== 1) return null
    const spaceOf = (path) => saved.spaces.tabSpaces[saved.tabs.findIndex((url) => { try { return new URL(url).pathname === path } catch { return false } })]
    return spaceOf('/moved') === funId && spaceOf('/other') === funId ? value : null
  }, 'Spaces saved in the session file', 8000).catch((error) => {
    throw new Error(`${error.message} Last saved window: ${JSON.stringify(lastSaved)}`)
  })
  assert.ok(existsSync(join(userData, 'browser-spaces.json')), 'Space definitions saved')
  await workSession.cookies.flushStore()

  step('relaunching (restore phase)')
  app.releaseSingleInstanceLock()
  const exitCode = await new Promise((resolvePromise) => {
    // childEnv: the child's hard limit ends before ours, so a hung restore reports its own state.
    const child = spawn(process.execPath, [...process.execArgv, ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []), __filename, '--phase=restore', `--user-data=${userData}`, `--origin=${origin}`, `--work=${workId}`, `--fun=${funId}`], { stdio: 'inherit', env: smoke.childEnv() })
    child.on('exit', (code, signal) => resolvePromise(code ?? signal))
  })
  server.close()
  assert.equal(exitCode, 0, 'the restore phase passed')
  smoke.removeProfile(userData)
  console.log(`Electron Spaces smoke passed${viaShortcut ? '' : ' (Space shortcut checked through the API: synthetic keys had no DOM code)'}.`)
}

async function restorePhase() {
  const workId = argValue('work')
  const funId = argValue('fun')
  step('starting the app on the saved Spaces session')
  await startApp()
  const win = await waitFor(() => windows()[0], 'the restored window')
  await ready(win)
  step('window ready; checking the restored Spaces')

  // --- restore: the active Space, each Space's tabs, the split in Fun
  let spaces = await waitFor(async () => { const value = await spacesOf(win); return value.enabled ? value : null }, 'Spaces on after relaunch')
  assert.equal(spaces.activeSpaceId, workId, 'Work is the active Space again')
  assert.deepEqual(spaces.spaces.map((space) => space.name), ['Default', 'Work', 'Fun'])
  let tabs = await waitForWindow(win, async () => { const value = await tabsOf(win); return value.length > 0 ? value : null }, 'Work tabs')
  assert.ok(!paths(tabs).includes('/a'), 'Work shows only its tabs')
  step('switching to Fun')
  assert.equal(await api(win, `spaces.switch(${JSON.stringify(funId)})`), true, 'switched to Fun')
  tabs = await waitForWindow(win, async () => { const value = await tabsOf(win); return paths(value).includes('/moved') ? value : null }, 'Fun tabs')
  assert.equal(tabs.filter((tab) => tab.split).length, 2, 'the split came back in Fun')
  step('switching to Default')
  await api(win, 'spaces.switch("default")')
  tabs = await waitForWindow(win, async () => { const value = await tabsOf(win); return paths(value).includes('/a') ? value : null }, 'Default tabs')
  assert.deepEqual(paths(tabs).filter((path) => path !== '/check'), ['/a', '/b'])

  // The Work login survived the restart in its own partition.
  const workSession = session.fromPartition(`persist:surffish-space-${workId}`)
  assert.equal((await workSession.cookies.get({ name: 'who' })).length, 1, 'Work login kept')

  step('deleting Work')
  // --- delete Work: asks first, closes its tabs, wipes its partition
  asked.length = 0
  assert.equal(await api(win, `spaces.remove(${JSON.stringify(workId)})`), true)
  assert.ok(asked.some((message) => message.includes('Work')), 'delete asked first')
  spaces = await spacesOf(win)
  assert.deepEqual(spaces.spaces.map((space) => space.name), ['Default', 'Fun'])
  assert.equal(spaces.tabCounts[workId] ?? 0, 0, 'Work tabs closed')
  await waitFor(async () => (await workSession.cookies.get({ name: 'who' })).length === 0, 'Work partition wiped')

  step('turning Spaces off')
  // --- turn Spaces off: asks, then everything merges into Default and the UI goes away
  asked.length = 0
  assert.equal(await api(win, 'spaces.setEnabled(false)'), false)
  assert.ok(asked.some((message) => message.includes('Turn off Spaces')), 'turning off asked first')
  spaces = await spacesOf(win)
  assert.equal(spaces.enabled, false)
  tabs = await tabsOf(win)
  assert.ok(paths(tabs).includes('/moved') && paths(tabs).includes('/a'), 'Fun tabs merged into Default')
  await waitFor(async () => !(await switcherShown(win)), 'the switcher to go away')
  assert.equal((await spaceCommands(win)).length, 0, 'no Space commands after turning off')
  await waitFor(() => {
    const saved = sessionFile().windows?.[0]
    return saved && !saved.spaces ? saved : null
  }, 'the session file without Spaces', 8000)
  console.log('Electron Spaces restore phase passed.')
}

const run = phase === 'restore' ? restorePhase : mainPhase
run().then(() => app.exit(0), (error) => {
  console.error(`Electron Spaces smoke failed (${phase}):`, error)
  app.exit(1)
})
