import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { isMainWindowRenderer } from "./browser-shell";
import {
  dropTabIntoSplit,
  focusAdjacentSplitPane,
  getBrowserSplitState,
  popOutBrowserSplitPane,
  splitBrowserTabWith,
  swapBrowserSplitPanes,
  toggleBrowserSplitView,
  unsplitBrowserTab,
} from "./browser";

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame)) {
    throw new Error(
      "This browser operation is available only to the app window.",
    );
  }
}

function handle(
  channel: string,
  listener: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertMainRenderer(event);
    return listener(...args);
  });
}

const optionalId = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Split view actions from the shell renderers (window-scoped by ipc-window-scope like every handler). */
export function registerSplitViewIpc(): void {
  handle("browser:split:get", () => getBrowserSplitState());
  handle(
    "browser:split:with",
    (id, otherId) =>
      typeof id === "string" &&
      typeof otherId === "string" &&
      splitBrowserTabWith(id, otherId),
  );
  handle("browser:split:toggle", () => toggleBrowserSplitView());
  handle("browser:split:unsplit", (id) => unsplitBrowserTab(optionalId(id)));
  handle("browser:split:swap", (id) => swapBrowserSplitPanes(optionalId(id)));
  handle("browser:split:pop-out", (id) =>
    popOutBrowserSplitPane(optionalId(id)),
  );
  handle(
    "browser:split:focus-pane",
    (offset) =>
      (offset === -1 || offset === 1) && focusAdjacentSplitPane(offset),
  );
  handle(
    "browser:split:drop",
    (id, side) =>
      typeof id === "string" &&
      (side === "left" || side === "right") &&
      dropTabIntoSplit(id, side),
  );
}
