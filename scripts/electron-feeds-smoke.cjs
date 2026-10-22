// Integration smoke for Feeds: add by URL (validation + 404 as results), conditional GET (304),
// new items + unread counts, the Settings → Integrations → Feeds view (badge, item click opens a tab and marks it
// read, mark all read), auto-discovery from the current page, a site URL that advertises one feed,
// a failing feed shown as an error, edit / remove, and feeds.json persistence. Local fixture
// server only. Runs the production build: `bun run build && bun run test:electron-feeds`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-feeds-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const root = join(tmpdir(), `surffish-feeds-smoke-${process.pid}`);
const userData = join(root, "user-data");
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS;
const atomFixture = readFileSync(
  resolve(__dirname, "../src/shared/fixtures/feeds/atom.xml"),
  "utf8",
);

let rssVersion = 1;
let failing = false;
const hits = { rss: 0, rss304: 0, atom: 0, broken: 0 };
let lastIfNoneMatch = null;

function rssBody(origin) {
  const item = (n, day) =>
    `<item><title>Patch ${n}</title><link>${origin}/post/${n}</link><guid>post-${n}</guid><pubDate>${new Date(Date.UTC(2026, 9, day, 9)).toUTCString()}</pubDate><description>&lt;p&gt;Notes for patch ${n}&lt;/p&gt;</description></item>`;
  const items =
    rssVersion >= 2
      ? [item(3, 13), item(2, 12), item(1, 11)]
      : [item(2, 12), item(1, 11)];
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Smoke Patch Notes</title><link>${origin}/</link>${items.join("")}</channel></rss>`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const origin = `http://${request.headers.host}`;
  if (url.pathname === "/rss.xml") {
    hits.rss += 1;
    const etag = `"rss-v${rssVersion}"`;
    lastIfNoneMatch = request.headers["if-none-match"] ?? null;
    if (lastIfNoneMatch === etag) {
      hits.rss304 += 1;
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
      ETag: etag,
    });
    response.end(rssBody(origin));
    return;
  }
  if (url.pathname === "/atom.xml") {
    hits.atom += 1;
    response.writeHead(200, { "Content-Type": "application/atom+xml" });
    response.end(atomFixture);
    return;
  }
  if (url.pathname === "/broken.xml") {
    hits.broken += 1;
    if (failing) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("boom");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/rss+xml" });
    response.end(
      `<rss><channel><title>Flaky</title><item><title>One</title><guid>one</guid><link>${origin}/post/1</link></item></channel></rss>`,
    );
    return;
  }
  if (url.pathname === "/page.html") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html><head><title>Fixture site</title>
      <link rel="alternate" type="application/rss+xml" title="Site RSS" href="/rss.xml">
      <link rel="alternate" type="application/atom+xml" title="Site Atom" href="atom.xml">
      </head><body><h1>Fixture site</h1></body></html>`);
    return;
  }
  if (url.pathname === "/single.html") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      '<!doctype html><html><head><title>One feed</title><link rel="alternate" type="application/rss+xml" href="/broken.xml"></head><body>hi</body></html>',
    );
    return;
  }
  if (url.pathname.startsWith("/post/")) {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      `<!doctype html><html><head><title>${url.pathname}</title></head><body>${url.pathname}</body></html>`,
    );
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not Found");
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

function surface(name) {
  return mainWindow.contentView.children.find((view) => {
    try {
      return (
        view.webContents &&
        new URL(view.webContents.getURL()).searchParams.get("surface") === name
      );
    } catch {
      return false;
    }
  });
}

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
  await delay(500);
  writeFileSync(
    join(screenshots, name),
    (await view.webContents.capturePage()).toPNG(),
  );
}

const feedsApi = (call) => `window.api.browser.feeds.${call}`;

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
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 860 });
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
        'document.readyState === "complete" && Boolean(window.api?.browser?.feeds)',
      ),
    "the toolbar renderer",
  );

  // --- nothing configured: empty, no file, no fetches
  const empty = await evaluate(toolbar, feedsApi("list()"));
  assert.deepEqual(empty.feeds, []);
  assert.equal(empty.totalUnread, 0);
  assert.equal(
    existsSync(join(userData, "feeds.json")),
    false,
    "no feeds.json until something is followed",
  );

  // --- bad input is a result, never a thrown IPC error
  const rejected = await evaluate(
    toolbar,
    feedsApi('add({ url: "file:///etc/passwd" })'),
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /http\(s\)/);
  const garbage = await evaluate(
    toolbar,
    feedsApi('update("nope", { intervalMinutes: 2 })'),
  );
  assert.equal(garbage.ok, false);
  const missing = await evaluate(
    toolbar,
    feedsApi(`add({ url: ${JSON.stringify(`${origin}/missing.xml`)} })`),
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /404/);
  console.log("feeds: validation ok");

  // --- add RSS: fetched once, two unread items
  const added = await evaluate(
    toolbar,
    feedsApi(`add({ url: ${JSON.stringify(`${origin}/rss.xml`)} })`),
  );
  assert.equal(added.ok, true, added.error);
  assert.equal(added.feed.title, "Smoke Patch Notes");
  assert.equal(added.feed.unreadCount, 2);
  assert.equal(added.feed.notify, false, "notifications default off");
  assert.equal(hits.rss, 1);
  const rssId = added.feed.id;
  const duplicate = await evaluate(
    toolbar,
    feedsApi(`add({ url: ${JSON.stringify(`${origin}/rss.xml`)} })`),
  );
  assert.equal(duplicate.ok, false);

  // --- conditional GET: unchanged feed answers 304
  const refreshed = await evaluate(
    toolbar,
    feedsApi(`refresh(${JSON.stringify(rssId)})`),
  );
  assert.equal(refreshed.ok, true);
  assert.equal(lastIfNoneMatch, '"rss-v1"', "ETag sent back as If-None-Match");
  assert.equal(hits.rss304, 1);
  assert.equal(refreshed.snapshot.feeds[0].unreadCount, 2);
  assert.equal(refreshed.snapshot.feeds[0].lastError, null);

  // --- a new item arrives
  rssVersion = 2;
  const updated = await evaluate(
    toolbar,
    feedsApi(`refresh(${JSON.stringify(rssId)})`),
  );
  assert.equal(updated.snapshot.feeds[0].unreadCount, 3);
  assert.equal(updated.snapshot.totalUnread, 3);
  console.log("feeds: conditional GET + new items ok");

  // --- Settings → Integrations → Feeds: badge, items, click opens a tab and marks read
  // Feeds lives under Integrations: the nav has no Feeds entry; Integrations opens on Extensions with
  // the unread badge on the nav entry, and the Feeds tab mounts the view.
  await evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "integrations" })',
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.querySelector(".settings-page-heading-copy h1")?.textContent === "Integrations" && document.querySelector(".integrations-tabs [aria-selected=true]")?.textContent.trim() === "Extensions"',
      ),
    "Integrations opening on Extensions",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        '[...document.querySelectorAll(".settings-subnav button")].some((b) => b.textContent.startsWith("Integrations") && b.classList.contains("is-current") && b.querySelector(".settings-subnav-badge")?.textContent === "3")',
      ),
    "the unread badge on the Integrations nav entry",
  );
  assert.equal(
    await evaluate(
      content,
      '[...document.querySelectorAll(".settings-subnav button")].some((b) => b.textContent.startsWith("Feeds"))',
    ),
    false,
    "no standalone Feeds settings tab",
  );
  assert.equal(
    await evaluate(
      content,
      'Boolean(document.querySelector(".feed-items-group"))',
    ),
    false,
    "Extensions does not mount Feeds",
  );
  await evaluate(
    content,
    '[...document.querySelectorAll(".integrations-tabs button")].find((b) => b.textContent.startsWith("Feeds")).click()',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).settings
        ?.section === "feeds",
    "the Feeds tab to select Integrations → Feeds",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.querySelectorAll(".settings-view-feeds .feed-items .feed-item").length === 3',
      ),
    "the Feeds view with three items",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        '[...document.querySelectorAll(".integrations-tabs button")].some((b) => b.textContent.startsWith("Feeds") && b.getAttribute("aria-selected") === "true" && b.querySelector(".settings-subnav-badge")?.textContent === "3")',
      ),
    "the Feeds tab unread badge",
  );
  assert.equal(
    await evaluate(
      content,
      'document.querySelector(".settings-subnav button.is-current")?.textContent.startsWith("Integrations")',
    ),
    true,
    "Integrations stays the current nav entry on Feeds",
  );
  assert.equal(
    await evaluate(
      content,
      'document.querySelector(".feed-items .feed-item-title").textContent',
    ),
    "Patch 3",
    "newest first",
  );
  await screenshot(content, "feeds-view.png");
  const tabsBefore = (await evaluate(toolbar, "window.api.browser.tabs.get()"))
    .length;
  await evaluate(
    content,
    'document.querySelector(".feed-items .feed-item").click()',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.tabs.get()")).some(
        (tab) => tab.url === `${origin}/post/3`,
      ),
    "the item to open in a new tab",
  );
  assert.equal(
    (await evaluate(toolbar, "window.api.browser.tabs.get()")).length,
    tabsBefore + 1,
  );
  await waitFor(
    async () => (await evaluate(toolbar, feedsApi("list()"))).totalUnread === 2,
    "the opened item to be marked read",
  );

  // --- mark all read from the view
  await evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "feeds" })',
  );
  await waitFor(
    () =>
      evaluate(
        content,
        '(() => { const b = document.querySelector(".feed-mark-all"); if (b && !b.disabled) { b.click(); return true } return false })()',
      ),
    "the Mark all read button",
  );
  await waitFor(
    async () => (await evaluate(toolbar, feedsApi("list()"))).totalUnread === 0,
    "mark all read",
  );
  console.log("feeds: view, open item, mark all read ok");

  // --- discovery from the current page
  await evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "tabs" })',
  );
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/page.html`)})`,
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).title ===
      "Fixture site",
    "the fixture site to load",
  );
  const discovered = await evaluate(toolbar, feedsApi("discover()"));
  assert.equal(discovered.ok, true, discovered.error);
  assert.deepEqual(
    discovered.feeds.map((feed) => [feed.url, feed.type, feed.followed]),
    [
      [`${origin}/rss.xml`, "rss", true],
      [`${origin}/atom.xml`, "atom", false],
    ],
  );
  // The palette path (Cmd+K "Add Feed from This Site…") lands on Integrations → Feeds.
  await evaluate(
    toolbar,
    'window.api.browser.commands.run("feeds.addFromPage")',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).settings
        ?.section === "feeds",
    "the palette command to open Integrations → Feeds",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.querySelector(".settings-page-heading-copy h1")?.textContent === "Integrations"',
      ),
    "the Integrations heading",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'Boolean(document.querySelector(".feed-discover-button"))',
      ),
    "the discover button",
  );
  await evaluate(
    content,
    'document.querySelector(".feed-discover-button").click()',
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.querySelectorAll(".feed-discovered li").length === 2',
      ),
    "discovered feeds in the view",
  );
  await evaluate(
    content,
    '[...document.querySelectorAll(".feed-discovered li")].find((li) => li.textContent.includes("atom.xml")).querySelector("button").click()',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, feedsApi("list()"))).feeds.some(
        (feed) =>
          feed.url === `${origin}/atom.xml` &&
          feed.title === "TV Episode Tracker",
      ),
    "the discovered Atom feed to be followed",
  );
  console.log("feeds: discovery ok");

  // --- a site address that advertises one feed is followed through to it
  const viaPage = await evaluate(
    toolbar,
    feedsApi(`add({ url: ${JSON.stringify(`${origin}/single.html`)} })`),
  );
  assert.equal(viaPage.ok, true, viaPage.error);
  assert.equal(viaPage.feed.url, `${origin}/broken.xml`);

  // --- failures are visible, not silent
  failing = true;
  const broken = await evaluate(
    toolbar,
    feedsApi(`refresh(${JSON.stringify(viaPage.feed.id)})`),
  );
  const brokenFeed = broken.snapshot.feeds.find(
    (feed) => feed.id === viaPage.feed.id,
  );
  assert.equal(brokenFeed.consecutiveErrors, 1);
  assert.match(brokenFeed.lastError, /HTTP 500/);
  assert.ok(brokenFeed.nextCheckAt > Date.now(), "backs off");
  await waitFor(
    () =>
      evaluate(
        content,
        '[...document.querySelectorAll(".feed-row.is-failing .watcher-status.is-error")].some((el) => el.textContent.includes("HTTP 500"))',
      ),
    "the failing feed shown as an error",
  );
  await screenshot(content, "feeds-error.png");
  console.log("feeds: errors visible ok");

  // --- edit, notify toggle, remove
  const renamed = await evaluate(
    toolbar,
    feedsApi(
      `update(${JSON.stringify(rssId)}, { title: "Patches", intervalMinutes: 60, notify: true })`,
    ),
  );
  assert.equal(renamed.ok, true, renamed.error);
  const rssSummary = renamed.snapshot.feeds.find((feed) => feed.id === rssId);
  assert.equal(rssSummary.title, "Patches");
  assert.equal(rssSummary.effectiveIntervalMinutes, 60);
  assert.equal(rssSummary.notify, true);
  const removed = await evaluate(
    toolbar,
    feedsApi(`remove(${JSON.stringify(viaPage.feed.id)})`),
  );
  assert.equal(removed.ok, true);
  assert.equal(removed.snapshot.feeds.length, 2);
  const settings = await evaluate(
    toolbar,
    feedsApi("setSettings({ intervalMinutes: 7 })"),
  );
  assert.equal(settings.ok, false);

  // --- persisted, owner-only
  // Writes are coalesced: an older file can already hold two feeds (before the third was added), so
  // wait for the one that carries the rename too.
  await waitFor(
    () => {
      if (!existsSync(join(userData, "feeds.json"))) return false;
      const saved = JSON.parse(
        readFileSync(join(userData, "feeds.json"), "utf8"),
      );
      return (
        saved.feeds.length === 2 &&
        saved.feeds.find((feed) => feed.id === rssId)?.customTitle === "Patches"
      );
    },
    "feeds.json to be written",
    10000,
  );
  const stored = JSON.parse(readFileSync(join(userData, "feeds.json"), "utf8"));
  assert.equal(
    stored.feeds.find((feed) => feed.id === rssId).customTitle,
    "Patches",
  );
  assert.equal(stored.feeds.find((feed) => feed.id === rssId).etag, '"rss-v2"');
  if (process.platform !== "win32")
    assert.equal(statSync(join(userData, "feeds.json")).mode & 0o777, 0o600);

  console.log("Electron feeds smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron feeds smoke failed:", error);
    app.exit(1);
  },
);
