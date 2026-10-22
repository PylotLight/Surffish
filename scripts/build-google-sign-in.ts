// Builds the native WebKit Google sign-in helper (macOS only). Skips the ~4 s swiftc run when the
// helper in out/native was built from the same source, flags and compiler (see native-build-cache).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isNativeBuildUpToDate,
  nativeBuildFingerprint,
} from "./native-build-cache.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") process.exit(0);

const source = join(root, "src/native/macos/google-sign-in/main.swift");
const outputDirectory = join(root, "out/native");
const output = join(outputDirectory, "google-sign-in");
const fingerprintFile = join(outputDirectory, "google-sign-in.inputs.sha256");
mkdirSync(outputDirectory, { recursive: true });

const args = [
  "swiftc",
  "-O",
  "-swift-version",
  "5",
  "-parse-as-library",
  "-target",
  "arm64-apple-macos13.0",
  "-framework",
  "AppKit",
  "-framework",
  "WebKit",
  "-o",
  output,
  source,
];

const versionResult = spawnSync("xcrun", ["swiftc", "--version"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const swiftVersion =
  versionResult.status === 0
    ? `${versionResult.stdout}${versionResult.stderr}`.trim()
    : null;
const sdk = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const sdkPath = sdk.status === 0 ? sdk.stdout.trim() : null;
const fingerprint =
  swiftVersion && sdkPath
    ? nativeBuildFingerprint(source, dirname(source), {
        buildScript: readFileSync(fileURLToPath(import.meta.url), "utf8"),
        args,
        swiftVersion,
        sdkPath,
        developerDir: process.env.DEVELOPER_DIR ?? "",
        sdkRoot: process.env.SDKROOT ?? "",
      })
    : null;

if (
  fingerprint &&
  isNativeBuildUpToDate(output, fingerprintFile, fingerprint)
) {
  console.log("[google sign-in] helper is up to date; skipping build.");
  process.exit(0);
}

const result = spawnSync("xcrun", args, { cwd: root, stdio: "inherit" });

if (result.status !== 0) {
  rmSync(fingerprintFile, { force: true });
  console.warn(
    "[google sign-in] Swift helper failed to build; Google sign-in hand-off is unavailable in this run.",
  );
  process.exit(process.argv.includes("--strict") ? 1 : 0);
}
try {
  if (fingerprint) writeFileSync(fingerprintFile, `${fingerprint}\n`);
  else rmSync(fingerprintFile, { force: true });
} catch (error) {
  console.warn(
    `[google sign-in] Could not save the native build cache: ${error instanceof Error ? error.message : String(error)}`,
  );
}
console.log(`[google sign-in] built ${output}`);
