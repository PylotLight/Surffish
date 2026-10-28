// Surffish footprint probe: per-process memory and idle CPU for one scenario, one cold launch.
//   bun run build && xvfb-run -a electron --no-sandbox scripts/perf/footprint.cjs   (Linux)
//   electron scripts/perf/footprint.cjs                                             (macOS)
//   FOOTPRINT_SCENARIO=blank|page|tabs10|mini  FOOTPRINT_IDLE_S=60  FOOTPRINT_OUT=out.json
//   PERF_ADBLOCK_ENGINE=<adblock-engine-v2.bin>  seed a real filter engine (else the app downloads the lists)
//   FOOTPRINT_USER_DATA=<dir>  keep the profile there (default: a temp dir, removed afterwards)
// Unlike the perf bench (sums over all processes), this lists every process of the app with its
// role, so "main process only" (what one Activity Monitor row shows) and "everything" can be told apart:
//   Linux: RSS, PSS (shared pages split fairly between processes; the honest total) and USS (private)
//          from /proc/<pid>/smaps_rollup, idle CPU from /proc/<pid>/stat over the idle window.
//   macOS: working set / private bytes from app.getAppMetrics(), idle CPU from cumulativeCPUUsage.
// Every process descended from the main process counts (zygotes included, which getAppMetrics()
// leaves out on Linux). The main process is also sampled after a forced full GC.
const T0 = Date.now() - process.uptime() * 1000;
const { createServer } = require("node:http");
const {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  existsSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, webContents } = require("electron");

const APP_DIR = resolve(process.env.FOOTPRINT_APP_DIR || process.cwd());
const SCENARIO = process.env.FOOTPRINT_SCENARIO || "blank";
const IDLE_S = Number(process.env.FOOTPRINT_IDLE_S || 60);
const SETTLE_S = Number(process.env.FOOTPRINT_SETTLE_S || 10);
const OUT = process.env.FOOTPRINT_OUT || "";
const KEEP_PROFILE = Boolean(process.env.FOOTPRINT_USER_DATA);
const userData =
  process.env.FOOTPRINT_USER_DATA ||
  join(tmpdir(), `surffish-footprint-${process.pid}`);
const isLinux = process.platform === "linux";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (t) =>
  process.stderr.write(
    `[footprint] ${((Date.now() - T0) / 1000).toFixed(1)}s ${t}\n`,
  );
const r1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "–");
// From launch to the end of the settle window: the main process's peak RSS (sampled every 100 ms) and
// its longest event-loop block (a 10 ms timer firing late), e.g. a filter-list compile on first run.
const trace = { peakRssMB: 0, maxBlockMs: 0, longTasks: 0, on: true };
(function tick() {
  const t = performance.now();
  setTimeout(() => {
    if (!trace.on) return;
    const lag = performance.now() - t - 10;
    if (lag > trace.maxBlockMs) trace.maxBlockMs = lag;
    if (lag > 50) trace.longTasks++;
    tick();
  }, 10);
})();
const rssTimer = setInterval(() => {
  trace.peakRssMB = Math.max(
    trace.peakRssMB,
    process.memoryUsage().rss / 1048576,
  );
}, 100);

const PAGE = (
  n,
) => `<!doctype html><meta charset="utf-8"><title>Page ${n}</title><style>body{font:16px system-ui;margin:40px}</style>
<h1>Simple page ${n}</h1>${"<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. </p>".repeat(30)}`;
const server = createServer((req, res) => {
  if (req.url === "/favicon.ico") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE(req.url));
});

async function waitFor(pred, what, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const v = await pred();
      if (v) return v;
    } catch {
      /* A transient predicate failure is retried on the next poll. */
    }
    await delay(20);
  }
  throw new Error(`timeout: ${what}`);
}
const surfaceOf = (c) => {
  try {
    return new URL(c.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};

// ---- /proc helpers (Linux) ----
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const kb = (text, key) =>
  Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(text)?.[1] || 0);
function procMem(pid) {
  const r = read(`/proc/${pid}/smaps_rollup`);
  return {
    rss: kb(r, "Rss"),
    pss: kb(r, "Pss"),
    uss: kb(r, "Private_Clean") + kb(r, "Private_Dirty"),
  };
}
function procTicks(pid) {
  const s = read(`/proc/${pid}/stat`);
  const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return Number(f[11] || 0) + Number(f[12] || 0); // utime + stime (fields 14, 15), in clock ticks (100 Hz)
}
function descendants(root) {
  const kids = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    const s = read(`/proc/${d}/stat`);
    if (!s) continue;
    const ppid = Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(Number(d));
  }
  const out = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    stack.push(...(kids.get(p) || []));
  }
  return out;
}
const cmdline = (pid) => read(`/proc/${pid}/cmdline`).split("\0");

// ---- roles: which process hosts what ----
function labelOf(c) {
  const url = c.getURL();
  const s = surfaceOf(c);
  if (s) return `ui:${s}`;
  if (url.startsWith("data:text/html"))
    return `ui:${(decodeURIComponent(url).match(/<title>([^<]*)/)?.[1] || "data").slice(0, 24)}`;
  if (url.startsWith("chrome-extension:")) return "extension";
  if (/^https?:/.test(url)) return "page";
  return url.split(":")[0] || "blank";
}
function roles() {
  const byPid = new Map();
  for (const c of webContents.getAllWebContents()) {
    if (c.isDestroyed()) continue;
    const pid = c.getOSProcessId();
    if (!byPid.has(pid)) byPid.set(pid, new Set());
    byPid.get(pid).add(labelOf(c));
  }
  const metrics = new Map(app.getAppMetrics().map((m) => [m.pid, m]));
  const pids = isLinux ? descendants(process.pid) : [...metrics.keys()];
  return pids.map((pid) => {
    const m = metrics.get(pid);
    let role =
      pid === process.pid
        ? "main"
        : m?.type === "GPU"
          ? "gpu"
          : m?.type === "Utility"
            ? `utility:${(m.serviceName || m.name || "").replace(/\.mojom\..*/, "").replace(/^.*\./, "")}`
            : m?.type
              ? m.type.toLowerCase()
              : "";
    if (!role) {
      const a = cmdline(pid);
      role =
        a.find((x) => x.startsWith("--type="))?.slice(7) ||
        (a[0] || "").split("/").pop();
    }
    const labels = byPid.get(pid);
    if (labels) role = `renderer[${[...labels].sort().join(",")}]`;
    return { pid, role, m };
  });
}
function snapshot() {
  return roles().map(({ pid, role, m }) => {
    if (isLinux) {
      const x = procMem(pid);
      return {
        pid,
        role,
        rssMB: x.rss / 1024,
        pssMB: x.pss / 1024,
        ussMB: x.uss / 1024,
      };
    }
    return {
      pid,
      role,
      rssMB: (m?.memory?.workingSetSize || 0) / 1024,
      pssMB: NaN,
      ussMB: (m?.memory?.privateBytes || 0) / 1024,
    };
  });
}
function cpuNow() {
  const r = new Map();
  if (isLinux)
    for (const pid of descendants(process.pid)) r.set(pid, procTicks(pid) * 10); // ms
  else
    for (const m of app.getAppMetrics())
      r.set(m.pid, (m.cpu.cumulativeCPUUsage || 0) * 1000);
  return r;
}

async function run() {
  app.setPath("userData", userData);
  if (!KEEP_PROFILE || !existsSync(userData)) {
    rmSync(userData, { recursive: true, force: true });
    mkdirSync(userData, { recursive: true, mode: 0o700 });
    // No photo-feed fetch; a seeded filter engine means no list download: the same offline state as the perf bench.
    const now = Date.now();
    writeFileSync(
      join(userData, "new-tab-photo-cache.json"),
      `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
    );
    if (
      process.env.PERF_ADBLOCK_ENGINE &&
      existsSync(process.env.PERF_ADBLOCK_ENGINE)
    )
      writeFileSync(
        join(userData, "adblock-engine-v2.bin"),
        readFileSync(process.env.PERF_ADBLOCK_ENGINE),
      );
  }
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await import(pathToFileURL(join(APP_DIR, "out/main/index.js")).href);
  await app.whenReady();
  const win = await waitFor(() => BaseWindow.getAllWindows()[0], "window");
  const toolbar = await waitFor(
    () =>
      win.contentView.children.find(
        (v) => surfaceOf(v.webContents) === "toolbar",
      ),
    "toolbar",
  );
  await waitFor(
    () =>
      toolbar.webContents.executeJavaScript(
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "toolbar api",
  );
  const readyMs = Date.now() - T0;
  const api = (e) => toolbar.webContents.executeJavaScript(e);
  const pages = () =>
    webContents
      .getAllWebContents()
      .filter(
        (c) => !c.isDestroyed() && /\/p\d+$/.test(c.getURL()) && !c.isLoading(),
      ).length;
  if (SCENARIO !== "blank") {
    await api(`window.api.browser.navigate(${JSON.stringify(`${origin}/p0`)})`);
    await waitFor(() => pages() >= 1, "p0");
  }
  if (SCENARIO === "tabs10") {
    for (let i = 1; i < 10; i++)
      await api(
        `window.api.browser.tabs.create(${JSON.stringify(`${origin}/p${i}`)})`,
      );
    await waitFor(() => pages() >= 10, "10 tabs");
    await delay(1500);
    // Sleep 4 of the 9 background tabs, like a session after the sleep timer has run.
    const tabs = (await api("window.api.browser.tabs.get()")).filter((t) =>
      /\/p[1-4]$/.test(t.url),
    );
    for (const t of tabs)
      await api(
        `window.api.browser.diagnostics.discardTab(${JSON.stringify(t.id)})`,
      );
    await waitFor(
      async () =>
        (await api("window.api.browser.tabs.get()")).filter((t) => t.sleeping)
          .length >= 4,
      "4 tabs asleep",
    );
  }
  if (SCENARIO === "mini") {
    await api('window.api.browser.commands.run("miniWindow.popOut")');
    await waitFor(() => BaseWindow.getAllWindows().length >= 2, "mini window");
  }
  log(`scenario ${SCENARIO} ready, settling ${SETTLE_S}s`);
  await delay(SETTLE_S * 1000);
  trace.on = false;
  clearInterval(rssTimer);
  log(
    `launch..settled: main peak rss ${r1(trace.peakRssMB)} MB, longest main block ${r1(trace.maxBlockMs)} ms, ${trace.longTasks} long tasks`,
  );
  const c0 = cpuNow();
  const t0 = Date.now();
  await delay(IDLE_S * 1000);
  const c1 = cpuNow();
  const wall = Date.now() - t0;
  const mu = process.memoryUsage();
  const heap = {
    heapUsedMB: mu.heapUsed / 1048576,
    heapTotalMB: mu.heapTotal / 1048576,
    externalMB: mu.external / 1048576,
  };
  const snap = snapshot();
  for (const p of snap)
    p.idleCpuPct =
      c1.has(p.pid) && c0.has(p.pid)
        ? (100 * (c1.get(p.pid) - c0.get(p.pid))) / wall
        : NaN;
  // Main process again after a forced full GC: what is live vs. merely not collected yet.
  require("node:v8").setFlagsFromString("--expose-gc");
  require("node:vm").runInNewContext("gc")();
  await delay(500);
  const afterGc = isLinux ? procMem(process.pid) : null;
  const mu2 = process.memoryUsage();
  const total = (k) =>
    snap.reduce((n, p) => n + (Number.isFinite(p[k]) ? p[k] : 0), 0);
  const main = snap.find((p) => p.role === "main");
  const result = {
    scenario: SCENARIO,
    platform: process.platform,
    electron: process.versions.electron,
    readyMs,
    idleSeconds: IDLE_S,
    launch: {
      mainPeakRssMB: trace.peakRssMB,
      mainMaxBlockMs: trace.maxBlockMs,
      mainLongTasks: trace.longTasks,
    },
    main: {
      rssMB: main.rssMB,
      pssMB: main.pssMB,
      ussMB: main.ussMB,
      idleCpuPct: main.idleCpuPct,
      ...heap,
      afterGc: {
        rssMB: afterGc ? afterGc.rss / 1024 : NaN,
        ussMB: afterGc ? afterGc.uss / 1024 : NaN,
        heapUsedMB: mu2.heapUsed / 1048576,
        externalMB: mu2.external / 1048576,
      },
    },
    total: {
      rssMB: total("rssMB"),
      pssMB: total("pssMB"),
      ussMB: total("ussMB"),
      idleCpuPct: total("idleCpuPct"),
      processes: snap.length,
    },
    processes: snap.sort((a, b) => (b.pssMB || b.rssMB) - (a.pssMB || a.rssMB)),
    webContents: webContents
      .getAllWebContents()
      .filter((c) => !c.isDestroyed())
      .map((c) => ({
        id: c.id,
        pid: c.getOSProcessId(),
        type: c.getType(),
        label: labelOf(c),
      })),
  };
  for (const p of result.processes)
    log(
      `${String(p.pid).padStart(7)} ${p.role.slice(0, 44).padEnd(44)} rss ${r1(p.rssMB).padStart(6)} pss ${r1(p.pssMB).padStart(6)} uss ${r1(p.ussMB).padStart(6)} cpu ${r1(p.idleCpuPct)}%`,
    );
  log(
    `MAIN rss ${r1(main.rssMB)} pss ${r1(main.pssMB)} uss ${r1(main.ussMB)} cpu ${r1(main.idleCpuPct)}% | TOTAL rss ${r1(result.total.rssMB)} pss ${r1(result.total.pssMB)} uss ${r1(result.total.ussMB)} cpu ${r1(result.total.idleCpuPct)}% (${snap.length} procs)`,
  );
  log(
    `MAIN heap ${r1(heap.heapUsedMB)}/${r1(heap.heapTotalMB)} external ${r1(heap.externalMB)} | after gc rss ${r1(result.main.afterGc.rssMB)} uss ${r1(result.main.afterGc.ussMB)} heap ${r1(result.main.afterGc.heapUsedMB)}`,
  );
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
}

run().then(
  () => {
    server.close();
    if (!KEEP_PROFILE) rmSync(userData, { recursive: true, force: true });
    app.exit(0);
  },
  (e) => {
    log(`FAILED ${e.stack || e}`);
    app.exit(1);
  },
);
