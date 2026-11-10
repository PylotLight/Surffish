import { describe, expect, test } from "bun:test";
import {
  initialPageViewBounds,
  insetPageArea,
  pageRailInset,
  pageViewBounds,
} from "./page-view-bounds";

const area = { x: 0, y: 50, width: 1200, height: 750 };
const pane = { x: 600, y: 50, width: 600, height: 750 };

describe("page view bounds", () => {
  test("on screen: its own rect (a copy)", () => {
    expect(pageViewBounds(true, pane)).toEqual(pane);
    expect(pageViewBounds(true, area)).not.toBe(area);
  });

  test("off screen: left alone (never shrunk to 0x0, so showing it again is not a 0 -> full resize)", () => {
    expect(pageViewBounds(false, area)).toBeNull();
  });

  test("new views start at the page area when it is known", () => {
    expect(initialPageViewBounds(area)).toEqual(area);
    expect(initialPageViewBounds({ x: 0, y: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(initialPageViewBounds(null)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(
      initialPageViewBounds({ x: 0, y: 0, width: Number.NaN, height: 10 }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("pageRailInset", () => {
  const base = {
    overlayMode: true,
    sidebarMode: "tabs",
    sidebarPinned: false,
    railWidth: 84,
  };
  test("the auto-hiding sidebar's rail insets the page", () => {
    expect(pageRailInset(base)).toBe(84);
    expect(pageRailInset({ ...base, sidebarMode: "history" })).toBe(84);
  });
  test("pinned open, a full panel, no overlay or no rail: no inset", () => {
    expect(pageRailInset({ ...base, sidebarPinned: true })).toBe(0);
    expect(pageRailInset({ ...base, sidebarMode: "settings" })).toBe(0);
    expect(pageRailInset({ ...base, overlayMode: false })).toBe(0);
    expect(pageRailInset({ ...base, railWidth: 0 })).toBe(0);
  });
});

describe("insetPageArea", () => {
  test("moves the left edge to the inset and keeps the right edge", () => {
    expect(
      insetPageArea({ x: 0, y: 50, width: 1000, height: 600 }, 84),
    ).toEqual({ x: 84, y: 50, width: 916, height: 600 });
  });
  test("idempotent: a rect already beside the rail is unchanged", () => {
    const rect = { x: 84, y: 50, width: 916, height: 600 };
    expect(insetPageArea(rect, 84)).toEqual(rect);
    expect(insetPageArea(insetPageArea(rect, 84), 84)).toEqual(rect);
  });
  test("no inset, or a hidden page area, is left alone", () => {
    const rect = { x: 0, y: 0, width: 500, height: 400 };
    expect(insetPageArea(rect, 0)).toEqual(rect);
    const hidden = { x: 0, y: 0, width: 0, height: 0 };
    expect(insetPageArea(hidden, 84)).toEqual(hidden);
    expect(insetPageArea({ x: 0, y: 0, width: 50, height: 10 }, 84).width).toBe(
      0,
    );
  });
});
