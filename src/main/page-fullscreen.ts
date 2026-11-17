import type { WebContents } from "electron";
import {
  PAGE_FULLSCREEN_POLL_MS,
  VIEWPORT_COVER_MARGIN,
} from "../shared/page-fullscreen";

/**
 * Watching whether one page's content view currently looks "expanded" — a video filling the window.
 *
 * The sidebar is a native overlay rail fixed to the window's left edge; a fullscreen video overlaps
 * it and steals its clicks. This injects a small observer into the page (main world, so it is not
 * subject to the page's CSP) and polls it, flipping `onChange(expanded)` so the shell can collapse
 * the sidebar rail and go click-through.
 *
 * Polling — rather than the fullscreen API's events — keeps it working for DOM "theater" expansions
 * (how X expands its in-feed videos) that fire no event. It is cheap: one boolean read for the active
 * page's single content view. `pageIsExpanded` (shared) mirrors the inline check here — keep them in
 * sync; the test suite covers the shared logic.
 */

const INJECT_SCRIPT = (margin: number): string => String.raw`
(function () {
  if (window.__SURFFISH_PageExpanded) return;
  window.__SURFFISH_PageExpanded = function () {
    var vw = window.innerWidth, vh = window.innerHeight;
    if (document.fullscreenElement) return true;
    var m = ${margin};
    if (vw > 0 && vh > 0) {
      var vs = document.querySelectorAll("video");
      for (var i = 0; i < vs.length; i++) {
        var r = vs[i].getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue;
        if (r.x <= m && r.y <= m && (r.x + r.width) >= (vw - m) && (r.y + r.height) >= (vh - m)) {
          return true;
        }
      }
    }
    return false;
  };
})();
`;

/** A tracker for one page's content view. Stop it on window detach. */
export interface PageFullScreenTracker {
  /** Stop polling and clean up. Safe to call more than once. */
  stop(): void;
}

/**
 * Start watching `contents` (a tab's content view) for an expanded video. `onChange` fires on each
 * flip (expanded ↔ not). The observer is re-injected on main-frame navigations. Gate polling with
 * `shouldTrack` (e.g. only while the sidebar rail is a floating overlay) and call `tracker.stop()`
 * on window detach.
 */
export function trackPageFullScreen(
  contents: WebContents,
  onChange: (expanded: boolean) => void,
  shouldTrack: () => boolean = () => true,
): PageFullScreenTracker {
  const empty = { stop() {} };
  if (contents.isDestroyed()) return empty;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = false;

  const inject = (): void => {
    void contents.executeJavaScript(
      INJECT_SCRIPT(VIEWPORT_COVER_MARGIN),
      false,
    );
  };
  const read = async (): Promise<void> => {
    if (contents.isDestroyed()) return;
    let expanded = false;
    try {
      expanded = Boolean(
        await contents.executeJavaScript(
          "window.__SURFFISH_PageExpanded && window.__SURFFISH_PageExpanded()",
        ),
      );
    } catch {
      expanded = false;
    }
    if (expanded !== last) {
      last = expanded;
      onChange(expanded);
    }
  };

  // Re-inject the observer when the main frame (re)loads, so a navigation does not lose it.
  // `did-finish-load` fires once per page load with no payload, so just re-inject on every fire.
  const onFrameLoaded = (): void => {
    inject();
  };

  inject();
  contents.on("did-finish-load", onFrameLoaded);
  timer = setInterval(() => {
    if (shouldTrack()) void read();
  }, PAGE_FULLSCREEN_POLL_MS);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      contents.removeListener("did-finish-load", onFrameLoaded);
    },
  };
}
