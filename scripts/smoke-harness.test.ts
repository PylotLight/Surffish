import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  ADBLOCK_CACHE_FILE,
  FULL_FILTER_CONFIG,
  isFullFilterConfig,
} from "../src/main/adblock-policy.ts";

const smoke = createRequire(import.meta.url)("./smoke-adblock-config.cjs");

test("the smokes seed an adblock engine the app accepts as its cache (no filter download at launch)", () => {
  assert.equal(smoke.ADBLOCK_CACHE_FILE, ADBLOCK_CACHE_FILE);
  assert.deepEqual({ ...smoke.ADBLOCK_CONFIG }, { ...FULL_FILTER_CONFIG });
  assert.equal(isFullFilterConfig(smoke.ADBLOCK_CONFIG), true);
});

test("smoke-only Chromium switches against the Linux OOM-score log spam", () => {
  const { smokeChromiumArgs } = createRequire(import.meta.url)(
    "./smoke-chromium-args.cjs",
  );
  assert.deepEqual(
    smokeChromiumArgs([], { ELECTRON_DISABLE_SANDBOX: "1" }, "darwin"),
    [],
    "never on macOS",
  );
  assert.deepEqual(
    smokeChromiumArgs([], { ELECTRON_DISABLE_SANDBOX: "1" }, "linux"),
    ["--no-sandbox", "--no-zygote"],
  );
  assert.deepEqual(smokeChromiumArgs(["--no-sandbox"], {}, "linux"), [
    "--no-sandbox",
    "--no-zygote",
  ]);
  assert.deepEqual(
    smokeChromiumArgs(
      [],
      { ELECTRON_DISABLE_SANDBOX: "1", SMOKE_KEEP_ZYGOTE: "1" },
      "linux",
    ),
    [],
  );
  assert.deepEqual(
    smokeChromiumArgs([], {}, "linux"),
    [],
    "sandboxed: the zygote is required, leave it alone",
  );
});

test("hidden smoke mode: macOS only, v1 or v2, throttle mode for perf", () => {
  const { hiddenMode, throttleMode } = createRequire(import.meta.url)(
    "./smoke-hidden.cjs",
  );
  assert.equal(hiddenMode({}, "darwin"), 0, "off when unset");
  assert.equal(hiddenMode({ SURFFISH_SMOKE_HIDDEN: "0" }, "darwin"), 0);
  assert.equal(hiddenMode({ SURFFISH_SMOKE_HIDDEN: "1" }, "darwin"), 1);
  assert.equal(hiddenMode({ SURFFISH_SMOKE_HIDDEN: "2" }, "darwin"), 2);
  assert.equal(
    hiddenMode({ SURFFISH_SMOKE_HIDDEN: "3" }, "darwin"),
    0,
    "unknown values are off",
  );
  assert.equal(
    hiddenMode({ SURFFISH_SMOKE_HIDDEN: "2" }, "linux"),
    0,
    "never off macOS",
  );
  assert.equal(
    hiddenMode(
      { SURFFISH_SMOKE_HIDDEN: "2", SURFFISH_SMOKE_HIDDEN_FORCE: "1" },
      "linux",
    ),
    2,
    "unless forced (testing this file)",
  );
  assert.equal(throttleMode({}), "all");
  assert.equal(
    throttleMode({ SURFFISH_SMOKE_HIDDEN_THROTTLE: "visible" }),
    "visible",
  );
});

test("smoke profiles are removed with retries, and a leftover profile only warns", () => {
  const { removeProfile } = createRequire(import.meta.url)(
    "./smoke-profile.cjs",
  );
  const calls: unknown[] = [];
  assert.equal(
    removeProfile("/tmp/p", {
      rm: (dir: string, options: unknown) => {
        calls.push([dir, options]);
      },
    }),
    true,
  );
  assert.deepEqual(
    calls,
    [
      [
        "/tmp/p",
        { recursive: true, force: true, maxRetries: 10, retryDelay: 100 },
      ],
    ],
    "retries ENOTEMPTY/EBUSY from late Chromium writes",
  );
  const warnings: string[] = [];
  const busy = () => {
    throw Object.assign(new Error("Directory not empty"), {
      code: "ENOTEMPTY",
    });
  };
  assert.equal(
    removeProfile("/tmp/p", {
      rm: busy,
      warn: (line: string) => warnings.push(line),
    }),
    false,
  );
  assert.match(warnings[0]!, /ENOTEMPTY.*not a test failure/);
  assert.equal(removeProfile("", { rm: busy }), true, "nothing to remove");
});
