/**
 * Tab groups (Chrome / Arc style): named, coloured, collapsible runs of tabs in the sidebar.
 *
 * Pure model, no Electron, so it is unit tested and shared by main and the sidebar. A group lives
 * in its window's state; each tab carries a group id or null. The rules (normalizeTabGroups):
 * - a group's tabs are contiguous in the window's tab order (the sidebar draws them as one run);
 * - pinned tabs are never in a group (they live in the Favourites strip);
 * - every pane of a split is in the same group (a split is one sidebar entry);
 * - a group's tabs share one Space (the first tab's); others leave it;
 * - a group without tabs is dropped.
 * Groups work the same with Spaces on or off.
 */

export const TAB_GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

export const TAB_GROUP_COLOR_VALUES: Record<TabGroupColor, string> = {
  grey: "#8a8f98",
  blue: "#3b82f6",
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  pink: "#ec4899",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
  orange: "#f97316",
};

export const MAX_TAB_GROUP_NAME_LENGTH = 40;

export interface TabGroup {
  id: string;
  /** May be empty (Chrome lets a group be just a colour). */
  name: string;
  color: TabGroupColor;
  collapsed: boolean;
}

/** Group membership as the sidebar sees it (on BrowserTabSummary). */
export interface TabGroupInfo {
  id: string;
  name: string;
  color: TabGroupColor;
  collapsed: boolean;
  /** Position in the group (0 = first) and the group's size. */
  index: number;
  count: number;
}

/** What the grouping rules need to know about a tab. */
export interface GroupableTab {
  id: string;
  groupId: string | null;
  pinned: boolean;
  spaceId: string;
  /** Split view id, when the tab is a pane. */
  splitId: string | null;
}

export function isTabGroupColor(value: unknown): value is TabGroupColor {
  return (
    typeof value === "string" &&
    (TAB_GROUP_COLORS as readonly string[]).includes(value)
  );
}

export function normalizeTabGroupName(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TAB_GROUP_NAME_LENGTH)
        .trim()
    : "";
}

/** Chrome's habit: the next colour round the palette that isn't in use yet. */
export function nextTabGroupColor(groups: readonly TabGroup[]): TabGroupColor {
  const used = new Set(groups.map((group) => group.color));
  return (
    TAB_GROUP_COLORS.find((color) => color !== "grey" && !used.has(color)) ??
    TAB_GROUP_COLORS[(groups.length % (TAB_GROUP_COLORS.length - 1)) + 1]!
  );
}

export function createTabGroup(
  id: string,
  groups: readonly TabGroup[],
  input: { name?: unknown; color?: unknown } = {},
): TabGroup {
  return {
    id,
    name: normalizeTabGroupName(input.name),
    color: isTabGroupColor(input.color)
      ? input.color
      : nextTabGroupColor(groups),
    collapsed: false,
  };
}

export function updateTabGroup(
  group: TabGroup,
  patch: { name?: unknown; color?: unknown; collapsed?: unknown },
): TabGroup {
  return {
    ...group,
    ...(patch.name !== undefined
      ? { name: normalizeTabGroupName(patch.name) }
      : {}),
    ...(isTabGroupColor(patch.color) ? { color: patch.color } : {}),
    ...(typeof patch.collapsed === "boolean"
      ? { collapsed: patch.collapsed }
      : {}),
  };
}

/** "Work" or, unnamed, "Blue group"; plus the tab count for menus. */
export function tabGroupLabel(group: Pick<TabGroup, "name" | "color">): string {
  return (
    group.name ||
    `${group.color[0]!.toUpperCase()}${group.color.slice(1)} group`
  );
}

/**
 * Apply the rules above. Returns the tab order (ids), each tab's group and the groups still in use
 * (in order of first appearance). Never reorders tabs that aren't grouped relative to each other.
 */
export function normalizeTabGroups(
  tabs: readonly GroupableTab[],
  groups: readonly TabGroup[],
): {
  order: string[];
  groupOf: Map<string, string | null>;
  groups: TabGroup[];
} {
  const known = new Map(groups.map((group) => [group.id, group]));
  const groupOf = new Map<string, string | null>();
  const groupSpace = new Map<string, string>();
  for (const tab of tabs) {
    let groupId =
      tab.groupId && known.has(tab.groupId) && !tab.pinned ? tab.groupId : null;
    if (groupId) {
      const space = groupSpace.get(groupId);
      if (space === undefined) groupSpace.set(groupId, tab.spaceId);
      else if (space !== tab.spaceId) groupId = null;
    }
    groupOf.set(tab.id, groupId);
  }
  // Splits: every pane takes the group of the split's first pane in tab order.
  const splitGroup = new Map<string, string | null>();
  for (const tab of tabs) {
    if (!tab.splitId) continue;
    if (!splitGroup.has(tab.splitId))
      splitGroup.set(tab.splitId, groupOf.get(tab.id) ?? null);
    else groupOf.set(tab.id, splitGroup.get(tab.splitId) ?? null);
  }
  // Contiguity: each group's tabs gather at its first tab's position.
  const order: string[] = [];
  const placed = new Set<string>();
  const membersOf = new Map<string, string[]>();
  for (const tab of tabs) {
    const groupId = groupOf.get(tab.id);
    if (!groupId) continue;
    const list = membersOf.get(groupId) ?? [];
    list.push(tab.id);
    membersOf.set(groupId, list);
  }
  const used: TabGroup[] = [];
  for (const tab of tabs) {
    if (placed.has(tab.id)) continue;
    const groupId = groupOf.get(tab.id);
    if (!groupId) {
      order.push(tab.id);
      placed.add(tab.id);
      continue;
    }
    used.push(known.get(groupId)!);
    for (const id of membersOf.get(groupId) ?? []) {
      order.push(id);
      placed.add(id);
    }
  }
  return { order, groupOf, groups: used };
}

/** Sidebar info for one tab. */
export function tabGroupInfoFor(
  group: TabGroup | undefined,
  memberIds: readonly string[],
  tabId: string,
): TabGroupInfo | undefined {
  if (!group) return undefined;
  const index = memberIds.indexOf(tabId);
  if (index < 0) return undefined;
  return {
    id: group.id,
    name: group.name,
    color: group.color,
    collapsed: group.collapsed,
    index,
    count: memberIds.length,
  };
}

/**
 * Where a sidebar drop lands, from the order the sidebar shows after the drop (entry keys: a tab
 * id, a split's first tab id, or `group:<id>` for a group header). Just under a header (of an
 * expanded group) or between two tabs of a group joins it; anywhere else is outside every group.
 */
export function dropTargetGroup(
  order: readonly string[],
  movedKey: string,
  groupOfKey: (key: string) => string | null,
  isCollapsed: (groupId: string) => boolean,
): string | null {
  const index = order.indexOf(movedKey);
  if (index < 0) return null;
  const before = order[index - 1];
  const after = order[index + 1];
  if (before?.startsWith("group:")) {
    const id = before.slice("group:".length);
    return isCollapsed(id) ? null : id;
  }
  if (!before || !after || after.startsWith("group:")) return null;
  const a = groupOfKey(before);
  return a && a === groupOfKey(after) ? a : null;
}

// ---------------------------------------------------------------------------
// Session file

/** Per window in browser-session.json (indexes into `tabs`); left out when there are no groups. */
export interface SavedTabGroup {
  tabs: number[];
  name: string;
  color: TabGroupColor;
  collapsed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate untrusted groups against `tabCount` tabs: in range, no tab in two groups, no pinned tab, contiguous runs only. */
export function parseSavedTabGroups(
  value: unknown,
  tabCount: number,
  pinnedIndexes: readonly number[] = [],
): SavedTabGroup[] {
  if (!Array.isArray(value)) return [];
  const pinned = new Set(pinnedIndexes);
  const taken = new Set<number>();
  const groups: SavedTabGroup[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !Array.isArray(raw.tabs)) continue;
    const tabs = [
      ...new Set(
        raw.tabs.filter(
          (index): index is number =>
            typeof index === "number" &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < tabCount,
        ),
      ),
    ].sort((a, b) => a - b);
    if (
      tabs.length === 0 ||
      tabs.some((index) => taken.has(index) || pinned.has(index))
    )
      continue;
    if (tabs.some((index, at) => at > 0 && index !== tabs[at - 1]! + 1))
      continue;
    for (const index of tabs) taken.add(index);
    groups.push({
      tabs,
      name: normalizeTabGroupName(raw.name),
      color: isTabGroupColor(raw.color) ? raw.color : "grey",
      collapsed: raw.collapsed === true,
    });
  }
  return groups;
}

/** Re-point saved groups at the tabs that survived normalisation (`newIndex` -1 = dropped). */
export function remapSavedTabGroups(
  groups: readonly SavedTabGroup[],
  newIndex: (index: number) => number,
): SavedTabGroup[] {
  return groups
    .map((group) => ({
      ...group,
      tabs: group.tabs.map(newIndex).filter((index) => index >= 0),
    }))
    .filter((group) => group.tabs.length > 0);
}

/** Encode a window's groups for saving (`ids` = the saved tabs in order). */
export function encodeSessionTabGroups(
  ids: readonly string[],
  groupOf: (id: string) => string | null,
  groups: readonly TabGroup[],
): SavedTabGroup[] {
  return groups.flatMap((group) => {
    const tabs = ids.flatMap((id, index) =>
      groupOf(id) === group.id ? [index] : [],
    );
    return tabs.length > 0
      ? [
          {
            tabs,
            name: group.name,
            color: group.color,
            collapsed: group.collapsed,
          },
        ]
      : [];
  });
}

// ---------------------------------------------------------------------------
// Sidebar entries

export interface TabGroupHeaderEntry {
  kind: "group";
  key: string;
  group: TabGroupInfo;
}

/**
 * Put a header entry (`group:<id>`) in front of each group's run of sidebar entries, and hide the
 * run while the group is collapsed. Entries keep their order; `groupOf` reads an entry's group.
 */
export function withGroupHeaders<E extends { key: string }>(
  entries: readonly E[],
  groupOf: (entry: E) => TabGroupInfo | undefined,
): (E | TabGroupHeaderEntry)[] {
  const result: (E | TabGroupHeaderEntry)[] = [];
  let current: string | null = null;
  for (const entry of entries) {
    const group = groupOf(entry);
    if (group && group.id !== current)
      result.push({ kind: "group", key: `group:${group.id}`, group });
    current = group?.id ?? null;
    if (!group?.collapsed) result.push(entry);
  }
  return result;
}
