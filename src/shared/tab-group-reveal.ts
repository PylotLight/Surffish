/**
 * Which tab groups were just expanded, so the sidebar can ease their rows in (the rows mount on
 * expand; without this they pop in). Pure: the renderer hook keeps the previous snapshot.
 */
export type GroupCollapseSnapshot = ReadonlyMap<string, boolean>

/** group id -> collapsed, from the tabs' group info (any member tab carries it). */
export function groupCollapseSnapshot(tabs: readonly { group?: { id: string; collapsed: boolean } }[]): Map<string, boolean> {
  const snapshot = new Map<string, boolean>()
  for (const tab of tabs) if (tab.group && !snapshot.has(tab.group.id)) snapshot.set(tab.group.id, tab.group.collapsed)
  return snapshot
}

/** Groups that were collapsed in `previous` and are expanded in `next` (new groups don't count). */
export function newlyExpandedGroups(previous: GroupCollapseSnapshot, next: GroupCollapseSnapshot): string[] {
  const expanded: string[] = []
  for (const [id, collapsed] of next) if (!collapsed && previous.get(id) === true) expanded.push(id)
  return expanded
}
