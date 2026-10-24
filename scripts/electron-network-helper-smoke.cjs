// Live Network Helper activity in General Settings, against the production build.
// Headless Linux: xvfb-run -a electron --no-sandbox scripts/electron-network-helper-smoke.cjs
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { createConnection } = require("node:net");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-network-helper-smoke-${process.pid}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let client;
async function waitFor(predicate, description) {
  const deadline = Date.now() + smoke.waitMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${description}.`);
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
  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
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
    () => smoke.evaluate(toolbar, "Boolean(window.api?.browser?.chrome)"),
    "the toolbar API",
  );
  await smoke.evaluate(
    toolbar,
    'window.api.browser.chrome.set({ sidebarMode: "connection" })',
  );
  const countText =
    'document.querySelector(".network-helper-activity-heading > span")?.textContent';
  const tunnelStatusText =
    'document.querySelector(".ssh-tunnel-status")?.textContent ?? ""';
  smoke.step(
    "Connection settings show SSH session status separately from the helper listener",
  );
  await waitFor(
    async () => (await ev(tunnelStatusText)).includes("No managed SSH tunnel"),
    "the unconfigured SSH tunnel status",
  );
  smoke.step(
    "Settings → Connection shows the live helper activity without the Network inspector",
  );
  await waitFor(
    async () => (await ev(countText)) === "0 active connections",
    "the initial helper connection count",
  );
  assert.deepEqual(
    await ev(
      '[...document.querySelectorAll(".network-helper-activity-metric > strong")].map((node) => node.textContent.trim())',
    ),
    ["0 B/s", "0 B/s"],
  );
  smoke.step(
    "A local client connection and disconnection refresh the displayed count",
  );
  client = createConnection({ host: "127.0.0.1", port: 1088 });
  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  await waitFor(
    async () => (await ev(countText)) === "1 active connection",
    "a connected local client in the activity panel",
  );
  client.destroy();
  await waitFor(
    async () => (await ev(countText)) === "0 active connections",
    "the disconnected client leaving the activity panel",
  );
  console.log("Electron Network Helper activity smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    client?.destroy();
    console.error("Electron Network Helper activity smoke failed:", error);
    app.exit(1);
  },
);
