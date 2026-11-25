/**
 * Deciding whether a page currently looks "expanded" — a video filling the window.
 *
 * The sidebar is a native overlay rail fixed to the left edge of the window. When a page's video
 * expands to fill the window, the rail overlaps it and steals its clicks (the video appears stuck:
 * its rail icons sit on top of it). A page looks "expanded" two ways:
 *   - the fullscreen API is active (`document.fullscreenElement` is set), or
 *   - a `<video>` has been stretched to (near) cover the whole viewport — a "theater"/DOM expansion
 *     that fires no fullscreen event (this is how X expands its in-feed videos).
 *
 * Pure (no browser) so it unit-tests; the main process reads page geometry into these shapes and
 * calls `pageIsExpanded` (see main/page-fullscreen.ts).
 */

/** A `<video>`'s bounding rect, as returned by `getBoundingClientRect()`. */
export interface VideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How often the main process reads a page's expanded state (ms). */
export const PAGE_FULLSCREEN_POLL_MS = 250;

/**
 * A `<video>` counts as "covering the viewport" only if it stays within this many px of every edge.
 * Normal embedded videos sit inside a constrained card with margins, so they never qualify — only a
 * video actually stretched to fill the window does.
 */
export const VIEWPORT_COVER_MARGIN = 16;

/** Whether a `<video>` covers (near) the entire viewport, staying within `margin` of every edge. */
export function videoCoversViewport(
  rect: VideoRect,
  viewport: { width: number; height: number },
  margin: number,
): boolean {
  return (
    rect.x <= margin &&
    rect.y <= margin &&
    rect.x + rect.width >= viewport.width - margin &&
    rect.y + rect.height >= viewport.height - margin
  );
}

/**
 * Whether the page currently looks expanded: the fullscreen API is active, or some `<video>` covers
 * (near) the whole viewport. A zero-size viewport (a hidden/minimized page) is never expanded.
 */
export function pageIsExpanded(
  fullscreenElement: boolean,
  videos: Array<VideoRect>,
  viewport: { width: number; height: number },
  margin: number,
): boolean {
  if (fullscreenElement) return true;
  if (viewport.width <= 0 || viewport.height <= 0) return false;
  return videos.some((rect) => videoCoversViewport(rect, viewport, margin));
}
