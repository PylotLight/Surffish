// Smoke for Surffish's "Scan QR" on Bramble's Join a device form (src/shared/bramble-qr-join-page.cjs).
// No real Bramble needed: a fixture page copies the bits of Bramble's JoinCard the script looks for
// (textarea#pairing-code with its placeholder, a "Master password" PasswordField in the same form)
// and emulates React's controlled-input value tracker, so a fill only counts if React would see it.
//
// Phase 1 (file:// fixture, getUserMedia mocked with a canvas stream of a real QR PNG): the button
//   follows a re-rendered textarea, the jsQR fallback decodes the pairing QR and fills the field
//   (React onChange fires), the camera stops, the password QR fills the master password without it
//   ever reaching the console, a denied camera shows an error, Cancel stops the camera, a mocked
//   BarcodeDetector wins over jsQR and a wrapped deep link is unwrapped, a foreign QR fills nothing.
// Phase 2 (a tiny unpacked extension, Chromium's fake camera fed a QR video): real getUserMedia from
//   a chrome-extension:// page asks the session permission handler for video only, and the whole
//   scan -> fill runs end to end.
//
// `bun run build && bun run test:electron-bramble-qr-join` (Linux: under `xvfb-run -a`).
// A real-Bramble version of phase 2 (not in CI): scripts/check-bramble-qr-join.cjs.
const smoke = require('./smoke-harness.cjs')
const assert = require('node:assert/strict')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, nativeImage, session } = require('electron')

const repo = resolve(__dirname, '..')
const root = join(tmpdir(), `surffish-bramble-qr-smoke-${process.pid}`)
const fixtureDir = join(root, 'fixture')
const detectorDir = join(root, 'fixture-detector')
const extensionDir = join(root, 'extension')
const fakeVideo = join(root, 'qr.y4m')
for (const dir of [fixtureDir, detectorDir, extensionDir]) mkdirSync(dir, { recursive: true })
app.setPath('userData', join(root, 'profile'))
// Chromium's fake camera reads this file when a page opens it (written after ready, below).
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-file-for-fake-video-capture', fakeVideo)

// What scripts/fixtures/bramble-pairing-qr.png holds: Bramble's encodePairingCode format with fake keys.
const PAIRING_TEXT = 'bramble-pair-1.eyJ2IjoxLCJncm91cEtleSI6IkN6QlZlcC9FNlE0eldIMml4K3dSTmx1QXBjcnZGRGxlZzZqTjhoYzhZWVk9IiwiaW52aXRlclB1YiI6IkZqdGdoYXJQOUJrK1k0aXQwdmNjUVdhTHNOWDZIMFJwanJQWS9TSkhiSkU9IiwicHNrIjoiSVVacmtMWGEveVJKYnBPNDNRSW5USEdXdStBRktrOTBtYjdqQ0MxU2Q1dz0iLCJyZWxheSI6IndzczovL3JlbGF5LmJyYW1ibGUuc2giLCJleHAiOjE4OTM0NTYwMDAwMDB9'
const PASSWORD_TEXT = 'correct horse battery staple'
const PAIRING_PNG = join(repo, 'scripts/fixtures/bramble-pairing-qr.png')
const PASSWORD_PNG = join(repo, 'scripts/fixtures/bramble-password-qr.png')

function jsqrSource() {
  const built = join(repo, 'out/vendor/jsqr.min.js')
  if (existsSync(built)) return readFileSync(built, 'utf8')
  return readFileSync(join(repo, 'node_modules/jsqr/dist/jsQR.js'), 'utf8')
}

// Bramble's JoinCard, reduced to what the script reads.
const JOIN_HTML = (extraScripts) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Vault Setup</title>
${extraScripts.map((src) => `<script src="${src}"></script>`).join('\n')}
<script defer src="./surffish-bramble-qr-join.js"></script>
</head><body><div id="root"><form id="join">
  <div id="code-box"><label for="pairing-code">Pairing code</label>
  <textarea id="pairing-code" rows="3" placeholder="Paste the code from your other device's &quot;Add a device&quot; screen"></textarea></div>
  <div><div class="group relative"><input id="r1" type="password" placeholder=" "><label for="r1">Master password</label></div></div>
  <button type="submit">Join vault</button>
</form></div></body></html>`

// React keeps the last value it saw on the element instance; an input event only becomes onChange
// when the element's real value differs from it. Assigning element.value directly would update the
// tracker and React would see no change.
const REACT_EMULATION = `(() => {
  window.__changes = []
  window.__track = (node, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')
    let tracked = descriptor.get.call(node)
    Object.defineProperty(node, 'value', { configurable: true, get() { return descriptor.get.call(this) }, set(value) { tracked = String(value); descriptor.set.call(this, value) } })
    node.addEventListener('input', () => { const actual = descriptor.get.call(node); if (actual !== tracked) { tracked = actual; window.__changes.push({ name, length: actual.length }) } })
  }
  const start = () => { __track(document.getElementById('pairing-code'), 'pairing'); __track(document.getElementById('r1'), 'password') }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start()
})()`

// getUserMedia mocked with a canvas stream showing whichever QR image the test picks.
const MEDIA_MOCK = `(() => {
  window.__media = { calls: [], stopped: 0, reject: null }
  const canvas = document.createElement('canvas')
  canvas.width = 1280; canvas.height = 720
  const context = canvas.getContext('2d')
  let image = null
  window.__showImage = (src) => new Promise((resolve) => { if (!src) { image = null; resolve(); return } const img = new Image(); img.onload = () => { image = img; resolve() }; img.src = src })
  setInterval(() => {
    context.fillStyle = '#7f8c8d'; context.fillRect(0, 0, canvas.width, canvas.height)
    if (image) { const size = 440; context.fillStyle = '#fff'; context.fillRect((1280 - size) / 2 - 20, (720 - size) / 2 - 20, size + 40, size + 40); context.drawImage(image, (1280 - size) / 2, (720 - size) / 2, size, size) }
  }, 50)
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    window.__media.calls.push(JSON.parse(JSON.stringify(constraints)))
    if (window.__media.reject) throw Object.assign(new Error('denied'), { name: window.__media.reject })
    const stream = canvas.captureStream(20)
    for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.__media.stopped++; stop() } }
    return stream
  }
})()`

const FAKE_BARCODE_DETECTOR = `(() => {
  window.__detectorCalls = 0
  window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code'] } async detect() { window.__detectorCalls++; return window.__detectorValue ? [{ rawValue: window.__detectorValue }] : [] } }
})()`

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      last = error
    }
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}.${last ? ` Last error: ${last.message}` : ''}`)
}

const HOST = (kind) => `document.querySelector('[data-surffish-qr="${kind}"]')`
const SHADOW = (kind, selector) => `${HOST(kind)}.shadowRoot.querySelector(${JSON.stringify(selector)})`

function writeFixture(dir, extraScripts) {
  writeFileSync(join(dir, 'surffish-bramble-qr-join.js'), readFileSync(join(repo, 'src/shared/bramble-qr-join-page.cjs'), 'utf8'))
  writeFileSync(join(dir, 'surffish-jsqr.js'), jsqrSource())
  writeFileSync(join(dir, 'react-emulation.js'), REACT_EMULATION)
  writeFileSync(join(dir, 'media-mock.js'), MEDIA_MOCK)
  writeFileSync(join(dir, 'fake-barcode-detector.js'), FAKE_BARCODE_DETECTOR)
  writeFileSync(join(dir, 'pairing.png'), readFileSync(PAIRING_PNG))
  writeFileSync(join(dir, 'password.png'), readFileSync(PASSWORD_PNG))
  writeFileSync(join(dir, 'options.html'), JOIN_HTML(extraScripts))
}

/** I420 y4m of the pairing QR centred on grey, for Chromium's fake camera. */
function writeFakeCameraVideo() {
  const width = 1280
  const height = 720
  const size = 440
  const bitmap = nativeImage.createFromPath(PAIRING_PNG).resize({ width: size, height: size, quality: 'best' }).toBitmap() // BGRA
  const luma = Buffer.alloc(width * height, 128)
  for (let y = -20; y < size + 20; y++) {
    for (let x = -20; x < size + 20; x++) {
      const i = (y * size + x) * 4
      const inside = x >= 0 && y >= 0 && x < size && y < size
      luma[((height - size) / 2 + y) * width + ((width - size) / 2 + x)] = inside ? Math.round(0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2]) : 255
    }
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, Buffer.alloc(width * height / 2, 128)])
  writeFileSync(fakeVideo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`), frame, frame]))
}

async function phaseFixture() {
  smoke.step('phase 1: fixture page, mocked camera')
  writeFixture(fixtureDir, ['./react-emulation.js', './media-mock.js'])
  const consoleLines = []
  const win = new BrowserWindow({ show: false, width: 900, height: 900, webPreferences: { sandbox: true, contextIsolation: true, partition: 'bramble-qr-fixture' } })
  win.webContents.on('console-message', (event) => consoleLines.push(String(event.message ?? '')))
  const run = (code) => smoke.evaluate(win.webContents, code)
  await win.loadURL(pathToFileURL(join(fixtureDir, 'options.html')).href)

  await waitFor(() => run(`!!${HOST('pairing')} && !!${HOST('password')}`), 'Scan buttons on the Join a device form')
  assert.equal(await run(`${HOST('pairing')}.previousElementSibling.id`), 'pairing-code', 'Scan QR sits right under the pairing code box')
  assert.equal(await run(`${HOST('password')}.previousElementSibling.className`), 'group relative', 'password scan sits under the master password field')

  smoke.step('a re-rendered textarea gets its button back (and only one)')
  await run(`(() => { ${HOST('pairing')}.__stale = true; const old = document.getElementById('pairing-code'); const fresh = old.cloneNode(true); old.replaceWith(fresh); __track(fresh, 'pairing') })()`)
  await waitFor(() => run(`document.querySelectorAll('[data-surffish-qr="pairing"]').length === 1 && !${HOST('pairing')}.__stale && ${HOST('pairing')}.previousElementSibling === document.getElementById('pairing-code')`), 'button to follow the new textarea')

  smoke.step('jsQR fallback decodes the pairing QR and fills the field like typing')
  assert.equal(await run('typeof window.jsQR'), 'undefined', 'jsQR is not loaded until a scan needs it')
  await run(`__showImage('./pairing.png')`)
  await run(`${SHADOW('pairing', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`document.getElementById('pairing-code').value === ${JSON.stringify(PAIRING_TEXT)}`), 'pairing code filled from the QR')
  assert.deepEqual(await run('__changes'), [{ name: 'pairing', length: PAIRING_TEXT.length }], 'React-style onChange fired once for the pairing code')
  assert.equal(await run('typeof window.jsQR'), 'function', 'jsQR was lazy-loaded for the fallback')
  await waitFor(() => run('__media.stopped >= 1'), 'camera stopped after the fill')
  assert.equal(await run(`${SHADOW('pairing', '.panel')}.hidden`), true, 'camera panel closed')
  assert.match(await run(`${SHADOW('pairing', '.row .status')}.textContent`), /filled/i)
  const constraints = await run('__media.calls[0]')
  assert.equal(constraints.audio, false, 'never asks for the microphone')
  assert.ok(constraints.video.width.ideal >= 1280 && constraints.video.height.ideal >= 720, 'asks for at least 1280x720')
  assert.equal(await run('document.activeElement && document.activeElement.id'), 'r1', 'focus moves on to the master password')

  smoke.step('password QR fills the master password, never logged')
  await run(`__showImage('./password.png')`)
  await run(`${SHADOW('password', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`document.getElementById('r1').value === ${JSON.stringify(PASSWORD_TEXT)}`), 'master password filled from its QR')
  assert.deepEqual((await run('__changes'))[1], { name: 'password', length: PASSWORD_TEXT.length })
  await waitFor(() => run('__media.stopped >= 2'), 'camera stopped after the password fill')

  smoke.step('denied camera shows a clear error')
  await run(`__media.reject = 'NotAllowedError'`)
  await run(`${SHADOW('pairing', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`/System Settings/.test(${SHADOW('pairing', '.row .status')}.textContent)`), 'camera-denied error')
  assert.equal(await run(`${SHADOW('pairing', '.panel')}.hidden`), true)
  assert.equal(await run(`${SHADOW('pairing', 'button[part="scan"]')}.disabled`), false, 'can try again')

  smoke.step('Cancel stops the camera; the preview is mirrored')
  await run(`__media.reject = null; __showImage(null)`)
  const stoppedBefore = await run('__media.stopped')
  await run(`${SHADOW('pairing', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`${SHADOW('pairing', '.panel')}.hidden === false && __media.calls.length >= 4`), 'camera panel open')
  const mirrored = await run(`getComputedStyle(${SHADOW('pairing', 'video')}).transform`)
  assert.match(mirrored, /^matrix\(-1, 0, 0, 1, 0, 0\)$/, `preview is mirrored (${mirrored})`)
  await run(`${SHADOW('pairing', '.cancel')}.click()`)
  await waitFor(() => run(`__media.stopped > ${stoppedBefore} && ${SHADOW('pairing', '.panel')}.hidden`), 'camera stopped by Cancel')

  assert.ok(!consoleLines.some((line) => line.includes(PASSWORD_TEXT)), 'the master password never reaches the console')

  smoke.step('BarcodeDetector is used when it can read QR, and a wrapped deep link is unwrapped')
  writeFixture(detectorDir, ['./react-emulation.js', './media-mock.js', './fake-barcode-detector.js'])
  await win.loadURL(pathToFileURL(join(detectorDir, 'options.html')).href)
  await waitFor(() => run(`!!${HOST('pairing')}`), 'Scan QR button (BarcodeDetector page)')
  await run(`window.__detectorValue = 'https://bramble.sh/join?code=' + encodeURIComponent(${JSON.stringify(PAIRING_TEXT)})`)
  await run(`${SHADOW('pairing', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`document.getElementById('pairing-code').value === ${JSON.stringify(PAIRING_TEXT)}`), 'pairing code filled via BarcodeDetector')
  assert.ok(await run('__detectorCalls > 0'))
  assert.equal(await run('typeof window.jsQR'), 'undefined', 'jsQR never loaded when BarcodeDetector works')

  smoke.step('a QR that is not a pairing code keeps scanning with a hint')
  await run(`(() => { const t = document.getElementById('pairing-code'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); window.__detectorValue = 'otpauth://totp/x?secret=ABC' })()`)
  await run(`${SHADOW('pairing', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`/isn’t a Bramble pairing code/.test(${SHADOW('pairing', '.hint')}.textContent)`), 'wrong-QR hint')
  assert.equal(await run(`document.getElementById('pairing-code').value`), '', 'nothing filled from a foreign QR')
  await run(`${SHADOW('pairing', '.cancel')}.click()`)
  win.destroy()
}

async function phaseExtension() {
  smoke.step('phase 2: chrome-extension:// page, real getUserMedia on the fake camera')
  writeFakeCameraVideo()
  writeFixture(extensionDir, ['./react-emulation.js'])
  writeFileSync(join(extensionDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Bramble QR smoke', version: '1.0.0', options_page: 'options.html', content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" } }))
  const ses = session.fromPartition(`persist:bramble-qr-smoke-${process.pid}`)
  const extension = await ses.extensions.loadExtension(extensionDir)
  const requests = []
  // Same rule as Surffish's policy (src/shared/bramble-camera.ts): this extension, media, video only.
  ses.setPermissionCheckHandler((_contents, permission, origin, details) => permission === 'media' && origin.startsWith(extension.url.slice(0, -1)) && details.mediaType === 'video')
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    requests.push({ permission, requestingUrl: details.requestingUrl, mediaTypes: details.mediaTypes })
    callback(permission === 'media' && String(details.requestingUrl).startsWith(extension.url) && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every((type) => type === 'video'))
  })
  const win = new BrowserWindow({ show: false, width: 900, height: 900, webPreferences: { session: ses, sandbox: true, contextIsolation: true } })
  const run = (code) => smoke.evaluate(win.webContents, code)
  await win.loadURL(`${extension.url}options.html`)
  await waitFor(() => run(`!!${HOST('pairing')}`), 'Scan QR button on the extension page')
  await run(`${SHADOW('pairing', 'button[part="scan"]')}.click()`)
  await waitFor(() => run(`document.getElementById('pairing-code').value === ${JSON.stringify(PAIRING_TEXT)}`), 'pairing code filled from the fake camera', smoke.waitMs * 2)
  const mediaRequests = requests.filter((entry) => entry.permission === 'media')
  assert.ok(mediaRequests.length >= 1, 'getUserMedia went through the session permission handler')
  for (const entry of mediaRequests) {
    assert.deepEqual(entry.mediaTypes, ['video'], 'video only')
    assert.ok(entry.requestingUrl.startsWith(extension.url), `requested by the extension page (${entry.requestingUrl})`)
  }
  assert.deepEqual(await run('__changes.map((change) => change.name)'), ['pairing'])
  win.destroy()
}

// Phases open and close their own windows; closing one must not quit the smoke.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  try {
    await phaseFixture()
    await phaseExtension()
    smoke.step('ok')
    await smoke.removeProfile(root)
    app.exit(0)
  } catch (error) {
    console.error(error && error.stack ? error.stack : error)
    app.exit(1)
  }
})
