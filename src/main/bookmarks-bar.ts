import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  isMainWindowRenderer,
  sendToMainWindowRenderers,
} from "./browser-shell";
import { readUserJson, writeUserJson } from "./user-json";

/**
 * The optional bookmarks bar under the toolbar (View → Show Bookmarks Bar, Cmd/Ctrl+Shift+B).
 * Off by default. Kept in main (not renderer localStorage) so the menu and shortcut can flip it
 * and every window's toolbar + content surfaces agree on the toolbar height.
 */
const FILE = "bookmarks-bar.json";
let visible: boolean | null = null;

export function isBookmarksBarVisible(): boolean {
  if (visible === null) {
    const saved = readUserJson(FILE);
    visible =
      typeof saved === "object" &&
      saved !== null &&
      (saved as Record<string, unknown>).visible === true;
  }
  return visible;
}

export function setBookmarksBarVisible(next: boolean): boolean {
  visible = next;
  writeUserJson(FILE, { visible: next });
  sendToMainWindowRenderers("browser:bookmarks-bar", next);
  return next;
}

export function toggleBookmarksBar(): boolean {
  return setBookmarksBarVisible(!isBookmarksBarVisible());
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame))
    throw new Error(
      "This browser operation is available only to the app window.",
    );
}

export function registerBookmarksBarIpc(): void {
  ipcMain.handle("browser:bookmarks-bar:get", (event) => {
    assertMainRenderer(event);
    return isBookmarksBarVisible();
  });
  ipcMain.handle("browser:bookmarks-bar:set", (event, next: unknown) => {
    assertMainRenderer(event);
    return setBookmarksBarVisible(next === true);
  });
}
