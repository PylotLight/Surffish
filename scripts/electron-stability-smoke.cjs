// Integration smoke: crash and churn resilience (chaos). Against the production build, in one session:
//   - main-process errors (uncaught exception, unhandled rejection, a throwing ipcMain.on listener)
//     are logged and counted, and the app keeps running (no modal error dialog, no exit)
//   - a page renderer killed with SIGKILL shows the crash screen, and Reload brings the page back
//   - the toolbar's renderer killed with SIGKILL reloads by itself and drives the browser again
//   - the GPU process killed with SIGKILL comes back and pages still load and paint
//   - windows and tabs opened and closed rapidly (no awaiting loads) leave no extra windows and
//     no main-process errors
//   - quitting while pages are still loading (a request that never answers) exits promptly
// Counters come from globalThis.__surffishStability (src/main/crash-guard.ts).
// `bun run build && bun run test:electron-stability`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-stability-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  ipcMain,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-stability-smoke-${process.pid}`);
const hanging = new Set();
const PAGE = (title) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="background:#0a7"><h1>${title}</h1>`;
const server = createServer((request, response) => {
  if (request.url.startsWith("/never")) {
    // Never answers: the page stays loading until quit.
    hanging.add(response);
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(PAGE(request.url.slice(1) || "home"));
});

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const stats = () => globalThis.__surffishStability;

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
    await delay(100);
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
const surface = (win, name) =>
  win.contentView.children.find(
    (view) =>
      view.webContents &&
      !view.webContents.isDestroyed() &&
      surfaceFor(view) === name,
  );
const windows = () =>
  BaseWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && surface(win, "toolbar"),
  );
const pageContents = (url) =>
  allWebContents
    .getAllWebContents()
    .find((contents) => !contents.isDestroyed() && contents.getURL() === url);
const gpuPid = () =>
  app.getAppMetrics().find((metric) => metric.type === "GPU")?.pid ?? 0;

function kill(pid, what) {
  assert.ok(pid > 0, `${what} has a process`);
  process.kill(pid, "SIGKILL");
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({
      version: 1,
      tabs: [`${origin}/one`, `${origin}/two`],
      activeIndex: 0,
    }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  assert.ok(
    stats(),
    "the crash guard is installed (globalThis.__surffishStability)",
  );
  const win = await waitFor(() => windows()[0], "the main window");
  const toolbar = () => surface(win, "toolbar").webContents;
  const api = (code) => smoke.evaluate(toolbar(), `window.api.browser.${code}`);
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar(),
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  await waitFor(async () => {
    const state = await api("state()");
    return state.url === `${origin}/one` && !state.loading;
  }, "the first tab");

  // --- 1. main-process errors are caught, logged and counted; the app keeps going
  smoke.step("main-process errors are caught and counted");
  ipcMain.on("stability-smoke:throw", () => {
    throw new Error("stability smoke: listener threw");
  });
  ipcMain.on("stability-smoke:reject", async () => {
    throw new Error("stability smoke: listener rejected");
  });
  ipcMain.emit("stability-smoke:throw", { sender: toolbar() });
  ipcMain.emit("stability-smoke:reject", { sender: toolbar() });
  setTimeout(() => {
    throw new Error("stability smoke: uncaught");
  }, 0);
  void Promise.reject(new Error("stability smoke: unhandled"));
  await waitFor(
    () =>
      stats().ipcListenerErrors === 2 &&
      stats().uncaughtExceptions === 1 &&
      stats().unhandledRejections === 1,
    "the four deliberate errors to be counted",
  );
  assert.equal(
    (await api("state()")).url,
    `${origin}/one`,
    "the app still answers",
  );
  const baseline = { ...stats() };

  // --- 2. a page renderer dies: crash screen, then Reload brings it back
  smoke.step("killing the active page renderer");
  const one = await waitFor(
    () => pageContents(`${origin}/one`),
    "the /one page",
  );
  kill(one.getOSProcessId(), "the /one page");
  await waitFor(
    async () => (await api("state()")).interstitial?.kind === "crashed",
    "the crash screen on the active tab",
  );
  assert.equal(
    stats().tabRendererGone,
    baseline.tabRendererGone + 1,
    "counted as a tab crash",
  );
  assert.equal(
    await api('safety.tabRecovery("reload")'),
    true,
    "Reload on the crash screen",
  );
  await waitFor(async () => {
    const state = await api("state()");
    return (
      state.interstitial === null &&
      !state.loading &&
      state.url === `${origin}/one`
    );
  }, "the page back after Reload");
  await waitFor(
    () =>
      smoke.evaluate(pageContents(`${origin}/one`), 'document.title === "one"'),
    "the reloaded page to render",
  );

  // --- 3. the toolbar renderer dies: it reloads itself and works again
  smoke.step("killing the toolbar renderer");
  const toolbarContents = toolbar();
  const toolbarPid = toolbarContents.getOSProcessId();
  kill(toolbarPid, "the toolbar");
  await waitFor(
    () => stats().shellReloads > baseline.shellReloads,
    "the toolbar to be reloaded",
  );
  await waitFor(
    () =>
      !toolbarContents.isDestroyed() &&
      toolbarContents.getOSProcessId() !== toolbarPid &&
      toolbarContents.getOSProcessId() > 0,
    "a new toolbar process",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar(),
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the reloaded toolbar",
  );
  assert.equal(
    stats().shellRendererGone,
    baseline.shellRendererGone + 1,
    "counted as an app-surface crash",
  );
  await api(`tabs.create(${JSON.stringify(`${origin}/after-toolbar`)})`);
  await waitFor(async () => {
    const state = await api("state()");
    return state.url === `${origin}/after-toolbar` && !state.loading;
  }, "a new tab from the reloaded toolbar");
  await waitFor(
    () => smoke.evaluate(toolbar(), `document.body.textContent.length > 0`),
    "the toolbar to draw",
  );

  // --- 4. the GPU process dies: Chromium relaunches it; pages still load and paint
  const firstGpu = gpuPid();
  if (firstGpu) {
    smoke.step("killing the GPU process");
    kill(firstGpu, "the GPU");
    await waitFor(
      () => stats().gpuGone > baseline.gpuGone,
      "the GPU crash to be counted",
    );
    await waitFor(
      () => gpuPid() > 0 && gpuPid() !== firstGpu,
      "a new GPU process",
    );
    await api(`navigate(${JSON.stringify(`${origin}/after-gpu`)})`);
    await waitFor(async () => {
      const state = await api("state()");
      return state.url === `${origin}/after-gpu` && !state.loading;
    }, "a page load after the GPU restart");
    const page = await waitFor(
      () => pageContents(`${origin}/after-gpu`),
      "the /after-gpu page",
    );
    const image = await waitFor(async () => {
      const shot = await page.capturePage();
      return shot.isEmpty() ? null : shot;
    }, "the page to paint after the GPU restart");
    assert.ok(image.getSize().width > 0);
  } else {
    smoke.step(
      "no GPU process in this environment (in-process GPU); skipping the GPU kill",
    );
  }

  // --- 5. rapid window and tab churn
  smoke.step("rapid window and tab churn");
  const startWindows = windows().length;
  for (let round = 0; round < 4; round += 1) {
    await api("tabs.newWindow(false)");
    const extra = await waitFor(
      () => windows().find((candidate) => candidate !== win),
      `extra window ${round + 1}`,
    );
    // Close it before its surfaces have finished loading on some rounds, after on others.
    if (round % 2 === 1)
      await waitFor(
        () =>
          smoke.evaluate(
            surface(extra, "toolbar").webContents,
            "Boolean(window.api)",
          ),
        "the extra window toolbar",
      );
    extra.close();
    await waitFor(
      () => windows().length === startWindows,
      `extra window ${round + 1} to close`,
    );
  }
  for (let round = 0; round < 12; round += 1) {
    // Fire and forget: create, then close before the page has loaded.
    await api(`tabs.create(${JSON.stringify(`${origin}/churn-${round}`)})`);
    const tabs = await api("tabs.get()");
    const churn = tabs.find((tab) => tab.url.endsWith(`/churn-${round}`));
    if (churn && round % 3 !== 0)
      await api(`tabs.close(${JSON.stringify(churn.id)})`);
  }
  await waitFor(
    async () =>
      (await api("tabs.get()")).filter((tab) => tab.url.includes("/churn-"))
        .length === 4,
    "the 4 kept churn tabs",
  );
  assert.equal(windows().length, 1, "no window left behind");

  // --- nothing unexpected went wrong
  const final = stats();
  for (const key of [
    "uncaughtExceptions",
    "unhandledRejections",
    "ipcListenerErrors",
  ]) {
    assert.equal(
      final[key],
      baseline[key],
      `no new ${key} during the chaos (${JSON.stringify(final.recent.slice(-5))})`,
    );
  }
  assert.equal(
    final.otherRendererGone,
    baseline.otherRendererGone,
    `no other renderer died (${JSON.stringify(final.recent.slice(-5))})`,
  );

  // --- 6. quit while pages are still loading
  smoke.step("quitting while two pages are still loading");
  await api(`tabs.create(${JSON.stringify(`${origin}/never-a`)})`);
  await api(`tabs.create(${JSON.stringify(`${origin}/never-b`)})`);
  await waitFor(() => hanging.size >= 2, "the two hanging requests");
  const quitStarted = Date.now();
  const exitTimer = setTimeout(() => {
    console.error(
      `Electron stability smoke failed: quit did not finish within 15s (still loading: ${hanging.size}).`,
    );
    process.exit(1);
  }, 15_000);
  exitTimer.unref();
  process.once("exit", (code) => {
    if (code === 0)
      console.log(
        `Electron stability smoke passed (quit took ${Date.now() - quitStarted} ms).`,
      );
  });
  app.quit();
}

process.once("exit", () => {
  for (const response of hanging) response.destroy();
  try {
    smoke.removeProfile(userData);
  } catch {
    /* best effort */
  }
});

run().catch((error) => {
  console.error("Electron stability smoke failed:", error);
  app.exit(1);
});
