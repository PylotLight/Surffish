import { describe, expect, test } from "bun:test";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import {
  compressEngineCacheSync,
  decodeEngineCache,
  isCompressedEngineCache,
  zstdFrameContentSize,
} from "./adblock-cache-codec.ts";

const FILTERS = [
  "||ads.example^",
  "||tracker.example^$third-party",
  "example.com##.banner",
  "@@||ads.example/ok.js",
].join("\n");

function serializedEngine(): Uint8Array {
  return ElectronBlocker.parse(FILTERS, {
    loadCosmeticFilters: true,
    loadNetworkFilters: true,
  }).serialize();
}

describe("ad-filter engine cache codec", () => {
  test("compressed caches round-trip to the same serialized engine", () => {
    const raw = serializedEngine();
    const stored = compressEngineCacheSync(raw);
    expect(isCompressedEngineCache(stored)).toBe(true);
    const decoded = decodeEngineCache(stored);
    expect(Buffer.from(decoded).equals(Buffer.from(raw))).toBe(true);
    expect(
      ElectronBlocker.deserialize(decoded).getFilters().networkFilters.length,
    ).toBeGreaterThan(0);
  });

  test("older uncompressed caches pass through unchanged and still deserialize", () => {
    const raw = serializedEngine();
    expect(isCompressedEngineCache(raw)).toBe(false);
    const decoded = decodeEngineCache(raw);
    expect(decoded).toBe(raw);
    const engine = ElectronBlocker.deserialize(decoded);
    expect(engine.getFilters().networkFilters.length).toBeGreaterThan(0);
  });

  test("a repetitive engine shrinks on disk", () => {
    const big = ElectronBlocker.parse(
      Array.from(
        { length: 4000 },
        (_, i) => `||ads-${i}.example.com^$third-party`,
      ).join("\n"),
      { loadNetworkFilters: true },
    ).serialize();
    const stored = compressEngineCacheSync(big);
    expect(stored.length).toBeLessThan(big.length / 2);
  });

  test("a truncated compressed file never yields an engine", () => {
    const stored = compressEngineCacheSync(serializedEngine());
    expect(() =>
      ElectronBlocker.deserialize(
        decodeEngineCache(stored.subarray(0, Math.floor(stored.length / 2))),
      ),
    ).toThrow();
  });

  test("short or empty files are not mistaken for compressed caches", () => {
    expect(isCompressedEngineCache(new Uint8Array())).toBe(false);
    expect(isCompressedEngineCache(Uint8Array.of(0x28, 0xb5, 0x2f))).toBe(
      false,
    );
  });

  test("reads the decompressed size from the zstd frame header", () => {
    const raw = serializedEngine();
    expect(zstdFrameContentSize(compressEngineCacheSync(raw))).toBe(raw.length);
    const big = new Uint8Array(300_000).fill(7);
    expect(zstdFrameContentSize(compressEngineCacheSync(big))).toBe(big.length);
  });

  test("frame-size parsing handles the header layouts and refuses non-frames", () => {
    // single segment, 1-byte size
    expect(
      zstdFrameContentSize(Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x2a)),
    ).toBe(42);
    // window byte, 2-byte size (+256)
    expect(
      zstdFrameContentSize(
        Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x40, 0x58, 0x10, 0x00),
      ),
    ).toBe(16 + 256);
    // window byte, 4-byte size: 9,011,757 as written for uBO's default lists
    expect(
      zstdFrameContentSize(
        Uint8Array.of(
          0x28,
          0xb5,
          0x2f,
          0xfd,
          0x80,
          0x68,
          0x2d,
          0x82,
          0x89,
          0x00,
        ),
      ),
    ).toBe(9_011_757);
    // no size recorded
    expect(
      zstdFrameContentSize(Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x58)),
    ).toBeNull();
    // truncated header, or not a zstd frame at all
    expect(
      zstdFrameContentSize(
        Uint8Array.of(0x28, 0xb5, 0x2f, 0xfd, 0x80, 0x68, 0x2d),
      ),
    ).toBeNull();
    expect(zstdFrameContentSize(serializedEngine())).toBeNull();
  });
});
