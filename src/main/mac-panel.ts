import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseWindow } from "electron";

/**
 * Mini window panels on macOS (the mini windows and the menu bar popout, their floating headers and
 * edge handles): `type: 'panel'` windows on every Space that should never activate Surffish.
 *
 * Why it matters: when Surffish becomes the active app while a browser window lives on another Space,
 * macOS ("When switching to an application, switch to a Space with open windows") pulls the user over
 * to that Space, and hiding a key panel of the active app hands the key window to the browser window
 * over there (same jump). Electron fakes the panel's nonactivating style mask at runtime, which newer
 * macOS releases stop honouring for clicks (electron/electron#53889; upstream fix proposed in #54807
 * sets the window's "prevents activation" tag). Until that ships in Electron, the native addon
 * (src/native/macos/mac-trackpad-swipe.mm, `preventActivation`) sets the same tag on our panels.
 * Opt out with SURFFISH_PANEL_ACTIVATION=allow (for comparing on a Mac).
 */

interface PanelActivationAddon {
  preventActivation?(windowHandle: Buffer): boolean;
  showOnActiveSpace?(windowHandle: Buffer): SpaceShowReport | null;
  activeSpaceChanges?(): SpaceChanges;
  panelState?(windowHandle: Buffer): PanelNativeState | null;
  makeKeyQuietly?(windowHandle: Buffer): boolean;
}

/** Active Space changes seen by the native watch (started on the first read). */
export interface SpaceChanges {
  spaceChanges: number;
  /** -1 before the first change seen. */
  msSinceSpaceChange: number;
}

/** What a blur / hide of a panel needs to know (native panelState). */
export interface PanelNativeState extends SpaceChanges {
  /** NSWindow.isVisible: still ordered in (Electron's `hide` also fires when it is only occluded). */
  orderedIn: boolean;
  onActiveSpace: boolean;
  key: boolean;
  appActive: boolean;
  /** A mouse button is down right now (the click that took the focus away). */
  mouseDown: boolean;
  occlusion: number;
}

/** What the native showOnActiveSpace did (src/native/macos/mac-trackpad-swipe.mm), for the debug log. */
export interface SpaceShowReport {
  behaviorBefore: number;
  behaviorJoined: number;
  behaviorAfter: number;
  wasVisible: boolean;
  wasOnActiveSpace: boolean;
  /** On the Space the user is on right after ordering it front (every-Spaces behaviour set). */
  onActiveSpace: boolean;
  /** It wasn't: ordered out and back in with MoveToActiveSpace. */
  fallback: boolean;
  fallbackOnActiveSpace: boolean;
  rejoinedAllSpaces: boolean;
  onActiveSpaceAfter: boolean;
  preventsActivation: boolean;
  appActive: boolean;
  isKey: boolean;
  level: number;
  occlusion: number;
  windowNumber: number;
}

// NSWindowCollectionBehavior bits (AppKit NSWindow.h).
const BEHAVIOR_BITS: ReadonlyArray<[number, string]> = [
  [1 << 0, "CanJoinAllSpaces"],
  [1 << 1, "MoveToActiveSpace"],
  [1 << 2, "Managed"],
  [1 << 3, "Transient"],
  [1 << 4, "Stationary"],
  [1 << 5, "ParticipatesInCycle"],
  [1 << 6, "IgnoresCycle"],
  [1 << 7, "FullScreenPrimary"],
  [1 << 8, "FullScreenAuxiliary"],
  [1 << 9, "FullScreenNone"],
  [1 << 11, "FullScreenAllowsTiling"],
  [1 << 12, "FullScreenDisallowsTiling"],
  [1 << 16, "Primary"],
  [1 << 17, "Auxiliary"],
  [1 << 18, "CanJoinAllApplications"],
];

/** `0x101 CanJoinAllSpaces|FullScreenAuxiliary` (unknown bits as +0x…). */
export function describeCollectionBehavior(value: number): string {
  if (!Number.isInteger(value) || value < 0) return String(value);
  let rest = value;
  const names: string[] = [];
  for (const [bit, name] of BEHAVIOR_BITS) {
    if ((value & bit) !== 0) {
      names.push(name);
      rest &= ~bit;
    }
  }
  if (rest !== 0) names.push(`+0x${rest.toString(16)}`);
  return `0x${value.toString(16)} ${names.join("|") || "Default"}`;
}

/** One debug log line for a native show on the active Space. */
export function describeSpaceShow(
  label: string,
  report: SpaceShowReport,
): string {
  let outcome = "on active Space";
  if (!report.onActiveSpace) {
    outcome = !report.fallback
      ? "NOT on active Space"
      : report.fallbackOnActiveSpace
        ? `NOT on active Space after ordering front -> fallback MoveToActiveSpace: on active Space (rejoined all Spaces=${report.rejoinedAllSpaces})`
        : "NOT on active Space after ordering front -> fallback MoveToActiveSpace: STILL NOT on active Space";
  }
  return (
    `${label} ${outcome}; onActiveSpaceAfter=${report.onActiveSpaceAfter} wasVisible=${report.wasVisible} wasOnActiveSpace=${report.wasOnActiveSpace}` +
    ` behavior before=[${describeCollectionBehavior(report.behaviorBefore)}] joined=[${describeCollectionBehavior(report.behaviorJoined)}] after=[${describeCollectionBehavior(report.behaviorAfter)}]` +
    ` preventsActivation=${report.preventsActivation} appActive=${report.appActive} key=${report.isKey} level=${report.level} occlusion=${report.occlusion} window=${report.windowNumber}`
  );
}

interface PanelActivationGuardDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Load the native addon (null: not built in this run). Called at most once. */
  load(): PanelActivationAddon | null;
  warn(message: string, error?: unknown): void;
  /** The mini header debug log (a no-op while it is off). */
  log?(kind: string, detail: string): void;
}

type GuardWindow = Pick<BaseWindow, "isDestroyed" | "getNativeWindowHandle">;

interface PanelActivationGuard {
  /** Keep `window` (a `type: 'panel'` window) from activating Surffish. True when the tag was set. */
  apply(window: GuardWindow): boolean;
  /** Whether the guard can do anything here (macOS, not opted out, the addon has the export). */
  available(): boolean;
  /**
   * Order `window` front on the Space the user is on (every-Spaces behaviour set explicitly, a
   * MoveToActiveSpace fallback when the window server kept it on its old Space). Logged. Null when
   * the native side can't (not macOS, no addon / export, destroyed window, a throwing call).
   */
  showOnActiveSpace(window: GuardWindow, label: string): SpaceShowReport | null;
  /** Native Space changes (null: not macOS / no addon / stale build / a throwing call). Starts the watch. */
  spaceChanges(): SpaceChanges | null;
  /** Native state of `window` (null where it can't tell). */
  panelState(window: GuardWindow): PanelNativeState | null;
  /** Make a shown panel key again without activating Surffish. False where it can't (or it didn't take). */
  makeKeyQuietly(window: GuardWindow): boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPanelActivationGuard(
  deps: PanelActivationGuardDeps,
): PanelActivationGuard {
  let addon: PanelActivationAddon | null | undefined;
  let spaceExportWarned = false;
  const activationEnabled = deps.env.SURFFISH_PANEL_ACTIVATION !== "allow";

  function warn(message: string, error?: unknown): void {
    deps.warn(message, error);
    deps.log?.(
      "panel",
      error === undefined ? message : `${message} ${errorText(error)}`,
    );
  }

  function loaded(): PanelActivationAddon | null {
    if (deps.platform !== "darwin") return null;
    if (addon !== undefined) return addon;
    try {
      addon = deps.load();
      if (addon === null)
        deps.log?.(
          "panel",
          "[mac panel] Native addon not built (out/native/mac-trackpad-swipe.node missing): panels may activate Surffish and come up on another Space.",
        );
    } catch (error) {
      warn(
        "[mac panel] Native addon could not be loaded; panels may activate Surffish:",
        error,
      );
      addon = null;
    }
    if (
      addon &&
      typeof addon.preventActivation !== "function" &&
      typeof addon.showOnActiveSpace !== "function"
    ) {
      // An addon built before these exports (a stale out/native): nothing to call.
      warn(
        "[mac panel] Native addon has no preventActivation; panels may activate Surffish.",
      );
      addon = null;
    }
    return addon;
  }

  return {
    available: () =>
      activationEnabled && typeof loaded()?.preventActivation === "function",
    apply: (window) => {
      if (!activationEnabled) return false;
      const native = loaded();
      if (
        typeof native?.preventActivation !== "function" ||
        window.isDestroyed()
      )
        return false;
      try {
        return (
          native.preventActivation(window.getNativeWindowHandle()) === true
        );
      } catch (error) {
        warn(
          "[mac panel] Could not keep a panel from activating Surffish:",
          error,
        );
        return false;
      }
    },
    showOnActiveSpace: (window, label) => {
      // Not gated on SURFFISH_PANEL_ACTIVATION: that opt-out is about activation, this is about Spaces.
      const native = loaded();
      if (!native || window.isDestroyed()) return null;
      if (typeof native.showOnActiveSpace !== "function") {
        if (!spaceExportWarned) {
          spaceExportWarned = true;
          warn(
            "[mac panel] Native addon has no showOnActiveSpace (stale build); panels may come up on another Space.",
          );
        }
        return null;
      }
      try {
        const report = native.showOnActiveSpace(window.getNativeWindowHandle());
        if (!report) {
          deps.log?.(
            "space",
            `${label} native showOnActiveSpace refused the window handle`,
          );
          return null;
        }
        deps.log?.("space", describeSpaceShow(label, report));
        return report;
      } catch (error) {
        warn(`[mac panel] Could not show ${label} on the active Space:`, error);
        return null;
      }
    },
    spaceChanges: () => {
      const native = loaded();
      if (typeof native?.activeSpaceChanges !== "function") return null;
      try {
        return native.activeSpaceChanges();
      } catch (error) {
        deps.log?.("space", `activeSpaceChanges failed: ${errorText(error)}`);
        return null;
      }
    },
    panelState: (window) => {
      const native = loaded();
      if (typeof native?.panelState !== "function" || window.isDestroyed())
        return null;
      try {
        return native.panelState(window.getNativeWindowHandle());
      } catch (error) {
        deps.log?.("space", `panelState failed: ${errorText(error)}`);
        return null;
      }
    },
    makeKeyQuietly: (window) => {
      const native = loaded();
      if (typeof native?.makeKeyQuietly !== "function" || window.isDestroyed())
        return false;
      try {
        return native.makeKeyQuietly(window.getNativeWindowHandle()) === true;
      } catch (error) {
        deps.log?.("space", `makeKeyQuietly failed: ${errorText(error)}`);
        return false;
      }
    },
  };
}

let debugLog: ((kind: string, detail: string) => void) | null = null;

/** Route panel diagnostics to the mini header debug log (set by mini-window.ts; kept out of here so tests skip electron). */
export function setPanelDebugLog(
  log: (kind: string, detail: string) => void,
): void {
  debugLog = log;
}

/** When a native Space fallback last ordered a window out and back in (that emits a `hide` that isn't one). */
const reorderedAt = new WeakMap<object, number>();
const REORDER_GRACE_MS = 500;

/** Record that `window` is being (or was just) reordered by the native Space fallback; `false` clears it. */
export function noteSpaceReorder(
  window: object,
  reordering: boolean,
  now = Date.now(),
): void {
  if (reordering) reorderedAt.set(window, now);
  else reorderedAt.delete(window);
}

/** True for a moment after a native Space fallback reordered `window`: its `hide` event is not a real hide. */
export function isSpaceReorderHide(window: object, now = Date.now()): boolean {
  const at = reorderedAt.get(window);
  return at !== undefined && now - at < REORDER_GRACE_MS;
}

const requireFromMain = createRequire(import.meta.url);

const guard = createPanelActivationGuard({
  platform: process.platform,
  env: process.env,
  load: () => {
    // Every main chunk sits in out/main, beside out/native (as for mac-trackpad-swipe.ts).
    const addonPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../native/mac-trackpad-swipe.node",
    );
    return existsSync(addonPath)
      ? (requireFromMain(addonPath) as PanelActivationAddon)
      : null;
  },
  warn: (message, error) =>
    error === undefined ? console.warn(message) : console.warn(message, error),
  log: (kind, detail) => debugLog?.(kind, detail),
});

/**
 * macOS: order a shown panel `window` front on the Space the user is on (native showOnActiveSpace).
 * Call after Electron's showInactive so Chromium knows it is visible. `label`: what the debug log calls it.
 */
export function joinActiveSpace(
  window: BaseWindow,
  label: string,
): SpaceShowReport | null {
  if (process.platform !== "darwin" || window.isDestroyed()) return null;
  // Marked first: a fallback's orderOut emits `hide` from inside the native call.
  noteSpaceReorder(window, true);
  const report = guard.showOnActiveSpace(window, label);
  noteSpaceReorder(window, report?.fallback === true);
  return report;
}

/**
 * macOS: when the active Space last changed, on `performance.now()`'s clock (null: none seen, or no
 * native watch). Also starts the watch, so call it when a panel shows.
 */
export function lastSpaceChangeAt(now = performance.now()): number | null {
  if (process.platform !== "darwin") return null;
  const changes = guard.spaceChanges();
  if (!changes || changes.spaceChanges <= 0 || changes.msSinceSpaceChange < 0)
    return null;
  return now - changes.msSinceSpaceChange;
}

/** macOS: native state of a panel (null elsewhere / no addon). */
export function panelNativeState(window: BaseWindow): PanelNativeState | null {
  if (process.platform !== "darwin" || window.isDestroyed()) return null;
  return guard.panelState(window);
}

/** macOS: give a shown panel the key window back (after a Space switch took it) without activating Surffish. */
export function restoreKeyQuietly(window: BaseWindow): boolean {
  if (process.platform !== "darwin" || window.isDestroyed()) return false;
  return guard.makeKeyQuietly(window);
}

/**
 * Make `window` a floating panel: above normal windows ('floating' on macOS), on every Space and over
 * full-screen apps, and (macOS) never activating Surffish. Call right after creating it.
 */
export function makeFloatingPanel(window: BaseWindow): void {
  if (process.platform === "darwin") {
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    guard.apply(window);
  } else {
    window.setAlwaysOnTop(true);
  }
}

/**
 * Bring a floating panel up on the Space the user is on. `focus`: it takes the keyboard too.
 * macOS: every Space again first, shown without focus, ordered front on the active Space (native), then made key. `window.show()` on a
 * non-panel (and `app.focus()`) would activate Surffish, and macOS would switch to the Space holding a
 * browser window; `focus()` on a panel only makes it key. Elsewhere: show + focus as before.
 */
export function showFloatingPanel(
  window: BaseWindow,
  focus: boolean,
  label = "panel",
): void {
  if (window.isDestroyed()) return;
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    if (!window.isVisible()) window.showInactive();
    // The window server can keep a panel on the Space it was last shown on (the browser's) even with
    // every-Spaces behaviour: set it explicitly and order it front here, falling back to
    // MoveToActiveSpace when it still isn't on this Space (logged to the mini header debug log).
    joinActiveSpace(window, label);
    // Start watching Space changes before the user can swipe away (a blur then is not a click-away).
    guard.spaceChanges();
    if (focus) window.focus();
    window.setAlwaysOnTop(true, "floating");
    return;
  }
  if (focus) {
    window.show();
    window.focus();
  } else if (!window.isVisible()) {
    window.showInactive();
  }
  window.setAlwaysOnTop(true);
}
