# Tab groups

Chrome/Arc-style groups in the sidebar: named, coloured, collapsible. Work the same with Spaces on or off.

- **Make / edit**: tab menu → Add Tab to New Group / Add Tab to Group ▸ / Remove from Group; palette (`group.*` commands, incl. "Add Tab to Group: …"). Header: click = collapse/expand, double-click or F2 = rename inline, right-click = Rename, Close Group, Colour, Collapse, New Tab in Group, Ungroup, Move Group to New Window / another window.
- **Drag**: drop a tab just under a group's header or between two of its tabs to join; anywhere else (incl. just after its last tab) is outside. Drag the header to move the whole group, or out of the window to tear it into a new one (or onto another window).
- **Rules** (`src/shared/tab-groups.ts`): a group is one contiguous run; pinned tabs are never grouped; a split's panes are always in the same group (grouping/ungrouping one pane takes the split); a group's tabs share one Space; moving a tab to another Space or window takes it out of its group (moving the whole group keeps it).
- Collapsing the group with the active tab moves you to the next tab outside it; opening a tab inside a collapsed group expands it.
- **Session**: `windows[].groups: [{ tabs: [indexes], name, color, collapsed }]`, left out when there are none, so older files/builds are unaffected.
- **Archive**: archived tabs keep their group's name and colour (shown in the tooltip); restoring doesn't recreate the group.
