// Integration smoke for release-feed update notifications: check, badge, skip, remind later, beta
// channel, a 404 feed and the Settings section. Runs the production build:
// `bun run build && bun run test:electron-updates`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-updates-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-updates-smoke-${process.pid}`);
// The captured feed's newest stable release becomes 9.9.9 so it is always newer than this build.
const feed = readFileSync(
  resolve(__dirname, "../src/shared/fixtures/surffish-releases.atom"),
  "utf8",
)
  .replace(/v0\.1\.1/g, "v9.9.9")
  .replace(/v0\.2\.0-beta\.1/g, "v10.0.0-beta.1");
let feedRequests = 0;
const server = createServer((request, response) => {
  if (request.url === "/feed.atom") {
    feedRequests += 1;
    response.writeHead(200, {
      "Content-Type": "application/atom+xml; charset=utf-8",
    });
    response.end(feed);
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

const readPrefs = () =>
  JSON.parse(readFileSync(join(userData, "update-preferences.json"), "utf8"));

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
    join(userData, "update-preferences.json"),
    JSON.stringify({ feedUrl: `${origin}/feed.atom` }),
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
  const sidebar = surface("sidebar");
  const content = surface("content");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api?.browser?.updates)',
      ),
    "the toolbar renderer",
  );

  // Nothing is fetched before the ~30s launch delay.
  assert.equal(feedRequests, 0, "no update check right at launch");
  const initial = await evaluate(toolbar, "window.api.browser.updates.get()");
  assert.equal(initial.status, "idle");

  // --- manual check finds 9.9.9
  const checked = await evaluate(toolbar, "window.api.browser.updates.check()");
  assert.equal(feedRequests, 1);
  assert.equal(checked.status, "available", checked.message);
  assert.equal(checked.latest.version, "9.9.9");
  assert.equal(checked.showBadge, true);
  assert.ok(
    checked.latest.notes.startsWith("# Surffish v9.9.9"),
    "release notes are plain text",
  );
  assert.ok(!checked.latest.notes.includes("<"), "no markup in notes");
  assert.equal(
    readPrefs().notifiedVersion,
    "9.9.9",
    "the notification is recorded once per version",
  );
  assert.ok(readPrefs().lastChecked > now);
  await waitFor(
    () =>
      evaluate(
        sidebar,
        'Boolean(document.querySelector(".update-badge-button"))',
      ),
    "the sidebar update badge",
  );

  // --- the badge opens Settings → About & updates
  await evaluate(
    sidebar,
    'document.querySelector(".update-badge-button").click()',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).settings
        ?.section === "settings",
    "the badge to open settings",
  );
  await waitFor(
    () =>
      evaluate(
        content,
        'document.querySelector(".update-settings")?.textContent.includes("About & updates") && document.querySelector(".update-release-notes")?.textContent.includes("Surffish v9.9.9")',
      ),
    "the About & updates section with notes",
  );
  assert.equal(
    await evaluate(
      content,
      'document.querySelector(".update-release-notes").querySelectorAll("*").length',
    ),
    0,
    "notes render as text, not HTML",
  );
  if (process.env.UPDATES_SMOKE_SCREENSHOT) {
    await delay(800);
    writeFileSync(
      process.env.UPDATES_SMOKE_SCREENSHOT,
      (await content.webContents.capturePage()).toPNG(),
    );
    writeFileSync(
      process.env.UPDATES_SMOKE_SCREENSHOT.replace(/\.png$/, "-sidebar.png"),
      (await sidebar.webContents.capturePage()).toPNG(),
    );
  }

  // --- remind me later hides the badge, skip persists
  const snoozed = await evaluate(
    toolbar,
    "window.api.browser.updates.remindLater()",
  );
  assert.equal(snoozed.showBadge, false);
  assert.equal(readPrefs().remindLaterVersion, "9.9.9");
  await waitFor(
    async () =>
      !(await evaluate(
        sidebar,
        'Boolean(document.querySelector(".update-badge-button"))',
      )),
    "remind later to hide the badge",
  );
  const skipped = await evaluate(
    toolbar,
    'window.api.browser.updates.skip("9.9.9")',
  );
  assert.equal(skipped.showBadge, false);
  assert.equal(skipped.updateAvailable, true);
  assert.equal(readPrefs().skippedVersion, "9.9.9");

  // --- beta channel offers the pre-release (and it is not the skipped version)
  const beta = (
    await evaluate(
      toolbar,
      "window.api.browser.updates.setSettings({ betaChannel: true })",
    )
  ).state;
  assert.equal(beta.latest.version, "10.0.0-beta.1");
  assert.equal(beta.showBadge, true);
  const stable = (
    await evaluate(
      toolbar,
      "window.api.browser.updates.setSettings({ betaChannel: false })",
    )
  ).state;
  assert.equal(stable.latest.version, "9.9.9");

  // --- a missing feed is reported, not thrown
  const missing = (
    await evaluate(
      toolbar,
      `window.api.browser.updates.setSettings({ feedUrl: ${JSON.stringify(`${origin}/missing.atom`)} })`,
    )
  ).state;
  assert.equal(missing.status, "unavailable");
  assert.match(missing.message, /feed not found/);
  assert.equal(missing.showBadge, false);
  // --- a bad feed URL is a validation result (shown inline), not a thrown IPC error
  const rejected = await evaluate(
    toolbar,
    'window.api.browser.updates.setSettings({ feedUrl: "file:///etc/passwd" })',
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /http\(s\) feed URL/);
  assert.equal(
    readPrefs().feedUrl,
    `${origin}/missing.atom`,
    "a rejected feed URL is not saved",
  );
  // In Settings: type a bad URL and Save; the message shows inline under the form. Retyped and
  // re-clicked until it sticks, since a late state broadcast can reset an untouched field.
  await waitFor(
    () =>
      evaluate(
        content,
        `(() => {
    if (document.querySelector('.update-settings .settings-message.is-error')?.textContent.includes('http(s) feed URL')) return true
    const input = document.querySelector('.update-feed-form input')
    if (input.value !== 'ftp://example.com/feed.atom') {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ftp://example.com/feed.atom')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      document.querySelector('.update-feed-form button[type=submit]:not(:disabled)')?.click()
    }
    return false
  })()`,
      ),
    "the inline feed URL error",
  );
  assert.equal(
    readPrefs().feedUrl,
    `${origin}/missing.atom`,
    "the form did not save the rejected URL either",
  );
  const reset = (
    await evaluate(
      toolbar,
      'window.api.browser.updates.setSettings({ feedUrl: "" })',
    )
  ).state;
  assert.equal(reset.feedUrl, "");
  assert.equal(readPrefs().feedUrl, "");

  console.log("Electron updates smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron updates smoke failed:", error);
    app.exit(1);
  },
);
