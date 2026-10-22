// Integration smoke for the Reading List: Cmd/Ctrl+Shift+L saves the current page (with its
// description, site name and an offline Reader copy), the toolbar unread badge, the popover
// (Unread / All, search, open marks read, mark unread, remove), Cmd+K entries, saving a link without
// opening it, re-saving moves to the top, private tabs refused, "open in Reader" falling back to the
// saved copy when the live page has no article, and the surffish.db rows (tombstone, no URL left).
// Local fixture server only. Runs the production build: `bun run build && bun run test:electron-reading-list`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-reading-list-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const root = join(tmpdir(), `surffish-reading-list-smoke-${process.pid}`);
const userData = join(root, "user-data");
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS;
const isMac = process.platform === "darwin";

let articleOnline = true;
const paragraph = (index) =>
  `<p>Paragraph ${index}: a long article about saving pages to read later, which goes on for a while so that Readability is confident this page is an article and not a list of links.</p>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (url.pathname === "/article") {
    if (!articleOnline) {
      response.end(
        "<!doctype html><title>Gone</title><p>Service unavailable</p>",
      );
      return;
    }
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Later article</title>
      <meta name="description" content="Why a reading list is not a bookmark.">
      <meta property="og:site_name" content="Smoke Weekly"></head><body>
      <article><h1>Later article</h1>${Array.from({ length: 12 }, (_, index) => paragraph(index)).join("\n")}</article></body></html>`);
    return;
  }
  if (url.pathname === "/links") {
    response.end(
      '<!doctype html><title>Links</title><p><a id="l1" href="/linked">A linked story</a></p>',
    );
    return;
  }
  response.end(
    `<!doctype html><title>${url.pathname.slice(1) || "home"}</title><p>${url.pathname}</p>`,
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
  smoke.step(`waiting: ${description}`);
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(60);
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
const views = () =>
  mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (name) => views().find((view) => surfaceFor(view) === name);
const viewWithUrl = (prefix) =>
  views().find((view) => view.webContents.getURL().startsWith(prefix));

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
}

async function screenshot(view, name) {
  if (!screenshots) return;
  mkdirSync(screenshots, { recursive: true });
  await delay(400);
  writeFileSync(
    join(screenshots, name),
    (await view.webContents.capturePage()).toPNG(),
  );
}

const rl = (call) => `window.api.browser.readingList.${call}`;

function profileRows(sql) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(join(userData, "surffish.db"), {
    readOnly: true,
  });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
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
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 820 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api?.browser?.readingList)',
      ),
    "the toolbar renderer",
  );

  // --- Cmd+K lists both entries
  const commands = (
    await evaluate(toolbar, "window.api.browser.commands.list()")
  ).commands;
  const add = commands.find((command) => command.id === "readingList.add");
  assert.ok(
    add && commands.some((command) => command.id === "readingList.show"),
    "palette has Add to / Open Reading List",
  );
  assert.equal(add.accelerator, "CmdOrCtrl+Shift+L");
  assert.equal(add.enabled, false, "nothing to save on the New Tab page");

  // --- nothing saved: the lazy module answers with an empty list
  assert.deepEqual(await evaluate(toolbar, rl("get()")), {
    items: [],
    unread: 0,
  });

  // --- the shortcut saves the article page (description, site name, offline copy)
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/article`)})`,
  );
  const page = await waitFor(
    () => viewWithUrl(`${origin}/article`),
    "the article page view",
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).reader ===
      "available",
    "readerable detection",
  );
  page.webContents.focus();
  page.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "L",
    modifiers: [isMac ? "meta" : "control", "shift"],
  });
  page.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "L",
    modifiers: [isMac ? "meta" : "control", "shift"],
  });
  const saved = await waitFor(async () => {
    const snapshot = await evaluate(toolbar, rl("get()"));
    return snapshot.items.length === 1 && snapshot.items[0].hasSnapshot
      ? snapshot
      : null;
  }, "Cmd/Ctrl+Shift+L to save the page with an offline copy");
  const article = saved.items[0];
  assert.equal(article.title, "Later article");
  assert.equal(article.siteName, "Smoke Weekly");
  assert.equal(article.excerpt, "Why a reading list is not a bookmark.");
  assert.equal(article.readAt, null);
  assert.equal(saved.unread, 1);
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.querySelector(".reading-list-badge")?.textContent === "1"',
      ),
    "the unread badge",
  );
  console.log(
    "reading list: shortcut save + metadata + offline copy + badge ok",
  );

  // --- a link is saved without opening it; bad input is a result, not a throw
  const tabsBefore = (await evaluate(toolbar, "window.api.browser.tabs.get()"))
    .length;
  const link = await evaluate(
    toolbar,
    rl(
      `add({ url: ${JSON.stringify(`${origin}/linked`)}, title: "A linked story" })`,
    ),
  );
  assert.equal(link.ok, true, link.error);
  assert.equal(link.created, true);
  assert.equal(
    (await evaluate(toolbar, "window.api.browser.tabs.get()")).length,
    tabsBefore,
    "no tab opened for a saved link",
  );
  const bad = await evaluate(toolbar, rl('add({ url: "file:///etc/passwd" })'));
  assert.equal(bad.ok, false);
  assert.equal((await evaluate(toolbar, rl('setRead(42, "yes")'))).ok, false);

  // --- saving the same page again moves it to the top instead of a second copy
  const again = await evaluate(
    toolbar,
    rl(`add({ url: ${JSON.stringify(`${origin}/article#comments`)} })`),
  );
  assert.equal(again.created, false);
  assert.equal(again.snapshot.items.length, 2);
  assert.equal(again.snapshot.items[0].id, article.id);

  // --- private tabs are refused
  await evaluate(
    toolbar,
    `window.api.browser.tabs.createPrivate(${JSON.stringify(`${origin}/secret`)})`,
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).private === true,
    "the private tab",
  );
  const refused = await evaluate(toolbar, rl("addTab()"));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Private/);
  assert.equal(
    (
      await evaluate(toolbar, "window.api.browser.commands.list()")
    ).commands.find((command) => command.id === "readingList.add").enabled,
    false,
  );
  console.log("reading list: link save, re-save, private refusal ok");

  // --- the popover: Open Reading List (palette) right as the private tab closes. Main switches back
  // to the article tab and opens the popover in the same breath; the toolbar hears of the switch
  // from the per-frame coalesced tab broadcast, which used to land after the popover opened and
  // close it as "the old tab's popover" (CI flake, Oct 2026). Both requests go out back to back on
  // purpose, so this is a regression test for that race rather than a lucky ordering.
  const articleTabId = (
    await evaluate(toolbar, "window.api.browser.tabs.get()")
  ).find((tab) => tab.url.startsWith(`${origin}/article`))?.id;
  assert.ok(
    articleTabId,
    "the article tab is still open behind the private tab",
  );
  await evaluate(
    toolbar,
    `(() => {
    window.__smokeActiveTabSeen = null
    window.api.browser.tabs.onChange((tabs) => { window.__smokeActiveTabSeen = tabs.find((tab) => tab.active)?.id ?? null })
    return true
  })()`,
  );
  await evaluate(
    toolbar,
    'window.api.browser.tabs.get().then((tabs) => Promise.all([window.api.browser.tabs.close(tabs.find((tab) => tab.active).id), window.api.browser.commands.run("readingList.show")]))',
  );
  const afterClose = await evaluate(toolbar, "window.api.browser.state()");
  assert.equal(afterClose.private, false, "back to a normal tab");
  assert.ok(
    afterClose.activeTabSince > 0,
    "state carries when the tab became active",
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.querySelectorAll("#reading-list-popover .reading-list-item").length === 2',
      ),
    "the popover with two unread items",
  );
  // The late tab broadcast has now reached the toolbar (and React has committed it): still open.
  await waitFor(
    () =>
      evaluate(
        toolbar,
        `window.__smokeActiveTabSeen === ${JSON.stringify(articleTabId)}`,
      ),
    "the tab switch broadcast to reach the toolbar",
  );
  await evaluate(
    toolbar,
    "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(true)))))",
  );
  assert.equal(
    await evaluate(
      toolbar,
      'document.querySelectorAll("#reading-list-popover .reading-list-item").length',
    ),
    2,
    "the tab switch that came before Open Reading List left the popover open",
  );
  await screenshot(toolbar, "reading-list-popover.png");
  await evaluate(
    toolbar,
    `(() => { const input = document.querySelector('.reading-list-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'linked'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.querySelectorAll("#reading-list-popover .reading-list-item").length === 1 && document.querySelector(".reading-list-title").textContent === "A linked story"',
      ),
    "search to narrow the list",
  );
  await evaluate(
    toolbar,
    'document.querySelector(".reading-list-item-open").click()',
  );
  await waitFor(
    () => viewWithUrl(`${origin}/linked`),
    "opening the item in the current tab",
  );
  await waitFor(
    async () => (await evaluate(toolbar, rl("get()"))).unread === 1,
    "opening to mark it read",
  );
  await waitFor(
    () => evaluate(toolbar, '!document.querySelector("#reading-list-popover")'),
    "the popover to close after opening",
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.querySelector(".reading-list-badge")?.textContent === "1"',
      ),
    "the badge to drop to 1",
  );

  // Unread hides the read item; All shows it, and mark unread brings it back.
  await evaluate(
    toolbar,
    'document.querySelector(".reading-list-button").click()',
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.querySelectorAll("#reading-list-popover .reading-list-item").length === 1',
      ),
    "Unread showing one item",
  );
  await evaluate(
    toolbar,
    '[...document.querySelectorAll(".reading-list-filter button")].find((b) => b.textContent === "All").click()',
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.querySelectorAll("#reading-list-popover .reading-list-item").length === 2',
      ),
    "All showing both",
  );
  await evaluate(
    toolbar,
    'document.querySelector(".reading-list-item:not(.is-unread) .reading-list-item-actions button").click()',
  );
  await waitFor(
    async () => (await evaluate(toolbar, rl("get()"))).unread === 2,
    "mark unread",
  );
  // Outside press (Escape) closes it like every toolbar popover; it must still be open first, or
  // the check below proves nothing.
  assert.equal(
    await evaluate(
      toolbar,
      'Boolean(document.querySelector("#reading-list-popover"))',
    ),
    true,
    "popover still open before Escape",
  );
  toolbar.webContents.focus();
  toolbar.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  toolbar.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitFor(
    () => evaluate(toolbar, '!document.querySelector("#reading-list-popover")'),
    "Escape to close the popover",
  );
  console.log("reading list: popover filter/search/open/mark unread ok");

  // --- Reader from the saved copy when the live page has no article any more
  articleOnline = false;
  const opened = await evaluate(
    toolbar,
    rl(`open(${JSON.stringify(article.id)}, { reader: true })`),
  );
  assert.equal(opened.ok, true, opened.error);
  const reader = await waitFor(
    () => viewWithUrl("surffish-reader://reader/"),
    "the reader view from the saved copy",
    30000,
  );
  await waitFor(
    () =>
      evaluate(
        reader,
        'document.querySelector(".reader-title")?.textContent === "Later article"',
      ),
    "the saved article to render",
  );
  assert.match(
    await evaluate(
      reader,
      'document.querySelector(".reader-content").textContent',
    ),
    /Paragraph 11/,
  );
  await screenshot(reader, "reading-list-offline-reader.png");
  await waitFor(
    async () =>
      (await evaluate(toolbar, rl("get()"))).items.find(
        (item) => item.id === article.id,
      ).readAt !== null,
    "reader open to mark it read",
  );
  articleOnline = true;
  console.log("reading list: offline reader copy ok");

  // --- surffish.db: rows, change log without the snapshot, remove leaves a blank tombstone
  const opsBefore = JSON.stringify(
    profileRows("SELECT payload FROM oplog WHERE entity = 'reading_item'"),
  );
  // The change log keeps one row per item (the latest change), so the removal shows as a newer row.
  const linkOpSeq = () =>
    Number(
      profileRows(
        `SELECT MAX(seq) AS seq FROM oplog WHERE entity = 'reading_item' AND entity_id = '${link.item.id}'`,
      )[0]?.seq ?? 0,
    );
  const linkOpBefore = linkOpSeq();
  assert.ok(linkOpBefore > 0, "the saved link is in the change log");
  // Guards for the change-log checks below: they'd pass on an empty log (wrong entity name, no writes).
  assert.ok(
    opsBefore.includes("/linked"),
    "the change log records the saved link before it is removed",
  );
  const rows = profileRows(
    "SELECT id, url, title, read_at, snapshot IS NOT NULL AS has_snapshot, deleted_at FROM reading_list ORDER BY added_at DESC",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === article.id).has_snapshot, 1);
  assert.ok(
    !JSON.stringify(
      profileRows("SELECT payload FROM oplog WHERE entity = 'reading_item'"),
    ).includes("Paragraph 11"),
    "the offline copy never enters the change log",
  );
  const removed = await evaluate(
    toolbar,
    rl(`remove(${JSON.stringify(link.item.id)})`),
  );
  assert.equal(removed.ok, true);
  assert.equal(removed.snapshot.items.length, 1);
  const tombstone = profileRows(
    `SELECT url, title, deleted_at FROM reading_list WHERE id = '${link.item.id}'`,
  )[0];
  assert.ok(
    tombstone.deleted_at !== null &&
      tombstone.url === "" &&
      tombstone.title === "",
  );
  const opsAfter = profileRows(
    "SELECT payload FROM oplog WHERE entity = 'reading_item'",
  );
  assert.ok(linkOpSeq() > linkOpBefore, "the removal is in the change log");
  assert.ok(
    !JSON.stringify(opsAfter).includes("/linked"),
    "no URL left in the change log",
  );
  console.log("reading list: database rows + tombstone ok");

  console.log("Electron reading list smoke passed.");
}

run().then(
  () => {
    server.close();
    app.exit(0);
  },
  (error) => {
    console.error("Electron reading list smoke failed:", error);
    server.close();
    app.exit(1);
  },
);
