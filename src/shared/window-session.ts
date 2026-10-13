import { MAX_RESTORED_TABS, normalizeBrowserSession, parseBrowserSession } from './persistence'
import { parseSavedWindowState, type SavedWindowState } from './window-geometry'
import { parseSessionSplits, remapSessionSplits, type SavedSplit } from './split-view'
import { parseSavedWindowSpaces, remapSavedWindowSpaces, type SavedWindowSpaces } from './spaces'
import { parseSavedTabGroups, remapSavedTabGroups, type SavedTabGroup } from './tab-groups'

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
  /** Split views (indexes into `urls`); left out when there are none, so older files read the same. */
  splits?: SavedSplit[]
  /** Which Space each tab is in (spaces.ts); left out when everything is in Default. */
  spaces?: SavedWindowSpaces
  /** Tab groups (indexes into `urls`, tab-groups.ts); left out when there are none. */
  groups?: SavedTabGroup[]
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
  splits?: readonly SavedSplit[]
  spaces?: SavedWindowSpaces | null
  groups?: readonly SavedTabGroup[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampFocused(index: number, count: number): number {
  if (count === 0) return 0
  return Number.isInteger(index) && index >= 0 && index < count ? index : count - 1
}

/**
 * Splits re-pointed at the tabs normalizeBrowserSession kept (it drops unsafe URLs and caps the
 * list): a tab is kept when it survives normalisation on its own, in the same order.
 */
function keptIndexMap(window: SessionWindowInput, keptCount: number): Map<number, number> {
  const newIndex = new Map<number, number>()
  let next = 0
  window.urls.forEach((url, index) => {
    if (index < MAX_RESTORED_TABS && next < keptCount && normalizeBrowserSession([url], 0).urls.length === 1) newIndex.set(index, next++)
  })
  return newIndex
}

/** Space ids re-pointed the same way as splits; null when every kept tab is in Default. */
function normalizeSpaces(window: SessionWindowInput, keptCount: number): SavedWindowSpaces | null {
  if (!window.spaces) return null
  const valid = parseSavedWindowSpaces(window.spaces, window.urls.length)
  const newIndex = keptIndexMap(window, keptCount)
  return remapSavedWindowSpaces(valid, (index) => newIndex.get(index) ?? -1, keptCount)
}

function normalizeGroups(window: SessionWindowInput, keptCount: number, pinnedIndexes: readonly number[]): SavedTabGroup[] {
  if (!window.groups || window.groups.length === 0) return []
  const valid = parseSavedTabGroups(window.groups, window.urls.length)
  const newIndex = keptIndexMap(window, keptCount)
  return parseSavedTabGroups(remapSavedTabGroups(valid, (index) => newIndex.get(index) ?? -1), keptCount, pinnedIndexes)
}

function normalizeSplits(window: SessionWindowInput, keptCount: number, pinnedIndexes: readonly number[]): SavedSplit[] {
  if (!window.splits || window.splits.length === 0) return []
  const newIndex = keptIndexMap(window, keptCount)
  // Validate first (this also reads untrusted values from disk), then re-point.
  const valid = parseSessionSplits(window.splits, window.urls.length)
  const remapped = remapSessionSplits(valid, (index) => newIndex.get(index) ?? -1)
  return parseSessionSplits(remapped, keptCount, pinnedIndexes)
}

/** Clean up windows to save: safe URLs only, windows left without tabs are dropped. */
export function normalizeWindowsSession(windows: readonly SessionWindowInput[], focusedIndex: number): SavedWindowsSession {
  const kept: SavedSessionWindow[] = []
  let focused = -1
  windows.slice(0, MAX_RESTORED_WINDOWS).forEach((window, index) => {
    const session = normalizeBrowserSession(window.urls, window.activeIndex, window.pinnedIndexes)
    if (session.urls.length === 0) return
    if (index === focusedIndex) focused = kept.length
    const splits = normalizeSplits(window, session.urls.length, session.pinnedIndexes)
    const spaces = normalizeSpaces(window, session.urls.length)
    const groups = normalizeGroups(window, session.urls.length, session.pinnedIndexes)
    kept.push({ ...session, geometry: window.geometry ? parseSavedWindowState(window.geometry) : null, ...(splits.length > 0 ? { splits } : {}), ...(spaces ? { spaces } : {}), ...(groups.length > 0 ? { groups } : {}) })
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
      ...(window.splits && window.splits.length > 0 ? { splits: window.splits } : {}),
      ...(window.spaces ? { spaces: window.spaces } : {}),
      ...(window.groups && window.groups.length > 0 ? { groups: window.groups } : {}),
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
      geometry: parseSavedWindowState(window),
      splits: Array.isArray(window.splits) ? window.splits as SavedSplit[] : [],
      spaces: parseSavedWindowSpaces(window.spaces, Array.isArray(window.tabs) ? window.tabs.length : 0),
      groups: Array.isArray(window.groups) ? window.groups as SavedTabGroup[] : []
    }))
    const focused = typeof value.focusedWindow === 'number' ? value.focusedWindow : windows.length - 1
    const session = normalizeWindowsSession(windows, focused)
    if (session.windows.length > 0) return session
  }
  // Older single-window file (or nothing saved yet).
  const legacy = parseBrowserSession(value)
  return { windows: [{ ...legacy, geometry: legacyGeometry }], focusedIndex: 0 }
}
