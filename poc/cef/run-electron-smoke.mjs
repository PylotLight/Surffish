import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FILTER_ENVIRONMENT } from "../../src/main/adblock-policy.ts";

const electronBinary = process.env.ELECTRON_POC_BINARY
  ? resolve(process.env.ELECTRON_POC_BINARY)
  : undefined;
if (!electronBinary || !existsSync(electronBinary)) {
  throw new Error("Set ELECTRON_POC_BINARY to the Electron 46 binary to test.");
}
const extensionPath = process.env.ELECTRON_POC_EXTENSION_PATH
  ? resolve(process.env.ELECTRON_POC_EXTENSION_PATH)
  : undefined;
if (extensionPath && !existsSync(`${extensionPath}/manifest.json`)) {
  throw new Error("ELECTRON_POC_EXTENSION_PATH must contain a staged manifest.json.");
}
const engineFile = process.env.ELECTRON_POC_ENGINE_FILE
  ? resolve(process.env.ELECTRON_POC_ENGINE_FILE)
  : undefined;
if (engineFile && !existsSync(engineFile)) {
  throw new Error("ELECTRON_POC_ENGINE_FILE must point to a serialized Ghostery engine.");
}
const blockHost = process.env.ELECTRON_POC_BLOCK_HOST ?? "tracker.test";
if (!/^[A-Za-z0-9.-]+$/.test(blockHost)) {
  throw new Error("ELECTRON_POC_BLOCK_HOST must be a hostname.");
}
const filterMode = engineFile ? "production-live-lists" : "synthetic-fixture";
const hasBrambleProbe = Boolean(
  extensionPath && existsSync(`${extensionPath}/cef-api-probe.js`),
);
const repoRoot = resolve(import.meta.dir, "../..");
const ghosteryPackage = join(repoRoot, "node_modules/@ghostery/adblocker-electron");
if (!existsSync(`${ghosteryPackage}/package.json`)) {
  throw new Error("The repository's @ghostery/adblocker-electron dependency is unavailable.");
}
const tempRoot = process.env.ELECTRON_POC_TMPDIR ?? "/dev/shm";
const appDir = mkdtempSync(join(tempRoot, "surffish-electron-poc-"));
const packageScope = join(appDir, "node_modules/@ghostery");
mkdirSync(packageScope, { recursive: true });
symlinkSync(ghosteryPackage, join(packageScope, "adblocker-electron"), "dir");
const userDataDir = join(appDir, "user-data");
writeFileSync(
  join(appDir, "package.json"),
  JSON.stringify({ name: "surffish-electron-poc", version: "1.0.0", main: "main.mjs", type: "module" }, null, 2),
);
writeFileSync(
  join(appDir, "main.mjs"),
  `import { app, BrowserWindow, session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { readFileSync } from 'node:fs';

const url = process.env.SURFFISH_ELECTRON_POC_URL;
const extensionPath = process.env.SURFFISH_ELECTRON_POC_EXTENSION_PATH;
const engineFile = process.env.SURFFISH_ELECTRON_POC_ENGINE_FILE;
const blockHost = process.env.SURFFISH_ELECTRON_POC_BLOCK_HOST;
console.log('ELECTRON_POC_RUNTIME=' + JSON.stringify({ electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node }));
app.setPath('userData', process.env.SURFFISH_ELECTRON_POC_USER_DATA);
if (!url) throw new Error('Missing SURFFISH_ELECTRON_POC_URL');
app.whenReady().then(async () => {
  if (extensionPath) {
    const extension = await session.defaultSession.loadExtension(extensionPath, { allowFileAccess: false });
    console.log('ELECTRON_POC_EXTENSION=' + JSON.stringify({ id: extension.id, name: extension.name }));
  }
  const blocker = engineFile
    ? ElectronBlocker.deserialize(readFileSync(engineFile))
    : ElectronBlocker.parse('||${blockHost}^$script');
  blocker.updateEnv(new Map(JSON.parse(process.env.SURFFISH_ELECTRON_POC_FILTER_ENV || '[]')));
  const original = blocker.onBeforeRequest;
  blocker.onBeforeRequest = (details, callback) => {
    original(details, (response) => {
      if (details.url.includes(blockHost) || details.url.includes('allowed.test')) {
        console.log('ELECTRON_POC_DECISION=' + JSON.stringify({
          url: details.url,
          resourceType: details.resourceType,
          cancel: response.cancel === true,
        }));
      }
      callback(response);
    });
  };
  blocker.enableBlockingInSession(session.defaultSession);
  const window = new BrowserWindow({
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.on('page-title-updated', (_event, title) => {
    if (title.startsWith('CEF_POC_RESULT:')) {
      console.log('ELECTRON_POC_TITLE=' + title);
      setTimeout(() => app.quit(), 100);
    }
  });
  window.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
`,
);

const originRequests = [];
const pageServer = http.createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    const port = pageServer.address().port;
    const waitForBramble = hasBrambleProbe
      ? `const waitForBramble = () => new Promise((resolve) => {
  let attempts = 0;
  const poll = () => {
    const result = document.documentElement?.dataset.cefBrambleProbe;
    if (result) {
      try {
        const data = JSON.parse(result);
        const phase = data.background?.phase;
        if (phase === 'background-import-failed' ||
            (phase === 'background-imported' && data.originProbe && !data.originProbe.pending)) {
          return resolve(result);
        }
      } catch {}
    }
    if (attempts++ >= 100) return resolve(result ?? 'missing');
    setTimeout(poll, 100);
  };
  poll();
});`
      : `const waitForBramble = () => Promise.resolve('not-requested');`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>starting</title>
<script>
${waitForBramble}
const load = (src) => new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = src;
  script.onload = () => resolve('loaded');
  script.onerror = () => resolve('blocked');
  document.head.appendChild(script);
});
Promise.all([
  load('http://${blockHost}:${port}/tracker.js'),
  load('http://allowed.test:${port}/allowed.js'),
  waitForBramble()
]).then(([tracker, allowed, bramble]) => {
  document.title = 'CEF_POC_RESULT:tracker=' + tracker + ';allowed=' + allowed +
    ';trackerExecuted=' + (window.trackerExecuted === true) +
    ';allowedExecuted=' + (window.allowedExecuted === true) +
    ';bramble=' + encodeURIComponent(bramble);
});
</script>`);
    return;
  }
  if (path === "/origin") {
    const echo = {
      origin: request.headers.origin ?? null,
      secFetchSite: request.headers["sec-fetch-site"] ?? null,
      secFetchMode: request.headers["sec-fetch-mode"] ?? null,
    };
    originRequests.push(echo);
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(JSON.stringify(echo));
    return;
  }
  if (path === "/tracker.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end("window.trackerExecuted = true;");
    return;
  }
  if (path === "/allowed.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end("window.allowedExecuted = true;");
    return;
  }
  response.writeHead(404).end();
});

let child;
let memoryMonitor;
let output = "";
let peakTreeRssKb = 0;
let peakTreeProcessCount = 0;
try {
  await new Promise((resolveListen, reject) => {
    pageServer.once("error", reject);
    pageServer.listen(0, "127.0.0.1", resolveListen);
  });
  const port = pageServer.address().port;
  const url = `http://site.test:${port}/`;
  const originProbeUrl = `http://site.test:${port}/origin`;
  if (hasBrambleProbe) {
    const probePath = join(extensionPath, "cef-api-probe.js");
    const probeSource = readFileSync(probePath, "utf8");
    const originAssignment = /const originUrl = (__SURFFISH_CEF_ORIGIN_PROBE_URL__|"http:\/\/site\.test:\d+\/origin");/;
    if (!originAssignment.test(probeSource)) {
      throw new Error("Bramble test copy is missing the origin-probe placeholder/assignment.");
    }
    writeFileSync(
      probePath,
      probeSource.replace(
        originAssignment,
        `const originUrl = ${JSON.stringify(originProbeUrl)};`,
      ),
    );
  }
  const args = [
    "-a",
    electronBinary,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--host-resolver-rules=MAP site.test 127.0.0.1,MAP ${blockHost} 127.0.0.1,MAP allowed.test 127.0.0.1`,
    appDir,
  ];
  const binaryDir = dirname(electronBinary);
  child = spawn("xvfb-run", args, {
    cwd: binaryDir,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [binaryDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      SURFFISH_ELECTRON_POC_URL: url,
      SURFFISH_ELECTRON_POC_EXTENSION_PATH: extensionPath ?? "",
      SURFFISH_ELECTRON_POC_ENGINE_FILE: engineFile ?? "",
      SURFFISH_ELECTRON_POC_BLOCK_HOST: blockHost,
      SURFFISH_ELECTRON_POC_FILTER_ENV: JSON.stringify(FILTER_ENVIRONMENT),
      SURFFISH_ELECTRON_POC_USER_DATA: userDataDir,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk) => {
    output = (output + chunk.toString("utf8")).slice(-30_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const sampleProcessTree = () => {
    const snapshot = spawnSync("ps", ["-eo", "pid=,ppid=,rss="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (snapshot.status !== 0) return;
    const processes = snapshot.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter((row) => row.length === 3 && row.every(Number.isFinite))
      .map(([pid, ppid, rss]) => ({ pid, ppid, rss }));
    const tree = new Set([child.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const process of processes) {
        if (tree.has(process.ppid) && !tree.has(process.pid)) {
          tree.add(process.pid);
          changed = true;
        }
      }
    }
    const rows = processes.filter((process) => tree.has(process.pid));
    peakTreeRssKb = Math.max(
      peakTreeRssKb,
      rows.reduce((total, process) => total + process.rss, 0),
    );
    peakTreeProcessCount = Math.max(peakTreeProcessCount, rows.length);
  };
  memoryMonitor = setInterval(sampleProcessTree, 250);
  const result = await new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 60_000).unref();
  });
  clearInterval(memoryMonitor);
  sampleProcessTree();
  const title = output.match(/ELECTRON_POC_TITLE=(.*)/)?.[1] ?? "";
  const encodedProbe = title.match(/;bramble=([^;]+)/)?.[1] ?? "";
  let brambleProbe = "not-requested";
  try {
    brambleProbe = encodedProbe ? decodeURIComponent(encodedProbe) : "missing-title-data";
  } catch {
    brambleProbe = "invalid-probe-data";
  }
  let brambleApi = null;
  if (hasBrambleProbe && brambleProbe !== "missing") {
    try {
      brambleApi = JSON.parse(brambleProbe);
    } catch {}
  }
  const runtimeLine = output.match(/ELECTRON_POC_RUNTIME=(.*)/)?.[1];
  let runtime = null;
  try {
    runtime = runtimeLine ? JSON.parse(runtimeLine) : null;
  } catch {}
  const decisions = output
    .split("\n")
    .filter((line) => line.startsWith("ELECTRON_POC_DECISION="))
    .map((line) => JSON.parse(line.slice("ELECTRON_POC_DECISION=".length)));
  const pagePassed =
    title.includes("tracker=blocked;allowed=loaded;trackerExecuted=false;allowedExecuted=true") &&
    decisions.some((item) => item.url.includes(blockHost) && item.cancel) &&
    decisions.some((item) => item.url.includes("allowed.test") && !item.cancel);
  const bramblePassed = Boolean(
    brambleApi?.runtimeId &&
      brambleApi?.runtimeMessage &&
      brambleApi?.runtimeMessageSucceeded &&
      brambleApi?.originProbe?.ok &&
      brambleApi?.storageGet &&
      brambleApi?.background?.phase === "background-imported" &&
      brambleApi?.background?.runtimeMessage &&
      brambleApi?.background?.storage,
  );
  const passed = result.code === 0 && pagePassed && (!hasBrambleProbe || bramblePassed);
  console.log(JSON.stringify({
    process: result,
    electronVersion: runtime?.electron ?? null,
    filterMode,
    blockHost,
    passed,
    runtime,
    peakTreeRssMiB: Number((peakTreeRssKb / 1024).toFixed(1)),
    peakTreeProcessCount,
    title,
    bramblePassed: hasBrambleProbe ? bramblePassed : null,
    brambleProbe: hasBrambleProbe ? brambleApi ?? brambleProbe : "not-requested",
    originProbeUrl: hasBrambleProbe ? originProbeUrl : null,
    originRequests,
    extensionPath: extensionPath ?? null,
    engineFile: engineFile ?? null,
    decisions,
    output,
  }, null, 2));
  if (!passed) throw new Error("Electron/Ghostery/Bramble fixture smoke test failed.");
} finally {
  if (memoryMonitor) clearInterval(memoryMonitor);
  if (child && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  if (pageServer.listening) await new Promise((resolveClose) => pageServer.close(resolveClose));
  try {
    rmSync(appDir, { recursive: true, force: true });
  } catch {}
}
