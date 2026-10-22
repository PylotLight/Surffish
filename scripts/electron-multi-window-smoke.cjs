// Integration smoke for multiple windows: the old single-window session migrates, a second window
// opens, a tab moves between windows without reloading (same page process, in-page state kept),
// a tab tears out into a new window, a private window opens private tabs and is never saved,
// closing a window's last tab closes that window, and every normal window comes back on relaunch.
// Runs the production build: `bun run build && bun run test:electron-multi-window`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-multi-window-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const phaseArg = process.argv.find((arg) => arg.startsWith("--phase="));
const phase = phaseArg ? phaseArg.slice("--phase=".length) : "main";
const dirArg = process.argv.find((arg) => arg.startsWith("--user-data="));
const userData = dirArg
  ? dirArg.slice("--user-data=".length)
  : join(tmpdir(), `surffish-multi-window-smoke-${process.pid}`);
const originArg = process.argv.find((arg) => arg.startsWith("--origin="));
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
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}

function viewsOf(win) {
  return win.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
}

function surface(win, name) {
  return viewsOf(win).find((view) => surfaceFor(view) === name);
}

function windows() {
  return BaseWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && surface(win, "toolbar"),
  );
}

// Bounded: a renderer that never answers fails this wait with the call it was stuck on, instead of
// stalling the smoke silently until the 6 min hard limit (as it did on CI, twice in one run).
async function evaluate(view, expression) {
  try {
    return await smoke.evaluate(view.webContents, expression);
  } catch (error) {
    throw Object.assign(
      new Error(`${expression.slice(0, 120)}: ${error.message}`),
      { destroyed: error.destroyed === true },
    );
  }
}
const step = (message) => smoke.step(`${phase}: ${message}`);

async function ready(win) {
  await waitFor(
    () =>
      surface(win, "content") &&
      surface(win, "toolbar") &&
      surface(win, "sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface(win, "toolbar");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  return toolbar;
}

const tabsOf = (win) =>
  evaluate(surface(win, "toolbar"), "window.api.browser.tabs.get()");
const sessionFile = () =>
  JSON.parse(readFileSync(join(userData, "browser-session.json"), "utf8"));

function writeFixtures() {
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
}

async function startApp() {
  app.setPath("userData", userData);
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
}

async function mainPhase() {
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Page ${request.url.slice(1)}</title><p>${request.url}</p>`,
    );
  });
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFixtures();
  // An old single-window session (no `windows` list) with a pinned tab, placed by window-state.json.
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({
      version: 1,
      tabs: [`${origin}/one`, `${origin}/two`],
      activeIndex: 1,
      pinnedTabs: [0],
    }),
  );
  writeFileSync(
    join(userData, "window-state.json"),
    JSON.stringify({
      bounds: { x: 40, y: 40, width: 1000, height: 700 },
      maximized: false,
      fullScreen: false,
    }),
  );
  step("starting the app on an old single-window session");
  await startApp();

  // --- migration: one window with both tabs, the pinned one first, /two active
  const first = await waitFor(() => windows()[0], "the first window");
  const toolbar1 = await ready(first);
  assert.equal(windows().length, 1, "the old session restores as one window");
  let tabs1 = await waitFor(async () => {
    const tabs = await tabsOf(first);
    return tabs.length === 2 ? tabs : null;
  }, "the migrated tabs");
  assert.deepEqual(
    tabs1.map((tab) => tab.url),
    [`${origin}/one`, `${origin}/two`],
  );
  assert.ok(
    tabs1[0].pinned && !tabs1[1].pinned && tabs1[1].active,
    "pinned and active state survive the migration",
  );
  const page = await waitFor(
    () =>
      viewsOf(first).find(
        (view) => view.webContents.getURL() === `${origin}/two`,
      ),
    "the active page",
  );
  await waitFor(
    () => !page.webContents.isLoading() && page.getVisible(),
    "the page to load on screen",
  );
  await evaluate(page, 'window.__notReloaded = "kept"; true');
  const pageContentsId = page.webContents.id;

  // --- a second window (Cmd+N path) opens with one New Tab and becomes the current window
  step("migrated; opening a second window");
  await evaluate(toolbar1, "window.api.browser.tabs.newWindow()");
  const second = await waitFor(
    () => windows().find((win) => win !== first),
    "the second window",
  );
  const toolbar2 = await ready(second);
  const tabs2 = await waitFor(async () => {
    const tabs = await tabsOf(second);
    return tabs.length === 1 ? tabs : null;
  }, "the second window's New Tab");
  assert.equal(tabs2[0].private, false);
  // IPC acts on the sender's window: a tab opened from window 2 lands in window 2.
  await evaluate(
    toolbar2,
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/three`)})`,
  );
  await waitFor(
    async () => (await tabsOf(second)).length === 2,
    "the new tab in window 2",
  );
  assert.equal((await tabsOf(first)).length, 2, "window 1 is untouched");

  // --- move /two from window 1 into window 2 (drop before window 2's first tab): no reload
  step("moving a tab between windows");
  const twoId = tabs1[1].id;
  assert.equal(
    await evaluate(
      toolbar1,
      `window.api.browser.tabs.move(${JSON.stringify(twoId)}, ${JSON.stringify(tabs2[0].id)})`,
    ),
    true,
  );
  await waitFor(
    async () =>
      (await tabsOf(second)).some((tab) => tab.id === twoId && tab.active),
    "the moved tab to be active in window 2",
  );
  await waitFor(
    () => viewsOf(second).includes(page) && page.getVisible(),
    "the moved page view to be on screen in window 2",
  );
  assert.ok(!viewsOf(first).includes(page), "the view left window 1");
  assert.equal(page.webContents.id, pageContentsId, "same web contents");
  assert.equal(
    await evaluate(page, "window.__notReloaded"),
    "kept",
    "the page did not reload",
  );
  tabs1 = await tabsOf(first);
  assert.deepEqual(
    tabs1.map((tab) => tab.url),
    [`${origin}/one`],
    "window 1 keeps its other tab",
  );
  assert.ok(tabs1[0].active, "window 1 picked another tab");
  assert.deepEqual(
    (await tabsOf(second)).map((tab) => tab.id)[0],
    twoId,
    "the tab landed where it was dropped",
  );

  // --- Move to New Window: /three tears out into a third window
  step("tearing a tab out into a new window");
  const threeId = (await tabsOf(second)).find(
    (tab) => tab.url === `${origin}/three`,
  ).id;
  assert.equal(
    await evaluate(
      toolbar2,
      `window.api.browser.tabs.moveToNewWindow(${JSON.stringify(threeId)})`,
    ),
    true,
  );
  const third = await waitFor(
    () => windows().find((win) => win !== first && win !== second),
    "the torn-out window",
  );
  await ready(third);
  await waitFor(async () => {
    const tabs = await tabsOf(third);
    return tabs.length === 1 && tabs[0].id === threeId;
  }, "the torn-out tab in window 3");
  assert.ok(
    !(await tabsOf(second)).some((tab) => tab.id === threeId),
    "the tab left window 2",
  );

  // --- closing the last tab of a window (not the final one) closes the window, no prompt
  step("closing the torn-out window's last tab");
  // Closing the last tab closes this window, toolbar included: its reply can be lost with it.
  await evaluate(
    surface(third, "toolbar"),
    `window.api.browser.tabs.close(${JSON.stringify(threeId)})`,
  ).catch((error) => {
    if (!error.destroyed) throw error;
  });
  await waitFor(
    () => third.isDestroyed(),
    "window 3 to close with its last tab",
  );

  // --- a private window: its tabs are private, and it is never saved
  step("opening a private window");
  await evaluate(toolbar1, "window.api.browser.tabs.newWindow(true)");
  const privateWindow = await waitFor(
    () => windows().find((win) => win !== first && win !== second),
    "the private window",
  );
  const privateToolbar = await ready(privateWindow);
  await waitFor(async () => {
    const tabs = await tabsOf(privateWindow);
    return tabs.length === 1 && tabs[0].private;
  }, "a private New Tab");
  await evaluate(
    privateToolbar,
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/secret`)})`,
  );
  await waitFor(async () => {
    const tabs = await tabsOf(privateWindow);
    return tabs.length === 2 && tabs.every((tab) => tab.private);
  }, "new tabs in it to be private");
  // A normal tab can't move into a private window.
  const oneId = (await tabsOf(first))[0].id;
  const secretId = (await tabsOf(privateWindow)).find(
    (tab) => tab.url === `${origin}/secret`,
  ).id;
  assert.equal(
    await evaluate(
      toolbar1,
      `window.api.browser.tabs.move(${JSON.stringify(oneId)}, ${JSON.stringify(secretId)})`,
    ),
    false,
  );

  // --- the session holds both normal windows (each with its own tabs), never the private one
  step("waiting for the two-window session on disk");
  // Poll on content, not just window count: the first 2-window snapshot can predate the
  // latest debounced write under load.
  const saved = await waitFor(
    () => {
      const value = sessionFile();
      if (!Array.isArray(value.windows) || value.windows.length !== 2)
        return null;
      const urls = value.windows.map((window) => window.tabs);
      if (!urls.some((u) => u.length === 1 && u[0] === `${origin}/one`))
        return null;
      if (!urls.some((u) => u[0] === `${origin}/two`)) return null;
      if (JSON.stringify(value).includes("/secret")) return null;
      return value;
    },
    "the two-window session on disk",
    20000,
  );
  const savedUrls = saved.windows.map((window) => window.tabs);
  assert.ok(
    savedUrls.some((urls) => urls.length === 1 && urls[0] === `${origin}/one`),
    "window 1 saved",
  );
  assert.ok(
    savedUrls.some((urls) => urls[0] === `${origin}/two`),
    "window 2 saved with the moved tab",
  );
  assert.ok(
    !JSON.stringify(saved).includes("/secret"),
    "the private window is not saved",
  );
  assert.ok(
    saved.windows.every((window) => window.bounds && window.bounds.width > 0),
    "window geometry saved",
  );
  const window1Saved = saved.windows.find(
    (window) => window.tabs[0] === `${origin}/one`,
  );
  assert.deepEqual(window1Saved.pinnedTabs, [0], "the pinned tab stays pinned");

  // --- relaunch: both normal windows come back
  step("relaunching (restore phase)");
  app.releaseSingleInstanceLock();
  const exitCode = await new Promise((resolvePromise) => {
    // childEnv: the child's hard limit ends before ours, so a hung restore reports its own state.
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        ...(process.argv.includes("--no-sandbox") ? ["--no-sandbox"] : []),
        __filename,
        "--phase=restore",
        `--user-data=${userData}`,
        `--origin=${origin}`,
      ],
      { stdio: "inherit", env: smoke.childEnv() },
    );
    child.on("exit", (code, signal) => resolvePromise(code ?? signal));
  });
  server.close();
  assert.equal(exitCode, 0, "the restore phase passed");
  smoke.removeProfile(userData);
  console.log("Electron multi-window smoke passed.");
}

async function restorePhase() {
  const origin = originArg.slice("--origin=".length);
  // The parent still has its windows; let it settle its writes first.
  step("starting the app on the saved session");
  await startApp();
  const restored = await waitFor(
    () => (windows().length === 2 ? windows() : null),
    "two restored windows",
  );
  step("two windows restored; waiting for their tabs");
  for (const win of restored) await ready(win);
  const lists = await waitFor(async () => {
    const all = await Promise.all(restored.map((win) => tabsOf(win)));
    return all.every((tabs) => tabs.length > 0) ? all : null;
  }, "the restored tabs");
  const urls = lists.map((tabs) => tabs.map((tab) => tab.url));
  assert.ok(
    urls.some((list) => list.length === 1 && list[0] === `${origin}/one`),
    `window 1 restored (${JSON.stringify(urls)})`,
  );
  assert.ok(
    urls.some((list) => list[0] === `${origin}/two`),
    `window 2 restored with the moved tab (${JSON.stringify(urls)})`,
  );
  assert.ok(
    lists.flat().every((tab) => !tab.private),
    "nothing private restored",
  );
  assert.ok(
    lists.find((tabs) => tabs[0].url === `${origin}/one`)[0].pinned,
    "pinned state restored",
  );
  console.log("Electron multi-window restore phase passed.");
}

const run = phase === "restore" ? restorePhase : mainPhase;
run().then(
  () => app.exit(0),
  (error) => {
    console.error(`Electron multi-window smoke failed (${phase}):`, error);
    app.exit(1);
  },
);
