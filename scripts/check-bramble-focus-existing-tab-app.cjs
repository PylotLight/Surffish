// Full-app check: Bramble's popup "Create your vault" (runtime.openOptionsPage) opens the setup tab,
// and when that tab is already open, switches to it (and focuses its window) instead of doing
// nothing, also when a Settings panel covers the page or the tab is in another window. Not in CI (needs the Bramble build, like check-bramble-poc.ts). Run the production build first:
//   bun run build && electron scripts/check-bramble-focus-existing-tab-app.cjs <unpacked bramble_firefox_X.zip dir>
//   (headless Linux: xvfb-run -a electron --no-sandbox scripts/check-bramble-focus-existing-tab-app.cjs <dir>)
"use strict";
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, BrowserWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const dist = resolve(
  process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("-"))
    .at(-1) || "",
);
const root = join(tmpdir(), `surffish-bramble-focus-tab-app-${process.pid}`);
const userData = join(root, "user-data");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

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
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
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

  const popupWindow = () =>
    BrowserWindow.getAllWindows().find(
      (win) =>
        !win.isDestroyed() &&
        win.isVisible() &&
        win.webContents.getURL().endsWith("/popup.html"),
    );
  const optionsTabs = () =>
    webContents
      .getAllWebContents()
      .filter(
        (contents) =>
          !contents.isDestroyed() &&
          contents.getURL().startsWith("chrome-extension://") &&
          contents.getURL().includes("/options.html"),
      );
  const tabs = () => evaluate(toolbar, "window.api.browser.tabs.get()");
  const activeTab = async () => (await tabs()).find((tab) => tab.active);
  const popupLog = [];
  const clickCreate = async (from = toolbar) => {
    await evaluate(from, "window.api.browser.bramble.open()");
    const popup = await waitFor(popupWindow, "the Bramble popup", 15000);
    popup.webContents.on("console-message", (details) =>
      popupLog.push(details.message),
    );
    await waitFor(
      () =>
        evaluate(
          popup.webContents,
          `[...document.querySelectorAll('button')].some((b) => /create your vault/i.test(b.textContent))`,
        ),
      'the "Create your vault" button',
      30000,
    );
    await evaluate(
      popup.webContents,
      `[...document.querySelectorAll('button')].find((b) => /create your vault/i.test(b.textContent)).click(); true`,
    );
    return popup;
  };

  // 1. Fresh: no setup tab yet, the button opens one and the popup closes (also over open Settings).
  assert.equal(optionsTabs().length, 0);
  await evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "integrations" })',
  );
  await clickCreate();
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.chrome.get()"))
        .sidebarMode === "tabs",
    "Settings to close so the new setup tab shows",
    5000,
  );
  await waitFor(
    () => optionsTabs().length === 1,
    "the setup tab to open",
    15000,
  );
  await waitFor(
    async () => /options\.html/.test((await activeTab())?.url || ""),
    "the setup tab to be active",
  );
  await waitFor(() => !popupWindow(), "the popup to close");
  smoke.step('fresh: "Create your vault" opened the setup tab');

  // 2. Setup tab open but in the background: the button switches back to it.
  await evaluate(toolbar, 'window.api.browser.tabs.create("about:blank")');
  await waitFor(
    async () => !/options\.html/.test((await activeTab())?.url || ""),
    "another tab to be active",
  );
  await clickCreate();
  await waitFor(
    async () => /options\.html/.test((await activeTab())?.url || ""),
    "the existing setup tab to be active again",
    15000,
  );
  await waitFor(() => !popupWindow(), "the popup to close");
  assert.equal(optionsTabs().length, 1, "no second setup tab");
  smoke.step('existing: "Create your vault" switched to the open setup tab');

  // 2b. Settings covering the page (e.g. right after installing Bramble from Settings → Integrations).
  await evaluate(toolbar, 'window.api.browser.tabs.create("about:blank")');
  await evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "integrations" })',
  );
  await clickCreate();
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.chrome.get()"))
        .sidebarMode === "tabs",
    "Settings to close so the setup tab shows",
    5000,
  );
  await waitFor(
    async () => /options\.html/.test((await activeTab())?.url || ""),
    "the setup tab to be active",
  );
  await waitFor(() => !popupWindow(), "the popup to close");
  assert.equal(optionsTabs().length, 1, "no second setup tab");
  smoke.step("settings open: Settings closed and the setup tab shows");

  // 3. Setup tab open in another window: that window comes forward with the tab active.
  await evaluate(toolbar, "window.api.browser.tabs.newWindow(false)");
  const second = await waitFor(
    () =>
      BaseWindow.getAllWindows().find(
        (win) =>
          win !== mainWindow &&
          !win.isDestroyed() &&
          win.contentView &&
          win.contentView.children.length > 0,
      ),
    "a second window",
  );
  const secondSurface = (name) =>
    second.contentView.children.find(
      (view) =>
        view.webContents &&
        !view.webContents.isDestroyed() &&
        surfaceFor(view) === name,
    );
  await waitFor(() => secondSurface("toolbar"), "the second window toolbar");
  const secondToolbar = secondSurface("toolbar").webContents;
  await waitFor(
    () =>
      evaluate(
        secondToolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the second toolbar renderer",
  );
  second.focus();
  await waitFor(
    () => second.isFocused(),
    "the second window to be focused",
    10000,
  );
  assert.equal(mainWindow.isFocused(), false);
  await clickCreate(secondToolbar);
  await waitFor(
    () =>
      mainWindow.isFocused() || BaseWindow.getFocusedWindow() === mainWindow,
    "the setup tab’s window to be focused",
    10000,
  );
  await waitFor(
    async () => /options\.html/.test((await activeTab())?.url || ""),
    "the setup tab to stay active in its window",
  );
  assert.equal(optionsTabs().length, 1, "still one setup tab");
  smoke.step("other window: the setup tab’s window was focused");
  if (popupLog.some((line) => /error/i.test(line)))
    console.log("popup console:", popupLog.join("\n"));
  console.log("BRAMBLE FOCUS EXISTING TAB APP CHECK PASSED");
}

run()
  .then(
    () => app.exit(0),
    (error) => {
      console.error(
        "BRAMBLE FOCUS EXISTING TAB APP CHECK FAILED:",
        error && error.stack ? error.stack : error,
      );
      app.exit(1);
    },
  )
  .finally(() => smoke.removeProfile?.(root));
