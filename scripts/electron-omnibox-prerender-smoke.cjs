// Omnibox prerender smoke (shared/omnibox-prerender.ts, main/omnibox-prerender.ts), against a local
// site that answers HTML after PRERENDER_LATENCY_MS (default 250 ms) like a real server would:
//   1. baseline: with "Preload pages for faster browsing" off, typing a history URL and pressing
//      Enter loads it the normal way; Enter → first contentful paint is measured;
//   2. on: typing the same URL (a History suggestion, exactly what Enter opens) starts one hidden
//      prerender; Enter swaps it in, Enter → painted is measured, the tab shows the page, the
//      history visit and Back to the previous page both work, and the prerender counts as used;
//   3. editing the text drops the prerender; Escape drops it; an unsafe URL (/logout) and a
//      partial match never prerender; a private tab never prerenders.
// Prints "PRERENDER_RESULT {json}" with the timings for the PR / perf notes.
// Runs the production build: `bun run build && bun run test:electron-omnibox-prerender`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-omnibox-prerender-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-omnibox-prerender-${process.pid}`);
const LATENCY_MS = Number(process.env.PRERENDER_LATENCY_MS) || 250;
const RUNS = Number(process.env.PRERENDER_RUNS) || 3;
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  const path = request.url.split("?")[0];
  if (path.endsWith(".css")) {
    setTimeout(
      () => {
        response.writeHead(200, {
          "Content-Type": "text/css",
          "Cache-Control": "no-store",
        });
        response.end(
          "body { font: 16px system-ui, sans-serif; margin: 2rem; } h1 { color: #036; }",
        );
      },
      Math.round(LATENCY_MS / 2),
    );
    return;
  }
  setTimeout(() => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Page ${path}</title><link rel="stylesheet" href="/site.css?${path.slice(1)}"><h1>Page ${path}</h1>${"<p>Surffish prerender fixture paragraph with enough text to lay out.</p>".repeat(60)}`,
    );
  }, LATENCY_MS);
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const step = (text) => process.stderr.write(`[omnibox-prerender] ${text}\n`);
const median = (values) =>
  values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

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
    await delay(25);
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
  const TARGET = `${origin}/target`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 760 });
  const viewFor = (name) =>
    mainWindow.contentView.children.find(
      (view) => surfaceOf(view.webContents) === name,
    );
  const toolbarView = await waitFor(
    () => viewFor("toolbar"),
    "the toolbar surface",
  );
  const toolbar = toolbarView.webContents;
  await waitFor(
    () =>
      toolbar.executeJavaScript(
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const inToolbar = (expression) => toolbar.executeJavaScript(expression);
  const state = () => inToolbar("window.api.browser.state()");
  const snapshot = () => inToolbar("window.api.browser.preconnect.get()");
  const setPreload = (enabled) =>
    inToolbar(`window.api.browser.preconnect.set({ enabled: ${enabled} })`);
  const INPUT = 'document.querySelector(".browser-toolbar input[type=text]")';
  const bar = () => inToolbar(`${INPUT}.value`);
  const pageFor = (url) =>
    webContents
      .getAllWebContents()
      .find((contents) => !surfaceOf(contents) && contents.getURL() === url);
  const onScreen = (contents) =>
    Boolean(
      contents &&
      mainWindow.contentView.children.some(
        (view) => view.webContents === contents && view.getVisible(),
      ),
    );
  const key = (keyCode) => {
    toolbar.sendInputEvent({ type: "keyDown", keyCode });
    if (keyCode === "Enter")
      toolbar.sendInputEvent({ type: "char", keyCode: "\r" });
    toolbar.sendInputEvent({ type: "keyUp", keyCode });
  };
  const visit = async (url) => {
    await inToolbar(`window.api.browser.navigate(${JSON.stringify(url)})`);
    await waitFor(async () => {
      const current = await state();
      return current.url === url && !current.loading;
    }, `${url} to load`);
    await waitFor(
      async () => (await bar()) === url,
      `the toolbar showing ${url}`,
    );
  };
  const typeInBar = async (text) => {
    toolbar.focus();
    await inToolbar(`(() => { ${INPUT}.focus(); ${INPUT}.select() })()`);
    await waitFor(
      () =>
        inToolbar(`document.activeElement === ${INPUT} && document.hasFocus()`),
      "the focused address bar",
    );
    await toolbar.insertText(text);
    await waitFor(async () => (await bar()) === text, `the typed text ${text}`);
  };
  const topRow = () =>
    inToolbar(
      '(() => { const row = document.querySelector("#address-suggestions .address-suggestion:not(.keyword-suggestion)"); return row ? { url: row.querySelector(".suggestion-url")?.getAttribute("title") ?? "", source: row.querySelector(".suggestion-source")?.textContent ?? "" } : null })()',
    );
  // First paint after Enter in the page now on screen: its FCP when that came after Enter (a normal
  // load, or a hidden prerender that never painted), else the second frame after Enter (a prerender
  // that had already painted off screen).
  const paintedAfter = async (contents, enterAt) => {
    const fcp = await waitFor(
      () =>
        contents.executeJavaScript(
          '(() => { const entry = performance.getEntriesByName("first-contentful-paint")[0]; return entry ? performance.timeOrigin + entry.startTime : 0 })()',
        ),
      "a first contentful paint",
      30000,
    );
    if (fcp > enterAt) return fcp - enterAt;
    const framed = await contents.executeJavaScript(
      "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(Date.now()))))",
    );
    return framed - enterAt;
  };

  // Seed history: /target (and an unsafe /logout) were visited before; the tab ends on /start.
  await waitFor(async () => Boolean(await state()), "the first tab");
  await visit(TARGET);
  await visit(`${origin}/logout`);
  await visit(`${origin}/start`);
  await waitFor(
    async () =>
      (await inToolbar("window.api.browser.history.get()")).some(
        (entry) => entry.url === TARGET,
      ),
    "the /target history entry",
  );
  step("history seeded");

  const enterAndMeasure = async () => {
    const before = pageFor(`${origin}/start`);
    assert.ok(before, "the tab is on /start");
    const enterAt = Date.now();
    key("Enter");
    const page = await waitFor(
      () => {
        const contents = pageFor(TARGET);
        return contents && onScreen(contents) && contents;
      },
      "the /target page on screen",
      30000,
    );
    const ms = await paintedAfter(page, enterAt);
    await waitFor(async () => {
      const current = await state();
      return current.url === TARGET && !current.loading;
    }, "the tab on /target");
    return { page, ms, swapped: page !== before };
  };
  const backToStart = async (page) => {
    assert.ok(
      page.navigationHistory.canGoBack(),
      "Back is available after Enter",
    );
    await inToolbar("window.api.browser.back()");
    await waitFor(async () => {
      const current = await state();
      return current.url === `${origin}/start` && !current.loading;
    }, "Back to /start");
    await waitFor(
      async () => (await bar()) === `${origin}/start`,
      "the toolbar showing /start again",
    );
  };

  // 1. Baseline: preloading off, Enter loads normally.
  await setPreload(false);
  const baseline = [];
  for (let run = 0; run < RUNS; run += 1) {
    await typeInBar(TARGET);
    await delay(400);
    assert.equal(
      (await snapshot()).prerender.active,
      null,
      "no prerender while preloading is off",
    );
    const { page, ms, swapped } = await enterAndMeasure();
    assert.equal(
      swapped,
      false,
      "with preloading off the tab loads in its own page",
    );
    baseline.push(Math.round(ms));
    await backToStart(page);
  }
  step(`baseline Enter → first paint: ${baseline.join(", ")} ms`);

  // 2. Prerender: the History row is exactly what Enter opens.
  await setPreload(true);
  const prerendered = [];
  for (let run = 0; run < RUNS; run += 1) {
    const usedBefore = (await snapshot()).prerender.used;
    await typeInBar(TARGET);
    const top = await waitFor(topRow, "the top suggestion");
    assert.equal(
      top.source,
      "History",
      "the top suggestion is the History row",
    );
    await waitFor(
      async () => (await snapshot()).prerender.active?.loaded,
      "the prerender to load",
      15000,
    );
    const { page, ms, swapped } = await enterAndMeasure();
    assert.equal(swapped, true, "Enter swapped in the prerendered page");
    assert.equal(
      (await snapshot()).prerender.used,
      usedBefore + 1,
      "the prerender counts as used",
    );
    assert.equal(
      (await snapshot()).prerender.active,
      null,
      "nothing left prerendering",
    );
    assert.equal(
      (await state()).url,
      TARGET,
      "the tab reports the prerendered URL",
    );
    const entries = page.navigationHistory
      .getAllEntries()
      .map((entry) => entry.url);
    assert.deepEqual(
      entries.slice(-2),
      [`${origin}/start`, TARGET],
      "the swapped page carries the tab's back history",
    );
    prerendered.push(Math.round(ms));
    await backToStart(page);
  }
  step(`prerender Enter → painted: ${prerendered.join(", ")} ms`);
  // The swap recorded the visit like a normal load.
  const visits = (await inToolbar("window.api.browser.history.get()")).filter(
    (entry) => entry.url === TARGET,
  ).length;
  assert.ok(
    visits >= 1 + RUNS,
    `history has the prerendered visits (${visits})`,
  );

  // 3a. Editing the text drops the prerender.
  await typeInBar(TARGET);
  await waitFor(
    async () => (await snapshot()).prerender.active,
    "a prerender for the typed URL",
  );
  await toolbar.insertText("x");
  await waitFor(
    async () => (await snapshot()).prerender.active === null,
    "the edit to drop the prerender",
  );
  await waitFor(() => !pageFor(TARGET), "the prerendered page to close");
  // 3b. Escape drops it too.
  await typeInBar(TARGET);
  await waitFor(
    async () => (await snapshot()).prerender.active,
    "a prerender again",
  );
  key("Escape");
  key("Escape");
  await waitFor(
    async () => (await snapshot()).prerender.active === null,
    "Escape to drop the prerender",
  );
  step("edit and Escape drop the prerender");

  // 3c. Unsafe and partial matches never start one.
  const startedBefore = (await snapshot()).prerender.started;
  await typeInBar(`${origin}/logout`);
  await waitFor(
    async () => (await topRow())?.url === `${origin}/logout`,
    "the /logout history row",
  );
  await typeInBar(`${origin}/targ`);
  await delay(500);
  assert.equal(
    (await snapshot()).prerender.started,
    startedBefore,
    "no prerender for /logout or a partial URL",
  );
  key("Escape");
  key("Escape");

  // 3d. A private tab never prerenders.
  await inToolbar("window.api.browser.tabs.createPrivate()");
  await waitFor(
    async () => (await state()).private === true,
    "the private tab",
  );
  await waitFor(
    async () => (await bar()) === "",
    "the private tab's empty address bar",
    5000,
  ).catch(() => undefined);
  await typeInBar(TARGET);
  await delay(600);
  // Private tabs may show no History rows at all; hand main the same hint directly so the private
  // check itself is what's tested.
  const privateSkipsBefore = (await snapshot()).prerender.skipped.private ?? 0;
  await inToolbar(
    `window.api.browser.preconnect.typed(${JSON.stringify(TARGET)}, ${JSON.stringify(TARGET)}, 'History')`,
  );
  await waitFor(
    async () =>
      ((await snapshot()).prerender.skipped.private ?? 0) > privateSkipsBefore,
    "main to skip the private tab's hint",
  );
  const privateSnapshot = await snapshot();
  assert.equal(
    privateSnapshot.prerender.started,
    startedBefore,
    "no prerender in a private tab",
  );
  step(
    `private tab skipped (skips: ${JSON.stringify(privateSnapshot.prerender.skipped)})`,
  );

  const result = {
    latencyMs: LATENCY_MS,
    baselineMs: baseline,
    prerenderMs: prerendered,
    baselineMedianMs: median(baseline),
    prerenderMedianMs: median(prerendered),
    savedMedianMs: median(baseline) - median(prerendered),
  };
  console.log(`PRERENDER_RESULT ${JSON.stringify(result)}`);
  assert.ok(
    result.prerenderMedianMs < result.baselineMedianMs,
    "Enter → paint is faster with the prerender",
  );
  console.log("Omnibox prerender smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
