import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SIDEBAR_FLOAT,
  sidebarCardCssVars,
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
