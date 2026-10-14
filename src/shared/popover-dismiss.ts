/**
 * Light-dismiss for the toolbar's popovers (site menu, downloads and its … menu, extensions,
 * bookmarks, the bookmark star) and the History panel the toolbar opens.
 *
 * A popover lives in the toolbar renderer, but the page under it and the sidebar beside it are
 * separate WebContentsViews, so a click there never reaches the toolbar's document and its
 * outside-click listener. Main sees those presses (`before-mouse-event` on the page and sidebar
 * views) and the window losing focus, and tells the toolbar why it should close (a reason, so the
 * History panel, which lives in the sidebar, can ignore presses on the sidebar). The toolbar also
 * closes popovers on Escape, a press elsewhere in itself, losing focus and a tab switch.
 */

/** Main → toolbar: close whatever popover is open (payload: a PopoverDismissReason). */
export const POPOVER_DISMISS_CHANNEL = 'browser:popovers:dismiss'

/** The same request inside a renderer (a CustomEvent on `window` whose detail is the reason). */
export const POPOVER_DISMISS_EVENT = 'surffish:dismiss-popovers'

/** Why a popover is being closed from outside its own document. */
export type PopoverDismissReason = 'page-press' | 'sidebar-press' | 'window-blur' | 'tab-switch' | 'request'

const REASONS: readonly PopoverDismissReason[] = ['page-press', 'sidebar-press', 'window-blur', 'tab-switch', 'request']

/** A reason off the wire (IPC or a DOM event); anything unknown is a plain request to close. */
export function normalizeDismissReason(value: unknown): PopoverDismissReason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value) ? value as PopoverDismissReason : 'request'
}

/**
 * A dismiss request inside a renderer (the `POPOVER_DISMISS_EVENT` detail). `since` only comes with
 * `tab-switch`: when main made the new tab active (`BrowserState.activeTabSince`).
 */
export interface PopoverDismissRequest {
  reason: PopoverDismissReason
  since?: number
}

/** A dismiss event's detail: a bare reason (older callers, main's IPC) or a `PopoverDismissRequest`. */
export function readDismissRequest(detail: unknown): PopoverDismissRequest {
  if (typeof detail === 'object' && detail !== null) {
    const candidate = detail as { reason?: unknown; since?: unknown }
    const reason = normalizeDismissReason(candidate.reason)
    return typeof candidate.since === 'number' && Number.isFinite(candidate.since) && candidate.since > 0 ? { reason, since: candidate.since } : { reason }
  }
  return { reason: normalizeDismissReason(detail) }
}

/**
 * Does a tab switch close a popover that opened at `openedAt` (epoch ms, `Date.now()` in the
 * renderer)? Only one that was already open when main switched the tab (`switchedAt`, epoch ms in
 * main; same machine, same clock). The renderer hears of the switch from the tab broadcast, which
 * main coalesces to one per frame, so it can land after a popover main opened right after the
 * switch (close a tab, then Open Reading List or ⌘D): that popover belongs to the new tab and stays.
 * No stamp (unknown switch time) closes, as before. Same millisecond counts as "opened after": an
 * IPC hop plus a React commit can't fit before it, while a press made in the same millisecond as
 * the switch could only be a script.
 */
export function tabSwitchClosesPopover(openedAt: number, switchedAt: number | undefined): boolean {
  if (typeof switchedAt !== 'number' || !Number.isFinite(switchedAt) || switchedAt <= 0) return true
  return openedAt < switchedAt
}

/**
 * What kind of thing is being dismissed:
 * - `popover`: hangs below the toolbar inside the toolbar view; closes on every reason.
 * - `panel`: the History panel, drawn in the sidebar view; a press on the sidebar is a press
 *   inside it, and the toolbar losing focus (to the panel's own search box) is not leaving it.
 */
export type DismissibleKind = 'popover' | 'panel'

/**
 * Does a dismiss request close this kind? A `panel` (History) ignores presses on the sidebar it is
 * drawn in, and ignores the renderer's `tab-switch` too: a renderer learns of a tab switch from the
 * tab broadcast, which main coalesces to one per frame, so it can land *after* a History panel that
 * was opened later (switch tab, then Cmd+Y right away) and close it. Main closes History on a real
 * tab switch itself, in order with the shortcut (`sidebarModeAfterTabSwitch`).
 */
export function dismissReasonCloses(kind: DismissibleKind, reason: PopoverDismissReason): boolean {
  if (kind === 'panel') return reason !== 'sidebar-press' && reason !== 'tab-switch'
  return true
}

/**
 * The sidebar mode once main switches the active tab: the History panel (it belonged to the old
 * page's moment) closes back to the tab list; every other mode stays. Only a real switch (a
 * different tab id) counts, and it is judged in main, so a History panel opened after the switch
 * is never closed by it.
 */
export function sidebarModeAfterTabSwitch<Mode extends string>(mode: Mode, previousTabId: string | null | undefined, nextTabId: string): Mode | 'tabs' {
  if (!previousTabId || previousTabId === nextTabId) return mode
  return mode === 'history' ? 'tabs' : mode
}

export interface ToolbarPopoverState {
  /** Live page on screen with the toolbar drawn by its own overlay view (not the content renderer). */
  overlayMode: boolean
  toolbarHeight: number
  /** Bottom of the lowest thing the toolbar draws (popovers hang below the toolbar). */
  toolbarExtent: number
  /** The toolbar says a popover is open (even one that happens to fit inside the toolbar strip). */
  popoverOpen?: boolean
  /** The History panel (sidebar view) is open. */
  historyOpen?: boolean
}

function somethingOpen(state: ToolbarPopoverState, includeHistory: boolean): boolean {
  return Boolean(state.popoverOpen) || state.toolbarExtent > state.toolbarHeight || (includeHistory && Boolean(state.historyOpen))
}

/**
 * Should a mouse event on the page (or on the sidebar view) close the toolbar's popovers? Only a
 * press, and only while something is open (so ordinary clicks send no IPC at all). A press on the
 * sidebar never closes the History panel: that panel is drawn in the sidebar. Off overlay mode the
 * toolbar, sidebar and page area are one document and its own outside-click listener handles it.
 */
export function surfacePressDismissReason(surface: 'page' | 'sidebar', mouseType: string, state: ToolbarPopoverState): PopoverDismissReason | null {
  if (mouseType !== 'mouseDown' || !state.overlayMode) return null
  if (!somethingOpen(state, surface === 'page')) return null
  return surface === 'page' ? 'page-press' : 'sidebar-press'
}

/** Back-compat wrapper: a press on the page view. */
export function pagePressDismissesPopovers(mouseType: string, toolbar: ToolbarPopoverState): boolean {
  return surfacePressDismissReason('page', mouseType, toolbar) !== null
}

/** Should the window losing focus (another app, another Surffish window) close what is open? */
export function windowBlurDismissesPopovers(state: ToolbarPopoverState): boolean {
  return somethingOpen(state, true)
}

/**
 * Should losing focus close a popover? Not while one of its own <select>s has focus: on some
 * platforms the native select list takes focus from the document while it is open.
 */
export function blurDismissesPopover(activeElementTag: string | null | undefined): boolean {
  return (activeElementTag ?? '').toUpperCase() !== 'SELECT'
}

/** Room a popover's shadow needs below its box, so the toolbar view doesn't cut it flat. */
export const POPOVER_SHADOW_ROOM = 18

/** One popover's box in toolbar-view coordinates, as laid out (before any entry animation transform). */
export interface PopoverBox {
  top: number
  height: number
  /** Leave room for its drop shadow (popovers). Off for things that stay open while you use the
   * page (find bar, notices), so no transparent strip under them swallows page clicks. */
  shadow?: boolean
}

/**
 * How tall the toolbar view must be to show the toolbar and every open popover whole: the lowest
 * popover bottom, rounded up (a fractional bottom rounded down clipped the last pixel row), plus
 * room for its shadow, never shorter than the toolbar and never taller than the window.
 */
export function toolbarExtentFor(toolbarHeight: number, boxes: readonly PopoverBox[], windowHeight?: number): number {
  let bottom = toolbarHeight
  for (const box of boxes) {
    if (!Number.isFinite(box.top) || !Number.isFinite(box.height) || box.height <= 0) continue
    bottom = Math.max(bottom, box.top + box.height + (box.shadow === false ? 0 : POPOVER_SHADOW_ROOM))
  }
  const extent = Math.ceil(bottom)
  return windowHeight && windowHeight > 0 ? Math.max(Math.ceil(toolbarHeight), Math.min(extent, Math.floor(windowHeight))) : extent
}

/**
 * How much height the window leaves a popover hanging below the toolbar (its 10 px gap and a margin
 * at the bottom taken off), never below a usable floor. Popovers cap their own max-height at this
 * (CSS `--popover-room`) and scroll inside themselves past it. Null when the window size is unknown.
 */
export function popoverRoom(windowHeight: number | undefined, toolbarHeight: number, gap = 10, margin = 14, floor = 180): number | null {
  if (!windowHeight || !Number.isFinite(windowHeight) || windowHeight <= 0) return null
  return Math.max(floor, Math.floor(windowHeight - toolbarHeight - gap - margin))
}
