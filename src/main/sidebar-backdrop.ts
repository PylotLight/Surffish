import {
  ipcMain,
  type BaseWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { capturePageWithin } from "./capture-page";
import {
  DEFAULT_SIDEBAR_BACKDROP_SETTINGS,
  normalizeSidebarBackdropSettings,
  parseSidebarBackdropOverride,
  resolveSidebarBackdropMode,
  sidebarCaptureRegions,
  snapshotDue,
  SIDEBAR_CARD_INSET,
  SIDEBAR_CARD_RADIUS,
  SIDEBAR_NATIVE_BLUR_RADIUS,
  SIDEBAR_NATIVE_TINT,
  SIDEBAR_FRAMED_SOLID_TINT,
  SIDEBAR_SNAPSHOT_SCALE,
  SIDEBAR_SNAPSHOT_THROTTLE_MS,
  type SidebarBackdropImage,
  type SidebarBackdropMode,
  type SidebarBackdropSettings,
  type SidebarBackdropState,
} from "../shared/sidebar-backdrop";
import {
  getBrowserChromeState,
  getShellWindowFor,
  getShellWindows,
  getSidebarOverlayView,
  getWindowRenderers,
  isMainWindowRenderer,
  isSidebarOverlayShown,
  sendToMainWindowRenderers,
  setSidebarMotionListener,
  setSidebarOverlayFrame,
  setSidebarOverlayListener,
} from "./browser-shell";
import { scaleArgbAlpha } from "../shared/sidebar-motion";
import { readUserJson, writeUserJson } from "./user-json";

/**
 * The overlay sidebar's background over live pages (see shared/sidebar-backdrop.ts for why CSS
 * backdrop-filter and window vibrancy can't do it). 'native' configures the sidebar view's own
 * compositor blur once; 'snapshot' captures the page strip under the sidebar when it opens and
 * on tab/navigation changes while it stays open (throttled), never while it is hidden or the
 * window is minimized/hidden; 'solid' does nothing here (the renderer draws a near-opaque tint).
 */

const SETTINGS_FILE = "sidebar-appearance.json";
const STATE_CHANNEL = "browser:sidebar-backdrop";
const NO_IMAGES: SidebarBackdropImage[] = [];

let settings: SidebarBackdropSettings = {
  ...DEFAULT_SIDEBAR_BACKDROP_SETTINGS,
};
const override = parseSidebarBackdropOverride(
  process.env.SURFFISH_SIDEBAR_BACKDROP,
);

interface WindowBackdrop {
  lastCaptureAt: number;
  capturing: boolean;
  pending: ReturnType<typeof setTimeout> | null;
  images: SidebarBackdropImage[];
  generation: number;
}
const perWindow = new WeakMap<BaseWindow, WindowBackdrop>();
const layered = new WeakSet<BaseWindow>();
/** The overlay's open progress (sidebar-motion.ts): the view's tint and blur ramp with its slide. */
const motionProgress = new WeakMap<BaseWindow, number>();

export function getSidebarBackdropMode(): SidebarBackdropMode {
  return resolveSidebarBackdropMode({
    platform: process.platform,
    settings,
    override,
  });
}

function windowState(window: BaseWindow): WindowBackdrop {
  let state = perWindow.get(window);
  if (!state) {
    state = {
      lastCaptureAt: 0,
      capturing: false,
      pending: null,
      images: NO_IMAGES,
      generation: 0,
    };
    perWindow.set(window, state);
  }
  return state;
}

function stateFor(window: BaseWindow): SidebarBackdropState {
  const mode = getSidebarBackdropMode();
  return {
    mode,
    images: mode === "snapshot" ? windowState(window).images : NO_IMAGES,
    framed: layered.has(window),
  };
}

function sendState(window: BaseWindow): void {
  const view = getSidebarOverlayView(window);
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.send(STATE_CHANNEL, stateFor(window));
}

/**
 * Native blur on the sidebar view itself. Once a view has a compositor layer (blur / radius), a
 * fully transparent background stops its web contents drawing at all (seen on Linux/Electron 44),
 * so leaving 'native' at runtime keeps the layer and the card-sized frame, with the blur at 0 and
 * an opaque tint instead. A window that never used the native path keeps its plain view.
 */
function applyNativeLayer(window: BaseWindow): void {
  const view = getSidebarOverlayView(window);
  if (!view) return;
  const native = getSidebarBackdropMode() === "native";
  if (!native && !layered.has(window)) return;
  try {
    view.setBorderRadius(SIDEBAR_CARD_RADIUS);
    layered.add(window);
    paintNativeLayer(window, motionProgress.get(window) ?? 1);
  } catch (error) {
    console.warn("Could not configure the sidebar background blur:", error);
  }
  setSidebarOverlayFrame(window, {
    inset: SIDEBAR_CARD_INSET,
    radius: SIDEBAR_CARD_RADIUS,
  });
}

/**
 * The view's own tint + blur at a point of the open/close slide: they fade in and out with the
 * panel instead of popping in at full strength before it has moved (one timeline, see
 * shared/sidebar-motion.ts). Only for views that use the native layer.
 */
function paintNativeLayer(window: BaseWindow, progress: number): void {
  const view = getSidebarOverlayView(window);
  if (!view || !layered.has(window)) return;
  const native = getSidebarBackdropMode() === "native";
  // Never fully transparent: a layered view with a 0-alpha background stops drawing its web
  // contents at all (see applyNativeLayer), so the ramp bottoms out at a near-invisible tint.
  progress = Math.max(0.02, Math.min(1, progress));
  view.setBackgroundColor(
    scaleArgbAlpha(
      native ? SIDEBAR_NATIVE_TINT : SIDEBAR_FRAMED_SOLID_TINT,
      progress,
    ),
  );
  view.setBackgroundBlur(
    native ? Math.round(SIDEBAR_NATIVE_BLUR_RADIUS * progress) : 0,
  );
}

function onMotion(window: BaseWindow, progress: number): void {
  motionProgress.set(window, progress);
  if (!layered.has(window)) return;
  try {
    paintNativeLayer(window, progress);
  } catch {
    // The view is going away with its window.
  }
}

function canCapture(window: BaseWindow): boolean {
  return (
    !window.isDestroyed() &&
    window.isVisible() &&
    !window.isMinimized() &&
    getSidebarBackdropMode() === "snapshot"
  );
}

/** Live page views under the shell (site tabs, split panes), bottom-most first. */
function pageViewsUnderSidebar(
  window: BaseWindow,
): { contents: WebContents; bounds: Electron.Rectangle }[] {
  const shellContents = new Set(getWindowRenderers(window));
  const children = window.contentView.children;
  const firstShell = children.findIndex(
    (view) =>
      "webContents" in view &&
      shellContents.has((view as Electron.WebContentsView).webContents),
  );
  const below = firstShell < 0 ? children : children.slice(0, firstShell);
  return below.flatMap((view) => {
    if (!("webContents" in view)) return [];
    const contents = (view as Electron.WebContentsView).webContents;
    if (!contents || contents.isDestroyed() || !view.getVisible()) return [];
    const bounds = view.getBounds();
    return bounds.width > 0 && bounds.height > 0 ? [{ contents, bounds }] : [];
  });
}

async function capture(window: BaseWindow): Promise<void> {
  const state = windowState(window);
  const sidebar = getSidebarOverlayView(window);
  if (!sidebar || !canCapture(window)) return;
  state.capturing = true;
  state.lastCaptureAt = Date.now();
  const generation = ++state.generation;
  try {
    const sidebarBounds = sidebar.getBounds();
    // The sidebar is zero-width while collapsed (prefetch): capture the width it will open at.
    const width =
      sidebarBounds.width > 0
        ? sidebarBounds.width
        : getBrowserChromeState(window).sidebarWidth;
    const [, height = 0] = window.getContentSize();
    const sidebarRect = {
      x: 0,
      y: sidebarBounds.y,
      width,
      height: sidebarBounds.height > 0 ? sidebarBounds.height : height,
    };
    const pages = pageViewsUnderSidebar(window);
    const regions = sidebarCaptureRegions(
      sidebarRect,
      pages.map((page) => page.bounds),
    );
    const images: SidebarBackdropImage[] = [];
    for (const region of regions) {
      const page = pages[region.index];
      if (!page || page.contents.isDestroyed()) continue;
      // Bounded: a page switched away mid-capture is detached, and its capture would never settle,
      // leaving `capturing` set and the backdrop frozen for the rest of the window's life.
      const image = await capturePageWithin(page.contents, region.capture);
      if (!image) continue;
      const size = image.getSize();
      const small = image.resize({
        width: Math.max(8, Math.round(size.width * SIDEBAR_SNAPSHOT_SCALE)),
        quality: "good",
      });
      images.push({
        dataUrl: `data:image/jpeg;base64,${small.toJPEG(72).toString("base64")}`,
        ...region.target,
      });
    }
    if (generation !== state.generation || window.isDestroyed()) return;
    state.images = images;
    sendState(window);
  } catch (error) {
    console.warn("Could not capture the sidebar backdrop:", error);
  } finally {
    state.capturing = false;
  }
}

/** Capture now if allowed, otherwise once the throttle window has passed (coalesced). */
function requestCapture(window: BaseWindow, force = false): void {
  if (!canCapture(window)) return;
  const state = windowState(window);
  if (state.pending) return;
  const now = Date.now();
  if (force || snapshotDue(state.lastCaptureAt, now)) {
    if (!state.capturing) void capture(window);
    return;
  }
  state.pending = setTimeout(
    () => {
      state.pending = null;
      if (isSidebarOverlayShown(window)) void capture(window);
    },
    SIDEBAR_SNAPSHOT_THROTTLE_MS - (now - state.lastCaptureAt),
  );
}

function onOverlay(
  window: BaseWindow,
  event: "shown" | "hidden" | "prefetch",
): void {
  if (getSidebarBackdropMode() !== "snapshot") return;
  const state = windowState(window);
  if (event === "hidden") {
    if (state.pending) clearTimeout(state.pending);
    state.pending = null;
    // A stale picture must never flash on the next reveal (the page has moved on).
    state.generation++;
    state.images = NO_IMAGES;
    return;
  }
  if (event === "shown") {
    // A prefetch a moment ago (the hover-reveal delay) already has the picture.
    if (state.images.length > 0 && Date.now() - state.lastCaptureAt < 400) {
      sendState(window);
      return;
    }
    // Anything older shows a page that has moved on: drop it, show the tint, capture now.
    state.images = NO_IMAGES;
    sendState(window);
  }
  requestCapture(window, true);
}

function applyEverywhere(): void {
  for (const window of getShellWindows()) {
    applyNativeLayer(window);
    if (
      getSidebarBackdropMode() === "snapshot" &&
      isSidebarOverlayShown(window)
    )
      requestCapture(window, true);
    sendState(window);
  }
}

/** A browser window's shell was created: set up its sidebar view's layer. */
export function attachSidebarBackdrop(window: BaseWindow): void {
  applyNativeLayer(window);
  sendState(window);
}

/** Active tab changed or a page finished loading in `window`: refresh the snapshot if it is showing. */
export function noteSidebarBackdropPageChanged(
  window: BaseWindow | null | undefined,
): void {
  if (!window || window.isDestroyed() || !isSidebarOverlayShown(window)) return;
  requestCapture(window);
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame))
    throw new Error(
      "This browser operation is available only to the app window.",
    );
}

export function registerSidebarBackdropIpc(): void {
  settings = normalizeSidebarBackdropSettings(readUserJson(SETTINGS_FILE));
  setSidebarOverlayListener(onOverlay);
  setSidebarMotionListener(onMotion);
  ipcMain.handle("browser:sidebar-backdrop:get", (event) => {
    assertMainRenderer(event);
    const window = getShellWindowFor(event.sender);
    return {
      settings: { ...settings },
      state: window
        ? stateFor(window)
        : { mode: getSidebarBackdropMode(), images: NO_IMAGES, framed: false },
    };
  });
  ipcMain.handle("browser:sidebar-backdrop:set", (event, input: unknown) => {
    assertMainRenderer(event);
    settings = normalizeSidebarBackdropSettings({
      ...settings,
      ...(typeof input === "object" && input !== null ? input : {}),
    });
    writeUserJson(SETTINGS_FILE, settings);
    applyEverywhere();
    sendToMainWindowRenderers("browser:sidebar-backdrop:settings", {
      ...settings,
    });
    return { ...settings };
  });
  // The sidebar asks after it switches tabs / the page it sits over navigates.
  ipcMain.handle("browser:sidebar-backdrop:refresh", (event) => {
    assertMainRenderer(event);
    noteSidebarBackdropPageChanged(getShellWindowFor(event.sender));
    return true;
  });
  applyEverywhere();
}
