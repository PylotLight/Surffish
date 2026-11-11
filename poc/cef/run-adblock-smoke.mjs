import http from "node:http";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FiltersEngine } from "@ghostery/adblocker";
import { evaluateCefRequest } from "./ghostery-adapter.mjs";
import { createProcessTreeMetrics } from "./process-tree-metrics.mjs";
import { FILTER_ENVIRONMENT } from "../../src/main/adblock-policy.ts";

const binary = process.env.CEF_POC_BINARY
  ? resolve(process.env.CEF_POC_BINARY)
  : undefined;
if (!binary || !existsSync(binary)) {
  throw new Error(
    "Set CEF_POC_BINARY to the built cef-project minimal executable.",
  );
}
const extensionPath = process.env.CEF_POC_EXTENSION_PATH
  ? resolve(process.env.CEF_POC_EXTENSION_PATH)
  : undefined;
if (extensionPath && !existsSync(`${extensionPath}/manifest.json`)) {
  throw new Error(
    "CEF_POC_EXTENSION_PATH must contain the staged manifest.json.",
  );
}
const hasBrambleProbe = Boolean(
  extensionPath && existsSync(`${extensionPath}/cef-api-probe.js`),
);
const blockHost = process.env.CEF_POC_BLOCK_HOST ?? "tracker.test";
if (!/^[A-Za-z0-9.-]+$/.test(blockHost)) {
  throw new Error("CEF_POC_BLOCK_HOST must be a hostname.");
}
const benchmarkIdleMs = Number(process.env.SURFFISH_POC_BENCH_IDLE_MS ?? 0);
const benchmarkActiveMs = Number(process.env.SURFFISH_POC_BENCH_ACTIVE_MS ?? 0);
const benchmarkEnabled =
  Number.isSafeInteger(benchmarkIdleMs) &&
  benchmarkIdleMs > 0 &&
  Number.isSafeInteger(benchmarkActiveMs) &&
  benchmarkActiveMs > 0;
const engineFile = process.env.CEF_POC_ENGINE_FILE
  ? resolve(process.env.CEF_POC_ENGINE_FILE)
  : undefined;
const serializedEngine = engineFile ? readFileSync(engineFile) : undefined;
const engine = serializedEngine
  ? FiltersEngine.deserialize(serializedEngine)
  : FiltersEngine.parse(`||${blockHost}^$script`);
engine.updateEnv(new Map(FILTER_ENVIRONMENT));
const filterMode = engineFile ? "production-live-lists" : "synthetic-fixture";
const decisions = [];
const originRequests = [];
const benchmarkPhases = new Set([
  "ready",
  "idle-start",
  "idle-end",
  "active-start",
  "active-end",
]);
let processMetrics;
const socketPath = `/tmp/surffish-cef-filter-${process.pid}.sock`;
const cachePath = `/tmp/surffish-cef-profile-${process.pid}`;
if (existsSync(socketPath)) unlinkSync(socketPath);
mkdirSync(cachePath, { recursive: true });
const filterServer = net.createServer((connection) => {
  let input = "";
  connection.on("data", (chunk) => {
    input += chunk.toString("utf8");
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    const [url = "", frameUrl = "", resourceType = "other", requestId = ""] =
      input.slice(0, newline).split("\t");
    const decision = evaluateCefRequest(engine, {
      url,
      frameUrl,
      resourceType,
      requestId,
    });
    decisions.push({ url, resourceType, action: decision.action });
    const response = `${decision.action.toUpperCase()}${decision.url ? `\t${decision.url}` : ""}\n`;
    connection.end(response);
  });
});

const pageServer = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const path = requestUrl.pathname;
  if (path === "/__bench-phase" && benchmarkEnabled) {
    const phase = requestUrl.searchParams.get("name");
    if (!phase || !benchmarkPhases.has(phase) || !processMetrics) {
      response.writeHead(400).end();
      return;
    }
    processMetrics.mark(phase);
    response.writeHead(204, { "cache-control": "no-store" }).end();
    return;
  }
  if (path === "/") {
    const port = pageServer.address().port;
    const benchmarkScript = benchmarkEnabled
      ? `const runBenchmarkStates = async () => {
  const mark = async (name) => {
    try { await fetch('/__bench-phase?name=' + encodeURIComponent(name), { cache: 'no-store' }); } catch {}
  };
  await mark('ready');
  await mark('idle-start');
  await new Promise((resolve) => setTimeout(resolve, ${benchmarkIdleMs}));
  await mark('idle-end');
  await mark('active-start');
  const deadline = performance.now() + ${benchmarkActiveMs};
  let iterations = 0;
  let checksum = 0;
  while (performance.now() < deadline) {
    for (let i = 0; i < 4096; i += 1) {
      checksum += Math.sin((i + iterations) % 10000) * Math.cos((i + 3) % 10000);
    }
    iterations += 4096;
  }
  await mark('active-end');
  return iterations + ':' + checksum.toFixed(2);
};`
      : `const runBenchmarkStates = async () => null;`;
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
${benchmarkScript}
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
]).then(async ([tracker, allowed, bramble]) => {
  const benchmarkResult = await runBenchmarkStates();
  const benchmarkSuffix = benchmarkResult === null ? '' : ';bench=' + encodeURIComponent(benchmarkResult);
  document.title = 'CEF_POC_RESULT:tracker=' + tracker + ';allowed=' + allowed +
    ';trackerExecuted=' + (window.trackerExecuted === true) +
    ';allowedExecuted=' + (window.allowedExecuted === true) +
    benchmarkSuffix + ';bramble=' + encodeURIComponent(bramble);
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

await new Promise((resolveListen, reject) => {
  filterServer.once("error", reject);
  filterServer.listen(socketPath, resolveListen);
});
await new Promise((resolveListen, reject) => {
  pageServer.once("error", reject);
  pageServer.listen(0, "127.0.0.1", resolveListen);
});

const port = pageServer.address().port;
const originProbeUrl = `http://site.test:${port}/origin`;
if (hasBrambleProbe) {
  const probePath = `${extensionPath}/cef-api-probe.js`;
  const probeSource = readFileSync(probePath, "utf8");
  const originAssignment =
    /const originUrl = (__SURFFISH_CEF_ORIGIN_PROBE_URL__|"http:\/\/site\.test:\d+\/origin");/;
  if (!originAssignment.test(probeSource)) {
    throw new Error(
      "Bramble test copy is missing the origin-probe placeholder/assignment.",
    );
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
  binary,
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--use-views",
  "--lang=en-US",
  `--url=http://site.test:${port}/`,
  `--host-resolver-rules=MAP site.test 127.0.0.1,MAP ${blockHost} 127.0.0.1,MAP allowed.test 127.0.0.1`,
];
if (extensionPath) args.push(`--load-extension=${extensionPath}`);
const binaryDir = dirname(binary);
const startedAtNs = process.hrtime.bigint();
const child = spawn("xvfb-run", args, {
  cwd: binaryDir,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: [binaryDir, process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":"),
    SURFFISH_CEF_ADBLOCK_SOCKET: socketPath,
    SURFFISH_CEF_POC_CACHE_PATH: cachePath,
  },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
if (benchmarkEnabled) {
  processMetrics = createProcessTreeMetrics(process.pid, {
    startedAtNs,
    intervalMs: 125,
    pssIntervalMs: Number(process.env.SURFFISH_POC_PSS_INTERVAL_MS ?? 500),
  });
}
let output = "";
const collect = (chunk) => {
  output = (output + chunk.toString("utf8")).slice(-30_000);
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);
let peakTreeRssKb = 0;
let peakTreeProcessCount = 0;
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
const memoryMonitor = setInterval(sampleProcessTree, 250);
const exited = new Promise((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit({ code, signal }));
});
const timeout = setTimeout(() => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
}, 60_000);
const result = await exited;
clearTimeout(timeout);
clearInterval(memoryMonitor);
sampleProcessTree();
const benchmarkMetrics = processMetrics?.finish() ?? null;
await delay(250);
await new Promise((resolveClose) => pageServer.close(resolveClose));
await new Promise((resolveClose) => filterServer.close(resolveClose));
try {
  unlinkSync(socketPath);
} catch {}
rmSync(cachePath, { recursive: true, force: true });

const title = output.match(/CEF_POC_TITLE=(.*)/)?.[1] ?? "";
const encodedProbe = title.match(/;bramble=([^;]+)/)?.[1] ?? "";
let brambleProbe = "not-requested";
try {
  brambleProbe = encodedProbe
    ? decodeURIComponent(encodedProbe)
    : "missing-title-data";
} catch {
  brambleProbe = "invalid-probe-data";
}
const blockedTracker = decisions.some(
  (item) => item.url.includes(blockHost) && item.action === "block",
);
const allowedRequest = decisions.some(
  (item) => item.url.includes("allowed.test") && item.action === "allow",
);
let brambleApi = null;
if (hasBrambleProbe && brambleProbe !== "missing") {
  try {
    brambleApi = JSON.parse(brambleProbe);
  } catch {}
}
const unattributedRequests = output
  .split("\n")
  .filter((line) => line.startsWith("POC_CEF_UNATTRIBUTED\t"))
  .map((line) => {
    const [, resourceType = "", url = "", frameUrl = ""] = line.split("\t");
    return { resourceType, url, frameUrl };
  });
const extensionWorkerFetchReachedEcho = originRequests.length > 0;
const extensionWorkerRequestSeenByCefHandler = unattributedRequests.some(
  (item) => item.url.includes("/origin"),
);
const pagePassed =
  title.includes(
    "tracker=blocked;allowed=loaded;trackerExecuted=false;allowedExecuted=true",
  ) &&
  blockedTracker &&
  allowedRequest;
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
console.log(
  JSON.stringify(
    {
      process: result,
      filterMode,
      blockHost,
      serializedEngineBytes: serializedEngine?.byteLength ?? null,
      peakTreeRssMiB: Number((peakTreeRssKb / 1024).toFixed(1)),
      filterBrokerRssMiB: Number(
        (process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
      ),
      peakTreeProcessCount,
      benchmark: benchmarkEnabled
        ? {
            idleMs: benchmarkIdleMs,
            activeMs: benchmarkActiveMs,
            metrics: benchmarkMetrics,
          }
        : null,
      pagePassed,
      bramblePassed: hasBrambleProbe ? bramblePassed : null,
      title,
      brambleProbe: hasBrambleProbe
        ? (brambleApi ?? brambleProbe)
        : "not-requested",
      originProbeUrl: hasBrambleProbe ? originProbeUrl : null,
      originRequests,
      extensionWorkerFetchReachedEcho,
      extensionWorkerRequestSeenByCefHandler,
      unattributedRequests,
      extensionPath: extensionPath ?? null,
      decisions,
      output,
    },
    null,
    2,
  ),
);
if (result.code !== 0 || !pagePassed || (hasBrambleProbe && !bramblePassed)) {
  throw new Error("CEF/Ghostery/Bramble smoke-test assertions failed.");
}
