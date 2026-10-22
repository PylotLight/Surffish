/**
 * Split view: two tabs' pages side by side in one window.
 *
 * Pure state + layout math (no Electron), so it is unit tested and shared by main and the sidebar.
 * The model takes 2..MAX_SPLIT_PANES panes left to right; the UI only creates two-pane splits for
 * now, but nothing here assumes two, so 3-4 pane layouts only need UI later.
 *
 * A split group lives in its window's state. The focused pane is simply the window's active tab
 * (so find, zoom, reader, screenshots, the address bar ... all act on it without knowing about
 * splits); `sizes` are the panes' shares of the usable width and always sum to 1.
 */
import type { BrowserBounds } from "./types";

export const MAX_SPLIT_PANES = 4;
/** Gap between two panes; the divider handle sits in it. */
export const SPLIT_DIVIDER_WIDTH = 8;
/** Margin around every pane; the focused pane's ring is drawn in it. */
export const SPLIT_PANE_INSET = 2;
/** No pane gets narrower than this share of the usable width (or MIN_SPLIT_PANE_PX, whichever is wider). */
export const MIN_SPLIT_PANE_FRACTION = 0.15;
export const MIN_SPLIT_PANE_PX = 220;
/** Dropping a dragged tab this close (share of the page width) to the page's left/right edge splits. */
export const SPLIT_DROP_EDGE_FRACTION = 0.35;

export interface SplitGroup {
  id: string;
  /** Pane order, left to right. */
  tabIds: string[];
  /** Share of the usable width per pane (same order), sums to 1. */
  sizes: number[];
}

/** Split membership as the sidebar sees it (on BrowserTabSummary). */
export interface TabSplitInfo {
  id: string;
  /** Pane position, 0 = left. */
  index: number;
  count: number;
}

export interface SplitLayout {
  /** Each pane's cell (pane rect plus its inset margin), left to right. */
  cells: BrowserBounds[];
  /** Where each page view goes. */
  panes: BrowserBounds[];
  /** Gap between pane i and i+1 (n-1 of them). */
  dividers: BrowserBounds[];
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

/** Sizes that are finite, positive, `count` long and sum to 1; anything off falls back to equal shares. */
export function normalizeSplitSizes(
  sizes: readonly unknown[] | null | undefined,
  count: number,
): number[] {
  if (count <= 0) return [];
  if (!Array.isArray(sizes) || sizes.length !== count) return equalSizes(count);
  const values = sizes.map((value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : NaN,
  );
  if (values.some((value) => Number.isNaN(value))) return equalSizes(count);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return equalSizes(count);
  const min = Math.min(MIN_SPLIT_PANE_FRACTION, 1 / count);
  // Clamp to the minimum, then take what that added back from the panes above it.
  let shares = values.map((value) => value / total);
  for (let pass = 0; pass < count; pass += 1) {
    const low = shares.map((share) => share < min - 1e-9);
    if (!low.some(Boolean)) break;
    const deficit = shares.reduce(
      (sum, share, index) => sum + (low[index] ? min - share : 0),
      0,
    );
    const spare = shares.reduce(
      (sum, share, index) => sum + (low[index] ? 0 : share - min),
      0,
    );
    shares = shares.map((share, index) =>
      low[index]
        ? min
        : share - (spare > 0 ? ((share - min) / spare) * deficit : 0),
    );
  }
  const sum = shares.reduce((acc, share) => acc + share, 0);
  return shares.map((share) => share / sum);
}

/** A new group, or null when the tabs can't form one (too few/many, duplicates). */
export function createSplitGroup(
  id: string,
  tabIds: readonly string[],
  sizes?: readonly number[],
): SplitGroup | null {
  if (
    tabIds.length < 2 ||
    tabIds.length > MAX_SPLIT_PANES ||
    new Set(tabIds).size !== tabIds.length ||
    tabIds.some((tabId) => !tabId)
  )
    return null;
  return {
    id,
    tabIds: [...tabIds],
    sizes: normalizeSplitSizes(sizes ?? null, tabIds.length),
  };
}

export function splitGroupOf(
  groups: readonly SplitGroup[],
  tabId: string | null | undefined,
): SplitGroup | undefined {
  return tabId
    ? groups.find((group) => group.tabIds.includes(tabId))
    : undefined;
}

export function splitInfoFor(
  groups: readonly SplitGroup[],
  tabId: string,
): TabSplitInfo | undefined {
  const group = splitGroupOf(groups, tabId);
  return group
    ? {
        id: group.id,
        index: group.tabIds.indexOf(tabId),
        count: group.tabIds.length,
      }
    : undefined;
}

/**
 * Take a tab out of whatever split it is in. The freed width goes to its neighbour; a group left
 * with one pane dissolves. Returns the new group list and the tabs still showing with it (the
 * former partners, which the caller may want to focus).
 */
export function removeTabFromSplits(
  groups: readonly SplitGroup[],
  tabId: string,
): { groups: SplitGroup[]; partners: string[] } {
  const group = splitGroupOf(groups, tabId);
  if (!group) return { groups: [...groups], partners: [] };
  const index = group.tabIds.indexOf(tabId);
  const tabIds = group.tabIds.filter((id) => id !== tabId);
  const others = groups.filter((candidate) => candidate !== group);
  if (tabIds.length < 2) return { groups: others, partners: tabIds };
  const sizes = group.sizes.slice();
  const freed = sizes.splice(index, 1)[0] ?? 0;
  const neighbour = Math.min(index, sizes.length - 1);
  sizes[neighbour] = (sizes[neighbour] ?? 0) + freed;
  return {
    groups: [
      ...others,
      { ...group, tabIds, sizes: normalizeSplitSizes(sizes, tabIds.length) },
    ],
    partners: tabIds,
  };
}

/** Swap two panes' tabs; the layout (sizes) stays where it is. */
export function swapSplitPanes(group: SplitGroup, a = 0, b = 1): SplitGroup {
  if (
    a === b ||
    a < 0 ||
    b < 0 ||
    a >= group.tabIds.length ||
    b >= group.tabIds.length
  )
    return group;
  const tabIds = group.tabIds.slice();
  [tabIds[a], tabIds[b]] = [tabIds[b]!, tabIds[a]!];
  return { ...group, tabIds };
}

/** Put `nextId` where `oldId` is (Open in Split View on a window already showing a split). */
export function replaceSplitPane(
  group: SplitGroup,
  oldId: string,
  nextId: string,
): SplitGroup {
  const index = group.tabIds.indexOf(oldId);
  if (index < 0 || group.tabIds.includes(nextId)) return group;
  const tabIds = group.tabIds.slice();
  tabIds[index] = nextId;
  return { ...group, tabIds };
}

function usableWidth(bounds: BrowserBounds, count: number): number {
  return Math.max(0, bounds.width - SPLIT_DIVIDER_WIDTH * (count - 1));
}

/** Pixel rects for the panes and dividers inside `bounds` (window coordinates in, window coordinates out). */
export function splitPaneRects(
  bounds: BrowserBounds,
  sizes: readonly number[],
): SplitLayout {
  const count = sizes.length;
  if (count === 0) return { cells: [], panes: [], dividers: [] };
  const shares = normalizeSplitSizes(sizes, count);
  const usable = usableWidth(bounds, count);
  const cells: BrowserBounds[] = [];
  const dividers: BrowserBounds[] = [];
  let used = 0;
  let left = bounds.x;
  shares.forEach((share, index) => {
    used += share;
    // Round the running edge, not each width, so the last pane ends exactly at the right edge.
    const right =
      index === count - 1
        ? bounds.x + bounds.width
        : bounds.x + Math.round(usable * used) + SPLIT_DIVIDER_WIDTH * index;
    cells.push({
      x: left,
      y: bounds.y,
      width: Math.max(0, right - left),
      height: bounds.height,
    });
    if (index < count - 1) {
      dividers.push({
        x: right,
        y: bounds.y,
        width: SPLIT_DIVIDER_WIDTH,
        height: bounds.height,
      });
      left = right + SPLIT_DIVIDER_WIDTH;
    }
  });
  const panes = cells.map((cell) => ({
    x: cell.x + SPLIT_PANE_INSET,
    y: cell.y + SPLIT_PANE_INSET,
    width: Math.max(0, cell.width - SPLIT_PANE_INSET * 2),
    height: Math.max(0, cell.height - SPLIT_PANE_INSET * 2),
  }));
  return { cells, panes, dividers };
}

function inside(rect: BrowserBounds, x: number, y: number, slop = 0): boolean {
  return (
    x >= rect.x - slop &&
    x < rect.x + rect.width + slop &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

/** Index of the divider under (x, y), with a few pixels of slop either side, or -1. */
export function splitDividerAt(
  layout: SplitLayout,
  x: number,
  y: number,
  slop = 2,
): number {
  return layout.dividers.findIndex((divider) => inside(divider, x, y, slop));
}

/** Index of the pane (cell) under (x, y), or -1 (over a divider or outside). */
export function splitPaneAt(layout: SplitLayout, x: number, y: number): number {
  return layout.cells.findIndex((cell) => inside(cell, x, y));
}

/**
 * Drag divider `dividerIndex` so its centre sits at `x`: only the two panes either side change.
 * Each keeps at least the minimum width; returns new sizes.
 */
export function resizeSplitAt(
  bounds: BrowserBounds,
  sizes: readonly number[],
  dividerIndex: number,
  x: number,
): number[] {
  const count = sizes.length;
  const shares = normalizeSplitSizes(sizes, count);
  if (dividerIndex < 0 || dividerIndex >= count - 1 || !Number.isFinite(x))
    return shares;
  const usable = usableWidth(bounds, count);
  if (usable <= 0) return shares;
  const before = shares
    .slice(0, dividerIndex)
    .reduce((sum, share) => sum + share, 0);
  const cellStart =
    bounds.x + usable * before + SPLIT_DIVIDER_WIDTH * dividerIndex;
  const pair = shares[dividerIndex]! + shares[dividerIndex + 1]!;
  const min = Math.min(
    pair / 2,
    Math.max(MIN_SPLIT_PANE_FRACTION, MIN_SPLIT_PANE_PX / usable),
  );
  const wanted = (x - SPLIT_DIVIDER_WIDTH / 2 - cellStart) / usable;
  const left = Math.min(pair - min, Math.max(min, wanted));
  const next = shares.slice();
  next[dividerIndex] = left;
  next[dividerIndex + 1] = pair - left;
  return next;
}

/** Which page edge a drop at `x` lands on: the outer SPLIT_DROP_EDGE_FRACTION each side, else null. */
export function splitDropSide(
  bounds: BrowserBounds,
  x: number,
  y: number,
): "left" | "right" | null {
  if (bounds.width <= 0 || bounds.height <= 0 || !inside(bounds, x, y))
    return null;
  const fraction = (x - bounds.x) / bounds.width;
  if (fraction < SPLIT_DROP_EDGE_FRACTION) return "left";
  if (fraction > 1 - SPLIT_DROP_EDGE_FRACTION) return "right";
  return null;
}

/**
 * Tab order with every split's tabs next to each other, in pane order, where the group's first
 * tab appears. The sidebar shows a split as one entry, so its tabs must be adjacent.
 */
export function orderTabsForSplits(
  tabIds: readonly string[],
  groups: readonly SplitGroup[],
): string[] {
  const present = new Set(tabIds);
  const emitted = new Set<string>();
  const ordered: string[] = [];
  for (const id of tabIds) {
    if (emitted.has(id)) continue;
    const group = splitGroupOf(groups, id);
    const run = group
      ? group.tabIds.filter((member) => present.has(member))
      : [id];
    for (const member of run) {
      if (emitted.has(member)) continue;
      emitted.add(member);
      ordered.push(member);
    }
  }
  return ordered;
}

/** The most recently used tab (newest first in `recent`) other than `currentId` that passes `eligible`. */
export function pickLastUsedTab(
  recent: readonly string[],
  currentId: string | null,
  eligible: (id: string) => boolean,
): string | null {
  for (const id of recent) if (id !== currentId && eligible(id)) return id;
  return null;
}

/**
 * Which tab gets focus after moving `movedId` (alone, or with its split's `memberIds`) to another
 * window: the pane that was focused in the old window when it moved along, else the moved tab, else
 * the last member. Only this one tab is activated; focusing the other panes on the way would let
 * their late focus events steal it (seen on macOS).
 */
export function splitMoveFocusId(
  memberIds: readonly string[],
  activeTabId: string | null,
  movedId: string,
): string | null {
  if (activeTabId && memberIds.includes(activeTabId)) return activeTabId;
  if (memberIds.includes(movedId)) return movedId;
  return memberIds[memberIds.length - 1] ?? null;
}

/** Move `id` to the front of a most-recent-first list, capped. */
export function noteRecentTab(
  recent: readonly string[],
  id: string,
  cap = 50,
): string[] {
  return [id, ...recent.filter((candidate) => candidate !== id)].slice(0, cap);
}

export type TabEntry<T extends { id: string; split?: TabSplitInfo }> =
  | { kind: "tab"; key: string; tab: T }
  | { kind: "split"; key: string; splitId: string; tabs: T[] };

/** Sidebar rows: a run of tabs from the same split becomes one entry (keyed by its first tab). */
export function groupTabEntries<T extends { id: string; split?: TabSplitInfo }>(
  tabs: readonly T[],
): TabEntry<T>[] {
  const entries: TabEntry<T>[] = [];
  for (const tab of tabs) {
    const last = entries.at(-1);
    if (tab.split && last?.kind === "split" && last.splitId === tab.split.id) {
      last.tabs.push(tab);
      continue;
    }
    entries.push(
      tab.split
        ? { kind: "split", key: tab.id, splitId: tab.split.id, tabs: [tab] }
        : { kind: "tab", key: tab.id, tab },
    );
  }
  // A split with only one tab visible here (shouldn't happen) still shows as a plain row.
  return entries.map((entry) =>
    entry.kind === "split" && entry.tabs.length < 2
      ? { kind: "tab", key: entry.key, tab: entry.tabs[0]! }
      : entry,
  );
}

// ---------------------------------------------------------------------------
// Session file

/** One split in browser-session.json: indexes into that window's saved `tabs`, plus the sizes. */
export interface SavedSplit {
  tabs: number[];
  sizes: number[];
}

/** Splits to save, as indexes into `savedTabIds` (the tabs that are saved). Splits with an unsaved tab are dropped. */
export function encodeSessionSplits(
  savedTabIds: readonly string[],
  groups: readonly SplitGroup[],
): SavedSplit[] {
  const indexOf = new Map(savedTabIds.map((id, index) => [id, index]));
  return groups.flatMap((group) => {
    const tabs = group.tabIds.map((id) => indexOf.get(id) ?? -1);
    return tabs.some((index) => index < 0)
      ? []
      : [
          {
            tabs,
            sizes: normalizeSplitSizes(group.sizes, tabs.length).map(
              (size) => Math.round(size * 10_000) / 10_000,
            ),
          },
        ];
  });
}

/**
 * Validate splits read from disk against a window of `tabCount` tabs: integer, in-range, unpinned,
 * each tab in at most one split, 2..MAX panes. Anything else is dropped (the tabs stay, unsplit).
 */
export function parseSessionSplits(
  value: unknown,
  tabCount: number,
  pinnedIndexes: readonly number[] = [],
): SavedSplit[] {
  if (!Array.isArray(value)) return [];
  const pinned = new Set(pinnedIndexes);
  const used = new Set<number>();
  const splits: SavedSplit[] = [];
  for (const raw of value.slice(0, 64)) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      !Array.isArray((raw as { tabs?: unknown }).tabs)
    )
      continue;
    const tabs = (raw as { tabs: unknown[] }).tabs;
    if (tabs.length < 2 || tabs.length > MAX_SPLIT_PANES) continue;
    if (
      !tabs.every(
        (index): index is number =>
          typeof index === "number" &&
          Number.isInteger(index) &&
          index >= 0 &&
          index < tabCount &&
          !pinned.has(index),
      )
    )
      continue;
    if (
      new Set(tabs).size !== tabs.length ||
      tabs.some((index) => used.has(index))
    )
      continue;
    for (const index of tabs) used.add(index);
    splits.push({
      tabs: [...tabs],
      sizes: normalizeSplitSizes(
        (raw as { sizes?: unknown[] }).sizes,
        tabs.length,
      ),
    });
  }
  return splits;
}

/**
 * Re-point saved splits after tabs were dropped from the list (unsafe URLs, the tab cap):
 * `mapIndex(old)` gives the new index or -1. A split that lost a tab is dropped.
 */
export function remapSessionSplits(
  splits: readonly SavedSplit[],
  mapIndex: (index: number) => number,
): SavedSplit[] {
  return splits.flatMap((split) => {
    const tabs = split.tabs.map(mapIndex);
    return tabs.some((index) => index < 0)
      ? []
      : [{ tabs, sizes: split.sizes.slice() }];
  });
}
