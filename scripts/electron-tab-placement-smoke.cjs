// Integration smoke for background tab placement: a ⌘-clicked link opens its tab right after
// the active tab (shared/tab-insertion.ts), so related opens stay adjacent to the tab you're in
// instead of piling up at the end of the tab list. Foreground opens still append at the end.
// Runs the production build: `bun run build && bun run test:electron-tab-placement`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-tab-placement-smoke.cjs`).
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

const userData = join(tmpdir(), `surffish-tab-placement-${process.pid}`);
const primary = process.platform === "darwin" ? "meta" : "control";

const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const links =
    request.url === "/"
      ? `<style>body{margin:0;font:18px system-ui}a{display:block;position:absolute;width:220px;height:40px;background:#ddd;text-decoration:none}</style><a id="a" style="left:40px;top:60px" href="/page-a">a</a><a id="b" style="left:40px;top:120px" href="/page-b">b</a>`
      : "";
  response.end(
    `<!doctype html><meta charset="utf-8"><title>${request.url}</title>${links}`,
  );
});

let mainWindow;
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(
  predicate,
  description,
  timeout = Number(process.env.SMOKE_WAIT_MS || 20000),
) {
  const deadline = Date.now() + timeout;
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
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ""}`,
  );
}

function views() {
  return mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
}

function surface(name) {
  return views().find(
    (view) =>
      new URL(view.webContents.getURL()).searchParams.get("surface") === name,
  );
}

function pageView(urlPart) {
  return views().find((view) => view.webContents.getURL().includes(urlPart));
}

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`, {
      cause: error,
    });
  }
}

async function tabs() {
  return evaluate(surface("toolbar"), "window.api.browser.tabs.get()");
}

async function urls() {
  return (await tabs()).map((tab) => tab.url);
}

/** A ⌘-click on the link: Chromium's background-tab disposition, the user's gesture. */
async function cmdClick(page, linkId) {
  const point = await evaluate(
    page,
    `(function () {
      const rect = document.getElementById(${JSON.stringify(linkId)}).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
  const event = {
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: "left",
    clickCount: 1,
    modifiers: [primary],
  };
  page.webContents.sendInputEvent({ type: "mouseDown", ...event });
  page.webContents.sendInputEvent({ type: "mouseUp", ...event });
}

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
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  await waitFor(
    () =>
      evaluate(
        surface("toolbar"),
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );

  smoke.step("navigate the first tab to the fixture");
  await evaluate(
    surface("toolbar"),
    `window.api.browser.navigate(${JSON.stringify(`${origin}/`)})`,
  );
  const page = await waitFor(() => pageView(`${origin}/`), "the fixture page");
  await waitFor(() => !page.webContents.isLoading(), "the fixture to load");
  await waitFor(() => page.getVisible(), "the page to be on screen");
  const [first] = await tabs();
  const home = first.id;

  smoke.step("a foreground tab still appends at the end");
  const c = await evaluate(
    surface("toolbar"),
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/page-c`)})`,
  );
  await waitFor(async () => {
    const list = await tabs();
    return (
      list.length === 2 && list.find((tab) => tab.id === c)?.active === true
    );
  }, "the foreground tab to load and take over");
  assert.deepEqual(
    await urls(),
    [`${origin}/`, `${origin}/page-c`],
    "a foreground tab appends at the end",
  );

  smoke.step("a ⌘-clicked link lands right after the active tab");
  await evaluate(
    surface("toolbar"),
    `window.api.browser.tabs.activate(${JSON.stringify(home)})`,
  );
  await cmdClick(page, "a");
  await waitFor(async () => (await tabs()).length === 3, "the background tab");
  assert.deepEqual(
    await urls(),
    [`${origin}/`, `${origin}/page-a`, `${origin}/page-c`],
    "the background tab opens after the active tab; the other tab stays last",
  );

  smoke.step(
    "consecutive background opens stack after the active tab, in click order",
  );
  await cmdClick(page, "b");
  await waitFor(
    async () => (await tabs()).length === 4,
    "the second background tab",
  );
  assert.deepEqual(
    await urls(),
    [`${origin}/`, `${origin}/page-b`, `${origin}/page-a`, `${origin}/page-c`],
    "the second background open inserts after the active tab, keeping the pair together",
  );
  assert.equal(
    (await tabs()).find((tab) => tab.active)?.url,
    `${origin}/`,
    "background opens never take over the page",
  );

  smoke.step(
    "with the active tab last, the new tab appends (same slot) and nothing moves",
  );
  await evaluate(
    surface("toolbar"),
    `window.api.browser.tabs.move(${JSON.stringify(home)}, null)`,
  );
  await waitFor(
    async () => (await tabs()).find((tab) => tab.id === home)?.active === true,
    "the fixture to be the active tab at the end of the list",
  );
  await cmdClick(page, "a");
  await waitFor(
    async () => (await tabs()).length === 5,
    "the third background tab",
  );
  assert.deepEqual(
    await urls(),
    [
      `${origin}/page-b`,
      `${origin}/page-a`,
      `${origin}/page-c`,
      `${origin}/`,
      `${origin}/page-a`,
    ],
    "a background tab from the last tab appends without disturbing the order",
  );

  console.log("Electron tab-placement smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron tab-placement smoke failed:", error);
    app.exit(1);
  },
);
