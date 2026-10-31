// Integration smoke for moving tabs into, out of, between and within mini windows (grouping 'tabs'),
// against the production build. Pointer input goes into the header page (sendInputEvent with screen
// coordinates); main's cursor is stubbed to follow it. Every moved page keeps its JS state (no reloads).
//   1. Return to Browser puts a tab back at the sidebar slot it popped out of (not the end).
//   2. Dragging a strip chip along the strip reorders it, with an insertion caret while dragging.
//      ⌥⇧← on a focused chip and the palette's Move Mini Window Tab Right move a tab by one.
//   3. A chip dragged off the window and held there keeps the header up (it used to auto-hide under
//      the pointer) and splits off under the pointer when let go.
//   4. Esc while dragging cancels: letting go afterwards does nothing.
//   5. The palette's "Move Tab to Mini Window: …" sends a sidebar tab into a chosen collection. A chip
//      dragged onto another mini window hints its slot (caret, drop-target) and joins at that slot.
//   6. A chip dragged onto the browser's sidebar hints the row and goes back right before that row.
//   7. A sidebar tab dragged outside its window hints the mini window under the pointer; let go there
//      it joins that collection.
//   8. Palette: Split Tab Off Mini Window, Merge Mini Windows.
//   9. Return All leaves nothing behind.
// `bun run build && bun run test:electron-mini-window-tab-drag`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-tab-drag-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  screen,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(
  tmpdir(),
  `surffish-mini-window-tab-drag-smoke-${process.pid}`,
);
const PAGE = (
  n,
) => `<!doctype html><meta charset="utf-8"><title>Drag ${n}</title>
<style>body{font:16px system-ui;margin:0;padding:24px}</style>
<body><h1>Drag ${n}</h1><script>window.loadId = Math.random()</script></body>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const page = /^\/d(\d)$/.exec(path);
  const body =
    path === "/start"
      ? "<!doctype html><title>Start</title><p>start</p>"
      : page
        ? PAGE(Number(page[1]))
        : null;
  response.writeHead(body ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body ?? "not found");
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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

const surfaceFor = (view) => {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};
const liveContents = () =>
  allWebContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed());
const isMiniHeader = (contents) =>
  contents.getURL().startsWith("data:text/html") &&
  decodeURIComponent(contents.getURL()).includes("<title>Mini Window</title>");
const miniWindows = () =>
  BaseWindow.getAllWindows().filter(
    (win) =>
      !win.isDestroyed() &&
      win.contentView.children.some(
        (view) =>
          view.webContents &&
          !view.webContents.isDestroyed() &&
          isMiniHeader(view.webContents),
      ),
  );
const viewOf = (win, contents) =>
  win.contentView.children.find((view) => view.webContents === contents);
const headerViewOf = (win) =>
  win.contentView.children.find(
    (view) =>
      view.webContents &&
      !view.webContents.isDestroyed() &&
      isMiniHeader(view.webContents),
  );

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
  const urls = ["/start", "/d1", "/d2", "/d3", "/d4", "/d5"].map(
    (path) => origin + path,
  );
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: urls, activeIndex: 0 }),
  );
  // Header inside the window ('overlay') so it is the mini window's own view; no dock, peek or throw.
  writeFileSync(
    join(userData, "browser-mini-window.json"),
    JSON.stringify({
      defaultUrl: "",
      shortcut: "",
      opacity: 1,
      tuckToEdge: false,
      peekOnHover: false,
      throwMomentum: false,
      grouping: "tabs",
      headerPlacement: "overlay",
    }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  // Main reads the pointer from the OS; here it follows the synthetic input.
  let cursor = null;
  const realCursor = screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint = () => cursor ?? realCursor();

  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 800 });
  const surface = (name) =>
    mainWindow.contentView.children.find(
      (view) =>
        view.webContents &&
        !view.webContents.isDestroyed() &&
        surfaceFor(view) === name,
    );
  await waitFor(
    () => surface("content") && surface("toolbar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar").webContents;
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const tabs = () => smoke.evaluate(toolbar, "window.api.browser.tabs.get()");
  const paths = async () =>
    (await tabs()).map((tab) => tab.url.replace(origin, ""));
  const run = (id) =>
    smoke.evaluate(
      toolbar,
      `window.api.browser.commands.run(${JSON.stringify(id)})`,
    );
  // No timed sleep while the smoke runs (a slow runner would otherwise put background tabs to sleep).
  await smoke.evaluate(toolbar, "window.api.browser.setTabSleepMinutes(0)");

  const page = {};
  for (const n of [1, 2, 3, 4, 5]) {
    const tab = await waitFor(
      async () =>
        (await tabs()).find((candidate) => candidate.url === `${origin}/d${n}`),
      `tab d${n}`,
    );
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.activate(${JSON.stringify(tab.id)})`,
    );
    const contents = await waitFor(
      () =>
        liveContents().find(
          (candidate) =>
            candidate.getURL() === `${origin}/d${n}` && !candidate.isLoading(),
        ),
      `page d${n}`,
    );
    await waitFor(
      () => smoke.evaluate(contents, 'typeof window.loadId === "number"'),
      `page d${n} ready`,
    );
    await smoke.evaluate(contents, `window.marker = "d${n}"; true`);
    page[n] = {
      n,
      id: tab.id,
      contents,
      loadId: await smoke.evaluate(contents, "window.loadId"),
    };
  }
  const name = (id) =>
    Object.values(page).find((entry) => entry.id === id)?.n ?? id;
  // d5 only fills the sidebar (it never moves); the rest must keep their page through every move.
  const intact = async (where) => {
    for (const entry of [page[1], page[2], page[3], page[4]]) {
      assert.equal(
        entry.contents.isDestroyed(),
        false,
        `${where}: d${entry.n} alive`,
      );
      assert.equal(
        await smoke.evaluate(entry.contents, "window.marker"),
        `d${entry.n}`,
        `${where}: d${entry.n} kept its state`,
      );
      assert.equal(
        await smoke.evaluate(entry.contents, "window.loadId"),
        entry.loadId,
        `${where}: d${entry.n} not reloaded`,
      );
    }
  };
  const popOut = async (entry) => {
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`,
    );
    await waitFor(
      async () => (await tabs()).find((tab) => tab.active)?.id === entry.id,
      `d${entry.n} active`,
    );
    await run("miniWindow.popOut");
    await waitFor(
      () => miniWindows().some((win) => viewOf(win, entry.contents)),
      `d${entry.n} in a mini window`,
    );
  };
  const holder = (entry) =>
    miniWindows().find((win) => viewOf(win, entry.contents));
  const header = (win) => headerViewOf(win).webContents;
  const strip = async (win) =>
    (
      await smoke.evaluate(
        header(win),
        '[...document.querySelectorAll(".tab")].map((tab) => tab.dataset.tabId)',
      )
    ).map(name);
  const entryOf = (n) => Object.values(page).find((entry) => entry.n === n);
  /** Reveal the header (the pointer near the window's top, over the page on screen). */
  const reveal = async (win) => {
    const active = Object.values(page).find((entry) =>
      viewOf(win, entry.contents),
    );
    const bounds = win.getContentBounds();
    cursor = { x: bounds.x + 150, y: bounds.y + 8 };
    active?.contents.sendInputEvent({ type: "mouseMove", x: 150, y: 8 });
    await waitFor(
      () => headerViewOf(win).getBounds().height > 40,
      "the header and its tab strip revealed",
    );
    await waitFor(
      async () =>
        (await smoke.evaluate(
          header(win),
          'document.querySelectorAll(".tab").length',
        )) > 1,
      "the chips",
    );
    await delay(80);
  };
  const chip = (win, entry) =>
    smoke.evaluate(
      header(win),
      `(() => { const r = document.querySelector('.tab[data-tab-id="${entry.id}"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), left: Math.round(r.x) } })()`,
    );
  /** Pointer input for `win`'s header at screen point `at`. */
  const pointer = (win, type, at) => {
    const content = win.getContentBounds();
    const view = headerViewOf(win).getBounds();
    cursor = { x: at.x, y: at.y };
    header(win).sendInputEvent({
      type,
      x: at.x - content.x - view.x,
      y: at.y - content.y - view.y,
      globalX: at.x,
      globalY: at.y,
      button: "left",
      clickCount: 1,
    });
  };
  const screenOf = (win, point) => {
    const content = win.getContentBounds();
    return { x: content.x + point.x, y: content.y + point.y };
  };
  /** Press a chip and move to screen point `to` in steps (still pressed). */
  const dragChip = async (win, entry, to) => {
    const from = screenOf(win, await chip(win, entry));
    pointer(win, "mouseMove", from);
    pointer(win, "mouseDown", from);
    for (let i = 1; i <= 10; i++) {
      pointer(win, "mouseMove", {
        x: Math.round(from.x + ((to.x - from.x) * i) / 10),
        y: Math.round(from.y + ((to.y - from.y) * i) / 10),
      });
      await delay(25);
    }
    await delay(150);
  };
  const caretOn = (win) =>
    smoke.evaluate(
      header(win),
      'document.getElementById("caret").classList.contains("on")',
    );

  // --- 1. Return puts the tab back where it was.
  smoke.step(
    "Return to Browser puts a tab back at its sidebar slot, not at the end",
  );
  assert.deepEqual(await paths(), [
    "/start",
    "/d1",
    "/d2",
    "/d3",
    "/d4",
    "/d5",
  ]);
  await popOut(page[2]);
  const first = holder(page[2]);
  await waitFor(
    async () => !(await paths()).includes("/d2"),
    "d2 left the sidebar",
  );
  await smoke.evaluate(
    header(first),
    'document.getElementById("return").click(); true',
  );
  await waitFor(async () => (await paths()).includes("/d2"), "d2 back");
  assert.deepEqual(
    await paths(),
    ["/start", "/d1", "/d2", "/d3", "/d4", "/d5"],
    "d2 back between d1 and d3",
  );
  await waitFor(() => miniWindows().length === 0, "its mini window closed");

  // --- 2. Reorder.
  smoke.step(
    "dragging a chip along the strip reorders it, with a caret while dragging",
  );
  await popOut(page[1]);
  const w1 = holder(page[1]);
  w1.setBounds({ x: 1000, y: 120, width: 420, height: 500 });
  await popOut(page[2]);
  await popOut(page[3]);
  await waitFor(
    async () => (await strip(w1)).join() === "1,2,3",
    "one collection: 1,2,3",
  );
  await reveal(w1);
  const c1 = await chip(w1, page[1]);
  await dragChip(w1, page[3], screenOf(w1, { x: c1.left + 4, y: c1.y }));
  await waitFor(() => caretOn(w1), "the insertion caret shows");
  assert.equal(
    await smoke.evaluate(
      header(w1),
      'document.querySelectorAll(".tab.dragging").length',
    ),
    1,
    "the dragged chip is marked",
  );
  pointer(w1, "mouseUp", screenOf(w1, { x: c1.left + 4, y: c1.y }));
  await waitFor(
    async () => (await strip(w1)).join() === "3,1,2",
    "reordered to 3,1,2",
  );
  assert.equal(await caretOn(w1), false, "caret gone after the drop");
  assert.equal(miniWindows().length, 1, "no split");
  await intact("after a strip reorder");

  smoke.step("⌥⇧← on a focused chip and the palette move a tab by one");
  await smoke.evaluate(
    header(w1),
    `(() => { const el = document.querySelector('.tab[data-tab-id="${page[2].id}"]'); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, shiftKey: true, bubbles: true })); return true })()`,
  );
  await waitFor(
    async () => (await strip(w1)).join() === "3,2,1",
    "moved left: 3,2,1",
  );
  // The palette moves the tab on screen one step right.
  const shown = name(
    await smoke.evaluate(
      header(w1),
      'document.querySelector(".tab.active").dataset.tabId',
    ),
  );
  const was = (await strip(w1)).indexOf(shown);
  assert.ok(was < 2, `the tab on screen (d${shown}) can move right`);
  assert.equal(
    await run("miniWindow.moveTabRight"),
    true,
    "Move Mini Window Tab Right ran",
  );
  await waitFor(
    async () => (await strip(w1)).indexOf(shown) === was + 1,
    `d${shown} one step right`,
  );
  await intact("after keyboard moves");

  // --- 3. Drag out with a hold: the header stays, then it splits.
  smoke.step(
    "a chip held off the window keeps the header up, then splits off under the pointer",
  );
  await reveal(w1);
  const outside = { x: 1200, y: 800 }; // off w1 and off the browser window
  await dragChip(w1, page[1], outside);
  await delay(1500);
  assert.ok(
    headerViewOf(w1).getBounds().height > 40,
    `header still revealed mid-drag (${headerViewOf(w1).getBounds().height})`,
  );
  pointer(w1, "mouseUp", outside);
  const w2 = await waitFor(
    () =>
      miniWindows().find((win) => win !== w1 && viewOf(win, page[1].contents)),
    "d1 split into its own window",
  );
  const b2 = w2.getBounds();
  // Under the pointer, fitted to the work area (low on the screen: pushed up so it fits).
  const wa = screen.getPrimaryDisplay().workArea;
  assert.ok(
    outside.x >= b2.x &&
      outside.x < b2.x + b2.width &&
      b2.y + b2.height <= wa.y + wa.height &&
      b2.y <= outside.y,
    `opens under the pointer (${JSON.stringify(b2)})`,
  );
  await waitFor(
    async () => (await strip(w1)).length === 2,
    "the collection keeps two",
  );
  await intact("after a split");

  // --- 4. Esc cancels.
  smoke.step("Esc while dragging cancels: the release does nothing");
  await reveal(w1);
  const before = (await strip(w1)).join();
  await dragChip(w1, entryOf((await strip(w1))[0]), { x: 600, y: 900 });
  header(w1).sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  await delay(150);
  pointer(w1, "mouseUp", { x: 600, y: 900 });
  await delay(600);
  assert.equal(miniWindows().length, 2, "no window split off");
  assert.equal((await strip(w1)).join(), before, "strip unchanged");
  assert.equal(
    await smoke.evaluate(
      header(w1),
      'document.querySelectorAll(".tab.dragging").length',
    ),
    0,
    "no chip left dragging",
  );

  // --- 5. Keyboard into a chosen collection, then a chip onto another mini window.
  smoke.step(
    "palette Move Tab to Mini Window; a chip dragged onto another mini window joins at the slot under the pointer",
  );
  await smoke.evaluate(
    toolbar,
    `window.api.browser.tabs.activate(${JSON.stringify(page[4].id)})`,
  );
  await waitFor(
    async () => (await tabs()).find((tab) => tab.active)?.id === page[4].id,
    "d4 active",
  );
  w2.setBounds({ x: 520, y: 450, width: 420, height: 400 });
  await delay(300);
  assert.equal(
    await run(`miniWindow.moveInto:${page[1].id}`),
    true,
    "Move Tab to Mini Window ran",
  );
  await waitFor(
    async () => (await strip(w2)).join() === "1,4",
    "d4 joined w2 (1,4)",
  );
  await reveal(w2);
  const slot0 = screenOf(w2, await chip(w2, page[1]));
  const slotPoint = { x: slot0.x - 30, y: slot0.y };
  await reveal(w1);
  const moving = entryOf((await strip(w1)).at(-1));
  await dragChip(w1, moving, slotPoint);
  await waitFor(
    () =>
      smoke.evaluate(
        header(w2),
        'document.body.classList.contains("drop-target") && document.getElementById("caret").classList.contains("on")',
      ),
    "the target shows its drop slot",
  );
  pointer(w1, "mouseUp", slotPoint);
  await waitFor(
    async () => (await strip(w2)).join() === `${moving.n},1,4`,
    `d${moving.n} joined w2 first`,
  );
  assert.equal(
    await smoke.evaluate(
      header(w2),
      'document.body.classList.contains("drop-target")',
    ),
    false,
    "target hint cleared",
  );
  await intact("after a move between mini windows");

  // --- 6. Onto the browser's sidebar: back right before the row under the pointer.
  smoke.step(
    "a chip dragged onto the sidebar hints the row and goes back right before it",
  );
  // The sidebar pinned open (an auto-hidden one has nothing on screen to drop on).
  const sidebarShown = () => {
    const view = surface("sidebar");
    if (!view || !view.getVisible()) return false;
    const bounds = view.getBounds();
    return bounds.x >= 0 && bounds.width > 100;
  };
  if (!sidebarShown()) await run("view.toggleSidebar");
  await waitFor(sidebarShown, "the sidebar pinned open");
  const rowsSurface = await waitFor(async () => {
    for (const view of mainWindow.contentView.children) {
      const contents = view.webContents;
      if (
        !contents ||
        contents.isDestroyed() ||
        !surfaceFor(view) ||
        !view.getVisible() ||
        view.getBounds().x < 0
      )
        continue;
      const rows = await smoke
        .evaluate(
          contents,
          `[...document.querySelectorAll('[data-browser-tab-id]')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.browserTabId, x: Math.round(r.x + 30), y: Math.round(r.y + 6), visible: r.width > 0 && r.height > 0 && r.y >= 0 && r.bottom <= innerHeight } }).filter((row) => row.visible)`,
        )
        .catch(() => []);
      if (rows.length >= 2) return { view, rows };
    }
    return null;
  }, "sidebar rows on screen");
  const row = rowsSurface.rows[1];
  const viewBounds = rowsSurface.view.getBounds();
  const content = mainWindow.getContentBounds();
  const rowPoint = {
    x: content.x + viewBounds.x + row.x,
    y: content.y + viewBounds.y + row.y,
  };
  await reveal(w2);
  const back = entryOf((await strip(w2)).at(-1));
  await dragChip(w2, back, rowPoint);
  await waitFor(
    () =>
      smoke.evaluate(
        rowsSurface.view.webContents,
        `document.querySelector('[data-external-drop]')?.dataset.browserTabId === ${JSON.stringify(row.id)}`,
      ),
    "the sidebar shows a drop line at that row",
  );
  pointer(w2, "mouseUp", rowPoint);
  await waitFor(
    async () => (await tabs()).some((tab) => tab.id === back.id),
    `d${back.n} back in the sidebar`,
  );
  const after = (await tabs()).map((tab) => tab.id);
  assert.equal(
    after[after.indexOf(back.id) + 1],
    row.id,
    `d${back.n} landed right before the row it was dropped on`,
  );
  await waitFor(
    () =>
      smoke.evaluate(
        rowsSurface.view.webContents,
        `!document.querySelector('[data-external-drop]')`,
      ),
    "the sidebar drop line cleared",
  );
  await intact("after a drop on the sidebar");

  // --- 7. Sidebar tab onto a mini window.
  smoke.step(
    "a sidebar tab dragged outside its window hints the mini window under the pointer and joins it",
  );
  const into = w2;
  const ib = into.getBounds();
  cursor = { x: ib.x + 100, y: ib.y + 200 };
  await smoke.evaluate(
    toolbar,
    `window.api.browser.tabs.dragOutside(${JSON.stringify(back.id)}); true`,
  );
  await waitFor(
    () =>
      smoke.evaluate(
        header(into),
        'document.body.classList.contains("drop-target")',
      ),
    "the mini window under the pointer is hinted",
  );
  assert.equal(
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.dropOutside(${JSON.stringify(back.id)})`,
    ),
    true,
    "dropOutside took it",
  );
  await smoke.evaluate(
    toolbar,
    "window.api.browser.tabs.dragOutside(null); true",
  );
  await waitFor(
    async () =>
      !(await tabs()).some((tab) => tab.id === back.id) &&
      (await strip(into)).includes(back.n),
    `d${back.n} joined that mini window`,
  );
  await waitFor(
    () =>
      smoke.evaluate(
        header(into),
        '!document.body.classList.contains("drop-target")',
      ),
    "hint cleared",
  );
  await intact("after a sidebar tab joined a mini window");

  // --- 8. Palette split and merge.
  smoke.step("palette: Split Tab Off Mini Window, Merge Mini Windows");
  const count = miniWindows().length;
  assert.equal(await run("miniWindow.splitTab"), true, "split ran");
  await waitFor(() => miniWindows().length === count + 1, "one more window");
  assert.equal(await run("miniWindow.merge"), true, "merge ran");
  await waitFor(
    () => miniWindows().length === 1,
    "all floating collections merged into one",
  );
  await intact("after palette split + merge");

  // --- 9. Cleanup.
  smoke.step("Return All leaves nothing behind");
  await run("miniWindow.return");
  await waitFor(
    () =>
      miniWindows().length === 0 &&
      liveContents().filter(isMiniHeader).length === 0,
    "mini windows and headers gone",
  );
  await waitFor(
    async () => (await paths()).length === 6,
    "all six tabs back in the sidebar",
  );
  await intact("after Return All");
  console.log("Electron mini window tab drag smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron mini window tab drag smoke failed:", error);
    app.exit(1);
  },
);
