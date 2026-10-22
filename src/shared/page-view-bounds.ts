/**
 * Bounds for a tab's page view (browser.ts applyTabBounds).
 *
 * Off-screen page views are detached from the window, which is what makes Chromium treat them as
 * background tabs (hidden, throttled). They used to be shrunk to 0x0 as well, so every tab switch
 * (and every return from New Tab or a full panel) attached a 0x0 view and resized it to the page
 * area a moment later: the page re-laid out from zero width and the first frames on screen were
 * stale or empty (a brief flash of what was behind it). Now an off-screen view is left at the
 * size it last had (no resize at all when the window hasn't changed, and none for every
 * background tab on each step of a window-resize drag), and the on-screen bounds are applied
 * before the view is attached.
 */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** On screen: its rect (the page area, or its split pane). Off screen: null = leave it alone. */
export function pageViewBounds(
  onScreen: boolean,
  rect: ViewRect,
): ViewRect | null {
  return onScreen ? { ...rect } : null;
}

/** A brand-new page view: the page area when it is known, else 0x0 (it gets sized before it's attached). */
export function initialPageViewBounds(
  pageArea: ViewRect | null | undefined,
): ViewRect {
  if (!pageArea || !(pageArea.width > 0) || !(pageArea.height > 0))
    return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: pageArea.x,
    y: pageArea.y,
    width: pageArea.width,
    height: pageArea.height,
  };
}
