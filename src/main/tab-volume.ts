import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, ipcMain, type IpcMainEvent, type WebContents } from "electron";
import { onPageSessionCreated } from "./browser-session";
import {
  clearBrowserSiteVolume,
  getBrowserSiteVolume,
  listBrowserSiteVolumes,
  saveBrowserSiteVolume,
} from "./browser-persistence";
import { isMainWindowRenderer } from "./browser-shell";
import { normalizeHttpOrigin } from "../shared/persistence";
import {
  normalizeTabVolume,
  resolveTabVolume,
  type TabVolumeState,
} from "../shared/tab-volume";

/**
 * Per-tab volume: the frame preload (preload/tab-volume-frame.cjs, registered on every page session
 * so iframes get it too) turns the page down from inside; this module answers its "what level?"
 * when a frame starts, pushes changes to every frame of a tab, and keeps the per-site memory
 * (browser-persistence, like page zoom). Private tabs use saved levels but keep their own changes in
 * memory only, forgotten with the private session. browser.ts owns the tabs and registers a host.
 */

export const TAB_VOLUME_GET_CHANNEL = "surffish:tab-volume:get";
export const TAB_VOLUME_SET_CHANNEL = "surffish:tab-volume:set";

export interface TabVolumeHost {
  /** The tab a page's contents belong to (null: not a tab, e.g. a glance or a popup window). */
  stateFor(
    contents: WebContents,
  ): (TabVolumeState & { isPrivate: boolean }) | null;
  /** Saved levels for these origins (null = all) were forgotten: open tabs there go back to 100%. */
  sitesReset(origins: readonly string[] | null): void;
}

let host: TabVolumeHost | null = null;
let registered = false;
const privateSiteVolume = new Map<string, number>();

export function setTabVolumeHost(next: TabVolumeHost): void {
  host = next;
}

function framePreloadPath(): string {
  const mainDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(mainDirectory, "../preload/tab-volume-frame.cjs"),
    join(mainDirectory, "../../preload/tab-volume-frame.cjs"),
    join(app.getAppPath(), "out/preload/tab-volume-frame.cjs"),
    join(app.getAppPath(), "src/preload/tab-volume-frame.cjs"),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
  );
}

/** A site's remembered level for this kind of tab (undefined = 100%). */
export function savedTabVolumeFor(
  isPrivate: boolean,
  origin: string,
): number | undefined {
  return (
    (isPrivate ? privateSiteVolume.get(origin) : undefined) ??
    getBrowserSiteVolume(origin)
  );
}

/** The tab's level for a page at `url` (taking that site's saved level when the site changed). */
export function tabVolumeForUrl(
  state: TabVolumeState & { isPrivate: boolean },
  url: string,
): number {
  return resolveTabVolume(state, normalizeHttpOrigin(url), (origin) =>
    savedTabVolumeFor(state.isPrivate, origin),
  );
}

/** Set the tab's level and remember it for its site. Returns the level set, or null for a bad value. */
export function setTabVolumeLevel(
  state: TabVolumeState & { isPrivate: boolean },
  url: string,
  value: unknown,
): number | null {
  const volume = normalizeTabVolume(value);
  if (volume === null) return null;
  const origin = normalizeHttpOrigin(url);
  state.volume = volume;
  if (origin) {
    state.volumeOrigin = origin;
    if (state.isPrivate) privateSiteVolume.set(origin, volume);
    else saveBrowserSiteVolume(origin, volume);
  }
  return volume;
}

/** Send the level to every frame of a tab (frames that start later ask for it themselves). */
export function pushTabVolume(
  contents: WebContents | null | undefined,
  volume: number,
): void {
  if (!contents || contents.isDestroyed()) return;
  let frames: Electron.WebFrameMain[];
  try {
    frames = contents.mainFrame.framesInSubtree;
  } catch {
    return;
  }
  for (const frame of frames) {
    try {
      if (!frame.isDestroyed()) frame.send(TAB_VOLUME_SET_CHANNEL, volume);
    } catch {
      // A frame can go away mid-loop.
    }
  }
}

export function forgetPrivateTabVolumes(): void {
  privateSiteVolume.clear();
}

function onFrameAsks(event: IpcMainEvent): void {
  let volume = 1;
  try {
    const state = host?.stateFor(event.sender);
    if (state) {
      // The tab's own site: a subframe asks with its top frame's URL.
      let url = "";
      try {
        url = event.senderFrame?.top?.url ?? "";
      } catch {
        url = "";
      }
      volume = tabVolumeForUrl(state, url || event.sender.getURL());
    }
  } catch {
    volume = 1;
  }
  event.returnValue = volume;
}

/** Forget saved levels (null = every site) and put open tabs on those sites back to 100%. */
export function resetSiteVolumes(origins: readonly string[] | null): number {
  const removed = clearBrowserSiteVolume(origins);
  if (origins === null) privateSiteVolume.clear();
  else for (const origin of origins) privateSiteVolume.delete(origin);
  host?.sitesReset(origins);
  return removed;
}

/** Once at startup, before any tab loads. */
export function registerTabVolume(): void {
  if (registered) return;
  registered = true;
  ipcMain.on(TAB_VOLUME_GET_CHANNEL, onFrameAsks);
  const preload = framePreloadPath();
  void onPageSessionCreated((target) => {
    target.registerPreloadScript({ type: "frame", filePath: preload });
  });
  // Settings → Privacy → Tab volume.
  ipcMain.handle("browser:site-volume:list", (event) => {
    if (!isMainWindowRenderer(event.sender, event.senderFrame))
      throw new Error(
        "This browser operation is available only to the app window.",
      );
    return listBrowserSiteVolumes();
  });
  ipcMain.handle("browser:site-volume:reset", (event, origin: unknown) => {
    if (!isMainWindowRenderer(event.sender, event.senderFrame))
      throw new Error(
        "This browser operation is available only to the app window.",
      );
    const target = origin === null ? null : normalizeHttpOrigin(origin);
    if (origin !== null && !target) return listBrowserSiteVolumes();
    resetSiteVolumes(target === null ? null : [target]);
    return listBrowserSiteVolumes();
  });
}
