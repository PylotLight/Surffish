"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const MH_MAGIC_64 = 0xfeedfacf;
const LC_UUID = 0x1b;
const UUID_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

function uuidFromBytes(bytes) {
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function uuidBytes(uuid) {
  const value = String(uuid);
  if (!/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return Buffer.from(value.replace(/-/g, ""), "hex");
}

function deriveUuid(appId, arch) {
  if (typeof appId !== "string" || appId.length === 0) {
    throw new Error("A non-empty app bundle identifier is required.");
  }
  if (arch !== "arm64" && arch !== "x86_64") {
    throw new Error(`Unsupported macOS executable architecture: ${arch}`);
  }
  const name = Buffer.from(`surffish.main-executable:${appId}:${arch}`, "utf8");
  const bytes = createHash("sha1")
    .update(UUID_NAMESPACE)
    .update(name)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

function inspectThinMachO(buffer) {
  if (buffer.length < 32 || buffer.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error("Expected a thin 64-bit little-endian Mach-O executable.");
  }

  const cpuType = buffer.readUInt32LE(4);
  const arch =
    cpuType === 0x0100000c ? "arm64" : cpuType === 0x01000007 ? "x86_64" : null;
  if (!arch) {
    throw new Error(`Unsupported Mach-O CPU type: 0x${cpuType.toString(16)}.`);
  }

  const commandCount = buffer.readUInt32LE(16);
  const commandBytes = buffer.readUInt32LE(20);
  const commandsEnd = 32 + commandBytes;
  if (commandsEnd > buffer.length) {
    throw new Error("Mach-O load commands extend past the end of the file.");
  }

  let offset = 32;
  const uuidOffsets = [];
  for (let i = 0; i < commandCount; i += 1) {
    if (offset + 8 > commandsEnd) {
      throw new Error("Truncated Mach-O load command.");
    }
    const command = buffer.readUInt32LE(offset);
    const commandSize = buffer.readUInt32LE(offset + 4);
    if (commandSize < 8 || offset + commandSize > commandsEnd) {
      throw new Error("Invalid Mach-O load command size.");
    }
    if (command === LC_UUID) {
      if (commandSize !== 24) {
        throw new Error("Invalid LC_UUID load command size.");
      }
      uuidOffsets.push(offset + 8);
    }
    offset += commandSize;
  }

  if (uuidOffsets.length !== 1) {
    throw new Error(
      `Expected exactly one LC_UUID load command, found ${uuidOffsets.length}.`,
    );
  }
  return { arch, uuidOffset: uuidOffsets[0] };
}

function readUuid(buffer) {
  const { uuidOffset } = inspectThinMachO(buffer);
  return uuidFromBytes(buffer.subarray(uuidOffset, uuidOffset + 16));
}

function patchExecutable(executablePath, appId) {
  const buffer = readFileSync(executablePath);
  const { arch, uuidOffset } = inspectThinMachO(buffer);
  const before = uuidFromBytes(buffer.subarray(uuidOffset, uuidOffset + 16));
  const after = deriveUuid(appId, arch);
  uuidBytes(after).copy(buffer, uuidOffset);
  writeFileSync(executablePath, buffer);
  return { arch, before, after };
}

// Rewriting LC_UUID changes the first __TEXT page, so the code signature that
// came with the Electron binary (linker-signed, ad hoc) no longer matches and
// the kernel kills the app at launch ("Code Signature Invalid", Invalid Page).
// electron-builder only re-signs when it finds an identity, so always ad hoc
// re-sign the bundle here; a real signing step afterwards simply replaces it.
function adHocSign(appPath) {
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
}

async function afterPack(context, { sign = adHocSign } = {}) {
  if (!["darwin", "mas"].includes(context.electronPlatformName)) return;

  const { appInfo } = context.packager;
  const appPath = join(context.appOutDir, `${appInfo.productFilename}.app`);
  const executablePath = join(
    appPath,
    "Contents",
    "MacOS",
    appInfo.productFilename,
  );
  const { arch, before, after } = patchExecutable(executablePath, appInfo.id);
  if (before === after) {
    throw new Error("Surffish main executable already has the generated UUID.");
  }
  console.log(
    `Surffish macOS main executable LC_UUID (${arch}): ${before} -> ${after}`,
  );
  if (process.platform === "darwin") {
    sign(appPath);
    console.log("Surffish.app re-signed ad hoc after the LC_UUID patch.");
  }
}

module.exports = {
  adHocSign,
  afterPack,
  deriveUuid,
  inspectThinMachO,
  patchExecutable,
  readUuid,
  uuidBytes,
  uuidFromBytes,
};
