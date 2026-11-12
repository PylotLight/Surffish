import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BROWSER_FRAME_GLASS_ARGB,
  BROWSER_FRAME_GLASS_LIGHT_ARGB,
  BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB,
  BROWSER_FRAME_GLASS_PRIVATE_ARGB,
  BROWSER_FRAME_SURFACE_ARGB,
  BROWSER_FRAME_SURFACE_PRIVATE_ARGB,
  FRAME_TRANSPARENCY_DEFAULT,
  SIDEBAR_FLOAT,
  SIDEBAR_HOVER_GLASS_ARGB,
  SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
  argbToCss,
  browserFrameGroundArgb,
  frameGlassCssVars,
  frameGlassTintArgb,
  frameGlassTints,
  frameTransparencyAllowsGlass,
  normalizeFrameTransparency,
  sidebarCardCssVars,
  sidebarHoverCardArgb,
  sidebarCardInset,
  sidebarCardMaxWidth,
  sidebarCardRect,
  sidebarFloatCardRect,
  sidebarFloatShadowRects,
} from "./sidebar-card";

describe("sidebar card geometry", () => {
  test("card rect: attached to the top and bottom, capped by the window gutter", () => {
    expect(
      sidebarCardRect({
        windowWidth: 1280,
        windowHeight: 800,
        sidebarWidth: 320,
      }),
    ).toEqual({ x: 0, y: 0, width: 320, height: 800 });
    expect(
      sidebarCardRect({
        windowWidth: 300,
        windowHeight: 800,
        sidebarWidth: 320,
      }),
    ).toEqual({ x: 0, y: 0, width: 252, height: 800 });
    expect(sidebarCardMaxWidth(20)).toBe(0);
  });

  test("small windows keep the full-height card attached", () => {
    expect(sidebarCardInset(800)).toBe(0);
    expect(sidebarCardInset(30)).toBe(0);
    expect(sidebarCardInset(-5)).toBe(0);
  });

  test("css vars carry every number", () => {
    const vars = sidebarCardCssVars();
    expect(vars["--sidebar-card-inset"]).toBe("0px");
    expect(vars["--sidebar-card-radius"]).toBe("0px");
    expect(vars["--sidebar-rail-width"]).toBe("84px");
    expect(vars["--sidebar-card-gutter"]).toBe("48px");
    expect(vars["--sidebar-card-border-width"]).toBe("0px");
    expect(vars["--sidebar-controls-left"]).toBe("16px");
    expect(vars["--sidebar-controls-top"]).toBe("18px");
    // Inset shadows only: an outer one would be cut off at the overlay view's edge.
    expect(
      (vars["--sidebar-card-shadow"] ?? "")
        .split(/,(?![^(]*\))/)
        .every((shadow) => shadow.trim().startsWith("inset")),
    ).toBe(true);
  });
});

describe("floating hover card", () => {
  test("a small gap off the toolbar line and the window's left and bottom edges, rounded", () => {
    expect(SIDEBAR_FLOAT.gap).toBeGreaterThanOrEqual(4);
    expect(SIDEBAR_FLOAT.gap).toBeLessThanOrEqual(8);
    expect(SIDEBAR_FLOAT.radius).toBeGreaterThanOrEqual(10);
    expect(SIDEBAR_FLOAT.radius).toBeLessThanOrEqual(12);
    // The overlay view: from the toolbar's line (50) to the bottom, one gap wider than the sidebar.
    const view = { x: 0, y: 50, width: 326, height: 750 };
    expect(sidebarFloatCardRect(view)).toEqual({
      x: 6,
      y: 56,
      width: 320,
      height: 738,
    });
    expect(sidebarFloatCardRect({ x: 0, y: 0, width: 4, height: 8 })).toEqual({
      x: 6,
      y: 6,
      width: 0,
      height: 0,
    });
    const vars = sidebarCardCssVars();
    expect(vars["--sidebar-float-gap"]).toBe("6px");
    expect(vars["--sidebar-float-radius"]).toBe("12px");
  });

  test("the shadow sits down and right of the card, never in its top or left gap", () => {
    const card = { x: 6, y: 56, width: 320, height: 738 };
    const layers = sidebarFloatShadowRects(card);
    expect(layers.length).toBeGreaterThanOrEqual(3);
    let previousSpread = 0;
    for (const layer of layers) {
      expect(layer.x).toBe(card.x);
      expect(layer.y).toBeGreaterThan(card.y);
      const spread = layer.x + layer.width - (card.x + card.width);
      expect(spread).toBeGreaterThan(previousSpread);
      previousSpread = spread;
      expect(layer.y + layer.height).toBeGreaterThan(card.y + card.height);
      expect(layer.radius).toBeGreaterThan(SIDEBAR_FLOAT.radius);
      expect(layer.alpha).toBeGreaterThan(0);
      expect(layer.alpha).toBeLessThanOrEqual(0.12);
    }
    // Faintest at the outside.
    expect(layers.at(-1)!.alpha).toBeLessThan(layers[0]!.alpha);
    expect(sidebarFloatShadowRects({ ...card, width: 0 })).toEqual([]);
  });
});

// Drift guard: rules that style the card itself (not its children) must take geometry from the vars.
describe("sidebar css uses the shared card geometry", () => {
  const views = join(import.meta.dir, "../renderer/src/views");
  const files = ["Browser.css", "SidebarBackdrop.css", "spaces/spaces.css"];
  const geometry = [
    "top",
    "bottom",
    "left",
    "border",
    "border-width",
    "border-color",
    "border-radius",
    "box-shadow",
    "margin",
    "margin-top",
    "inset",
  ];
  for (const file of files) {
    test(file, () => {
      const css = readFileSync(join(views, file), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectorText = (match[1] ?? "").trim();
        const selectors = selectorText
          .split(",")
          .map((selector) => selector.trim());
        if (
          !selectors.some((selector) =>
            /\.browser-sidebar(\.[\w-]+)*$/.test(selector),
          )
        )
          continue;
        for (const declaration of (match[2] ?? "").split(";")) {
          const [property, ...rest] = declaration.split(":");
          const name = property?.trim();
          const value = rest.join(":").trim();
          if (!name || !geometry.includes(name)) continue;
          if (name === "left" && value === "0") continue;
          expect({ selector: selectorText, [name]: value }).toEqual({
            selector: selectorText,
            [name]: expect.stringContaining("var(--sidebar-"),
          });
        }
      }
    });
  }
});

const alphaOf = (argb: string): number => parseInt(argb.slice(1, 3), 16) / 255;

describe("frame transparency", () => {
  test("normalizes junk, clamps to 0..100 and rounds", () => {
    expect(FRAME_TRANSPARENCY_DEFAULT).toBe(80);
    expect(normalizeFrameTransparency(undefined)).toBe(80);
    expect(normalizeFrameTransparency("50")).toBe(80);
    expect(normalizeFrameTransparency(Number.NaN)).toBe(80);
    expect(normalizeFrameTransparency(-20)).toBe(0);
    expect(normalizeFrameTransparency(140)).toBe(100);
    expect(normalizeFrameTransparency(33.6)).toBe(34);
    expect(frameTransparencyAllowsGlass(0)).toBe(false);
    expect(frameTransparencyAllowsGlass(1)).toBe(true);
  });

  test("the default reproduces today's tints byte for byte", () => {
    expect(frameGlassTints(FRAME_TRANSPARENCY_DEFAULT)).toEqual({
      dark: BROWSER_FRAME_GLASS_ARGB,
      darkPrivate: BROWSER_FRAME_GLASS_PRIVATE_ARGB,
      light: BROWSER_FRAME_GLASS_LIGHT_ARGB,
      lightPrivate: BROWSER_FRAME_GLASS_LIGHT_PRIVATE_ARGB,
      hover: SIDEBAR_HOVER_GLASS_ARGB,
      hoverPrivate: SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
    });
    expect(alphaOf(frameGlassTints(80).dark)).toBeCloseTo(0.2, 2);
    expect(alphaOf(frameGlassTints(80).hover)).toBeCloseTo(0.75, 2);
    // The ground and hover helpers default to it too.
    expect(browserFrameGroundArgb({ isPrivate: false, glass: true })).toBe(
      BROWSER_FRAME_GLASS_ARGB,
    );
    expect(sidebarHoverCardArgb({ isPrivate: true, glass: true })).toBe(
      SIDEBAR_HOVER_GLASS_PRIVATE_ARGB,
    );
  });

  test("0% is the opaque surface (the Linux fallback), 100% the clearest glass", () => {
    const solid = frameGlassTints(0);
    expect(solid.dark).toBe(BROWSER_FRAME_SURFACE_ARGB);
    expect(solid.light).toBe(BROWSER_FRAME_SURFACE_ARGB);
    expect(solid.hover).toBe(BROWSER_FRAME_SURFACE_ARGB);
    expect(solid.darkPrivate).toBe(BROWSER_FRAME_SURFACE_PRIVATE_ARGB);
    expect(solid.hoverPrivate).toBe(BROWSER_FRAME_SURFACE_PRIVATE_ARGB);
    expect(
      browserFrameGroundArgb({
        isPrivate: false,
        glass: true,
        transparency: 0,
      }),
    ).toBe(BROWSER_FRAME_SURFACE_ARGB);
    expect(
      sidebarHoverCardArgb({ isPrivate: true, glass: true, transparency: 0 }),
    ).toBe(BROWSER_FRAME_SURFACE_PRIVATE_ARGB);

    const clearest = frameGlassTints(100);
    expect(alphaOf(clearest.dark)).toBeCloseTo(0.05, 2);
    expect(clearest.dark.slice(3)).toBe(BROWSER_FRAME_GLASS_ARGB.slice(3));
    // Light and private scale by the same factor (a quarter of their default alpha).
    expect(alphaOf(clearest.light)).toBeCloseTo(0.7 * 0.25, 2);
    expect(alphaOf(clearest.darkPrivate)).toBeCloseTo(0.3 * 0.25, 2);
    expect(alphaOf(clearest.hover)).toBeCloseTo(0.75 * 0.6, 2);
  });

  test("dark frame alpha is 1 - 0.01 t up to the default, then eases to 0.05", () => {
    for (const t of [0, 10, 25, 50, 60, 79, 80])
      expect(alphaOf(frameGlassTints(t).dark)).toBeCloseTo(1 - 0.01 * t, 2);
    expect(alphaOf(frameGlassTints(90).dark)).toBeCloseTo(0.125, 2);
  });

  test("every tint gets clearer as the slider rises, and the hover card stays denser than its frame", () => {
    let previous = frameGlassTints(0);
    for (let t = 1; t <= 100; t++) {
      const tints = frameGlassTints(t);
      for (const key of Object.keys(tints) as (keyof typeof tints)[])
        expect(alphaOf(tints[key])).toBeLessThanOrEqual(alphaOf(previous[key]));
      expect(alphaOf(tints.hover)).toBeGreaterThanOrEqual(
        Math.max(alphaOf(tints.dark), alphaOf(tints.light)),
      );
      expect(alphaOf(tints.hoverPrivate)).toBeGreaterThanOrEqual(
        Math.max(alphaOf(tints.darkPrivate), alphaOf(tints.lightPrivate)),
      );
      previous = tints;
    }
  });

  test("without glass the setting changes nothing", () => {
    for (const transparency of [0, 50, 100])
      expect(
        browserFrameGroundArgb({
          isPrivate: false,
          glass: false,
          transparency,
        }),
      ).toBe(BROWSER_FRAME_SURFACE_ARGB);
  });

  test("tint helper keeps the colour above the default and mixes from the surface below it", () => {
    expect(frameGlassTintArgb("#80102030", "#FF000000", 40)).toBe("#C0081018");
    expect(frameGlassTintArgb("#80102030", "#FF000000", 100, 0.5)).toBe(
      "#40102030",
    );
  });

  test("CSS vars carry the mapped tints", () => {
    expect(frameGlassCssVars()["--frame-glass"]).toBe(
      argbToCss(BROWSER_FRAME_GLASS_ARGB),
    );
    expect(sidebarCardCssVars()["--frame-glass"]).toBe(
      frameGlassCssVars()["--frame-glass"],
    );
    expect(frameGlassCssVars(0)["--frame-glass"]).toBe("rgb(25, 27, 31)");
    expect(frameGlassCssVars(100)["--frame-glass"]).toBe(
      "rgba(18, 21, 25, 0.051)",
    );
  });
});
