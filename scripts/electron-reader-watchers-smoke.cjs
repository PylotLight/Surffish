// Integration smoke for Reader view and page watchers: readerable detection lights the omnibox
// button, Reader view renders a sanitized article with proxied images on its own scheme, settings
// persist, Back to page restores the page; a watcher takes a baseline, sees a change (diff + badge),
// watches a selector, and the Watchers settings section renders.
// Runs the production build: `bun run build && bun run test:electron-reader-watchers`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-reader-watchers-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const root = join(tmpdir(), `surffish-reader-smoke-${process.pid}`);
const userData = join(root, "user-data");
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS;
// 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
let price = 49;
let imageRequests = 0;
let watchRequests = 0;
const paragraph = (index) =>
  `<p>Paragraph ${index}: reader view should pick up this long run of article text, which goes on for a while so that Readability is confident this page is an article and not a list of links or a navigation page.</p>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/img.png") {
    imageRequests += 1;
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    });
    response.end(PNG);
    return;
  }
  if (url.pathname === "/watch") {
    watchRequests += 1;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      `<!doctype html><title>Kettle</title><header><nav>Menu</nav></header><div id="content"><h1>Kettle</h1><p id="price">Price: $${price}</p><p>Ships in 2 days</p></div><footer>© ${Date.now()}</footer>`,
    );
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smoke article</title><meta name="author" content="Smoke Writer"></head><body>
    <nav><a href="/">Home</a></nav>
    <article><h1>Smoke article</h1>
      ${Array.from({ length: 12 }, (_, index) => paragraph(index)).join("\n")}
      <figure><img src="/img.png" alt="pixel" onerror="window.pwned = 1"><figcaption>A pixel</figcaption></figure>
      <p>Inline <a href="javascript:alert(1)">bad link</a> and <a href="/other">good link</a>.</p>
      <script>window.pwned = 2</script>
      <iframe src="/frame"></iframe>
    </article></body></html>`);
});

let mainWindow;
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(
  predicate,
  description,
  timeout = Number(process.env.SMOKE_WAIT_MS || 20000),
) {
  if (process.env.SMOKE_DEBUG) console.log("waiting:", description);
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
  await delay(500);
  const image = await view.webContents.capturePage();
  writeFileSync(join(screenshots, name), image.toPNG());
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
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
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

  // --- Reader view
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/2026/smoke-article`)})`,
  );
  const page = await waitFor(
    () => viewWithUrl(`${origin}/2026/smoke-article`),
    "the article page",
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).reader ===
      "available",
    "readerable detection to light the Reader button",
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'Boolean(document.querySelector(".reader-mode-button"))',
      ),
    "the omnibox Reader button",
  );
  await evaluate(
    toolbar,
    'document.querySelector(".reader-mode-button").click()',
  );
  const reader = await waitFor(
    () => viewWithUrl("surffish-reader://reader/"),
    "the reader view",
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).reader ===
      "active",
    "Reader view to be active",
  );
  await waitFor(
    () => evaluate(reader, 'Boolean(document.querySelector(".reader-title"))'),
    "the article to render",
  );
  assert.equal(
    views().includes(page),
    false,
    "the page view leaves the window while Reader view covers it",
  );
  const rendered = await evaluate(
    reader,
    `(() => ({
    title: document.querySelector('.reader-title').textContent,
    byline: document.querySelector('.reader-byline').textContent,
    meta: document.querySelector('#meta').textContent,
    scripts: document.querySelectorAll('.reader-content script, .reader-content iframe').length,
    handlers: [...document.querySelectorAll('.reader-content *')].some((node) => [...node.attributes].some((attribute) => attribute.name.startsWith('on'))),
    images: [...document.querySelectorAll('.reader-content img')].map((image) => image.getAttribute('src')),
    links: [...document.querySelectorAll('.reader-content a')].map((link) => link.getAttribute('href')),
    pwned: window.pwned ?? null
  }))()`,
  );
  assert.equal(rendered.title, "Smoke article");
  assert.match(rendered.meta, /min read/);
  assert.equal(rendered.scripts, 0, "scripts and iframes are stripped");
  assert.equal(rendered.handlers, false, "inline event handlers are stripped");
  assert.equal(rendered.pwned, null);
  assert.equal(rendered.images.length, 1);
  assert.match(rendered.images[0], /^surffish-reader:\/\/reader\/image\?d=/);
  assert.ok(rendered.links.includes(`${origin}/other`), "normal links stay");
  assert.ok(
    !rendered.links.some((href) => href && href.startsWith("javascript:")),
    "javascript: links are dropped",
  );
  await waitFor(
    () =>
      evaluate(
        reader,
        'document.querySelector(".reader-content img").complete && document.querySelector(".reader-content img").naturalWidth === 1',
      ),
    "the article image through the main-process proxy",
  );
  assert.ok(imageRequests >= 1);
  // The reader session itself has no network: a direct fetch is refused.
  const direct = await evaluate(
    reader,
    `fetch(${JSON.stringify(`${origin}/img.png`)}).then(() => 'loaded', () => 'blocked')`,
  );
  assert.equal(direct, "blocked");
  // An image the article does not reference is not proxied.
  const notInArticle = await evaluate(
    reader,
    `new Promise((resolve) => { const image = new Image(); image.onload = () => resolve('loaded'); image.onerror = () => resolve('refused'); image.src = document.querySelector('.reader-content img').src.replace(/u=[^&]+/, 'u=' + encodeURIComponent(${JSON.stringify(`${origin}/img.png?other`)})) })`,
  );
  assert.equal(notInArticle, "refused");
  // Settings: theme + size apply and persist.
  await evaluate(
    reader,
    'document.querySelector("#settingsToggle").click(); document.querySelector("[data-theme=\\"sepia\\"]").click(); document.querySelector("#larger").click(); true',
  );
  await waitFor(
    () =>
      evaluate(reader, 'document.documentElement.dataset.theme === "sepia"'),
    "the sepia theme",
  );
  await screenshot(reader, "reader-view.png");
  await waitFor(
    () =>
      existsSync(join(userData, "reader-settings.json")) &&
      JSON.parse(readFileSync(join(userData, "reader-settings.json"), "utf8"))
        .theme === "sepia",
    "reader-settings.json",
    5000,
  );
  assert.equal(
    JSON.parse(readFileSync(join(userData, "reader-settings.json"), "utf8"))
      .fontSize,
    20,
  );
  // Back to page.
  // Clicked after the evaluation returns: Back closes this view, which would orphan the promise.
  await evaluate(
    reader,
    'setTimeout(() => document.querySelector("#back").click(), 0); true',
  );
  await waitFor(
    () => !viewWithUrl("surffish-reader://reader/") && views().includes(page),
    "Back to page to restore the page view",
  );
  assert.equal(
    (await evaluate(toolbar, "window.api.browser.state()")).reader,
    "available",
  );

  // --- Page watchers
  const added = await evaluate(
    content,
    `window.api.browser.watchers.add({ url: ${JSON.stringify(`${origin}/watch`)}, intervalMinutes: 15 })`,
  );
  assert.equal(added.ok, true, added.error);
  const id = added.watcher.id;
  const watcherState = async () =>
    (
      await evaluate(content, "window.api.browser.watchers.list()")
    ).watchers.find((entry) => entry.id === id);
  await evaluate(
    content,
    `window.api.browser.watchers.checkNow(${JSON.stringify(id)})`,
  );
  await waitFor(
    async () => (await watcherState())?.lastCheckedAt !== null,
    "the baseline check",
  );
  let state = await watcherState();
  assert.equal(state.lastError, null, state.lastError);
  assert.equal(state.lastDiff, null, "the first check is a baseline");
  assert.ok(state.snapshotLines >= 2);
  // The footer timestamp changes on every request but is page chrome, so it is ignored.
  await evaluate(
    content,
    `window.api.browser.watchers.checkNow(${JSON.stringify(id)})`,
  );
  await waitFor(
    async () => (await watcherState()).lastCheckedAt > state.lastCheckedAt,
    "a second check",
  );
  assert.equal(
    (await watcherState()).unseen,
    false,
    "unchanged text is not a change",
  );
  price = 55;
  state = await watcherState();
  await evaluate(
    content,
    `window.api.browser.watchers.checkNow(${JSON.stringify(id)})`,
  );
  await waitFor(
    async () => (await watcherState()).unseen,
    "the change to be detected",
  );
  state = await watcherState();
  assert.deepEqual(
    state.lastDiff.lines.filter((line) => line.type !== "context"),
    [
      { type: "removed", text: "Price: $49" },
      { type: "added", text: "Price: $55" },
    ],
  );
  assert.equal(state.nextCheckAt - state.lastCheckedAt, 15 * 60_000);
  // Watch a selector instead: new baseline.
  await evaluate(
    content,
    `window.api.browser.watchers.update(${JSON.stringify(id)}, { selector: '#price' })`,
  );
  await evaluate(
    content,
    `window.api.browser.watchers.checkNow(${JSON.stringify(id)})`,
  );
  await waitFor(
    async () => (await watcherState()).snapshotLines === 1,
    "the selector baseline",
  );
  const badSelector = await evaluate(
    content,
    `window.api.browser.watchers.update(${JSON.stringify(id)}, { selector: 'a[' })`,
  );
  assert.equal(
    badSelector.ok,
    false,
    "a bad selector is a validation result, not a thrown IPC error",
  );
  assert.match(badSelector.error, /not supported|not valid/);
  // Settings → Watchers renders the list with the badge.
  await evaluate(
    content,
    `window.api.browser.watchers.update(${JSON.stringify(id)}, { selector: null })`,
  );
  await evaluate(
    content,
    `window.api.browser.watchers.checkNow(${JSON.stringify(id)})`,
  );
  await waitFor(
    async () => (await watcherState()).snapshotLines >= 2,
    "the main-text baseline again",
  );
  price = 60;
  await evaluate(
    content,
    `window.api.browser.watchers.checkNow(${JSON.stringify(id)})`,
  );
  await waitFor(async () => (await watcherState()).unseen, "another change");
  await evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "watchers" })',
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'Boolean(document.querySelector(".watcher-item.is-unseen")) && Boolean(document.querySelector(".settings-subnav-badge"))',
      ),
    "the Watchers section with its badge",
  );
  await evaluate(
    content,
    '[...document.querySelectorAll(".watcher-actions button")].find((button) => button.textContent === "Changes").click(); true',
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.querySelectorAll(".watcher-diff-lines li.is-added").length > 0',
      ),
    "the diff view",
  );
  await screenshot(content, "watchers-settings.png");
  await waitFor(
    async () => !(await watcherState()).unseen,
    "opening the diff to clear the badge",
  );
  // Persisted through the deferred writer.
  await waitFor(
    () => {
      const saved = JSON.parse(
        readFileSync(join(userData, "page-watchers.json"), "utf8"),
      );
      return (
        saved.version === 1 &&
        saved.watchers.length === 1 &&
        saved.watchers[0].snapshot.includes("Price: $60")
      );
    },
    "page-watchers.json",
    6000,
  );
  const removed = await evaluate(
    content,
    `window.api.browser.watchers.remove(${JSON.stringify(id)})`,
  );
  assert.equal(removed.watchers.length, 0);
  assert.ok(watchRequests >= 6);

  console.log("Electron reader + watchers smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron reader + watchers smoke failed:", error);
    app.exit(1);
  },
);
