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

/**
 * Gap the page card keeps from the browser frame on every side (px): from the sidebar (its rail
 * or the docked panel) on the left, the toolbar's bottom line on top, and the window's right and
 * bottom edges. The frame (toolbar strip + sidebar, one material) shows in it, and the card's
 * rounded corners (PAGE_FRAME_RADIUS, shared/sidebar-card.ts) read as the frame's inner corners,
 * as Zephium lays its page out (crates/zephium-core/src/layout.rs: padding and gap around content).
 */
export const PAGE_FRAME_GAP = 6;

/**
 * Where the browser frame's left side ends for live pages, in window px: the docked sidebar's
 * width when the tab list (or history) is pinned open, the collapsed icon rail's width while the
 * sidebar auto-hides (the rail stays on screen, so the page sits beside it rather than under it),
 * else 0. A hover/focus reveal never changes it: the panel slides out over the page card. History
 * opens over the rail like a hover reveal, so it keeps the rail's edge too. null: no frame at all
 * (New Tab and full panels draw in-page; native fullscreen gives the page the whole window).
 */
export function pageFrameLeft({
  overlayMode,
  fullscreen,
  sidebarMode,
  sidebarPinned,
  sidebarWidth,
  railWidth,
}: {
  overlayMode: boolean;
  fullscreen: boolean;
  sidebarMode: string;
  sidebarPinned: boolean;
  sidebarWidth: number;
  railWidth: number;
}): number | null {
  if (!overlayMode || fullscreen) return null;
  if (sidebarMode !== "tabs" && sidebarMode !== "history") return 0;
  if (sidebarPinned && sidebarWidth > 0) return Math.round(sidebarWidth);
  return railWidth > 0 ? Math.round(railWidth) : 0;
}

/**
 * The page card inside the frame: `area` (the page area the content renderer measured, its top
 * on the toolbar's bottom line) starting no further left than the frame's left edge, then inset
 * by `gap` on every side. `frameLeft` null (no frame) or an empty area leaves `area` as it is.
 * Not idempotent by design: callers keep the measured area and derive the card from it.
 */
export function framePageArea(
  area: ViewRect,
  frameLeft: number | null,
  gap = PAGE_FRAME_GAP,
): ViewRect {
  if (frameLeft === null || !(area.width > 0) || !(area.height > 0))
    return { ...area };
  const inset = Math.max(0, Math.round(gap));
  const left = Math.max(area.x, Math.round(frameLeft)) + inset;
  const top = area.y + inset;
  const right = area.x + area.width - inset;
  const bottom = area.y + area.height - inset;
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * How far the page card's left edge moves right while the tab list's hover panel pushes it aside
 * (Settings → Appearance → Sidebar pushes page): from the frame's left edge (`frameLeft`, the rail)
 * to the panel's visible right edge at this point of its open/close slide. 0 when the panel is not
 * pushing or is closed.
 */
export function pageSlideOffset({
  pushing,
  panelRight,
  frameLeft,
}: {
  pushing: boolean;
  panelRight: number;
  frameLeft: number | null;
}): number {
  if (!pushing || frameLeft === null) return 0;
  return Math.max(0, Math.round(panelRight - frameLeft));
}

/**
 * `rect` with its left edge pushed `dx` px right and its right edge kept (the pushed page card):
 * the page resizes to the room beside the panel instead of sliding under the window's right edge,
 * so nothing of it is clipped off screen while the panel is open.
 */
export function pushViewRect(rect: ViewRect, dx: number): ViewRect {
  const push = Math.min(Math.max(0, Math.round(dx)), rect.width);
  return push === 0
    ? { ...rect }
    : { ...rect, x: rect.x + push, width: rect.width - push };
}
