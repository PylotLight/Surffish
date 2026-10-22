import { ipcRenderer } from "electron";
import type { TabGroupColor } from "../shared/tab-groups";

/** window.api.browser.tabGroups: tab groups in the sidebar (membership comes on the tab summaries). */
export const tabGroupsApi = {
  create: (
    tabIds: string[],
    input?: { name?: string; color?: TabGroupColor },
  ): Promise<string | null> =>
    ipcRenderer.invoke("browser:tab-groups:create", tabIds, input),
  add: (tabIds: string[], groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:add", tabIds, groupId),
  remove: (tabIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:remove", tabIds),
  update: (
    groupId: string,
    patch: { name?: string; color?: TabGroupColor; collapsed?: boolean },
  ): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:update", groupId, patch),
  toggle: (groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:toggle", groupId),
  ungroup: (groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:ungroup", groupId),
  /** Asks first (native dialog) when the group has more than one tab. */
  close: (groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:close", groupId),
  /** Drag a group header: the whole group lands before `beforeId` (a tab id) or at the end. */
  move: (groupId: string, beforeId: string | null): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:move", groupId, beforeId),
  moveToNewWindow: (groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:move-to-new-window", groupId),
  dropOutside: (groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:drop-outside", groupId),
  showMenu: (groupId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:menu", groupId),
  /** Sidebar tab drop: position plus the group it landed in (null = outside every group). */
  moveTab: (
    id: string,
    beforeId: string | null,
    groupId: string | null,
  ): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-groups:move-tab", id, beforeId, groupId),
  onRenameRequest: (callback: (groupId: string) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      groupId: string,
    ): void => callback(groupId);
    ipcRenderer.on("browser:tab-groups:rename", listener);
    return () =>
      ipcRenderer.removeListener("browser:tab-groups:rename", listener);
  },
};
