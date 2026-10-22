// Settings layout smoke (v2 dense design), against the production build:
//   1. General is split into categories (sticky headings) with a jump list beside them; every
//      control that General had before the redesign is still there under its accessible name.
//   2. Jump list: clicking a category scrolls it to the top and marks it current; headings stick.
//   3. Mini window: basics visible, "Windows & motion" / "Edge tuck & peek" collapsed by default
//      with a summary of the current values; opening one is remembered.
//   4. Segmented controls are radiogroups with a roving tabindex: arrow keys change the setting.
//   5. Long hints: first sentence shown, the rest behind an ⓘ toggle (aria-expanded).
//   6. No CSS backdrop-filter on settings surfaces; Reduce Transparency gets solid fills.
// `bun run build && bun run test:electron-settings` (headless Linux: xvfb-run -a electron --no-sandbox ...).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-settings-smoke-${process.pid}`);
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs;
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

// Controls General had before the redesign (accessible names); none may go missing.
const GENERAL_CONTROLS = [
  "Default search engine",
  "Sidebar blur",
  "Show bookmarks bar",
  "Enable the command palette shortcut",
  "Browser and profile to import from",
  "Hibernate inactive tabs after",
  "Put background tabs to sleep when memory is low",
  "Preload pages for faster browsing",
  "Clear saved session",
  "Shift-click opens links in Glance",
  "Archive unused tabs after",
  "Switch to an open tab instead of opening a duplicate",
  "Enable Spaces",
  "Mini window default page",
  "Mini window toggle shortcut",
  "Turn off the mini window shortcut",
  "Mini window menu bar icon",
  "Mini window grouping",
  "Mini window header",
  "Throw mini windows with momentum",
  "Tuck the mini window to a screen edge",
  "Peek the tucked mini window on hover",
  "Mini window peek hover delay",
  "Let pages use the built-in AI",
  "Enable page watchers",
  "Check spelling while typing",
  "Check spelling in private tabs",
  "Add a spellcheck language",
  "Use local SOCKS5 proxy",
  "Local SOCKS5 host",
  "Local SOCKS5 port",
  "Connect to local network addresses directly",
  "Proxy kill switch",
  "Enable network inspector",
  "Offer pre-release updates",
  "Release feed URL",
  "Search keywords",
];
const CATEGORIES = [
  "Browsing",
  "Appearance",
  "Tabs & windows",
  "Mini window",
  "Features",
  "Connection",
  "Advanced",
];

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
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1280, height: 860 });
  const surface = (name) =>
    mainWindow.contentView.children.find((view) => {
      try {
        return (
          new URL(view.webContents.getURL()).searchParams.get("surface") ===
          name
        );
      } catch {
        return false;
      }
    });
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
        'document.readyState === "complete" && Boolean(window.api?.browser?.chrome)',
      ),
    "the toolbar renderer",
  );

  smoke.step("General: categories, jump list, every control");
  await smoke.evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "settings" })',
  );
  await waitFor(
    () =>
      ev(
        "Boolean(document.querySelector('[aria-label=\"Mini window grouping\"]') && document.querySelector('[aria-label=\"Release feed URL\"]'))",
      ),
    "General with the mini window and update settings loaded",
  );
  assert.deepEqual(
    await ev(
      '[...document.querySelectorAll(".settings-category-title")].map((h) => h.textContent)',
    ),
    CATEGORIES,
    "categories in order",
  );
  assert.deepEqual(
    await ev(
      '[...document.querySelectorAll(".settings-toc button")].map((b) => b.textContent)',
    ),
    CATEGORIES,
    "the jump list names every category",
  );
  const missing = await ev(
    `${JSON.stringify(GENERAL_CONTROLS)}.filter((label) => !document.querySelector('.settings-view [aria-label="' + label + '"]'))`,
  );
  assert.deepEqual(missing, [], "every General control is still there");
  assert.equal(
    await ev(
      'getComputedStyle(document.querySelector(".settings-category-title")).position',
    ),
    "sticky",
    "category headings stick",
  );

  smoke.step("Jump list scrolls to a category and marks it current");
  await ev(
    '[...document.querySelectorAll(".settings-toc button")].find((b) => b.textContent === "Connection").click()',
  );
  await waitFor(
    () =>
      ev(`(() => {
    const view = document.querySelector('.settings-view'); const category = document.querySelector('[data-category="connection"]')
    return Math.abs(category.getBoundingClientRect().top - view.getBoundingClientRect().top) < 40 && document.querySelector('.settings-toc .is-current')?.textContent === 'Connection'
  })()`),
    "Connection at the top of the page and current in the jump list",
  );
  assert.equal(
    await ev("document.activeElement?.textContent"),
    "Connection",
    "focus moves to the category heading",
  );
  // The heading stays pinned while its category scrolls under it.
  await ev('document.querySelector(".settings-view").scrollBy(0, 160)');
  await delay(120);
  const pinned = await ev(
    `(() => { const view = document.querySelector('.settings-view').getBoundingClientRect(); const title = document.querySelector('[data-category="connection"] .settings-category-title').getBoundingClientRect(); return title.top - view.top })()`,
  );
  assert.ok(
    Math.abs(pinned) <= 2,
    `Connection heading pinned to the top (${pinned}px)`,
  );

  smoke.step(
    "Mini window: basics visible, disclosures collapsed with value summaries",
  );
  const mini = "document.querySelector('section[aria-label=\"Mini window\"]')";
  const visible = (label) =>
    `Boolean(document.querySelector('[aria-label="${label}"]')?.checkVisibility())`;
  assert.equal(await ev(visible("Mini window default page")), true);
  assert.equal(await ev(visible("Mini window menu bar icon")), true);
  assert.equal(
    await ev(visible("Mini window grouping")),
    false,
    "grouping sits in a closed disclosure",
  );
  assert.deepEqual(
    await ev(
      `[...${mini}.querySelectorAll('details')].map((d) => [d.querySelector('.settings-disclosure-title').textContent, d.open, d.querySelector('.settings-disclosure-value')?.textContent])`,
    ),
    [
      ["Windows & motion", false, "Tabs · Float"],
      ["Edge tuck & peek", false, "Peek after 350 ms"],
    ],
  );
  await ev(
    `${mini}.querySelector('details[data-disclosure="mini-window-windows"] summary').click()`,
  );
  await waitFor(
    () => ev(visible("Mini window grouping")),
    "grouping visible once opened",
  );
  await waitFor(
    () =>
      ev(
        'localStorage.getItem("surffish.settings.open.mini-window-windows") === "1"',
      ),
    "the open state remembered",
  );

  smoke.step("Segmented control: roving tabindex, arrows change the setting");
  assert.deepEqual(
    await ev(
      '[...document.querySelectorAll(\'[aria-label="Mini window grouping"] [role=radio]\')].map((b) => [b.textContent, b.getAttribute("aria-checked"), b.tabIndex])',
    ),
    [
      ["Tabs", "true", 0],
      ["Stack", "false", -1],
      ["Separate", "false", -1],
    ],
  );
  await ev(
    '(() => { const b = document.querySelector(\'[aria-label="Mini window grouping"] [aria-checked=true]\'); b.focus(); b.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })) })()',
  );
  await waitFor(
    async () =>
      (await ev("window.api.browser.miniWindow.getSettings()")).settings
        .grouping === "stack",
    "ArrowRight to select Stack",
  );
  await waitFor(
    () =>
      ev(
        'document.activeElement?.textContent === "Stack" && document.activeElement.getAttribute("aria-checked") === "true"',
      ),
    "focus following the selection",
  );
  assert.match(
    await ev(
      `${mini}.querySelector('details[data-disclosure="mini-window-windows"] .settings-disclosure-value').textContent`,
    ),
    /^Stack/,
    "summary follows the value",
  );
  await ev(
    '[...document.querySelectorAll(\'[aria-label="Mini window grouping"] [role=radio]\')].find((b) => b.textContent === "Tabs").click()',
  );
  await waitFor(
    async () =>
      (await ev("window.api.browser.miniWindow.getSettings()")).settings
        .grouping === "tabs",
    "click to select Tabs again",
  );

  smoke.step("Long hints: first sentence, the rest behind the info toggle");
  const row =
    'document.querySelector(\'[aria-label="Enable network inspector"]\').closest(".settings-row")';
  assert.equal(
    await ev(`${row}.querySelector('.settings-row-hint').textContent`),
    "Adds a Network tab that records requests from every tab.",
  );
  assert.equal(
    await ev(
      `Boolean(${row}.querySelector('.settings-row-info').checkVisibility())`,
    ),
    false,
    "the rest starts hidden",
  );
  await ev(`${row}.querySelector('.settings-row-info-toggle').click()`);
  await waitFor(
    () =>
      ev(
        `${row}.querySelector('.settings-row-info-toggle').getAttribute('aria-expanded') === 'true' && Boolean(${row}.querySelector('.settings-row-info').checkVisibility())`,
      ),
    "the info toggle to reveal the rest",
  );
  assert.match(
    await ev(`${row}.querySelector('.settings-row-info').textContent`),
    /Off saves CPU and memory/,
  );

  smoke.step("No CSS backdrop-filter; Reduce Transparency gets solid fills");
  assert.deepEqual(
    await ev(
      '[...document.querySelectorAll(".settings-subnav, .settings-toc, .settings-group, .settings-group-body, .settings-category-title")].map((e) => getComputedStyle(e).backdropFilter).filter((value) => value !== "none")',
    ),
    [],
    "settings surfaces skip backdrop-filter",
  );
  const glassy = await ev(
    'getComputedStyle(document.querySelector(".settings-toc")).backgroundImage',
  );
  assert.match(
    glassy,
    /gradient/,
    "the jump list is translucent glass by default",
  );
  try {
    content.debugger.attach("1.3");
    await content.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await waitFor(
      () => ev('matchMedia("(prefers-reduced-transparency: reduce)").matches'),
      "the emulated Reduce Transparency",
    );
    assert.equal(
      await ev(
        'getComputedStyle(document.querySelector(".settings-toc")).backgroundColor',
      ),
      "rgb(26, 31, 37)",
      "solid jump list under Reduce Transparency",
    );
    assert.equal(
      await ev(
        'getComputedStyle(document.querySelector(".settings-toc")).backgroundImage',
      ),
      "none",
    );
    await content.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [],
    });
    content.debugger.detach();
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    console.log(
      `settings smoke: Reduce Transparency emulation unavailable here (${error.message}); skipped`,
    );
  }
  console.log("Electron settings smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron settings smoke failed:", error);
    app.exit(1);
  },
);
