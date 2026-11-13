import { describe, expect, test } from "bun:test";
import {
  initialPageViewBounds,
  framePageArea,
  pageFrameLeft,
  pageSlideOffset,
  pageViewBounds,
  normalizeSidebarPushStyle,
  pushedPageRect,
  pushViewRect,
  slideViewRect,
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

describe("pageFrameLeft", () => {
  const base = {
    overlayMode: true,
    fullscreen: false,
    sidebarMode: "tabs",
    sidebarPinned: false,
    sidebarWidth: 300,
    railWidth: 84,
  };
  test("the auto-hiding sidebar's rail is the frame's left side", () => {
    expect(pageFrameLeft(base)).toBe(84);
    expect(pageFrameLeft({ ...base, sidebarMode: "history" })).toBe(84);
  });
  test("docked open, the panel is: the card sits beside it", () => {
    expect(pageFrameLeft({ ...base, sidebarPinned: true })).toBe(300);
    expect(
      pageFrameLeft({ ...base, sidebarPinned: true, sidebarMode: "history" }),
    ).toBe(300);
  });
  test("no rail, or another panel: the frame starts at the window edge", () => {
    expect(pageFrameLeft({ ...base, railWidth: 0 })).toBe(0);
    expect(pageFrameLeft({ ...base, sidebarMode: "settings" })).toBe(0);
  });
  test("in-page shapes and native fullscreen have no frame", () => {
    expect(pageFrameLeft({ ...base, overlayMode: false })).toBeNull();
    expect(pageFrameLeft({ ...base, fullscreen: true })).toBeNull();
  });
});

describe("framePageArea", () => {
  const area = { x: 0, y: 50, width: 1000, height: 650 };
  test("the card keeps the gap from the rail, the toolbar and the window edges", () => {
    expect(framePageArea(area, 84, 6)).toEqual({
      x: 90,
      y: 56,
      width: 904,
      height: 638,
    });
  });
  test("every side gets the same gap", () => {
    const card = framePageArea(area, 300, 6);
    expect(card.x - 300).toBe(6);
    expect(card.y - area.y).toBe(6);
    expect(area.x + area.width - (card.x + card.width)).toBe(6);
    expect(area.y + area.height - (card.y + card.height)).toBe(6);
  });
  test("a frame starting at the window edge still insets the card", () => {
    expect(framePageArea(area, 0, 6).x).toBe(6);
  });
  test("an area already right of the frame keeps its own left edge", () => {
    expect(framePageArea({ ...area, x: 120, width: 880 }, 84, 6).x).toBe(126);
  });
  test("no frame, or a hidden page area, is left alone", () => {
    expect(framePageArea(area, null)).toEqual(area);
    const hidden = { x: 0, y: 0, width: 0, height: 0 };
    expect(framePageArea(hidden, 84)).toEqual(hidden);
    expect(framePageArea({ x: 0, y: 0, width: 50, height: 10 }, 84).width).toBe(
      0,
    );
  });
});

describe("pushed page card", () => {
  test("slides by the panel's visible right edge past the rail, never left of it", () => {
    expect(
      pageSlideOffset({ pushing: true, panelRight: 320, frameLeft: 84 }),
    ).toBe(236);
    expect(
      pageSlideOffset({ pushing: true, panelRight: 84, frameLeft: 84 }),
    ).toBe(0);
    expect(
      pageSlideOffset({ pushing: true, panelRight: 60.4, frameLeft: 84 }),
    ).toBe(0);
    expect(
      pageSlideOffset({ pushing: true, panelRight: 200.6, frameLeft: 84 }),
    ).toBe(117);
  });

  test("nothing when not pushing or there is no frame", () => {
    expect(
      pageSlideOffset({ pushing: false, panelRight: 320, frameLeft: 84 }),
    ).toBe(0);
    expect(
      pageSlideOffset({ pushing: true, panelRight: 320, frameLeft: null }),
    ).toBe(0);
  });

  test("pushes the card's left edge and keeps its right edge", () => {
    const card = { x: 90, y: 56, width: 1104, height: 738 };
    expect(pushViewRect(card, 236)).toEqual({ ...card, x: 326, width: 868 });
    expect(pushViewRect(card, 0)).toEqual(card);
    expect(pushViewRect(card, 0)).not.toBe(card);
    expect(pushViewRect(card, 2000)).toEqual({ ...card, x: 1194, width: 0 });
  });
  test("slides the card without resizing it (the 'slide' style)", () => {
    const card = { x: 90, y: 56, width: 1104, height: 738 };
    expect(slideViewRect(card, 236)).toEqual({ ...card, x: 326 });
    expect(pushedPageRect(card, 236, "slide")).toEqual({ ...card, x: 326 });
    expect(pushedPageRect(card, 236, "resize")).toEqual({
      ...card,
      x: 326,
      width: 868,
    });
  });

  test("normalizes the push style, defaulting to resize", () => {
    expect(normalizeSidebarPushStyle("slide")).toBe("slide");
    expect(normalizeSidebarPushStyle("resize")).toBe("resize");
    expect(normalizeSidebarPushStyle("bounce")).toBe("resize");
    expect(normalizeSidebarPushStyle(undefined)).toBe("resize");
  });
});
