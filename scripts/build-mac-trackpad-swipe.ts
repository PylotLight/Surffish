import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isNativeBuildUpToDate,
  nativeBuildFingerprint,
} from "./native-build-cache.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isDevelopment = process.argv.includes("--dev");

if (process.platform !== "darwin") {
  process.exit(0);
}

const source = join(root, "src/native/macos/mac-trackpad-swipe.mm");
const outputDirectory = join(root, "out/native");
const output = join(outputDirectory, "mac-trackpad-swipe.node");
const fingerprintFile = join(
  outputDirectory,
  "mac-trackpad-swipe.inputs.sha256",
);
const headersPackage = Bun.resolveSync("node-api-headers/package.json", root);
const headersDirectory = join(dirname(headersPackage), "include");
mkdirSync(outputDirectory, { recursive: true });

function commandOutput(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

const compilerPath = commandOutput("xcrun", ["--find", "clang++"]);
const compilerVersion = compilerPath
  ? commandOutput(compilerPath, ["--version"])
  : null;
const sdkPath = commandOutput("xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
const sdkVersion = commandOutput("xcrun", [
  "--sdk",
  "macosx",
  "--show-sdk-version",
]);
const toolchain =
  compilerPath && compilerVersion && sdkPath && sdkVersion
    ? {
        compilerPath,
        compilerVersion,
        sdkPath,
        sdkVersion,
        environment: Object.fromEntries(
          [
            "DEVELOPER_DIR",
            "TOOLCHAINS",
            "SDKROOT",
            "CPATH",
            "C_INCLUDE_PATH",
            "CPLUS_INCLUDE_PATH",
            "OBJC_INCLUDE_PATH",
            "OBJCPLUS_INCLUDE_PATH",
          ].map((name) => [name, process.env[name] ?? ""]),
        ),
      }
    : null;

const compilerArgs = [
  "clang++",
  "-bundle",
  "-undefined",
  "dynamic_lookup",
  "-arch",
  "arm64",
  "-arch",
  "x86_64",
  "-mmacosx-version-min=13.0",
  "-fobjc-arc",
  "-std=c++20",
  "-O2",
  "-Wall",
  "-Wextra",
  "-I",
  headersDirectory,
  "-framework",
  "AppKit",
  "-framework",
  "QuartzCore",
  "-o",
  output,
  source,
];
const fingerprint = toolchain
  ? nativeBuildFingerprint(source, headersDirectory, {
      buildScript: readFileSync(fileURLToPath(import.meta.url), "utf8"),
      compilerArgs,
      toolchain,
    })
  : null;

if (
  fingerprint &&
  isNativeBuildUpToDate(output, fingerprintFile, fingerprint)
) {
  console.log("[trackpad swipe] Native addon is up to date; skipping build.");
  process.exit(0);
}

const result = spawnSync("xcrun", compilerArgs, {
  cwd: root,
  stdio: "inherit",
});
if (result.error || result.status !== 0) {
  const detail =
    result.error?.message ??
    `clang exited with status ${result.status ?? "unknown"}`;
  if (isDevelopment) {
    console.warn(
      `[trackpad swipe] Native addon unavailable in this development run: ${detail}`,
    );
    process.exit(0);
  }
  console.error(`[trackpad swipe] Native addon build failed: ${detail}`);
  process.exit(result.status || 1);
}

try {
  if (fingerprint) {
    const temporaryFingerprintFile = `${fingerprintFile}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryFingerprintFile, `${fingerprint}\n`);
      renameSync(temporaryFingerprintFile, fingerprintFile);
    } catch (error) {
      rmSync(temporaryFingerprintFile, { force: true });
      throw error;
    }
  } else {
    // If the toolchain cannot be identified, do not let an older stamp mask that fact later.
    rmSync(fingerprintFile, { force: true });
  }
} catch (error) {
  console.warn(
    `[trackpad swipe] Could not save the native build cache: ${error instanceof Error ? error.message : String(error)}`,
  );
}

console.log(`[trackpad swipe] Built universal macOS addon: ${output}`);
