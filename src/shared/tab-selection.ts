/**
 * Multi-select in the sidebar tab list (Chrome style): Cmd-click (Ctrl-click on Windows / Linux)
 * toggles a tab, Shift-click selects a range from the anchor, a plain click clears the selection
 * and opens the tab, Escape clears it.
 *
 * Pure model, no Electron or DOM, so it is unit tested. The selection holds sidebar entry keys (a
 * tab id, or a split's first tab id: a split is one entry and is selected as a whole); group
 * header keys (`group:<id>`) are never selectable. Like Chrome, the active tab joins the selection
 * the moment you start one, so Cmd-clicking a second tab selects two.
 */

export interface TabSelection {
  /** Selected entry keys, in sidebar order. */
  keys: string[];
  /** Where the next Shift-click range starts: the last Cmd-clicked entry, else the active tab. */
  anchor: string | null;
}

export const EMPTY_TAB_SELECTION: TabSelection = Object.freeze({
  keys: [],
  anchor: null,
}) as TabSelection;

export interface SelectionModifiers {
  /** Cmd on macOS, Ctrl elsewhere: toggle one entry. */
  toggle: boolean;
  /** Shift: select a range. */
  range: boolean;
}

/** Which selection gesture a click is. On macOS Ctrl-click is a right-click, so only Cmd toggles there. */
export function selectionModifiers(
  event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  isMac: boolean,
): SelectionModifiers {
  return {
    toggle: isMac ? event.metaKey : event.ctrlKey,
    range: event.shiftKey,
  };
}

const isHeaderKey = (key: string): boolean => key.startsWith("group:");

/** `keys` deduped and put in sidebar `order`; keys not in the order are dropped. */
function inOrder(keys: Iterable<string>, order: readonly string[]): string[] {
  const wanted = new Set(keys);
  return order.filter((key) => wanted.has(key) && !isHeaderKey(key));
}

/** A selection that is only the active tab is no selection at all. */
function settle(
  keys: string[],
  anchor: string | null,
  activeKey: string | null,
): TabSelection {
  if (keys.length === 0 || (keys.length === 1 && keys[0] === activeKey))
    return { keys: [], anchor };
  return { keys, anchor };
}

/**
 * Apply a click on entry `key`. `order` is the sidebar's selectable order (header keys are ignored),
 * `activeKey` the active tab's entry. Returns the new selection and whether the click should open
 * the tab (only a plain click does).
 */
export function clickTabSelection(
  selection: TabSelection,
  order: readonly string[],
  key: string,
  modifiers: SelectionModifiers,
  activeKey: string | null,
): { selection: TabSelection; activate: boolean } {
  if (isHeaderKey(key) || !order.includes(key))
    return { selection, activate: false };
  // A plain click: the opened tab becomes the next range anchor (via activeKey).
  if (!modifiers.toggle && !modifiers.range)
    return { selection: EMPTY_TAB_SELECTION, activate: true };
  // Starting a selection takes the active tab along (Chrome).
  const base =
    selection.keys.length > 0
      ? selection.keys
      : activeKey && order.includes(activeKey)
        ? [activeKey]
        : [];
  if (modifiers.range) {
    const anchor =
      selection.anchor && order.includes(selection.anchor)
        ? selection.anchor
        : activeKey && order.includes(activeKey)
          ? activeKey
          : key;
    const selectable = order.filter((candidate) => !isHeaderKey(candidate));
    const from = selectable.indexOf(anchor);
    const to = selectable.indexOf(key);
    const range = selectable.slice(Math.min(from, to), Math.max(from, to) + 1);
    // Cmd+Shift adds the range to what is selected; Shift alone replaces it.
    const keys = inOrder(modifiers.toggle ? [...base, ...range] : range, order);
    return { selection: settle(keys, anchor, activeKey), activate: false };
  }
  const next = new Set(base);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return {
    selection: settle(inOrder(next, order), key, activeKey),
    activate: false,
  };
}

/** Drop entries that left the sidebar (closed, pinned, collapsed away, moved to another window or Space). Same object when nothing changed. */
export function pruneTabSelection(
  selection: TabSelection,
  order: readonly string[],
  activeKey: string | null = null,
): TabSelection {
  if (
    selection.keys.length === 0 &&
    (selection.anchor === null || order.includes(selection.anchor))
  )
    return selection;
  const keys = inOrder(selection.keys, order);
  const anchor =
    selection.anchor && order.includes(selection.anchor)
      ? selection.anchor
      : null;
  const next = settle(keys, anchor, activeKey);
  return next.keys.length === selection.keys.length &&
    next.keys.every(
      (candidate, index) => candidate === selection.keys[index],
    ) &&
    next.anchor === selection.anchor
    ? selection
    : next;
}

/** Tab ids of the selection: a split entry stands for all its panes. In order, deduped. */
export function selectedTabIds(
  selection: TabSelection,
  panesOf: (key: string) => readonly string[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const key of selection.keys) {
    for (const id of panesOf(key)) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Sanitise ids from the renderer: strings, deduped, capped. */
export function normalizeSelectedTabIds(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && id.length > 0 && id.length <= 200,
      ),
    ),
  ].slice(0, limit);
}

/**
 * The selected ids a right-click on `clickedId` acts on: the whole selection when it holds at
 * least two tabs and the clicked one is in it; otherwise null (the normal one-tab menu).
 */
export function selectionMenuTarget(
  selectedIds: readonly string[],
  clickedId: string,
): string[] | null {
  return selectedIds.length >= 2 && selectedIds.includes(clickedId)
    ? [...selectedIds]
    : null;
}

export interface SelectionTab {
  id: string;
  pinned: boolean;
  groupId: string | null;
}

export interface SelectionGroupChoice {
  id: string;
  label: string;
  count: number;
}

export interface SelectionMenuPlan {
  count: number;
  /** "Group 3 Tabs": a new group with every selected (unpinned) tab; grouped ones move over. */
  groupLabel: string;
  canGroup: boolean;
  /** "Add 3 Tabs to Group ▸": groups that the selection isn't already wholly in. */
  addTargets: SelectionGroupChoice[];
  /** "Remove from Groups" when any selected tab is grouped. */
  canUngroup: boolean;
  pinLabel: string;
  canPin: boolean;
  closeLabel: string;
  moveLabel: string;
  /** Something has to stay behind in the window. */
  canMoveToNewWindow: boolean;
}

const tabsLabel = (count: number): string =>
  `${count} Tab${count === 1 ? "" : "s"}`;

/** What the multi-select context menu offers for `tabs` (the selected tabs, in order). */
export function selectionMenuPlan(
  tabs: readonly SelectionTab[],
  groups: readonly SelectionGroupChoice[],
  windowTabCount: number,
): SelectionMenuPlan {
  const count = tabs.length;
  const groupable = tabs.filter((tab) => !tab.pinned);
  const groupIds = new Set(groupable.map((tab) => tab.groupId));
  const onlyGroup = groupIds.size === 1 ? ([...groupIds][0] ?? null) : null;
  return {
    count,
    groupLabel: `Group ${tabsLabel(groupable.length)}`,
    canGroup: groupable.length > 0,
    addTargets:
      groupable.length > 0
        ? groups.filter((group) => group.id !== onlyGroup)
        : [],
    canUngroup: groupable.some((tab) => tab.groupId !== null),
    pinLabel: `Pin ${tabsLabel(groupable.length)}`,
    canPin: groupable.length > 0,
    closeLabel: `Close ${tabsLabel(count)}`,
    moveLabel: `Move ${tabsLabel(count)} to New Window`,
    canMoveToNewWindow: count > 0 && count < windowTabCount,
  };
}
