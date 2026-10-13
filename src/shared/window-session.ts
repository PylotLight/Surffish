import { normalizeBrowserSession, parseBrowserSession } from './persistence'
import { parseSavedWindowState, type SavedWindowState } from './window-geometry'

/**
 * The saved session with several windows.
 *
 * On disk it stays a version 1 browser-session.json: the top-level `tabs` / `activeIndex` /
 * `pinnedTabs` mirror the focused window (so an older build still restores that one window), and
 * `windows` holds every window with its own tabs and geometry. A file without `windows` (written
 * by an older build) is one window, placed where window-state.json says.
 */

export const MAX_RESTORED_WINDOWS = 12

export interface SavedSessionWindow {
  urls: string[]
  activeIndex: number
  pinnedIndexes: number[]
  /** Size/position/maximized; null lets the window open at the default place. */
  geometry: SavedWindowState | null
}

export interface SavedWindowsSession {
  windows: SavedSessionWindow[]
  /** Which window was in front; it is restored last so it ends up focused. */
  focusedIndex: number
}

export interface SessionWindowInput {
  urls: readonly string[]
  activeIndex: number
  pinnedIndexes: readonly number[]
  geometry: SavedWindowState | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampFocused(index: number, count: number): number {
  if (count === 0) return 0
  return Number.isInteger(index) && index >= 0 && index < count ? index : count - 1
}

/** Clean up windows to save: safe URLs only, windows left without tabs are dropped. */
export function normalizeWindowsSession(windows: readonly SessionWindowInput[], focusedIndex: number): SavedWindowsSession {
  const kept: SavedSessionWindow[] = []
  let focused = -1
  windows.slice(0, MAX_RESTORED_WINDOWS).forEach((window, index) => {
    const session = normalizeBrowserSession(window.urls, window.activeIndex, window.pinnedIndexes)
    if (session.urls.length === 0) return
    if (index === focusedIndex) focused = kept.length
    kept.push({ ...session, geometry: window.geometry ? parseSavedWindowState(window.geometry) : null })
  })
  // A focused window that was dropped (or an out-of-range index) falls back to the last one.
  return { windows: kept, focusedIndex: clampFocused(focused, kept.length) }
}

/** What goes into browser-session.json. */
export function serializeWindowsSession(session: SavedWindowsSession): Record<string, unknown> {
  const focused = session.windows[session.focusedIndex] ?? session.windows[0]
  return {
    version: 1,
    tabs: focused?.urls ?? [],
    activeIndex: focused?.activeIndex ?? 0,
    pinnedTabs: focused?.pinnedIndexes ?? [],
    focusedWindow: session.focusedIndex,
    windows: session.windows.map((window) => ({
      tabs: window.urls,
      activeIndex: window.activeIndex,
      pinnedTabs: window.pinnedIndexes,
      ...(window.geometry ? { bounds: window.geometry.bounds, maximized: window.geometry.maximized, fullScreen: window.geometry.fullScreen } : {})
    }))
  }
}

/**
 * Read browser-session.json. `legacyGeometry` (window-state.json) places the single window of a
 * file from before multi-window. Always returns at least one window, possibly with no tabs.
 */
export function parseWindowsSession(value: unknown, legacyGeometry: SavedWindowState | null = null): SavedWindowsSession {
  if (isRecord(value) && value.version === 1 && Array.isArray(value.windows) && value.windows.length > 0) {
    const windows = value.windows.slice(0, MAX_RESTORED_WINDOWS).filter(isRecord).map((window) => ({
      urls: Array.isArray(window.tabs) ? window.tabs.map((url) => typeof url === 'string' ? url : '') : [],
      activeIndex: typeof window.activeIndex === 'number' ? window.activeIndex : 0,
      pinnedIndexes: Array.isArray(window.pinnedTabs) ? window.pinnedTabs.filter((index): index is number => typeof index === 'number' && Number.isInteger(index)) : [],
      geometry: parseSavedWindowState(window)
    }))
    const focused = typeof value.focusedWindow === 'number' ? value.focusedWindow : windows.length - 1
    const session = normalizeWindowsSession(windows, focused)
    if (session.windows.length > 0) return session
  }
  // Older single-window file (or nothing saved yet).
  const legacy = parseBrowserSession(value)
  return { windows: [{ ...legacy, geometry: legacyGeometry }], focusedIndex: 0 }
}
