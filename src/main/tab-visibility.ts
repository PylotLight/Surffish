import type { BaseWindow, WebContents, WebContentsView } from 'electron'

/** A tab as diagnostics sees it (from the tab registry in browser.ts). */
export interface TabProcessEntry {
  id: string
  title: string
  url: string
  active: boolean
  pdfEditor: boolean
  extensionPage: boolean
  /** Null while the tab sleeps (no view, no process). */
  contents: WebContents | null
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
export function setPageViewOnScreen(window: BaseWindow, view: WebContentsView, onScreen: boolean): void {
  if (window.isDestroyed()) return
  const attached = window.contentView.children.includes(view)
  if (onScreen) {
    if (!attached) window.contentView.addChildView(view, 0)
    if (!view.getVisible()) view.setVisible(true)
    return
  }
  if (view.getVisible()) view.setVisible(false)
  if (attached) window.contentView.removeChildView(view)
}
