// Full-app check for the setup tab auto-close (src/shared/bramble-setup-close-page.cjs + bramble-poc.ts
// closeBrambleSetupTab): the built Surffish stages real Bramble, opens its setup tab and makes it the only
// tab of the window, creates a vault through Bramble's own UI (master password -> recovery code ->
// Continue -> "Vault ready"), and the tab closes ~1.5 s later, leaving a New Tab in the same window.
// Then a setup tab opened on the existing vault is left alone.
// Not in CI (needs the Bramble build, like the other check-bramble-* scripts). Run the build first:
//   bun run build && electron scripts/check-bramble-setup-close-app.cjs <unpacked bramble_firefox_X.zip dir>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-setup-close-app.cjs <dir>)
"use strict";
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const dist = resolve(
  process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("-"))
    .at(-1) || "",
);
const root = join(tmpdir(), `surffish-bramble-setup-close-app-${process.pid}`);
const userData = join(root, "user-data");
const PASSWORD = "Surffish-check-correct-horse-battery-staple-7291";
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
mkdirSync(root, { recursive: true });

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
const findOptions = () =>
  webContents
    .getAllWebContents()
    .find(
      (contents) =>
        !contents.isDestroyed() &&
        /^chrome-extension:\/\/[^/]+\/options\.html/.test(contents.getURL()),
    );

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
  const tabs = () => evaluate(toolbar, "window.api.browser.tabs.get()");

  await evaluate(toolbar, "window.api.browser.bramble.setup()");
  const options = await waitFor(findOptions, "Bramble options tab");
  await waitFor(
    async () => (await tabs()).some((tab) => /options\.html/.test(tab.url)),
    "the setup tab in the tab list",
  );
  // Make the setup tab the only tab of the window, so finishing has to swap it for a New Tab.
  for (const tab of await tabs())
    if (!/options\.html/.test(tab.url))
      await evaluate(
        toolbar,
        `window.api.browser.tabs.close(${JSON.stringify(tab.id)})`,
      );
  await waitFor(
    async () => (await tabs()).length === 1,
    "the setup tab to be the only tab",
  );
  smoke.step("setup tab is the only tab");

  await waitFor(
    () =>
      evaluate(
        options,
        `document.querySelectorAll('input[type="password"]').length >= 2`,
      ),
    "the create-vault form",
  );
  await evaluate(
    options,
    `(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    for (const input of document.querySelectorAll('input[type="password"]')) { setter.call(input, ${JSON.stringify(PASSWORD)}); input.dispatchEvent(new Event('input', { bubbles: true })) }
  })()`,
  );
  await waitFor(
    () =>
      evaluate(
        options,
        `(() => { const b = document.querySelector('button[type="submit"]'); if (!b || b.disabled) return false; b.click(); return true })()`,
      ),
    "Create vault",
  );
  await waitFor(
    () =>
      evaluate(
        options,
        `(() => { const b = [...document.querySelectorAll('button')].find((x) => /continue/i.test(x.textContent || '')); if (!b) return false; b.click(); return true })()`,
      ),
    "the recovery code screen",
    60000,
  );
  smoke.step("recovery code shown, Continue pressed");
  const doneAt = await waitFor(
    () =>
      evaluate(
        options,
        `!!document.querySelector('svg.lucide-check') && document.querySelectorAll('button, input').length === 0 && Date.now()`,
      ),
    "the Vault ready screen",
  );
  smoke.step("Vault ready shown");
  await waitFor(
    () => options.isDestroyed() || !findOptions(),
    "the setup tab to close",
    10000,
  );
  const waited = Date.now() - doneAt;
  assert.ok(waited >= 1300, `closed after a visible delay (${waited} ms)`);
  assert.equal(mainWindow.isDestroyed(), false, "the window stays");
  const after = await waitFor(async () => {
    const list = await tabs();
    return list.length >= 1 && list;
  }, "a tab in the window");
  assert.equal(after.length, 1, "one tab left");
  assert.ok(
    !/options\.html/.test(after[0].url),
    `a New Tab took its place (${after[0].url})`,
  );
  smoke.step(
    `setup tab closed ${waited} ms after Vault ready; window kept with a New Tab`,
  );

  // Existing vault: options.html opened again shows "Add a vault"; leaving it there closes nothing.
  await evaluate(toolbar, "window.api.browser.bramble.setup()");
  const again = await waitFor(findOptions, "Bramble options tab again");
  await waitFor(
    () =>
      evaluate(
        again,
        `document.querySelectorAll('input[type="password"]').length >= 2`,
      ),
    "the add-a-vault form",
  );
  await delay(3500);
  assert.equal(
    again.isDestroyed(),
    false,
    "an options tab on an existing vault stays open",
  );
  smoke.step("options tab on an existing vault stays open");
  console.log("BRAMBLE SETUP CLOSE APP CHECK PASSED");
}

run()
  .then(
    () => app.exit(0),
    (error) => {
      console.error(
        "BRAMBLE SETUP CLOSE APP CHECK FAILED:",
        error && error.stack ? error.stack : error,
      );
      app.exit(1);
    },
  )
  .finally(() => smoke.removeProfile?.(root));
