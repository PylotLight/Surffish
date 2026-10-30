import { describe, expect, test } from "bun:test";
import {
  cubicBezier,
  parseSidebarMotionMode,
  scaleArgbAlpha,
  sidebarMotionAt,
  sidebarMotionCssVars,
  sidebarRevealWidth,
  sidebarSlideX,
  SIDEBAR_MOTION_MS,
  startSidebarMotion,
} from "./sidebar-motion";

describe("cubicBezier", () => {
  test("matches CSS endpoints and linear", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.25, 0.5, 0.75, 1])
      expect(linear(t)).toBeCloseTo(t, 4);
    const ease = cubicBezier(0.2, 0.8, 0.2, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(Number.NaN)).toBe(0);
  });

  test("the sidebar curve is front-loaded and monotonic", () => {
    const ease = cubicBezier(0.2, 0.8, 0.2, 1);
    expect(ease(0.25)).toBeGreaterThan(0.5);
    let previous = 0;
    for (let i = 1; i <= 100; i++) {
      const value = ease(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  test('CSS "ease" reference values', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });
});

describe("sidebar motion timeline", () => {
  test("a full open runs the whole duration and lands on 1", () => {
    const motion = startSidebarMotion(0, 1, 1000);
    expect(motion.durationMs).toBe(SIDEBAR_MOTION_MS);
    expect(sidebarMotionAt(motion, 1000)).toEqual({ progress: 0, done: false });
    const mid = sidebarMotionAt(motion, 1000 + SIDEBAR_MOTION_MS / 2);
    expect(mid.done).toBe(false);
    expect(mid.progress).toBeGreaterThan(0.5);
    expect(sidebarMotionAt(motion, 1000 + SIDEBAR_MOTION_MS)).toEqual({
      progress: 1,
      done: true,
    });
  });

  test("reversing mid-way starts where it is and takes only the remaining share", () => {
    const open = startSidebarMotion(0, 1, 0);
    const { progress } = sidebarMotionAt(open, 60);
    const close = startSidebarMotion(progress, 0, 60);
    expect(close.from).toBeCloseTo(progress, 6);
    expect(close.durationMs).toBe(Math.round(SIDEBAR_MOTION_MS * progress));
    // No jump on the first frame of the reversal.
    expect(sidebarMotionAt(close, 60).progress).toBeCloseTo(progress, 6);
    expect(sidebarMotionAt(close, 60 + close.durationMs)).toEqual({
      progress: 0,
      done: true,
    });
  });

  test("already there or reduced motion: done at once", () => {
    expect(sidebarMotionAt(startSidebarMotion(1, 1, 0), 0)).toEqual({
      progress: 1,
      done: true,
    });
    const reduced = startSidebarMotion(0, 1, 0, { reducedMotion: true });
    expect(reduced.durationMs).toBe(0);
    expect(sidebarMotionAt(reduced, 0)).toEqual({ progress: 1, done: true });
  });
});

describe("frames", () => {
  test("slide x moves by the hidden share of the width", () => {
    expect(sidebarSlideX(0, 320)).toBe(-320);
    expect(sidebarSlideX(1, 320)).toBe(0);
    expect(sidebarSlideX(0.5, 320)).toBe(-160);
    expect(sidebarSlideX(2, 320)).toBe(0);
    expect(sidebarSlideX(0.5, -10)).toBe(0);
  });

  test("reveal width grows from the rail to the full sidebar", () => {
    expect(sidebarRevealWidth(0, { railWidth: 76, width: 320 })).toBe(76);
    expect(sidebarRevealWidth(1, { railWidth: 76, width: 320 })).toBe(320);
    expect(sidebarRevealWidth(0.5, { railWidth: 76, width: 320 })).toBe(198);
    // Out of range progress clamps; a card narrower than the rail is the card.
    expect(sidebarRevealWidth(2, { railWidth: 76, width: 320 })).toBe(320);
    expect(sidebarRevealWidth(-1, { railWidth: 76, width: 320 })).toBe(76);
    expect(sidebarRevealWidth(0.5, { railWidth: 76, width: 60 })).toBe(60);
  });

  test("tint alpha scales with progress, colour untouched", () => {
    expect(scaleArgbAlpha("#C4131619", 1)).toBe("#C4131619");
    expect(scaleArgbAlpha("#C4131619", 0)).toBe("#00131619");
    expect(scaleArgbAlpha("#c4131619", 0.5)).toBe("#62131619");
    expect(scaleArgbAlpha("#131619", 0.5)).toBe("#131619");
    expect(scaleArgbAlpha("red", 0.5)).toBe("red");
  });

  test("css vars carry the same duration and curve", () => {
    expect(sidebarMotionCssVars()).toEqual({
      "--sidebar-motion-duration": `${SIDEBAR_MOTION_MS}ms`,
      "--sidebar-motion-easing": "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  });

  test("motion mode override", () => {
    expect(parseSidebarMotionMode(undefined)).toBe("stepped");
    expect(parseSidebarMotionMode(" Native ")).toBe("native");
    expect(parseSidebarMotionMode("off")).toBe("off");
    expect(parseSidebarMotionMode("bogus")).toBe("stepped");
  });
});
