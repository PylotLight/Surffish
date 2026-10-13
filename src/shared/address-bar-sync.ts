/**
 * When the address bar should show the active tab's URL and when it should keep what the user typed.
 *
 * The old rule was "never overwrite while `document.activeElement` is the input". But the toolbar is
 * its own WebContentsView, and Chromium keeps `activeElement` pointing at the input after focus moves
 * to another view (the page, an extension popup, a site menu, another window): the input gets a
 * `blur` event, `activeElement` stays put, and every later URL change was ignored. Redirects and
 * SPA navigations after a login left the bar stuck on e.g. `/auth`.
 *
 * Chrome's rule instead: the bar only keeps its own text while the user is really typing in it,
 * i.e. the input is focused, its document has focus, and the text differs from the URL it was last
 * synced to. Anything else follows the tab.
 */

export type AddressSyncReason =
  /** The active tab's URL (or New Tab state) changed. */
  | 'url'
  /** The input lost focus (to the page, another view, another window, or a toolbar button). */
  | 'blur'
  /** Another tab became active: whatever was typed belonged to the old one. */
  | 'tab'

export interface AddressSyncInput {
  /** What the input shows now. */
  value: string
  /** The tab URL the input was last set to (what "unedited" means). */
  synced: string
  /** What the tab wants shown now ('' on the local New Tab page). */
  next: string
  /** The input is the active element *and* its document has focus. */
  typing: boolean
  reason: AddressSyncReason
}

/** What the address bar shows on a tab: nothing on the local New Tab page, otherwise its URL. */
export function addressDisplayValue(url: string, isLocalNewTab: boolean): string {
  return isLocalNewTab ? '' : url
}

/** The user changed the text since it was last synced from the tab. */
export function isAddressEdited(value: string, synced: string): boolean {
  return value !== synced
}

/** True only while the user can actually be typing into `input` (not just "it was the last focus"). */
export function isTypingIn(input: unknown, doc: { activeElement: unknown; hasFocus(): boolean }): boolean {
  return input !== null && input !== undefined && doc.activeElement === input && doc.hasFocus()
}

/** The value the address bar should switch to, or null to keep what it shows. */
export function nextAddressValue({ value, synced, next, typing, reason }: AddressSyncInput): string | null {
  const edited = isAddressEdited(value, synced)
  if (reason === 'tab') return value === next ? null : next
  // Keep half-typed text while the user is typing, and (like Chrome) when they click away from it;
  // a navigation that happens after they left the bar replaces it.
  if (edited && (typing || reason === 'blur')) return null
  return value === next ? null : next
}
