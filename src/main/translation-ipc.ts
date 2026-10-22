import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { isTranslationLanguage } from "../shared/translation";
import {
  getBrowserTranslationTarget,
  saveBrowserTranslationTarget,
} from "./browser-persistence";
import { translateBrowserPage, translateBrowserText } from "./browser";
import {
  isMainWindowRenderer,
  sendToMainWindowRenderers,
} from "./browser-shell";

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame))
    throw new Error(
      "This browser operation is available only to the app window.",
    );
}

export function registerTranslationIpc(): void {
  ipcMain.handle("browser:translation:get-target", (event) => {
    assertMainRenderer(event);
    return getBrowserTranslationTarget();
  });
  ipcMain.handle("browser:translation:set-target", (event, target: unknown) => {
    assertMainRenderer(event);
    if (!isTranslationLanguage(target))
      throw new Error("Choose a supported translation language.");
    const saved = saveBrowserTranslationTarget(target);
    if (saved)
      sendToMainWindowRenderers("browser:translation-target-changed", saved);
    return saved;
  });
  ipcMain.handle("browser:translation:page", (event, target?: unknown) => {
    assertMainRenderer(event);
    const language =
      target === undefined ? getBrowserTranslationTarget() : target;
    return isTranslationLanguage(language) && translateBrowserPage(language);
  });
  ipcMain.handle(
    "browser:translation:text",
    (event, text: unknown, target?: unknown) => {
      assertMainRenderer(event);
      const language =
        target === undefined ? getBrowserTranslationTarget() : target;
      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.trim().length > 5000 ||
        !isTranslationLanguage(language)
      )
        return false;
      return translateBrowserText(text, language);
    },
  );
}
