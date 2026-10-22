// Smoke for Surffish's channel into Web Store extension service workers (main/extension-bridge.ts):
// the service-worker preload transport, and the hidden bridge page it falls back to.
//   bun run build && bun run test:electron-extension-sw-preload
//   SURFFISH_EXTENSION_BRIDGE=page ... (force the bridge page; also what --no-sandbox gets)
//   SW_SMOKE_EXTENSIONS=3 ...          (seed several copies of the fixture, for the memory numbers)
//   SW_SMOKE_REAL_EXTENSION=/tmp/ubol  (also load a real staged extension, e.g. uBO Lite, and check
//                                       its channel comes up and its DNR rules reach Surffish)
//
// Verifies, with a generated MV3 fixture (webNavigation + declarativeNetRequest + storage):
//  1. the transport: 'worker' with the sandbox on (no bridge page exists), else 'page'
//  2. webNavigation.onCommitted reaches the worker (and how long main → worker takes)
//  3. webNavigation.getAllFrames answers from main (main frame + iframe)
//  4. storage.onChanged fires in the worker for a page's write (once, with two pages open) and for
//     the worker's own write (once, although both pages relay it too)
//  5. a dynamic DNR rule added from an extension page is enforced by Surffish
//  6. the worker is stopped (DevTools ServiceWorker.stopAllWorkers): a tab navigation wakes it and
//     the event still arrives (and how long the wake took)
//  7. the extension renderer process is killed: the worker restarts and events arrive again
// Prints process counts / memory of the extension processes and the bridge pages for comparison.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync } = require("node:crypto");
const { createServer } = require("node:http");
const { cpSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, BrowserWindow, webContents } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

process.env.SURFFISH_SMOKE_DNR_STATS = "1";
process.env.SURFFISH_SMOKE_EXTENSION_BRIDGE = "1";
const userData = join(
  tmpdir(),
  `surffish-extension-sw-preload-smoke-${process.pid}`,
);
const copies = Math.max(
  1,
  Math.min(8, Number(process.env.SW_SMOKE_EXTENSIONS) || 1),
);
const realExtension = process.env.SW_SMOKE_REAL_EXTENSION
  ? resolve(process.env.SW_SMOKE_REAL_EXTENSION)
  : null;
const requests = [];
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const server = createServer((request, response) => {
  requests.push(request.url);
  const send = (type, body) => {
    response.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    response.end(body);
  };
  if (request.url.startsWith("/page"))
    return send(
      "text/html; charset=utf-8",
      `<!doctype html><title>p</title><script src="/dyn.js"></script><iframe src="/frame"></iframe>`,
    );
  if (request.url === "/frame")
    return send("text/html; charset=utf-8", "<!doctype html><p>frame</p>");
  if (request.url === "/dyn.js")
    return send("text/javascript", "window.dynLoaded = true");
  response.writeHead(404);
  response.end();
});

function expectedTransport() {
  if ((process.env.SURFFISH_EXTENSION_BRIDGE || "").toLowerCase() === "page")
    return "page";
  if (
    process.env.ELECTRON_DISABLE_SANDBOX ||
    app.commandLine.hasSwitch("no-sandbox")
  )
    return "page";
  return "worker";
}

function extensionIdForKey(base64Key) {
  return createHash("sha256")
    .update(Buffer.from(base64Key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) =>
      String.fromCharCode(97 + parseInt(digit, 16)),
    );
}

const BACKGROUND = `
const bootId = Date.now() + '-' + Math.random().toString(36).slice(2)
const log = { committed: [], storage: [] }
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0 && d.url.startsWith('http')) log.committed.push({ url: d.url, lag: Date.now() - d.timeStamp, bootId })
})
chrome.storage.onChanged.addListener((changes, area) => log.storage.push({ area, keys: Object.keys(changes).sort(), changes }))
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.cmd !== 'string') return undefined
  if (message.cmd === 'log') { sendResponse({ ...log, bootId }); return undefined }
  if (message.cmd === 'reset') { log.committed = []; log.storage = []; sendResponse(true); return undefined }
  if (message.cmd === 'own-write') { chrome.storage.local.set({ own: message.value }).then(() => sendResponse(true)); return true }
  if (message.cmd === 'frames') { chrome.webNavigation.getAllFrames({ tabId: message.tabId }).then(sendResponse, (error) => sendResponse({ error: String(error) })); return true }
  return undefined
})
`;

function writeFixture(directory, index) {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const manifest = {
    manifest_version: 3,
    name: `Surffish SW preload fixture ${index + 1}`,
    version: "1.0.0",
    key,
    permissions: ["storage", "webNavigation", "declarativeNetRequest"],
    host_permissions: ["http://*/*"],
    background: { service_worker: "surffish-extension-background.js" },
    declarative_net_request: {
      rule_resources: [{ id: "static", enabled: true, path: "rules.json" }],
    },
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  writeFileSync(
    join(directory, "rules.json"),
    JSON.stringify([
      {
        id: 1,
        action: { type: "block" },
        condition: {
          urlFilter: "/never-requested.js",
          resourceTypes: ["script"],
        },
      },
    ]),
  );
  writeFileSync(join(directory, "background.js"), BACKGROUND);
  // An extension page with Surffish's shim (staging injects it into every page; the smoke seeds files directly).
  writeFileSync(
    join(directory, "driver.html"),
    '<!doctype html><meta charset="utf-8"><script src="/surffish-extension-shim.js" data-surffish-extension-shim></script><p>driver</p>',
  );
  writeFileSync(
    join(directory, "surffish-extension.json"),
    JSON.stringify({
      worker: {
        original: "background.js",
        wrapper: "surffish-extension-background.js",
        module: false,
      },
    }),
  );
  return {
    id: extensionIdForKey(key),
    version: manifest.version,
    name: manifest.name,
  };
}

function seedExtensions() {
  const root = join(userData, "extensions");
  const infos = [];
  for (let index = 0; index < copies; index += 1) {
    const scratch = join(userData, `fixture-source-${index}`);
    const info = writeFixture(scratch, index);
    cpSync(scratch, join(root, info.id, info.version), { recursive: true });
    infos.push(info);
  }
  let real = null;
  if (realExtension) {
    const manifest = JSON.parse(
      readFileSync(join(realExtension, "manifest.json"), "utf8"),
    );
    assert.ok(
      manifest.key,
      "stage the real extension with scripts/fetch-web-store-extension.ts (it pins the store key)",
    );
    real = {
      id: extensionIdForKey(manifest.key),
      version: manifest.version,
      name: "real extension",
    };
    cpSync(realExtension, join(root, real.id, real.version), {
      recursive: true,
    });
  }
  const now = Date.now();
  const all = real ? [...infos, real] : infos;
  writeFileSync(
    join(root, "installed.json"),
    JSON.stringify({
      version: 1,
      extensions: all.map((info) => ({
        ...info,
        enabled: true,
        installedAt: now,
        updatedAt: now,
        compatibility: "partial",
        gaps: [],
        shimmed: [],
      })),
    }),
  );
  return { fixtures: infos, real };
}

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

const views = (win) =>
  win.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
function surface(win, name) {
  return views(win).find((view) => {
    try {
      return (
        new URL(view.webContents.getURL()).searchParams.get("surface") === name
      );
    } catch {
      return false;
    }
  });
}

async function evaluate(contents, expression) {
  try {
    return await contents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

function channel(id) {
  return (globalThis.__surffishExtensionBridgeSnapshot?.() ?? []).find(
    (entry) => entry.id === id,
  );
}

function memorySummary(extensionIds, browserSession) {
  const running = Object.values(browserSession.serviceWorkers.getAllRunning());
  const workerProcessIds = new Set(
    running
      .filter((info) =>
        extensionIds.some((id) => info.scope === `chrome-extension://${id}/`),
      )
      .map((info) => info.renderProcessId),
  );
  const bridgePages = webContents
    .getAllWebContents()
    .filter(
      (contents) =>
        /\/surffish-bridge\.html$/.test(contents.getURL()) &&
        !contents.isDestroyed(),
    );
  const bridgeOsPids = new Set(
    bridgePages.map((contents) => contents.getOSProcessId()),
  );
  const metrics = app.getAppMetrics();
  const total = metrics.reduce(
    (sum, entry) => sum + (entry.memory?.workingSetSize ?? 0),
    0,
  );
  return {
    processes: metrics.length,
    workingSetMB: +(total / 1024).toFixed(1),
    webContents: webContents.getAllWebContents().length,
    bridgePages: bridgePages.length,
    bridgePageProcesses: bridgeOsPids.size,
    extensionWorkerProcesses: workerProcessIds.size,
  };
}

/**
 * SW_SMOKE_BENCH=1 (worker transport): what the bridge pages would cost on top, measured in the same
 * run. Opens one bridge-page-equivalent view per fixture (the same file, no preload) and compares
 * app.getAppMetrics before and after (working set, Linux), per process and in total.
 */
async function benchBridgePages(fixtures, browserSession) {
  const { WebContentsView } = require("electron");
  const sample = () =>
    new Map(
      app
        .getAppMetrics()
        .map((entry) => [entry.pid, entry.memory?.workingSetSize ?? 0]),
    );
  const sum = (map) =>
    [...map.values()].reduce((total, value) => total + value, 0);
  const rounds = [];
  for (let round = 0; round < 3; round += 1) {
    await delay(1500);
    const before = sample();
    const opened = [];
    for (const info of fixtures) {
      const view = new WebContentsView({
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      });
      await view.webContents.loadURL(
        `chrome-extension://${info.id}/surffish-bridge.html`,
      );
      opened.push(view);
    }
    await delay(2500);
    const after = sample();
    const pids = new Set(
      opened.map((view) => view.webContents.getOSProcessId()),
    );
    const extensionDelta = [...pids].reduce(
      (total, pid) => total + ((after.get(pid) ?? 0) - (before.get(pid) ?? 0)),
      0,
    );
    const newProcesses = [...after.keys()].filter(
      (pid) => !before.has(pid),
    ).length;
    rounds.push({
      totalDeltaMB: +((sum(after) - sum(before)) / 1024).toFixed(1),
      extensionProcessDeltaMB: +(extensionDelta / 1024).toFixed(1),
      newProcesses,
      pagesSharedExistingProcess: [...pids].every((pid) => before.has(pid)),
    });
    for (const view of opened) view.webContents.close();
    await delay(1500);
  }
  console.log(
    `BENCH bridge pages on top of the worker transport, ${fixtures.length} extension(s): ${JSON.stringify(rounds)}`,
  );
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
  const { fixtures, real } = seedExtensions();
  const extension = fixtures[0];
  const extensionUrl = `chrome-extension://${extension.id}/`;

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const win = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  win.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  const toolbar = await waitFor(
    () => surface(win, "toolbar"),
    "the toolbar surface",
  );
  await waitFor(
    () =>
      evaluate(
        toolbar.webContents,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const navigate = (url) =>
    evaluate(
      toolbar.webContents,
      `window.api.browser.navigate(${JSON.stringify(url)})`,
    );

  // --- 1. transport
  const expected = expectedTransport();
  const ready = await waitFor(
    () =>
      fixtures.every((info) => channel(info.id)?.ready) &&
      channel(extension.id),
    "every fixture channel to be ready",
    smoke.waitMs + 15000,
  );
  assert.equal(
    ready.transport,
    expected,
    `the channel uses the ${expected} transport`,
  );
  for (const info of fixtures)
    assert.equal(channel(info.id).transport, expected);
  const bridgePages = () =>
    webContents
      .getAllWebContents()
      .filter((contents) => /\/surffish-bridge\.html$/.test(contents.getURL()));
  if (expected === "worker")
    assert.equal(
      bridgePages().length,
      0,
      "no hidden bridge pages with the service-worker preload",
    );
  else
    await waitFor(
      () => bridgePages().length >= fixtures.length,
      "one bridge page per fixture",
    );
  console.log(
    `ok: transport = ${expected} for ${fixtures.length} extension(s); bridge pages: ${bridgePages().length}`,
  );

  // A real tab gives us the browser session.
  await navigate(`${origin}/page?0`);
  const tab = await waitFor(
    () =>
      views(win).find(
        (view) => view.webContents.getURL() === `${origin}/page?0`,
      ),
    "the first tab",
  );
  const browserSession = tab.webContents.session;
  await delay(1500);
  const memory = memorySummary(
    fixtures.map((info) => info.id),
    browserSession,
  );
  console.log(
    `METRICS ${JSON.stringify({ transport: expected, extensions: fixtures.length, ...memory })}`,
  );

  if (process.env.SW_SMOKE_BENCH === "1")
    await benchBridgePages(fixtures, browserSession);

  const driverWindow = () =>
    new BrowserWindow({
      show: false,
      webPreferences: {
        session: browserSession,
        sandbox: true,
        contextIsolation: true,
      },
    });
  const driverA = driverWindow();
  await driverA.loadURL(`${extensionUrl}driver.html`);
  const toWorker = (message) =>
    evaluate(
      driverA.webContents,
      `chrome.runtime.sendMessage(${JSON.stringify(message)})`,
    );
  await toWorker({ cmd: "reset" });

  // --- 2. webNavigation events + latency
  const lags = [];
  for (let index = 1; index <= 10; index += 1) {
    const url = `${origin}/page?${index}`;
    await navigate(url);
    const entry = await waitFor(
      async () =>
        (await toWorker({ cmd: "log" })).committed.find(
          (item) => item.url === url,
        ),
      `onCommitted for ${url}`,
    );
    lags.push(entry.lag);
  }
  console.log(
    `ok: webNavigation.onCommitted reaches the worker (main → worker median ${median(lags)} ms, max ${Math.max(...lags)} ms over ${lags.length})`,
  );

  // --- 3. getAllFrames
  const current = await waitFor(
    () =>
      views(win).find(
        (view) =>
          view.webContents.getURL().startsWith(`${origin}/page`) &&
          !view.webContents.isLoading(),
      ),
    "a loaded tab",
  );
  await waitFor(
    async () =>
      await evaluate(
        current.webContents,
        'document.querySelector("iframe") && document.querySelector("iframe").contentDocument && document.querySelector("iframe").contentDocument.readyState === "complete"',
      ),
    "the iframe",
  );
  const frames = await toWorker({
    cmd: "frames",
    tabId: current.webContents.id,
  });
  assert.ok(
    Array.isArray(frames),
    `getAllFrames answered: ${JSON.stringify(frames)}`,
  );
  assert.equal(frames.length, 2, "main frame + iframe");
  assert.ok(
    frames.some((frame) => frame.frameId === 0) &&
      frames.some((frame) => frame.frameId > 0),
  );
  console.log("ok: webNavigation.getAllFrames answered by main (2 frames)");

  // --- 4. storage.onChanged in the worker
  const driverB = driverWindow();
  await driverB.loadURL(`${extensionUrl}driver.html`);
  await toWorker({ cmd: "reset" });
  await evaluate(
    driverA.webContents,
    "chrome.storage.local.set({ fromPage: 1 })",
  );
  await waitFor(
    async () =>
      (await toWorker({ cmd: "log" })).storage.some((item) =>
        item.keys.includes("fromPage"),
      ),
    "the page write to reach the worker’s storage.onChanged",
  );
  await toWorker({ cmd: "own-write", value: 7 });
  await delay(600);
  const storageLog = (await toWorker({ cmd: "log" })).storage;
  assert.equal(
    storageLog.filter((item) => item.keys.includes("fromPage")).length,
    1,
    "a page write fires once in the worker (two pages relay it)",
  );
  assert.equal(
    storageLog.filter((item) => item.keys.includes("own")).length,
    1,
    "the worker’s own write fires once in the worker",
  );
  assert.deepEqual(
    storageLog.find((item) => item.keys.includes("own")).changes.own,
    { newValue: 7 },
  );
  console.log(
    "ok: storage.onChanged fires in the worker for page and own writes, once each",
  );
  driverB.destroy();

  // --- 5. dynamic DNR rule from an extension page
  const rulesBefore = globalThis.__surffishExtensionDnrStats().rules;
  await evaluate(
    driverA.webContents,
    `chrome.declarativeNetRequest.updateDynamicRules({ addRules: [{ id: 50, priority: 1, action: { type: 'block' }, condition: { urlFilter: '/dyn.js', resourceTypes: ['script'] } }] })`,
  );
  await waitFor(
    () => globalThis.__surffishExtensionDnrStats().rules > rulesBefore,
    "Surffish to receive the new dynamic rule",
  );
  requests.length = 0;
  await navigate(`${origin}/page?dnr`);
  const dnrTab = await waitFor(
    () =>
      views(win).find(
        (view) =>
          view.webContents.getURL() === `${origin}/page?dnr` &&
          !view.webContents.isLoading(),
      ),
    "the DNR tab",
  );
  assert.equal(
    await evaluate(dnrTab.webContents, "window.dynLoaded === true"),
    false,
    "the dynamically blocked script did not run",
  );
  assert.ok(
    !requests.includes("/dyn.js"),
    "the blocked request never reached the server",
  );
  console.log("ok: dynamic DNR rule from an extension page enforced");

  // --- 6. worker stopped → woken by a navigation event
  const before = (await toWorker({ cmd: "log" })).bootId;
  const debuggerTarget = driverA.webContents.debugger;
  debuggerTarget.attach("1.3");
  await debuggerTarget.sendCommand("ServiceWorker.enable");
  await debuggerTarget.sendCommand("ServiceWorker.stopAllWorkers");
  const isRunning = () =>
    Object.values(browserSession.serviceWorkers.getAllRunning()).some(
      (info) => info.scope === extensionUrl,
    );
  await waitFor(() => !isRunning(), "the worker to stop");
  if (expected === "worker")
    await waitFor(
      () => channel(extension.id).ready === false,
      "the channel to notice the stop",
    );
  const wakeUrl = `${origin}/page?wake`;
  const wakeStarted = Date.now();
  await navigate(wakeUrl);
  await waitFor(() => isRunning(), "the navigation event to wake the worker");
  const woken = await waitFor(async () => {
    const log = await toWorker({ cmd: "log" });
    return log.committed.find((item) => item.url === wakeUrl) ? log : null;
  }, "the queued onCommitted after the wake");
  const wakeMs = Date.now() - wakeStarted;
  assert.notEqual(
    woken.bootId,
    before,
    "a fresh worker run received the event",
  );
  const afterWake = channel(extension.id);
  console.log(
    `ok: stopped worker woken by onCommitted, event delivered (navigate → event in the new worker ${wakeMs} ms${afterWake.lastWakeMs != null ? `, startWorkerForScope ${afterWake.lastWakeMs.toFixed(0)} ms` : ""})`,
  );

  // --- 7. extension renderer killed → worker restarts, events still arrive
  const runningInfo = Object.values(
    browserSession.serviceWorkers.getAllRunning(),
  ).find((info) => info.scope === extensionUrl);
  const pidGuess =
    driverA.webContents.getProcessId() === runningInfo.renderProcessId;
  console.log(
    `(the driver page ${pidGuess ? "shares" : "does not share"} the worker's renderer process)`,
  );
  debuggerTarget.detach();
  if (pidGuess) {
    driverA.webContents.forcefullyCrashRenderer();
    await waitFor(() => !isRunning(), "the worker to die with its process");
    const crashUrl = `${origin}/page?crash`;
    await navigate(crashUrl);
    await waitFor(
      () => isRunning(),
      "the worker to come back for the next event",
    );
    driverA.webContents.reload();
    await waitFor(
      async () =>
        !driverA.webContents.isLoading() &&
        (await evaluate(
          driverA.webContents,
          "Boolean(chrome.runtime && chrome.runtime.id)",
        )),
      "the driver page to reload",
    );
    await waitFor(
      async () =>
        (await toWorker({ cmd: "log" })).committed.some(
          (item) => item.url === crashUrl,
        ),
      "onCommitted after the crash",
    );
    console.log(
      "ok: after the extension process was killed the worker restarted and got the next event",
    );
  } else {
    console.log(
      "skip: crash step (the worker runs in its own process; killing it from here is not possible)",
    );
  }
  const final = channel(extension.id);
  console.log(`channel stats: ${JSON.stringify(final)}`);

  if (real) {
    const realChannel = await waitFor(
      () => channel(real.id)?.ready && channel(real.id),
      "the real extension channel",
      smoke.waitMs + 15000,
    );
    console.log(
      `ok: real extension ${real.id} channel = ${realChannel.transport}, DNR rules in Surffish: ${globalThis.__surffishExtensionDnrStats().rules}`,
    );
  }
  driverA.destroy();
  console.log("Electron extension service-worker preload smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error(
      "Electron extension service-worker preload smoke failed:",
      error,
    );
    app.exit(1);
  },
);
