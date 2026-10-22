// Integration smoke for a mini window's New Tab and its address field, against the production build
// (grouping 'tabs', header 'overlay': the header is the mini window's own view).
//   1. + in the header row opens a New Tab in that mini window (its collection, not the browser):
//      the strip shows, the New Tab page fills the page area, the address field shows and is focused.
//   2. Typing an address and Enter loads it in that mini tab: the New Tab page goes, the field goes,
//      and the browser window gets no new tab.
//   3. ⌘/Ctrl+L on the page shows the field (holding the page's address, selected) and focuses it;
//      typing shows the toolbar omnibox's suggestions; ↓ fills the field with a row's URL; Esc puts
//      back what was typed, a second Esc hides the field and leaves the page where it was.
//   4. + after the last strip chip and ⌘/Ctrl+T in the mini window open more New Tabs there; Esc on a
//      New Tab puts the field away and it stays away; a click on the New Tab page brings it back.
//   5. The New Tab page has the browser New Tab's look: its background photo (no Wikimedia photo cached
//      here: a bundled offline one, read from the renderer build) with its credit, and its clock.
//   6. Menu bar popout with several tabs: the address field gets its own row under the strip; the
//      chips and + stay, the New Tab page starts under the row, the dropdown hangs under it, and Esc
//      takes the row away again.
//   7. Return All: the New Tabs go back to the browser as New Tabs; nothing else is left behind.
// `bun run build && bun run test:electron-mini-window-newtab`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-mini-window-newtab-smoke.cjs`).
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
  `surffish-mini-window-newtab-smoke-${process.pid}`,
);
const PAGE = (
  n,
) => `<!doctype html><meta charset="utf-8"><title>Page ${n}</title>
<style>body{font:16px system-ui;margin:0;padding:24px}</style>
<body><h1>Page ${n}</h1><script>window.loadId = Math.random()</script></body>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const page = /^\/p(\d)$/.exec(path);
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
const PRIMARY = process.platform === "darwin" ? "meta" : "control";

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
const dataPage = (contents, title) =>
  contents.getURL().startsWith("data:text/html") &&
  decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`);
const isMiniHeader = (contents) => dataPage(contents, "Mini Window");
const isMiniNewTab = (contents) => dataPage(contents, "Mini Window New Tab");
const childViews = (win) =>
  win.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const miniWindows = () =>
  BaseWindow.getAllWindows().filter(
    (win) =>
      !win.isDestroyed() &&
      childViews(win).some((view) => isMiniHeader(view.webContents)),
  );
const headerViewOf = (win) =>
  childViews(win).find((view) => isMiniHeader(view.webContents));
const newTabViewOf = (win) =>
  childViews(win).find((view) => isMiniNewTab(view.webContents));
const pageViewOf = (win, url) =>
  childViews(win).find((view) => view.webContents.getURL() === url);

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
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({
      version: 1,
      tabs: [`${origin}/start`, `${origin}/p1`],
      activeIndex: 0,
    }),
  );
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
  const runCommand = (id) =>
    smoke.evaluate(
      toolbar,
      `window.api.browser.commands.run(${JSON.stringify(id)})`,
    );
  await smoke.evaluate(toolbar, "window.api.browser.setTabSleepMinutes(0)");

  // p1 in a mini window (a visit to p1 is in history for the suggestions later).
  const p1 = await waitFor(
    async () => (await tabs()).find((tab) => tab.url === `${origin}/p1`),
    "tab p1",
  );
  await smoke.evaluate(
    toolbar,
    `window.api.browser.tabs.activate(${JSON.stringify(p1.id)})`,
  );
  const p1Contents = await waitFor(
    () =>
      liveContents().find(
        (contents) =>
          contents.getURL() === `${origin}/p1` && !contents.isLoading(),
      ),
    "page p1",
  );
  await waitFor(
    () => smoke.evaluate(p1Contents, 'typeof window.loadId === "number"'),
    "page p1 ready",
  );
  await runCommand("miniWindow.popOut");
  const mini = await waitFor(
    () => miniWindows().find((win) => pageViewOf(win, `${origin}/p1`)),
    "p1 in a mini window",
  );
  mini.setBounds({ x: 960, y: 120, width: 420, height: 480 });
  const header = () => headerViewOf(mini).webContents;
  await waitFor(
    () =>
      smoke.evaluate(
        header(),
        'document.readyState === "complete" && Boolean(window.miniWindow)',
      ),
    "the header page",
  );
  const browserTabCount = (await tabs()).length;
  const chipCount = () =>
    smoke.evaluate(header(), 'document.querySelectorAll("#strip .tab").length');
  const addressState = () =>
    smoke.evaluate(
      header(),
      '({ open: document.body.classList.contains("addressing"), focused: document.activeElement && document.activeElement.id === "addrInput", value: document.getElementById("addrInput").value, rows: [...document.querySelectorAll("#drop .row")].map((row) => row.dataset.url || "keyword"), drop: document.getElementById("drop").classList.contains("on") })',
    );
  /** A click at the centre of `selector` in the header page (input events, like a pointer). */
  const clickInHeader = async (selector) => {
    const at = await smoke.evaluate(
      header(),
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width } })()`,
    );
    assert.ok(at.w > 0, `${selector} is shown`);
    const content = mini.getContentBounds();
    const view = headerViewOf(mini).getBounds();
    cursor = { x: content.x + view.x + at.x, y: content.y + view.y + at.y };
    for (const type of ["mouseMove", "mouseDown", "mouseUp"])
      header().sendInputEvent({
        type,
        x: at.x,
        y: at.y,
        button: "left",
        clickCount: 1,
      });
  };
  const key = (contents, keyCode, modifiers = []) => {
    contents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode === "Return")
      contents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  /** Reveal the header (the pointer near the window's top, over the page). */
  const reveal = async (contents) => {
    const bounds = mini.getContentBounds();
    cursor = { x: bounds.x + 150, y: bounds.y + 8 };
    contents.sendInputEvent({ type: "mouseMove", x: 150, y: 8 });
    await waitFor(
      () => headerViewOf(mini).getBounds().height >= 36,
      "the header revealed",
    );
    await delay(80);
  };

  // --- 1. + opens a New Tab in the mini window, the field focused.
  smoke.step(
    "+ in the header opens a New Tab in that mini window, address field shown and focused",
  );
  await reveal(p1Contents);
  assert.equal(await chipCount(), 0, "one tab: no strip yet");
  await clickInHeader("#plus");
  await waitFor(
    async () => (await chipCount()) === 2,
    "the strip with two chips (the New Tab joined this collection)",
  );
  await waitFor(() => newTabViewOf(mini), "the New Tab page in the page area");
  await waitFor(async () => {
    const state = await addressState();
    return state.open && state.focused && state.value === "";
  }, "the address field shown, empty and focused");
  assert.equal(
    (await tabs()).length,
    browserTabCount,
    "no tab opened in the browser window",
  );
  assert.equal(miniWindows().length, 1, "no new mini window (grouping tabs)");
  const newTabContents = newTabViewOf(mini).webContents;
  await waitFor(
    () =>
      smoke.evaluate(
        newTabContents,
        'document.readyState === "complete" && document.querySelector("main") !== null',
      ),
    "the New Tab page loaded",
  );
  // The browser New Tab's look: the photo (offline: no Wikimedia photo is cached here) and its credit,
  // the clock (on by default), no "type an address above" hint; the strip stays with the field open.
  const look = () =>
    smoke.evaluate(
      newTabContents,
      `({ photo: document.body.classList.contains('photo'), image: getComputedStyle(document.getElementById('photo')).backgroundImage.slice(0, 40), credit: document.getElementById('credit').textContent, clock: document.body.classList.contains('clock'), time: document.getElementById('time').textContent, hint: Boolean(document.getElementById('hint')), tiles: document.querySelectorAll('#sites .site').length })`,
    );
  const shown = await waitFor(async () => {
    const state = await look();
    return state.photo &&
      state.image.startsWith('url("data:image/webp') &&
      state.clock &&
      state.time
      ? state
      : null;
  }, "the New Tab photo and clock");
  assert.ok(
    /Forest lake|Tranquil mountain lake/.test(shown.credit),
    `the offline photo's credit (${shown.credit})`,
  );
  assert.match(shown.time, /^\d{1,2}:\d{2}/, "the clock shows the time");
  assert.equal(shown.hint, false, 'no "type an address above" hint');
  assert.ok(shown.tiles >= 1, "the frequently visited tiles");
  assert.equal(
    await smoke.evaluate(
      header(),
      'getComputedStyle(document.getElementById("strip")).display',
    ),
    "flex",
    "the strip stays with the field open",
  );
  // The header stays up while the field is open, even with the pointer gone.
  cursor = { x: 10, y: 10 };
  await delay(1200);
  assert.ok(
    headerViewOf(mini).getBounds().height >= 36,
    "the header stays up while the field shows",
  );

  // --- 2. Typing an address and Enter loads it in that mini tab.
  smoke.step(
    "typing an address and Enter loads it in the mini tab (not the browser)",
  );
  header().insertText(`${origin}/p2`);
  await waitFor(
    async () => (await addressState()).value === `${origin}/p2`,
    "the typed address",
  );
  key(header(), "Return");
  const p2View = await waitFor(
    () => pageViewOf(mini, `${origin}/p2`),
    "p2 loaded in the mini window",
  );
  await waitFor(() => !p2View.webContents.isLoading(), "p2 finished loading");
  await waitFor(() => !newTabViewOf(mini), "the New Tab page released");
  await waitFor(async () => !(await addressState()).open, "the field put away");
  assert.equal(
    (await tabs()).length,
    browserTabCount,
    "still no new tab in the browser window",
  );
  assert.equal(await chipCount(), 2, "still two tabs in the mini window");
  assert.equal(
    liveContents().filter(isMiniNewTab).length,
    0,
    "no New Tab page left anywhere",
  );

  // --- 3. ⌘L shows the field on a page; suggestions; ↓ fills; Esc restores, Esc hides.
  smoke.step(
    "⌘/Ctrl+L on a page shows the field with its address; suggestions, ↓, Esc, Esc",
  );
  const p2Contents = p2View.webContents;
  p2Contents.focus();
  key(p2Contents, "L", [PRIMARY]);
  await waitFor(async () => {
    const state = await addressState();
    return state.open && state.focused && state.value === `${origin}/p2`;
  }, "the field shown with the page address, focused");
  assert.equal(
    await smoke.evaluate(
      header(),
      'document.getElementById("addrInput").selectionStart === 0 && document.getElementById("addrInput").selectionEnd === document.getElementById("addrInput").value.length',
    ),
    true,
    "the address is selected",
  );
  header().insertText("p1");
  await waitFor(async () => {
    const state = await addressState();
    return state.drop && state.rows.includes(`${origin}/p1`);
  }, "a p1 suggestion (history / open tab) in the dropdown");
  assert.ok(
    headerViewOf(mini).getBounds().height > 64,
    "the header view grew for the dropdown",
  );
  key(header(), "Down");
  await waitFor(
    async () => (await addressState()).value.startsWith("http"),
    "Down filled the field with a row URL",
  );
  key(header(), "Escape");
  await waitFor(
    async () => (await addressState()).value === "p1",
    "Esc put back what was typed",
  );
  key(header(), "Escape");
  await waitFor(
    async () => !(await addressState()).open,
    "a second Esc hid the field",
  );
  await waitFor(
    () => headerViewOf(mini).getBounds().height <= 64,
    "the dropdown gone",
  );
  assert.equal(p2Contents.getURL(), `${origin}/p2`, "the page did not move");

  // --- 4. + after the last chip, ⌘T, Esc on a New Tab, click on the New Tab page.
  smoke.step(
    "+ after the last chip and ⌘/Ctrl+T open New Tabs there; Esc puts the field away; a click brings it back",
  );
  await reveal(p2Contents);
  await clickInHeader("#strip .strip-plus");
  await waitFor(
    async () => (await chipCount()) === 3,
    "a third chip from + after the last chip",
  );
  await waitFor(async () => {
    const state = await addressState();
    return state.open && state.focused && state.value === "";
  }, "the field focused on the new New Tab");
  const strip = await smoke.evaluate(
    header(),
    '[...document.getElementById("strip").children].map((el) => el.className)',
  );
  assert.equal(
    strip[strip.length - 1],
    "strip-plus",
    "+ sits after the last chip",
  );
  key(header(), "Escape");
  await waitFor(
    async () => !(await addressState()).open,
    "Esc put the field away on the New Tab",
  );
  await delay(300);
  assert.equal(
    (await addressState()).open,
    false,
    "it stays away (no reopening by itself)",
  );
  const blank = newTabViewOf(mini).webContents;
  await waitFor(
    () => smoke.evaluate(blank, 'document.readyState === "complete"'),
    "the New Tab page",
  );
  for (const type of ["mouseDown", "mouseUp"])
    blank.sendInputEvent({
      type,
      x: 200,
      y: 300,
      button: "left",
      clickCount: 1,
    });
  await waitFor(async () => {
    const state = await addressState();
    return state.open && state.focused;
  }, "a click on the New Tab page brought the field back");
  key(header(), "T", [PRIMARY]);
  await waitFor(
    async () => (await chipCount()) === 4,
    "a fourth chip from ⌘/Ctrl+T in the mini window",
  );
  await waitFor(async () => {
    const state = await addressState();
    return state.open && state.focused && state.value === "";
  }, "the field focused after ⌘/Ctrl+T");
  assert.equal(
    (await tabs()).length,
    browserTabCount,
    "none of them opened in the browser window",
  );

  // --- 6. The menu bar popout: the field's own row under the strip.
  smoke.step(
    "menu bar popout with tabs: the field gets a row under the strip; chips and + stay",
  );
  mini.focus();
  await runCommand("miniWindow.menuBar");
  await waitFor(
    () =>
      smoke.evaluate(header(), 'document.body.classList.contains("popout")') &&
      mini.isVisible(),
    "the popout strip",
  );
  await clickInHeader("#pin");
  await waitFor(
    () =>
      smoke.evaluate(
        header(),
        'document.getElementById("pin").classList.contains("on")',
      ),
    "pinned (a blur never hides it here)",
  );
  const popoutNewTab = await waitFor(
    () => newTabViewOf(mini),
    "the New Tab page in the popout",
  );
  if (!(await addressState()).open) {
    for (const type of ["mouseDown", "mouseUp"])
      popoutNewTab.webContents.sendInputEvent({
        type,
        x: 150,
        y: 300,
        button: "left",
        clickCount: 1,
      });
  }
  await waitFor(
    async () => (await addressState()).open,
    "the field open in the popout",
  );
  const row = () =>
    smoke.evaluate(
      header(),
      `(() => { const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) } }; return { strip: box('strip'), addr: box('addr'), plus: box('stripPlus'), chips: [...document.querySelectorAll('#strip .tab')].filter((el) => el.getBoundingClientRect().width > 0).length, stripInRow: document.getElementById('strip').parentElement.id === 'bar' } })()`,
    );
  const laid = await waitFor(async () => {
    const r = await row();
    return r.addr.top === 28 && r.addr.bottom === 60 ? r : null;
  }, "the field in its own 32 px row under the 28 px strip");
  assert.equal(laid.chips, 4, "all four chips stay shown");
  assert.ok(
    laid.stripInRow && laid.strip.bottom <= 28 && laid.plus.width > 0,
    "the strip and its + stay in the popout row",
  );
  await waitFor(
    () => headerViewOf(mini).getBounds().height === 60,
    "the header view covers the strip and the row",
  );
  await waitFor(
    () => newTabViewOf(mini).getBounds().y === 60,
    "the New Tab page starts under the row",
  );
  assert.equal(
    pageViewOf(mini, `${origin}/p2`)?.getBounds().y ?? 28,
    28,
    "the page itself never moves",
  );
  header().focus();
  await clickInHeader("#addrInput");
  header().insertText("p1");
  await waitFor(
    async () => (await addressState()).drop,
    "the dropdown in the popout",
  );
  const dropTop = await smoke.evaluate(
    header(),
    'Math.round(document.getElementById("drop").getBoundingClientRect().top)',
  );
  assert.ok(dropTop >= 60, `the dropdown hangs under the row (${dropTop})`);
  assert.equal((await row()).chips, 4, "the chips stay while typing");
  key(header(), "Escape");
  key(header(), "Escape");
  await waitFor(
    async () => !(await addressState()).open,
    "Esc put the field away",
  );
  await waitFor(
    () =>
      headerViewOf(mini).getBounds().height === 28 &&
      newTabViewOf(mini).getBounds().y === 28,
    "the row gone: the strip alone, the New Tab page under it",
  );

  // --- 7. Cleanup.
  smoke.step(
    "Return All puts the New Tabs back as New Tabs; nothing left behind",
  );
  await runCommand("miniWindow.return");
  await waitFor(
    () =>
      miniWindows().length === 0 &&
      liveContents().filter(isMiniHeader).length === 0 &&
      liveContents().filter(isMiniNewTab).length === 0,
    "mini windows, headers and New Tab pages gone",
  );
  const back = await waitFor(async () => {
    const list = await tabs();
    return list.length === browserTabCount + 4 ? list : null;
  }, "every mini tab back in the browser");
  assert.equal(
    back.filter((tab) => tab.url === "surffish://quick-links").length,
    2,
    "the two New Tabs came back as New Tabs",
  );
  console.log("Electron mini window New Tab smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron mini window New Tab smoke failed:", error);
    app.exit(1);
  },
);
