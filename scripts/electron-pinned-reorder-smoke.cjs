// Integration smoke for the pinned strip order: pins keep the order they were restored in (never
// sorted), a plain drag on a pin does nothing, holding Cmd (Ctrl off macOS) over the strip shows the
// reorder affordance, Cmd/Ctrl+drag reorders pins (without opening the dragged one), a new pin goes
// to the end, Move Pin Left / Right in the tab menu steps a pin, and the order is what is saved.
// Runs the production build: `bun run build && bun run test:electron-pinned-reorder`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-pinned-reorder-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, Menu } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-pinned-reorder-smoke-${process.pid}`);
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const isMac = process.platform === "darwin";
const reorderModifier = isMac ? "meta" : "control";

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
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
}
const json = (value) => JSON.stringify(value);
const api = (win, call) =>
  evaluate(surface(win, "toolbar"), `window.api.browser.${call}`);
const tabsOf = (win) => api(win, "tabs.get()");
const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
function sqlite(sql, ...params) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(join(userData, "surffish.db"));
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

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
const menuItem = (label) =>
  menuWith(label)?.find((item) => item.label === label);

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
  // Pins c, a, b (not alphabetical), interleaved with unpinned tabs in the tab list; x is active.
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({
      version: 1,
      tabs: ["c", "x", "a", "b", "d"].map((name) => `${origin}/${name}`),
      activeIndex: 1,
      pinnedTabs: [0, 2, 3],
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
  await api(win, "chrome.set({ sidebarMode: 'tabs', sidebarPinned: true })");
  await waitFor(
    () =>
      surface(win, "sidebar").getVisible() &&
      surface(win, "sidebar").getBounds().width > 100,
    "the docked sidebar",
  );
  const tabs = await waitFor(async () => {
    const value = await tabsOf(win);
    return value.length === 5 ? value : null;
  }, "the restored tabs");
  const id = Object.fromEntries(
    tabs.map((tab) => [pathOf(tab.url).slice(1), tab.id]),
  );
  const name = Object.fromEntries(
    Object.entries(id).map(([key, value]) => [value, key]),
  );
  const sidebar = surface(win, "sidebar");
  const contents = sidebar.webContents;
  const stripOrder = async () =>
    (
      await evaluate(
        sidebar,
        '[...document.querySelectorAll(".sidebar-pinned-list [data-pin-kind=tab]")].map((el) => el.getAttribute("data-pin-id"))',
      )
    ).map((tabId) => name[tabId] ?? tabId);
  const mainOrder = async () =>
    (await tabsOf(win))
      .filter((tab) => tab.pinned)
      .map((tab) => name[tab.id] ?? tab.id);
  const activeName = async () =>
    name[(await tabsOf(win)).find((tab) => tab.active)?.id];
  const stripClass = () =>
    evaluate(
      sidebar,
      'document.querySelector(".sidebar-pinned-list")?.className ?? ""',
    );
  const pinPoint = async (pin) => {
    const point = await evaluate(
      sidebar,
      `(() => { const el = document.querySelector('.sidebar-pinned-list [data-pin-id=${json(id[pin])}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: Math.round(r.width) } })()`,
    );
    assert.ok(point, `pin ${pin} is in the strip`);
    return point;
  };
  /** Press pin `pin`, move `dx` px along the strip in steps, release. `during` runs before release. */
  const dragPin = async (pin, dx, modifiers = [], during) => {
    const from = await pinPoint(pin);
    contents.focus();
    contents.sendInputEvent({
      type: "mouseMove",
      x: from.x,
      y: from.y,
      modifiers,
    });
    await delay(50);
    contents.sendInputEvent({
      type: "mouseDown",
      x: from.x,
      y: from.y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
    for (let i = 1; i <= 12; i += 1) {
      contents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(from.x + (dx * i) / 12),
        y: from.y,
        button: "left",
        modifiers: [...modifiers, "leftButtonDown"],
      });
      await delay(25);
    }
    await delay(120);
    if (during) await during();
    contents.sendInputEvent({
      type: "mouseUp",
      x: from.x + dx,
      y: from.y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
    await delay(250);
  };
  const rightClick = async (selector) => {
    const point = await evaluate(
      sidebar,
      `(() => { const el = document.querySelector(${json(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + r.height / 2) } })()`,
    );
    assert.ok(point, `${selector} on screen`);
    contents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    contents.sendInputEvent({
      type: "mouseDown",
      x: point.x,
      y: point.y,
      button: "right",
      clickCount: 1,
    });
    contents.sendInputEvent({
      type: "mouseUp",
      x: point.x,
      y: point.y,
      button: "right",
      clickCount: 1,
    });
  };

  await waitFor(
    async () => (await stripOrder()).length === 3,
    "three pins in the strip",
  );
  await delay(500);

  smoke.step(
    "restored pins keep their saved order (c, a, b), not alphabetical",
  );
  assert.deepEqual(await stripOrder(), ["c", "a", "b"]);
  assert.deepEqual(await mainOrder(), ["c", "a", "b"]);

  smoke.step(
    "a plain drag on a pin does not reorder (and shows no reorder affordance)",
  );
  const pitch = (await pinPoint("a")).x - (await pinPoint("c")).x;
  assert.ok(pitch > 0, `pins sit left to right (pitch ${pitch})`);
  let plainClass = "";
  await dragPin("c", pitch * 2 + 4, [], async () => {
    plainClass = await stripClass();
  });
  assert.ok(
    !plainClass.includes("is-reordering") &&
      !plainClass.includes("is-reorder-armed"),
    `no reorder state during a plain drag: "${plainClass}"`,
  );
  await delay(300);
  assert.deepEqual(
    await stripOrder(),
    ["c", "a", "b"],
    "plain drag left the strip alone",
  );
  assert.deepEqual(
    await mainOrder(),
    ["c", "a", "b"],
    "plain drag left main alone",
  );

  smoke.step(
    "holding the modifier over the strip shows the reorder affordance; releasing it hides it",
  );
  const over = await pinPoint("a");
  contents.sendInputEvent({
    type: "mouseMove",
    x: over.x,
    y: over.y,
    modifiers: [reorderModifier],
  });
  await waitFor(
    async () => (await stripClass()).includes("is-reorder-armed"),
    "armed with the modifier",
  );
  contents.sendInputEvent({ type: "mouseMove", x: over.x + 1, y: over.y });
  await waitFor(
    async () => !(await stripClass()).includes("is-reorder-armed"),
    "disarmed without it",
  );

  smoke.step(
    `${isMac ? "Cmd" : "Ctrl"}+drag moves c to the end, without opening it`,
  );
  let dragClass = "";
  await dragPin("c", pitch * 2 + 4, [reorderModifier], async () => {
    dragClass = await stripClass();
  });
  assert.ok(
    dragClass.includes("is-reordering"),
    `reordering while dragging: "${dragClass}"`,
  );
  await waitFor(
    async () => json(await mainOrder()) === json(["a", "b", "c"]),
    "main has a, b, c",
  );
  await waitFor(
    async () => json(await stripOrder()) === json(["a", "b", "c"]),
    "strip shows a, b, c",
  );
  assert.equal(
    await activeName(),
    "x",
    "the drag did not open the dragged pin",
  );

  smoke.step(`${isMac ? "Cmd" : "Ctrl"}+drag moves b to the front`);
  await dragPin("b", -(pitch + 4), [reorderModifier]);
  await waitFor(
    async () => json(await mainOrder()) === json(["b", "a", "c"]),
    "main has b, a, c",
  );

  smoke.step("a new pin goes to the end of the strip");
  popped = [];
  await rightClick(`.tab-list [data-browser-tab-id=${json(id.d)}]`);
  await waitFor(() => menuItem("Pin Tab"), "the tab menu with Pin Tab");
  menuItem("Pin Tab").click();
  await waitFor(
    async () => json(await mainOrder()) === json(["b", "a", "c", "d"]),
    "d pinned last",
  );
  await waitFor(
    async () => json(await stripOrder()) === json(["b", "a", "c", "d"]),
    "strip shows d last",
  );

  smoke.step("Move Pin Left / Right in the tab menu");
  popped = [];
  await rightClick(`.sidebar-pinned-list [data-pin-id=${json(id.b)}]`);
  await waitFor(() => menuItem("Move Pin Right"), "the pinned tab menu");
  assert.equal(
    menuItem("Move Pin Left").enabled,
    false,
    "the first pin cannot move left",
  );
  menuItem("Move Pin Right").click();
  await waitFor(
    async () => json(await mainOrder()) === json(["a", "b", "c", "d"]),
    "b moved right",
  );
  popped = [];
  await rightClick(`.sidebar-pinned-list [data-pin-id=${json(id.d)}]`);
  await waitFor(() => menuItem("Move Pin Left"), "the last pin menu");
  assert.equal(
    menuItem("Move Pin Right").enabled,
    false,
    "the last pin cannot move right",
  );
  menuItem("Move Pin Left").click();
  await waitFor(
    async () => json(await mainOrder()) === json(["a", "b", "d", "c"]),
    "d moved left",
  );

  smoke.step("the order is what gets saved");
  app.emit("before-quit", { preventDefault() {} });
  app.emit("will-quit", { preventDefault() {} });
  const saved = sqlite(
    "SELECT url FROM session_tabs WHERE pinned = 1 AND deleted_at IS NULL ORDER BY position",
  ).map((row) => pathOf(row.url).slice(1));
  assert.deepEqual(
    saved,
    ["a", "b", "d", "c"],
    "session_tabs keeps the pin order",
  );

  server.close();
  smoke.removeProfile(userData);
  console.log("Electron pinned reorder smoke passed.");
}

mainPhase().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron pinned reorder smoke failed:", error);
    app.exit(1);
  },
);
