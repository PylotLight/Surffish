// Integration smoke for the session tables in surffish.db: open tabs are saved to the database (and
// still to browser-session.json), a restart restores from the database, and a browser-session.json
// written by something else (a fallback run / older build) wins over the database. Three launches
// on one profile. The bookmark tree gets the same three checks against bookmarks.json (import,
// delta rows + blanked tombstones, restore from the database, a changed JSON file wins), and so do
// browser preferences against browser-preferences.json (plus Forget this site hard-deleting a
// site's zoom row and scrubbing the JSON copy right away), and Spaces against browser-spaces.json. Runs the production build:
// `bun run build && bun run test:electron-sqlite-session` (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-sqlite-session-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const phase = (
  process.argv.find((arg) => arg.startsWith("--phase=")) ?? "--phase=main"
).slice(8);
const userData =
  process.env.SURFFISH_SESSION_SMOKE_DIR ||
  join(tmpdir(), `surffish-session-smoke-${process.pid}`);
const port = Number(process.env.SURFFISH_SESSION_SMOKE_PORT || 0);
const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Session ${request.url}</title><p>hi</p>`,
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
const views = () =>
  mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (name) =>
  views().find((view) => {
    try {
      return (
        new URL(view.webContents.getURL()).searchParams.get("surface") === name
      );
    } catch {
      return false;
    }
  });
async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
}
function sqlite(sql, ...params) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(join(userData, "surffish.db"));
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}
const sessionFile = join(userData, "browser-session.json");
const bookmarksFile = join(userData, "bookmarks.json");
const preferencesFile = join(userData, "browser-preferences.json");
const spacesFile = join(userData, "browser-spaces.json");
const spaceNames = (toolbar) =>
  evaluate(
    toolbar,
    'window.api.browser.spaces.get().then((snapshot) => snapshot.spaces.map((space) => space.name).join(","))',
  );
const liveSpaceNames = () =>
  sqlite("SELECT name FROM spaces WHERE deleted_at IS NULL ORDER BY position")
    .map((row) => row.name)
    .join(",");
const settingValue = (key) =>
  sqlite(
    "SELECT value FROM settings WHERE key = ? AND deleted_at IS NULL",
    key,
  )[0]?.value;
const bookmarkTitles = (toolbar) =>
  evaluate(
    toolbar,
    'window.api.browser.bookmarks.get().then((snapshot) => snapshot.nodes.filter((node) => node.type === "bookmark").map((node) => node.title).sort().join(","))',
  );
const liveBookmarkTitles = () =>
  sqlite(
    "SELECT title FROM bookmarks WHERE deleted_at IS NULL AND kind = 'url' ORDER BY title",
  )
    .map((row) => row.title)
    .join(",");
const legacyBookmarks = (titles) =>
  JSON.stringify({
    version: 1,
    nodes: [
      {
        id: "favourites",
        type: "folder",
        title: "Favourites",
        parentId: "root",
        index: 0,
        dateAdded: 1,
      },
      ...titles.map((title, index) => ({
        id: `legacy-${title}`,
        type: "bookmark",
        title,
        url: `https://${title.toLowerCase()}.test/`,
        parentId: "favourites",
        index,
        dateAdded: 2,
      })),
    ],
  });

async function launch() {
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
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  await waitFor(() => surface("toolbar"), "the toolbar surface");
  const toolbar = surface("toolbar");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  return { toolbar, origin: `http://127.0.0.1:${port}` };
}

const tabUrls = (toolbar) =>
  evaluate(
    toolbar,
    "window.api.browser.tabs.get().then((tabs) => tabs.map((tab) => tab.url))",
  );

function runPhase(nextPhase, serverPort) {
  const child = spawn(
    process.execPath,
    [
      ...process.argv.slice(1).filter((arg) => !arg.startsWith("--phase")),
      `--phase=${nextPhase}`,
    ],
    {
      env: {
        ...process.env,
        SURFFISH_SESSION_SMOKE_DIR: userData,
        SURFFISH_SESSION_SMOKE_PORT: String(serverPort),
      },
      stdio: "inherit",
    },
  );
  return new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

async function runSave() {
  const { toolbar, origin } = await launch();
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/one`)})`,
  );
  await evaluate(
    toolbar,
    `window.api.browser.tabs.create(${JSON.stringify(`${origin}/two`)})`,
  );
  await waitFor(
    async () => (await tabUrls(toolbar)).includes(`${origin}/two`),
    "the second tab",
  );
  await waitFor(
    () =>
      sqlite(
        "SELECT url FROM session_tabs WHERE deleted_at IS NULL ORDER BY position",
      )
        .map((row) => row.url)
        .join(" ") === `${origin}/one ${origin}/two`,
    "both tabs in session_tabs",
  );
  assert.ok(
    readFileSync(sessionFile, "utf8").includes(`${origin}/two`),
    "browser-session.json is still written",
  );

  // Bookmarks: bookmarks.json from before the database is imported (off the startup path).
  assert.equal(
    await bookmarkTitles(toolbar),
    "Alpha,Beta",
    "legacy bookmarks load",
  );
  await waitFor(
    () => liveBookmarkTitles() === "Alpha,Beta",
    "bookmarks.json imported into the bookmarks table",
  );
  const before = Number(sqlite("SELECT max(seq) AS seq FROM oplog")[0].seq);
  await evaluate(
    toolbar,
    `window.api.browser.bookmarks.create({ parentId: 'favourites', title: 'Gamma', url: ${JSON.stringify(`${origin}/gamma`)} })`,
  );
  await evaluate(
    toolbar,
    'window.api.browser.bookmarks.remove(["legacy-Alpha"])',
  );
  await waitFor(
    () => liveBookmarkTitles() === "Beta,Gamma",
    "the new bookmark and the delete in the database",
  );
  const ops = sqlite(
    "SELECT entity_id, payload FROM oplog WHERE entity = 'bookmark' AND seq > ?",
    before,
  );
  assert.equal(
    ops.length,
    2,
    "two edits = two change-log ops (only changed rows are written)",
  );
  const tombstone = sqlite(
    "SELECT title, url, deleted_at FROM bookmarks WHERE id = 'legacy-Alpha'",
  )[0];
  assert.ok(
    tombstone.deleted_at && tombstone.title === "" && tombstone.url === null,
    "a deleted bookmark is a blank tombstone",
  );
  assert.ok(
    !JSON.stringify(ops).includes("alpha.test"),
    "the change log keeps no deleted URL",
  );
  // Preferences: the pre-database file is imported; a change is one settings row; Forget this site
  // hard-deletes the site's zoom row (no origin left in the change log) and scrubs the JSON now.
  assert.equal(
    await evaluate(toolbar, "window.api.browser.getSearchEngine()"),
    "bing",
    "legacy preferences load",
  );
  await waitFor(
    () => settingValue("pref.searchEngine") === '"bing"',
    "browser-preferences.json imported into settings",
  );
  assert.ok(
    sqlite(
      "SELECT count(*) AS n FROM settings WHERE key LIKE 'zoom:%' AND deleted_at IS NULL",
    )[0].n === 1,
    "the saved zoom is a row",
  );
  const prefsBefore = Number(
    sqlite("SELECT max(seq) AS seq FROM oplog")[0].seq,
  );
  await evaluate(toolbar, 'window.api.browser.setSearchEngine("duckduckgo")');
  await waitFor(
    () => settingValue("pref.searchEngine") === '"duckduckgo"',
    "the search engine change in the database",
  );
  assert.equal(
    sqlite(
      "SELECT count(*) AS n FROM oplog WHERE entity = 'setting' AND seq > ?",
      prefsBefore,
    )[0].n,
    1,
    "one change = one settings op",
  );
  await evaluate(
    toolbar,
    'window.api.browser.safety.siteData.forget("https://zoomed.test", true)',
  );
  assert.equal(
    sqlite("SELECT count(*) AS n FROM settings WHERE key LIKE 'zoom:%'")[0].n,
    0,
    "the zoom row is hard-deleted",
  );
  assert.ok(
    !JSON.stringify(sqlite("SELECT * FROM oplog")).includes("zoomed.test"),
    "no forgotten origin in the change log",
  );
  assert.ok(
    !readFileSync(preferencesFile, "utf8").includes("zoomed.test"),
    "the JSON copy is scrubbed right away",
  );

  // Spaces: browser-spaces.json is imported; a new Space is one row, written to the JSON file too.
  assert.equal(
    await spaceNames(toolbar),
    "Default,Research",
    "legacy Spaces load",
  );
  await waitFor(
    () => liveSpaceNames() === "Default,Research",
    "browser-spaces.json imported into spaces",
  );
  assert.equal(
    sqlite("SELECT value FROM settings WHERE key = 'spaces.enabled'")[0]?.value,
    "true",
  );
  await evaluate(
    toolbar,
    'window.api.browser.spaces.create({ name: "Created" })',
  );
  await waitFor(
    () => liveSpaceNames() === "Default,Research,Created",
    "the new Space in the database",
  );
  assert.ok(
    readFileSync(spacesFile, "utf8").includes("Created"),
    "browser-spaces.json is written alongside",
  );
  // Creating a Space switches to it; go back so the restore phase sees the same tabs.
  await evaluate(toolbar, 'window.api.browser.spaces.switch("default")');
  await waitFor(
    () =>
      sqlite(
        "SELECT active_space_id FROM session_windows WHERE deleted_at IS NULL",
      )[0]?.active_space_id === "default",
    "the Default Space to be active again in the saved session",
  );

  // Row ids the restore phase must see again (taken last: creating a Space above opened a tab in it).
  await delay(800);
  const ids = sqlite(
    "SELECT id FROM session_tabs WHERE deleted_at IS NULL ORDER BY position",
  ).map((row) => row.id);
  writeFileSync(join(userData, "ids.json"), JSON.stringify(ids));

  // bookmarks.json is the fallback copy: rewritten on a slow timer and at quit (will-quit flushes).
  app.emit("will-quit", { preventDefault() {} });
  assert.ok(
    readFileSync(bookmarksFile, "utf8").includes("Gamma"),
    "bookmarks.json is still written alongside (at quit)",
  );
  assert.equal(
    JSON.parse(readFileSync(preferencesFile, "utf8")).searchEngine,
    "duckduckgo",
    "browser-preferences.json too",
  );
  console.log("[session-smoke] save phase passed");
}

async function runRestore() {
  // Change a tab URL in the database only. The JSON file is untouched (still marked as ours), so
  // restoring /edited proves the database was the source.
  const { origin: expectedOrigin } = { origin: `http://127.0.0.1:${port}` };
  sqlite(
    "UPDATE session_tabs SET url = ? WHERE url = ? AND deleted_at IS NULL",
    `${expectedOrigin}/edited`,
    `${expectedOrigin}/two`,
  );
  // Same for bookmarks: a title changed only in the database shows up, so the database was read.
  sqlite("UPDATE bookmarks SET title = 'Gamma (db)' WHERE title = 'Gamma'");
  sqlite(
    `UPDATE settings SET value = '"google"' WHERE key = 'pref.searchEngine'`,
  );
  sqlite("UPDATE spaces SET name = 'Created (db)' WHERE name = 'Created'");
  const { toolbar } = await launch();
  assert.equal(
    await spaceNames(toolbar),
    "Default,Research,Created (db)",
    "Spaces restored from the database",
  );
  assert.equal(
    await evaluate(toolbar, "window.api.browser.getSearchEngine()"),
    "google",
    "preferences restored from the database",
  );
  assert.equal(
    await bookmarkTitles(toolbar),
    "Beta,Gamma (db)",
    "bookmarks restored from the database",
  );
  await waitFor(
    async () =>
      (await tabUrls(toolbar)).join(" ") ===
      `${expectedOrigin}/one ${expectedOrigin}/edited`,
    "tabs restored from the database",
  );
  await delay(1500);
  const ids = sqlite(
    "SELECT id FROM session_tabs WHERE deleted_at IS NULL ORDER BY position",
  ).map((row) => row.id);
  assert.deepEqual(
    ids,
    JSON.parse(readFileSync(join(userData, "ids.json"), "utf8")),
    "restored tabs keep their row ids",
  );
  console.log("[session-smoke] restore phase passed");
}

async function runJsonWins() {
  // Something else (a fallback run, an older build) rewrote browser-session.json: it wins.
  const origin = `http://127.0.0.1:${port}`;
  writeFileSync(
    sessionFile,
    JSON.stringify({
      version: 1,
      tabs: [`${origin}/from-json`],
      activeIndex: 0,
      pinnedTabs: [],
    }),
  );
  writeFileSync(bookmarksFile, legacyBookmarks(["Delta"]));
  writeFileSync(
    preferencesFile,
    JSON.stringify({ version: 1, searchEngine: "brave" }),
  );
  writeFileSync(
    spacesFile,
    JSON.stringify({
      version: 1,
      enabled: true,
      spaces: [
        { id: "default", name: "Default", icon: "", color: "blue" },
        { id: "sjson02", name: "From JSON", icon: "", color: "red" },
      ],
    }),
  );
  const { toolbar } = await launch();
  assert.equal(
    await spaceNames(toolbar),
    "Default,From JSON",
    "a changed browser-spaces.json wins",
  );
  await waitFor(
    () => liveSpaceNames() === "Default,From JSON",
    "spaces to take the JSON file",
  );
  assert.equal(
    await evaluate(toolbar, "window.api.browser.getSearchEngine()"),
    "brave",
    "a changed browser-preferences.json wins",
  );
  await waitFor(
    () => settingValue("pref.searchEngine") === '"brave"',
    "settings to take the JSON preferences",
  );
  assert.equal(
    await bookmarkTitles(toolbar),
    "Delta",
    "a changed bookmarks.json wins",
  );
  await waitFor(
    () => liveBookmarkTitles() === "Delta",
    "the bookmarks table to take the JSON tree",
  );
  await waitFor(
    async () => (await tabUrls(toolbar)).join(" ") === `${origin}/from-json`,
    "tabs restored from the changed JSON file",
  );
  await waitFor(
    () =>
      sqlite("SELECT url FROM session_tabs WHERE deleted_at IS NULL")
        .map((row) => row.url)
        .join(" ") === `${origin}/from-json`,
    "the database to take the JSON session",
  );
  console.log("[session-smoke] json-wins phase passed");
}

async function main() {
  if (phase === "save") return runSave();
  if (phase === "restore") return runRestore();
  if (phase === "json-wins") return runJsonWins();
  // Orchestrator: serves the fixture pages and runs each launch as its own Electron process.
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const serverPort = server.address().port;
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  writeFileSync(bookmarksFile, legacyBookmarks(["Alpha", "Beta"]), {
    mode: 0o600,
  });
  writeFileSync(
    preferencesFile,
    JSON.stringify({
      version: 1,
      searchEngine: "bing",
      siteZoom: { "https://zoomed.test": 1.25 },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    spacesFile,
    JSON.stringify({
      version: 1,
      enabled: true,
      spaces: [
        { id: "default", name: "Default", icon: "", color: "blue" },
        { id: "sjson01", name: "Research", icon: "", color: "green" },
      ],
    }),
    { mode: 0o600 },
  );
  for (const next of ["save", "restore", "json-wins"])
    assert.equal(
      await runPhase(next, serverPort),
      0,
      `the ${next} phase passed`,
    );
  console.log("Electron SQLite session smoke passed.");
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(`Electron SQLite session smoke failed (${phase}):`, error);
    app.exit(1);
  },
);
