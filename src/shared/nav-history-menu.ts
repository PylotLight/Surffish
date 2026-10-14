/**
 * Back/Forward history menu (press-and-hold or right-click on the toolbar's Back or Forward
 * button, like Chrome): which of a tab's navigation entries it lists and in what order.
 * Pure so it can be unit tested; main reads `webContents.navigationHistory` and the toolbar
 * renders the result.
 */

export type NavHistoryDirection = 'back' | 'forward'

/** How long Back/Forward must be held before the menu opens instead of a plain Back. */
export const NAV_HISTORY_HOLD_MS = 450

/** Rows the menu lists (Chrome shows about this many); older entries live in History. */
export const NAV_HISTORY_MENU_LIMIT = 15

export interface NavHistorySourceEntry {
  url: string
  title: string
}

export interface NavHistoryMenuEntry {
  /** Index in the tab's navigation history (what `goToIndex` takes). */
  index: number
  /** Steps from the current entry: negative going back, positive going forward. */
  offset: number
  url: string
  /** The page title, or the URL when the page had none. */
  title: string
}

export interface NavHistoryMenu {
  direction: NavHistoryDirection
  entries: NavHistoryMenuEntry[]
  /** Entries in that direction in total (more than `entries.length` when capped). */
  total: number
}

/** What main sends the toolbar: the menu plus each entry's cached site icon (null when none is cached). */
export interface BrowserNavHistoryMenu extends NavHistoryMenu {
  entries: Array<NavHistoryMenuEntry & { faviconUrl: string | null }>
}

/** A title to show for an entry: its own, or the URL without the scheme noise when it had none. */
export function navHistoryTitle(entry: NavHistorySourceEntry): string {
  const title = typeof entry.title === 'string' ? entry.title.trim() : ''
  if (title && title !== entry.url) return title
  return entry.url.replace(/^https?:\/\//i, '').replace(/\/$/, '') || entry.url
}

/**
 * The menu for `direction`: back entries newest first (the one Back would go to on top), forward
 * entries nearest first, capped at `limit`.
 */
export function navHistoryMenu(entries: readonly NavHistorySourceEntry[], activeIndex: number, direction: NavHistoryDirection, limit = NAV_HISTORY_MENU_LIMIT): NavHistoryMenu {
  const empty: NavHistoryMenu = { direction, entries: [], total: 0 }
  if (!Array.isArray(entries) || !Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= entries.length) return empty
  const indexes: number[] = []
  if (direction === 'back') for (let index = activeIndex - 1; index >= 0; index -= 1) indexes.push(index)
  else for (let index = activeIndex + 1; index < entries.length; index += 1) indexes.push(index)
  const cap = Math.max(0, Math.floor(limit))
  return {
    direction,
    total: indexes.length,
    entries: indexes.slice(0, cap).map((index) => ({
      index,
      offset: index - activeIndex,
      url: entries[index].url,
      title: navHistoryTitle(entries[index])
    }))
  }
}

/** Whether `index` is a real entry the tab can move to (not the current one). */
export function isNavHistoryTarget(index: unknown, length: number, activeIndex: number): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < length && index !== activeIndex
}

export type NavHistoryOpenDisposition = 'current' | 'background-tab' | 'foreground-tab'

/** Chrome's rules for a menu row: plain click navigates the tab, Cmd/Ctrl- or middle-click opens a new tab (Shift brings it to the front). */
export function navHistoryDisposition(input: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, isMac: boolean): NavHistoryOpenDisposition {
  const modifier = isMac ? input.metaKey : input.ctrlKey
  if (input.button === 1 || (input.button === 0 && modifier)) return input.shiftKey ? 'foreground-tab' : 'background-tab'
  return 'current'
}

export function isNavHistoryDisposition(value: unknown): value is NavHistoryOpenDisposition {
  return value === 'current' || value === 'background-tab' || value === 'foreground-tab'
}
