// Native Electron window fullscreen must show only page content; page HTML/video fullscreen stays separate.
// Run after `bun run build`: `bun run test:electron-native-fullscreen` (headless Linux: prefix with `xvfb-run -a`).
"use strict";

const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-native-fullscreen-${process.pid}`);
const fixtureTitle = "Native fullscreen fixture";
const server = createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>${fixtureTitle}</title>
    <style>html,body{margin:0;min-height:100%;font:20px system-ui;background:#245b54;color:white}#fullscreen{position:absolute;top:12px;left:12px;padding:14px}</style>
    <button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Enter page fullscreen</button>
    <main style="padding:100px 24px">Page content fills the native fullscreen window.</main>`);
});
let mainWindow;
let fixturePage;

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

function views() {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  return mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
}

function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}

function surface(name) {
  return views().find((view) => surfaceFor(view) === name);
}

function visibleChildLayers() {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  return mainWindow.contentView.children
    .filter((view) => view.getVisible())
    .map((view) => {
      if (view === fixturePage) return "live-page";
      const name = surfaceFor(view);
      if (name) return `app:${name}`;
      return view.webContents
        ? `page:${view.webContents.getURL()}`
        : "native-view";
    });
}

async function evaluate(view, source) {
  assert.ok(view?.webContents && !view.webContents.isDestroyed());
  return smoke.evaluate(view.webContents, source);
}

const chromeState = `(() => {
  const shell = document.querySelector('.app-shell')
  const chrome = document.querySelector('.browser-chrome')
  return {
    fullscreen: shell?.dataset.fullscreen === 'true',
    nativeFullscreen: shell?.dataset.nativeFullscreen === 'true',
    display: chrome ? getComputedStyle(chrome).display : null,
    visibility: chrome ? getComputedStyle(chrome).visibility : null,
    transform: chrome ? getComputedStyle(chrome).transform : null,
  }
})()`;

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main browser window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "all renderer surfaces",
  );
  const toolbar = surface("toolbar");
  const content = surface("content");
  const sidebar = surface("sidebar");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );

  smoke.step("load a local page fixture");
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`,
  );
  fixturePage = await waitFor(
    () =>
      views().find((view) => view.webContents.getURL().includes("/fixture")),
    "the fixture page view",
  );
  await waitFor(
    () =>
      !fixturePage.webContents.isLoading() &&
      fixturePage.webContents.getTitle() === fixtureTitle &&
      fixturePage.getVisible(),
    "the fixture page to load and become visible",
  );
  assert.equal(mainWindow.isFullScreen(), false);
  assert.equal((await evaluate(toolbar, chromeState)).fullscreen, false);
  assert.equal((await evaluate(toolbar, chromeState)).nativeFullscreen, false);
  assert.equal(toolbar.getVisible(), true);

  smoke.step(
    "enter native window fullscreen and verify all renderer chrome is hidden",
  );
  mainWindow.setFullScreen(true);
  await waitFor(
    async () =>
      mainWindow.isFullScreen() &&
      (await evaluate(toolbar, chromeState)).fullscreen &&
      (await evaluate(toolbar, chromeState)).nativeFullscreen,
    "native fullscreen state to reach the toolbar renderer",
  );
  await waitFor(
    () => !toolbar.getVisible(),
    "the separate toolbar overlay to be removed during native fullscreen",
  );
  await waitFor(
    () => !sidebar.getVisible(),
    "the separate sidebar overlay to be removed during native fullscreen",
  );
  await waitFor(() => {
    const layers = visibleChildLayers();
    return layers.length === 1 && layers[0] === "live-page" ? layers : false;
  }, "the actual visible child-view stack to contain only the live page");
  for (const [name, view] of [
    ["content", content],
    ["toolbar", toolbar],
    ["sidebar", sidebar],
  ]) {
    assert.deepEqual(
      await evaluate(view, "window.api.browser.getWindowFullscreenState()"),
      { windowFullscreen: true, nativeFullscreen: true },
      `${name} renderer receives native fullscreen state from main`,
    );
  }
  assert.equal(
    content.getVisible(),
    false,
    "the duplicate content renderer is hidden",
  );
  assert.equal(fixturePage.getVisible(), true, "the page remains visible");
  const toolbarChrome = await evaluate(toolbar, chromeState);
  assert.deepEqual(toolbarChrome, {
    fullscreen: true,
    nativeFullscreen: true,
    display: "none",
    visibility: "visible",
    transform: "none",
  });
  const contentChrome = await evaluate(content, chromeState);
  assert.equal(contentChrome.fullscreen, true);
  assert.equal(contentChrome.nativeFullscreen, true);
  assert.equal(contentChrome.display, "none");
  assert.equal(
    await evaluate(
      sidebar,
      "getComputedStyle(document.querySelector('.browser-sidebar')).display",
    ),
    "none",
  );

  smoke.step("leave native fullscreen and restore normal toolbar");
  mainWindow.setFullScreen(false);
  await waitFor(
    async () =>
      !mainWindow.isFullScreen() &&
      !(await evaluate(toolbar, chromeState)).fullscreen &&
      !(await evaluate(toolbar, chromeState)).nativeFullscreen &&
      toolbar.getVisible(),
    "normal window chrome to return after native fullscreen",
  );
  assert.notEqual((await evaluate(toolbar, chromeState)).display, "none");

  smoke.step(
    "verify page HTML fullscreen does not activate native chrome hiding",
  );
  fixturePage.webContents.focus();
  fixturePage.webContents.sendInputEvent({
    type: "mouseDown",
    x: 70,
    y: 35,
    button: "left",
    clickCount: 1,
  });
  fixturePage.webContents.sendInputEvent({
    type: "mouseUp",
    x: 70,
    y: 35,
    button: "left",
    clickCount: 1,
  });
  await waitFor(
    () =>
      smoke.evaluate(
        fixturePage.webContents,
        "Boolean(document.fullscreenElement)",
      ),
    "the fixture page to enter HTML fullscreen",
  );
  await waitFor(async () => {
    const state = await evaluate(toolbar, chromeState);
    return (
      !state.nativeFullscreen &&
      toolbar.getVisible() &&
      state.display !== "none"
    );
  }, "website fullscreen to keep the native-only chrome hide inactive");
  assert.equal((await evaluate(toolbar, chromeState)).nativeFullscreen, false);
  assert.notEqual((await evaluate(toolbar, chromeState)).display, "none");
  await smoke.evaluate(fixturePage.webContents, "document.exitFullscreen()");
  await waitFor(
    async () =>
      !(await smoke.evaluate(
        fixturePage.webContents,
        "Boolean(document.fullscreenElement)",
      )),
    "the fixture page to leave HTML fullscreen",
  );
  await waitFor(async () => {
    const state = await evaluate(toolbar, chromeState);
    return !state.nativeFullscreen && toolbar.getVisible();
  }, "the toolbar to remain available after website fullscreen");

  console.log("Electron native fullscreen smoke passed.");
}

run().then(
  () => {
    server.close();
    smoke.removeProfile(userData);
    app.exit(0);
  },
  (error) => {
    console.error("Electron native fullscreen smoke failed:", error);
    server.close();
    smoke.removeProfile(userData);
    app.exit(1);
  },
);
