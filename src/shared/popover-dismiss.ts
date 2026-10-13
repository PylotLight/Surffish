/**
 * Light-dismiss for the toolbar's popovers (site menu, downloads, extensions, bookmarks).
 *
 * A popover lives in the toolbar renderer, but the page under it is a separate WebContentsView, so
 * a click on the page never reaches the toolbar's document and its outside-click listener. Main
 * sees that click (`before-mouse-event` on the tab) and tells the toolbar to close its popovers;
 * the toolbar also closes them when it loses focus (sidebar click, tab switch, another app).
 */

/** Main → toolbar: close whatever popover is open. */
export const POPOVER_DISMISS_CHANNEL = 'browser:popovers:dismiss'

/** The same request inside a renderer (a DOM event on `window`, so every popover hears it). */
export const POPOVER_DISMISS_EVENT = 'surffish:dismiss-popovers'

export interface ToolbarPopoverState {
  /** Live page on screen with the toolbar drawn by its own overlay view (not the content renderer). */
  overlayMode: boolean
  toolbarHeight: number
  /** Bottom of the lowest thing the toolbar draws (popovers hang below the toolbar). */
  toolbarExtent: number
}

/**
 * Should a mouse event on the page close the toolbar's popovers? Only a press, and only while the
 * toolbar draws something below itself (so ordinary page clicks send no IPC at all). Off overlay
 * mode the toolbar and page area are one document and its own outside-click listener handles it.
 */
export function pagePressDismissesPopovers(mouseType: string, toolbar: ToolbarPopoverState): boolean {
  return mouseType === 'mouseDown' && toolbar.overlayMode && toolbar.toolbarExtent > toolbar.toolbarHeight
}

/**
 * Should losing focus close a popover? Not while one of its own <select>s has focus: on some
 * platforms the native select list takes focus from the document while it is open.
 */
export function blurDismissesPopover(activeElementTag: string | null | undefined): boolean {
  return (activeElementTag ?? '').toUpperCase() !== 'SELECT'
}
