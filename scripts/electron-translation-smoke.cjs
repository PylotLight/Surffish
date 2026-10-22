const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, session, Menu } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const userData = join(tmpdir(), `surffish-translation-smoke-${process.pid}`);
const pause = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
let capturedMenu = [];
const flattenMenu = (items) =>
  items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flattenMenu(item.submenu) : []),
  ]);
const buildMenu = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  capturedMenu = template;
  const menu = buildMenu(template);
  menu.popup = () => {};
  return menu;
};
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs;
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
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize());
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      lastAttemptAt: Date.now(),
      backgrounds: [],
    }),
  );
  // Register first so fixture responses are available before the app creates tabs.
  app.whenReady().then(() => {
    session.defaultSession.protocol.handle("https", (request) => {
      const url = new URL(request.url);
      if (url.hostname === "translate.googleapis.com") {
        const q = url.searchParams.get("q") || "";
        if (q === "slow")
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Response(JSON.stringify([[["late result", q]]]), {
                    headers: { "Content-Type": "application/json" },
                  }),
                ),
              250,
            ),
          );
        if (q === "provider-fail")
          return new Response("unavailable", { status: 503 });
        return new Response(JSON.stringify([[[`FR:${q}`, q]]]), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });
    session
      .fromPartition("persist:surffish-browser")
      .protocol.handle(
        "https",
        () =>
          new Response(
            '<!doctype html><title>Translation fixture</title><p id="visible">Bonjour le monde</p><input value="Input text"><textarea>Textarea text</textarea><div contenteditable="true">Editable text</div><pre>Code text</pre><p hidden>Hidden text</p>',
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
    return views.content && views.toolbar;
  }, "trusted shell surfaces");
  const evaluate = async (surface, code) => {
    try {
      return await views[surface].webContents.executeJavaScript(code);
    } catch (error) {
      console.error("Renderer expression failed:", surface, code);
      throw error;
    }
  };
  await waitFor(
    () =>
      evaluate(
        "content",
        'Boolean(window.api?.browser?.translation && document.querySelector(".site-actions-button"))',
      ),
    "translation API and UI",
  );
  assert.equal(
    await evaluate("content", "window.api.browser.translation.getTarget()"),
    "en",
  );
  await evaluate(
    "content",
    'window.api.browser.settings.open({section:"settings"})',
  );
  await waitFor(
    () =>
      evaluate(
        "content",
        'Boolean(document.querySelector(".settings-view-settings"))',
      ),
    "General settings",
  );
  assert.equal(
    await evaluate(
      "content",
      'Boolean(document.querySelector(".settings-view-settings .translation-settings-section"))',
    ),
    false,
  );
  await evaluate(
    "content",
    'window.api.browser.settings.open({section:"languages"})',
  );
  await waitFor(
    () =>
      evaluate(
        "content",
        'Boolean(document.querySelector(".settings-view-languages select:not(:disabled)"))',
      ),
    "translation settings",
  );
  await evaluate(
    "content",
    '(() => { const select=document.querySelector(".settings-view-languages select"); select.value="fr"; select.dispatchEvent(new Event("change",{bubbles:true})); })()',
  );
  await evaluate(
    "toolbar",
    'document.querySelector(".site-actions-button").click()',
  );
  await waitFor(
    () =>
      evaluate(
        "toolbar",
        'document.querySelector("#site-actions-menu")?.textContent.includes("Translate page to French")',
      ),
    "target language synchronized to toolbar",
  );
  await evaluate(
    "toolbar",
    'document.querySelector(".site-actions-button").click()',
  );
  assert.equal(
    JSON.parse(readFileSync(join(userData, "browser-translation.json"), "utf8"))
      .target,
    "fr",
  );
  assert.equal(
    await evaluate(
      "content",
      'window.api.browser.translation.setTarget("not-a-language").then(()=>false,()=>true)',
    ),
    true,
  );
  assert.equal(
    await evaluate("content", 'window.api.browser.translation.text(" ")'),
    false,
  );
  assert.equal(
    await evaluate(
      "content",
      'window.api.browser.translation.text("a".repeat(5001))',
    ),
    false,
  );
  assert.equal(
    await evaluate("content", "window.api.browser.translation.page()"),
    false,
    "local New Tab is not sent to Google",
  );
  await evaluate(
    "content",
    'window.api.browser.tabs.create("https://example.com/article#section")',
  );
  await waitFor(
    () =>
      evaluate(
        "content",
        'window.api.browser.state().then(state=>state.url.includes("example.com/article"))',
      ),
    "public fixture tab",
  );
  const source = await evaluate(
    "content",
    "window.api.browser.tabs.get().then(tabs=>tabs.find(tab=>tab.active))",
  );
  let sourceView;
  await waitFor(() => {
    sourceView = win.contentView.children.find((view) =>
      view.webContents?.getURL().includes("example.com/article"),
    );
    return sourceView && !sourceView.webContents.isLoading();
  }, "fixture page loaded");
  assert.ok(sourceView);
  const beforeUrl = sourceView.webContents.getURL();
  const beforeTabCount = (
    await evaluate("content", "window.api.browser.tabs.get()")
  ).length;
  const isolated = (code) =>
    sourceView.webContents.executeJavaScriptInIsolatedWorld(1108, [{ code }]);
  await waitFor(
    async () =>
      (await evaluate("content", "window.api.browser.tabs.get()")).some(
        (tab) =>
          tab.id === source.id && tab.url.includes("example.com/article"),
      ),
    "fixture tab ready",
  );
  await evaluate(
    "toolbar",
    'document.querySelector(".site-actions-button").click()',
  );
  await waitFor(
    async () =>
      views.toolbar.getBounds().height >=
      Math.floor(
        await evaluate(
          "toolbar",
          'document.querySelector("#site-actions-menu").getBoundingClientRect().bottom',
        ),
      ),
    "native overlay contains translation menu",
  );
  await evaluate(
    "toolbar",
    'document.querySelector(".site-actions-button").click()',
  );
  assert.equal(
    await evaluate("content", "window.api.browser.translation.page()"),
    true,
  );
  await waitFor(
    () =>
      sourceView.webContents.executeJavaScript(
        'document.querySelector("#visible")?.textContent === "FR:Bonjour le monde"',
      ),
    "page translated in place",
  );
  assert.equal(
    sourceView.webContents.getURL(),
    beforeUrl,
    "page translation does not navigate",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("input").value',
    ),
    "Input text",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("textarea").value',
    ),
    "Textarea text",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("[contenteditable]").textContent',
    ),
    "Editable text",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("pre").textContent',
    ),
    "Code text",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("[hidden]").textContent',
    ),
    "Hidden text",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("[data-surffish-translation]") !== null',
    ),
    true,
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      "window.__surffishTranslation",
    ),
    undefined,
    "state is unavailable in page main world",
  );
  assert.equal(
    await isolated("Boolean(globalThis.__surffishTranslation)"),
    true,
  );
  assert.equal(
    await isolated("globalThis.__surffishTranslation.restore(); true"),
    true,
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("#visible").textContent',
    ),
    "Bonjour le monde",
  );
  assert.equal(
    await evaluate(
      "content",
      'window.api.browser.translation.text("Bonjour", "ja")',
    ),
    true,
  );
  await waitFor(
    async () =>
      (await isolated(
        "globalThis.__surffishTranslation?.result.textContent",
      )) === "FR:Bonjour",
    "selection result in panel",
  );
  assert.equal(
    sourceView.webContents.getURL(),
    beforeUrl,
    "selection translation does not navigate",
  );
  assert.equal(
    (await evaluate("content", "window.api.browser.tabs.get()")).length,
    beforeTabCount,
    "translation creates no tabs",
  );
  await isolated("globalThis.__surffishTranslation.restore(); true");
  assert.equal(
    await evaluate(
      "content",
      'window.api.browser.translation.text("provider-fail", "ja")',
    ),
    false,
  );
  await waitFor(
    async () =>
      (
        await isolated("globalThis.__surffishTranslation?.status.textContent")
      )?.includes("Translation unavailable"),
    "provider failure status",
  );
  await isolated("globalThis.__surffishTranslation.restore(); true");
  await evaluate(
    "content",
    '(globalThis.pendingTranslation = window.api.browser.translation.text("slow"), true)',
  );
  await waitFor(
    async () =>
      (await isolated(
        "globalThis.__surffishTranslation?.status.textContent",
      )) === "Translating with Google…",
    "pending translation panel",
  );
  await isolated("globalThis.__surffishTranslation.restore(); true");
  assert.equal(
    await evaluate("content", "globalThis.pendingTranslation"),
    false,
    "closed translation cannot apply a late result",
  );
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("[data-surffish-translation]")',
    ),
    null,
  );
  assert.equal(
    await evaluate("content", "window.api.browser.translation.page()"),
    true,
  );
  await sourceView.webContents.executeJavaScript(
    'document.querySelector("#visible").textContent="Website updated"',
  );
  await isolated("globalThis.__surffishTranslation.restore(); true");
  assert.equal(
    await sourceView.webContents.executeJavaScript(
      'document.querySelector("#visible").textContent',
    ),
    "Website updated",
    "restore preserves website updates",
  );
  const params = {
    x: 20,
    y: 20,
    pageURL: "https://example.com/article",
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    selectionText: "Bonjour",
    isEditable: false,
    editFlags: { canCopy: true },
    dictionarySuggestions: [],
  };
  sourceView.webContents.emit("context-menu", { preventDefault() {} }, params);
  assert.ok(
    flattenMenu(capturedMenu).some((item) =>
      item.label?.startsWith("Translate Selection to French (in place)"),
    ),
  );
  assert.ok(
    flattenMenu(capturedMenu).some((item) =>
      item.label?.startsWith("Translate Page to French (in place)"),
    ),
  );
  sourceView.webContents.emit(
    "context-menu",
    { preventDefault() {} },
    { ...params, selectionText: "x".repeat(5001) },
  );
  assert.ok(
    !flattenMenu(capturedMenu).some((item) =>
      item.label?.startsWith("Translate Selection"),
    ),
  );
  assert.ok(
    flattenMenu(capturedMenu).some((item) => item.label?.startsWith("Search ")),
    "long selection still supports search",
  );
  console.log(
    "PASS: translation settings, persistence, cross-surface synchronization, validation, toolbar bounds, in-place page/text flows, and context menus",
  );
}
const timeout = setTimeout(
  () => {
    console.error("Translation smoke test timed out");
    app.exit(1);
  },
  Math.max(60000, smoke.waitMs * 4),
);
run()
  .then(() => {
    clearTimeout(timeout);
    smoke.removeProfile(userData);
    app.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  });
