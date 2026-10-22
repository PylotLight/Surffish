#!/usr/bin/env bun
// Pools a confirmation bench into the first one (same apps), recomputing every aggregate.
//   bun scripts/perf/merge.ts perf.json perf-confirm.json --out perf-merged.json
// CI runs it when compare.ts exits 3 (only timing/memory metrics failed): see mergeReports in metrics.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { mergeReports } from "./metrics.ts";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args[outAt + 1] : undefined;
const inputs = args.filter(
  (arg, i) => !arg.startsWith("--") && (outAt < 0 || i !== outAt + 1),
);
if (inputs.length !== 2 || !out)
  throw new Error(
    "usage: merge.ts <first.json> <confirm.json> --out <merged.json>",
  );
const [first, second] = inputs.map((file) =>
  JSON.parse(readFileSync(file!, "utf8")),
);
writeFileSync(out, JSON.stringify(mergeReports(first, second), null, 2));
