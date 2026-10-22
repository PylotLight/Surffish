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
// Phase 3 (another tiny extension, real chrome.storage.local, a mocked surffishBramble bridge): the
//   setup tab auto-close (src/shared/bramble-setup-close-page.cjs). A page that copies the shapes of
//   Bramble's SetupShell screens (form, "Connecting…" spinner, recovery code, terminal done screen)
//   asks to close only on the done screen after a vault this session created, ~1.5 s later; never on
//   an existing vault, an error, the connecting state, or ?screen=import.
//
// `bun run build && bun run test:electron-bramble-qr-join` (Linux: under `xvfb-run -a`).
// A real-Bramble version of phase 2 (not in CI): scripts/check-bramble-qr-join.cjs.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, nativeImage, session } = require("electron");

const repo = resolve(__dirname, "..");
const root = join(tmpdir(), `surffish-bramble-qr-smoke-${process.pid}`);
const fixtureDir = join(root, "fixture");
const detectorDir = join(root, "fixture-detector");
const extensionDir = join(root, "extension");
const setupDir = join(root, "extension-setup");
const fakeVideo = join(root, "qr.y4m");
for (const dir of [fixtureDir, detectorDir, extensionDir, setupDir])
  mkdirSync(dir, { recursive: true });
app.setPath("userData", join(root, "profile"));
// Chromium's fake camera reads this file when a page opens it (written after ready, below).
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-video-capture", fakeVideo);

// What scripts/fixtures/bramble-pairing-qr.png holds: Bramble's encodePairingCode format with fake keys.
const PAIRING_TEXT =
  "bramble-pair-1.eyJ2IjoxLCJncm91cEtleSI6IkN6QlZlcC9FNlE0eldIMml4K3dSTmx1QXBjcnZGRGxlZzZqTjhoYzhZWVk9IiwiaW52aXRlclB1YiI6IkZqdGdoYXJQOUJrK1k0aXQwdmNjUVdhTHNOWDZIMFJwanJQWS9TSkhiSkU9IiwicHNrIjoiSVVacmtMWGEveVJKYnBPNDNRSW5USEdXdStBRktrOTBtYjdqQ0MxU2Q1dz0iLCJyZWxheSI6IndzczovL3JlbGF5LmJyYW1ibGUuc2giLCJleHAiOjE4OTM0NTYwMDAwMDB9";
const PASSWORD_TEXT = "correct horse battery staple";
const PAIRING_PNG = join(repo, "scripts/fixtures/bramble-pairing-qr.png");
const PASSWORD_PNG = join(repo, "scripts/fixtures/bramble-password-qr.png");

function jsqrSource() {
  const built = join(repo, "out/vendor/jsqr.min.js");
  if (existsSync(built)) return readFileSync(built, "utf8");
  return readFileSync(join(repo, "node_modules/jsqr/dist/jsQR.js"), "utf8");
}

// Bramble's JoinCard, reduced to what the script reads.
const JOIN_HTML = (extraScripts) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Vault Setup</title>
${extraScripts.map((src) => `<script src="${src}"></script>`).join("\n")}
<script defer src="./surffish-bramble-qr-join.js"></script>
</head><body><div id="root"><form id="join">
  <div id="code-box"><label for="pairing-code">Pairing code</label>
  <textarea id="pairing-code" rows="3" placeholder="Paste the code from your other device's &quot;Add a device&quot; screen"></textarea></div>
  <div><div class="group relative"><input id="r1" type="password" placeholder=" "><label for="r1">Master password</label></div></div>
  <button type="submit">Join vault</button>
</form></div></body></html>`;

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
})()`;

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
})()`;

const FAKE_BARCODE_DETECTOR = `(() => {
  window.__detectorCalls = 0
  window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code'] } async detect() { window.__detectorCalls++; return window.__detectorValue ? [{ rawValue: window.__detectorValue }] : [] } }
})()`;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}.${last ? ` Last error: ${last.message}` : ""}`,
  );
}

const HOST = (kind) => `document.querySelector('[data-surffish-qr="${kind}"]')`;
const SHADOW = (kind, selector) =>
  `${HOST(kind)}.shadowRoot.querySelector(${JSON.stringify(selector)})`;

function writeFixture(dir, extraScripts) {
  writeFileSync(
    join(dir, "surffish-bramble-qr-join.js"),
    readFileSync(join(repo, "src/shared/bramble-qr-join-page.cjs"), "utf8"),
  );
  writeFileSync(join(dir, "surffish-jsqr.js"), jsqrSource());
  writeFileSync(join(dir, "react-emulation.js"), REACT_EMULATION);
  writeFileSync(join(dir, "media-mock.js"), MEDIA_MOCK);
  writeFileSync(join(dir, "fake-barcode-detector.js"), FAKE_BARCODE_DETECTOR);
  writeFileSync(join(dir, "pairing.png"), readFileSync(PAIRING_PNG));
  writeFileSync(join(dir, "password.png"), readFileSync(PASSWORD_PNG));
  writeFileSync(join(dir, "options.html"), JOIN_HTML(extraScripts));
}

/** I420 y4m of the pairing QR centred on grey, for Chromium's fake camera. */
function writeFakeCameraVideo() {
  const width = 1280;
  const height = 720;
  const size = 440;
  const bitmap = nativeImage
    .createFromPath(PAIRING_PNG)
    .resize({ width: size, height: size, quality: "best" })
    .toBitmap(); // BGRA
  const luma = Buffer.alloc(width * height, 128);
  for (let y = -20; y < size + 20; y++) {
    for (let x = -20; x < size + 20; x++) {
      const i = (y * size + x) * 4;
      const inside = x >= 0 && y >= 0 && x < size && y < size;
      luma[((height - size) / 2 + y) * width + ((width - size) / 2 + x)] =
        inside
          ? Math.round(
              0.114 * bitmap[i] + 0.587 * bitmap[i + 1] + 0.299 * bitmap[i + 2],
            )
          : 255;
    }
  }
  const frame = Buffer.concat([
    Buffer.from("FRAME\n"),
    luma,
    Buffer.alloc((width * height) / 2, 128),
  ]);
  writeFileSync(
    fakeVideo,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`),
      frame,
      frame,
    ]),
  );
}

async function phaseFixture() {
  smoke.step("phase 1: fixture page, mocked camera");
  writeFixture(fixtureDir, ["./react-emulation.js", "./media-mock.js"]);
  const consoleLines = [];
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      partition: "bramble-qr-fixture",
    },
  });
  win.webContents.on("console-message", (event) =>
    consoleLines.push(String(event.message ?? "")),
  );
  const run = (code) => smoke.evaluate(win.webContents, code);
  await win.loadURL(pathToFileURL(join(fixtureDir, "options.html")).href);

  await waitFor(
    () => run(`!!${HOST("pairing")} && !!${HOST("password")}`),
    "Scan buttons on the Join a device form",
  );
  assert.equal(
    await run(`${HOST("pairing")}.previousElementSibling.id`),
    "pairing-code",
    "Scan QR sits right under the pairing code box",
  );
  assert.equal(
    await run(`${HOST("password")}.previousElementSibling.className`),
    "group relative",
    "password scan sits under the master password field",
  );

  smoke.step("a re-rendered textarea gets its button back (and only one)");
  await run(
    `(() => { ${HOST("pairing")}.__stale = true; const old = document.getElementById('pairing-code'); const fresh = old.cloneNode(true); old.replaceWith(fresh); __track(fresh, 'pairing') })()`,
  );
  await waitFor(
    () =>
      run(
        `document.querySelectorAll('[data-surffish-qr="pairing"]').length === 1 && !${HOST("pairing")}.__stale && ${HOST("pairing")}.previousElementSibling === document.getElementById('pairing-code')`,
      ),
    "button to follow the new textarea",
  );

  smoke.step(
    "jsQR fallback decodes the pairing QR and fills the field like typing",
  );
  assert.equal(
    await run("typeof window.jsQR"),
    "undefined",
    "jsQR is not loaded until a scan needs it",
  );
  await run(`__showImage('./pairing.png')`);
  await run(`${SHADOW("pairing", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `document.getElementById('pairing-code').value === ${JSON.stringify(PAIRING_TEXT)}`,
      ),
    "pairing code filled from the QR",
  );
  assert.deepEqual(
    await run("__changes"),
    [{ name: "pairing", length: PAIRING_TEXT.length }],
    "React-style onChange fired once for the pairing code",
  );
  assert.equal(
    await run("typeof window.jsQR"),
    "function",
    "jsQR was lazy-loaded for the fallback",
  );
  await waitFor(
    () => run("__media.stopped >= 1"),
    "camera stopped after the fill",
  );
  assert.equal(
    await run(`${SHADOW("pairing", ".panel")}.hidden`),
    true,
    "camera panel closed",
  );
  assert.match(
    await run(`${SHADOW("pairing", ".row .status")}.textContent`),
    /filled/i,
  );
  const constraints = await run("__media.calls[0]");
  assert.equal(constraints.audio, false, "never asks for the microphone");
  assert.ok(
    constraints.video.width.ideal >= 1280 &&
      constraints.video.height.ideal >= 720,
    "asks for at least 1280x720",
  );
  assert.equal(
    await run("document.activeElement && document.activeElement.id"),
    "r1",
    "focus moves on to the master password",
  );

  smoke.step("password QR fills the master password, never logged");
  await run(`__showImage('./password.png')`);
  await run(`${SHADOW("password", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `document.getElementById('r1').value === ${JSON.stringify(PASSWORD_TEXT)}`,
      ),
    "master password filled from its QR",
  );
  assert.deepEqual((await run("__changes"))[1], {
    name: "password",
    length: PASSWORD_TEXT.length,
  });
  await waitFor(
    () => run("__media.stopped >= 2"),
    "camera stopped after the password fill",
  );

  smoke.step("denied camera shows a clear error");
  await run(`__media.reject = 'NotAllowedError'`);
  await run(`${SHADOW("pairing", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `/System Settings/.test(${SHADOW("pairing", ".row .status")}.textContent)`,
      ),
    "camera-denied error",
  );
  assert.equal(await run(`${SHADOW("pairing", ".panel")}.hidden`), true);
  assert.equal(
    await run(`${SHADOW("pairing", 'button[part="scan"]')}.disabled`),
    false,
    "can try again",
  );

  smoke.step("Cancel stops the camera; the preview is mirrored");
  await run(`__media.reject = null; __showImage(null)`);
  const stoppedBefore = await run("__media.stopped");
  await run(`${SHADOW("pairing", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `${SHADOW("pairing", ".panel")}.hidden === false && __media.calls.length >= 4`,
      ),
    "camera panel open",
  );
  const mirrored = await run(
    `getComputedStyle(${SHADOW("pairing", "video")}).transform`,
  );
  assert.match(
    mirrored,
    /^matrix\(-1, 0, 0, 1, 0, 0\)$/,
    `preview is mirrored (${mirrored})`,
  );
  await run(`${SHADOW("pairing", ".cancel")}.click()`);
  await waitFor(
    () =>
      run(
        `__media.stopped > ${stoppedBefore} && ${SHADOW("pairing", ".panel")}.hidden`,
      ),
    "camera stopped by Cancel",
  );

  assert.ok(
    !consoleLines.some((line) => line.includes(PASSWORD_TEXT)),
    "the master password never reaches the console",
  );

  smoke.step(
    "BarcodeDetector is used when it can read QR, and a wrapped deep link is unwrapped",
  );
  writeFixture(detectorDir, [
    "./react-emulation.js",
    "./media-mock.js",
    "./fake-barcode-detector.js",
  ]);
  await win.loadURL(pathToFileURL(join(detectorDir, "options.html")).href);
  await waitFor(
    () => run(`!!${HOST("pairing")}`),
    "Scan QR button (BarcodeDetector page)",
  );
  await run(
    `window.__detectorValue = 'https://bramble.sh/join?code=' + encodeURIComponent(${JSON.stringify(PAIRING_TEXT)})`,
  );
  await run(`${SHADOW("pairing", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `document.getElementById('pairing-code').value === ${JSON.stringify(PAIRING_TEXT)}`,
      ),
    "pairing code filled via BarcodeDetector",
  );
  assert.ok(await run("__detectorCalls > 0"));
  assert.equal(
    await run("typeof window.jsQR"),
    "undefined",
    "jsQR never loaded when BarcodeDetector works",
  );

  smoke.step("a QR that is not a pairing code keeps scanning with a hint");
  await run(
    `(() => { const t = document.getElementById('pairing-code'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); window.__detectorValue = 'otpauth://totp/x?secret=ABC' })()`,
  );
  await run(`${SHADOW("pairing", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `/isn’t a Bramble pairing code/.test(${SHADOW("pairing", ".hint")}.textContent)`,
      ),
    "wrong-QR hint",
  );
  assert.equal(
    await run(`document.getElementById('pairing-code').value`),
    "",
    "nothing filled from a foreign QR",
  );
  await run(`${SHADOW("pairing", ".cancel")}.click()`);
  win.destroy();
}

async function phaseExtension() {
  smoke.step(
    "phase 2: chrome-extension:// page, real getUserMedia on the fake camera",
  );
  writeFakeCameraVideo();
  writeFixture(extensionDir, ["./react-emulation.js"]);
  writeFileSync(
    join(extensionDir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Bramble QR smoke",
      version: "1.0.0",
      options_page: "options.html",
      content_security_policy: {
        extension_pages:
          "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
    }),
  );
  const ses = session.fromPartition(`persist:bramble-qr-smoke-${process.pid}`);
  const extension = await ses.extensions.loadExtension(extensionDir);
  const requests = [];
  // Same rule as Surffish's policy (src/shared/bramble-camera.ts): this extension, media, video only.
  ses.setPermissionCheckHandler(
    (_contents, permission, origin, details) =>
      permission === "media" &&
      origin.startsWith(extension.url.slice(0, -1)) &&
      details.mediaType === "video",
  );
  ses.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      requests.push({
        permission,
        requestingUrl: details.requestingUrl,
        mediaTypes: details.mediaTypes,
      });
      callback(
        permission === "media" &&
          String(details.requestingUrl).startsWith(extension.url) &&
          Array.isArray(details.mediaTypes) &&
          details.mediaTypes.length > 0 &&
          details.mediaTypes.every((type) => type === "video"),
      );
    },
  );
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 900,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true },
  });
  const run = (code) => smoke.evaluate(win.webContents, code);
  await win.loadURL(`${extension.url}options.html`);
  await waitFor(
    () => run(`!!${HOST("pairing")}`),
    "Scan QR button on the extension page",
  );
  await run(`${SHADOW("pairing", 'button[part="scan"]')}.click()`);
  await waitFor(
    () =>
      run(
        `document.getElementById('pairing-code').value === ${JSON.stringify(PAIRING_TEXT)}`,
      ),
    "pairing code filled from the fake camera",
    smoke.waitMs * 2,
  );
  const mediaRequests = requests.filter(
    (entry) => entry.permission === "media",
  );
  assert.ok(
    mediaRequests.length >= 1,
    "getUserMedia went through the session permission handler",
  );
  for (const entry of mediaRequests) {
    assert.deepEqual(entry.mediaTypes, ["video"], "video only");
    assert.ok(
      entry.requestingUrl.startsWith(extension.url),
      `requested by the extension page (${entry.requestingUrl})`,
    );
  }
  assert.deepEqual(await run("__changes.map((change) => change.name)"), [
    "pairing",
  ]);
  win.destroy();
}

// Bramble's SetupShell screens (packages/core/src/app/OptionsApp.tsx), reduced to the shapes the
// auto-close reads: lucide icons render as svg.lucide.lucide-<name>, the spinner has .animate-spin.
const SETUP_SIM = `(() => {
  const root = document.getElementById('root')
  const page = (inner) => { root.innerHTML = '<div class="min-h-screen"><div class="w-full max-w-xl text-center">' + inner + '</div></div>' }
  window.__sim = {
    form: (error) => page('<h1>Set up your vault</h1><form><input type="password"><textarea id="pairing-code"></textarea>' + (error ? '<p role="alert">' + error + '</p>' : '') + '<button type="submit">Join vault</button></form>'),
    connecting: () => page('<svg class="w-16 h-16"></svg><h1>Connecting to your other device…</h1><p>Keep the invite open.</p><svg class="lucide lucide-loader-circle animate-spin"></svg>'),
    recovery: () => page('<h1>Save your recovery code</h1><code>ABCD-EFGH</code><button>Continue</button>'),
    done: () => { window.__doneAt = Date.now(); page('<div class="inline-flex rounded-2xl"><svg class="lucide lucide-check w-9 h-9"></svg></div><h1 class="text-2xl mb-2">Vault ready</h1><p class="text-sm">You can close this tab and use the Bramble popup.</p>') },
    writeVault: (id) => new Promise((resolve) => chrome.storage.local.get('vault.registry', (items) => {
      const vaults = (items['vault.registry'] && items['vault.registry'].vaults) || []
      chrome.storage.local.set({ 'vault.registry': { vaults: vaults.concat([{ id, label: '', createdAt: 1 }]) }, ['vault-blob-b64:' + id]: 'ZW5jcnlwdGVk' }, resolve)
    })),
    clear: () => new Promise((resolve) => chrome.storage.local.clear(resolve))
  }
  window.__sim.form()
})()`;
const BRIDGE_MOCK = `window.__closeCalls = []
window.surffishBramble = Object.freeze({ closeSetupTab: () => { window.__closeCalls.push(Date.now()); return Promise.resolve(true) } })`;
const SETUP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Vault Setup</title>
<script src="./bridge-mock.js"></script>
<script defer src="./setup-sim.js"></script>
<script defer src="./surffish-bramble-qr-join.js"></script>
</head><body><div id="root"></div></body></html>`;

async function phaseSetupClose() {
  smoke.step(
    "phase 3: setup tab auto-close (real chrome.storage.local, mocked bridge)",
  );
  // The staged page script is the Scan QR helper followed by the setup-close helper (bramble-poc.ts).
  writeFileSync(
    join(setupDir, "surffish-bramble-qr-join.js"),
    `${readFileSync(join(repo, "src/shared/bramble-qr-join-page.cjs"), "utf8")}\n${readFileSync(join(repo, "src/shared/bramble-setup-close-page.cjs"), "utf8")}`,
  );
  writeFileSync(join(setupDir, "surffish-jsqr.js"), jsqrSource());
  writeFileSync(join(setupDir, "setup-sim.js"), SETUP_SIM);
  writeFileSync(join(setupDir, "bridge-mock.js"), BRIDGE_MOCK);
  writeFileSync(join(setupDir, "options.html"), SETUP_HTML);
  writeFileSync(
    join(setupDir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Bramble setup close smoke",
      version: "1.0.0",
      permissions: ["storage"],
      options_page: "options.html",
    }),
  );
  const ses = session.fromPartition(
    `persist:bramble-setup-close-smoke-${process.pid}`,
  );
  const extension = await ses.extensions.loadExtension(setupDir);
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 900,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true },
  });
  const run = (code) => smoke.evaluate(win.webContents, code);
  const open = async (query = "") => {
    await win.loadURL(`${extension.url}options.html${query}`);
    await waitFor(
      () =>
        run(`!!window.__sim && window.__surffishBrambleSetupClose === true`),
      "setup page + setup-close script",
    );
    await delay(300); // the baseline read of chrome.storage.local
  };
  const closeCalls = () => run("__closeCalls.length");

  smoke.step(
    "an existing vault and options.html opened normally: nothing closes",
  );
  await open();
  await run('__sim.clear().then(() => __sim.writeVault("existing"))');
  await open();
  await run("__sim.done()"); // even a done-looking screen: no vault was created by this page
  await delay(2500);
  assert.equal(await closeCalls(), 0, "no close without a new vault");

  smoke.step(
    "join: connecting (vault briefly written) then a pairing error keeps the tab",
  );
  await open();
  await run("__sim.connecting()");
  await run('__sim.writeVault("joining")');
  await delay(2200);
  assert.equal(await closeCalls(), 0, "no close on the connecting screen");
  await run('__sim.form("The other device rejected the pairing.")');
  await delay(2200);
  assert.equal(await closeCalls(), 0, "no close on an error");

  smoke.step(
    "create: recovery code screen stays, the done screen closes after ~1.5 s",
  );
  await open();
  await run('__sim.writeVault("created").then(() => __sim.recovery())');
  await delay(2200);
  assert.equal(
    await closeCalls(),
    0,
    "the recovery code screen never closes (the code must be saved)",
  );
  await run("__sim.done()");
  await waitFor(
    () => run("__closeCalls.length === 1"),
    "closeSetupTab after the done screen",
    6000,
  );
  const waited = await run("__closeCalls[0] - __doneAt");
  assert.ok(
    waited >= 1400 && waited < 4000,
    `closed after a visible delay (${waited} ms)`,
  );
  await delay(2000);
  assert.equal(await closeCalls(), 1, "asks once");

  smoke.step("join success (done screen after connecting) closes too");
  await open();
  await run("__sim.connecting()");
  await run('__sim.writeVault("joined").then(() => __sim.done())');
  await waitFor(
    () => run("__closeCalls.length === 1"),
    "closeSetupTab after a join",
    6000,
  );

  smoke.step("done screen gone before the delay ends: stays open");
  await open();
  await run('__sim.writeVault("restored").then(() => __sim.done())');
  await delay(400);
  await run("__sim.form()");
  await delay(2200);
  assert.equal(
    await closeCalls(),
    0,
    "no close once the done screen went away",
  );

  smoke.step("?screen=import keeps its tab");
  await open("?screen=import");
  assert.equal(await run("window.__surffishBrambleSetupClose"), true);
  await run('__sim.writeVault("imported").then(() => __sim.done())');
  await delay(2500);
  assert.equal(
    await closeCalls(),
    0,
    "import/restore screens never auto-close",
  );
  win.destroy();
}

// Phases open and close their own windows; closing one must not quit the smoke.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    await phaseFixture();
    await phaseExtension();
    await phaseSetupClose();
    smoke.step("ok");
    await smoke.removeProfile(root);
    app.exit(0);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  }
});
