// Settings as a tab (shared/settings-tab.ts), against the production build:
//   1. ⌘/Ctrl+, (the app menu item) opens one Settings tab right after the active tab: surffish://settings,
//      titled Settings, drawn by the content renderer (no page view), not sleeping, no close button in it.
//   2. Opening Settings again (gear, ⌘K, the API) focuses the same tab and only changes its section.
//   3. You can click straight onto another tab (Settings stays open as a tab) and back.
//   4. Closing it like any tab (its × in the sidebar) returns to the tab used before it.
//   5. The site menu in the address bar holds this tab's switches; its "All site settings" opens the
//      Settings tab on Sites, deep-linked to that site (listed first, open and focused).
//   6. Security: the page has no Surffish API, can't navigate to or open surffish://settings, and no
//      webContents ever loads that address; settings IPC refuses a non-shell sender.
//   7. ⌘/Ctrl+, pressed in a mini window opens Settings in the browser window, not in the mini window.
//   8. It is not saved with the session.
// `bun run build && bun run test:electron-settings-tab` (headless Linux: xvfb-run -a).
// SURFFISH_SMOKE_SCREENSHOTS=<dir> also saves PNGs of the Settings tab, the site menu and Sites.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  Menu,
  ipcMain,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-settings-tab-smoke-${process.pid}`);
const PAGE = (title) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body><h1>${title}</h1><a id="settings-link" href="surffish://settings">settings</a></body>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const pages = { "/one": PAGE("One"), "/two": PAGE("Two") };
  response.writeHead(pages[path] ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(pages[path] ?? "not found");
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const IS_MAC = process.platform === "darwin";
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
    await delay(40);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ""}`,
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
const pageContents = (predicate) =>
  liveContents().find((contents) => predicate(contents.getURL(), contents));
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

const SHOTS = process.env.SURFFISH_SMOKE_SCREENSHOTS
  ? resolve(process.env.SURFFISH_SMOKE_SCREENSHOTS)
  : null;
async function screenshot(name, contents) {
  if (!SHOTS) return;
  try {
    await delay(250);
    mkdirSync(SHOTS, { recursive: true });
    const image = await contents.capturePage();
    writeFileSync(join(SHOTS, `${name}.png`), image.toPNG());
    console.log(`settings tab smoke: screenshot ${join(SHOTS, `${name}.png`)}`);
  } catch (error) {
    console.log(
      `settings tab smoke: screenshot ${name} failed: ${error.message}`,
    );
  }
}

function findMenuItem(menu, predicate) {
  for (const item of menu?.items ?? []) {
    if (predicate(item)) return item;
    const inner = findMenuItem(item.submenu, predicate);
    if (inner) return inner;
  }
  return null;
}

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(userData, smoke.ADBLOCK_CACHE_FILE),
    ElectronBlocker.parse(
      "||surffish-smoke-never-match.invalid^",
      smoke.ADBLOCK_CONFIG,
    ).serialize(),
    { mode: 0o600 },
  );
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const seedSession = JSON.stringify({
    version: 1,
    tabs: [`${origin}/one`, `${origin}/two`],
    activeIndex: 0,
  });
  writeFileSync(join(userData, "browser-session.json"), seedSession);
  writeFileSync(
    join(userData, "browser-mini-window.json"),
    JSON.stringify({ headerPlacement: "overlay" }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 860 });
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
  const content = surface("content").webContents;
  const ev = (expression) => smoke.evaluate(content, expression);
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api?.browser)',
      ),
    "the toolbar renderer",
  );
  await waitFor(
    () =>
      ev('document.readyState === "complete" && Boolean(window.api?.browser)'),
    "the content renderer",
  );
  const tabs = () => smoke.evaluate(toolbar, "window.api.browser.tabs.get()");
  const state = () => smoke.evaluate(toolbar, "window.api.browser.state()");
  const one = await waitFor(
    () =>
      pageContents(
        (url, contents) => url === `${origin}/one` && !contents.isLoading(),
      ),
    "page one",
  );
  const oneId = (await tabs()).find((tab) => tab.active).id;
  const settingsTabs = async () =>
    (await tabs()).filter((tab) => tab.url === "surffish://settings");
  const contentShowsSettings = (section = null) =>
    ev(`(() => {
    const view = document.querySelector('.settings-view, .site-settings-view, .settings-subnav')
    if (!view || !view.checkVisibility()) return false
    ${section ? `return document.querySelector('.settings-subnav .is-current')?.textContent?.startsWith(${JSON.stringify(section)})` : "return true"}
  })()`);

  smoke.step("⌘/Ctrl+, opens one Settings tab right after the active tab");
  const menuItem = findMenuItem(
    Menu.getApplicationMenu(),
    (item) => item.accelerator === "CmdOrCtrl+,",
  );
  assert.ok(menuItem, "the app menu has a Settings item on ⌘/Ctrl+,");
  assert.match(menuItem.label, /^Settings/);
  menuItem.click();
  await waitFor(
    async () =>
      (await settingsTabs()).length === 1 && (await settingsTabs())[0].active,
    "the Settings tab to open and be active",
  );
  const [settingsTab] = await settingsTabs();
  const order = (await tabs()).map((tab) => tab.id);
  assert.equal(
    order.indexOf(settingsTab.id),
    order.indexOf(oneId) + 1,
    "opened right after the active tab",
  );
  assert.equal(settingsTab.title, "Settings");
  assert.equal(settingsTab.sleeping, false, "never shown as sleeping");
  const st = await state();
  assert.equal(st.url, "surffish://settings");
  assert.equal(st.settings?.section, "settings");
  await waitFor(
    () => contentShowsSettings("General"),
    "the content renderer to draw Settings → General",
  );
  await screenshot("settings-tab-general", content);
  assert.equal(
    await ev('Boolean(document.querySelector(".settings-subnav-close"))'),
    false,
    "no Close button: it closes like a tab",
  );
  assert.equal(
    await ev(
      'document.querySelector(".omnibox input, input[aria-label=\'Address and search bar\'], .address-input")?.value ?? document.querySelector("input[type=text]")?.value',
    ),
    "surffish://settings",
    "the address bar shows surffish://settings",
  );
  assert.ok(
    await ev(
      `Boolean(document.querySelector('[data-browser-tab-id="${settingsTab.id}"] .tab-favicon-settings'))`,
    ),
    "the sidebar row has the gear icon",
  );
  assert.equal(
    liveContents().filter((contents) =>
      contents.getURL().startsWith("surffish:"),
    ).length,
    0,
    "no webContents loads surffish://settings",
  );

  smoke.step("Opening Settings again focuses the same tab");
  await ev(
    'document.querySelector(".sidebar-footer [aria-label=\\"Settings\\"]").click()',
  );
  await smoke.evaluate(
    toolbar,
    'window.api.browser.settings.open({ section: "privacy" })',
  );
  await waitFor(
    () => contentShowsSettings("Privacy"),
    "Privacy in the same tab",
  );
  assert.equal((await settingsTabs()).length, 1, "still one Settings tab");
  await smoke.evaluate(
    toolbar,
    'window.api.browser.commands.run("settings.newTab")',
  );
  await waitFor(
    () => contentShowsSettings("New Tab"),
    "the palette command switches the section",
  );
  assert.equal(
    (await settingsTabs()).length,
    1,
    "still one Settings tab after ⌘K",
  );
  await smoke.evaluate(
    toolbar,
    'window.api.browser.commands.run("settings.connection")',
  );
  await waitFor(
    () => contentShowsSettings("Connection"),
    "the Connection command opens the Connection section",
  );
  assert.equal((await settingsTabs()).length, 1, "still one Settings tab");
  // A section picked in the tab's own nav shows at once.
  await ev(
    '[...document.querySelectorAll(".settings-subnav button")].find((b) => b.textContent.startsWith("Integrations")).click()',
  );
  await waitFor(
    () => contentShowsSettings("Integrations"),
    "Integrations from the subnav",
  );

  smoke.step("Click straight onto another tab, then back");
  await ev(
    `document.querySelector('[data-browser-tab-id="${oneId}"]').click()`,
  );
  await waitFor(
    async () => (await tabs()).find((tab) => tab.active)?.id === oneId,
    "page one active again",
  );
  assert.equal(
    (await state()).settings ?? null,
    null,
    "state has no settings on a web tab",
  );
  assert.equal(
    (await settingsTabs()).length,
    1,
    "Settings stays open as a tab",
  );
  menuItem.click();
  await waitFor(
    async () => (await settingsTabs())[0]?.active,
    "Settings active again",
  );
  assert.equal(
    (await settingsTabs())[0].id,
    settingsTab.id,
    "the same tab came back",
  );

  smoke.step("Close it like any tab: back to the tab used before it");
  await ev(
    `document.querySelector('[data-browser-tab-id="${settingsTab.id}"] .tab-close').click()`,
  );
  await waitFor(
    async () => (await settingsTabs()).length === 0,
    "the Settings tab to close",
  );
  assert.equal(
    (await tabs()).find((tab) => tab.active)?.id,
    oneId,
    "page one is active again",
  );

  smoke.step(
    'Site menu: this tab\'s switches, and "All site settings" deep-links Sites to this site',
  );
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'Boolean(document.querySelector("[aria-label^=\\"Site actions for\\"]"))',
      ),
    "the site menu button",
  );
  await smoke.evaluate(
    toolbar,
    'document.querySelector("[aria-label^=\\"Site actions for\\"]").click()',
  );
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'Boolean(document.querySelector(".site-quick-settings [aria-label=\\"Allow notifications on this site\\"]"))',
      ),
    "the switches in the site menu",
  );
  await screenshot("site-menu-switches", toolbar);
  await smoke.evaluate(
    toolbar,
    'document.querySelector(".site-quick-settings [aria-label=\\"Allow notifications on this site\\"]").click()',
  );
  await waitFor(
    async () =>
      (
        await smoke.evaluate(
          toolbar,
          `window.api.browser.siteSettings.get(${JSON.stringify(origin)})`,
        )
      )?.allowNotifications === true,
    "the switch to save for this site",
  );
  await smoke.evaluate(
    toolbar,
    '[...document.querySelectorAll(".site-quick-settings button")].find((b) => b.textContent.includes("All site settings")).click()',
  );
  await waitFor(
    async () => (await settingsTabs())[0]?.active,
    "the Settings tab from the site menu",
  );
  const deep = await state();
  assert.equal(deep.settings?.section, "site");
  assert.equal(deep.settings?.host, origin, "deep-linked to this site");
  await waitFor(
    () =>
      ev(`(() => {
    const item = document.querySelector('.sites-settings-site[data-site-origin=${JSON.stringify(JSON.stringify(origin)).slice(1, -1)}]')
    return Boolean(item && item.classList.contains('is-focused') && item.querySelector('.sites-settings-site-head').getAttribute('aria-expanded') === 'true' && document.activeElement === item.querySelector('.sites-settings-site-head') && item.querySelector('[aria-label^="Allow notifications on this site"]')?.checked)
  })()`),
    "the site first in Sites, open and focused, its switch on",
  );
  assert.equal(
    await ev(
      'document.querySelector(".sites-settings-site").dataset.siteOrigin',
    ),
    origin,
    "listed first",
  );
  await screenshot("sites-deep-link", content);
  // A site with no overrides yet still lands (the list only shows sites with overrides otherwise).
  await smoke.evaluate(
    toolbar,
    'window.api.browser.settings.open({ section: "site", host: "https://fresh.example" })',
  );
  await waitFor(
    () =>
      ev(
        'document.querySelector(".sites-settings-site")?.dataset.siteOrigin === "https://fresh.example" && document.activeElement?.closest(".sites-settings-site")?.dataset.siteOrigin === "https://fresh.example"',
      ),
    "a fresh site deep link",
  );
  assert.equal((await settingsTabs()).length, 1, "still one Settings tab");

  smoke.step(
    "Security: pages get no API, cannot reach surffish://settings, IPC refuses them",
  );
  await ev(
    `document.querySelector('[data-browser-tab-id="${oneId}"]').click()`,
  );
  await waitFor(
    async () => (await tabs()).find((tab) => tab.active)?.id === oneId,
    "page one active",
  );
  assert.equal(
    await smoke.evaluate(one, "typeof window.api"),
    "undefined",
    "the page has no Surffish API",
  );
  const before = (await tabs()).length;
  await smoke
    .evaluate(
      one,
      'document.getElementById("settings-link").click(); window.open("surffish://settings"); location.href = "surffish://settings?section=privacy"; true',
    )
    .catch(() => undefined);
  await delay(600);
  assert.equal(one.getURL(), `${origin}/one`, "the page stayed where it was");
  assert.equal((await tabs()).length, before, "no tab opened");
  assert.equal(
    (await settingsTabs())[0]?.active,
    false,
    "Settings was not brought up by the page",
  );
  assert.equal(
    liveContents().filter((contents) =>
      contents.getURL().startsWith("surffish:"),
    ).length,
    0,
    "no webContents ever loads surffish://",
  );
  // An IPC call from a non-shell sender (a page has no preload; simulate one) is refused by the guard.
  let refused = null;
  const handlers = ipcMain._invokeHandlers;
  const open = handlers?.get?.("browser:settings:open");
  if (open) {
    try {
      await open(
        { sender: one, senderFrame: one.mainFrame },
        { section: "privacy" },
      );
    } catch (error) {
      refused = error.message;
    }
    assert.match(
      String(refused),
      /only to the app window/,
      "browser:settings:open refuses a page sender",
    );
  } else {
    console.log(
      "settings tab smoke: ipcMain handler map not reachable here; IPC guard covered by settings-tab-security.test.ts",
    );
  }

  smoke.step("⌘/Ctrl+, in a mini window opens Settings in the browser window");
  await smoke.evaluate(
    toolbar,
    'window.api.browser.commands.run("miniWindow.popOut")',
  );
  const mini = await waitFor(() => miniWindows()[0], "the mini window");
  await waitFor(
    () => mini.contentView.children.some((view) => view.webContents === one),
    "page one in the mini window",
  );
  await smoke
    .evaluate(
      toolbar,
      'window.api.browser.settings.open({ section: "privacy" })',
    )
    .catch(() => undefined);
  // Close it, so the mini's shortcut has to open a fresh one.
  await waitFor(
    async () => (await settingsTabs()).length === 1,
    "a Settings tab",
  );
  await smoke.evaluate(
    toolbar,
    `window.api.browser.tabs.close(${JSON.stringify((await settingsTabs())[0].id)})`,
  );
  await waitFor(
    async () => (await settingsTabs()).length === 0,
    "Settings closed",
  );
  one.sendInputEvent({
    type: "keyDown",
    keyCode: ",",
    modifiers: [IS_MAC ? "meta" : "control"],
  });
  one.sendInputEvent({
    type: "keyUp",
    keyCode: ",",
    modifiers: [IS_MAC ? "meta" : "control"],
  });
  await waitFor(
    async () => (await settingsTabs()).length === 1,
    "Settings opened from the mini window",
  );
  assert.ok(
    mini.contentView.children.some((view) => view.webContents === one),
    "the mini window still holds its page",
  );
  assert.equal(
    mini.contentView.children.filter(
      (view) =>
        view.webContents && !view.webContents.isDestroyed() && surfaceFor(view),
    ).length,
    0,
    "no shell surface (Settings) inside the mini window",
  );
  assert.ok(
    (await settingsTabs())[0].active,
    "Settings is the browser window's active tab",
  );
  await smoke.evaluate(
    toolbar,
    'window.api.browser.commands.run("miniWindow.return")',
  );
  await waitFor(() => miniWindows().length === 0, "the mini window to return");

  smoke.step("Settings is not saved with the session");
  await waitFor(
    async () => (await settingsTabs()).length === 1,
    "the Settings tab",
  );
  await smoke.evaluate(
    toolbar,
    `window.api.browser.tabs.activate(${JSON.stringify((await settingsTabs())[0].id)})`,
  );
  // Something that saves the session (a tab switch / move) with Settings open and active.
  await smoke.evaluate(
    toolbar,
    'window.api.browser.commands.run("settings.general")',
  );
  await delay(1200);
  const saved = await waitFor(() => {
    const text = readFileSync(join(userData, "browser-session.json"), "utf8");
    return text !== seedSession && text.includes("/one")
      ? JSON.parse(text)
      : null;
  }, "the session saved by this run");
  const savedText = JSON.stringify(saved);
  assert.ok(
    !savedText.includes("surffish://settings"),
    `Settings is not in the saved session: ${savedText}`,
  );
  assert.ok(
    savedText.includes(`${origin}/one`) && savedText.includes(`${origin}/two`),
    "the web tabs are saved",
  );
  console.log(`settings tab smoke: saved session ${savedText.slice(0, 300)}`);
  console.log("Electron settings tab smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron settings tab smoke failed:", error);
    app.exit(1);
  },
);
