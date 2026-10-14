/**
 * Why the auto-hide (overlay) sidebar is being held open, and what lets go of each hold.
 *
 * Over live pages the sidebar is its own WebContentsView, so "the pointer left it" and "the user
 * clicked the page" are learned from several places that can each miss: the sidebar renderer's
 * mouseleave (not sent when the view moves or the cursor exits over another view at a fractional
 * edge), the page's before-mouse-event (not sent for clicks/moves inside cross-origin iframes,
 * which are separate widgets), a resize drag's pointerup (lost when the button goes up outside the
 * view or the window). Any one of those left a flag set and the sidebar stuck open.
 *
 * Main keeps this small state machine per window: every flag that can hold the sidebar open is a
 * named lock, and every event that should end a hold (a press on the page, the window or the
 * sidebar losing focus, Escape, the button found up, the cursor outside the sidebar for a moment)
 * clears the locks it owns. The pure decisions live here so they are unit-tested.
 */

export type SidebarRevealLock =
  /** The user pinned it ("Keep sidebar open"): never auto-released. */
  | 'pinned'
  /** A panel other than the tab list (History, Settings, ...): closed by its own UI. */
  | 'panel'
  /** Hover reveal (edge hover or pointer over the sidebar). */
  | 'hovered'
  /** Keyboard focus is inside the sidebar document. */
  | 'focused'
  /** A width drag on the sidebar's edge is running. */
  | 'resizing'
  /** A mouse button went down in the sidebar and has not been seen going up (tab drag, capture). */
  | 'pointer-held'
  /** A native menu (tab context menu, ...) is open. */
  | 'menu-open'

export interface SidebarRevealState {
  pinned: boolean
  /** The sidebar mode; anything but 'tabs' is a panel. */
  mode: string
  hovered: boolean
  focused: boolean
  resizing: boolean
  pointerHeld: boolean
  menuOpen: boolean
}

/** Every reason the sidebar is held right now, in a stable order (for the debug log). */
export function sidebarRevealLocks(state: SidebarRevealState): SidebarRevealLock[] {
  const locks: SidebarRevealLock[] = []
  if (state.pinned) locks.push('pinned')
  if (state.mode !== 'tabs') locks.push('panel')
  if (state.hovered) locks.push('hovered')
  if (state.focused) locks.push('focused')
  if (state.resizing) locks.push('resizing')
  if (state.pointerHeld) locks.push('pointer-held')
  if (state.menuOpen) locks.push('menu-open')
  return locks
}

/** True when nothing holds it: the sidebar should be (or go) hidden. */
export function sidebarRevealReleased(state: SidebarRevealState): boolean {
  return !state.pinned && state.mode === 'tabs' && !state.hovered && !state.focused
}

export type SidebarReleaseEvent =
  /** A mouse press on the live page (or any other surface that isn't the sidebar). */
  | { type: 'page-press' }
  /** A mouse event on the page with no button held: no drag can be running in the sidebar. */
  | { type: 'page-pointer-free' }
  /** The browser window lost focus. */
  | { type: 'window-blur' }
  /** The sidebar's web contents lost keyboard focus (to the page, the toolbar, another window). */
  | { type: 'sidebar-blur' }
  /** Escape pressed in the sidebar. */
  | { type: 'escape' }
  /** Mouse input on the sidebar itself: a press, a release, or a move with or without the button. */
  | { type: 'sidebar-pointer'; mouse: 'down' | 'up' | 'move'; buttonDown: boolean }
  /** A native menu opened or closed. */
  | { type: 'menu'; open: boolean }
  /** The cursor-poll fallback: the cursor has been outside the sidebar's bounds for `outsideMs`. */
  | { type: 'cursor-outside'; outsideMs: number }

/** How long the cursor must stay outside before the poll lets go of a hover (ms). */
export const SIDEBAR_CURSOR_OUTSIDE_GRACE_MS = 240
/** How often main polls the cursor while a hover reveal is up (ms). */
export const SIDEBAR_CURSOR_POLL_MS = 80
/** Slack around the sidebar's bounds that still counts as over it (the resize handle, rounding). */
export const SIDEBAR_CURSOR_SLACK_PX = 6

export interface SidebarReleaseResult {
  /** The next state (unchanged object when nothing changed). */
  state: SidebarRevealState
  /** Locks this event released, in order. Empty when it changed nothing. */
  released: SidebarRevealLock[]
}

/**
 * Apply one event. Pinned and panel holds are never released here (the user's own controls own
 * them); a drag (resizing / pointer-held) ends whenever the button is known to be up or input goes
 * somewhere else, pinned or not.
 */
export function applySidebarReleaseEvent(state: SidebarRevealState, event: SidebarReleaseEvent): SidebarReleaseResult {
  const next = { ...state }
  const autoHide = !state.pinned
  switch (event.type) {
    case 'page-press':
    case 'window-blur':
    case 'escape':
      next.resizing = false
      next.pointerHeld = false
      if (autoHide) {
        next.hovered = false
        next.focused = false
      }
      break
    case 'page-pointer-free':
      next.resizing = false
      next.pointerHeld = false
      break
    case 'sidebar-blur':
      next.focused = false
      break
    case 'sidebar-pointer':
      if (event.mouse === 'down') next.pointerHeld = true
      else if (event.mouse === 'up' || !event.buttonDown) {
        next.pointerHeld = false
        next.resizing = false
      }
      break
    case 'menu':
      next.menuOpen = event.open
      // A menu opened by a press (a context menu on mousedown) swallows that press's mouseup.
      if (!event.open) next.pointerHeld = false
      break
    case 'cursor-outside':
      if (autoHide && !state.resizing && !state.pointerHeld && !state.menuOpen && event.outsideMs >= SIDEBAR_CURSOR_OUTSIDE_GRACE_MS) {
        next.hovered = false
      }
      break
  }
  const before = sidebarRevealLocks(state)
  const after = new Set(sidebarRevealLocks(next))
  const released = before.filter((lock) => !after.has(lock))
  const changed = (Object.keys(next) as (keyof SidebarRevealState)[]).some((key) => next[key] !== state[key])
  return { state: changed ? next : state, released }
}

/** Should the cursor poll run? Only while a hover is what keeps an auto-hide sidebar up. */
export function sidebarCursorPollWanted(state: SidebarRevealState, overlayShown: boolean): boolean {
  return overlayShown && !state.pinned && state.mode === 'tabs' && state.hovered
}

export interface CursorRect {
  x: number
  y: number
  width: number
  height: number
}

/** Is the cursor (window content coordinates) over the sidebar's view, with a little slack? */
export function cursorOverSidebar(cursor: { x: number; y: number }, sidebar: CursorRect, slack = SIDEBAR_CURSOR_SLACK_PX): boolean {
  if (sidebar.width <= 0 || sidebar.height <= 0) return false
  // The view's left edge is the window edge (x may be negative mid-slide): left of 0 is outside the window.
  const right = sidebar.x + sidebar.width + slack
  return cursor.x >= Math.min(0, sidebar.x) - slack && cursor.x < right && cursor.y >= sidebar.y - slack && cursor.y < sidebar.y + sidebar.height + slack
}

/** One line for the debug log. */
export function formatSidebarLockLog(cause: string, state: SidebarRevealState, released: readonly SidebarRevealLock[] = []): string {
  const locks = sidebarRevealLocks(state)
  return `[sidebar-lock] ${cause}: locks=[${locks.join(',') || 'none'}]${released.length > 0 ? ` released=[${released.join(',')}]` : ''}`
}

/** SURFFISH_DEBUG_SIDEBAR=1 (or true/yes/on) turns the lock log on. */
export function parseSidebarLockDebug(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? '')
}
