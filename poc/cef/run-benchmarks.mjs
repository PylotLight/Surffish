import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  availableParallelism,
  cpus,
  platform,
  release,
  totalmem,
} from "node:os";

const repoRoot = resolve(import.meta.dir, "../..");
const repeats = Number(process.env.SURFFISH_POC_BENCH_REPEATS ?? 4);
const idleMs = Number(process.env.SURFFISH_POC_BENCH_IDLE_MS ?? 3000);
const activeMs = Number(process.env.SURFFISH_POC_BENCH_ACTIVE_MS ?? 3000);
const bunExecutable = process.env.BUN_EXECUTABLE ?? "bun";
const outputPath = resolve(
  process.env.SURFFISH_POC_BENCH_OUTPUT ??
    resolve(import.meta.dir, "benchmark-results.json"),
);

if (!Number.isSafeInteger(repeats) || repeats < 2 || repeats > 20) {
  throw new Error(
    "SURFFISH_POC_BENCH_REPEATS must be an integer from 2 through 20.",
  );
}
for (const [name, value] of [
  ["idle", idleMs],
  ["active", activeMs],
]) {
  if (!Number.isSafeInteger(value) || value < 500 || value > 30_000) {
    throw new Error(`The ${name} benchmark duration must be 500–30000 ms.`);
  }
}

const required = [
  "CEF_POC_BINARY",
  "CEF_POC_ENGINE_FILE",
  "CEF_POC_EXTENSION_PATH",
  "ELECTRON_POC_BINARY",
  "ELECTRON_POC_ENGINE_FILE",
  "ELECTRON_POC_EXTENSION_PATH",
];
for (const key of required) {
  if (!process.env[key] || !existsSync(process.env[key])) {
    throw new Error(`Set ${key} to an existing POC input before benchmarking.`);
  }
}
const cefEngine = realpathSync(process.env.CEF_POC_ENGINE_FILE);
const electronEngine = realpathSync(process.env.ELECTRON_POC_ENGINE_FILE);
const cefExtension = realpathSync(process.env.CEF_POC_EXTENSION_PATH);
const electronExtension = realpathSync(process.env.ELECTRON_POC_EXTENSION_PATH);
const engineBytes = readFileSync(cefEngine);
const engineSha256 = createHash("sha256").update(engineBytes).digest("hex");
const electronEngineBytes = readFileSync(electronEngine);
const electronEngineSha256 = createHash("sha256")
  .update(electronEngineBytes)
  .digest("hex");
function directorySha256(directory) {
  const listing = Bun.spawnSync(
    ["find", directory, "-type", "f", "-printf", "%P\\0"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (listing.exitCode !== 0) {
    throw new Error(`Could not list extension files under ${directory}.`);
  }
  const paths = listing.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const relativePath of paths) {
    const bytes = readFileSync(resolve(directory, relativePath));
    hash.update(relativePath);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), files: paths.length };
}
const cefExtensionDigest = directorySha256(cefExtension);
const electronExtensionDigest = directorySha256(electronExtension);
if (
  engineSha256 !== electronEngineSha256 ||
  cefExtensionDigest.sha256 !== electronExtensionDigest.sha256
) {
  throw new Error(
    "CEF and Electron must use byte-identical filter engines and extension trees.",
  );
}
const blockHost = process.env.CEF_POC_BLOCK_HOST ?? "doubleclick.net";
if (blockHost !== (process.env.ELECTRON_POC_BLOCK_HOST ?? "doubleclick.net")) {
  throw new Error("CEF and Electron must use the same filter fixture host.");
}

function parseResult(stdout, stderr, label) {
  const trimmed = stdout.trim();
  const candidates = [trimmed.lastIndexOf("\n{"), trimmed.indexOf("{")]
    .filter((index) => index >= 0)
    .map((index) => trimmed.slice(index + (trimmed[index] === "\n" ? 1 : 0)));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error(
    `${label} did not emit a JSON result. stdout=${trimmed.slice(-4000)} stderr=${stderr.slice(-4000)}`,
  );
}

function runOne(browser, trial) {
  const runner =
    browser === "cef" ? "run-adblock-smoke.mjs" : "run-electron-smoke.mjs";
  const env = {
    ...process.env,
    SURFFISH_POC_BENCH_IDLE_MS: String(idleMs),
    SURFFISH_POC_BENCH_ACTIVE_MS: String(activeMs),
    CEF_POC_BLOCK_HOST: blockHost,
    ELECTRON_POC_BLOCK_HOST: blockHost,
  };
  if (browser === "cef") {
    env.CEF_POC_ENGINE_FILE = cefEngine;
    env.CEF_POC_EXTENSION_PATH = cefExtension;
  } else {
    env.ELECTRON_POC_ENGINE_FILE = electronEngine;
    env.ELECTRON_POC_EXTENSION_PATH = electronExtension;
    env.ELECTRON_POC_TMPDIR = process.env.ELECTRON_POC_TMPDIR ?? "/dev/shm";
  }

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(bunExecutable, [resolve(import.meta.dir, runner)], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-200_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-40_000);
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        rejectRun(
          new Error(
            `${browser} trial ${trial} failed (code ${code}, signal ${signal}). ${stderr.slice(-5000)} ${stdout.slice(-2000)}`,
          ),
        );
        return;
      }
      try {
        const result = parseResult(stdout, stderr, `${browser} trial ${trial}`);
        const passed =
          browser === "cef"
            ? result.process?.code === 0 &&
              result.pagePassed &&
              result.bramblePassed
            : result.process?.code === 0 && result.passed;
        if (!passed) throw new Error("fixture assertions did not all pass");
        resolveRun({ browser, trial, result });
      } catch (error) {
        rejectRun(
          new Error(
            `${browser} trial ${trial}: ${error.message}\n${stderr.slice(-5000)}`,
          ),
        );
      }
    });
  });
}

function directoryBytes(path, { apparent = false } = {}) {
  if (!path || !existsSync(path)) return null;
  const args = apparent
    ? ["du", "--apparent-size", "-s", "-B1", path]
    : ["du", "-s", "-B1", path];
  const child = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (child.exitCode !== 0) return null;
  const match = /^([0-9]+)/.exec(child.stdout.toString());
  return match ? Number(match[1]) : null;
}

function values(rows, getter) {
  return rows.map(getter).filter((value) => Number.isFinite(value));
}

function summarize(rows, getter) {
  const items = values(rows, getter).sort((a, b) => a - b);
  if (items.length === 0) return null;
  const mid = Math.floor(items.length / 2);
  const median =
    items.length % 2 ? items[mid] : (items[mid - 1] + items[mid]) / 2;
  return {
    min: Math.round(items[0] * 10) / 10,
    median: Math.round(median * 10) / 10,
    max: Math.round(items.at(-1) * 10) / 10,
  };
}

const results = [];
for (let trial = 1; trial <= repeats; trial += 1) {
  const order = trial % 2 ? ["cef", "electron"] : ["electron", "cef"];
  for (const browser of order) {
    console.error(`POC benchmark trial ${trial}/${repeats}: ${browser}`);
    const result = await runOne(browser, trial);
    results.push(result);
  }
}

const byBrowser = Object.fromEntries(
  ["cef", "electron"].map((browser) => {
    const rows = results.filter((entry) => entry.browser === browser);
    const metrics = rows
      .map((entry) => entry.result.benchmark?.metrics)
      .filter(Boolean);
    return [
      browser,
      {
        runs: rows.length,
        coldStartupMs: summarize(metrics, (metric) => metric.coldStartupMs),
        idleCpuMs: summarize(metrics, (metric) => metric.idle?.cpuMs),
        idleCpuPercentOfOneCore: summarize(
          metrics,
          (metric) => metric.idle?.cpuPercentOfOneCore,
        ),
        idleMeanRssMiB: summarize(metrics, (metric) => metric.idle?.meanRssMiB),
        idleMeanPssMiB: summarize(metrics, (metric) => metric.idle?.meanPssMiB),
        idlePeakPssMiB: summarize(metrics, (metric) => metric.idle?.peakPssMiB),
        idlePeakRssMiB: summarize(metrics, (metric) => metric.idle?.peakRssMiB),
        activeCpuMs: summarize(metrics, (metric) => metric.active?.cpuMs),
        activeCpuPercentOfOneCore: summarize(
          metrics,
          (metric) => metric.active?.cpuPercentOfOneCore,
        ),
        activeMeanRssMiB: summarize(
          metrics,
          (metric) => metric.active?.meanRssMiB,
        ),
        activeMeanPssMiB: summarize(
          metrics,
          (metric) => metric.active?.meanPssMiB,
        ),
        activePeakPssMiB: summarize(
          metrics,
          (metric) => metric.active?.peakPssMiB,
        ),
        activePeakRssMiB: summarize(
          metrics,
          (metric) => metric.active?.peakRssMiB,
        ),
        peakProcessTreeRssMiB: summarize(
          metrics,
          (metric) => metric.peakProcessTreeRssMiB,
        ),
        peakProcessTreePssMiB: summarize(
          metrics,
          (metric) => metric.peakProcessTreePssMiB,
        ),
        sharedCgroupPeakObservedMiB: summarize(
          metrics,
          (metric) => metric.sharedCgroupMemory?.peakObservedCurrentMiB,
        ),
      },
    ];
  }),
);

const cefRuntimeDir = process.env.CEF_POC_RUNTIME_DIR;
const electronRuntimeDir = dirname(
  realpathSync(process.env.ELECTRON_POC_BINARY),
);
const report = {
  generatedAt: new Date().toISOString(),
  host: {
    platform: `${platform()} ${release()}`,
    architecture: process.arch,
    logicalCpus: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? null,
    memoryBytes: totalmem(),
    xvfb: true,
    sandbox: "--no-sandbox (isolated Linux POC only)",
  },
  runtimes: {
    cef: {
      version: process.env.SURFFISH_POC_CEF_VERSION ?? null,
      chromium: process.env.SURFFISH_POC_CEF_CHROMIUM ?? null,
      runtimeDirectory: cefRuntimeDir ?? null,
      runtimeDirectoryAllocatedBytes: directoryBytes(cefRuntimeDir),
      runtimeDirectoryApparentBytes: directoryBytes(cefRuntimeDir, {
        apparent: true,
      }),
      officialArchiveBytes:
        Number(process.env.CEF_POC_ARCHIVE_BYTES ?? 0) || null,
      officialArchiveSha1: process.env.CEF_POC_ARCHIVE_SHA1 ?? null,
    },
    electron: {
      version: "46.0.0-alpha.8",
      chromium: "159.0.8140.0",
      runtimeDirectory: electronRuntimeDir,
      runtimeDirectoryAllocatedBytes: directoryBytes(electronRuntimeDir),
      runtimeDirectoryApparentBytes: directoryBytes(electronRuntimeDir, {
        apparent: true,
      }),
      officialArchiveBytes:
        Number(process.env.ELECTRON_POC_ARCHIVE_BYTES ?? 0) || null,
      officialArchiveSha256: process.env.ELECTRON_POC_ARCHIVE_SHA256 ?? null,
    },
  },
  workload: {
    repetitions: repeats,
    order: "alternating CEF-first and Electron-first by trial",
    idleMs,
    activeMs,
    activeWork: "renderer JavaScript trigonometric busy-loop",
    pageFixture:
      "same localhost page; block doubleclick.net script; allow control script; await Bramble worker messaging/storage/API probe",
    filterEngine: {
      source:
        "same previously compiled Surffish production-selected 10-list Ghostery engine",
      bytes: engineBytes.byteLength,
      sha256: engineSha256,
      filterHost: blockHost,
    },
    extensions: {
      cefDirectory: cefExtension,
      electronDirectory: electronExtension,
      sha256: cefExtensionDigest.sha256,
      files: cefExtensionDigest.files,
    },
    measurement: `fresh browser process/profile per run; process-tree RSS and /proc CPU ticks sampled at 125 ms; PSS from /proc/<pid>/smaps_rollup sampled every ${process.env.SURFFISH_POC_PSS_INTERVAL_MS ?? 500} ms (0 disables PSS); shared sandbox service cgroup memory.current also sampled but is not attributable to this process tree; runtime directories measured for allocated and apparent bytes on /dev/shm tmpfs; 8 visible logical CPUs; host OS filesystem cache not flushed`,
  },
  summary: byBrowser,
  runs: results,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      summary: byBrowser,
      host: report.host,
      runtimes: report.runtimes,
      filterEngine: report.workload.filterEngine,
    },
    null,
    2,
  ),
);
