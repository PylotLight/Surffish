import { describe, expect, test } from "bun:test";
import { resolveWindowFrameMaterial } from "./window-frame-material";

describe("browser window frame material", () => {
  test("uses the native sidebar material on macOS", () => {
    expect(
      resolveWindowFrameMaterial({
        platform: "darwin",
        osRelease: "24.6.0",
        supportsWindowsBackgroundMaterial: false,
      }),
    ).toBe("macos-sidebar");
  });

  test("uses Windows Mica only when Electron and Windows support it", () => {
    expect(
      resolveWindowFrameMaterial({
        platform: "win32",
        osRelease: "10.0.22621.1",
        supportsWindowsBackgroundMaterial: true,
      }),
    ).toBe("windows-mica");
    expect(
      resolveWindowFrameMaterial({
        platform: "win32",
        osRelease: "10.0.22621.1",
        supportsWindowsBackgroundMaterial: false,
      }),
    ).toBe("solid");
    expect(
      resolveWindowFrameMaterial({
        platform: "win32",
        osRelease: "10.0.22000.1",
        supportsWindowsBackgroundMaterial: true,
      }),
    ).toBe("solid");
  });

  test("keeps a solid fallback on Linux, older Windows, and unknown versions", () => {
    for (const [platform, osRelease] of [
      ["linux", "6.8.0"],
      ["win32", "10.0.19045.0"],
      ["win32", "unknown"],
    ] as const) {
      expect(
        resolveWindowFrameMaterial({
          platform,
          osRelease,
          supportsWindowsBackgroundMaterial: true,
        }),
      ).toBe("solid");
    }
  });
});
