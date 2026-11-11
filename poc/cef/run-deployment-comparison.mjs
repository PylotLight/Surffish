import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  readSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  availableParallelism,
  cpus,
  platform,
  release,
  totalmem,
} from "node:os";

const repoRoot = resolve(import.meta.dir, "../..");
const pocDir = import.meta.dir;
const previousResults = JSON.parse(
  readFileSync(join(pocDir, "benchmark-results.json"), "utf8"),
);
const cefRuntimeSource = resolve(
  process.env.CEF_POC_RUNTIME_DIR ?? "/dev/shm/surffish-cef156-build/Release",
);
const cefBinarySource = resolve(
  process.env.CEF_POC_BINARY ?? join(cefRuntimeSource, "minimal"),
);
const electronBinarySource = resolve(
  process.env.ELECTRON_POC_BINARY ??
    "/dev/shm/surffish-electron46-alpha8/node_modules/electron/dist/electron",
);
const electronRuntimeSource = dirname(electronBinarySource);
const engineSource = resolve(
  process.env.CEF_POC_ENGINE_FILE ??
    "/dev/shm/surffish-cef-poc/all10-engine.bin",
);
const extensionSource = resolve(
  process.env.CEF_POC_EXTENSION_PATH ??
    "/dev/shm/surffish-cef-poc/bramble-probe",
);
const tempParent = resolve(process.env.SURFFISH_POC_DEPLOY_TMP ?? "/dev/shm");
const outputPath = resolve(
  process.env.SURFFISH_POC_DEPLOY_OUTPUT ??
    join(pocDir, "deployment-comparison.json"),
);
const repeats = process.env.SURFFISH_POC_BENCH_REPEATS ?? "4";
const idleMs = process.env.SURFFISH_POC_BENCH_IDLE_MS ?? "3000";
const activeMs = process.env.SURFFISH_POC_BENCH_ACTIVE_MS ?? "3000";
const keepWork = process.env.SURFFISH_POC_DEPLOY_KEEP === "1";

for (const [label, path] of [
  ["CEF runtime", cefRuntimeSource],
  ["CEF binary", cefBinarySource],
  ["Electron binary", electronBinarySource],
  ["filter engine", engineSource],
  ["Bramble probe", extensionSource],
]) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}
if (!existsSync(join(extensionSource, "manifest.json"))) {
  throw new Error("The Bramble probe directory is missing manifest.json.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function sha256File(path) {
  return run("sha256sum", [path]).stdout.trim().split(/\s+/)[0];
}

const expectedEngine = previousResults.workload.filterEngine;
if (
  statSync(engineSource).size !== expectedEngine.bytes ||
  sha256File(engineSource) !== expectedEngine.sha256
) {
  throw new Error(
    `Filter engine must match the recorded ten-list asset (${expectedEngine.bytes} bytes, ${expectedEngine.sha256}).`,
  );
}

function listFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(directory);
  return files.sort();
}

function fileTreeSha256(directory) {
  const hash = createHash("sha256");
  const paths = listFiles(directory).map((path) => relative(directory, path));
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(directory, path)));
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), files: paths.length };
}

function treeStats(directory) {
  let apparentBytes = 0;
  let allocatedBytes = 0;
  for (const path of listFiles(directory)) {
    const stat = statSync(path);
    apparentBytes += stat.size;
    allocatedBytes += stat.blocks * 512;
  }
  return {
    apparentBytes,
    allocatedBytes,
    files: listFiles(directory).length,
  };
}

function debugSections(path) {
  const header = openSync(path, "r");
  const magic = Buffer.alloc(4);
  try {
    if (
      readSync(header, magic, 0, 4, 0) !== 4 ||
      magic.toString("hex") !== "7f454c46"
    ) {
      return 0;
    }
  } finally {
    closeSync(header);
  }
  const result = run("readelf", ["-SW", path]);
  let total = 0;
  for (const line of result.stdout.split("\n")) {
    if (!/\]\s+\.debug_/.test(line)) continue;
    const fields = line.trim().split(/\s+/);
    const sizeHex = fields[5];
    if (/^[0-9a-f]+$/i.test(sizeHex ?? ""))
      total += Number.parseInt(sizeHex, 16);
  }
  return total;
}

function debugElfInventory(directory) {
  return listFiles(directory)
    .map((path) => ({ path, bytes: debugSections(path) }))
    .filter((item) => item.bytes > 0)
    .map((item) => ({
      path: relative(directory, item.path),
      debugSectionBytes: item.bytes,
      fileBytes: statSync(item.path).size,
    }));
}

function stageRuntime(source, destination) {
  mkdirSync(destination, { recursive: true });
  run("cp", ["-al", `${source}/.`, destination]);
  const localesDir = join(destination, "locales");
  if (existsSync(localesDir)) {
    for (const name of readdirSync(localesDir)) {
      if (name !== "en-US.pak")
        rmSync(join(localesDir, name), { recursive: true, force: true });
    }
  }
  const originalSourceFiles = debugElfInventory(source);
  const stripped = [];
  for (const item of originalSourceFiles) {
    const sourceFile = join(source, item.path);
    const stagedFile = join(destination, item.path);
    const sourceStat = statSync(sourceFile);
    const sourceHash = sha256File(sourceFile);
    const independentCopy = `${stagedFile}.copy-${process.pid}`;
    copyFileSync(sourceFile, independentCopy);
    renameSync(independentCopy, stagedFile);
    run("strip", ["--strip-debug", stagedFile]);
    const remainingDebugBytes = debugSections(stagedFile);
    const afterSource = statSync(sourceFile);
    if (
      afterSource.ino !== sourceStat.ino ||
      afterSource.size !== sourceStat.size ||
      sha256File(sourceFile) !== sourceHash
    ) {
      throw new Error(`Source runtime changed while staging ${item.path}.`);
    }
    stripped.push({
      path: item.path,
      debugBytesBefore: item.debugSectionBytes,
      debugBytesAfter: remainingDebugBytes,
      fileBytesBefore: sourceStat.size,
      fileBytesAfter: statSync(stagedFile).size,
    });
  }
  const remainingLocales = existsSync(localesDir)
    ? readdirSync(localesDir).filter((name) => name.endsWith(".pak"))
    : [];
  if (remainingLocales.length !== 1 || remainingLocales[0] !== "en-US.pak") {
    throw new Error(
      `Unexpected staged locale set: ${remainingLocales.join(", ")}`,
    );
  }
  return {
    source: source,
    original: treeStats(source),
    sourceDebugElfs: originalSourceFiles,
    stripped,
    staged: treeStats(destination),
    stagedDebugElfs: debugElfInventory(destination),
    locales: remainingLocales,
    directory: destination,
  };
}

function packageRuntime(
  packageRoot,
  packageName,
  version,
  description,
  output,
) {
  const debianDir = join(packageRoot, "DEBIAN");
  mkdirSync(debianDir, { recursive: true });
  writeFileSync(
    join(debianDir, "control"),
    `Package: ${packageName}\nVersion: ${version}\nArchitecture: amd64\nMaintainer: Surffish POC\nDescription: ${description}\n`,
  );
  run("dpkg-deb", [
    "--build",
    "--root-owner-group",
    "--uniform-compression",
    "-Zxz",
    "-z6",
    packageRoot,
    output,
  ]);
  return {
    path: output,
    bytes: statSync(output).size,
    control: readFileSync(join(debianDir, "control"), "utf8"),
    compression: "dpkg-deb xz level 6, uniform control/data compression",
  };
}

function formatMiB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

const workRoot = mkdtempSync(
  join(tempParent, "surffish-deployment-comparison-"),
);
try {
  const cefPackageRoot = join(workRoot, "cef-package");
  const electronPackageRoot = join(workRoot, "electron-package");
  const cefRuntime = join(cefPackageRoot, "opt/surffish-poc/runtime");
  const electronRuntime = join(electronPackageRoot, "opt/surffish-poc/runtime");
  const cefAssets = join(cefPackageRoot, "opt/surffish-poc/assets");
  const electronAssets = join(electronPackageRoot, "opt/surffish-poc/assets");
  for (const path of [
    cefPackageRoot,
    electronPackageRoot,
    cefAssets,
    electronAssets,
  ]) {
    mkdirSync(path, { recursive: true });
  }

  const cefStage = stageRuntime(cefRuntimeSource, cefRuntime);
  const electronStage = stageRuntime(electronRuntimeSource, electronRuntime);
  for (const assetsDir of [cefAssets, electronAssets]) {
    copyFileSync(engineSource, join(assetsDir, "ghostery-engine.bin"));
    const destination = join(assetsDir, "bramble-probe");
    mkdirSync(destination, { recursive: true });
    run("cp", ["-a", `${extensionSource}/.`, destination]);
  }

  const cefEngine = join(cefAssets, "ghostery-engine.bin");
  const electronEngine = join(electronAssets, "ghostery-engine.bin");
  const cefExtension = join(cefAssets, "bramble-probe");
  const electronExtension = join(electronAssets, "bramble-probe");
  const cefAssetHashes = {
    engine: createHash("sha256").update(readFileSync(cefEngine)).digest("hex"),
    extension: fileTreeSha256(cefExtension),
  };
  const electronAssetHashes = {
    engine: createHash("sha256")
      .update(readFileSync(electronEngine))
      .digest("hex"),
    extension: fileTreeSha256(electronExtension),
  };
  if (
    cefAssetHashes.engine !== electronAssetHashes.engine ||
    cefAssetHashes.extension.sha256 !== electronAssetHashes.extension.sha256
  ) {
    throw new Error("The packaged workload assets are not byte-identical.");
  }

  const packageContext = "same Surffish POC runtime and workload assets";
  const cefPackage = packageRuntime(
    cefPackageRoot,
    "surffish-cef-runtime-poc",
    "156.0.27-1",
    packageContext,
    join(workRoot, "surffish-cef-runtime-poc.deb"),
  );
  const electronPackage = packageRuntime(
    electronPackageRoot,
    "surffish-electron-runtime-poc",
    "46.0.0~alpha.8-1",
    packageContext,
    join(workRoot, "surffish-electron-runtime-poc.deb"),
  );

  const pssBenchmarkPath = join(workRoot, "pss-benchmark-results.json");
  const cpuBenchmarkPath = join(workRoot, "cpu-benchmark-results.json");
  const commonEnv = {
    ...process.env,
    CEF_POC_BINARY: join(
      cefRuntime,
      relative(cefRuntimeSource, cefBinarySource),
    ),
    CEF_POC_RUNTIME_DIR: cefRuntime,
    CEF_POC_ENGINE_FILE: cefEngine,
    CEF_POC_EXTENSION_PATH: cefExtension,
    ELECTRON_POC_BINARY: join(
      electronRuntime,
      relative(electronRuntimeSource, electronBinarySource),
    ),
    ELECTRON_POC_ENGINE_FILE: electronEngine,
    ELECTRON_POC_EXTENSION_PATH: electronExtension,
    CEF_POC_ARCHIVE_BYTES: String(
      previousResults.runtimes.cef.officialArchiveBytes ?? "",
    ),
    CEF_POC_ARCHIVE_SHA1:
      previousResults.runtimes.cef.officialArchiveSha1 ?? "",
    ELECTRON_POC_ARCHIVE_BYTES: String(
      previousResults.runtimes.electron.officialArchiveBytes ?? "",
    ),
    ELECTRON_POC_ARCHIVE_SHA256:
      previousResults.runtimes.electron.officialArchiveSha256 ?? "",
    SURFFISH_POC_CEF_VERSION: previousResults.runtimes.cef.version ?? "",
    SURFFISH_POC_CEF_CHROMIUM: previousResults.runtimes.cef.chromium ?? "",
    SURFFISH_POC_BENCH_REPEATS: repeats,
    SURFFISH_POC_BENCH_IDLE_MS: idleMs,
    SURFFISH_POC_BENCH_ACTIVE_MS: activeMs,
  };
  const benchmarkRunner = join(pocDir, "run-benchmarks.mjs");
  run("bun", [benchmarkRunner], {
    env: {
      ...commonEnv,
      SURFFISH_POC_PSS_INTERVAL_MS:
        process.env.SURFFISH_POC_PSS_INTERVAL_MS ?? "500",
      SURFFISH_POC_BENCH_OUTPUT: pssBenchmarkPath,
    },
    stdio: "inherit",
  });
  const memoryBenchmark = JSON.parse(readFileSync(pssBenchmarkPath, "utf8"));
  const probeSource = join(extensionSource, "cef-api-probe.js");
  copyFileSync(probeSource, join(cefExtension, "cef-api-probe.js"));
  copyFileSync(probeSource, join(electronExtension, "cef-api-probe.js"));
  if (
    fileTreeSha256(cefExtension).sha256 !==
    fileTreeSha256(electronExtension).sha256
  ) {
    throw new Error("The staged Bramble probe copies diverged after reset.");
  }
  run("bun", [benchmarkRunner], {
    env: {
      ...commonEnv,
      SURFFISH_POC_PSS_INTERVAL_MS: "0",
      SURFFISH_POC_BENCH_OUTPUT: cpuBenchmarkPath,
    },
    stdio: "inherit",
  });
  const cpuBenchmark = JSON.parse(readFileSync(cpuBenchmarkPath, "utf8"));
  const report = {
    generatedAt: new Date().toISOString(),
    git: {
      branch: run("git", ["branch", "--show-current"]).stdout.trim(),
      commit: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
      workingTreeDirtyAtCapture: Boolean(
        run("git", ["status", "--porcelain"]).stdout.trim(),
      ),
    },
    host: {
      platform: `${platform()} ${release()}`,
      architecture: process.arch,
      logicalCpus: availableParallelism(),
      cpuModel: cpus()[0]?.model ?? null,
      memoryBytes: totalmem(),
      packageFormat: "Debian binary package, amd64",
    },
    method: {
      scope:
        "runtime-only POC packages, not production Surffish application installers",
      description:
        "Both runtime trees were staged independently from the existing builds, stripped of ELF debug sections, reduced to en-US.pak, and packaged with identical dpkg-deb xz level-6 settings. The same ten-list serialized Ghostery engine and Bramble probe were included in both packages. The packages were unpacked staging trees for this smoke benchmark; they were not installed. PSS was sampled every 500 ms in a memory-profile pass; CPU was measured in a separate pass with PSS disabled to avoid observer overhead.",
      compression: "dpkg-deb xz level 6, uniform control/data compression",
      locale: "en-US only; both POC launchers explicitly pass --lang=en-US",
      symbols:
        "ELF .debug_* sections removed; dynamic and non-debug symbols retained",
      cgroupMemory:
        "cgroup v2 memory.current came from the shared sandbox service cgroup, not an isolated benchmark cgroup, so it is diagnostic only and cannot be attributed to these process trees",
      pssPeak:
        "PSS peaks are maxima among sampled smaps_rollup observations, not guaranteed instantaneous peaks",
      omitted:
        "Production Surffish UI, full application dependencies, installers/integration, signing, update/uninstall paths, CEF secure sandbox configuration, and unsupported extension-host integration",
      workloadAssets: {
        ghosteryEngineBytes: statSync(cefEngine).size,
        ghosteryEngineSha256: cefAssetHashes.engine,
        brambleProbeFiles: cefAssetHashes.extension.files,
        brambleProbeSha256: cefAssetHashes.extension.sha256,
      },
    },
    runtimes: {
      cef: {
        version: previousResults.runtimes.cef.version,
        chromium: previousResults.runtimes.cef.chromium,
        package: cefPackage,
        sourceTree: cefStage,
        installedMiB: formatMiB(cefStage.staged.apparentBytes),
      },
      electron: {
        version: previousResults.runtimes.electron.version,
        chromium: previousResults.runtimes.electron.chromium,
        package: electronPackage,
        sourceTree: electronStage,
        installedMiB: formatMiB(electronStage.staged.apparentBytes),
      },
    },
    benchmark: {
      memoryProfile: memoryBenchmark,
      cpuProfile: cpuBenchmark,
    },
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        output: outputPath,
        cefPackageBytes: cefPackage.bytes,
        electronPackageBytes: electronPackage.bytes,
        cefInstalledMiB: report.runtimes.cef.installedMiB,
        electronInstalledMiB: report.runtimes.electron.installedMiB,
        cefDebugRemovedMiB: formatMiB(
          cefStage.stripped.reduce(
            (sum, item) => sum + item.debugBytesBefore - item.debugBytesAfter,
            0,
          ),
        ),
        electronDebugRemovedMiB: formatMiB(
          electronStage.stripped.reduce(
            (sum, item) => sum + item.debugBytesBefore - item.debugBytesAfter,
            0,
          ),
        ),
        memoryProfileSummary: memoryBenchmark.summary,
        cpuProfileSummary: cpuBenchmark.summary,
      },
      null,
      2,
    ),
  );
} finally {
  if (keepWork) console.error(`POC work directory preserved: ${workRoot}`);
  else rmSync(workRoot, { recursive: true, force: true });
}
