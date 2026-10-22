// Back/Forward history menu smoke (press-and-hold or right-click on the toolbar's Back/Forward):
//   1. navigate three pages in one tab; holding Back opens #nav-history-menu listing the back
//      entries newest first, without also going back, and the menu fits inside the toolbar view;
//   2. Escape and a press on the page close it; a quick click on Back still just goes back;
//   3. right-click Back, click the first page: the tab is on it, and the Forward menu now lists
//      the other two nearest first;
//   4. a middle-click on a Forward row opens it in a new tab right after the current one, leaving
//      the current tab where it was; Show Full History opens the History panel;
//   5. a private tab gets the same menu over its own history.
// Uses real mouse input on the toolbar view (sendInputEvent), not element.click().
// Runs the production build: `bun run build && bun run test:electron-nav-history-menu`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-nav-history-menu-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-nav-history-menu-${process.pid}`);
const SHOTS = process.env.NAV_HISTORY_SCREENSHOTS || "";
const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Page ${request.url}</title><body><p>${request.url}</p>`,
  );
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const step = (text) => process.stderr.write(`[nav-history-menu] ${text}\n`);

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

function surfaceOf(contents) {
  try {
    return new URL(contents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
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

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 700 });
  const viewFor = (surface) =>
    mainWindow.contentView.children.find(
      (view) => surfaceOf(view.webContents) === surface,
    );
  const toolbar = await waitFor(
    () => viewFor("toolbar"),
    "the toolbar surface",
  );
  await waitFor(
    () =>
      toolbar.webContents.executeJavaScript(
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const inToolbar = (expression) =>
    toolbar.webContents.executeJavaScript(expression);
  step("shell ready");

  const activeTab = async () => {
    const tabs = await inToolbar("window.api.browser.tabs.get()");
    return { tabs, active: tabs.find((tab) => tab.active) };
  };
  const activeUrl = async () => (await activeTab()).active?.url ?? "";
  const pageLoaded = (path) =>
    waitFor(
      async () =>
        (await activeUrl()) === `${origin}${path}` &&
        webContents
          .getAllWebContents()
          .some(
            (contents) =>
              contents.getURL() === `${origin}${path}` && !contents.isLoading(),
          ),
      `${path} to load`,
    );

  for (const path of ["/one", "/two", "/three"]) {
    await inToolbar(
      `window.api.browser.navigate(${JSON.stringify(`${origin}${path}`)})`,
    );
    await pageLoaded(path);
    // Titles land after the load; the menu shows them.
    await waitFor(
      async () => (await activeTab()).active?.title === `Page ${path}`,
      `${path}'s title`,
    );
  }
  await waitFor(
    () =>
      inToolbar(
        "!document.querySelector('.browser-nav-buttons [aria-label=\"Back\"]').disabled",
      ),
    "Back to enable",
  );
  step("three pages loaded");

  const centerOf = (selector) =>
    inToolbar(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`,
    );
  const mouse = async (selector, button, { hold = 0 } = {}) => {
    const box = await centerOf(selector);
    assert.ok(box, `${selector} is on screen`);
    toolbar.webContents.focus();
    toolbar.webContents.sendInputEvent({
      type: "mouseMove",
      x: box.x,
      y: box.y,
    });
    toolbar.webContents.sendInputEvent({
      type: "mouseDown",
      x: box.x,
      y: box.y,
      button,
      clickCount: 1,
    });
    if (hold) await delay(hold);
    toolbar.webContents.sendInputEvent({
      type: "mouseUp",
      x: box.x,
      y: box.y,
      button,
      clickCount: 1,
    });
  };
  const BACK = '.browser-nav-buttons [aria-label="Back"]';
  const FORWARD = '.browser-nav-buttons [aria-label="Forward"]';
  const menuOpen = () =>
    inToolbar('Boolean(document.querySelector("#nav-history-menu"))');
  const menuRows = () =>
    inToolbar(
      'Array.from(document.querySelectorAll("#nav-history-menu .nav-history-menu-list .nav-history-menu-item")).map((row) => ({ title: row.querySelector(".nav-history-menu-title").textContent.trim(), url: row.title, index: Number(row.dataset.index) }))',
    );
  const rightClick = async (selector) => {
    await mouse(selector, "right");
    // Some platforms only raise contextmenu from a real OS event; fall back to dispatching it.
    if (
      !(await waitFor(menuOpen, "the menu (right-click)", 1500).then(
        () => true,
        () => false,
      ))
    ) {
      step("right-click raised no contextmenu here; dispatching it");
      await inToolbar(
        `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))`,
      );
      await waitFor(menuOpen, "the menu (contextmenu event)", 3000);
    }
  };

  // 1. Hold Back.
  await mouse(BACK, "left", { hold: 900 });
  await waitFor(menuOpen, "the back menu to open on hold", 5000);
  await delay(400);
  const backRows = await menuRows();
  step(`back menu: ${JSON.stringify(backRows)}`);
  assert.ok(backRows.length >= 2, "the back menu lists the earlier pages");
  assert.equal(backRows[0].title, "Page /two", "newest back entry first");
  assert.equal(backRows[1].title, "Page /one", "then the one before");
  assert.equal(
    await activeUrl(),
    `${origin}/three`,
    "holding Back did not also go back",
  );
  assert.ok(
    await inToolbar(
      'Array.from(document.querySelectorAll("#nav-history-menu .nav-history-menu-item")).some((row) => row.textContent.includes("Show Full History"))',
    ),
    "Show Full History row",
  );
  const fit = await inToolbar(
    '(() => { const r = document.querySelector("#nav-history-menu").getBoundingClientRect(); return { bottom: Math.ceil(r.bottom), body: parseFloat(getComputedStyle(document.querySelector("#nav-history-menu .nav-history-menu-item")).fontSize) } })()',
  );
  const viewHeight = toolbar.getBounds().height;
  step(`fit: ${JSON.stringify({ ...fit, viewHeight })}`);
  assert.ok(
    fit.bottom <= viewHeight,
    `the menu fits inside the toolbar view (bottom ${fit.bottom}px, view ${viewHeight}px)`,
  );
  assert.ok(fit.body >= 13, "menu uses the popover type scale");
  if (SHOTS)
    writeFileSync(
      `${SHOTS}-back.png`,
      (await toolbar.webContents.capturePage()).toPNG(),
    );

  // 2. Escape closes; a quick click goes back.
  toolbar.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  toolbar.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(
    async () => !(await menuOpen()),
    "the menu to close on Escape",
    3000,
  );
  await delay(200);
  // A press on the page (a separate WebContentsView the toolbar never hears) closes it too.
  await rightClick(BACK);
  await delay(300);
  const page = webContents
    .getAllWebContents()
    .find(
      (contents) =>
        contents.getURL() === `${origin}/three` && surfaceOf(contents) === null,
    );
  page.sendInputEvent({
    type: "mouseDown",
    x: 600,
    y: 400,
    button: "left",
    clickCount: 1,
  });
  page.sendInputEvent({
    type: "mouseUp",
    x: 600,
    y: 400,
    button: "left",
    clickCount: 1,
  });
  await waitFor(
    async () => !(await menuOpen()),
    "the menu to close on a press on the page",
    3000,
  );
  assert.equal(
    await activeUrl(),
    `${origin}/three`,
    "dismissing the menu did not navigate",
  );
  await delay(200);
  await mouse(BACK, "left");
  await pageLoaded("/two");
  assert.ok(!(await menuOpen()), "a quick click does not open the menu");
  step("quick click went back to /two");
  await inToolbar("window.api.browser.forward()");
  await pageLoaded("/three");

  // 3. Right-click Back, pick /one.
  await rightClick(BACK);
  await delay(300);
  const rows = await menuRows();
  const first = rows.find((row) => row.title === "Page /one");
  assert.ok(first, "the right-click menu lists /one");
  await mouse(
    `#nav-history-menu .nav-history-menu-item[data-index="${first.index}"]`,
    "left",
  );
  await pageLoaded("/one");
  await waitFor(
    async () => !(await menuOpen()),
    "the menu to close after picking",
    3000,
  );
  step("picked /one from the back menu");
  await waitFor(
    () =>
      inToolbar(`!document.querySelector(${JSON.stringify(FORWARD)}).disabled`),
    "Forward to enable",
  );

  // Forward menu lists /two, /three.
  await rightClick(FORWARD);
  await delay(300);
  const forwardRows = await menuRows();
  step(`forward menu: ${JSON.stringify(forwardRows)}`);
  assert.deepEqual(
    forwardRows.map((row) => row.title),
    ["Page /two", "Page /three"],
    "the forward menu lists the later pages nearest first",
  );
  if (SHOTS)
    writeFileSync(
      `${SHOTS}-forward.png`,
      (await toolbar.webContents.capturePage()).toPNG(),
    );

  // 4. Middle-click /three: new tab right after this one, this tab stays on /one.
  const before = await activeTab();
  const third = forwardRows.find((row) => row.title === "Page /three");
  await mouse(
    `#nav-history-menu .nav-history-menu-item[data-index="${third.index}"]`,
    "middle",
  );
  const after = await waitFor(
    async () => {
      const state = await activeTab();
      return state.tabs.length === before.tabs.length + 1 ? state : null;
    },
    "a new tab from the middle-click",
    10000,
  );
  const currentIndex = after.tabs.findIndex(
    (tab) => tab.id === before.active.id,
  );
  assert.equal(
    after.active.id,
    before.active.id,
    "the current tab stays active (background tab)",
  );
  assert.equal(
    after.active.url,
    `${origin}/one`,
    "the current tab is still on /one",
  );
  assert.equal(
    after.tabs[currentIndex + 1]?.url,
    `${origin}/three`,
    "the new tab opens /three right after the current tab",
  );
  step(
    "middle-click opened /three in a background tab next to the current one",
  );

  // Show Full History opens the History panel.
  await waitFor(
    async () => !(await menuOpen()),
    "the menu to close after the middle-click",
    3000,
  );
  await rightClick(FORWARD);
  await delay(300);
  await mouse("#nav-history-menu .nav-history-menu-full", "left");
  await waitFor(
    async () =>
      (await inToolbar("window.api.browser.chrome.get()")).sidebarMode ===
      "history",
    "the History panel",
    5000,
  );
  step("Show Full History opened the History panel");

  // 5. A private tab gets the same menu (its own history; nothing fetched or saved).
  await inToolbar('window.api.browser.chrome.set({ sidebarMode: "tabs" })');
  await inToolbar(
    `window.api.browser.tabs.createPrivate(${JSON.stringify(`${origin}/private-a`)})`,
  );
  await pageLoaded("/private-a");
  assert.ok((await activeTab()).active.private, "the new tab is private");
  await inToolbar(
    `window.api.browser.navigate(${JSON.stringify(`${origin}/private-b`)})`,
  );
  await pageLoaded("/private-b");
  await waitFor(
    async () => (await activeTab()).active?.title === "Page /private-b",
    "/private-b title",
  );
  await waitFor(
    () =>
      inToolbar(`!document.querySelector(${JSON.stringify(BACK)}).disabled`),
    "Back to enable in the private tab",
  );
  await mouse(BACK, "left", { hold: 900 });
  await waitFor(menuOpen, "the back menu in a private tab", 5000);
  await delay(300);
  const privateRows = await menuRows();
  assert.deepEqual(
    privateRows.map((row) => row.title),
    ["Page /private-a"],
    "the private tab lists only its own history",
  );
  await mouse(
    `#nav-history-menu .nav-history-menu-item[data-index="${privateRows[0].index}"]`,
    "left",
  );
  await pageLoaded("/private-a");
  step("private tab: back menu works");

  console.log("Nav history menu smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
