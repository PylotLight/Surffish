import { ipcRenderer } from "electron";
import type { BookmarkNode, BookmarksSnapshot } from "../shared/types";
import type {
  BookmarkImportSource,
  BookmarkImportSummary,
  BookmarkMenuAction,
} from "../shared/bookmark-import";

/** window.api.browser.bookmarks: the bookmark tree, its edits, import/export. */
export const bookmarksApi = {
  get: (): Promise<BookmarksSnapshot> =>
    ipcRenderer.invoke("browser:bookmarks:get"),
  create: (request: {
    parentId?: string;
    title?: string;
    url: string;
    index?: number;
    faviconUrl?: string;
  }): Promise<BookmarkNode> =>
    ipcRenderer.invoke("browser:bookmarks:create", request),
  createFolder: (request: {
    parentId?: string;
    title?: string;
    index?: number;
  }): Promise<BookmarkNode> =>
    ipcRenderer.invoke("browser:bookmarks:create-folder", request),
  update: (
    id: string,
    patch: { title?: string; url?: string; parentId?: string },
  ): Promise<BookmarkNode> =>
    ipcRenderer.invoke("browser:bookmarks:update", id, patch),
  move: (ids: string[], parentId: string, index?: number): Promise<number> =>
    ipcRenderer.invoke("browser:bookmarks:move", ids, parentId, index),
  remove: (ids: string[]): Promise<number> =>
    ipcRenderer.invoke("browser:bookmarks:delete", ids),
  contextMenu: (request: {
    type: "folder" | "bookmark";
    fixed?: boolean;
    childCount?: number;
  }): Promise<BookmarkMenuAction | null> =>
    ipcRenderer.invoke("browser:bookmarks:context-menu", request),
  importSources: (): Promise<BookmarkImportSource[]> =>
    ipcRenderer.invoke("browser:bookmarks:import-sources"),
  importFrom: (
    id: string,
    options: { bookmarks: boolean; history: boolean },
  ): Promise<BookmarkImportSummary> =>
    ipcRenderer.invoke("browser:bookmarks:import", id, options),
  importHtml: (): Promise<BookmarkImportSummary> =>
    ipcRenderer.invoke("browser:bookmarks:import-html"),
  exportHtml: (): Promise<string | null> =>
    ipcRenderer.invoke("browser:bookmarks:export-html"),
  openFullDiskAccess: (): Promise<boolean> =>
    ipcRenderer.invoke("browser:bookmarks:open-full-disk-access"),
  onChange: (callback: (snapshot: BookmarksSnapshot) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: BookmarksSnapshot,
    ): void => callback(snapshot);
    ipcRenderer.on("browser:bookmarks-changed", listener);
    return () =>
      ipcRenderer.removeListener("browser:bookmarks-changed", listener);
  },
  /** The bookmarks bar under the toolbar (off by default; View menu / Cmd+Shift+B toggle it too). */
  bar: {
    get: (): Promise<boolean> =>
      ipcRenderer.invoke("browser:bookmarks-bar:get"),
    set: (visible: boolean): Promise<boolean> =>
      ipcRenderer.invoke("browser:bookmarks-bar:set", visible),
    onChange: (callback: (visible: boolean) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        visible: boolean,
      ): void => callback(visible);
      ipcRenderer.on("browser:bookmarks-bar", listener);
      return () =>
        ipcRenderer.removeListener("browser:bookmarks-bar", listener);
    },
  },
  /** Cmd+D: main bookmarked the page; open the star popover to edit it. */
  onEditCurrent: (
    callback: (payload: { id: string; created: boolean }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string; created: boolean },
    ): void => callback(payload);
    ipcRenderer.on("browser:bookmarks:edit-current", listener);
    return () =>
      ipcRenderer.removeListener("browser:bookmarks:edit-current", listener);
  },
};
