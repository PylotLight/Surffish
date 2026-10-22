// Integration smoke for the Cmd/Ctrl+K command palette, Cmd/Ctrl+Shift+A tab search, the
// palette-off setting and search keywords. Runs the production build:
// `bun run build && bun run test:electron-command-palette`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-command-palette-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(
  tmpdir(),
  `surffish-command-palette-smoke-${process.pid}`,
);
const primary = process.platform === "darwin" ? "meta" : "control";
const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const title =
    request.url === "/second" ? "Second fixture" : "Palette fixture";
  // The page records every Cmd/Ctrl+K it sees, so we can tell who won the shortcut.
  response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><p>palette fixture</p>
<script>window.pageKeys = 0; addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { window.pageKeys += 1; e.preventDefault() } })</script>`);
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

const views = () =>
  mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (name) => views().find((view) => surfaceFor(view) === name);
const pageView = (urlPart) =>
  views().find((view) => view.webContents.getURL().includes(urlPart));

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
}

function key(view, keyCode, modifiers = []) {
  view.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  view.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
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
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixtureUrl = `${origin}/fixture`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  const windowOpenedAt = Date.now();
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar");
  const content = surface("content");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the content renderer",
  );

  // --- focus put in the address bar right after launch stays there: the Tab Overview preload (1.5 s
  // after a window opens) used to take keyboard focus, which closed the palette or ate typing.
  toolbar.webContents.focus();
  await evaluate(
    toolbar,
    'document.querySelector("input[aria-label=\\"Search or enter address\\"]").focus()',
  );
  const addressFocused = () =>
    evaluate(
      toolbar,
      'document.hasFocus() && document.activeElement === document.querySelector("input[aria-label=\\"Search or enter address\\"]")',
    );
  await waitFor(addressFocused, "the address bar to take focus");
  while (Date.now() - windowOpenedAt < 2500) {
    assert.ok(
      await addressFocused(),
      "nothing takes focus away from the address bar while the window settles",
    );
    await delay(100);
  }
  await evaluate(toolbar, "document.activeElement.blur()");

  // --- registry over IPC
  const snapshot = await evaluate(
    toolbar,
    "window.api.browser.commands.list()",
  );
  const ids = snapshot.commands.map((command) => command.id);
  for (const id of [
    "tab.new",
    "tab.newPrivate",
    "tab.reopenClosed",
    "tab.duplicate",
    "tab.pin",
    "tab.mute",
    "nav.find",
    "view.zoomIn",
    "view.history",
    "view.downloads",
    "settings.general",
    "tools.network",
    "tab.copyCleanLink",
    "pdf.toggleEditor",
    "settings.defaultBrowser",
    "view.toggleSidebar",
    "tab.overview",
    "tab.suspendOthers",
  ]) {
    assert.ok(ids.includes(id), `registry has ${id}`);
  }
  assert.equal(
    snapshot.commands.find((command) => command.id === "tab.pin").accelerator,
    "CmdOrCtrl+Shift+P",
    "shortcut comes from TAB_COMMAND_SHORTCUTS",
  );
  assert.equal(
    snapshot.commands.find((command) => command.id === "tab.new").accelerator,
    "CmdOrCtrl+T",
    "shortcut comes from APP_SHORTCUTS",
  );

  // --- palette on the New Tab page (content renderer)
  content.webContents.focus();
  key(content, "K", [primary]);
  await waitFor(
    () =>
      evaluate(content, 'Boolean(document.querySelector("#command-palette"))'),
    "Cmd/Ctrl+K to open the palette on New Tab",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.activeElement === document.querySelector("#command-palette input")',
      ),
    "the New Tab palette field to take focus",
  );
  key(content, "Escape");
  await waitFor(
    async () =>
      !(await evaluate(
        content,
        'Boolean(document.querySelector("#command-palette"))',
      )),
    "Esc to close it",
  );

  // --- navigate to a live page; Cmd/Ctrl+K from inside the page opens the toolbar palette
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`,
  );
  const page = await waitFor(
    () => pageView("/fixture"),
    "the fixture page view",
  );
  await waitFor(
    () =>
      !page.webContents.isLoading() &&
      page.webContents.getTitle() === "Palette fixture",
    "the fixture to load",
  );
  await waitFor(() => page.getVisible(), "the page to be on screen");
  page.webContents.focus();
  key(page, "K", [primary]);
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'Boolean(document.querySelector("#command-palette input"))',
      ),
    "the palette to open from the page",
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.activeElement === document.querySelector("#command-palette input")',
      ),
    "the palette field to take focus",
  );
  assert.equal(
    await evaluate(page, "window.pageKeys"),
    0,
    "the palette wins Cmd/Ctrl+K over the page",
  );
  const paletteHeight = await waitFor(async () => {
    const h = await evaluate(
      toolbar,
      'document.querySelector("#command-palette").getBoundingClientRect().height',
    );
    return h > 200 && h;
  }, "the palette to have its full height");
  assert.ok(paletteHeight > 200);
  const paletteBottom = await evaluate(
    toolbar,
    'document.querySelector("#command-palette").getBoundingClientRect().bottom',
  );
  await waitFor(
    () => toolbar.getBounds().height >= Math.floor(paletteBottom),
    "the toolbar overlay to grow to fit the palette",
  );

  // Type a command, Enter runs it.
  toolbar.webContents.insertText("zoom in");
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector(".command-palette-item.is-selected strong")?.textContent',
      )) === "Zoom In",
    "Zoom In to be the top match",
  );
  const shortcut = await evaluate(
    toolbar,
    'document.querySelector(".command-palette-item.is-selected kbd")?.textContent',
  );
  assert.equal(
    shortcut,
    process.platform === "darwin" ? "⌘=" : "Ctrl+=",
    "the shortcut label shows on the right",
  );
  key(toolbar, "Enter");
  await waitFor(
    () => Math.abs(page.webContents.getZoomFactor() - 1.1) < 0.001,
    "Enter to run Zoom In",
  );
  await waitFor(
    async () =>
      !(await evaluate(
        toolbar,
        'Boolean(document.querySelector("#command-palette"))',
      )),
    "the palette to close after running",
  );
  await waitFor(
    () => page.webContents.isFocused(),
    "focus to return to the page",
  );

  // Recently used commands rank first on an empty query.
  key(page, "K", [primary]);
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector(".command-palette-item strong")?.textContent',
      )) === "Zoom In",
    "the recent command first",
  );
  // Arrow keys move the selection.
  key(toolbar, "Down");
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector(".command-palette-item.is-selected")?.dataset.index',
      )) === "1",
    "Down to move the selection",
  );
  // Keyword search row.
  toolbar.webContents.insertText("yt lofi");
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector(".command-palette-item strong")?.textContent',
      )) === "Search YouTube for “lofi”",
    "the keyword search row",
  );
  // Cmd/Ctrl+K again toggles it closed.
  key(toolbar, "K", [primary]);
  await waitFor(
    async () =>
      !(await evaluate(
        toolbar,
        'Boolean(document.querySelector("#command-palette"))',
      )),
    "Cmd/Ctrl+K to toggle the palette closed",
  );

  // --- Cmd/Ctrl+Shift+A tab search switches tabs
  await evaluate(
    toolbar,
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/second`)})`,
  );
  const second = await waitFor(() => pageView("/second"), "the second tab");
  await waitFor(
    () => second.getVisible() && !second.webContents.isLoading(),
    "the second tab to be active",
  );
  second.webContents.focus();
  key(second, "A", [primary, "shift"]);
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector(".command-palette-scope")?.textContent',
      )) === "Tabs",
    "tab search to open pre-filtered to tabs",
  );
  assert.equal(
    await evaluate(
      toolbar,
      'document.querySelectorAll(".command-palette-item").length',
    ),
    2,
    "only the open tabs are listed",
  );
  toolbar.webContents.insertText("palette fix");
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelectorAll(".command-palette-item").length',
      )) === 1,
    "the query to filter tabs",
  );
  key(toolbar, "Enter");
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).url ===
      fixtureUrl,
    "Enter to switch to the matching tab",
  );
  // main knows about the switch before the toolbar renderer does (tab broadcasts are batched): wait
  // until the switch has fully landed (page focused, bar showing the new tab) before typing in the bar.
  await waitFor(
    () => page.webContents.isFocused(),
    "focus to return to the switched-to page",
  );
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector("input[aria-label=\\"Search or enter address\\"]").value',
      )) === fixtureUrl,
    "the address bar to show the switched-to tab",
  );

  // --- search keywords in the omnibox
  toolbar.webContents.focus();
  await evaluate(
    toolbar,
    'document.querySelector("input[aria-label=\\"Search or enter address\\"]").focus()',
  );
  await delay(100);
  toolbar.webContents.insertText("yt lofi beats");
  await waitFor(
    async () =>
      (await evaluate(
        toolbar,
        'document.querySelector(".keyword-suggestion strong")?.textContent',
      )) === "Search YouTube for “lofi beats”",
    "the omnibox keyword chip",
  );
  key(toolbar, "Escape");
  const custom = await evaluate(
    toolbar,
    "window.api.browser.searchKeywords.get()",
  );
  assert.deepEqual(
    custom.map((engine) => engine.keyword),
    ["g", "d", "b", "yt", "w", "gh", "npm"],
  );
  const badEngine = await evaluate(
    toolbar,
    'window.api.browser.searchKeywords.set([{ id: "x", name: "Bad", keyword: "x", urlTemplate: "http://example.com/?q=%s" }])',
  );
  assert.equal(
    badEngine.ok,
    false,
    "an invalid engine is a validation result, not a thrown IPC error",
  );
  assert.match(badEngine.error, /^Bad: .*https/);
  await evaluate(
    toolbar,
    '(async () => window.api.browser.searchKeywords.set([...(await window.api.browser.searchKeywords.get()), { id: "so", name: "Stack Overflow", keyword: "so", urlTemplate: "https://stackoverflow.com/search?q=%s" }]))()',
  );
  const navigations = [];
  page.webContents.on(
    "did-start-navigation",
    (_event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) navigations.push(url);
    },
  );
  void evaluate(
    toolbar,
    'window.api.browser.navigate("electron ipc !so")',
  ).catch(() => undefined);
  await waitFor(
    () =>
      navigations.some((url) =>
        url.startsWith("https://stackoverflow.com/search?q=electron%20ipc"),
      ),
    "a !bang to route to the custom engine",
  );
  page.webContents.stop();

  // --- Tab Overview: its view is preloaded detached (attaching it while it loads stole keyboard focus
  // from the toolbar ~1.5 s after a window opened) and goes on top of every view when it opens.
  const overviewView = () =>
    views().find((view) =>
      view.webContents.getURL().startsWith("data:text/html"),
    );
  assert.equal(
    overviewView(),
    undefined,
    "the preloaded overview is not attached until it opens",
  );
  await evaluate(toolbar, 'window.api.browser.commands.run("tab.overview")');
  const overview = await waitFor(() => {
    const view = overviewView();
    return view && view.getVisible() && view.getBounds().width > 0 && view;
  }, "the tab overview to open");
  assert.equal(
    views().at(-1),
    overview,
    "the overview sits above every other view",
  );
  await waitFor(
    () => overview.webContents.isFocused(),
    "the overview to take focus",
  );
  // Esc is ignored while the open animation runs, so keep pressing it until the overview closes.
  await waitFor(async () => {
    if (overview.getVisible()) {
      key(overview, "Escape");
      await delay(250);
    }
    return !overview.getVisible() && page.webContents.isFocused();
  }, "Esc to close the overview and refocus the page");

  // --- turning the palette off leaves Cmd/Ctrl+K to the page
  await evaluate(
    toolbar,
    "window.api.browser.commandPalette.setSettings({ enabled: false })",
  );
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(fixtureUrl)})`,
  );
  await waitFor(
    () =>
      !page.webContents.isLoading() && page.webContents.getURL() === fixtureUrl,
    "the fixture to reload",
  );
  await delay(300);
  await waitFor(
    async () =>
      !page.webContents.isLoading() &&
      (await evaluate(
        page,
        'document.readyState === "complete" && window.pageKeys === 0',
      )),
    "the fixture script to be ready",
  );
  page.webContents.focus();
  await waitFor(() => page.webContents.isFocused(), "the page to have focus");
  key(page, "K", [primary]);
  await waitFor(
    async () => (await evaluate(page, "window.pageKeys")) === 1,
    "the page to receive Cmd/Ctrl+K when the palette is off",
  );
  await delay(200);
  assert.equal(
    await evaluate(
      toolbar,
      'Boolean(document.querySelector("#command-palette"))',
    ),
    false,
    "no palette while turned off",
  );

  console.log("Electron command palette smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron command palette smoke failed:", error);
    app.exit(1);
  },
);
