import { describe, expect, test } from "bun:test";
import {
  blurDismissesPopover,
  dismissReasonCloses,
  normalizeDismissReason,
  pagePressDismissesPopovers,
  POPOVER_DISMISS_CHANNEL,
  POPOVER_DISMISS_EVENT,
  POPOVER_SHADOW_ROOM,
  popoverRoom,
  readDismissRequest,
  sidebarModeAfterTabSwitch,
  tabSwitchClosesPopover,
  surfacePressDismissReason,
  toolbarExtentFor,
  windowBlurDismissesPopovers,
} from "./popover-dismiss";

const open = { overlayMode: true, toolbarHeight: 50, toolbarExtent: 180 };
const idle = { overlayMode: true, toolbarHeight: 50, toolbarExtent: 50 };

describe("popover light-dismiss", () => {
  test("a press on the page closes a popover hanging below the toolbar", () => {
    expect(pagePressDismissesPopovers("mouseDown", open)).toBe(true);
    expect(surfacePressDismissReason("page", "mouseDown", open)).toBe(
      "page-press",
    );
  });

  test("a press on the sidebar view closes it too", () => {
    expect(surfacePressDismissReason("sidebar", "mouseDown", open)).toBe(
      "sidebar-press",
    );
  });

  test("moves, releases and wheel events never do", () => {
    for (const type of [
      "mouseMove",
      "mouseUp",
      "mouseWheel",
      "mouseEnter",
      "mouseLeave",
    ]) {
      expect(pagePressDismissesPopovers(type, open)).toBe(false);
      expect(surfacePressDismissReason("sidebar", type, open)).toBeNull();
    }
  });

  test("nothing open: no IPC for ordinary page or sidebar clicks", () => {
    expect(pagePressDismissesPopovers("mouseDown", idle)).toBe(false);
    expect(surfacePressDismissReason("sidebar", "mouseDown", idle)).toBeNull();
    expect(windowBlurDismissesPopovers(idle)).toBe(false);
  });

  test("a popover the toolbar reports open counts even when it fits inside the toolbar strip", () => {
    expect(
      surfacePressDismissReason("page", "mouseDown", {
        ...idle,
        popoverOpen: true,
      }),
    ).toBe("page-press");
    expect(windowBlurDismissesPopovers({ ...idle, popoverOpen: true })).toBe(
      true,
    );
  });

  test("the History panel closes on a page press and window blur, never on a press on the sidebar it lives in", () => {
    const history = { ...idle, historyOpen: true };
    expect(surfacePressDismissReason("page", "mouseDown", history)).toBe(
      "page-press",
    );
    expect(
      surfacePressDismissReason("sidebar", "mouseDown", history),
    ).toBeNull();
    expect(windowBlurDismissesPopovers(history)).toBe(true);
  });

  test("off overlay mode the toolbar and page are one document (its own listener handles it)", () => {
    expect(
      pagePressDismissesPopovers("mouseDown", { ...open, overlayMode: false }),
    ).toBe(false);
    expect(
      surfacePressDismissReason("sidebar", "mouseDown", {
        ...open,
        overlayMode: false,
      }),
    ).toBeNull();
  });

  test("panels ignore sidebar presses; popovers close on every reason", () => {
    for (const reason of [
      "page-press",
      "sidebar-press",
      "window-blur",
      "tab-switch",
      "request",
    ] as const) {
      expect(dismissReasonCloses("popover", reason)).toBe(true);
      expect(dismissReasonCloses("panel", reason)).toBe(
        reason !== "sidebar-press" && reason !== "tab-switch",
      );
    }
  });

  test("a late renderer tab-switch never closes the History panel (main closes it, in order)", () => {
    // Switch tab, then Cmd+Y right away: the coalesced tab broadcast reaches the toolbar after the
    // chrome state that opened History. That stale switch must not close the panel.
    expect(dismissReasonCloses("panel", "tab-switch")).toBe(false);
    expect(dismissReasonCloses("popover", "tab-switch")).toBe(true);
  });

  test("main closes History on a real tab switch only", () => {
    expect(sidebarModeAfterTabSwitch("history", "a", "b")).toBe("tabs");
    expect(sidebarModeAfterTabSwitch("history", "a", "a")).toBe("history");
    expect(sidebarModeAfterTabSwitch("history", null, "a")).toBe("history");
    expect(sidebarModeAfterTabSwitch("history", undefined, "a")).toBe(
      "history",
    );
    for (const mode of [
      "tabs",
      "settings",
      "downloads",
      "bookmarks",
      "site",
      "network",
    ] as const) {
      expect(sidebarModeAfterTabSwitch(mode, "a", "b")).toBe(mode);
    }
  });

  test("the shortcut race: switch, open, then the stale switch arrives", () => {
    // Main's order of events for the table-stakes smoke (Cmd+Shift+] then Cmd+Y twice).
    let mode: string = "tabs";
    mode = sidebarModeAfterTabSwitch(mode, "first", "second"); // switch while History is closed: no-op
    expect(mode).toBe("tabs");
    mode = mode === "history" ? "tabs" : "history"; // Cmd+Y
    expect(mode).toBe("history");
    if (dismissReasonCloses("panel", "tab-switch")) mode = "tabs"; // the late broadcast in the toolbar
    expect(mode).toBe("history");
    mode = mode === "history" ? "tabs" : "history"; // Cmd+Y again toggles it closed
    expect(mode).toBe("tabs");
  });

  test("reasons off the wire are normalised", () => {
    expect(normalizeDismissReason("window-blur")).toBe("window-blur");
    expect(normalizeDismissReason("nonsense")).toBe("request");
    expect(normalizeDismissReason(undefined)).toBe("request");
    expect(normalizeDismissReason(3)).toBe("request");
  });

  test("focus leaving closes a popover, except while its own select list is open", () => {
    expect(blurDismissesPopover("BUTTON")).toBe(true);
    expect(blurDismissesPopover("input")).toBe(true);
    expect(blurDismissesPopover(null)).toBe(true);
    expect(blurDismissesPopover(undefined)).toBe(true);
    expect(blurDismissesPopover("SELECT")).toBe(false);
    expect(blurDismissesPopover("select")).toBe(false);
  });

  test("channel and event names are distinct and namespaced", () => {
    expect(POPOVER_DISMISS_CHANNEL.startsWith("browser:")).toBe(true);
    expect(POPOVER_DISMISS_EVENT).not.toBe(POPOVER_DISMISS_CHANNEL);
  });
});

describe("toolbar view sized to its popovers", () => {
  test("no popover: the toolbar itself", () => {
    expect(toolbarExtentFor(50, [])).toBe(50);
    expect(toolbarExtentFor(49.5, [])).toBe(50);
  });

  test("the lowest popover bottom plus room for its shadow, rounded up", () => {
    expect(
      toolbarExtentFor(50, [
        { top: 60, height: 112.4 },
        { top: 60, height: 40 },
      ]),
    ).toBe(Math.ceil(172.4 + POPOVER_SHADOW_ROOM));
  });

  test("no shadow room for bars that stay open over the page (find bar, notices)", () => {
    expect(
      toolbarExtentFor(50, [{ top: 50, height: 40.2, shadow: false }]),
    ).toBe(91);
  });

  test("never taller than the window, never shorter than the toolbar", () => {
    expect(toolbarExtentFor(50, [{ top: 60, height: 900 }], 640)).toBe(640);
    expect(toolbarExtentFor(50, [{ top: 60, height: 100 }], 30)).toBe(50);
  });

  test("ignores empty or broken boxes", () => {
    expect(
      toolbarExtentFor(50, [
        { top: 60, height: 0 },
        { top: Number.NaN, height: 40 },
        { top: 60, height: Number.POSITIVE_INFINITY },
      ]),
    ).toBe(50);
  });

  test("room left for a popover under the toolbar, with a floor", () => {
    expect(popoverRoom(640, 50)).toBe(640 - 50 - 10 - 14);
    expect(popoverRoom(200, 50)).toBe(180);
    expect(popoverRoom(undefined, 50)).toBeNull();
    expect(popoverRoom(0, 50)).toBeNull();
  });
});

describe("late tab-switch broadcast", () => {
  test("a popover open before main switched the tab closes", () => {
    expect(tabSwitchClosesPopover(1_000, 1_005)).toBe(true);
  });

  test("a popover main opened after the switch stays open (close a tab, then Open Reading List)", () => {
    expect(tabSwitchClosesPopover(1_020, 1_005)).toBe(false);
    // Same millisecond: an IPC hop and a React commit can't come before the switch.
    expect(tabSwitchClosesPopover(1_005, 1_005)).toBe(false);
  });

  test("no switch time (older main, start-up) closes, as before", () => {
    expect(tabSwitchClosesPopover(1_020, undefined)).toBe(true);
    expect(tabSwitchClosesPopover(1_020, 0)).toBe(true);
    expect(tabSwitchClosesPopover(1_020, Number.NaN)).toBe(true);
  });

  test("dismiss event details: bare reasons and requests with a switch time", () => {
    expect(readDismissRequest("page-press")).toEqual({ reason: "page-press" });
    expect(readDismissRequest("nonsense")).toEqual({ reason: "request" });
    expect(readDismissRequest({ reason: "tab-switch", since: 1_005 })).toEqual({
      reason: "tab-switch",
      since: 1_005,
    });
    expect(readDismissRequest({ reason: "tab-switch", since: "soon" })).toEqual(
      { reason: "tab-switch" },
    );
    expect(readDismissRequest({ reason: "tab-switch", since: -1 })).toEqual({
      reason: "tab-switch",
    });
    expect(readDismissRequest(null)).toEqual({ reason: "request" });
  });
});
