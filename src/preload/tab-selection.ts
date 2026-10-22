import { ipcRenderer } from "electron";

/** window.api.browser.tabSelection: the sidebar's multi-select, mirrored to main for menus and shortcuts. */
export const tabSelectionApi = {
  /** Report the selected tab ids (split panes expanded); [] clears. */
  set: (tabIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke("browser:tab-selection:set", tabIds),
  /** Group the selected tabs (2+); returns the new group id. */
  group: (): Promise<string | null> =>
    ipcRenderer.invoke("browser:tab-selection:group"),
  /** Main finished a bulk action (or Clear Selection): drop the selection. */
  onClear: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("browser:tab-selection:clear", listener);
    return () =>
      ipcRenderer.removeListener("browser:tab-selection:clear", listener);
  },
};
