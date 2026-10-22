import { ipcRenderer } from "electron";
import type {
  NewSpaceInput,
  SpaceDefinition,
  SpacePatch,
  SpacesSnapshot,
} from "../shared/spaces";

/** window.api.browser.spaces: the Space switcher at the bottom of the sidebar (window-scoped). */
export const spacesApi = {
  get: (): Promise<SpacesSnapshot> => ipcRenderer.invoke("browser:spaces:get"),
  switch: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:spaces:switch", id),
  create: (input?: NewSpaceInput): Promise<string | null> =>
    ipcRenderer.invoke("browser:spaces:create", input),
  update: (id: string, patch: SpacePatch): Promise<SpaceDefinition | null> =>
    ipcRenderer.invoke("browser:spaces:update", id, patch),
  /** Asks first (native dialog) when the Space has tabs. */
  remove: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:spaces:delete", id),
  /** Turning off with tabs in other Spaces asks first; resolves to the setting in force afterwards. */
  setEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("browser:spaces:set-enabled", enabled),
  moveTab: (tabId: string, spaceId: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:spaces:move-tab", tabId, spaceId),
  showMenu: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("browser:spaces:menu", id),
  onChange: (callback: (snapshot: SpacesSnapshot) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: SpacesSnapshot,
    ): void => callback(snapshot);
    ipcRenderer.on("browser:spaces", listener);
    return () => ipcRenderer.removeListener("browser:spaces", listener);
  },
  /** The Space menu's "Rename…": start the inline editor for that Space. */
  onRenameRequest: (callback: (id: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string): void =>
      callback(id);
    ipcRenderer.on("browser:spaces:rename", listener);
    return () => ipcRenderer.removeListener("browser:spaces:rename", listener);
  },
};
