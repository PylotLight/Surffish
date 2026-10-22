// Namespace import: browser-shell (and so this module) is loaded by plain bun unit tests, where
// 'electron' is just a path string and a named value import would fail to link.
import * as electron from "electron";
import { appendFile, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BaseWindow, WebContents } from "electron";
import type { BrowserChromeState } from "../shared/types";
import {
  applySidebarReleaseEvent,
  cursorOverSidebar,
  formatSidebarLockLog,
  parseSidebarLockDebug,
  sidebarCursorPollWanted,
  sidebarRevealLocks,
  SIDEBAR_CURSOR_POLL_MS,
  type SidebarReleaseEvent,
  type SidebarRevealLock,
  type SidebarRevealState,
} from "../shared/sidebar-reveal-lock";

/**
 * Lets go of the overlay sidebar when nothing should hold it open any more (see
 * shared/sidebar-reveal-lock.ts for the locks and the events that clear them).
 *
 * Main-side, so it does not depend on the sidebar renderer seeing its own mouseleave or pointerup:
 * a press on the page, the window or the sidebar losing focus, Escape in the sidebar, the mouse
 * button seen up after a drag, and, while a hover reveal is up, a cursor poll
 * (screen.getCursorScreenPoint) that notices the pointer has left the sidebar even when no view
 * reported it (cross-origin iframes, the toolbar, outside the window).
 *
 * SURFFISH_DEBUG_SIDEBAR=1 logs every change of the lock set and what released it, to stderr and
 * to sidebar-lock.log in the app's logs folder (macOS: ~/Library/Logs/Surffish).
 * SURFFISH_SIDEBAR_CURSOR_POLL=off turns the cursor poll off (escape hatch; some smokes use it).
 */

const debug = parseSidebarLockDebug(process.env.SURFFISH_DEBUG_SIDEBAR);
/** SURFFISH_SIDEBAR_CURSOR_POLL=off: no cursor poll (smokes that open the sidebar with chrome.set, not the pointer). */
const cursorPollEnabled = !/^(0|off|false|no)$/i.test(
  process.env.SURFFISH_SIDEBAR_CURSOR_POLL?.trim() ?? "",
);

export interface SidebarRevealHost {
  window: BaseWindow;
  sidebarContents: WebContents;
  getChrome(): BrowserChromeState;
  /** Apply a chrome-state patch (setBrowserChromeState for this window); `cause` labels the debug log. */
  patchChrome(patch: Partial<BrowserChromeState>, cause: string): void;
  /** The overlay sidebar is on screen above a live page. */
  overlayShown(): boolean;
  /** The sidebar view's width (its card width while open). */
  sidebarWidth(): number;
}

export interface SidebarRevealDeps {
  cursor(): { x: number; y: number } | null;
  contentBounds(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  log(line: string): void;
}

// ---- native menus: any open one holds every sidebar (a tab's context menu sits outside it) ----

const guards = new Set<SidebarRevealGuard>();
let openMenus = 0;
let menuTrackingInstalled = false;

function installMenuTracking(): void {
  if (menuTrackingInstalled) return;
  menuTrackingInstalled = true;
  const Menu = (
    electron as unknown as {
      Menu?: { prototype?: { popup?: (...args: unknown[]) => unknown } };
    }
  ).Menu;
  const proto = Menu?.prototype;
  const original = proto?.popup;
  if (!proto || typeof original !== "function") return;
  proto.popup = function (this: Electron.Menu, ...args: unknown[]) {
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      openMenus = Math.max(0, openMenus - 1);
      for (const guard of guards)
        guard.handle({ type: "menu", open: openMenus > 0 }, "menu closed");
    };
    try {
      this.once("menu-will-close", close);
    } catch {
      // Not an EventEmitter (shouldn't happen): don't track it at all.
      return original.apply(this, args);
    }
    openMenus++;
    for (const guard of guards)
      guard.handle({ type: "menu", open: true }, "menu opened");
    try {
      return original.apply(this, args);
    } catch (error) {
      close();
      throw error;
    }
  };
}

let logFile: string | null | undefined;

function defaultLog(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  if (logFile === undefined) {
    try {
      const directory = electron.app.getPath("logs");
      mkdirSync(directory, { recursive: true });
      logFile = join(directory, "sidebar-lock.log");
      console.log(`[sidebar-lock] logging to ${logFile}`);
    } catch {
      logFile = null;
    }
  }
  if (logFile) appendFile(logFile, `${stamped}\n`, () => undefined);
}

function defaultDeps(window: BaseWindow): SidebarRevealDeps {
  return {
    cursor: () => {
      try {
        return electron.screen.getCursorScreenPoint();
      } catch {
        return null;
      }
    },
    contentBounds: () =>
      window.isDestroyed() ? null : window.getContentBounds(),
    now: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
    log: defaultLog,
  };
}

/** False only when the event says the button is up (before-mouse-event doesn't always report modifiers). */
export function mouseButtonDown(input: {
  modifiers?: readonly string[];
}): boolean {
  const modifiers = input.modifiers;
  if (!modifiers || modifiers.length === 0) return true;
  return modifiers.some((modifier) =>
    /^(left|middle|right)buttondown$/i.test(modifier),
  );
}

export class SidebarRevealGuard {
  private pointerHeld = false;
  private menuOpen = openMenus > 0;
  private poll: unknown = null;
  private outsideSince: number | null = null;
  private lastLocks = "";
  private pendingReleased: SidebarRevealLock[] = [];
  private disposed = false;
  private readonly deps: SidebarRevealDeps;
  private readonly pollEnabled: boolean;
  private readonly onSidebarMouse = (
    _event: Electron.Event,
    input: Electron.MouseInputEvent,
  ): void => {
    const mouse =
      input.type === "mouseDown"
        ? "down"
        : input.type === "mouseUp"
          ? "up"
          : input.type === "mouseMove"
            ? "move"
            : null;
    if (!mouse) return;
    // Only the primary button starts a drag; a right press opens a context menu, which eats its mouseup.
    if (mouse === "down" && input.button !== "left") return;
    // A move with the button still down is the drag itself: nothing to release, skip the work.
    if (
      mouse === "move" &&
      !this.pointerHeld &&
      !this.host.getChrome().sidebarResizing
    )
      return;
    if (mouse === "move" && mouseButtonDown(input)) return;
    this.handle(
      { type: "sidebar-pointer", mouse, buttonDown: mouseButtonDown(input) },
      `sidebar ${input.type}`,
    );
  };
  private readonly onSidebarInput = (
    _event: Electron.Event,
    input: Electron.Input,
  ): void => {
    if (
      input.type === "keyDown" &&
      input.key === "Escape" &&
      !input.isAutoRepeat
    )
      this.handle({ type: "escape" }, "escape in sidebar");
  };
  private readonly onSidebarBlur = (): void =>
    this.handle({ type: "sidebar-blur" }, "sidebar lost focus");
  private readonly onWindowBlur = (): void =>
    this.handle({ type: "window-blur" }, "window blur");

  constructor(
    private readonly host: SidebarRevealHost,
    deps?: Partial<SidebarRevealDeps>,
  ) {
    this.deps = { ...defaultDeps(host.window), ...deps };
    // Injected deps (unit tests) always poll; the app honours SURFFISH_SIDEBAR_CURSOR_POLL.
    this.pollEnabled = deps?.setInterval ? true : cursorPollEnabled;
    installMenuTracking();
    guards.add(this);
    const contents = host.sidebarContents;
    contents.on("before-mouse-event", this.onSidebarMouse);
    contents.on("before-input-event", this.onSidebarInput);
    contents.on("blur", this.onSidebarBlur);
    host.window.on("blur", this.onWindowBlur);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    guards.delete(this);
    this.stopPoll();
    const contents = this.host.sidebarContents;
    if (!contents.isDestroyed()) {
      contents.removeListener("before-mouse-event", this.onSidebarMouse);
      contents.removeListener("before-input-event", this.onSidebarInput);
      contents.removeListener("blur", this.onSidebarBlur);
    }
    if (!this.host.window.isDestroyed())
      this.host.window.removeListener("blur", this.onWindowBlur);
  }

  /** The current lock state (chrome flags + what only main tracks). */
  state(): SidebarRevealState {
    const chrome = this.host.getChrome();
    return {
      pinned: chrome.sidebarPinned,
      mode: chrome.sidebarMode,
      hovered: chrome.sidebarHovered,
      focused: chrome.sidebarFocused,
      resizing: chrome.sidebarResizing,
      pointerHeld: this.pointerHeld,
      menuOpen: this.menuOpen,
    };
  }

  /**
   * A mouse event on the active page (browser.ts before-mouse-event, via the shell). A press is a
   * click elsewhere. Any move or release reaching the page also means the sidebar holds no mouse
   * capture (a drag's moves go to the view it started in), so a drag it thinks is running is over.
   * (before-mouse-event carries no button state on Electron 44, so this is the proof we have.)
   */
  handlePageMouse(input: { type: string }): void {
    if (input.type === "mouseDown")
      return this.handle({ type: "page-press" }, "page press");
    if (input.type !== "mouseMove" && input.type !== "mouseUp") return;
    if (!this.pointerHeld && !this.host.getChrome().sidebarResizing) return;
    this.handle({ type: "page-pointer-free" }, `page ${input.type}`);
  }

  /** Apply one release event: patch the chrome flags it cleared and log what it let go of. */
  handle(event: SidebarReleaseEvent, cause: string): void {
    if (this.disposed || this.host.window.isDestroyed()) return;
    const before = this.state();
    const { state: next, released } = applySidebarReleaseEvent(before, event);
    this.pointerHeld = next.pointerHeld;
    this.menuOpen = next.menuOpen;
    if (event.type === "menu" && !event.open) this.outsideSince = null;
    const patch: Partial<BrowserChromeState> = {};
    if (next.hovered !== before.hovered) patch.sidebarHovered = next.hovered;
    if (next.focused !== before.focused) patch.sidebarFocused = next.focused;
    if (next.resizing !== before.resizing)
      patch.sidebarResizing = next.resizing;
    this.pendingReleased = released;
    // setBrowserChromeState lays out and calls back into noteChromeChanged (poll + log).
    if (Object.keys(patch).length > 0) this.host.patchChrome(patch, cause);
    else this.noteChromeChanged(cause);
    this.pendingReleased = [];
  }

  /** Chrome state or overlay visibility changed: start/stop the cursor poll, log a changed lock set. */
  noteChromeChanged(cause = "chrome state"): void {
    if (this.disposed) return;
    const state = this.state();
    this.logLocks(cause, this.pendingReleased);
    this.pendingReleased = [];
    if (sidebarCursorPollWanted(state, this.host.overlayShown()))
      this.startPoll();
    else this.stopPoll();
  }

  private logLocks(
    cause: string,
    released: readonly SidebarRevealLock[] = [],
  ): void {
    if (!debug && this.deps.log === defaultLog) return;
    const state = this.state();
    const signature = `${sidebarRevealLocks(state).join(",")}|${this.host.overlayShown() ? "shown" : "hidden"}`;
    if (released.length === 0 && signature === this.lastLocks) return;
    this.lastLocks = signature;
    this.deps.log(
      `${formatSidebarLockLog(cause, state, released)} overlay=${this.host.overlayShown() ? "shown" : "hidden"}`,
    );
  }

  private startPoll(): void {
    if (this.poll || !this.pollEnabled) return;
    this.outsideSince = null;
    this.poll = this.deps.setInterval(
      () => this.tick(),
      SIDEBAR_CURSOR_POLL_MS,
    );
  }

  private stopPoll(): void {
    if (!this.poll) return;
    this.deps.clearInterval(this.poll);
    this.poll = null;
    this.outsideSince = null;
  }

  /** One poll: the cursor in window content coordinates against the open sidebar's column. */
  tick(): void {
    if (this.disposed || this.host.window.isDestroyed()) return this.stopPoll();
    const state = this.state();
    if (!sidebarCursorPollWanted(state, this.host.overlayShown()))
      return this.stopPoll();
    const cursor = this.deps.cursor();
    const content = this.deps.contentBounds();
    if (!cursor || !content) return;
    const local = { x: cursor.x - content.x, y: cursor.y - content.y };
    // The whole column the open sidebar occupies (top to bottom of the window), not its mid-slide
    // frame or the card's inset: only leaving it sideways or out of the window counts.
    const over = cursorOverSidebar(local, {
      x: 0,
      y: 0,
      width: this.host.sidebarWidth(),
      height: content.height,
    });
    const now = this.deps.now();
    if (over || state.resizing || state.pointerHeld || state.menuOpen) {
      this.outsideSince = null;
      return;
    }
    this.outsideSince ??= now;
    this.handle(
      { type: "cursor-outside", outsideMs: now - this.outsideSince },
      `cursor outside sidebar (${Math.round(local.x)},${Math.round(local.y)})`,
    );
  }
}
