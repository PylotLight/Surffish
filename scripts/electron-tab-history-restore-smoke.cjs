// Back/forward history survives a restart (Chrome-style session restore). Two launches on one profile:
//   save:    tab 1 goes a → b (scrolled down) → c; tab 2 goes x → y and is left in the background; a
//            private tab browses too. Quit the normal way (before-quit freezes the session, will-quit
//            flushes it). Both stores hold the lists (browser-session.json + session_tab_history),
//            owner-only, and nothing from the private tab.
//   restore: tab 1 comes back on c with Back enabled and the hold-Back menu listing b, a; Back lands
//            on b at its old scroll position, Forward returns to c. Tab 2 was restored asleep: opening
//            it wakes it with its list, so Back goes to x.
//   clear:   a new tab goes p -> q -> r. Clear browsing data (last hour, history) takes the visited
//            pages out of every back/forward list: the live tab's Back goes off, the sleeping
//            restored tab wakes with no Back/Forward, and neither store keeps a list longer than the
//            current page. Then s -> t and History → Clear (all time) does the same. Quit.
//   cleared: relaunch: every tab comes back with Back and Forward disabled, no list on disk.
// Runs the production build: `bun run build && bun run test:electron-tab-history-restore`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-tab-history-restore-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const phase = (
  process.argv.find((arg) => arg.startsWith("--phase=")) ?? "--phase=main"
).slice(8);
const userData =
  process.env.SURFFISH_TAB_HISTORY_SMOKE_DIR ||
  join(tmpdir(), `surffish-tab-history-smoke-${process.pid}`);
const port = Number(process.env.SURFFISH_TAB_HISTORY_SMOKE_PORT || 0);
const origin = `http://127.0.0.1:${port}`;
const SCROLL_Y = 1234;
const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  // Tall pages, so a restored scroll position is visible.
  response.end(
    `<!doctype html><meta charset="utf-8"><title>History ${request.url}</title><body style="margin:0"><div style="height:6000px">${request.url}</div>`,
  );
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const step = (text) => process.stderr.write(`[tab-history-restore] ${text}\n`);
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
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}
function sqlite(sql, ...params) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(join(userData, "surffish.db"));
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}
const sessionFile = join(userData, "browser-session.json");

async function launch() {
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
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  const surfaceOf = (contents) => {
    try {
      return new URL(contents.getURL()).searchParams.get("surface");
    } catch {
      return null;
    }
  };
  const toolbar = await waitFor(
    () =>
      mainWindow.contentView.children.find(
        (view) => view.webContents && surfaceOf(view.webContents) === "toolbar",
      ),
    "the toolbar surface",
  );
  await waitFor(
    () =>
      toolbar.webContents.executeJavaScript(
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const api = (expression) => toolbar.webContents.executeJavaScript(expression);
  const state = () => api("window.api.browser.state()");
  const tabs = () => api("window.api.browser.tabs.get()");
  const pageFor = (path) =>
    webContents
      .getAllWebContents()
      .find(
        (contents) =>
          !contents.isDestroyed() &&
          contents.getURL() === `${origin}${path}` &&
          surfaceOf(contents) === null,
      );
  const loaded = (path) =>
    waitFor(
      async () =>
        (await state()).url === `${origin}${path}` &&
        pageFor(path) &&
        !pageFor(path).isLoading() &&
        !(await state()).loading,
      `${path} to load`,
    );
  const navigate = async (path) => {
    await api(
      `window.api.browser.navigate(${JSON.stringify(`${origin}${path}`)})`,
    );
    await loaded(path);
  };
  return { api, state, tabs, pageFor, loaded, navigate };
}

function runPhase(nextPhase, serverPort) {
  const child = spawn(
    process.execPath,
    [
      ...process.argv.slice(1).filter((arg) => !arg.startsWith("--phase")),
      `--phase=${nextPhase}`,
    ],
    {
      env: {
        ...process.env,
        SURFFISH_TAB_HISTORY_SMOKE_DIR: userData,
        SURFFISH_TAB_HISTORY_SMOKE_PORT: String(serverPort),
      },
      stdio: "inherit",
    },
  );
  return new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

async function runSave() {
  const { api, state, tabs, pageFor, navigate } = await launch();
  step("tab 1: a -> b (scrolled) -> c");
  await navigate("/a");
  await navigate("/b");
  await pageFor("/b").executeJavaScript(
    `window.scrollTo(0, ${SCROLL_Y}); window.scrollY`,
  );
  await waitFor(
    async () =>
      (await pageFor("/b").executeJavaScript("window.scrollY")) === SCROLL_Y,
    "b to scroll",
  );
  // Chromium records the scroll offset in the entry's page state when the page is left.
  await delay(300);
  await navigate("/c");
  assert.equal((await state()).canGoBack, true);
  const first = (await tabs()).find((tab) => tab.active).id;

  step("tab 2: x -> y, then back to tab 1 (tab 2 stays in the background)");
  await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/x`)})`);
  await waitFor(
    async () =>
      (await state()).url === `${origin}/x` &&
      pageFor("/x") &&
      !pageFor("/x").isLoading(),
    "/x to load",
  );
  await navigate("/y");
  await api(`window.api.browser.tabs.activate(${JSON.stringify(first)})`);
  await waitFor(
    async () => (await state()).url === `${origin}/c`,
    "tab 1 to be active again",
  );

  step("a private tab browses (never saved)");
  await api(
    `window.api.browser.tabs.createPrivate(${JSON.stringify(`${origin}/private-1`)})`,
  );
  await waitFor(
    () => pageFor("/private-1") && !pageFor("/private-1").isLoading(),
    "the private page",
  );
  await navigate("/private-2");
  await api(`window.api.browser.tabs.activate(${JSON.stringify(first)})`);
  await waitFor(
    async () => (await state()).url === `${origin}/c`,
    "tab 1 active before quitting",
  );

  await waitFor(
    () => sqlite("SELECT count(*) AS n FROM session_tab_history")[0].n === 2,
    "both lists in session_tab_history",
  );
  step("quit (before-quit freezes the session, will-quit flushes it)");
  app.emit("before-quit", { preventDefault() {} });
  app.emit("will-quit", { preventDefault() {} });

  const text = readFileSync(sessionFile, "utf8");
  const json = JSON.parse(text);
  const window = json.windows[0];
  assert.equal(
    statSync(sessionFile).mode & 0o077,
    0,
    "browser-session.json stays owner-only",
  );
  assert.ok(
    Array.isArray(window.histories),
    "browser-session.json has the back/forward lists",
  );
  const index = window.tabs.indexOf(`${origin}/c`);
  const history = window.histories[index];
  assert.deepEqual(
    history.entries.map((entry) => entry.url),
    [`${origin}/a`, `${origin}/b`, `${origin}/c`],
  );
  assert.equal(history.index, 2);
  assert.ok(
    history.entries[1].pageState,
    "b keeps its page state (scroll position)",
  );
  assert.deepEqual(
    window.histories[window.tabs.indexOf(`${origin}/y`)].entries.map(
      (entry) => entry.url,
    ),
    [`${origin}/x`, `${origin}/y`],
  );
  assert.ok(
    !text.includes("private-"),
    "nothing from the private tab in browser-session.json",
  );
  const rows = sqlite(
    "SELECT h.entries, h.active_index, t.url FROM session_tab_history h JOIN session_tabs t ON t.id = h.tab_id WHERE t.deleted_at IS NULL",
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    JSON.parse(rows.find((row) => row.url === `${origin}/c`).entries).map(
      (entry) => entry.url,
    ),
    [`${origin}/a`, `${origin}/b`, `${origin}/c`],
  );
  assert.ok(
    !JSON.stringify(sqlite("SELECT * FROM session_tab_history")).includes(
      "private-",
    ),
    "nothing private in the database",
  );
  const perTab = JSON.stringify(history).length;
  step(
    `browser-session.json is ${text.length} bytes; the a-b-c list is ${perTab} chars (page states ${history.entries.map((entry) => entry.pageState?.length ?? 0).join("/")})`,
  );
  console.log("[tab-history-restore] save phase passed");
}

async function runRestore() {
  const { api, state, tabs, pageFor, loaded } = await launch();
  step("tab 1 restored on c with its history");
  await loaded("/c");
  await waitFor(
    async () => (await state()).canGoBack === true,
    "Back to be enabled on the restored tab",
  );
  assert.equal((await state()).canGoForward, false);
  const menu = await api('window.api.browser.navHistory.list("back")');
  assert.deepEqual(
    menu.entries.map((entry) => entry.url),
    [`${origin}/b`, `${origin}/a`],
    "the hold-Back menu lists the old pages, newest first",
  );
  const second = (await tabs()).find((tab) => tab.url === `${origin}/y`);
  assert.ok(second && second.sleeping, "tab 2 is restored asleep");

  step("Back lands on b at its scroll position, Forward returns to c");
  await api("window.api.browser.back()");
  await loaded("/b");
  await waitFor(
    async () =>
      Math.abs(
        (await pageFor("/b").executeJavaScript("window.scrollY")) - SCROLL_Y,
      ) < 2,
    "b to come back scrolled to where it was",
  );
  assert.equal((await state()).canGoForward, true);
  await api("window.api.browser.forward()");
  await loaded("/c");

  step("tab 2 wakes with its list");
  await api(`window.api.browser.tabs.activate(${JSON.stringify(second.id)})`);
  await loaded("/y");
  await waitFor(
    async () => (await state()).canGoBack === true,
    "Back on the woken tab",
  );
  await api("window.api.browser.back()");
  await loaded("/x");
  console.log("[tab-history-restore] restore phase passed");
}

/** Every saved list (JSON + database) is at most the current page: no Back/Forward survives. */
function assertNoSavedBackForward(label) {
  const json = JSON.parse(readFileSync(sessionFile, "utf8"));
  for (const window of json.windows ?? [])
    for (const history of window.histories ?? []) {
      if (history)
        assert.equal(
          history.entries.length,
          1,
          `${label}: browser-session.json keeps no back/forward entries`,
        );
    }
  for (const row of sqlite("SELECT entries FROM session_tab_history")) {
    assert.equal(
      JSON.parse(row.entries).length,
      1,
      `${label}: session_tab_history keeps no back/forward entries`,
    );
  }
}

async function runClear() {
  const { api, state, tabs, loaded, navigate } = await launch();
  const restored = await tabs();
  const sleeper = restored.find(
    (tab) => tab.sleeping && tab.url === `${origin}/c`,
  );
  assert.ok(sleeper, "tab 1 (a-b-c list) is restored asleep");
  step("new tab: p -> q -> r");
  await api(`window.api.browser.tabs.create(${JSON.stringify(`${origin}/p`)})`);
  await loaded("/p");
  await navigate("/q");
  await navigate("/r");
  assert.equal((await state()).canGoBack, true);
  const live = (await tabs()).find((tab) => tab.active).id;
  await waitFor(
    () =>
      sqlite("SELECT entries FROM session_tab_history").some((row) =>
        row.entries.includes("/q"),
      ),
    "the p-q-r list on disk",
  );

  step("Clear browsing data: last hour, history");
  await api(
    'window.api.browser.safety.privacy.clear({ range: "hour", history: true, downloads: false, cookies: false, cache: false, permissions: false, zoom: false })',
  );
  await waitFor(
    async () => (await state()).canGoBack === false,
    "Back off on the live tab",
  );
  assert.equal((await state()).canGoForward, false);
  // Written at once (no coalescing delay): a crash right after can't bring the pages back.
  assertNoSavedBackForward("after the time-range clear");
  assert.ok(
    !JSON.stringify(sqlite("SELECT entries FROM session_tab_history")).includes(
      `${origin}/a"`,
    ),
    "a is gone from the database",
  );

  step("the sleeping tab wakes with no Back/Forward");
  await api(`window.api.browser.tabs.activate(${JSON.stringify(sleeper.id)})`);
  await loaded("/c");
  await delay(300);
  assert.equal((await state()).canGoBack, false, "no Back on the woken tab");
  assert.equal((await state()).canGoForward, false);

  step("s -> t, then History → Clear (all time)");
  await api(`window.api.browser.tabs.activate(${JSON.stringify(live)})`);
  await loaded("/r");
  await navigate("/s");
  await navigate("/t");
  assert.equal((await state()).canGoBack, true);
  await api("window.api.browser.history.clear()");
  await waitFor(
    async () => (await state()).canGoBack === false,
    "Back off after History → Clear",
  );
  assertNoSavedBackForward("after History → Clear");

  step("quit");
  app.emit("before-quit", { preventDefault() {} });
  app.emit("will-quit", { preventDefault() {} });
  assertNoSavedBackForward("at quit");
  console.log("[tab-history-restore] clear phase passed");
}

async function runCleared() {
  const { api, state, tabs, loaded } = await launch();
  assertNoSavedBackForward("on relaunch");
  for (const tab of await tabs()) {
    const path = new URL(tab.url).pathname;
    step(`${path}: no Back/Forward after relaunch`);
    await api(`window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`);
    await loaded(path);
    await delay(300);
    const now = await state();
    assert.equal(now.canGoBack, false, `${path}: Back disabled`);
    assert.equal(now.canGoForward, false, `${path}: Forward disabled`);
    const menu = await api('window.api.browser.navHistory.list("back")');
    assert.deepEqual(menu.entries, [], `${path}: hold-Back menu empty`);
  }
  console.log("[tab-history-restore] cleared phase passed");
}

async function main() {
  if (phase === "save") return runSave();
  if (phase === "restore") return runRestore();
  if (phase === "clear") return runClear();
  if (phase === "cleared") return runCleared();
  // Orchestrator: serves the pages and runs each launch as its own Electron process.
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const serverPort = server.address().port;
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  for (const next of ["save", "restore", "clear", "cleared"])
    assert.equal(
      await runPhase(next, serverPort),
      0,
      `the ${next} phase passed`,
    );
  console.log("Electron tab history restore smoke passed.");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(
      `Electron tab history restore smoke failed (${phase}):`,
      error,
    );
    app.exit(1);
  },
);
