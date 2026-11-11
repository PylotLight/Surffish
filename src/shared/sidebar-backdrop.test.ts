import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SIDEBAR_BACKDROP_SETTINGS,
  intersectRects,
  normalizeSidebarBackdropSettings,
  parseSidebarBackdropOverride,
  resolveSidebarBackdropMode,
  shouldUseNativeSidebarLayer,
  sidebarCaptureRegions,
  snapshotDue,
  SIDEBAR_NATIVE_BLUR_RADIUS,
  sidebarNativeLayerPaint,
} from "./sidebar-backdrop";
import {
  BROWSER_FRAME_SURFACE_ARGB,
  BROWSER_FRAME_SURFACE_PRIVATE_ARGB,
  argbToCss,
  browserFrameSurfaceArgb,
  sidebarCardCssVars,
} from "./sidebar-card";

describe("sidebar backdrop mode", () => {
  test("blur is on by default and survives junk input", () => {
    expect(DEFAULT_SIDEBAR_BACKDROP_SETTINGS.blur).toBe(true);
    expect(normalizeSidebarBackdropSettings(null)).toEqual({ blur: true });
    expect(normalizeSidebarBackdropSettings({ blur: "no" })).toEqual({
      blur: true,
    });
    expect(normalizeSidebarBackdropSettings({ blur: false })).toEqual({
      blur: false,
    });
  });

  test("macOS uses the native compositor blur, everything else the solid tint", () => {
    expect(
      resolveSidebarBackdropMode({
        platform: "darwin",
        settings: { blur: true },
      }),
    ).toBe("native");
    expect(
      resolveSidebarBackdropMode({
        platform: "linux",
        settings: { blur: true },
      }),
    ).toBe("solid");
    expect(
      resolveSidebarBackdropMode({
        platform: "win32",
        settings: { blur: true },
      }),
    ).toBe("solid");
  });

  test("blur off is always solid, even with an override", () => {
    expect(
      resolveSidebarBackdropMode({
        platform: "darwin",
        settings: { blur: false },
      }),
    ).toBe("solid");
    expect(
      resolveSidebarBackdropMode({
        platform: "linux",
        settings: { blur: false },
        override: "snapshot",
      }),
    ).toBe("solid");
  });

  test("the override picks a path for testing", () => {
    expect(parseSidebarBackdropOverride(" Snapshot ")).toBe("snapshot");
    expect(parseSidebarBackdropOverride("native")).toBe("native");
    expect(parseSidebarBackdropOverride("vibrancy")).toBeNull();
    expect(parseSidebarBackdropOverride(undefined)).toBeNull();
    expect(
      resolveSidebarBackdropMode({
        platform: "darwin",
        settings: { blur: true },
        override: "snapshot",
      }),
    ).toBe("snapshot");
    expect(
      resolveSidebarBackdropMode({
        platform: "linux",
        settings: { blur: true },
        override: "native",
      }),
    ).toBe("native");
  });

  test("only a visible undocked overlay gets its own native material layer", () => {
    const overlay = { mode: "native" as const, docked: false, visible: true };
    expect(shouldUseNativeSidebarLayer(overlay)).toBe(true);
    expect(shouldUseNativeSidebarLayer({ ...overlay, docked: true })).toBe(
      false,
    );
    expect(shouldUseNativeSidebarLayer({ ...overlay, visible: false })).toBe(
      false,
    );
    expect(shouldUseNativeSidebarLayer({ ...overlay, mode: "solid" })).toBe(
      false,
    );
  });

  test("toolbar, frame and hover panel are one opaque surface colour", () => {
    expect(BROWSER_FRAME_SURFACE_ARGB).toBe("#FF191B1F");
    expect(BROWSER_FRAME_SURFACE_PRIVATE_ARGB).toBe("#FF1E1A28");
    // Fully opaque: a translucent frame would read differently over vibrancy than over the page.
    expect(BROWSER_FRAME_SURFACE_ARGB.slice(1, 3)).toBe("FF");
    expect(BROWSER_FRAME_SURFACE_PRIVATE_ARGB.slice(1, 3)).toBe("FF");
    expect(browserFrameSurfaceArgb(false)).toBe(BROWSER_FRAME_SURFACE_ARGB);
    expect(browserFrameSurfaceArgb(true)).toBe(
      BROWSER_FRAME_SURFACE_PRIVATE_ARGB,
    );
    // The CSS the toolbar / in-page frame / solid hover panel paint is the same colour.
    const vars = sidebarCardCssVars();
    expect(vars["--frame-surface"]).toBe("rgb(25, 27, 31)");
    expect(vars["--frame-surface-private"]).toBe("rgb(30, 26, 40)");
    expect(argbToCss("#80FF0000")).toBe("rgba(255, 0, 0, 0.502)");
    expect(SIDEBAR_NATIVE_BLUR_RADIUS).toBe(20);
  });

  test("the hover layer ends opaque with no blur and fades in with a blur", () => {
    expect(sidebarNativeLayerPaint(1)).toEqual({ alpha: 1, blur: 0 });
    expect(sidebarNativeLayerPaint(1.4)).toEqual({ alpha: 1, blur: 0 });
    expect(sidebarNativeLayerPaint(0.5)).toEqual({ alpha: 0.5, blur: 10 });
    expect(sidebarNativeLayerPaint(0).alpha).toBe(0.02);
  });
});

describe("sidebar capture regions", () => {
  test("intersections", () => {
    expect(
      intersectRects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
      ),
    ).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(
      intersectRects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 },
      ),
    ).toBeNull();
  });

  test("maps the page strip under the sidebar into page and sidebar coordinates", () => {
    const sidebar = { x: 0, y: 10, width: 320, height: 880 };
    const page = { x: 0, y: 50, width: 1400, height: 850 };
    expect(sidebarCaptureRegions(sidebar, [page])).toEqual([
      {
        index: 0,
        capture: { x: 0, y: 0, width: 320, height: 840 },
        target: { x: 0, y: 40, width: 320, height: 840 },
      },
    ]);
  });

  test("split view: only panes under the sidebar are captured", () => {
    const sidebar = { x: 0, y: 0, width: 320, height: 900 };
    const regions = sidebarCaptureRegions(sidebar, [
      { x: 0, y: 50, width: 200, height: 850 },
      { x: 200, y: 50, width: 1200, height: 850 },
      { x: 600, y: 50, width: 800, height: 850 },
    ]);
    expect(regions.map((region) => region.index)).toEqual([0, 1]);
    expect(regions[1]!.capture).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 850,
    });
    expect(regions[1]!.target).toEqual({
      x: 200,
      y: 50,
      width: 120,
      height: 850,
    });
  });

  test("throttle gate", () => {
    expect(snapshotDue(0, 1000, 900)).toBe(true);
    expect(snapshotDue(500, 1000, 900)).toBe(false);
  });
});
