import {
  View,
  ipcMain,
  type BaseWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import {
  capturePageWithin,
  nativeImagePixelSize,
  nativeImagePixelWidthToDip,
} from "./capture-page";
import {
  DEFAULT_SIDEBAR_BACKDROP_SETTINGS,
  normalizeSidebarBackdropSettings,
  parseSidebarBackdropOverride,
  resolveSidebarBackdropMode,
  shouldUseNativeSidebarLayer,
  sidebarCaptureRegions,
  snapshotDue,
  sidebarNativeLayerPaint,
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
  getSidebarHoverCardColour,
  getSidebarOverlayView,
  getWindowRenderers,
  isBrowserFrameGlass,
  isMainWindowRenderer,
  isSidebarDocked,
  isSidebarFloating,
  isSidebarOverlayShown,
  sendToMainWindowRenderers,
  setSidebarDockListener,
  setSidebarMotionListener,
  setSidebarOverlayListener,
} from "./browser-shell";
import { scaleArgbAlpha } from "../shared/sidebar-motion";
import { SIDEBAR_FLOAT, sidebarFloatCardRect } from "../shared/sidebar-card";
import {
  hideSidebarCardShadow,
  updateSidebarCardShadow,
} from "./sidebar-card-shadow";
import { readUserJson, writeUserJson } from "./user-json";

/**
 * The overlay sidebar's background over live pages (see shared/sidebar-backdrop.ts for why CSS
 * backdrop-filter and window vibrancy can't do it). 'native' configures a separate background-only
 * View behind the sidebar renderer only while the hover card floats over live page pixels: the
 * card's rect (SIDEBAR_FLOAT, inset in the overlay view), rounded, glass on macOS (in-window blur
 * under the hover tint) or the opaque frame surface without glass; docked chrome uses the window's
 * shared ground. The floating card's soft shadow (sidebar-card-shadow.ts) follows the same rect in
 * every mode.
 * 'snapshot' captures the page strip under the sidebar when it opens and
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
const nativeBackdropViews = new WeakMap<BaseWindow, View>();
/** The overlay's open progress (sidebar-motion.ts): the native background ramps with its slide. */
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
    nativeOverlay: nativeBackdropViews.get(window)?.getVisible() ?? false,
  };
}

function sendState(window: BaseWindow): void {
  const view = getSidebarOverlayView(window);
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.send(STATE_CHANNEL, stateFor(window));
}

/** Hide and reset the hover-only native background; the sidebar WebContentsView stays untouched. */
function clearNativeLayer(window: BaseWindow): void {
  const view = nativeBackdropViews.get(window);
  if (view) {
    try {
      const wasVisible = view.getVisible();
      view.setVisible(false);
      view.setBackgroundBlur(0);
      view.setBackgroundColor("#00000000");
      if (wasVisible) sendState(window);
    } catch {
      // The window is being torn down.
    }
  }
}

/** Create a non-interactive native material view below the toolbar and above live page views. */
function createNativeBackdropView(window: BaseWindow): View | null {
  const current = nativeBackdropViews.get(window);
  if (current) return current;
  const sidebar = getSidebarOverlayView(window);
  if (!sidebar || window.isDestroyed()) return null;
  const backdrop = new View();
  backdrop.setBounds(sidebar.getBounds());
  backdrop.setVisible(false);
  const sidebarIndex = window.contentView.children.indexOf(sidebar);
  // The toolbar remains above this view; sidebar content remains its topmost sibling.
  window.contentView.addChildView(backdrop, Math.max(0, sidebarIndex - 1));
  nativeBackdropViews.set(window, backdrop);
  return backdrop;
}

/** A separate compositor backdrop is only visible while the panel floats over live page pixels. */
function applyNativeLayer(
  window: BaseWindow,
  progress = motionProgress.get(window) ?? 0,
): void {
  const backdrop = nativeBackdropViews.get(window);
  const sidebar = getSidebarOverlayView(window);
  if (!backdrop || !sidebar) return;
  if (
    !shouldUseNativeSidebarLayer({
      mode: getSidebarBackdropMode(),
      docked: isSidebarDocked(window),
      visible: isSidebarOverlayShown(window),
    })
  ) {
    clearNativeLayer(window);
    return;
  }
  try {
    const wasVisible = backdrop.getVisible();
    const floating = isSidebarFloating(window);
    backdrop.setBounds(
      floating
        ? sidebarFloatCardRect(sidebar.getBounds())
        : sidebar.getBounds(),
    );
    backdrop.setBorderRadius(floating ? SIDEBAR_FLOAT.radius : 0);
    paintNativeLayer(
      backdrop,
      progress,
      getSidebarHoverCardColour(window),
      isBrowserFrameGlass(window),
    );
    backdrop.setVisible(true);
    if (!wasVisible) sendState(window);
  } catch (error) {
    console.warn("Could not configure the sidebar background blur:", error);
    clearNativeLayer(window);
  }
}

/**
 * The background-only View's tint + blur at a point of the open/close slide: they fade in and out
 * with the panel instead of popping in at full strength before it has moved.
 */
function paintNativeLayer(
  view: View,
  progress: number,
  colour: string,
  glass: boolean,
): void {
  const { alpha, blur } = sidebarNativeLayerPaint(progress, { glass });
  view.setBackgroundColor(scaleArgbAlpha(colour, alpha));
  view.setBackgroundBlur(blur);
}

function onMotion(window: BaseWindow, progress: number): void {
  motionProgress.set(window, progress);
  try {
    applyNativeLayer(window, progress);
    applyShadow(window, progress);
  } catch {
    // The view is going away with its window.
  }
}

/** The floating hover card's soft shadow, faded with the slide; hidden unless the card floats. */
function applyShadow(
  window: BaseWindow,
  progress = motionProgress.get(window) ?? 0,
): void {
  if (window.isDestroyed()) return;
  const sidebar = getSidebarOverlayView(window);
  const visible = isSidebarOverlayShown(window);
  if (
    !sidebar ||
    !visible ||
    isSidebarDocked(window) ||
    !isSidebarFloating(window) ||
    !(progress > 0)
  ) {
    hideSidebarCardShadow(window);
    return;
  }
  updateSidebarCardShadow(window, {
    card: sidebarFloatCardRect(sidebar.getBounds()),
    below: nativeBackdropViews.get(window) ?? null,
    strength: progress,
  });
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
    // The view rests at the icon-rail width while collapsed (prefetch): capture the width the
    // panel will open at, not just the rail strip.
    const chromeWidth = getBrowserChromeState(window).sidebarWidth;
    const width = Math.max(sidebarBounds.width, chromeWidth);
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
      const { width: pixelWidth } = nativeImagePixelSize(image);
      const smallPixelWidth = Math.max(
        8,
        Math.round(pixelWidth * SIDEBAR_SNAPSHOT_SCALE),
      );
      const small = image.resize({
        width: nativeImagePixelWidthToDip(image, smallPixelWidth),
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
  if (event !== "prefetch") applyShadow(window);
  if (getSidebarBackdropMode() === "native") {
    if (event === "shown") applyNativeLayer(window);
    else if (event === "hidden") clearNativeLayer(window);
    return;
  }
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
    applyShadow(window);
    if (
      getSidebarBackdropMode() === "snapshot" &&
      isSidebarOverlayShown(window)
    )
      requestCapture(window, true);
    sendState(window);
  }
}

/** A browser window's shell was created: add a hidden native backdrop below its toolbar/sidebar. */
export function attachSidebarBackdrop(window: BaseWindow): void {
  createNativeBackdropView(window);
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
  setSidebarDockListener((window) =>
    onMotion(window, motionProgress.get(window) ?? 0),
  );
  ipcMain.handle("browser:sidebar-backdrop:get", (event) => {
    assertMainRenderer(event);
    const window = getShellWindowFor(event.sender);
    return {
      settings: { ...settings },
      state: window
        ? stateFor(window)
        : {
            mode: getSidebarBackdropMode(),
            images: NO_IMAGES,
            nativeOverlay: false,
          },
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
