const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, session, Menu } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')
const userData = join(tmpdir(), `surffish-translation-smoke-${process.pid}`)
const pause = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
let capturedMenu = []
const flattenMenu = (items) => items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flattenMenu(item.submenu) : [])])
const buildMenu = Menu.buildFromTemplate.bind(Menu)
Menu.buildFromTemplate = (template) => {
  capturedMenu = template
  const menu = buildMenu(template)
  menu.popup = () => {}
  return menu
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await pause(50)
  }
  throw new Error(`Timed out: ${description}`)
}
async function run() {
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize())
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] }))
  // Register first so fixture responses are available before the app creates tabs.
  app.whenReady().then(() => {
    session.fromPartition('persist:surffish-browser').protocol.handle('https', () => new Response('<!doctype html><title>Translation fixture</title><p>Bonjour le monde</p>', { headers: { 'Content-Type': 'text/html' } }))
  })
  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  let win, views
  await waitFor(() => {
    win = BaseWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!win) return false
    views = Object.fromEntries(win.contentView.children.filter((view) => view.webContents && !view.webContents.isDestroyed()).map((view) => {
      try { return [new URL(view.webContents.getURL()).searchParams.get('surface'), view] } catch { return [null, view] }
    }))
    return views.content && views.toolbar
  }, 'trusted shell surfaces')
  const evaluate = async (surface, code) => {
    try { return await views[surface].webContents.executeJavaScript(code) }
    catch (error) { console.error('Renderer expression failed:', surface, code); throw error }
  }
  await waitFor(() => evaluate('content', 'Boolean(window.api?.browser?.translation && document.querySelector(".site-actions-button"))'), 'translation API and UI')
  assert.equal(await evaluate('content', 'window.api.browser.translation.getTarget()'), 'en')
  await evaluate('content', 'window.api.browser.settings.open({section:"settings"})')
  await waitFor(() => evaluate('content', 'Boolean(document.querySelector(".translation-settings-section select:not(:disabled)"))'), 'translation settings')
  await evaluate('content', '(() => { const select=document.querySelector(".translation-settings-section select"); select.value="fr"; select.dispatchEvent(new Event("change",{bubbles:true})); })()')
  await evaluate('toolbar', 'document.querySelector(".site-actions-button").click()')
  await waitFor(() => evaluate('toolbar', 'document.querySelector("#site-actions-menu")?.textContent.includes("Translate page to French")'), 'target language synchronized to toolbar')
  await evaluate('toolbar', 'document.querySelector(".site-actions-button").click()')
  assert.equal(JSON.parse(readFileSync(join(userData, 'browser-translation.json'), 'utf8')).target, 'fr')
  assert.equal(await evaluate('content', 'window.api.browser.translation.setTarget("not-a-language").then(()=>false,()=>true)'), true)
  assert.equal(await evaluate('content', 'window.api.browser.translation.text(" ")'), false)
  assert.equal(await evaluate('content', 'window.api.browser.translation.text("a".repeat(5001))'), false)
  assert.equal(await evaluate('content', 'window.api.browser.translation.page()'), false, 'local New Tab is not sent to Google')
  await evaluate('content', 'window.api.browser.tabs.create("https://example.com/article#section")')
  await waitFor(() => evaluate('content', 'window.api.browser.state().then(state=>state.url.includes("example.com/article"))'), 'public fixture tab')
  const source = await evaluate('content', 'window.api.browser.tabs.get().then(tabs=>tabs.find(tab=>tab.active))')
  await evaluate('toolbar', 'document.querySelector(".site-actions-button").click()')
  await waitFor(() => evaluate('toolbar', 'Boolean(document.querySelector("#site-actions-menu"))'), 'site action menu')
  await waitFor(async () => views.toolbar.getBounds().height >= Math.floor(await evaluate('toolbar', 'document.querySelector("#site-actions-menu").getBoundingClientRect().bottom')), 'native overlay contains translation menu')
  await evaluate('toolbar', '[...document.querySelectorAll("#site-actions-menu button")].find(button=>button.textContent.includes("Translate page to French")).click()')
  await waitFor(() => evaluate('content', 'window.api.browser.tabs.get().then(tabs=>tabs.some(tab=>tab.active && tab.url.startsWith("https://translate.google.com/translate?")))'), 'translated page tab')
  let tabs = await evaluate('content', 'window.api.browser.tabs.get()')
  assert.ok(tabs.some((tab) => tab.id === source.id && tab.url.includes('example.com/article')))
  const pageUrl = new URL(tabs.find((tab) => tab.active).url)
  assert.equal(pageUrl.searchParams.get('u'), 'https://example.com/article')
  assert.equal(pageUrl.searchParams.get('tl'), 'fr')
  assert.equal(await evaluate('content', 'window.api.browser.translation.text("こんにちは & <world>", "ja")'), true)
  tabs = await evaluate('content', 'window.api.browser.tabs.get()')
  const textUrl = new URL(tabs.find((tab) => tab.active).url)
  assert.equal(textUrl.searchParams.get('text'), 'こんにちは & <world>')
  assert.equal(textUrl.searchParams.get('tl'), 'ja')
  await evaluate('content', `window.api.browser.tabs.activate(${JSON.stringify(source.id)})`)
  const sourceView = win.contentView.children.find((view) => view.webContents?.getURL().includes('example.com/article'))
  assert.ok(sourceView)
  const params = { x: 20, y: 20, pageURL: 'https://example.com/article', linkURL: '', srcURL: '', mediaType: 'none', selectionText: 'Bonjour', isEditable: false, editFlags: { canCopy: true }, dictionarySuggestions: [] }
  sourceView.webContents.emit('context-menu', { preventDefault() {} }, params)
  assert.ok(flattenMenu(capturedMenu).some((item) => item.label?.startsWith('Translate Selection to French')))
  assert.ok(flattenMenu(capturedMenu).some((item) => item.label?.startsWith('Translate Page to French')))
  sourceView.webContents.emit('context-menu', { preventDefault() {} }, { ...params, selectionText: 'x'.repeat(5001) })
  assert.ok(!flattenMenu(capturedMenu).some((item) => item.label?.startsWith('Translate Selection')))
  assert.ok(flattenMenu(capturedMenu).some((item) => item.label?.startsWith('Search ')), 'long selection still supports search')
  console.log('PASS: translation settings, persistence, cross-surface synchronization, validation, toolbar bounds, new-tab page/text flows, and context menus')
}
const timeout = setTimeout(() => { console.error('Translation smoke test timed out'); app.exit(1) }, Math.max(60000, smoke.waitMs * 4))
run().then(() => {
  clearTimeout(timeout)
  smoke.removeProfile(userData)
  app.exit(0)
}).catch((error) => {
  clearTimeout(timeout)
  console.error(error)
  app.exit(1)
})
