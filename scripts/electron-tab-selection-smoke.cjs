// Integration smoke for sidebar multi-select: Ctrl-click (Cmd on macOS) toggles tabs without
// opening them, Shift-click selects a range, the selected rows highlight, right-click on a
// selected tab shows the bulk menu ("Group N Tabs", Add to Group, Pin, Move, Close), Ctrl/Cmd+G
// groups the selection, the palette offers it, and a plain click / Escape clear it.
// Runs the production build: `bun run build && bun run test:electron-tab-selection`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-tab-selection-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, Menu } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-tab-selection-smoke-${process.pid}`);
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const isMac = process.platform === "darwin";
const toggleModifier = isMac ? "meta" : "control";

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

const viewsOf = (win) =>
  win.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (win, name) =>
  viewsOf(win).find((view) => surfaceFor(view) === name);
const windows = () =>
  BaseWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && surface(win, "toolbar"),
  );

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`, {
      cause: error,
    });
  }
}

const api = (win, call) =>
  evaluate(surface(win, "toolbar"), `window.api.browser.${call}`);
const json = (value) => JSON.stringify(value);
const tabsOf = (win) => api(win, "tabs.get()");
const pathOf = (tab) => {
  try {
    return new URL(tab.url).pathname;
  } catch {
    return tab.url;
  }
};

// Popped-up menus since the last reset (the app / dock menus rebuild as tabs change and aren't popped).
let popped = [];
const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  const menu = buildFromTemplate(template);
  menu.popup = () => {
    popped.push(template);
  };
  return menu;
};
const menuWith = (label) =>
  popped.find((template) => template.some((item) => item.label === label));

/** Centre of a sidebar row, in the sidebar view's coordinates. */
async function rowPoint(win, tabId) {
  const rect = await evaluate(
    surface(win, "sidebar"),
    `(() => { const el = document.querySelector('.tab-list [data-browser-tab-id=${json(tabId)}]'); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(60, r.width / 2)), y: Math.round(r.top + r.height / 2) } })()`,
  );
  assert.ok(rect, `row for ${tabId}`);
  return rect;
}

async function click(win, tabId, modifiers = [], button = "left") {
  // The sidebar settles (favicons, titles, sections) after it docks: wait for a stable row.
  let point = await rowPoint(win, tabId);
  for (let tries = 0; tries < 20; tries += 1) {
    await delay(80);
    const next = await rowPoint(win, tabId);
    if (next.x === point.x && next.y === point.y) break;
    point = next;
  }
  const { x, y } = point;
  const contents = surface(win, "sidebar").webContents;
  contents.focus();
  contents.sendInputEvent({ type: "mouseMove", x, y, modifiers });
  contents.sendInputEvent({
    type: "mouseDown",
    x,
    y,
    button,
    clickCount: 1,
    modifiers,
  });
  contents.sendInputEvent({
    type: "mouseUp",
    x,
    y,
    button,
    clickCount: 1,
    modifiers,
  });
  await delay(120);
}

const selectedRows = (win) =>
  evaluate(
    surface(win, "sidebar"),
    '[...document.querySelectorAll(".tab-list .is-multi-selected")].map((el) => el.getAttribute("data-browser-tab-id"))',
  );
/** Main has the renderer's selection (the IPC is async): the palette entry shows the count. */
const mainSees = (win, count) =>
  waitFor(
    async () =>
      (await api(win, "commands.list()")).commands.some(
        (command) =>
          command.id === "group.selected" &&
          command.title === `Group ${count} Selected Tabs`,
      ),
    `main sees ${count} selected`,
  );
const barText = (win) =>
  evaluate(
    surface(win, "sidebar"),
    'document.querySelector(".tab-selection-count")?.textContent ?? null',
  );

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
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({
      version: 1,
      tabs: ["a", "b", "c", "d", "e", "f"].map((name) => `${origin}/${name}`),
      activeIndex: 0,
      pinnedTabs: [],
    }),
  );
  writeFileSync(
    join(userData, "window-state.json"),
    JSON.stringify({
      bounds: { x: 40, y: 40, width: 1200, height: 900 },
      maximized: false,
      fullScreen: false,
    }),
  );
  app.setPath("userData", userData);
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();

  const win = await waitFor(() => windows()[0], "the window");
  await waitFor(
    () => surface(win, "sidebar") && surface(win, "toolbar"),
    "the renderer surfaces",
  );
  await waitFor(
    () =>
      evaluate(
        surface(win, "toolbar"),
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  // Dock the sidebar so its rows are on screen.
  await api(win, "chrome.set({ sidebarMode: 'tabs', sidebarPinned: true })");
  await waitFor(
    () =>
      surface(win, "sidebar").getVisible() &&
      surface(win, "sidebar").getBounds().width > 100,
    "the docked sidebar",
  );
  let tabs = await waitFor(async () => {
    const value = await tabsOf(win);
    return value.length === 6 ? value : null;
  }, "the restored tabs");
  const id = Object.fromEntries(
    tabs.map((tab) => [pathOf(tab).slice(1), tab.id]),
  );
  await waitFor(
    () =>
      evaluate(
        surface(win, "sidebar"),
        `document.querySelectorAll('.tab-list [data-browser-tab-id]').length === 6`,
      ),
    "the sidebar rows",
  );
  await delay(500);

  // --- Ctrl/Cmd-click: the active tab joins, the clicked tab is selected but not opened
  await click(win, id.c, [toggleModifier]);
  await waitFor(
    async () => json(await selectedRows(win)) === json([id.a, id.c]),
    "a + c selected",
  );
  assert.equal(
    (await tabsOf(win)).find((tab) => tab.active).id,
    id.a,
    "Cmd-click did not open the tab",
  );
  assert.equal(await barText(win), "2 tabs selected");

  // --- Shift-click: range from the anchor (c) to e replaces the selection
  await click(win, id.e, ["shift"]);
  await waitFor(
    async () => json(await selectedRows(win)) === json([id.c, id.d, id.e]),
    "c..e selected",
  );
  // --- Ctrl/Cmd-click adds a
  await click(win, id.a, [toggleModifier]);
  await waitFor(
    async () =>
      json(await selectedRows(win)) === json([id.a, id.c, id.d, id.e]),
    "a, c..e selected",
  );
  // The palette offers it while 2+ are selected.
  await mainSees(win, 4);
  if (process.env.SMOKE_SHOT)
    writeFileSync(
      process.env.SMOKE_SHOT,
      (await surface(win, "sidebar").webContents.capturePage()).toPNG(),
    );

  // --- right-click on a selected tab: the bulk menu; Group 4 Tabs
  popped = [];
  await click(win, id.d, [], "right");
  await waitFor(() => menuWith("Group 4 Tabs"), "the multi-select menu");
  const labels = menuWith("Group 4 Tabs")
    .map((item) => item.label)
    .filter(Boolean);
  for (const label of [
    "Group 4 Tabs",
    "Pin 4 Tabs",
    "Move 4 Tabs to New Window",
    "Close 4 Tabs",
    "Clear Selection",
  ])
    assert.ok(
      labels.includes(label),
      `menu has ${label}: ${labels.join(", ")}`,
    );
  menuWith("Group 4 Tabs")
    .find((item) => item.label === "Group 4 Tabs")
    .click();
  tabs = await waitFor(async () => {
    const value = await tabsOf(win);
    return value.filter((tab) => tab.group).length === 4 ? value : null;
  }, "the new group");
  assert.deepEqual(
    tabs.map(pathOf),
    ["/a", "/c", "/d", "/e", "/b", "/f"],
    "the group gathered at its first tab",
  );
  assert.equal(
    new Set(tabs.filter((tab) => tab.group).map((tab) => tab.group.id)).size,
    1,
  );
  await waitFor(
    async () => (await selectedRows(win)).length === 0,
    "selection cleared after grouping",
  );
  const firstGroup = tabs.find((tab) => tab.group).group.id;

  // --- right-click a tab outside the selection: the normal tab menu
  await click(win, id.b, [toggleModifier]);
  await waitFor(
    async () => json(await selectedRows(win)) === json([id.a, id.b]),
    "a + b selected",
  );
  await mainSees(win, 2);
  popped = [];
  await click(win, id.f, [], "right");
  await waitFor(() => menuWith("Close Tab"), "the single-tab menu");

  // --- Escape clears; plain click clears and opens
  surface(win, "sidebar").webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "Escape",
  });
  surface(win, "sidebar").webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "Escape",
  });
  await waitFor(
    async () => (await selectedRows(win)).length === 0,
    "Escape cleared the selection",
  );
  await click(win, id.f, [toggleModifier]);
  await waitFor(
    async () => (await selectedRows(win)).length === 2,
    "a + f selected",
  );
  await click(win, id.b);
  await waitFor(
    async () =>
      (await selectedRows(win)).length === 0 &&
      (await tabsOf(win)).find((tab) => tab.active)?.id === id.b,
    "plain click cleared and opened b",
  );

  // --- Add to Group: b + f into the first group via the menu
  await click(win, id.f, [toggleModifier]);
  await waitFor(
    async () => json(await selectedRows(win)) === json([id.b, id.f]),
    "b + f selected",
  );
  await mainSees(win, 2);
  popped = [];
  await click(win, id.f, [], "right");
  await waitFor(() => menuWith("Add to Group"), "Add to Group submenu");
  menuWith("Add to Group")
    .find((item) => item.label === "Add to Group")
    .submenu[0].click();
  await waitFor(
    async () =>
      (await tabsOf(win)).filter((tab) => tab.group?.id === firstGroup)
        .length === 6,
    "b + f joined the group",
  );
  await api(win, `tabGroups.ungroup(${json(firstGroup)})`);

  // --- Ctrl/Cmd+G groups the selection
  await click(win, id.e, [toggleModifier]);
  await waitFor(
    async () => (await selectedRows(win)).length === 2,
    "b + e selected",
  );
  await mainSees(win, 2);
  surface(win, "sidebar").webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "G",
    modifiers: [toggleModifier],
  });
  surface(win, "sidebar").webContents.sendInputEvent({
    type: "char",
    keyCode: "g",
    modifiers: [toggleModifier],
  });
  surface(win, "sidebar").webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "G",
    modifiers: [toggleModifier],
  });
  tabs = await waitFor(async () => {
    const value = await tabsOf(win);
    return value.filter((tab) => tab.group).length === 2 ? value : null;
  }, "Ctrl/Cmd+G grouped the selection");
  assert.deepEqual(
    tabs
      .filter((tab) => tab.group)
      .map(pathOf)
      .sort(),
    ["/b", "/e"],
  );
  await waitFor(
    async () => (await selectedRows(win)).length === 0,
    "selection cleared after Ctrl/Cmd+G",
  );

  // --- bulk close
  await click(win, id.c, [toggleModifier]);
  await click(win, id.d, [toggleModifier]);
  await waitFor(
    async () => (await selectedRows(win)).length === 3,
    "b, c, d selected",
  );
  await mainSees(win, 3);
  popped = [];
  await click(win, id.c, [], "right");
  await waitFor(() => menuWith("Close 3 Tabs"), "Close 3 Tabs");
  menuWith("Close 3 Tabs")
    .find((item) => item.label === "Close 3 Tabs")
    .click();
  await waitFor(
    async () =>
      json((await tabsOf(win)).map(pathOf).sort()) === json(["/a", "/e", "/f"]),
    "three tabs closed",
  );

  server.close();
  smoke.removeProfile(userData);
  console.log("Electron tab selection smoke passed.");
}

mainPhase().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron tab selection smoke failed:", error);
    app.exit(1);
  },
);
