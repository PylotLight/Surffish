#!/usr/bin/env bun
// Decides whether a change can move the perf numbers at all. The perf (linux) job skips its ~2 min
// bench when nothing that reaches the built app, its dependencies or the bench itself changed
// (docs, CI config, smoke tests, unit tests): both sides would run identical code.
//   bun scripts/perf/app-changed.ts <base sha> <head sha>   exit 0 = bench, exit 1 = skip
import { spawnSync } from "node:child_process";

// Paths that never reach `out/` or the bench. Everything else counts, including unknown new paths.
const IGNORED: RegExp[] = [
  /^\.github\//,
  /^docs\//,
  /^Casks\//,
  /(^|\/)[^/]+\.md$/,
  /^LICENSE$/,
  /\.test\.(ts|tsx|cjs|mjs|js)$/,
  // scripts/ is tests and tooling, except the bench, what it loads, and the build steps.
  /^scripts\/(?!perf\/|smoke-hidden\.cjs$|build-|native-build-cache\.ts$)/,
];

/** package.json keys whose changes can't reach the app: the test scripts. */
const isTestScript = (name: string) =>
  name === "test" ||
  name.startsWith("test:") ||
  name.startsWith("probe:") ||
  name.startsWith("check:");

/** True when two package.json texts differ only in test scripts. */
export function onlyTestScriptsChanged(before: string, after: string): boolean {
  try {
    const strip = (text: string) => {
      const { scripts = {}, ...rest } = JSON.parse(text) as {
        scripts?: Record<string, string>;
      };
      const kept = Object.fromEntries(
        Object.entries(scripts)
          .filter(([name]) => !isTestScript(name))
          .sort(([a], [b]) => a.localeCompare(b)),
      );
      return JSON.stringify({ ...rest, scripts: kept });
    };
    return strip(before) === strip(after);
  } catch {
    return false;
  }
}

/** The changed paths that can affect perf (empty = safe to skip the bench). */
export function perfRelevantPaths(
  paths: string[],
  packageJsonOnlyTests = false,
): string[] {
  return paths.filter((path) => {
    if (path === "package.json" && packageJsonOnlyTests) return false;
    return !IGNORED.some((pattern) => pattern.test(path));
  });
}

if (import.meta.main) {
  const [base, head] = process.argv.slice(2);
  const git = (...args: string[]) =>
    spawnSync("git", args, { encoding: "utf8" });
  const diff = base && head ? git("diff", "--name-only", base, head) : null;
  if (!diff || diff.status !== 0) {
    console.log(`can't diff ${base}..${head}, benching to be safe`);
    process.exit(0);
  }
  const paths = diff.stdout.split("\n").filter(Boolean);
  const pkgTestsOnly =
    paths.includes("package.json") &&
    onlyTestScriptsChanged(
      git("show", `${base}:package.json`).stdout,
      git("show", `${head}:package.json`).stdout,
    );
  const relevant = perfRelevantPaths(paths, pkgTestsOnly);
  if (relevant.length) {
    console.log(
      `${relevant.length} changed file(s) can affect perf: ${relevant.slice(0, 8).join(", ")}${relevant.length > 8 ? ", ..." : ""}`,
    );
    process.exit(0);
  }
  console.log(
    `none of the ${paths.length} changed file(s) reach the app or the bench`,
  );
  process.exit(1);
}
