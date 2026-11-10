import { BaseWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { isMainWindowRenderer } from "./browser-shell";
import {
  focusActivePage,
  getCommandPaletteSnapshot,
  runCommand,
} from "./commands";
import {
  getCommandPaletteSettings,
  setCommandPaletteSettings,
} from "./command-palette";
import {
  getCustomSearchEngines,
  setCustomSearchEngines,
} from "./search-keywords";

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error(
      "This browser operation is available only to the app window.",
    );
  }
}

/** Command registry, command palette and search keyword channels (shell renderers only). */
export function registerCommandIpc(): void {
  // A New Tab's half-typed address bar text came back after a tab switch: the content surface takes
  // the keyboard, but only while one of the app's windows is focused (never steals it from another app).
  ipcMain.handle("browser:focus-address-surface", (event) => {
    assertMainRenderer(event);
    if (!BaseWindow.getFocusedWindow() || event.sender.isDestroyed())
      return false;
    event.sender.focus();
    return true;
  });
  ipcMain.handle("browser:commands:list", (event) => {
    assertMainRenderer(event);
    return getCommandPaletteSnapshot();
  });
  ipcMain.handle("browser:commands:run", (event, id: unknown) => {
    assertMainRenderer(event);
    return runCommand(id);
  });
  ipcMain.handle(
    "browser:command-palette:closed",
    (event, refocusPage: unknown) => {
      assertMainRenderer(event);
      if (refocusPage === true) focusActivePage();
    },
  );
  ipcMain.handle("browser:command-palette:settings:get", (event) => {
    assertMainRenderer(event);
    return getCommandPaletteSettings();
  });
  ipcMain.handle(
    "browser:command-palette:settings:set",
    (event, settings: unknown) => {
      assertMainRenderer(event);
      return setCommandPaletteSettings(settings);
    },
  );
  ipcMain.handle("browser:search-keywords:get", (event) => {
    assertMainRenderer(event);
    return getCustomSearchEngines();
  });
  ipcMain.handle("browser:search-keywords:set", (event, engines: unknown) => {
    assertMainRenderer(event);
    return setCustomSearchEngines(engines);
  });
}
