import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isNativeBuildUpToDate,
  nativeBuildFingerprint,
} from "./native-build-cache.ts";

function makeInputs(): { root: string; source: string; headers: string } {
  const root = mkdtempSync(join(tmpdir(), "surffish-native-build-cache-"));
  const headers = join(root, "include");
  mkdirSync(join(headers, "nested"), { recursive: true });
  const source = join(root, "addon.mm");
  writeFileSync(source, "source v1\n");
  writeFileSync(join(headers, "node_api.h"), "header v1\n");
  writeFileSync(join(headers, "nested", "types.h"), "nested header v1\n");
  return { root, source, headers };
}

function fingerprint(
  source: string,
  headers: string,
  optimization = "-O2",
): string {
  return nativeBuildFingerprint(source, headers, {
    compiler: "Apple clang 17",
    args: ["-std=c++20", optimization],
    sdk: "macOS SDK 15",
  });
}

test("native build fingerprint covers source, nested headers, and compiler configuration", (t) => {
  const { root, source, headers } = makeInputs();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const initial = fingerprint(source, headers);
  assert.equal(fingerprint(source, headers), initial);

  writeFileSync(source, "source v2\n");
  assert.notEqual(fingerprint(source, headers), initial);
  writeFileSync(source, "source v1\n");

  writeFileSync(join(headers, "nested", "types.h"), "nested header v2\n");
  assert.notEqual(fingerprint(source, headers), initial);
  writeFileSync(join(headers, "nested", "types.h"), "nested header v1\n");

  assert.notEqual(fingerprint(source, headers, "-O3"), initial);
});

test("native build cache requires both a matching stamp and an output file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "surffish-native-build-stamp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "mac-trackpad-swipe.node");
  const stamp = join(root, "mac-trackpad-swipe.inputs.sha256");
  const currentFingerprint = "a".repeat(64);

  writeFileSync(stamp, `${currentFingerprint}\n`);
  assert.equal(isNativeBuildUpToDate(output, stamp, currentFingerprint), false);

  writeFileSync(output, "compiled addon");
  assert.equal(isNativeBuildUpToDate(output, stamp, currentFingerprint), true);
  assert.equal(isNativeBuildUpToDate(output, stamp, "b".repeat(64)), false);
});
