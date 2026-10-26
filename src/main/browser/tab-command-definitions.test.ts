import { describe, expect, test } from "bun:test";
import {
  TAB_COMMAND_SHORTCUTS,
  createTabCommandShortcuts,
  tabMenuAccelerator,
  type TabCommand,
} from "./tab-command-definitions";
import type { TabCommand as BrowserTabCommand } from "../browser";

type FacadeTable = typeof import("../browser").TAB_COMMAND_SHORTCUTS;
const COMMANDS: TabCommand[] = [
  "bookmark",
  "pin",
  "duplicate",
  "copyLink",
  "copyCleanLink",
  "reload",
  "hardReload",
  "close",
  "closeOthers",
  "back",
  "forward",
  "previousTab",
  "nextTab",
  "find",
  "findNext",
  "findPrevious",
  "zoomIn",
  "zoomOut",
  "zoomReset",
  "history",
  "downloads",
  "bookmarkAllTabs",
  "bookmarks",
  "bookmarksBar",
  "screenshot",
  "splitView",
  "focusPaneLeft",
  "focusPaneRight",
  "readingList",
  "miniWindow",
];
const facadeCommands: BrowserTabCommand[] = COMMANDS;
const facadeTable: FacadeTable = TAB_COMMAND_SHORTCUTS;
void facadeCommands;
void facadeTable;

describe("tab command definitions", () => {
  test("defines exactly one shortcut entry for every tab command", () => {
    expect(Object.keys(TAB_COMMAND_SHORTCUTS).sort()).toEqual(
      [...COMMANDS].sort(),
    );
    expect(Object.keys(createTabCommandShortcuts(true)).sort()).toEqual(
      [...COMMANDS].sort(),
    );
  });

  test("maps platform-specific history and downloads shortcuts", () => {
    const mac = createTabCommandShortcuts(true);
    const other = createTabCommandShortcuts(false);
    expect(mac.history).toEqual({
      key: "y",
      primaryOnly: true,
      accelerator: "Cmd+Y",
    });
    expect(mac.downloads).toEqual({
      key: "j",
      shift: true,
      primaryOnly: true,
      accelerator: "Cmd+Shift+J",
    });
    expect(other.history).toEqual({
      key: "h",
      primaryOnly: true,
      accelerator: "Ctrl+H",
    });
    expect(other.downloads).toEqual({
      key: "j",
      primaryOnly: true,
      accelerator: "Ctrl+J",
    });
  });

  test("maps menu hints without registering duplicate accelerators", () => {
    expect(tabMenuAccelerator("bookmark")).toEqual({
      accelerator: "CmdOrCtrl+D",
      registerAccelerator: false,
    });
    expect(tabMenuAccelerator("findPrevious")).toEqual({
      accelerator: "CmdOrCtrl+Shift+G",
      registerAccelerator: false,
    });
    expect(tabMenuAccelerator("duplicate")).toEqual({});
  });
});
