import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { filletRgba } from "../shared/frame-fillets";
import { BROWSER_FRAME_SURFACE_ARGB } from "../shared/sidebar-card";
import { encodeRgbaPng } from "./sidebar-fillets";

describe("sidebar fillet image", () => {
  test("encodes as a valid RGBA PNG", () => {
    const size = 20;
    const rgba = filletRgba(size, BROWSER_FRAME_SURFACE_ARGB, "bottom");
    const png = encodeRgbaPng(size, rgba);
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString("ascii")).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe(size * (size * 4 + 1));
    expect([...raw.subarray(1, 5)]).toEqual([...rgba.subarray(0, 4)]);
  });
});
