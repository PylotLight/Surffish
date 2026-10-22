import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileCacheDirectoryFor,
  pruneOtherCompileCaches,
} from "./compile-cache-dir";

test("one cache folder per app version", () => {
  expect(compileCacheDirectoryFor("/c", "0.1.8")).toBe(join("/c", "app-0.1.8"));
  expect(compileCacheDirectoryFor("/c", "0.2.0-beta.1")).toBe(
    join("/c", "app-0.2.0-beta.1"),
  );
  expect(compileCacheDirectoryFor("/c", "../x")).toBe(join("/c", "app-.._x"));
  expect(compileCacheDirectoryFor("/c", "")).toBe(join("/c", "app-unknown"));
});

test("prunes older versions and the pre-versioned layout, keeps the current one", () => {
  const root = mkdtempSync(join(tmpdir(), "compile-cache-"));
  try {
    for (const name of [
      "app-0.1.7",
      "app-0.1.8",
      "v24.21.0-arm64-b5fc144e-1000",
    ]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "00b374cb"), "x");
    }
    expect(pruneOtherCompileCaches(root, "0.1.8").sort()).toEqual([
      "app-0.1.7",
      "v24.21.0-arm64-b5fc144e-1000",
    ]);
    expect(readdirSync(root)).toEqual(["app-0.1.8"]);
    expect(existsSync(join(root, "app-0.1.8", "00b374cb"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing root or a failed removal is not an error", () => {
  expect(
    pruneOtherCompileCaches(
      join(tmpdir(), "surffish-no-such-cache-root"),
      "0.1.8",
    ),
  ).toEqual([]);
  const root = mkdtempSync(join(tmpdir(), "compile-cache-"));
  try {
    mkdirSync(join(root, "app-0.1.7"));
    expect(
      pruneOtherCompileCaches(root, "0.1.8", () => {
        throw new Error("busy");
      }),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
