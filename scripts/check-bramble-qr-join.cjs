// Real-Bramble check for Surffish's "Scan QR" on the Join a device form. Not part of CI (it needs a
// Bramble Firefox build, like the other check-bramble-* scripts). Usage, after `bun run build`:
//   electron scripts/check-bramble-qr-join.cjs <unpacked bramble_firefox_X.zip directory>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-qr-join.cjs <dir>)
// Stages Bramble the way Surffish does (adapter + addBrambleQrJoin), feeds Chromium's fake camera a
// pairing QR, opens options.html → Join a device, clicks Scan QR and checks Bramble's own React form
// took the code: submitting with a master password must get past Bramble's "Paste the pairing code"
// check (it then tries to reach the fake code's relay, which is fine).
// CHECK_SCREENSHOT_DIR=<dir> saves the form before the scan and after the fill.
"use strict";
const { app, BrowserWindow, nativeImage, session } = require("electron");
const assert = require("node:assert/strict");
const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const dist = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("-"))
  .at(-1);
const repo = resolve(__dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "surffish-bramble-qr-check-"));
const fakeVideo = join(temporary, "qr.y4m");
const PAIRING_PNG = join(repo, "scripts/fixtures/bramble-pairing-qr.png");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-video-capture", fakeVideo);
app.commandLine.appendSwitch("disable-gpu");

async function waitFor(fn, what, ms = 30000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await delay(150);
  }
  throw new Error(
    `timed out waiting for ${what} (last: ${last && last.message ? last.message : JSON.stringify(last)})`,
  );
}

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

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  let code = 0;
  try {
    assert.ok(dist, "pass the unpacked Bramble Firefox build directory");
    writeFakeCameraVideo();
    const adapter = await import(join(repo, "src/main/bramble-poc-adapter.ts"));
    const staged = adapter.stageBrambleFirefoxBuild(
      resolve(dist),
      join(temporary, "extension"),
    );
    const jsqr = join(repo, "out/vendor/jsqr.min.js");
    adapter.addBrambleQrJoin(
      staged.stagedDirectory,
      readFileSync(join(repo, "src/shared/bramble-qr-join-page.cjs"), "utf8"),
      existsSync(jsqr) ? readFileSync(jsqr, "utf8") : null,
    );
    const ses = session.fromPartition(
      `persist:bramble-qr-check-${process.pid}`,
    );
    const extension = await ses.extensions.loadExtension(
      staged.stagedDirectory,
    );
    const media = [];
    ses.setPermissionCheckHandler(
      (_contents, permission, origin, details) =>
        permission === "media" &&
        origin.startsWith(extension.url.slice(0, -1)) &&
        details.mediaType === "video",
    );
    ses.setPermissionRequestHandler(
      (_contents, permission, callback, details) => {
        if (permission === "media") media.push(details.mediaTypes);
        callback(
          permission === "media" &&
            String(details.requestingUrl).startsWith(extension.url) &&
            (details.mediaTypes || []).every((type) => type === "video"),
        );
      },
    );
    const webPreferences = {
      session: ses,
      contextIsolation: true,
      sandbox: true,
    };
    const offscreen = new BrowserWindow({ show: false, webPreferences });
    await offscreen.loadURL(`${extension.url}offscreen.html`);
    const win = new BrowserWindow({
      show: true,
      width: 900,
      height: 1000,
      webPreferences,
    });
    const run = (js) => win.webContents.executeJavaScript(js);
    const shot = async (name) => {
      if (process.env.CHECK_SCREENSHOT_DIR)
        writeFileSync(
          join(process.env.CHECK_SCREENSHOT_DIR, name),
          (await win.webContents.capturePage()).toPNG(),
        );
    };
    await win.loadURL(`${extension.url}options.html`);
    await waitFor(
      () =>
        run(
          `(() => { const b = [...document.querySelectorAll('button')].find((x) => /join a device/i.test(x.textContent || '')); if (!b) return false; b.click(); return true })()`,
        ),
      "Join a device tab",
    );
    await waitFor(
      () =>
        run(
          `!!document.querySelector('[data-surffish-qr="pairing"]') && !!document.querySelector('[data-surffish-qr="password"]')`,
        ),
      "Scan buttons on the real Join a device form",
    );
    console.log(
      "scan buttons placed under the real pairing code box and master password field",
    );
    await delay(300);
    await shot("1-join-form.png");
    await run(
      `document.querySelector('[data-surffish-qr="pairing"]').shadowRoot.querySelector('button[part="scan"]').click()`,
    );
    const filled = await waitFor(
      () => run(`document.getElementById('pairing-code').value`),
      "pairing code from the fake camera",
      30000,
    );
    assert.ok(filled.startsWith("bramble-pair-1."), filled.slice(0, 40));
    assert.deepEqual(media, [["video"]], "asked for the camera only");
    console.log(
      "pairing code filled from the camera QR; camera asked for video only",
    );
    await delay(300);
    await shot("2-filled.png");
    // Master password through the same native-setter path, then submit: React must hold the code.
    await run(
      `(() => { const input = document.querySelector('form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'x'.repeat(16)); input.dispatchEvent(new Event('input', { bubbles: true })); const submit = [...document.querySelectorAll('button[type="submit"]')].pop(); submit.form.requestSubmit(submit) })()`,
    );
    await delay(1500);
    const text = await run("document.body.innerText");
    assert.ok(
      !/Paste the pairing code from your other device/.test(text),
      "Bramble saw an empty code: React did not take the fill",
    );
    console.log(
      `Bramble accepted the code (screen now: ${text.replace(/\s+/g, " ").slice(0, 120)})`,
    );
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    code = 1;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    app.exit(code);
  }
});
