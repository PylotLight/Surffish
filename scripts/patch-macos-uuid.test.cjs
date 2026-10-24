"use strict";

const assert = require("node:assert/strict");
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  afterPack,
  deriveUuid,
  inspectThinMachO,
  patchExecutable,
  readUuid,
} = require("./patch-macos-uuid.cjs");
const { test } = require("node:test");

function fakeMachO(arch, uuid = "4C4C4474-5555-3144-A1C3-E7F42163428D") {
  const buffer = Buffer.alloc(56);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
  buffer.writeUInt32LE(0, 8); // CPU subtype
  buffer.writeUInt32LE(2, 12); // MH_EXECUTE
  buffer.writeUInt32LE(1, 16); // one load command
  buffer.writeUInt32LE(24, 20); // sizeofcmds
  buffer.writeUInt32LE(0x1b, 32); // LC_UUID
  buffer.writeUInt32LE(24, 36);
  Buffer.from(uuid.replace(/-/g, ""), "hex").copy(buffer, 40);
  return buffer;
}

test("derives a stable UUID per app id and architecture", () => {
  const arm64 = deriveUuid("com.pylotlight.surffish", "arm64");
  assert.equal(arm64, deriveUuid("com.pylotlight.surffish", "arm64"));
  assert.notEqual(arm64, deriveUuid("com.example.other", "arm64"));
  assert.notEqual(arm64, deriveUuid("com.pylotlight.surffish", "x86_64"));
  assert.match(arm64, /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/);
});

test("patches only LC_UUID in a thin ARM64 Mach-O executable", () => {
  const directory = mkdtempSync(join(tmpdir(), "surffish-macho-uuid-"));
  try {
    const executable = join(directory, "Surffish");
    const original = fakeMachO("arm64");
    writeFileSync(executable, original);

    const result = patchExecutable(executable, "com.pylotlight.surffish");
    const patched = readFileSync(executable);

    assert.equal(result.arch, "arm64");
    assert.equal(result.before, "4C4C4474-5555-3144-A1C3-E7F42163428D");
    assert.equal(result.after, deriveUuid("com.pylotlight.surffish", "arm64"));
    assert.equal(readUuid(patched), result.after);
    assert.equal(patched.length, original.length);
    assert.deepEqual(patched.subarray(0, 40), original.subarray(0, 40));
    assert.deepEqual(patched.subarray(56), original.subarray(56));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supports a thin x86_64 Mach-O executable", () => {
  const { arch } = inspectThinMachO(fakeMachO("x86_64"));
  assert.equal(arch, "x86_64");
});

test("afterPack patches the packaged macOS app before signing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "surffish-after-pack-"));
  try {
    const appOutDir = join(directory, "mac-arm64");
    const executableDir = join(appOutDir, "Surffish.app", "Contents", "MacOS");
    mkdirSync(executableDir, { recursive: true });
    const executable = join(executableDir, "Surffish");
    writeFileSync(executable, fakeMachO("arm64"));
    const signed = [];

    await afterPack(
      {
        electronPlatformName: "darwin",
        appOutDir,
        packager: {
          appInfo: {
            id: "com.pylotlight.surffish",
            productFilename: "Surffish",
          },
        },
      },
      { sign: (appPath) => signed.push(appPath) },
    );

    assert.equal(
      readUuid(readFileSync(executable)),
      deriveUuid("com.pylotlight.surffish", "arm64"),
    );
    // The patch breaks the first __TEXT page hash, so macOS must re-sign.
    assert.deepEqual(
      signed,
      process.platform === "darwin" ? [join(appOutDir, "Surffish.app")] : [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not touch non-macOS packages", async () => {
  await assert.doesNotReject(
    afterPack({ electronPlatformName: "win32", appOutDir: "/missing" }),
  );
});

test("fails closed for unsupported or malformed Mach-O executables", () => {
  assert.throws(() => inspectThinMachO(Buffer.alloc(56)), /Mach-O executable/);
  assert.throws(
    () => deriveUuid("com.pylotlight.surffish", "universal"),
    /Unsupported macOS executable architecture/,
  );
});
