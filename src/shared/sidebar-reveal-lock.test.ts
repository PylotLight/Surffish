import { describe, expect, test } from "bun:test";
import {
  applySidebarReleaseEvent,
  cursorOverSidebar,
  formatSidebarLockLog,
  parseSidebarLockDebug,
  sidebarCursorPollWanted,
  sidebarRevealLocks,
  sidebarRevealReleased,
  SIDEBAR_CURSOR_OUTSIDE_GRACE_MS,
  type SidebarReleaseEvent,
  type SidebarRevealState,
} from "./sidebar-reveal-lock";

const idle: SidebarRevealState = {
  pinned: false,
  mode: "tabs",
  hovered: false,
  focused: false,
  resizing: false,
  pointerHeld: false,
  menuOpen: false,
};

function run(
  state: SidebarRevealState,
  ...events: SidebarReleaseEvent[]
): SidebarRevealState {
  return events.reduce(
    (current, event) => applySidebarReleaseEvent(current, event).state,
    state,
  );
}

describe("sidebarRevealLocks", () => {
  test("names every hold in a stable order", () => {
    expect(sidebarRevealLocks(idle)).toEqual([]);
    expect(
      sidebarRevealLocks({
        pinned: true,
        mode: "history",
        hovered: true,
        focused: true,
        resizing: true,
        pointerHeld: true,
        menuOpen: true,
      }),
    ).toEqual([
      "pinned",
      "panel",
      "hovered",
      "focused",
      "resizing",
      "pointer-held",
      "menu-open",
    ]);
  });

  test("released only when no visibility hold is left", () => {
    expect(sidebarRevealReleased(idle)).toBe(true);
    expect(sidebarRevealReleased({ ...idle, hovered: true })).toBe(false);
    expect(sidebarRevealReleased({ ...idle, focused: true })).toBe(false);
    expect(sidebarRevealReleased({ ...idle, pinned: true })).toBe(false);
    expect(sidebarRevealReleased({ ...idle, mode: "settings" })).toBe(false);
  });
});

describe("applySidebarReleaseEvent", () => {
  test("a press on the page dismisses a hover + focus reveal", () => {
    const { state, released } = applySidebarReleaseEvent(
      { ...idle, hovered: true, focused: true },
      { type: "page-press" },
    );
    expect(sidebarRevealReleased(state)).toBe(true);
    expect(released).toEqual(["hovered", "focused"]);
  });

  test("a press on the page never unpins or closes a panel, but still ends a stuck drag", () => {
    const { state } = applySidebarReleaseEvent(
      {
        ...idle,
        pinned: true,
        mode: "settings",
        hovered: true,
        resizing: true,
      },
      { type: "page-press" },
    );
    expect(state.pinned).toBe(true);
    expect(state.mode).toBe("settings");
    expect(state.hovered).toBe(true);
    expect(state.resizing).toBe(false);
  });

  test("window blur and Escape dismiss like a page press", () => {
    for (const type of ["window-blur", "escape"] as const) {
      const state = run(
        {
          ...idle,
          hovered: true,
          focused: true,
          resizing: true,
          pointerHeld: true,
        },
        { type },
      );
      expect(sidebarRevealLocks(state)).toEqual([]);
    }
  });

  test("the sidebar losing focus only drops the focus hold", () => {
    const { state, released } = applySidebarReleaseEvent(
      { ...idle, hovered: true, focused: true },
      { type: "sidebar-blur" },
    );
    expect(state).toEqual({ ...idle, hovered: true });
    expect(released).toEqual(["focused"]);
  });

  test("a resize drag whose mouseup lands outside the window is ended by the next buttonless input", () => {
    // Drag starts on the sidebar edge: the button is down and the renderer reports resizing.
    let state = run(
      { ...idle, hovered: true },
      { type: "sidebar-pointer", mouse: "down", buttonDown: true },
    );
    state = { ...state, resizing: true };
    // The cursor leaves the sidebar mid-drag: the poll must not hide it while the drag runs.
    state = run(state, { type: "cursor-outside", outsideMs: 5000 });
    expect(state.hovered).toBe(true);
    expect(state.resizing).toBe(true);
    // The mouseup happened outside the window; the next thing main sees is a buttonless move on the page.
    state = run(state, { type: "page-pointer-free" });
    expect(state.resizing).toBe(false);
    expect(state.pointerHeld).toBe(false);
    // Now the poll may let go of the hover.
    state = run(state, {
      type: "cursor-outside",
      outsideMs: SIDEBAR_CURSOR_OUTSIDE_GRACE_MS,
    });
    expect(sidebarRevealReleased(state)).toBe(true);
  });

  test("a buttonless move or mouseup on the sidebar ends a drag too", () => {
    expect(
      run(
        { ...idle, resizing: true, pointerHeld: true },
        { type: "sidebar-pointer", mouse: "move", buttonDown: false },
      ),
    ).toEqual(idle);
    expect(
      run(
        { ...idle, resizing: true, pointerHeld: true },
        { type: "sidebar-pointer", mouse: "up", buttonDown: false },
      ),
    ).toEqual(idle);
    // A move with the button still down is the drag itself.
    expect(
      run(
        { ...idle, resizing: true, pointerHeld: true },
        { type: "sidebar-pointer", mouse: "move", buttonDown: true },
      ),
    ).toEqual({ ...idle, resizing: true, pointerHeld: true });
  });

  test("an open menu holds the sidebar; once it closes the cursor poll dismisses it", () => {
    let state = run(
      { ...idle, hovered: true },
      { type: "menu", open: true },
      { type: "cursor-outside", outsideMs: 10_000 },
    );
    expect(state.hovered).toBe(true);
    // A context menu opened on mousedown swallows the mouseup: closing it must not leave a press held.
    state = run({ ...state, pointerHeld: true }, { type: "menu", open: false });
    expect(state.menuOpen).toBe(false);
    expect(state.pointerHeld).toBe(false);
    state = run(state, {
      type: "cursor-outside",
      outsideMs: SIDEBAR_CURSOR_OUTSIDE_GRACE_MS,
    });
    expect(sidebarRevealReleased(state)).toBe(true);
  });

  test("the cursor poll waits out its grace period and leaves focus alone", () => {
    expect(
      run(
        { ...idle, hovered: true },
        {
          type: "cursor-outside",
          outsideMs: SIDEBAR_CURSOR_OUTSIDE_GRACE_MS - 1,
        },
      ).hovered,
    ).toBe(true);
    // Typing in a sidebar field: moving the mouse away doesn't yank it shut (a page click does).
    expect(
      run(
        { ...idle, hovered: true, focused: true },
        { type: "cursor-outside", outsideMs: 1000 },
      ),
    ).toEqual({ ...idle, focused: true });
    expect(
      run(
        { ...idle, pinned: true, hovered: true },
        { type: "cursor-outside", outsideMs: 1000 },
      ).hovered,
    ).toBe(true);
  });

  test("returns the same object when nothing changed", () => {
    const state = { ...idle, pinned: true };
    expect(
      applySidebarReleaseEvent(state, { type: "sidebar-blur" }).state,
    ).toBe(state);
    expect(
      applySidebarReleaseEvent(state, { type: "sidebar-blur" }).released,
    ).toEqual([]);
  });
});

describe("cursor poll helpers", () => {
  test("polls only while a hover holds an auto-hide sidebar that is on screen", () => {
    expect(sidebarCursorPollWanted({ ...idle, hovered: true }, true)).toBe(
      true,
    );
    expect(sidebarCursorPollWanted({ ...idle, hovered: true }, false)).toBe(
      false,
    );
    expect(
      sidebarCursorPollWanted({ ...idle, hovered: true, pinned: true }, true),
    ).toBe(false);
    expect(
      sidebarCursorPollWanted(
        { ...idle, hovered: true, mode: "history" },
        true,
      ),
    ).toBe(false);
    expect(sidebarCursorPollWanted({ ...idle, focused: true }, true)).toBe(
      false,
    );
  });

  test("cursorOverSidebar uses the view column plus slack", () => {
    const column = { x: 0, y: 0, width: 320, height: 600 };
    expect(cursorOverSidebar({ x: 5, y: 300 }, column)).toBe(true);
    expect(cursorOverSidebar({ x: 323, y: 300 }, column)).toBe(true);
    expect(cursorOverSidebar({ x: 340, y: 300 }, column)).toBe(false);
    expect(cursorOverSidebar({ x: 100, y: -40 }, column)).toBe(false);
    expect(cursorOverSidebar({ x: -40, y: 300 }, column)).toBe(false);
    expect(cursorOverSidebar({ x: 5, y: 300 }, { ...column, width: 0 })).toBe(
      false,
    );
  });

  test("debug flag and log line", () => {
    expect(parseSidebarLockDebug("1")).toBe(true);
    expect(parseSidebarLockDebug(" TRUE ")).toBe(true);
    expect(parseSidebarLockDebug(undefined)).toBe(false);
    expect(parseSidebarLockDebug("0")).toBe(false);
    expect(
      formatSidebarLockLog("page press", idle, ["hovered", "focused"]),
    ).toBe(
      "[sidebar-lock] page press: locks=[none] released=[hovered,focused]",
    );
    expect(formatSidebarLockLog("set", { ...idle, hovered: true })).toBe(
      "[sidebar-lock] set: locks=[hovered]",
    );
  });
});
