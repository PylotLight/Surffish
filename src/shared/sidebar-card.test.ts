import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SIDEBAR_CARD_INSET, SIDEBAR_CARD_RADIUS } from "./sidebar-backdrop";
import {
  SIDEBAR_CARD,
  sidebarCardCssVars,
  sidebarCardInset,
  sidebarCardMaxWidth,
  sidebarCardRect,
} from "./sidebar-card";

describe("sidebar card geometry", () => {
  test("the native-blur frame uses the card numbers", () => {
    expect(SIDEBAR_CARD_INSET).toBe(SIDEBAR_CARD.inset);
    expect(SIDEBAR_CARD_RADIUS).toBe(SIDEBAR_CARD.radius);
  });

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
    expect(vars["--sidebar-card-radius"]).toBe("28px");
    expect(vars["--sidebar-card-gutter"]).toBe("48px");
    expect(vars["--sidebar-card-border-width"]).toBe("1px");
    expect(vars["--sidebar-controls-left"]).toBe("16px");
    expect(vars["--sidebar-controls-top"]).toBe("16px");
    // Inset shadows only: an outer one would be cut off at the overlay view's edge.
    expect(
      (vars["--sidebar-card-shadow"] ?? "")
        .split(/,(?![^(]*\))/)
        .every((shadow) => shadow.trim().startsWith("inset")),
    ).toBe(true);
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
          // `top/bottom: 0` is how the framed view fills itself (main already inset the view).
          if (
            (name === "top" || name === "bottom") &&
            value === "0" &&
            selectors.every((selector) => selector.includes("is-view-framed"))
          )
            continue;
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
