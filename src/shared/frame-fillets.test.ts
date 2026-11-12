import { describe, expect, test } from "bun:test";
import {
  argbBytes,
  filletCoverage,
  filletRgba,
  hoverPanelFilletRects,
  hoverPanelIsOpaqueFrame,
} from "./frame-fillets";
import {
  BROWSER_FRAME_SURFACE_ARGB,
  BROWSER_FRAME_SURFACE_PRIVATE_ARGB,
  PAGE_FRAME_RADIUS,
} from "./sidebar-card";

const card = { x: 90, y: 56, width: 1100, height: 738 };
const panel = (width: number) => ({ x: 0, y: 50, width, height: 750 });

describe("hover panel paint selection", () => {
  test("solid paints the opaque frame surface for the whole slide", () => {
    for (const progress of [0.05, 0.5, 1])
      expect(
        hoverPanelIsOpaqueFrame({
          mode: "solid",
          docked: false,
          visible: true,
          progress,
        }),
      ).toBe(true);
  });

  test("native is opaque only once its open fade has finished", () => {
    const at = (progress: number) =>
      hoverPanelIsOpaqueFrame({
        mode: "native",
        docked: false,
        visible: true,
        progress,
      });
    expect(at(0.4)).toBe(false);
    expect(at(0.99)).toBe(false);
    expect(at(1)).toBe(true);
  });

  test("snapshot, docked, hidden and closed panels never get fillets", () => {
    expect(
      hoverPanelIsOpaqueFrame({
        mode: "snapshot",
        docked: false,
        visible: true,
        progress: 1,
      }),
    ).toBe(false);
    expect(
      hoverPanelIsOpaqueFrame({
        mode: "native",
        docked: true,
        visible: true,
        progress: 1,
      }),
    ).toBe(false);
    expect(
      hoverPanelIsOpaqueFrame({
        mode: "solid",
        docked: false,
        visible: false,
        progress: 1,
      }),
    ).toBe(false);
    expect(
      hoverPanelIsOpaqueFrame({
        mode: "solid",
        docked: false,
        visible: true,
        progress: 0,
      }),
    ).toBe(false);
  });
});

describe("hover panel fillet geometry", () => {
  test("an open panel gets a fillet at its right edge on the card's top and bottom lines", () => {
    expect(
      hoverPanelFilletRects({ panel: panel(320), card, radius: 10 }),
    ).toEqual({
      top: { x: 320, y: 56, width: 10, height: 10 },
      bottom: { x: 320, y: 56 + 738 - 10, width: 10, height: 10 },
    });
  });

  test("the rail (edge beside the card) and a panel still inside the card's own corner get none", () => {
    expect(
      hoverPanelFilletRects({ panel: panel(84), card, radius: 10 }),
    ).toBeNull();
    expect(
      hoverPanelFilletRects({ panel: panel(95), card, radius: 10 }),
    ).toBeNull();
    expect(
      hoverPanelFilletRects({ panel: panel(100), card, radius: 10 }),
    ).not.toBeNull();
  });

  test("no card, a panel past the card's right side, or a tiny card: none", () => {
    expect(
      hoverPanelFilletRects({ panel: panel(320), card: null, radius: 10 }),
    ).toBeNull();
    expect(
      hoverPanelFilletRects({ panel: panel(1185), card, radius: 10 }),
    ).toBeNull();
    expect(
      hoverPanelFilletRects({
        panel: panel(320),
        card: { x: 90, y: 56, width: 400, height: 15 },
        radius: 10,
      }),
    ).toBeNull();
  });

  test("a panel that starts below the card top only rounds the bottom", () => {
    expect(
      hoverPanelFilletRects({
        panel: { x: 0, y: 80, width: 320, height: 720 },
        card,
        radius: 10,
      }),
    ).toEqual({
      top: null,
      bottom: { x: 320, y: 784, width: 10, height: 10 },
    });
  });
});

describe("fillet bitmap", () => {
  test("frame outside the arc, page inside it", () => {
    const size = PAGE_FRAME_RADIUS;
    // Top fillet: the outer corner (top-left) is frame, the inner corner (bottom-right) is page.
    expect(filletCoverage(0, 0, size, "top")).toBe(1);
    expect(filletCoverage(size - 1, size - 1, size, "top")).toBe(0);
    // Bottom fillet is the mirror image: frame at bottom-left, page at top-right.
    expect(filletCoverage(0, size - 1, size, "bottom")).toBe(1);
    expect(filletCoverage(size - 1, 0, size, "bottom")).toBe(0);
    // The arc's edge is anti-aliased.
    const edge = filletCoverage(3, 2, size, "top");
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
  });

  test("painted in the window's frame surface colour, private included", () => {
    expect(argbBytes(BROWSER_FRAME_SURFACE_ARGB)).toEqual([25, 27, 31, 255]);
    expect(argbBytes(BROWSER_FRAME_SURFACE_PRIVATE_ARGB)).toEqual([
      30, 26, 40, 255,
    ]);
    const pixels = filletRgba(20, BROWSER_FRAME_SURFACE_ARGB, "top");
    expect([...pixels.subarray(0, 4)]).toEqual([25, 27, 31, 255]);
    const last = (20 * 20 - 1) * 4;
    expect(pixels[last + 3]).toBe(0);
  });
});
