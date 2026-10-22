// Full-app check for the Join a device Scan QR: the built Surffish stages Bramble (with the Scan QR
// script), opens Bramble's setup tab, and its real session permission policy (proxy.ts) gives the
// Bramble page the camera for video only. Chromium's fake camera is fed a pairing QR.
// Not in CI (needs the Bramble build, like the other check-bramble-* scripts). Run the build first:
//   bun run build && electron scripts/check-bramble-qr-join-app.cjs <unpacked bramble_firefox_X.zip dir>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-qr-join-app.cjs <dir>)
"use strict";
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, nativeImage, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const dist = resolve(
  process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("-"))
    .at(-1) || "",
);
const root = join(tmpdir(), `surffish-bramble-qr-join-app-${process.pid}`);
const userData = join(root, "user-data");
const fakeVideo = join(root, "qr.y4m");
const PAIRING_PNG = resolve(__dirname, "fixtures/bramble-pairing-qr.png");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
mkdirSync(root, { recursive: true });
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-video-capture", fakeVideo);

async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}
const evaluate = (contents, code) => smoke.evaluate(contents, code);
const surfaceFor = (view) => {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};

function writeFakeCameraVideo() {
  const width = 1280;
  const height = 720;
  const size = 440;
  const bitmap = nativeImage
    .createFromPath(PAIRING_PNG)
    .resize({ width: size, height: size, quality: "best" })
    .toBitmap();
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

async function run() {
  assert.ok(
    existsSync(join(dist, "manifest.json")),
    "pass the unpacked Bramble Firefox build directory",
  );
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] })}\n`,
  );
  process.env.SURFFISH_BRAMBLE_POC_DEV_AUTOLOAD = "1";
  process.env.SURFFISH_BRAMBLE_EXTENSION_DIR = dist;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  writeFakeCameraVideo();
  const mainWindow = await waitFor(
    () =>
      BaseWindow.getAllWindows().find(
        (win) => win.contentView && win.contentView.children.length > 0,
      ),
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 900 });
  const surface = (name) =>
    mainWindow.contentView.children.find(
      (view) =>
        view.webContents &&
        !view.webContents.isDestroyed() &&
        surfaceFor(view) === name,
    );
  await waitFor(
    () => surface("toolbar") && surface("content"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar").webContents;
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const bramble = await waitFor(
    async () => {
      const state = await evaluate(toolbar, "window.api.browser.bramble.get()");
      return state.installed && state;
    },
    "Bramble to load",
    60000,
  );
  smoke.step(`Bramble ${bramble.version} loaded`);

  await evaluate(toolbar, "window.api.browser.bramble.setup()");
  const options = await waitFor(
    () =>
      webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() &&
            /^chrome-extension:\/\/[^/]+\/options\.html/.test(
              contents.getURL(),
            ),
        ),
    "Bramble options tab",
  );
  await waitFor(
    () =>
      evaluate(
        options,
        `(() => { const b = [...document.querySelectorAll('button')].find((x) => /join a device/i.test(x.textContent || '')); if (!b) return false; b.click(); return true })()`,
      ),
    "Join a device tab",
  );
  await waitFor(
    () =>
      evaluate(
        options,
        `!!document.querySelector('[data-surffish-qr="pairing"]')`,
      ),
    "Scan QR on the Join a device form",
  );
  smoke.step("Scan QR is on the staged Join a device form");

  const microphone = await evaluate(
    options,
    `navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return 'granted' }, (e) => e.name)`,
  );
  assert.equal(
    microphone,
    "NotAllowedError",
    "Bramble never gets the microphone",
  );
  smoke.step("microphone refused for Bramble");

  await evaluate(
    options,
    `document.querySelector('[data-surffish-qr="pairing"]').shadowRoot.querySelector('button[part="scan"]').click()`,
  );
  const filled = await waitFor(
    () => evaluate(options, `document.getElementById('pairing-code').value`),
    "pairing code filled from the fake camera",
    30000,
  );
  assert.ok(filled.startsWith("bramble-pair-1."));
  smoke.step("pairing code filled through Surffish’s camera permission policy");
  console.log("BRAMBLE QR JOIN APP CHECK PASSED");
}

run()
  .then(
    () => app.exit(0),
    (error) => {
      console.error(
        "BRAMBLE QR JOIN APP CHECK FAILED:",
        error && error.stack ? error.stack : error,
      );
      app.exit(1);
    },
  )
  .finally(() => smoke.removeProfile?.(root));
