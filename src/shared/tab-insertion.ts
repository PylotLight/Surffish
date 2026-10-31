/**
 * Where a tab opened in the background lands in the window's tab list.
 *
 * Right after the active tab, so related opens (⌘-clicked links, ⌘+Enter, popups) stay
 * adjacent to the tab the user is working in instead of piling up at the end of the tab list.
 * The index may be one past the end when the active tab is last: createTab appends when the
 * index doesn't fit, which is the same slot. `undefined` = append (no active tab, or the
 * active tab isn't in this window's list).
 */
export function backgroundTabInsertIndex(
  tabs: ReadonlyArray<{ id: string }>,
  activeTabId: string | null,
): number | undefined {
  if (activeTabId === null) return undefined;
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  return index >= 0 ? index + 1 : undefined;
}
