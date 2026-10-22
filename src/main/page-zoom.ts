import type { WebContents } from "electron";
import { normalizeHttpOrigin } from "../shared/persistence";
import {
  PINCH_ZOOM_MAX_SCALE,
  stepZoomFactor,
  type PageZoomAction,
} from "../shared/zoom";
import { getBrowserSiteZoom, saveBrowserSiteZoom } from "./browser-persistence";

/**
 * Page zoom shared by tabs (browser.ts) and Glance pages (glance.ts), remembered per origin.
 * Private pages use saved levels but keep their own changes in memory only (forgotten with the
 * private session).
 */

const privateSiteZoom = new Map<string, number>();

/**
 * Electron disables visual pinch-zoom by default (limits 1,1); enable it for trackpads (macOS and
 * Windows precision touchpads) and macOS smart zoom. Every page view a user can read gets this.
 */
export function enablePagePinchZoom(contents: WebContents): void {
  void contents
    .setVisualZoomLevelLimits(1, PINCH_ZOOM_MAX_SCALE)
    .catch(() => {});
}

/** The zoom a page at `url` opens with: the private session's own change, else the saved site zoom. */
export function savedPageZoom(url: string, isPrivate: boolean): number {
  const origin = normalizeHttpOrigin(url);
  if (!origin) return 1;
  return (
    (isPrivate ? privateSiteZoom.get(origin) : undefined) ??
    getBrowserSiteZoom(origin)
  );
}

/** A page committed `url`: give it its origin's zoom (http(s) only). */
export function applySavedPageZoom(
  contents: WebContents | null | undefined,
  url: string,
  isPrivate: boolean,
): void {
  if (!contents || contents.isDestroyed() || !/^https?:\/\//i.test(url)) return;
  const factor = savedPageZoom(url, isPrivate);
  if (Math.abs(contents.getZoomFactor() - factor) > 0.001)
    contents.setZoomFactor(factor);
}

/** Cmd + / Cmd - / Cmd 0, Ctrl+wheel: step the page's zoom and remember it for its origin. Returns the new factor. */
export function stepPageZoom(
  contents: WebContents | null | undefined,
  action: PageZoomAction,
  isPrivate: boolean,
): number | null {
  if (!contents || contents.isDestroyed()) return null;
  const current = contents.getZoomFactor();
  const next =
    action === "reset" ? 1 : stepZoomFactor(current, action === "in" ? 1 : -1);
  if (Math.abs(current - next) > 0.001) contents.setZoomFactor(next);
  const origin = normalizeHttpOrigin(contents.getURL());
  if (origin) {
    if (isPrivate) privateSiteZoom.set(origin, next);
    else saveBrowserSiteZoom(origin, next);
  }
  return next;
}

/** Last private tab closed: forget the private session's zoom changes. */
export function forgetPrivatePageZoom(): void {
  privateSiteZoom.clear();
}
