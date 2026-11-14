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
  SIDEBAR_HOVER_GLASS_BLUR,
  sidebarNativeLayerPaint,
} from "./sidebar-backdrop";
import {
  BROWSER_FRAME_GLASS_ARGB,
  BROWSER_FRAME_GLASS_LIGHT_ARGB,
  BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB,
  BROWSER_FRAME_GLASS_PRIVATE_ARGB,
  BROWSER_FRAME_SURFACE_ARGB,
  BROWSER_FRAME_SURFACE_PRIVATE_ARGB,
  SIDEBAR_HOVER_GLASS_ARGB,
  SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
  argbToCss,
  browserFrameGroundArgb,
  browserFrameIsGlass,
  browserFrameSurfaceArgb,
  sidebarCardCssVars,
  sidebarHoverCardArgb,
} from "./sidebar-card";

describe("sidebar backdrop mode", () => {
  test("blur is on by default and survives junk input", () => {
    expect(DEFAULT_SIDEBAR_BACKDROP_SETTINGS.blur).toBe(true);
    expect(normalizeSidebarBackdropSettings(null)).toEqual({
      blur: true,
      frameTransparency: 80,
      sidebarPushesPage: true,
      sidebarPushStyle: "resize",
      swipeSlidesPage: false,
    });
    expect(normalizeSidebarBackdropSettings({ blur: "no" })).toEqual({
      blur: true,
      frameTransparency: 80,
      sidebarPushesPage: true,
      sidebarPushStyle: "resize",
      swipeSlidesPage: false,
    });
    expect(normalizeSidebarBackdropSettings({ blur: false })).toEqual({
      blur: false,
      frameTransparency: 80,
      sidebarPushesPage: true,
      sidebarPushStyle: "resize",
      swipeSlidesPage: false,
    });
    expect(
      normalizeSidebarBackdropSettings({ blur: true, frameTransparency: 140 }),
    ).toEqual({
      blur: true,
      frameTransparency: 100,
      sidebarPushesPage: true,
      sidebarPushStyle: "resize",
      swipeSlidesPage: false,
    });
    expect(
      normalizeSidebarBackdropSettings({ sidebarPushesPage: false }),
    ).toEqual({
      blur: true,
      frameTransparency: 80,
      sidebarPushesPage: false,
      sidebarPushStyle: "resize",
      swipeSlidesPage: false,
    });
    expect(
      normalizeSidebarBackdropSettings({ swipeSlidesPage: true })
        .swipeSlidesPage,
    ).toBe(true);
    expect(
      normalizeSidebarBackdropSettings({ swipeSlidesPage: "yes" })
        .swipeSlidesPage,
    ).toBe(false);
    expect(
      normalizeSidebarBackdropSettings({ sidebarPushesPage: "no" })
        .sidebarPushesPage,
    ).toBe(true);
    expect(
      normalizeSidebarBackdropSettings({ sidebarPushStyle: "slide" })
        .sidebarPushStyle,
    ).toBe("slide");
    expect(
      normalizeSidebarBackdropSettings({ sidebarPushStyle: "wobble" })
        .sidebarPushStyle,
    ).toBe("resize");
  });

  test("macOS snapshots into its WebContentsView, everything else uses the solid tint", () => {
    expect(
      resolveSidebarBackdropMode({
        platform: "darwin",
        settings: { blur: true },
      }),
    ).toBe("snapshot");
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
    expect(
      resolveSidebarBackdropMode({
        platform: "darwin",
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

  test("the opaque frame surface: Linux, Windows, Reduce Transparency, fullscreen", () => {
    expect(BROWSER_FRAME_SURFACE_ARGB).toBe("#FF191B1F");
    expect(BROWSER_FRAME_SURFACE_PRIVATE_ARGB).toBe("#FF1E1A28");
    expect(browserFrameSurfaceArgb(false)).toBe(BROWSER_FRAME_SURFACE_ARGB);
    expect(browserFrameSurfaceArgb(true)).toBe(
      BROWSER_FRAME_SURFACE_PRIVATE_ARGB,
    );
    for (const isPrivate of [false, true]) {
      expect(browserFrameGroundArgb({ isPrivate, glass: false })).toBe(
        browserFrameSurfaceArgb(isPrivate),
      );
      expect(sidebarHoverCardArgb({ isPrivate, glass: false })).toBe(
        browserFrameSurfaceArgb(isPrivate),
      );
    }
    // The CSS the in-page frame / solid hover card paint is the same colour.
    const vars = sidebarCardCssVars();
    expect(vars["--frame-surface"]).toBe("rgb(25, 27, 31)");
    expect(vars["--frame-surface-private"]).toBe("rgb(30, 26, 40)");
    expect(argbToCss("#80FF0000")).toBe("rgba(255, 0, 0, 0.502)");
  });

  test("macOS glass: translucent frame tint over vibrancy, denser hover card tint", () => {
    const mac = { platform: "darwin", reducedTransparency: false };
    expect(browserFrameIsGlass({ ...mac, fullscreen: false })).toBe(true);
    expect(browserFrameIsGlass({ ...mac, fullscreen: true })).toBe(false);
    expect(
      browserFrameIsGlass({
        ...mac,
        reducedTransparency: true,
        fullscreen: false,
      }),
    ).toBe(false);
    for (const platform of ["linux", "win32"])
      expect(
        browserFrameIsGlass({
          platform,
          reducedTransparency: false,
          fullscreen: false,
        }),
      ).toBe(false);

    expect(BROWSER_FRAME_GLASS_ARGB).toBe("#33121519");
    expect(browserFrameGroundArgb({ isPrivate: false, glass: true })).toBe(
      BROWSER_FRAME_GLASS_ARGB,
    );
    expect(browserFrameGroundArgb({ isPrivate: true, glass: true })).toBe(
      BROWSER_FRAME_GLASS_PRIVATE_ARGB,
    );
    expect(sidebarHoverCardArgb({ isPrivate: false, glass: true })).toBe(
      SIDEBAR_HOVER_GLASS_ARGB,
    );
    expect(sidebarHoverCardArgb({ isPrivate: true, glass: true })).toBe(
      SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
    );
    // Light appearance: a heavier wash over the pale material, for the white chrome text.
    expect(
      browserFrameGroundArgb({ isPrivate: false, glass: true, dark: false }),
    ).toBe(BROWSER_FRAME_GLASS_LIGHT_ARGB);
    expect(
      browserFrameGroundArgb({ isPrivate: true, glass: true, dark: false }),
    ).toBe(BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB);
    expect(
      browserFrameGroundArgb({ isPrivate: false, glass: false, dark: false }),
    ).toBe(BROWSER_FRAME_SURFACE_ARGB);
    const alpha = (argb: string) => parseInt(argb.slice(1, 3), 16);
    // The dark frame wash is light, so the vibrancy reads as glass and not a flat #1B1D21 (a
    // 0.55 wash over the dark sidebar material did); the hover card over the page is denser.
    for (const glass of [
      BROWSER_FRAME_GLASS_ARGB,
      BROWSER_FRAME_GLASS_PRIVATE_ARGB,
    ])
      expect(alpha(glass)).toBeLessThanOrEqual(0x4d);
    for (const glass of [
      BROWSER_FRAME_GLASS_LIGHT_ARGB,
      BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB,
      SIDEBAR_HOVER_GLASS_ARGB,
      SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
    ]) {
      expect(alpha(glass)).toBeGreaterThan(0x80);
      expect(alpha(glass)).toBeLessThan(0xff);
    }
    expect(BROWSER_FRAME_GLASS_PRIVATE_ARGB.slice(3)).toBe(
      BROWSER_FRAME_SURFACE_PRIVATE_ARGB.slice(3),
    );
    expect(SIDEBAR_HOVER_GLASS_ARGB.slice(3)).toBe(
      BROWSER_FRAME_SURFACE_ARGB.slice(3),
    );
    const vars = sidebarCardCssVars();
    expect(vars["--frame-glass"]).toBe("rgba(18, 21, 25, 0.2)");
    expect(vars["--frame-glass-light"]).toBe("rgba(18, 21, 25, 0.702)");
    expect(vars["--sidebar-hover-glass"]).toBe("rgba(25, 27, 31, 0.749)");
  });

  test("the opaque native hover surface is full-strength on its first visible frame", () => {
    for (const progress of [0, 0.01, 0.5, 1, 1.4])
      expect(sidebarNativeLayerPaint(progress)).toEqual({ alpha: 1, blur: 0 });
  });

  test("the glass hover material has full tint and blur before the first reveal frame", () => {
    for (const progress of [0, 0.01, 0.5, 1])
      expect(sidebarNativeLayerPaint(progress, { glass: true })).toEqual({
        alpha: 1,
        blur: SIDEBAR_HOVER_GLASS_BLUR,
      });
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
