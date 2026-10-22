import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const dependencyInputs = ["package.json", "bun.lock", ".bun-version"];
const installStateFilename = ".surffish-dependency-state";

type Install = (projectRoot: string) => boolean;

type Log = (message: string) => void;

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function dependencyFingerprint(projectRoot: string): string {
  const hash = createHash("sha256");
  for (const input of dependencyInputs) {
    hash.update(input);
    hash.update("\0");
    try {
      hash.update(readFileSync(join(projectRoot, input)));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function runBunInstall(projectRoot: string): boolean {
  const result = spawnSync(process.execPath, ["install"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[dev] failed to run bun install: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(
      `[dev] bun install exited with status ${result.status ?? "unknown"}`,
    );
    return false;
  }
  return true;
}

/** Install project dependencies when the manifest, lockfile, or Bun pin changes. */
export function ensureDependencies(
  projectRoot: string,
  install: Install = runBunInstall,
  log: Log = console.log,
): boolean {
  const nodeModules = join(projectRoot, "node_modules");
  const stateFile = join(nodeModules, installStateFilename);
  const fingerprint = dependencyFingerprint(projectRoot);

  try {
    if (readFileSync(stateFile, "utf8").trim() === fingerprint) return true;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  log(
    "[dev] dependency files changed or are not installed; running bun install",
  );
  if (!install(projectRoot)) return false;

  mkdirSync(nodeModules, { recursive: true });
  // bun install may update bun.lock, so record the inputs after installation.
  writeFileSync(stateFile, `${dependencyFingerprint(projectRoot)}\n`);
  return true;
}
