// Full-app check of Surffish's Bramble quick unlock, against a real Bramble Firefox build. Not in CI
// (needs the Bramble build, like check-bramble-poc.ts). Run the production build first:
//   bun run build && electron scripts/check-bramble-quick-unlock-app.cjs <unpacked bramble_firefox_X.zip dir>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-quick-unlock-app.cjs <dir>)
// First checks that PIN setup is refused (IPC) and disabled (Settings) while Bramble has no vault,
// and that Settings enables it once the vault exists. Then creates a vault through Bramble's own setup page in a Surffish tab, enrols a PIN through the
// Settings IPC, locks, opens the toolbar popup and drives Surffish's PIN panel: a wrong PIN, the
// right PIN typed on the keyboard (Bramble must unlock), "Use master password", and the 5-strike
// lockout. Set CHECK_SHOTS=<dir> to save screenshots of the panel.
// Then a second Surffish process on the same profile checks the restart path of memory-only mode
// (an enrolment written before the mode was switchable, so it should migrate where it can): no
// Surffish master password screen at all, only Bramble's own form; a wrong master password typed
// there re-arms nothing; the right one re-arms the PIN, and the PIN pad is back on the next lock.
// Phase 3 (only where safeStorage works, e.g. macOS, or Linux under scripts/with-linux-keyring.sh):
// a third restart is armed straight away (PIN pad, never the master password), and the Settings
// switch goes to memory-only (PIN required, wrong PIN counted) and back.
// The script drives itself: without CHECK_PHASE it runs the phases as child processes.
'use strict'
const { spawnSync } = require('node:child_process')
const phase = process.env.CHECK_PHASE
if (!phase) {
  // Driver: never loads Surffish, so the children own the profile (single-instance lock).
  const { app: driver } = require('electron')
  const { tmpdir: tmp } = require('node:os')
  const { join: joinPath } = require('node:path')
  const shared = joinPath(tmp(), `surffish-bramble-quick-unlock-app-${process.pid}`)
  let code = 0
  for (const next of ['1', '2', '3']) {
    const child = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, CHECK_PHASE: next, CHECK_ROOT: shared } })
    if (child.status !== 0) { code = child.status || 1; break }
  }
  require('./smoke-profile.cjs').removeProfile(shared)
  if (code === 0) console.log('BRAMBLE QUICK UNLOCK APP CHECK PASSED (all phases)')
  driver.exit(code)
  return
}
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BaseWindow, BrowserWindow, webContents } = require('electron')
const { ElectronBlocker } = require('@ghostery/adblocker-electron')

const dist = resolve(process.argv.slice(2).filter((arg) => !arg.startsWith('-')).at(-1) || '')
const root = process.env.CHECK_ROOT || join(tmpdir(), `surffish-bramble-quick-unlock-app-${process.pid}`)
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

const configFile = join(userData, 'bramble-quick-unlock.json')
const popupWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.isVisible() && win.webContents.getURL().endsWith('/popup.html'))
const overlayOf = (popup) => popup.contentView.children.find((view) => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL().startsWith('data:text/html'))

async function start() {
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
  const openPopup = async () => {
    const state = await evaluate(toolbar, 'window.api.browser.bramble.open()')
    try {
      return await waitFor(popupWindow, 'the Bramble popup', 15000)
    } catch (error) {
      console.log('open() ->', JSON.stringify(state), BrowserWindow.getAllWindows().map((win) => `${win.getTitle()} ${win.isVisible()} ${win.webContents.getURL()}`))
      throw error
    }
  }
  return { toolbar, content, openPopup }
}

async function run() {
  const { toolbar, content, openPopup } = await start()
  assert.equal(existsSync(configFile), false)

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

  // 2. Enrol through the Settings IPC (what Settings → Integrations → Quick unlock calls). No
  // restart mode given: persisted wherever safeStorage can protect the key (macOS Keychain),
  // memory-only where it cannot (headless Linux has no keyring, so basic_text is refused).
  const bad = await evaluate(content, `window.api.browser.bramble.quickUnlock.enrol({ masterPassword: 'x', pin: '12', confirmPin: '12', touchId: false })`)
  assert.equal(bad.ok, false)
  const enrolled = await evaluate(content, `window.api.browser.bramble.quickUnlock.enrol(${JSON.stringify({ masterPassword: MASTER, pin: PIN, confirmPin: PIN, touchId: false })})`)
  assert.equal(enrolled.ok, true, JSON.stringify(enrolled))
  assert.equal(enrolled.state.armed, true)
  const persisted = enrolled.state.persistAvailable
  assert.equal(enrolled.state.requireMasterAfterRestart, !persisted, 'persisted is the default when secure storage exists')
  const onDisk = readFileSync(configFile, 'utf8')
  assert.equal(onDisk.includes(MASTER), false, 'no plaintext master password on disk')
  assert.equal(JSON.parse(onDisk).pin === undefined, !persisted, persisted ? 'persisted: PIN slot on disk' : 'memory-only: no PIN slot on disk')
  smoke.step(`PIN enrolled (${persisted ? 'persisted, the default' : 'memory-only: no secure key storage here'})`)
  // Settings → Integrations shows the section (lazy chunk) with its live status.
  await evaluate(toolbar, 'window.api.browser.chrome.set({ sidebarMode: "integrations" })')
  await waitFor(() => evaluate(content, `!!document.querySelector('.bramble-quick-unlock-settings') && document.querySelector('.bramble-quick-unlock-settings').textContent.includes('Turn off quick unlock')`), 'the Quick unlock settings section')
  await evaluate(content, `document.querySelector('.bramble-quick-unlock-settings').scrollIntoView(); true`)
  await delay(300)
  await shot(content, 'settings-enabled')
  // The restart-mode switch is in Settings after setup (enabled while armed, unless there is no
  // secure storage to switch to persisted with).
  const toggle = `document.querySelector('.bramble-quick-unlock-require-master')`
  const toggleState = await evaluate(content, `(() => { const t = ${toggle}; return t && { checked: t.checked, disabled: t.disabled } })()`)
  assert.ok(toggleState, 'the Require master password switch is shown after setup')
  assert.deepEqual(toggleState, { checked: !persisted, disabled: !persisted })
  smoke.step('restart-mode switch shown in Settings after setup')

  const lock = () => evaluate(options, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_LOCK' }, () => done(true)))`)
  const isLocked = async () => (await evaluate(options, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_IS_LOCKED' }, (r) => done(r)))`)).data === true

  // 3. Locked popup: Surffish's PIN panel appears over Bramble's unlock form.
  await lock()
  assert.equal(await isLocked(), true)
  let popup = await openPopup()
  let overlay = await waitFor(() => overlayOf(popup), 'the quick unlock panel over the popup', 30000)
  await waitFor(() => evaluate(overlay.webContents, `!document.getElementById('pin-mode').hidden`), 'the PIN pad')
  assert.equal(await evaluate(overlay.webContents, `!!document.getElementById('rearm-mode') || !!document.querySelector('input')`), false, 'no Surffish master password screen exists')
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
  assert.equal(existsSync(configFile), false)
  smoke.step('disable removed the file')

  // 9. For phase 2: a memory-only enrolment as written before the mode was switchable.
  const memoryOnly = await evaluate(content, `window.api.browser.bramble.quickUnlock.enrol(${JSON.stringify({ masterPassword: MASTER, pin: PIN, confirmPin: PIN, touchId: false, requireMasterAfterRestart: true })})`)
  assert.equal(memoryOnly.ok, true, JSON.stringify(memoryOnly))
  const legacy = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(legacy.restartModeChosen, true)
  delete legacy.restartModeChosen
  writeFileSync(configFile, JSON.stringify(legacy), { mode: 0o600 })
  await lock()
  smoke.step('memory-only enrolment left for the restart phase')
  console.log('BRAMBLE QUICK UNLOCK APP CHECK PHASE 1 PASSED')
}

/** Phase 2: Surffish restarted with that memory-only enrolment. */
async function restartPhase() {
  const { content, openPopup } = await start()
  const get = () => evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')
  const before = await get()
  assert.deepEqual([before.enabled, before.armed, before.canRearm, before.migratesOnRearm], [true, false, true, true], JSON.stringify(before))
  assert.equal(before.notice, null, 'Settings explains re-arming from canRearm; no duplicate notice')
  smoke.step('after restart: enabled, not armed, re-armable (and due to migrate)')

  // Settings: the switch can't move until quick unlock is armed; the hint says how to arm it.
  await evaluate(content, 'window.api.browser.chrome.set({ sidebarMode: "integrations" })').catch(() => {})
  const toggle = `document.querySelector('.bramble-quick-unlock-require-master')`
  await waitFor(() => evaluate(content, `(() => { const t = ${toggle}; return !!t && t.disabled && !!document.querySelector('.bramble-quick-unlock-rearm-hint') })()`), 'the disabled switch with the re-arm hint')
  await evaluate(content, `document.querySelector('.bramble-quick-unlock-settings').scrollIntoView(); true`)
  await delay(300)
  await shot(content, 'settings-after-restart')
  smoke.step('Settings: switch disabled until armed, re-arm hint shown')

  // Locked popup: Bramble's own form only, no Surffish overlay of any kind.
  const popup = await openPopup()
  const isLocked = async () => (await evaluate(popup.webContents, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_IS_LOCKED' }, (r) => done(r)))`)).data === true
  assert.equal(await isLocked(), true)
  await waitFor(() => evaluate(popup.webContents, `!!document.querySelector('form input[name="masterPassword"]')`), 'Bramble’s own unlock form', 30000)
  await delay(1500)
  assert.equal(overlayOf(popup), undefined, 'no Surffish screen over Bramble’s form when not armed')
  await shot(popup.webContents, 'restart-bramble-form')
  smoke.step('no Surffish overlay: Bramble’s own unlock form is in front')

  // The user types into Bramble's form (main world, like a real keyboard would).
  const typeIntoBramble = (value) => evaluate(popup.webContents, `(() => {
    const input = document.querySelector('form input[name="masterPassword"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.querySelector('button[type="submit"]').click();
    return true;
  })()`)
  await typeIntoBramble('definitely not the master password')
  await waitFor(() => evaluate(popup.webContents, `document.querySelector('input[name="masterPassword"]')?.getAttribute('aria-invalid') === 'true'`), 'Bramble to reject the wrong password', 30000)
  await delay(1200)
  const afterWrong = await get()
  assert.equal(afterWrong.armed, false, 'a wrong master password re-arms nothing')
  assert.equal(afterWrong.failedAttempts, 0)
  smoke.step('wrong master password in Bramble’s form: nothing re-armed')

  await waitFor(() => evaluate(popup.webContents, `(() => { const b = document.querySelector('form button[type="submit"]'); return !!b && !b.disabled })()`), 'the form to be ready again')
  await typeIntoBramble(MASTER)
  await waitFor(async () => !(await isLocked()), 'Bramble to unlock from its own form', 30000)
  const armed = await waitFor(async () => { const state = await get(); return state.armed && state }, 'quick unlock to re-arm from what Bramble was given', 15000)
  const file = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(JSON.stringify(file).includes(MASTER), false)
  if (armed.persistAvailable) {
    assert.deepEqual([armed.requireMasterAfterRestart, typeof file.pin, file.rearm], [false, 'object', undefined], 'migrated to persisted')
  } else {
    assert.deepEqual([armed.requireMasterAfterRestart, typeof file.rearm, file.pin], [true, 'object', undefined], 'no secure storage: stays memory-only')
  }
  smoke.step(`right master password in Bramble’s form re-armed the PIN (${armed.persistAvailable ? 'migrated to persisted' : 'still memory-only: no secure storage here'})`)

  // Next lock: the PIN pad is back, and the PIN unlocks.
  await evaluate(popup.webContents, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_LOCK' }, () => done(true)))`)
  const overlay = await waitFor(() => overlayOf(popup), 'the PIN pad after re-arming', 30000)
  await waitFor(() => evaluate(overlay.webContents, `!document.getElementById('pin-mode').hidden`), 'the PIN pad')
  await shot(overlay.webContents, 'restart-pin-pad')
  for (const key of [...PIN, 'Enter']) await evaluate(overlay.webContents, `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); true`)
  await waitFor(async () => !(await isLocked()), 'Bramble to unlock from the PIN', 30000)
  smoke.step('PIN pad back on the next lock; PIN unlocked Bramble')

  // Settings: armed now, so the switch is usable (to persisted only where secure storage exists).
  await waitFor(() => evaluate(content, `(() => { const t = ${toggle}; return !!t && t.disabled === ${!armed.persistAvailable && armed.requireMasterAfterRestart} && !document.querySelector('.bramble-quick-unlock-rearm-hint') })()`), 'the switch state once armed')
  // Turning memory-only on needs the PIN; already on here, so it is a no-op that records the choice.
  const keep = await evaluate(content, `window.api.browser.bramble.quickUnlock.setRequireMaster({ require: ${armed.requireMasterAfterRestart} })`)
  assert.equal(keep.ok, true, JSON.stringify(keep))
  assert.equal(JSON.parse(readFileSync(configFile, 'utf8')).restartModeChosen, true)
  smoke.step('Settings switch usable once armed')
  console.log('BRAMBLE QUICK UNLOCK APP CHECK PHASE 2 PASSED')
}


/** Phase 3: restarted again after the migration. */
async function persistedPhase() {
  const { content, openPopup } = await start()
  const get = () => evaluate(content, 'window.api.browser.bramble.quickUnlock.get()')
  const state = await get()
  if (state.requireMasterAfterRestart) {
    assert.equal(state.persistAvailable, false)
    smoke.step('no secure key storage here: persisted phase skipped (run under scripts/with-linux-keyring.sh to cover it)')
    console.log('BRAMBLE QUICK UNLOCK APP CHECK PHASE 3 SKIPPED')
    return
  }
  assert.deepEqual([state.enabled, state.armed, state.notice], [true, true, null], JSON.stringify(state))
  smoke.step('after another restart: armed straight away')
  const popup = await openPopup()
  const isLocked = async () => (await evaluate(popup.webContents, `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_IS_LOCKED' }, (r) => done(r)))`)).data === true
  assert.equal(await isLocked(), true)
  const overlay = await waitFor(() => overlayOf(popup), 'the PIN pad straight after a restart', 30000)
  await waitFor(() => evaluate(overlay.webContents, `!document.getElementById('pin-mode').hidden`), 'the PIN pad')
  for (const key of [...PIN, 'Enter']) await evaluate(overlay.webContents, `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); true`)
  await waitFor(async () => !(await isLocked()), 'Bramble to unlock from the PIN', 30000)
  smoke.step('PIN unlocked Bramble with no master password since the restart')

  const set = (input) => evaluate(content, `window.api.browser.bramble.quickUnlock.setRequireMaster(${JSON.stringify(input)})`)
  const noPin = await set({ require: true })
  assert.equal(noPin.ok, false)
  const wrong = await set({ require: true, pin: '000000' })
  assert.equal(wrong.ok, false)
  assert.match(wrong.error, /Wrong PIN/)
  assert.equal(wrong.state.failedAttempts, 1)
  const on = await set({ require: true, pin: PIN })
  assert.equal(on.ok, true, JSON.stringify(on))
  let file = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.deepEqual([file.requireMasterAfterRestart, file.restartModeChosen, file.pin, file.deviceKey, typeof file.rearm, file.failedAttempts], [true, true, undefined, undefined, 'object', 0])
  assert.equal(on.state.armed, true)
  smoke.step('Settings: memory-only on (needs the PIN; a wrong one is counted)')
  const off = await set({ require: false })
  assert.equal(off.ok, true, JSON.stringify(off))
  file = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.deepEqual([file.requireMasterAfterRestart, typeof file.pin, typeof file.deviceKey, file.rearm], [false, 'object', 'string', undefined])
  assert.equal(JSON.stringify(file).includes(MASTER), false)
  smoke.step('Settings: back to persisted')
  console.log('BRAMBLE QUICK UNLOCK APP CHECK PHASE 3 PASSED')
}

;(phase === '3' ? persistedPhase() : phase === '2' ? restartPhase() : run()).then(() => app.exit(0), (error) => {
  console.error(`BRAMBLE QUICK UNLOCK APP CHECK FAILED (phase ${phase}):`, error && error.stack ? error.stack : error)
  app.exit(1)
}).finally(() => { if (!process.env.CHECK_ROOT) smoke.removeProfile?.(root) })
