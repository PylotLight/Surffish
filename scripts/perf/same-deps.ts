#!/usr/bin/env bun
// Exit 0 when two checkouts can share one node_modules: identical bun.lock and package.json
// identical apart from "scripts" (a PR adding a script shouldn't force a second install).
//   bun scripts/perf/same-deps.ts <dirA> <dirB>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [a, b] = process.argv.slice(2);
const read = (dir: string, file: string) => {
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch {
    return null;
  }
};
const pkg = (dir: string) => {
  const t = read(dir, "package.json");
  if (!t) return null;
  const { scripts: _s, ...rest } = JSON.parse(t);
  return JSON.stringify(rest);
};
const same =
  read(a!, "bun.lock") !== null &&
  read(a!, "bun.lock") === read(b!, "bun.lock") &&
  pkg(a!) !== null &&
  pkg(a!) === pkg(b!);
console.log(
  same
    ? "dependencies match"
    : 'dependencies differ (bun.lock or package.json outside "scripts")',
);
process.exit(same ? 0 : 1);
