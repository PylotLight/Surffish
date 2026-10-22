const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, session } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const userData = join(tmpdir(), `surffish-ui-font-smoke-${process.pid}`);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${description}`);
}
async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    {
      loadNetworkFilters: true,
      loadCosmeticFilters: false,
      loadCSPFilters: false,
      enableHtmlFiltering: false,
      enableMutationObserver: false,
      loadExtendedSelectors: false,
      loadGenericCosmeticsFilters: false,
    },
  );
  writeFileSync(join(userData, "adblock-engine-v2.bin"), blocker.serialize());
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      lastAttemptAt: Date.now(),
      backgrounds: [],
    }),
  );
  app.whenReady().then(() => {
    session
      .fromPartition("persist:surffish-browser")
      .protocol.handle(
        "https",
        () =>
          new Response(
            "<!doctype html><title>Font fixture</title><style>body{font-family:serif}</style><p>Website font stays unchanged</p>",
            { headers: { "Content-Type": "text/html" } },
          ),
      );
  });
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  let win, views;
  await waitFor(() => {
    win = BaseWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed(),
    );
    if (!win) return false;
    views = Object.fromEntries(
      win.contentView.children
        .filter((view) => view.webContents && !view.webContents.isDestroyed())
        .map((view) => {
          try {
            return [
              new URL(view.webContents.getURL()).searchParams.get("surface"),
              view,
            ];
          } catch {
            return [null, view];
          }
        }),
    );
    return views.content && views.toolbar && views.sidebar;
  }, "trusted shell surfaces");
  const evaluate = (surface, code) =>
    views[surface].webContents.executeJavaScript(code);
  await waitFor(
    () =>
      evaluate(
        "content",
        'document.documentElement.dataset.uiFont === "system" && Boolean(window.api?.browser?.uiFont)',
      ),
    "default system font",
  );
  await evaluate(
    "content",
    'window.api.browser.chrome.set({sidebarMode:"settings"})',
  );
  const selector = 'select[aria-label="Interface font"]';
  await waitFor(
    () =>
      evaluate(
        "content",
        `Boolean(document.querySelector('${selector}:not(:disabled)'))`,
      ),
    "font selector",
  );
  await evaluate(
    "content",
    `(() => { const select=document.querySelector('${selector}'); select.value='maple-mono'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  for (const surface of ["content", "toolbar", "sidebar"]) {
    await waitFor(
      () =>
        evaluate(
          surface,
          'document.documentElement.dataset.uiFont === "maple-mono"',
        ),
      `font synchronized to ${surface}`,
    );
    assert.match(
      await evaluate(surface, "getComputedStyle(document.body).fontFamily"),
      /Maple Mono/,
    );
    assert.equal(
      await evaluate(
        surface,
        'document.fonts.load(\'400 14px "Maple Mono"\').then(fonts => fonts.length > 0 && fonts.every(font => font.status === "loaded"))',
      ),
      true,
      "bundled font actually loads",
    );
  }
  assert.equal(
    await evaluate(
      "content",
      'document.fonts.load(\'italic 600 14px "Maple Mono"\').then(fonts => fonts.length > 0 && fonts.every(font => font.status === "loaded"))',
    ),
    true,
    "italic variable font loads",
  );
  assert.equal(
    JSON.parse(readFileSync(join(userData, "browser-preferences.json"), "utf8"))
      .uiFont,
    "maple-mono",
  );
  await views.toolbar.webContents.reload();
  await waitFor(
    () =>
      evaluate(
        "toolbar",
        'document.documentElement.dataset.uiFont === "maple-mono"',
      ),
    "font restored on renderer reload",
  );
  assert.equal(
    await evaluate("content", 'window.api.browser.uiFont.set("not-a-font")'),
    null,
  );
  assert.equal(
    await evaluate(
      "content",
      "window.api.browser.preferences.get().then(p => p.uiFont)",
    ),
    "maple-mono",
  );
  await evaluate(
    "content",
    'window.api.browser.tabs.create("https://example.com/font-fixture")',
  );
  let page;
  await waitFor(() => {
    page = win.contentView.children.find((view) =>
      view.webContents?.getURL().includes("example.com/font-fixture"),
    );
    return page && !page.webContents.isLoading();
  }, "web page fixture");
  assert.equal(
    await page.webContents.executeJavaScript(
      "getComputedStyle(document.body).fontFamily",
    ),
    "serif",
    "websites keep their own font",
  );
  await evaluate("content", 'window.api.browser.uiFont.set("system")');
  for (const surface of ["content", "toolbar", "sidebar"]) {
    await waitFor(
      () =>
        evaluate(
          surface,
          'document.documentElement.dataset.uiFont === "system"',
        ),
      `system font restored to ${surface}`,
    );
    assert.doesNotMatch(
      await evaluate(surface, "getComputedStyle(document.body).fontFamily"),
      /Maple Mono/,
    );
  }
  assert.equal(
    JSON.parse(readFileSync(join(userData, "browser-preferences.json"), "utf8"))
      .uiFont,
    "system",
  );
  console.log(
    "PASS: default font, Maple selector, bundled normal/italic font loading, cross-surface synchronization, persistence, reload, validation, unaffected websites, and reverting to System",
  );
}
const timeout = setTimeout(() => {
  console.error("UI font smoke test timed out");
  app.exit(1);
}, 60000);
run()
  .then(() => {
    clearTimeout(timeout);
    rmSync(userData, { recursive: true, force: true });
    app.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  });
