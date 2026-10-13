import type { WebContents } from 'electron'

/**
 * Electron hit-tests window drag regions across every WebContentsView in the window, and a
 * `no-drag` hole in one view can't cancel `drag` in another. Background tabs sit at 0×0 bounds at
 * the window origin, so a site that ships `app-region: drag` (plenty of web apps share CSS with
 * their Electron desktop builds) turns the matching strip of our toolbar into a window drag
 * handle: the address bar and toolbar buttons stop getting hover and clicks until that tab goes.
 * Site pages never get to drag the window, so force every element in them to `no-drag`.
 * User-origin !important beats anything the page sets.
 */
export const PAGE_NO_DRAG_CSS = '*,*::before,*::after{-webkit-app-region:no-drag!important;app-region:no-drag!important}'

/** Re-inject on every main-frame document load; inserted CSS lives with the document. */
export function guardPageDragRegions(contents: WebContents): void {
  const apply = (): void => {
    if (contents.isDestroyed()) return
    void contents.insertCSS(PAGE_NO_DRAG_CSS, { cssOrigin: 'user' }).catch(() => undefined)
  }
  contents.on('dom-ready', apply)
}
