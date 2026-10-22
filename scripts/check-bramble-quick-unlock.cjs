// Real-Bramble check for Surffish's quick unlock and the storage.onChanged relay. Not part of CI
// (it needs a Bramble Firefox build, like check-bramble-poc.ts). Usage:
//   electron scripts/check-bramble-quick-unlock.cjs <unpacked bramble_firefox_X.zip directory>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-quick-unlock.cjs <dir>)
// Set BRAMBLE_ADAPTER=<path to another bramble-poc-adapter.ts> to stage with a different shim
// (e.g. origin/main's, to reproduce the late auto-lock bug without the relay).
// Steps: stage + load Bramble; create a vault through Bramble's own setup form (filled the way
// quick unlock fills); check the detector says "other" on setup; change pref.autoLockMinutes from
// a page and read Bramble's vault:autolock alarm (relay check); lock; open popup.html and check the
// detector says "unlock"; fill a wrong password (expect "rejected"); fill the PIN-unwrapped right
// one (expect "unlocked").
"use strict";
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const dist = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("-"))
  .at(-1);
const repo = resolve(__dirname, "..");
const MASTER = "correct horse battery staple – long master password 🐟";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const world = 1977;

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

app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async () => {
  const temporary = mkdtempSync(
    join(tmpdir(), "surffish-bramble-quick-unlock-"),
  );
  let code = 0;
  try {
    assert.ok(dist, "pass the unpacked Bramble Firefox build directory");
    const adapter = await import(
      process.env.BRAMBLE_ADAPTER ||
        join(repo, "src/main/bramble-poc-adapter.ts")
    );
    const shared = await import(
      join(repo, "src/shared/bramble-quick-unlock.ts")
    );
    const crypto = await import(
      join(repo, "src/main/bramble-quick-unlock-crypto.ts")
    );
    const staged = adapter.stageBrambleFirefoxBuild(
      resolve(dist),
      join(temporary, "extension"),
    );
    const ses = session.fromPartition(
      `persist:bramble-quick-unlock-check-${process.pid}-${Date.now()}`,
    );
    const extension = await ses.extensions.loadExtension(
      staged.stagedDirectory,
    );
    if (process.env.CHECK_DEBUG)
      ses.serviceWorkers.on("console-message", (_e, d) =>
        console.log("[sw]", d.message || JSON.stringify(d)),
      );
    const webPreferences = {
      session: ses,
      contextIsolation: true,
      sandbox: true,
    };
    const offscreen = new BrowserWindow({ show: false, webPreferences });
    await offscreen.loadURL(`${extension.url}offscreen.html`);
    const snapshot = (win) =>
      win.webContents.executeJavaScriptInIsolatedWorld(world, [
        { code: shared.UNLOCK_SNAPSHOT_SCRIPT },
      ]);
    const fill = (win, secret) =>
      win.webContents.executeJavaScriptInIsolatedWorld(world, [
        { code: shared.buildUnlockFillScript(secret) },
      ]);

    // 1. Create a vault through Bramble's real setup form.
    const options = new BrowserWindow({
      show: true,
      width: 900,
      height: 900,
      webPreferences,
    });
    await options.loadURL(`${extension.url}options.html`);
    await waitFor(
      () =>
        options.webContents.executeJavaScript(
          `!!document.querySelector('input[name="confirmPassword"]')`,
        ),
      "Bramble setup form",
    );
    assert.equal(
      shared.classifyBrambleUnlockScreen(
        await snapshot(options),
        extension.url,
      ),
      "other",
      "setup (two password fields) must not look like the unlock screen",
    );
    const setupFilled =
      await options.webContents.executeJavaScriptInIsolatedWorld(world, [
        {
          code: `(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const name of ['masterPassword', 'confirmPassword']) {
        const input = document.querySelector('input[name="' + name + '"]');
        setter.call(input, ${JSON.stringify(MASTER)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const submit = document.querySelector('button[type="submit"]');
      submit.form.requestSubmit(submit);
      return true;
    })()`,
        },
      ]);
    assert.equal(setupFilled, true);
    const afterSetup = await waitFor(
      async () => {
        const done = await options.webContents.executeJavaScript(
          `!document.querySelector('input[name="confirmPassword"]')`,
        );
        return done
          ? options.webContents.executeJavaScript("document.body.innerText")
          : null;
      },
      "vault creation",
      60000,
    );
    // Bramble shows the recovery code once; acknowledge it like a user would.
    const acknowledged = await options.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => /saved it/i.test(b.textContent || ''));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    console.log("recovery code acknowledged:", acknowledged);
    await delay(1500);
    console.log(
      "options now:",
      (await options.webContents.executeJavaScript("document.body.innerText"))
        .slice(0, 200)
        .replace(/\n+/g, " | "),
    );
    console.log(
      "vault created; screen:",
      afterSetup.split("\n").slice(0, 3).join(" | "),
    );

    // 2. storage.onChanged relay: a page changes the auto-lock timeout while unlocked.
    const unlocked = await options.webContents.executeJavaScript(
      `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_IS_LOCKED' }, (r) => done(r)))`,
    );
    console.log("CRYPTO_IS_LOCKED ->", JSON.stringify(unlocked));
    const alarmBefore = await options.webContents.executeJavaScript(
      `chrome.alarms.get('vault:autolock').then((a) => a ? a.scheduledTime : null)`,
    );
    const changedAt = Date.now();
    await options.webContents.executeJavaScript(
      `chrome.storage.local.set({ 'pref.autoLockMinutes': 1 }).then(() => true)`,
    );
    let alarmAfter = null;
    try {
      alarmAfter = await waitFor(
        async () => {
          const time = await options.webContents.executeJavaScript(
            `chrome.alarms.get('vault:autolock').then((a) => a ? a.scheduledTime : null)`,
          );
          return time && time - changedAt < 90_000 ? time : null;
        },
        "the auto-lock alarm to move to ~1 minute",
        6000,
      );
    } catch (error) {
      console.log("RELAY: alarm did not move:", error.message);
    }
    const relayOk = alarmAfter !== null;
    console.log(
      `RELAY ${relayOk ? "OK" : "MISSING"}: vault:autolock before ${alarmBefore ? Math.round((alarmBefore - changedAt) / 1000) + "s" : "none"}, after ${alarmAfter ? Math.round((alarmAfter - changedAt) / 1000) + "s" : "unchanged"}`,
    );
    if (process.env.EXPECT_RELAY !== "0")
      assert.ok(
        relayOk,
        "the auto-lock alarm should be rescheduled as soon as the pref changes",
      );

    // 3. Lock, open the popup: the detector must find Bramble's unlock form.
    await options.webContents.executeJavaScript(
      `new Promise((done) => chrome.runtime.sendMessage({ type: 'CRYPTO_LOCK' }, (r) => done(r)))`,
    );
    options.close();
    const popup = new BrowserWindow({
      show: true,
      width: 500,
      height: 550,
      webPreferences,
    });
    await popup.loadURL(`${extension.url}popup.html`);
    try {
      await waitFor(
        async () =>
          shared.classifyBrambleUnlockScreen(
            await snapshot(popup),
            extension.url,
          ) === "unlock",
        "the popup unlock screen",
      );
    } catch (error) {
      console.log(
        "popup snapshot:",
        JSON.stringify(await snapshot(popup)),
        "\ntext:",
        (
          await popup.webContents.executeJavaScript("document.body.innerText")
        ).slice(0, 500),
      );
      throw error;
    }
    console.log("detector: popup unlock screen found");

    // 4. A wrong password is reported back as rejected.
    assert.equal(await fill(popup, "not the master password"), true);
    const wrong = await waitFor(
      async () => {
        const outcome = shared.classifyFillOutcome(
          await snapshot(popup),
          extension.url,
        );
        return outcome === "pending" ? null : outcome;
      },
      "Bramble to reject the wrong password",
      30000,
    );
    assert.equal(wrong, "rejected");
    console.log("wrong password -> rejected");

    // 5. PIN unwrap + fill the real one: Bramble unlocks.
    const deviceKey = crypto.generateDeviceKey();
    const blob = await crypto.wrapWithPin(
      Buffer.from(MASTER, "utf8"),
      "482916",
      deviceKey,
    );
    assert.equal(await crypto.unwrapWithPin(blob, "000000", deviceKey), null);
    const secret = await crypto.unwrapWithPin(blob, "482916", deviceKey);
    await waitFor(
      async () =>
        shared.classifyBrambleUnlockScreen(
          await snapshot(popup),
          extension.url,
        ) === "unlock",
      "the unlock form to be ready again",
    );
    assert.equal(await fill(popup, secret.toString("utf8")), true);
    secret.fill(0);
    const right = await waitFor(
      async () => {
        const outcome = shared.classifyFillOutcome(
          await snapshot(popup),
          extension.url,
        );
        return outcome === "pending" ? null : outcome;
      },
      "Bramble to unlock",
      30000,
    );
    assert.equal(right, "unlocked");
    const text = await popup.webContents.executeJavaScript(
      "document.body.innerText",
    );
    console.log(
      "right password -> unlocked; popup now shows:",
      text.split("\n").slice(0, 3).join(" | "),
    );
    console.log("CHECK PASSED");
  } catch (error) {
    code = 1;
    console.error("CHECK FAILED:", error && error.stack ? error.stack : error);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
    app.exit(code);
  }
});
