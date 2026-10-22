import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BaseWindow, WebContents } from "electron";
import type { BrowserChromeState } from "../shared/types";
import {
  SIDEBAR_CURSOR_OUTSIDE_GRACE_MS,
  SIDEBAR_CURSOR_POLL_MS,
} from "../shared/sidebar-reveal-lock";
import { mouseButtonDown, SidebarRevealGuard } from "./sidebar-reveal-guard";

class FakeWindow extends EventEmitter {
  isDestroyed(): boolean {
    return false;
  }
}

class FakeContents extends EventEmitter {
  isDestroyed(): boolean {
    return false;
  }
}

function setup(chrome: Partial<BrowserChromeState> = {}) {
  const window = new FakeWindow();
  const contents = new FakeContents();
  const state: BrowserChromeState = {
    sidebarMode: "tabs",
    sidebarPinned: false,
    sidebarHovered: false,
    sidebarFocused: false,
    sidebarWidth: 320,
    sidebarResizing: false,
    ...chrome,
  };
  let now = 1000;
  let cursor = { x: 100, y: 300 };
  let pollCallback: (() => void) | null = null;
  const lines: string[] = [];
  const patches: Partial<BrowserChromeState>[] = [];
  let shown = true;
  const guard: SidebarRevealGuard = new SidebarRevealGuard(
    {
      window: window as unknown as BaseWindow,
      sidebarContents: contents as unknown as WebContents,
      getChrome: () => state,
      patchChrome: (patch, cause) => {
        patches.push(patch);
        Object.assign(state, patch);
        guard.noteChromeChanged(cause);
      },
      overlayShown: () => shown,
      sidebarWidth: () => state.sidebarWidth,
    },
    {
      cursor: () => cursor,
      contentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      now: () => now,
      setInterval: (callback) => {
        pollCallback = callback;
        return 1;
      },
      clearInterval: () => {
        pollCallback = null;
      },
      log: (line) => lines.push(line),
    },
  );
  /** Advance the fake clock by `ms`, firing the poll every SIDEBAR_CURSOR_POLL_MS while it runs. */
  const elapse = (ms: number): void => {
    for (let t = 0; t < ms; t += SIDEBAR_CURSOR_POLL_MS) {
      now += SIDEBAR_CURSOR_POLL_MS;
      pollCallback?.();
    }
  };
  return {
    window,
    contents,
    state,
    guard,
    lines,
    patches,
    elapse,
    polling: () => pollCallback !== null,
    moveCursor: (x: number, y = 300) => {
      cursor = { x, y };
    },
    setShown: (value: boolean) => {
      shown = value;
    },
    /** The renderer (or main's reveal timer) setting chrome state, as setBrowserChromeState would. */
    rendererSet: (patch: Partial<BrowserChromeState>) => {
      Object.assign(state, patch);
      guard.noteChromeChanged("renderer set");
    },
  };
}

const mouse = (type: string, button = "left") => ({ type, button, x: 0, y: 0 });

describe("SidebarRevealGuard", () => {
  test("a click on the page dismisses a hover + focus reveal", () => {
    const t = setup();
    t.rendererSet({ sidebarHovered: true, sidebarFocused: true });
    t.guard.handlePageMouse({ type: "mouseDown" });
    expect(t.state.sidebarHovered).toBe(false);
    expect(t.state.sidebarFocused).toBe(false);
    expect(t.lines.at(-1)).toContain("page press");
    expect(t.lines.at(-1)).toContain("released=[hovered,focused]");
  });

  test("a resize drag ending outside the window: held until input proves the button is up, then the cursor poll dismisses", () => {
    const t = setup();
    t.rendererSet({ sidebarHovered: true });
    t.moveCursor(150);
    t.contents.emit("before-mouse-event", {}, mouse("mouseDown"));
    t.rendererSet({ sidebarResizing: true });
    // The cursor runs past the edge mid-drag, and the mouseup happens outside the window: the
    // sidebar never sees it. The drag (and the hover) must hold while main can't tell.
    t.moveCursor(900);
    t.elapse(2000);
    expect(t.state.sidebarHovered).toBe(true);
    expect(t.state.sidebarResizing).toBe(true);
    // The next move lands on the page: the sidebar has no capture, the drag is over.
    t.guard.handlePageMouse({ type: "mouseMove" });
    expect(t.state.sidebarResizing).toBe(false);
    expect(
      t.lines.some((line) => line.includes("released=[resizing,pointer-held]")),
    ).toBe(true);
    t.elapse(SIDEBAR_CURSOR_OUTSIDE_GRACE_MS + SIDEBAR_CURSOR_POLL_MS);
    expect(t.state.sidebarHovered).toBe(false);
    expect(t.polling()).toBe(false);
  });

  test("a mouseup seen on the sidebar ends the drag; plain moves without button state do not", () => {
    const t = setup({ sidebarHovered: true });
    t.contents.emit("before-mouse-event", {}, mouse("mouseDown"));
    t.rendererSet({ sidebarResizing: true });
    t.contents.emit("before-mouse-event", {}, mouse("mouseMove"));
    expect(t.state.sidebarResizing).toBe(true);
    t.contents.emit("before-mouse-event", {}, mouse("mouseUp"));
    expect(t.state.sidebarResizing).toBe(false);
  });

  test("a right press (context menu) never counts as a held drag", () => {
    const t = setup();
    t.rendererSet({ sidebarHovered: true });
    t.contents.emit("before-mouse-event", {}, mouse("mouseDown", "right"));
    t.moveCursor(900);
    t.elapse(SIDEBAR_CURSOR_OUTSIDE_GRACE_MS + 2 * SIDEBAR_CURSOR_POLL_MS);
    expect(t.state.sidebarHovered).toBe(false);
  });

  test("an open menu holds it; closing the menu lets the poll dismiss it", () => {
    const t = setup();
    t.rendererSet({ sidebarHovered: true });
    t.guard.handle({ type: "menu", open: true }, "menu opened");
    t.moveCursor(900);
    t.elapse(3000);
    expect(t.state.sidebarHovered).toBe(true);
    t.guard.handle({ type: "menu", open: false }, "menu closed");
    // The grace period starts over once the menu is gone.
    t.elapse(SIDEBAR_CURSOR_POLL_MS);
    expect(t.state.sidebarHovered).toBe(true);
    t.elapse(SIDEBAR_CURSOR_OUTSIDE_GRACE_MS + SIDEBAR_CURSOR_POLL_MS);
    expect(t.state.sidebarHovered).toBe(false);
  });

  test("the poll dismisses a hover whose mouseleave never came, and keeps it while the cursor is over the sidebar", () => {
    const t = setup();
    t.moveCursor(200);
    t.rendererSet({ sidebarHovered: true });
    expect(t.polling()).toBe(true);
    t.elapse(2000);
    expect(t.state.sidebarHovered).toBe(true);
    // Within the slack past the edge still counts as over it (resize handle, rounding).
    t.moveCursor(323);
    t.elapse(1000);
    expect(t.state.sidebarHovered).toBe(true);
    // Out over the toolbar / an iframe / another app: no view reports it, the poll does.
    t.moveCursor(700, 20);
    t.elapse(SIDEBAR_CURSOR_OUTSIDE_GRACE_MS + SIDEBAR_CURSOR_POLL_MS);
    expect(t.state.sidebarHovered).toBe(false);
    expect(t.lines.at(-1)).toContain("cursor outside sidebar");
  });

  test("no poll while pinned, on a panel, or with the overlay off screen", () => {
    const pinned = setup({ sidebarPinned: true });
    pinned.rendererSet({ sidebarHovered: true });
    expect(pinned.polling()).toBe(false);
    const panel = setup({ sidebarMode: "history" });
    panel.rendererSet({ sidebarHovered: true });
    expect(panel.polling()).toBe(false);
    const hidden = setup();
    hidden.setShown(false);
    hidden.rendererSet({ sidebarHovered: true });
    expect(hidden.polling()).toBe(false);
  });

  test("window blur, Escape and the sidebar losing focus release their holds", () => {
    const t = setup();
    t.rendererSet({ sidebarHovered: true, sidebarFocused: true });
    t.contents.emit("blur");
    expect(t.state).toMatchObject({
      sidebarHovered: true,
      sidebarFocused: false,
    });
    t.contents.emit(
      "before-input-event",
      {},
      { type: "keyDown", key: "Escape", isAutoRepeat: false },
    );
    expect(t.state.sidebarHovered).toBe(false);
    t.rendererSet({ sidebarHovered: true, sidebarResizing: true });
    t.window.emit("blur");
    expect(t.state).toMatchObject({
      sidebarHovered: false,
      sidebarResizing: false,
    });
  });

  test("pinned: a page press ends a stuck drag but never hides it", () => {
    const t = setup({
      sidebarPinned: true,
      sidebarHovered: true,
      sidebarResizing: true,
    });
    t.guard.handlePageMouse({ type: "mouseDown" });
    expect(t.state).toMatchObject({
      sidebarPinned: true,
      sidebarHovered: true,
      sidebarResizing: false,
    });
  });

  test("dispose removes its listeners", () => {
    const t = setup();
    t.guard.dispose();
    expect(t.contents.listenerCount("before-mouse-event")).toBe(0);
    expect(t.contents.listenerCount("blur")).toBe(0);
    expect(t.window.listenerCount("blur")).toBe(0);
  });

  test("mouseButtonDown treats missing modifiers as unknown (down)", () => {
    expect(mouseButtonDown({})).toBe(true);
    expect(mouseButtonDown({ modifiers: [] })).toBe(true);
    expect(mouseButtonDown({ modifiers: ["shift"] })).toBe(false);
    expect(mouseButtonDown({ modifiers: ["leftButtonDown"] })).toBe(true);
  });
});
