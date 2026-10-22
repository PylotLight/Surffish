import type { BaseWindow, WebContents, WebContentsView } from "electron";

/** A tab as diagnostics sees it (from the tab registry in browser.ts). */
export interface TabProcessEntry {
  id: string;
  title: string;
  url: string;
  active: boolean;
  pdfEditor: boolean;
  extensionPage: boolean;
  /** Null while the tab sleeps (no view, no process). */
  contents: WebContents | null;
  /** Which window the tab is in (1-based), only set while more than one window is open. */
  windowNumber?: number;
  /** The tab's Space ("Work"), only set while Spaces are on. */
  spaceName?: string;
}

/**
 * Put a page view on screen, or take it off.
 *
 * Off screen means hidden *and* removed from the window: on macOS a zero-size view still counts
 * as visible, so Chromium never marks the page hidden, never throttles its timers and keeps
 * serving it animation frames (each one a GPU-process wakeup). Detached, it behaves like a
 * background tab in Chrome: `document.visibilityState === 'hidden'`, rAF stops, timers are
 * throttled, audio keeps playing. On screen, the view goes back to index 0 so every local
 * surface (toolbar, sidebar, link status, tab overview) stays above it.
 */
export function setPageViewOnScreen(
  window: BaseWindow,
  view: WebContentsView,
  onScreen: boolean,
): void {
  if (window.isDestroyed()) return;
  const attached = window.contentView.children.includes(view);
  if (onScreen) {
    if (!attached) window.contentView.addChildView(view, 0);
    if (!view.getVisible()) view.setVisible(true);
    return;
  }
  if (view.getVisible()) view.setVisible(false);
  // A captured tab (Mirror tab) stays attached: hidden but in a window, Chromium keeps rendering it
  // for the capture; detached it would stop producing frames.
  const contents = view.webContents;
  if (attached && !contents.isDestroyed() && capturedPages.has(contents)) {
    capturedPages.set(contents, { window, view });
    return;
  }
  if (attached) window.contentView.removeChildView(view);
}

const capturedPages = new Map<
  WebContents,
  { window: BaseWindow; view: WebContentsView } | null
>();

/**
 * Keeps a tab's page rendering while it is captured (Mirror tab), even behind another tab, and
 * keeps it awake (media-session-keeper counts it as playing). Returns the release.
 */
export function holdPageViewForCapture(contents: WebContents): () => void {
  if (!capturedPages.has(contents)) capturedPages.set(contents, null);
  return () => {
    const kept = capturedPages.get(contents);
    capturedPages.delete(contents);
    // Hidden while held: take it off the window now, like any background tab.
    if (
      kept &&
      !kept.window.isDestroyed() &&
      !kept.view.getVisible() &&
      kept.window.contentView.children.includes(kept.view)
    ) {
      kept.window.contentView.removeChildView(kept.view);
    }
  };
}

export function isPageHeldForCapture(contents: WebContents): boolean {
  return capturedPages.has(contents);
}
