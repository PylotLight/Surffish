/**
 * Pure math for the scrolling screenshot: the user marks a start line, scrolls (wheel, keys or
 * auto-scroll) and stops where the capture should end. Everything here is in CSS pixels of the
 * scroller's content (the document, or an inner scroll container) unless it says device pixels.
 * No Electron imports, so all of it is unit-testable.
 */

import { MAX_SCREENSHOT_SIDE_PX, type Rect, type Size } from "./screenshot";

export interface ScrollRange {
  /** First content row of the capture (CSS px from the top of the scroller's content). */
  start: number;
  /** One past the last content row. */
  end: number;
}

export interface ClampedRange extends ScrollRange {
  /** The user scrolled past the bitmap size limit and the capture stops there. */
  truncated: boolean;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function ratioOrOne(pixelRatio: number): number {
  return pixelRatio > 0 && Number.isFinite(pixelRatio) ? pixelRatio : 1;
}

/** Tallest capture, in CSS px, whose bitmap stays within `maxSidePx` at this device pixel ratio. */
export function maxCaptureCssHeight(
  pixelRatio: number,
  maxSidePx = MAX_SCREENSHOT_SIDE_PX,
): number {
  return Math.max(1, Math.floor(maxSidePx / ratioOrOne(pixelRatio)));
}

/**
 * Whole CSS rows from start to end. An end above the start (scrolled back up past it) still gives
 * at least one row; an end past the size limit is cut there and flagged.
 */
export function clampScrollRange(
  start: number,
  end: number,
  maxCssHeight: number,
): ClampedRange {
  const top = Math.max(0, Math.floor(finite(start)));
  const wanted = Math.max(top + 1, Math.ceil(finite(end, top + 1)));
  const limit = Math.max(1, Math.floor(finite(maxCssHeight, 1)));
  const bottom = Math.min(wanted, top + limit);
  return { start: top, end: bottom, truncated: bottom < wanted };
}

/**
 * Where the capture ends when the user stops: the bottom of the scroller's visible box, or the row
 * they clicked. `boxTop` / `boxBottom` are that box in viewport CSS px, `scrollTop` the scroller's
 * current offset and `clickY` an optional clicked viewport row (clamped into the box).
 */
export function scrollEndAt(
  scrollTop: number,
  boxTop: number,
  boxBottom: number,
  clickY: number | null = null,
): number {
  const top = finite(boxTop);
  const bottom = Math.max(top, finite(boxBottom));
  const row =
    clickY === null || !Number.isFinite(clickY)
      ? bottom
      : Math.min(bottom, Math.max(top, clickY));
  return Math.max(0, finite(scrollTop)) + (row - top);
}

export interface ScrollingClip {
  /** CSS-pixel clip in document coordinates for CDP Page.captureScreenshot (captureBeyondViewport). */
  clip: Rect & { scale: 1 };
  truncated: boolean;
}

/**
 * The CDP clip for a document-scrolling capture: the user's horizontal band (`box`, viewport CSS
 * px) shifted by the horizontal scroll, from `range.start` to `range.end`, capped at the bitmap limit
 * on both sides.
 */
export function scrollingClip(
  range: ScrollRange,
  box: { x: number; width: number },
  scrollX: number,
  pixelRatio: number,
  maxSidePx = MAX_SCREENSHOT_SIDE_PX,
): ScrollingClip | null {
  const maxCss = maxCaptureCssHeight(pixelRatio, maxSidePx);
  const clamped = clampScrollRange(range.start, range.end, maxCss);
  const left = Math.max(0, Math.floor(finite(box.x) + finite(scrollX)));
  const right = Math.ceil(finite(box.x) + finite(box.width) + finite(scrollX));
  const width = Math.min(right - left, maxCss);
  if (width < 1) return null;
  return {
    clip: {
      x: left,
      y: clamped.start,
      width,
      height: clamped.end - clamped.start,
      scale: 1,
    },
    truncated: clamped.truncated || width < right - left,
  };
}

/** Scroll offset to ask for before capturing the slice that begins at content row `position`. */
export function stitchTargetScroll(
  position: number,
  maxScroll: number,
): number {
  return Math.max(
    0,
    Math.min(Math.floor(finite(position)), Math.floor(finite(maxScroll))),
  );
}

export interface StitchSlice {
  /** Rows to keep, in CSS px from the top of the scroller's visible box. */
  cropTop: number;
  height: number;
}

/**
 * The new rows a capture adds once the scroller actually sits at `actualScroll` (pages may clamp
 * or snap the offset we asked for). Null when the capture can't continue the image seamlessly: the
 * scroller landed past `position` (rows would be missing) or didn't move far enough to reveal it.
 */
export function stitchSlice(
  position: number,
  end: number,
  actualScroll: number,
  boxHeight: number,
): StitchSlice | null {
  const box = Math.floor(finite(boxHeight));
  const cropTop = Math.round(finite(position) - finite(actualScroll));
  if (box < 1 || cropTop < 0 || cropTop >= box) return null;
  const height = Math.min(
    box - cropTop,
    Math.round(finite(end) - finite(position)),
  );
  return height > 0 ? { cropTop, height } : null;
}

export interface ScrollingStitchStep extends StitchSlice {
  scrollTop: number;
}

/**
 * The whole scroll-and-stitch plan assuming every scroll lands exactly where asked. The capture
 * code walks the same steps one at a time with stitchTargetScroll / stitchSlice so it can follow a
 * page that snaps; this is the reference for tests and for counting steps.
 */
export function scrollingStitchPlan(
  range: ScrollRange,
  boxHeight: number,
  maxScroll: number,
): ScrollingStitchStep[] {
  const steps: ScrollingStitchStep[] = [];
  const end = Math.floor(finite(range.end));
  let position = Math.max(0, Math.floor(finite(range.start)));
  // Each step adds at least one row, so this bound only trips on nonsense input.
  const guard =
    Math.ceil((end - position) / Math.max(1, Math.floor(finite(boxHeight)))) +
    2;
  while (position < end && steps.length < guard) {
    const scrollTop = stitchTargetScroll(position, maxScroll);
    const slice = stitchSlice(position, end, scrollTop, boxHeight);
    if (!slice) break;
    steps.push({ scrollTop, ...slice });
    position += slice.height;
  }
  return steps;
}

/**
 * Device-pixel rows of one slice inside a viewport capture `imageHeight` px tall. `boxTop` is the
 * scroller's visible box top in viewport CSS px (0 for the document). Edges round independently,
 * so consecutive slices meet without gaps or doubled rows at fractional ratios.
 */
export function sliceRowsInPixels(
  boxTop: number,
  slice: StitchSlice,
  viewportHeight: number,
  imageHeight: number,
): { top: number; height: number } {
  const ratio = viewportHeight > 0 ? imageHeight / viewportHeight : 1;
  const clampRow = (value: number): number =>
    Math.min(imageHeight, Math.max(0, value));
  const top = clampRow(Math.round((finite(boxTop) + slice.cropTop) * ratio));
  const bottom = clampRow(
    Math.round((finite(boxTop) + slice.cropTop + slice.height) * ratio),
  );
  return { top, height: Math.max(0, bottom - top) };
}

/**
 * The horizontal band to keep, in viewport CSS px: the user's region (if any) intersected with the
 * scroller's visible box, or the whole box. Null when they don't overlap.
 */
export function captureBand(
  box: { x: number; width: number },
  region: { x: number; width: number } | null,
): { x: number; width: number } | null {
  const boxLeft = finite(box.x);
  const boxRight = boxLeft + Math.max(0, finite(box.width));
  const left = region ? Math.max(boxLeft, finite(region.x)) : boxLeft;
  const right = region
    ? Math.min(boxRight, finite(region.x) + Math.max(0, finite(region.width)))
    : boxRight;
  return right - left >= 1 ? { x: left, width: right - left } : null;
}

/** The scrolling control bar: centred near the top of the page area, shrunk to fit. */
export function scrollingBarBounds(page: Rect, bar: Size, margin = 12): Rect {
  const width = Math.max(0, Math.min(bar.width, page.width - margin * 2));
  const height = Math.max(0, Math.min(bar.height, page.height - margin * 2));
  return {
    x: Math.round(page.x + (page.width - width) / 2),
    y: Math.round(page.y + margin),
    width: Math.round(width),
    height: Math.round(height),
  };
}
