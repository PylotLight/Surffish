import {
  ipcMain,
  type BaseWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import {
  GLANCE_SETTINGS_FILE,
  isGlanceableUrl,
  parseGlanceSettings,
  type GlanceSettings,
} from "../shared/glance";
import {
  isMainWindowRenderer,
  sendToMainWindowRenderers,
} from "./browser-shell";
import { readUserJson, writeSettingsFile } from "./user-json";

/**
 * Glance entry point: everything main loads at startup for Glance. The sheet itself (views, header
 * page, key handling) lives in glance.ts, imported the first time a glance opens, so the feature
 * costs nothing at launch. browser.ts supplies the tab side through setGlanceHost.
 *
 * onGlanceLinkHover fires for every link hovered in a tab page or inside a glance, with the session
 * it would load in (preconnect.ts warms the origin from it); openGlance opens one.
 */

type GlanceModule = typeof import("./glance");

/** The tab a glance opened from, as browser.ts describes it. */
export interface GlanceSource {
  tabId: string;
  window: BaseWindow;
  contents: WebContents;
  isPrivate: boolean;
}

/** What glance.ts needs from the tab registry (browser.ts). */
export interface GlanceHost {
  /** The tab whose page `contents` is, or null when it isn't a (loaded) tab page. */
  sourceFor(contents: WebContents): GlanceSource | null;
  /** webPreferences a tab in this source's session would get (same session, preload and sandbox). */
  pageWebPreferences(source: GlanceSource): Electron.WebPreferences;
  /** Turn the glance page view into a real tab next to the source, keeping its webContents. Returns the tab id. */
  adoptAsTab(
    source: GlanceSource,
    view: import("electron").WebContentsView,
    url: string,
    activate: boolean,
  ): string | null;
  /** Show `tabId` in a split next to the source tab. */
  openInSplitView(tabId: string): boolean;
  /** Can the source tab take a split pane next to a new tab? */
  canSplit(source: GlanceSource): boolean;
  /** Open `url` as a tab in the source's window (Cmd/Ctrl+click or the context menu inside the glance). */
  openTab(source: GlanceSource, url: string, activate: boolean): void;
  /** The selected search engine (the context menu's "Search for …"). */
  searchEngine(): import("../shared/types").SearchEngineId;
  /** Hand the keyboard back to the source tab's page. */
  focusSource(source: GlanceSource): void;
  /** Run a browser shortcut as if pressed in the source tab; true when it was one. */
  handleShortcut(source: GlanceSource, input: Electron.Input): boolean;
  /** Is `tabId` still the window's active tab? */
  isActiveTab(window: BaseWindow, tabId: string): boolean;
  /** Bind a contents to its window for IPC/window scoping. */
  bindToWindow(contents: WebContents, window: BaseWindow): void;
}

export interface GlanceLinkHover {
  /** The hovered link, or '' when the pointer left it. */
  url: string;
  /** The page the link is on (a tab page or a glance page). */
  contents: WebContents;
  /** Where a glance (or a tab) for this link would load: the source page's session. */
  session: Electron.Session;
  /** The hover is inside a glance. */
  inGlance: boolean;
}

let settings: GlanceSettings | null = null;
let host: GlanceHost | null = null;
let glanceModule: GlanceModule | null = null;
let loadingModule: Promise<GlanceModule> | null = null;
const hoverListeners = new Set<(hover: GlanceLinkHover) => void>();

function current(): GlanceSettings {
  settings ??= parseGlanceSettings(readUserJson(GLANCE_SETTINGS_FILE));
  return settings;
}

/** Settings → General → "Shift-click opens links in Glance". */
export function glanceShiftClickEnabled(): boolean {
  return current().shiftClick;
}

export function getGlanceSettings(): GlanceSettings {
  return { ...current() };
}

export function setGlanceShiftClick(input: unknown): GlanceSettings {
  const next = parseGlanceSettings({ shiftClick: input !== false });
  const changed = next.shiftClick !== current().shiftClick;
  settings = next;
  writeSettingsFile(GLANCE_SETTINGS_FILE, next);
  if (changed) {
    try {
      sendToMainWindowRenderers("browser:glance:settings-changed", { ...next });
    } catch {
      /* window closing */
    }
  }
  return { ...next };
}

export function setGlanceHost(next: GlanceHost | null): void {
  host = next;
}

export function getGlanceHost(): GlanceHost | null {
  return host;
}

function loadGlanceModule(): Promise<GlanceModule> {
  loadingModule ??= import("./glance").then((module) => {
    glanceModule = module;
    return module;
  });
  return loadingModule;
}

/**
 * Open `url` in a glance over the tab whose page is `sourceContents` (replacing any glance already
 * open in that window). Resolves true once the glance is showing.
 */
export async function openGlance(
  sourceContents: WebContents,
  url: string,
): Promise<boolean> {
  if (!host || sourceContents.isDestroyed() || !isGlanceableUrl(url))
    return false;
  const source = host.sourceFor(sourceContents);
  if (!source) return false;
  try {
    const module = await loadGlanceModule();
    if (sourceContents.isDestroyed()) return false;
    return await module.openGlanceFor(source, url);
  } catch (error) {
    console.warn("Could not open Glance:", error);
    return false;
  }
}

/** browser.ts: a window's active tab may have changed (closes a glance whose tab left the screen). */
export function noteGlanceWindowState(window: BaseWindow): void {
  glanceModule?.syncGlanceWithActiveTab(window);
}

/** Is a glance on screen in `window`? (A trackpad pinch then zooms its page, not the tab overview.) */
export function isGlanceOpenIn(window: BaseWindow | null | undefined): boolean {
  return Boolean(window && glanceModule?.glanceOpenIn(window));
}

/**
 * View menu / palette zoom while a glance is open in `window`: zoom its page instead of the tab
 * under it. False when there is no glance (the caller zooms the tab).
 */
export function zoomOpenGlance(
  window: BaseWindow | null | undefined,
  action: "in" | "out" | "reset",
): boolean {
  return Boolean(window && glanceModule?.zoomGlanceIn(window, action));
}

/** Every live glance webContents id (page + header), for Diagnostics and leak checks. */
export function getGlanceContentsIds(): { page: number[]; chrome: number[] } {
  return glanceModule?.glanceContentsIds() ?? { page: [], chrome: [] };
}

/** Subscribe to link hovers (tab pages and glances). preconnect.ts preconnects hovers inside a glance. */
export function onGlanceLinkHover(
  listener: (hover: GlanceLinkHover) => void,
): () => void {
  hoverListeners.add(listener);
  return () => hoverListeners.delete(listener);
}

/** A page reported the link under the pointer (update-target-url). Cheap no-op without listeners. */
export function emitGlanceLinkHover(
  contents: WebContents,
  url: string,
  inGlance = false,
): void {
  if (hoverListeners.size === 0 || contents.isDestroyed()) return;
  const hover: GlanceLinkHover = {
    url: isGlanceableUrl(url) ? url : "",
    contents,
    session: contents.session,
    inGlance,
  };
  for (const listener of hoverListeners) {
    try {
      listener(hover);
    } catch (error) {
      console.warn("Glance hover listener failed:", error);
    }
  }
}

function fromAppWindow(event: IpcMainInvokeEvent): boolean {
  return isMainWindowRenderer(event.sender, event.senderFrame);
}

export function registerGlanceIpc(): void {
  ipcMain.handle("browser:glance:get-settings", () => getGlanceSettings());
  ipcMain.handle(
    "browser:glance:set-shift-click",
    (event, enabled: unknown) => {
      if (!fromAppWindow(event))
        throw new Error(
          "This browser operation is available only to the app window.",
        );
      return setGlanceShiftClick(enabled);
    },
  );
}
