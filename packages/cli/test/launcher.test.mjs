// End to end against a local HTTP server: download (through a redirect) -> verify -> unpack -> cache
// -> --path, plus the unsupported-platform path. The fixture zip is written in JS; unpacking needs
// `unzip` (ditto on macOS is only used for platform 'darwin'), so those tests skip without it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../app.config.mjs";
import { run } from "../lib/launcher.mjs";
import { createUI } from "../lib/ui.mjs";
import { storeZip } from "./zip-fixture.mjs";

// the local server must not go through a runner/sandbox HTTP(S)_PROXY (bun's fetch honours them)
for (const key of ["NO_PROXY", "no_proxy"])
  process.env[key] = [process.env[key], "127.0.0.1", "localhost"]
    .filter(Boolean)
    .join(",");

const hasZip = spawnSync("unzip", ["-v"], { stdio: "ignore" }).status === 0;
const work = mkdtempSync(join(tmpdir(), "cli-e2e-"));
let server;
let base = "";
let zipBytes = Buffer.alloc(0);
let sha = "";

const sink = () => {
  const out = {
    chunks: [],
    isTTY: false,
    write(s) {
      out.chunks.push(s);
      return true;
    },
    text: () => out.chunks.join(""),
  };
  return out;
};

beforeAll(async () => {
  zipBytes = storeZip([
    { name: "Surffish.app/" },
    { name: "Surffish.app/Contents/" },
    { name: "Surffish.app/Contents/Info.plist", data: Buffer.from("<plist/>") },
    { name: "Surffish.app/Contents/blob", data: Buffer.alloc(256 * 1024, 7) },
  ]);
  sha = createHash("sha256").update(zipBytes).digest("hex");
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/app.zip" });
      res.end();
      return;
    }
    if (req.url === "/app.zip") {
      res.writeHead(200, { "Content-Length": zipBytes.length });
      res.end(zipBytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => {
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

describe("launcher", () => {
  test("unsupported platform prints a friendly message and exits 1", async () => {
    const err = sink();
    const code = await run(config, {
      argv: [],
      packageVersion: "0.1.22",
      env: { HOME: work },
      platform: "win32",
      arch: "x64",
      ui: createUI({ stream: err, env: {} }),
      stdout: sink(),
    });
    expect(code).toBe(1);
    expect(err.text()).toContain(
      "Windows is not supported by this launcher yet",
    );
  });

  test.skipIf(!hasZip)(
    "downloads through a redirect, verifies, unpacks atomically, then hits the cache",
    async () => {
      const cacheDir = join(work, "cache");
      const env = {
        SURFFISH_CLI_CACHE_DIR: cacheDir,
        SURFFISH_CLI_ASSET_URL: `${base}/redirect`,
        SURFFISH_CLI_SHA256: sha,
      };
      const err = sink();
      const code = await run(config, {
        argv: ["--no-launch"],
        packageVersion: "0.1.22",
        env,
        platform: "linux",
        arch: "x64",
        ui: createUI({ stream: err, env: {} }),
        stdout: sink(),
      });
      expect(code).toBe(0);
      const text = err.text();
      expect(text).toContain("ok: downloaded");
      expect(text).toMatch(/ok: verified sha256 [0-9a-f]{12}…/);
      expect(text).toContain("ok: unpacked with unzip");
      expect(text).not.toMatch(/\x1b\[/);
      expect(
        existsSync(
          join(cacheDir, "0.1.22", "Surffish.app", "Contents", "Info.plist"),
        ),
      ).toBe(true);
      expect(readdirSync(cacheDir).filter((n) => n.startsWith("."))).toEqual(
        [],
      ); // no temp files left

      // second run: cached, so no network at all; --path prints the bundle
      const out = sink();
      const code2 = await run(config, {
        argv: ["--path"],
        packageVersion: "0.1.22",
        env: { SURFFISH_CLI_CACHE_DIR: cacheDir },
        platform: "darwin",
        arch: "arm64",
        ui: createUI({ stream: sink(), env: {} }),
        stdout: out,
        fetchImpl: () => {
          throw new Error("network used");
        },
      });
      expect(code2).toBe(0);
      expect(out.text().trim()).toBe(join(cacheDir, "0.1.22", "Surffish.app"));
    },
  );

  test.skipIf(!hasZip)(
    "a checksum mismatch fails and leaves nothing in the cache",
    async () => {
      const cacheDir = join(work, "cache-bad");
      const env = {
        SURFFISH_CLI_CACHE_DIR: cacheDir,
        SURFFISH_CLI_ASSET_URL: `${base}/app.zip`,
        SURFFISH_CLI_SHA256: "a".repeat(64),
      };
      await expect(
        run(config, {
          argv: ["--no-launch"],
          packageVersion: "0.1.22",
          env,
          platform: "linux",
          arch: "x64",
          ui: createUI({ stream: sink(), env: {} }),
          stdout: sink(),
        }),
      ).rejects.toThrow(/SHA-256 mismatch/);
      expect(readdirSync(cacheDir)).toEqual([]);
    },
  );

  test.skipIf(process.platform !== "darwin")(
    "macOS: unpacks with ditto and finds the .app",
    async () => {
      const cacheDir = join(work, "cache-ditto");
      const env = {
        SURFFISH_CLI_CACHE_DIR: cacheDir,
        SURFFISH_CLI_ASSET_URL: `${base}/app.zip`,
        SURFFISH_CLI_SHA256: sha,
      };
      const err = sink();
      const code = await run(config, {
        argv: ["--no-launch"],
        packageVersion: "0.1.22",
        env,
        platform: "darwin",
        arch: "arm64",
        ui: createUI({ stream: err, env: {} }),
        stdout: sink(),
      });
      expect(code).toBe(0);
      expect(err.text()).toContain("ok: unpacked with ditto");
      expect(
        existsSync(
          join(cacheDir, "0.1.22", "Surffish.app", "Contents", "Info.plist"),
        ),
      ).toBe(true);
    },
  );

  test("--clear-cache removes the cache dir", async () => {
    const cacheDir = join(work, "surffish-clear");
    mkdirSync(join(cacheDir, "0.1.0"), { recursive: true });
    const err = sink();
    const code = await run(config, {
      argv: ["--clear-cache"],
      packageVersion: "0.1.22",
      env: { SURFFISH_CLI_CACHE_DIR: cacheDir },
      ui: createUI({ stream: err, env: {} }),
      stdout: sink(),
    });
    expect(code).toBe(0);
    expect(existsSync(cacheDir)).toBe(false);
    expect(err.text()).toContain("ok: cleared");
  });
});
