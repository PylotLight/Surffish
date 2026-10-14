// Full-app check of Surffish's Bramble quick unlock, against a real Bramble Firefox build. Not in CI
// (needs the Bramble build, like check-bramble-poc.ts). Run the production build first:
//   bun run build && electron scripts/check-bramble-quick-unlock-app.cjs <unpacked bramble_firefox_X.zip dir>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-quick-unlock-app.cjs <dir>)
// First checks that PIN setup is refused (IPC) and disabled (Settings) while Bramble has no vault,
// and that Settings enables it once the vault exists. Then creates a vault through Bramble's own setup page in a Surffish tab, enrols a PIN through the
// Settings IPC, locks, opens the toolbar popup and drives Surffish's PIN panel: a wrong PIN, the
// right PIN typed on the keyboard (Bramble must unlock), "Use master password", and the 5-strike
// lockout. Set CHECK_SHOTS=<dir> to save screenshots of the panel.
'use strict'
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, BrowserWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const dist = resolve(process.argv.slice(2).filter((arg) => !arg.startsWith('-')).at(-1) || '')
const root = join(tmpdir(), `surffish-bramble-quick-unlock-app-${process.pid}`)
const userData = join(root, 'user-data')
const MASTER = 'a long Bramble master password for the quick unlock check'
const PIN = '482916'
const shots = process.env.CHECK_SHOTS
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try { const value = await predicate(); if (value) return value } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ''}`)
}
const evaluate = (contents, code) => smoke.evaluate(contents, code)
const surfaceFor = (view) => { try { return new URL(view.webContents.getURL()).searchParams.get('surface') } catch { return null } }

async function shot(contents, name) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  const image = await contents.capturePage()
  writeFileSync(join(shots, `${name}.png`), image.toPNG())
}

async function run() {
  assert.ok(existsSync(join(dist, 'manifest.json')), 'pass the unpacked Bramble Firefox build directory')
  app.setPath('userData', userData)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const blocker = ElectronBlocker.parse('||surffish-smoke-never-match.invalid^', smoke.ADBLOCK_CONFIG)
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), { mode: 0o600 })
  writeFileSync(join(userData, 'new-tab-photo-cache.json'), `${JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] })}\n`)
  process.env.SURFFISH_BRAMBLE_POC_DEV_AUTOLOAD = '1'
  process.env.SURFFISH_BRAMBLE_EXTENSION_DIR = dist

  await import(pathToFileURL(resolve(__dirname, '../out/main/index.js')).href)
  await app.whenReady()
  const mainWindow = await waitFor(() => BaseWindow.getAllWindows().find((win) => win.contentView && win.contentView.children.length > 0), 'the main window')
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
  const surface = (name) => mainWindow.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && surfaceFor(view) === name)
  await waitFor(() => surface('toolbar') && surface('content'), 'the renderer surfaces')
  const toolbar = surface('toolbar').webContents
  const content = surface('content').webContents
  await waitFor(() => evaluate(toolbar, 'document.readyState === "complete" && Boolean(window.api)'), 'the toolbar renderer')
  const bramble = await waitFor(async () => { const state = await evaluate(toolbar, 'window.api.browser.bramble.get()'); return state.installed && state }, 'Bramble to load', 60000)
  smoke.step(`Bramble ${bramble.version} loaded`)
  assert.equal(existsSync(join(userData, 'bramble-quick-unlock.json')), false)

  // 0. No vault yet: the enrol IPC refuses, and Settings disables "Set up PIN…" with a hint.
  const beforeVault = await evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')
  assert.equal(beforeVault.vault, 'absent', JSON.stringify(beforeVault))
  const noVault = await evaluate(content, `window.api.browser.bramble.quickUnlock.enrol(${JSON.stringify({ masterPassword: MASTER, pin: PIN, confirmPin: PIN, touchId: false, requireMasterAfterRestart: true })})`)
  assert.equal(noVault.ok, false)
  assert.match(noVault.error, /Create your Bramble vault first/)
  assert.equal(noVault.state.enabled, false)
  assert.equal(existsSync(join(userData, 'bramble-quick-unlock.json')), false, 'nothing written without a vault')
  const setupButton = `[...document.querySelectorAll('.bramble-quick-unlock-settings button')].find((b) => /Set up PIN/.test(b.textContent))`
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "integrations" })')
  await waitFor(() => evaluate(content, `(() => { const b = ${setupButton}; return !!b && b.disabled && document.querySelector('.bramble-quick-unlock-settings').textContent.includes('Create your Bramble vault first') })()`), 'Set up PIN disabled with the vault hint')
  await evaluate(content, `document.querySelector('.bramble-quick-unlock-settings').scrollIntoView(); true`)
  await delay(300)
  await shot(content, 'settings-no-vault')
  smoke.step('no vault: enrol refused, Set up PIN disabled')

  // 1. Vault through Bramble's own setup page (opens in a Surffish tab).
  await evaluate(toolbar, 'window.api.browser.bramble.setup()')
  const options = await waitFor(() => webContents.getAllWebContents().find((contents) => !contents.isDestroyed() && contents.getURL().startsWith('chrome-extension://') && contents.getURL().includes('/options.html')), 'Bramble options tab')
  await waitFor(() => evaluate(options, `!!document.querySelector('input[name="confirmPassword"]')`), 'the setup form')
  await options.executeJavaScriptInIsolatedWorld(1999, [{ code: `(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const name of ['masterPassword', 'confirmPassword']) {
      const input = document.querySelector('input[name="' + name + '"]');
      setter.call(input, ${JSON.stringify(MASTER)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const submit = document.querySelector('button[type="submit"]');
    submit.form.requestSubmit(submit);
  })()` }])
  await waitFor(() => evaluate(options, `[...document.querySelectorAll('button')].some((b) => /saved it/i.test(b.textContent))`), 'the recovery code screen', 60000)
  await evaluate(options, `[...document.querySelectorAll('button')].find((b) => /saved it/i.test(b.textContent)).click(); true`)
  smoke.step('vault created')
  assert.equal((await evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')).vault, 'present')
  // Settings picks the new vault up on its own (re-checks while it shows the hint).
  const stillMounted = await evaluate(content, `!!(${setupButton})`)
  if (!stillMounted) await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "integrations" })')
  await waitFor(() => evaluate(content, `(() => { const b = ${setupButton}; return !!b && !b.disabled && !document.querySelector('.bramble-quick-unlock-needs-vault') })()`), 'Set up PIN enabled once the vault exists')
  smoke.step(`Settings enabled setup after the vault was created (${stillMounted ? 'live, without remounting' : 'after reopening Integrations'})`)

  // 2. Enrol through the Settings IPC (what Settings → Integrations → Quick unlock calls).
  const bad = await evaluate(content, `window.api.browser.bramble.quickUnlock.enrol({ masterPassword: 'x', pin: '12', confirmPin: '12', touchId: false, requireMasterAfterRestart: true })`)
  assert.equal(bad.ok, false)
  const enrolled = await evaluate(content, `window.api.browser.bramble.quickUnlock.enrol(${JSON.stringify({ masterPassword: MASTER, pin: PIN, confirmPin: PIN, touchId: false, requireMasterAfterRestart: true })})`)
  assert.equal(enrolled.ok, true, JSON.stringify(enrolled))
  assert.equal(enrolled.state.armed, true)
  const onDisk = readFileSync(join(userData, 'bramble-quick-unlock.json'), 'utf8')
  assert.equal(onDisk.includes(MASTER), false, 'no plaintext master password on disk')
  assert.equal(JSON.parse(onDisk).pin, undefined, 'memory-only by default: no PIN slot on disk')
  smoke.step('PIN enrolled (memory-only)')
  // Settings → Integrations shows the section (lazy chunk) with its live status.
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "integrations" })')
  await waitFor(() => evaluate(content, `!!document.querySelector('.bramble-quick-unlock-settings') && document.querySelector('.bramble-quick-unlock-settings').textContent.includes('Turn off quick unlock')`), 'the Quick unlock settings section')
  await evaluate(content, `document.querySelector('.bramble-quick-unlock-settings').scrollIntoView(); true`)
  await delay(300)
  await shot(content, 'settings-enabled')

  const lock = () => evaluate(options, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_LOCK' }, () => done(true)))`)
  const isLocked = async () => (await evaluate(options, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_IS_LOCKED' }, (r) => done(r)))`)).data === true
  const popupWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible() && win.webContents.getURL().endsWith('/popup.html'))
  const overlayOf = (popup) => popup.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL().startsWith('data:text/html'))
  const openPopup = async () => {
    const state = await evaluate(toolbar, 'window.api.browser.bramble.open()')
    try {
      return await waitFor(popupWindow, 'the Bramble popup', 15000)
    } catch (error) {
      console.log('open() ->', JSON.stringify(state), BrowserWindow.getAllWindows().map((win) => `${win.getTitle()} ${win.isVisible()} ${win.webContents.getURL()}`))
      throw error
    }
  }

  // 3. Locked popup: Surffish's PIN panel appears over Bramble's unlock form.
  await lock()
  assert.equal(await isLocked(), true)
  let popup = await openPopup()
  let overlay = await waitFor(() => overlayOf(popup), 'the quick unlock panel over the popup', 30000)
  await waitFor(() => evaluate(overlay.webContents, `!document.getElementById('pin-mode').hidden`), 'the PIN pad')
  const [pw, ph] = popup.getContentSize()
  const bounds = overlay.getBounds()
  assert.deepEqual([bounds.width, bounds.height], [pw, ph], 'the panel covers the popup')
  await shot(overlay.webContents, 'pin-pad')
  smoke.step('PIN panel shown over the locked popup')

  // 4. Wrong PIN: counted, Bramble untouched.
  const wrong = await evaluate(overlay.webContents, `window.surffishQuickUnlock.submitPin('000000')`)
  assert.deepEqual(wrong, { status: 'wrong', attemptsLeft: 4 })
  assert.equal((await evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')).failedAttempts, 1)
  assert.equal(await isLocked(), true)
  smoke.step('wrong PIN rejected (4 left)')

  // 5. Right PIN typed on the keyboard: Surffish fills Bramble's form and Bramble unlocks.
  for (const key of [...PIN, 'Enter']) await evaluate(overlay.webContents, `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); true`)
  await waitFor(async () => !(await isLocked()), 'Bramble to unlock from the PIN', 30000)
  await waitFor(() => !overlayOf(popup), 'the panel to go away once unlocked')
  const popupText = await evaluate(popup.webContents, 'document.body.innerText')
  assert.equal(/master password/i.test(popupText), false, 'popup shows the vault, not the unlock form')
  assert.equal((await evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')).failedAttempts, 0)
  await shot(popup.webContents, 'unlocked-popup')
  smoke.step('right PIN unlocked Bramble')

  // 6. "Use master password" leaves Bramble's own form in front for this lock.
  await lock()
  await waitFor(() => overlayOf(popup), 'the panel after locking again', 30000)
  overlay = overlayOf(popup)
  await evaluate(overlay.webContents, `document.getElementById('use-master').click(); true`)
  await waitFor(() => !overlayOf(popup), 'the panel to hide')
  await delay(1200)
  assert.equal(overlayOf(popup), undefined, 'stays hidden for this lock screen')
  smoke.step('"Use master password" hides the panel')

  // 7. Five wrong PINs wipe quick unlock.
  popup.close()
  await waitFor(() => !popupWindow(), 'the popup to close')
  popup = await openPopup()
  overlay = await waitFor(() => overlayOf(popup), 'the panel in a new popup', 30000)
  await waitFor(() => evaluate(overlay.webContents, `!document.getElementById('pin-mode').hidden`), 'the PIN pad')
  const results = []
  for (let i = 0; i < 5; i++) results.push(await evaluate(overlay.webContents, `window.surffishQuickUnlock.submitPin('11111${i}')`))
  assert.deepEqual(results.slice(0, 4).map((r) => r.attemptsLeft), [4, 3, 2, 1])
  assert.equal(results[4].status, 'error')
  await shot(overlay.webContents, 'locked-out')
  const after = await evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')
  assert.deepEqual([after.enabled, after.armed], [false, false])
  assert.match(after.notice, /wrong PINs/)
  const wiped = JSON.parse(readFileSync(join(userData, 'bramble-quick-unlock.json'), 'utf8'))
  assert.equal(wiped.enabled, false)
  assert.equal(wiped.rearm, undefined)
  assert.equal(await isLocked(), true)
  smoke.step('5 wrong PINs: quick unlock wiped')

  // 8. Disable removes the file.
  assert.equal((await evaluate(content, 'window.api.browser.bramble.quickUnlock.disable()')).ok, true)
  assert.equal(existsSync(join(userData, 'bramble-quick-unlock.json')), false)
  console.log('BRAMBLE QUICK UNLOCK APP CHECK PASSED')
}

run().then(() => app.exit(0), (error) => {
  console.error('BRAMBLE QUICK UNLOCK APP CHECK FAILED:', error && error.stack ? error.stack : error)
  app.exit(1)
}).finally(() => smoke.removeProfile?.(root))
