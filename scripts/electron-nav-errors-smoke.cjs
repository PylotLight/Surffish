// Integration smoke for navigation errors: a load the page supersedes (location.replace /
// history.replaceState during load → loadURL rejects with ERR_ABORTED) shows no error, an
// unresolvable host shows the friendly copy (dismissable notice / in-page error with Retry),
// and address-bar input that can't be opened shows the invalid-address copy. Runs the production build:
// `bun run build && bun run test:electron-nav-errors`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-nav-errors-smoke.cjs`).
// Set SURFFISH_SMOKE_SCREENSHOTS=<dir> to save screenshots of the notice and the error page.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents: allWebContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-nav-errors-smoke-${process.pid}`);
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS;
const UNRESOLVABLE = "surffish-smoke-nowhere.invalid";
// Deterministic DNS failure for the unresolvable host; everything else (loopback fixture) resolves.
app.commandLine.appendSwitch(
  "host-resolver-rules",
  `MAP ${UNRESOLVABLE} ~NOTFOUND`,
);

const page = (title, head = "", body = "") =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>${head}<body style="font:16px system-ui;padding:24px">${body || `<h1>${title}</h1>`}</body>`;
const server = createServer((request, response) => {
  const path = (request.url || "/").split("?")[0];
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (path === "/replace") {
    // Navigates away while the first document is still loading: loadURL rejects with ERR_ABORTED.
    response.end(
      page(
        "Replacing",
        '<script>location.replace("/landed?from=replace")</script>',
      ),
    );
    return;
  }
  if (path === "/spa") {
    // SPA-style: rewrite the URL, then hand off to the real route before load finishes.
    response.end(
      page(
        "SPA",
        '<script>history.replaceState(null, "", "/spa/app"); location.replace("/landed?from=spa")</script>',
      ),
    );
    return;
  }
  if (path === "/slow-asset") {
    setTimeout(() => response.end(""), 4000);
    return;
  }
  if (path === "/superseded") {
    // Commits, then replaces itself while a subresource is still loading (did-finish-load never ran).
    response.end(
      page(
        "Superseded",
        "",
        '<img src="/slow-asset"><script>setTimeout(() => location.replace("/landed?from=superseded"), 150)</script>',
      ),
    );
    return;
  }
  response.end(page(path === "/landed" ? "Landed" : "Fixture"));
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const image = await view.webContents.capturePage();
      writeFileSync(join(screenshots, name), image.toPNG());
      return;
    } catch (error) {
      if (attempt === 2)
        console.warn(
          `[nav-errors] could not capture ${name}: ${error.message}`,
        );
      await delay(400);
    }
  }
}

/** Record loadURL rejections so the smoke proves the ERR_ABORTED path actually ran. */
const loadRejections = [];
const loadCalls = [];
function recordLoadRejections() {
  const sample = allWebContents.getAllWebContents()[0];
  const proto = Object.getPrototypeOf(sample);
  const original = proto.loadURL;
  proto.loadURL = function (...args) {
    loadCalls.push(String(args[0]));
    const result = original.apply(this, args);
    result.catch((error) =>
      loadRejections.push({
        url: String(args[0]),
        message: String(error?.message ?? error),
      }),
    );
    return result;
  };
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
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [`${origin}/start`], activeIndex: 0 }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
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
  recordLoadRejections();
  const state = () => evaluate(toolbar, "window.api.browser.state()");
  const notice = () =>
    evaluate(
      toolbar,
      `(() => { const el = document.querySelector('#browser-notice'); return el ? { text: el.textContent, title: el.querySelector('strong')?.textContent ?? '', retry: Boolean(el.querySelector('.browser-notice-action')) } : null })()`,
    );
  const errorPage = () =>
    evaluate(
      content,
      `(() => { const el = document.querySelector('.tab-interstitial.is-load-error'); return el ? { title: el.querySelector('h1')?.textContent ?? '', text: el.textContent } : null })()`,
    );
  await waitFor(async () => {
    const current = await state();
    return current.url === `${origin}/start` && !current.loading;
  }, "the start page");

  // --- a load the page supersedes is not an error
  for (const route of ["replace", "spa", "superseded"]) {
    const result = await evaluate(
      toolbar,
      `window.api.browser.navigate(${JSON.stringify(`${origin}/${route}`)})`,
    );
    assert.deepEqual(
      result,
      { ok: true },
      `${route}: a superseded load still counts as opened`,
    );
    await waitFor(async () => {
      const current = await state();
      return (
        current.url === `${origin}/landed?from=${route}` && !current.loading
      );
    }, `${route}: the replacement page`);
    await delay(300);
    const current = await state();
    assert.equal(current.error, null, `${route}: no tab error`);
    assert.equal(current.loadError, null, `${route}: no load error`);
    assert.equal(await notice(), null, `${route}: no notice under the toolbar`);
    assert.equal(await errorPage(), null, `${route}: no in-page error`);
  }
  const aborted = loadRejections.filter(
    (entry) =>
      /ERR_ABORTED/.test(entry.message) &&
      /\/(replace|spa|superseded)$/.test(entry.url),
  );
  assert.ok(
    aborted.some((entry) => entry.url.endsWith("/superseded")),
    "the superseded fixture really made loadURL reject with ERR_ABORTED",
  );

  // --- address-bar input that can't be opened shows the invalid copy
  const typeAndSubmit = async (text) => {
    toolbar.webContents.focus();
    await evaluate(
      toolbar,
      '(() => { const input = document.querySelector(".browser-toolbar input[type=text]"); input.focus(); input.select() })()',
    );
    toolbar.webContents.insertText(text);
    await waitFor(
      () =>
        evaluate(
          toolbar,
          `document.querySelector(".browser-toolbar input[type=text]").value === ${JSON.stringify(text)}`,
        ),
      "the typed address",
    );
    // Submit the omnibox form (what Enter does) so the renderer's navigateTo handles the result.
    await evaluate(
      toolbar,
      'document.querySelector("form.browser-toolbar").requestSubmit()',
    );
  };
  await typeAndSubmit("file:///etc/passwd");
  const invalid = await waitFor(() => notice(), "the invalid-address notice");
  assert.equal(invalid.title, "That address can’t be opened");
  assert.match(invalid.text, /Use an HTTP\(S\) address or search terms/);
  assert.equal(invalid.retry, false, "invalid input has nothing to retry");
  await screenshot(toolbar, "nav-errors-invalid-notice.png");
  await evaluate(
    toolbar,
    'document.querySelector("#browser-notice .browser-notice-dismiss").click()',
  );
  await waitFor(
    async () => (await notice()) === null,
    "the invalid notice to dismiss",
  );
  // ...and it clears on a tab switch
  await typeAndSubmit("file:///etc/passwd");
  await waitFor(() => notice(), "the invalid-address notice again");
  await evaluate(
    toolbar,
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/landed?from=second-tab`)})`,
  );
  await waitFor(
    async () => (await notice()) === null,
    "the invalid notice to clear on tab switch",
  );
  await waitFor(async () => {
    const current = await state();
    return current.url.endsWith("from=second-tab") && !current.loading;
  }, "the second tab");

  // --- an unresolvable host: friendly copy in the in-page error (the failed load left an empty
  // error page), no proxy talk (no proxy route applies), Retry + Go back
  const failed = await evaluate(
    toolbar,
    `window.api.browser.navigate("http://${UNRESOLVABLE}/page")`,
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "load");
  assert.equal(failed.code, -105);
  const failedState = await waitFor(async () => {
    const current = await state();
    return current.loadError ? current : null;
  }, "the load error state");
  assert.equal(failedState.loadError.code, -105);
  assert.equal(failedState.loadError.name, "ERR_NAME_NOT_RESOLVED");
  assert.equal(failedState.loadError.viaProxy, false);
  assert.equal(failedState.loadError.url, `http://${UNRESOLVABLE}/page`);
  assert.equal(failedState.loadError.fullPage, true);
  const shown = await waitFor(() => errorPage(), "the in-page load error");
  assert.equal(shown.title, "Can’t find that site");
  assert.match(shown.text, new RegExp(UNRESOLVABLE.replace(/\./g, "\\.")));
  assert.doesNotMatch(shown.text, /proxy|tunnel/i);
  assert.match(shown.text, /Retry/);
  assert.match(shown.text, /Go back/);
  assert.equal(
    await notice(),
    null,
    "the in-page error replaces the toolbar notice",
  );
  if (typeof content.getVisible === "function")
    await waitFor(
      () => content.getVisible(),
      "the content surface (in-page error) to be on screen",
    );
  await screenshot(content, "nav-errors-error-page.png");
  // Retry re-runs the load (fails again here), Go back recovers
  const before = loadCalls.length;
  await evaluate(
    content,
    '[...document.querySelectorAll(".tab-interstitial.is-load-error button")].find((button) => button.textContent === "Retry").click()',
  );
  await waitFor(
    () => loadCalls.slice(before).includes(`http://${UNRESOLVABLE}/page`),
    "Retry to reload the failed address",
  );
  // Tab state is broadcast once per frame, so the previous error page can still be on screen for a
  // frame after Retry: wait for main to settle on the new failure, then click Go back once it renders.
  await waitFor(async () => {
    const current = await state();
    return current.loadError && !current.loading ? current : null;
  }, "the load error state after Retry");
  await waitFor(() => errorPage(), "the in-page error after Retry");
  await waitFor(
    () =>
      evaluate(
        content,
        '(() => { const button = [...document.querySelectorAll(".tab-interstitial.is-load-error button")].find((item) => item.textContent === "Go back"); button?.click(); return Boolean(button) })()',
      ),
    "the Go back button on the in-page error",
  );
  await waitFor(async () => {
    const current = await state();
    return (
      current.url.endsWith("from=second-tab") &&
      current.error === null &&
      !current.loading
    );
  }, "Go back to recover");
  assert.equal(
    await errorPage(),
    null,
    "the in-page error clears once the tab loads again",
  );

  // --- a load error that leaves the page on screen uses the toolbar notice (Retry + dismiss).
  // Simulate main seeing a non-committing main-frame failure on the live page.
  const pageContents = allWebContents
    .getAllWebContents()
    .find((contents) => contents.getURL().endsWith("from=second-tab"));
  assert.ok(pageContents, "the tab page contents");
  pageContents.emit(
    "did-fail-load",
    {},
    -2,
    "ERR_FAILED",
    `${origin}/flaky`,
    true,
    0,
    0,
  );
  const toast = await waitFor(() => notice(), "the load-error notice");
  assert.equal(toast.title, "Couldn’t open this page");
  assert.equal(toast.retry, true, "load errors offer Retry");
  assert.doesNotMatch(
    toast.text,
    /proxy|tunnel/i,
    "no proxy talk when no proxy route applies",
  );
  await screenshot(toolbar, "nav-errors-load-notice.png");
  await evaluate(
    toolbar,
    'document.querySelector("#browser-notice .browser-notice-dismiss").click()',
  );
  await waitFor(
    async () => (await notice()) === null,
    "the load-error notice to dismiss",
  );
  assert.notEqual(
    (await state()).error,
    null,
    "dismissing only hides the notice",
  );
  // Per tab: switch away and back, the dismissed notice stays dismissed
  const tabList = await evaluate(toolbar, "window.api.browser.tabs.get()");
  const other = tabList.find((tab) => !tab.active);
  const mine = tabList.find((tab) => tab.active);
  await evaluate(
    toolbar,
    `window.api.browser.tabs.activate(${JSON.stringify(other.id)})`,
  );
  await waitFor(
    async () => (await state()).url.endsWith("from=superseded"),
    "the first tab",
  );
  assert.equal(await notice(), null, "the other tab has no notice");
  await evaluate(
    toolbar,
    `window.api.browser.tabs.activate(${JSON.stringify(mine.id)})`,
  );
  await waitFor(
    async () => (await state()).url.endsWith("from=second-tab"),
    "back to the second tab",
  );
  await delay(200);
  assert.equal(
    await notice(),
    null,
    "a dismissed notice stays dismissed for that tab",
  );

  // Next successful navigation clears everything.
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/landed?from=final`)})`,
  );
  await waitFor(async () => {
    const current = await state();
    return (
      current.url.endsWith("from=final") &&
      current.error === null &&
      !current.loading
    );
  }, "a clean final load");
  assert.equal(await notice(), null);
  assert.equal(await errorPage(), null);

  console.log("Navigation errors smoke passed.");
}

run()
  .then(() => {
    server.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    server.close();
    app.exit(1);
  });
