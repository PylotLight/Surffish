import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFilterEngine } from "../../src/main/adblock-filters.ts";
import { Request } from "@ghostery/adblocker";

const output = process.argv[2];
if (!output) {
  throw new Error("Usage: bun build-live-filter-engine.mjs <temporary-engine-cache.bin>");
}
const outputPath = resolve(output);
const built = await buildFilterEngine(async (url) => fetch(url));
const sampleUrl = "https://doubleclick.net/ads.js";
const sample = built.engine.match(
  Request.fromRawDetails({
    url: sampleUrl,
    sourceUrl: "https://news.example/",
    type: "script",
  }),
);
if (!sample.match) {
  throw new Error(`The selected production lists did not block the test URL: ${sampleUrl}`);
}
const bytes = built.engine.serialize();
writeFileSync(outputPath, bytes);
console.log(JSON.stringify({
  output: outputPath,
  loadedLists: built.loadedLists,
  failedLists: built.failedLists,
  serializedBytes: bytes.byteLength,
  sample: {
    url: sampleUrl,
    blocked: sample.match,
    filter: sample.filter?.toString(),
  },
}, null, 2));
