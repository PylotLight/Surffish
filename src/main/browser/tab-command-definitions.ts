import type { MenuItemConstructorOptions } from "electron";

export type TabCommand =
  | "bookmark"
  | "pin"
  | "duplicate"
  | "copyLink"
  | "copyCleanLink"
  | "reload"
  | "hardReload"
  | "close"
  | "closeOthers"
  | "back"
  | "forward"
  | "previousTab"
  | "nextTab"
  | "find"
  | "findNext"
  | "findPrevious"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "history"
  | "downloads"
  | "bookmarkAllTabs"
  | "bookmarks"
  | "bookmarksBar"
  | "screenshot"
  | "splitView"
  | "focusPaneLeft"
  | "focusPaneRight"
  | "readingList"
  | "miniWindow";

export interface CommandShortcut {
  key: string;
  shift?: boolean;
  /** Match with or without Shift (Cmd+= and Cmd++ both zoom in). */
  anyShift?: boolean;
  alt?: boolean;
  /** Needs the platform's primary modifier (Cmd on macOS, where Ctrl+letter is text editing). */
  primaryOnly?: boolean;
  accelerator: string;
}

export const IS_MAC = process.platform === "darwin";

// One table for browser shortcuts: the key handler, the app menu and the tab context menu all read it.
export function createTabCommandShortcuts(
  isMac: boolean,
): Record<TabCommand, CommandShortcut> {
  return {
    bookmark: { key: "d", accelerator: "CmdOrCtrl+D" },
    pin: { key: "p", shift: true, accelerator: "CmdOrCtrl+Shift+P" },
    // Cmd+Shift+D is Chrome's "Bookmark all tabs"; Duplicate stays in the tab menu without a shortcut.
    duplicate: { key: "", accelerator: "" },
    bookmarkAllTabs: {
      key: "d",
      shift: true,
      accelerator: "CmdOrCtrl+Shift+D",
    },
    bookmarks: {
      key: "b",
      alt: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Alt+B",
    },
    // Chrome's binding for Show/Hide Bookmarks Bar.
    bookmarksBar: {
      key: "b",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+B",
    },
    copyLink: { key: "c", shift: true, accelerator: "CmdOrCtrl+Shift+C" },
    copyCleanLink: {
      key: "c",
      shift: true,
      alt: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Alt+Shift+C",
    },
    reload: { key: "r", accelerator: "CmdOrCtrl+R" },
    hardReload: {
      key: "r",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+R",
    },
    close: { key: "w", accelerator: "CmdOrCtrl+W" },
    closeOthers: { key: "w", alt: true, accelerator: "CmdOrCtrl+Alt+W" },
    back: { key: "[", primaryOnly: true, accelerator: "CmdOrCtrl+[" },
    forward: { key: "]", primaryOnly: true, accelerator: "CmdOrCtrl+]" },
    previousTab: {
      key: "[",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+[",
    },
    nextTab: {
      key: "]",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+]",
    },
    find: { key: "f", primaryOnly: true, accelerator: "CmdOrCtrl+F" },
    findNext: { key: "g", primaryOnly: true, accelerator: "CmdOrCtrl+G" },
    findPrevious: {
      key: "g",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+G",
    },
    // Cmd/Ctrl+Shift+= is Split View, so Zoom In is Cmd/Ctrl+= only (a layout's unshifted "+" still folds to "=").
    zoomIn: { key: "=", primaryOnly: true, accelerator: "CmdOrCtrl+=" },
    zoomOut: { key: "-", primaryOnly: true, accelerator: "CmdOrCtrl+-" },
    zoomReset: { key: "0", primaryOnly: true, accelerator: "CmdOrCtrl+0" },
    // Chrome's bindings: Cmd+Y / Cmd+Shift+J on macOS, Ctrl+H / Ctrl+J elsewhere (Ctrl+Y is Redo there).
    history: isMac
      ? { key: "y", primaryOnly: true, accelerator: "Cmd+Y" }
      : { key: "h", primaryOnly: true, accelerator: "Ctrl+H" },
    downloads: isMac
      ? { key: "j", shift: true, primaryOnly: true, accelerator: "Cmd+Shift+J" }
      : { key: "j", primaryOnly: true, accelerator: "Ctrl+J" },
    // Free in Chrome on every platform (it has no screenshot binding); Cmd+Shift+3/4/5 stay with macOS.
    screenshot: {
      key: "s",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+S",
    },
    // Split the tab with the last used one (or unsplit); the arrows move focus between panes.
    splitView: {
      key: "=",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+=",
    },
    focusPaneLeft: {
      key: "arrowleft",
      alt: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Alt+Left",
    },
    focusPaneRight: {
      key: "arrowright",
      alt: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Alt+Right",
    },
    // Safari/Orion use Cmd+Shift+D, which is Bookmark All Tabs here (Chrome's binding); Cmd/Ctrl+Shift+L is free.
    readingList: {
      key: "l",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+L",
    },
    // Pop the tab out to the mini window, or (in the mini window) put it back. Free in Chrome on macOS.
    miniWindow: {
      key: "m",
      shift: true,
      primaryOnly: true,
      accelerator: "CmdOrCtrl+Shift+M",
    },
  };
}
export const TAB_COMMAND_SHORTCUTS = createTabCommandShortcuts(IS_MAC);
export function tabMenuAccelerator(
  command: TabCommand,
): Pick<MenuItemConstructorOptions, "accelerator" | "registerAccelerator"> {
  // Shown as a hint only; the app menu and before-input-event do the real handling.
  const { accelerator } = TAB_COMMAND_SHORTCUTS[command];
  return accelerator ? { accelerator, registerAccelerator: false } : {};
}
