import { describe, expect, test } from "bun:test";
import {
  captureBand,
  clampScrollRange,
  maxCaptureCssHeight,
  scrollEndAt,
  scrollingBarBounds,
  scrollingClip,
  scrollingStitchPlan,
  sliceRowsInPixels,
  stitchSlice,
  stitchTargetScroll,
} from "./screenshot-scrolling";

describe("size limit", () => {
  test("maxCaptureCssHeight divides the bitmap limit by the pixel ratio", () => {
    expect(maxCaptureCssHeight(1)).toBe(16_384);
    expect(maxCaptureCssHeight(2)).toBe(8_192);
    expect(maxCaptureCssHeight(1.5)).toBe(10_922);
    expect(maxCaptureCssHeight(Number.NaN)).toBe(16_384);
    expect(maxCaptureCssHeight(0)).toBe(16_384);
  });

  test("clampScrollRange keeps whole rows and flags the cut", () => {
    expect(clampScrollRange(100.6, 900.2, 8192)).toEqual({
      start: 100,
      end: 901,
      truncated: false,
    });
    expect(clampScrollRange(500, 20_000, 8192)).toEqual({
      start: 500,
      end: 8692,
      truncated: true,
    });
  });

  test("scrolling back above the start still gives one row", () => {
    expect(clampScrollRange(500, 200, 8192)).toEqual({
      start: 500,
      end: 501,
      truncated: false,
    });
    expect(clampScrollRange(-40, Number.NaN, 8192)).toEqual({
      start: 0,
      end: 1,
      truncated: false,
    });
  });
});

describe("scrollEndAt", () => {
  test("defaults to the bottom of the visible box", () => {
    expect(scrollEndAt(1200, 0, 800)).toBe(2000);
    // An inner scroller whose box starts 60px down the viewport.
    expect(scrollEndAt(300, 60, 760)).toBe(1000);
  });

  test("a click marks the end at that row, clamped into the box", () => {
    expect(scrollEndAt(1200, 0, 800, 350)).toBe(1550);
    expect(scrollEndAt(300, 60, 760, 20)).toBe(300);
    expect(scrollEndAt(300, 60, 760, 9999)).toBe(1000);
  });
});

describe("scrollingClip", () => {
  test("document coordinates with the horizontal band and scroll", () => {
    expect(
      scrollingClip({ start: 400, end: 3400 }, { x: 0, width: 1280 }, 0, 2),
    ).toEqual({
      clip: { x: 0, y: 400, width: 1280, height: 3000, scale: 1 },
      truncated: false,
    });
    expect(
      scrollingClip({ start: 0, end: 500 }, { x: 100.4, width: 200.2 }, 50, 1)
        ?.clip,
    ).toEqual({ x: 150, y: 0, width: 201, height: 500, scale: 1 });
  });

  test("caps the height at the bitmap limit for the pixel ratio", () => {
    const plan = scrollingClip(
      { start: 1000, end: 50_000 },
      { x: 0, width: 1280 },
      0,
      2,
    );
    expect(plan?.clip.height).toBe(8192);
    expect(plan?.truncated).toBe(true);
  });

  test("empty band gives null", () => {
    expect(
      scrollingClip({ start: 0, end: 100 }, { x: 10, width: 0 }, 0, 1),
    ).toBeNull();
  });
});

describe("stitching", () => {
  test("stitchTargetScroll stops at the end of the scroller", () => {
    expect(stitchTargetScroll(1200, 5000)).toBe(1200);
    expect(stitchTargetScroll(4800, 4200)).toBe(4200);
    expect(stitchTargetScroll(-5, 4200)).toBe(0);
  });

  test("stitchSlice keeps only rows not captured yet", () => {
    expect(stitchSlice(1000, 5000, 1000, 800)).toEqual({
      cropTop: 0,
      height: 800,
    });
    // Clamped at the bottom: the target rows sit lower in the box.
    expect(stitchSlice(4600, 5000, 4200, 800)).toEqual({
      cropTop: 400,
      height: 400,
    });
    // Last slice shorter than the box.
    expect(stitchSlice(1000, 1300, 1000, 800)).toEqual({
      cropTop: 0,
      height: 300,
    });
  });

  test("stitchSlice refuses gaps: overshoot or a scroller that did not move", () => {
    expect(stitchSlice(1000, 5000, 1040, 800)).toBeNull();
    expect(stitchSlice(1800, 5000, 1000, 800)).toBeNull();
    expect(stitchSlice(1000, 1000, 1000, 800)).toBeNull();
    expect(stitchSlice(0, 100, 0, 0)).toBeNull();
  });

  test("plan from a mid-page start to a mid-page end", () => {
    expect(scrollingStitchPlan({ start: 300, end: 2100 }, 800, 10_000)).toEqual(
      [
        { scrollTop: 300, cropTop: 0, height: 800 },
        { scrollTop: 1100, cropTop: 0, height: 800 },
        { scrollTop: 1900, cropTop: 0, height: 200 },
      ],
    );
  });

  test("plan that runs into the bottom of the scroller overlaps the last frame", () => {
    // Content 2500 tall in an 800 box: maxScroll 1700.
    expect(scrollingStitchPlan({ start: 0, end: 2500 }, 800, 1700)).toEqual([
      { scrollTop: 0, cropTop: 0, height: 800 },
      { scrollTop: 800, cropTop: 0, height: 800 },
      { scrollTop: 1600, cropTop: 0, height: 800 },
      { scrollTop: 1700, cropTop: 700, height: 100 },
    ]);
  });

  test("plan heights always add up to the range", () => {
    for (const [start, end, box, max] of [
      [0, 1, 800, 0],
      [123, 9876, 777, 9100],
      [50, 700, 1000, 0],
      [0, 16_384, 913, 20_000],
    ] as const) {
      const steps = scrollingStitchPlan({ start, end }, box, max);
      expect(steps.reduce((sum, step) => sum + step.height, 0)).toBe(
        end - start,
      );
      for (const step of steps)
        expect(step.cropTop + step.height).toBeLessThanOrEqual(box);
    }
  });

  test("rows past the end of the content are never planned", () => {
    // 1000 + 800 is the bottom of the content; the plan stops there.
    expect(
      scrollingStitchPlan({ start: 0, end: 2400 }, 800, 1000).reduce(
        (sum, step) => sum + step.height,
        0,
      ),
    ).toBe(1800);
  });

  test("a range that starts below the end of the scroller cannot be stitched", () => {
    expect(scrollingStitchPlan({ start: 2000, end: 2400 }, 800, 1000)).toEqual(
      [],
    );
  });

  test("sliceRowsInPixels offsets by the box and scales to the bitmap", () => {
    expect(
      sliceRowsInPixels(0, { cropTop: 400, height: 400 }, 800, 1600),
    ).toEqual({ top: 800, height: 800 });
    expect(
      sliceRowsInPixels(60, { cropTop: 0, height: 700 }, 800, 1600),
    ).toEqual({ top: 120, height: 1400 });
  });

  test("sliceRowsInPixels at a fractional ratio leaves no gap between consecutive slices", () => {
    // 1.25x: a 100px-tall box split 37 / 63 maps to rows that meet exactly.
    const a = sliceRowsInPixels(10, { cropTop: 0, height: 37 }, 100, 125);
    const b = sliceRowsInPixels(10, { cropTop: 37, height: 63 }, 100, 125);
    expect(a.top + a.height).toBe(b.top);
    expect(
      sliceRowsInPixels(0, { cropTop: 700, height: 400 }, 800, 1600),
    ).toEqual({ top: 1400, height: 200 });
  });
});

describe("captureBand", () => {
  test("whole box without a region; intersection with one", () => {
    expect(captureBand({ x: 240, width: 800 }, null)).toEqual({
      x: 240,
      width: 800,
    });
    expect(captureBand({ x: 240, width: 800 }, { x: 100, width: 400 })).toEqual(
      { x: 240, width: 260 },
    );
    expect(
      captureBand({ x: 240, width: 800 }, { x: 1100, width: 50 }),
    ).toBeNull();
  });
});

describe("scrollingBarBounds", () => {
  test("centred at the top of the page area, shrunk to fit", () => {
    expect(
      scrollingBarBounds(
        { x: 200, y: 60, width: 1000, height: 700 },
        { width: 560, height: 52 },
      ),
    ).toEqual({ x: 420, y: 72, width: 560, height: 52 });
    expect(
      scrollingBarBounds(
        { x: 0, y: 0, width: 300, height: 700 },
        { width: 560, height: 52 },
      ),
    ).toEqual({ x: 12, y: 12, width: 276, height: 52 });
  });
});
