/**
 * The toolbar ad-blocker button's data: requests the ad filter blocked on each tab's current page
 * (by domain), pushed to the window's toolbar at most every COUNT_PUSH_MS, and the per-site switch.
 *
 * The switch is BrowserSiteSettings.blockAds (Settings → This site), keyed by the tab's top-level
 * origin. Every blocking layer reads it per request/frame through adblock.ts's
 * isBlockingDisabledForPage: the network filter (requests of the page and all its iframes, by tab),
 * response-header CSP injection, and the frame preload's cosmetic CSS + scriptlets. So turning it
 * off takes effect for the next request at once; CSS and scriptlets already injected into the
 * open page stay until it reloads, which is why the popover offers Reload.
 */
import {
  ipcMain,
  webContents as allWebContents,
  type IpcMainInvokeEvent,
} from "electron";
import {
  BlockedRequestTally,
  isBlockedResponse,
  type AdblockCounts,
  type AdblockPageInfo,
} from "../shared/adblock-stats";
import {
  isMainWindowRenderer,
  sendToMainWindowRenderers,
  sendToWindowRenderers,
} from "./browser-shell";
import {
  getBrowserSiteSettings,
  saveBrowserSiteSettings,
} from "./browser-persistence";
import {
  getBrowserTabPageInfo,
  getBrowserTabRefByWebContentsId,
  getBrowserTabWebContents,
} from "./browser";

export const ADBLOCK_COUNTS_CHANNEL = "browser:adblock:counts";
export const SITE_SETTINGS_CHANGED_CHANNEL = "browser:site-settings:changed";
const COUNT_PUSH_MS = 400;

/** Blocked requests on the current page load, by page WebContents id. */
const tallies = new Map<number, BlockedRequestTally>();
const dirty = new Set<number>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function flushCounts(): void {
  pushTimer = null;
  const byWindow = new Map<Electron.BaseWindow, AdblockCounts>();
  for (const id of dirty) {
    const ref = getBrowserTabRefByWebContentsId(id);
    if (!ref) continue;
    const counts = byWindow.get(ref.window) ?? {};
    counts[ref.tabId] = tallies.get(id)?.total ?? 0;
    byWindow.set(ref.window, counts);
  }
  dirty.clear();
  for (const [window, counts] of byWindow)
    sendToWindowRenderers(window, ADBLOCK_COUNTS_CHANNEL, counts);
}

function markDirty(webContentsId: number): void {
  dirty.add(webContentsId);
  pushTimer ??= setTimeout(flushCounts, COUNT_PUSH_MS);
}

/**
 * Every request the ad filter saw (adblock.ts onRequest). Cheap for the common allowed request:
 * only a new page load (resets the page's count) or a block does any work.
 */
export function noteAdblockRequest(
  details: { url: string; resourceType?: string; webContentsId?: number },
  response: { cancel?: boolean; redirectURL?: string },
): void {
  const id = details.webContentsId;
  if (typeof id !== "number") return;
  if (details.resourceType === "mainFrame") {
    if (tallies.delete(id)) markDirty(id);
    return;
  }
  if (!isBlockedResponse(response)) return;
  let tally = tallies.get(id);
  if (!tally) {
    tally = new BlockedRequestTally();
    tallies.set(id, tally);
    allWebContents.fromId(id)?.once("destroyed", () => {
      tallies.delete(id);
      dirty.delete(id);
    });
  }
  tally.record(details.url);
  markDirty(id);
}

function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function tallyForTab(tabId: string): BlockedRequestTally | undefined {
  const contents = getBrowserTabWebContents(tabId);
  return contents ? tallies.get(contents.id) : undefined;
}

export function adblockPageInfo(tabId: unknown): AdblockPageInfo | null {
  const page = getBrowserTabPageInfo(
    typeof tabId === "string" && tabId ? tabId : null,
  );
  if (!page) return null;
  const origin = webOrigin(page.url);
  const tally = tallyForTab(page.id);
  return {
    tabId: page.id,
    origin,
    host: origin ? new URL(origin).hostname : "",
    enabled: origin ? getBrowserSiteSettings(origin)?.blockAds !== false : true,
    blocked: tally?.total ?? 0,
    hosts: tally?.top() ?? [],
  };
}

function adblockCounts(): AdblockCounts {
  const counts: AdblockCounts = {};
  for (const id of tallies.keys()) {
    const ref = getBrowserTabRefByWebContentsId(id);
    if (ref) counts[ref.tabId] = tallies.get(id)?.total ?? 0;
  }
  return counts;
}

/** Tell every window's surfaces a site's settings changed (toolbar shield, Settings → This site). */
export function broadcastSiteSettings(settings: unknown): void {
  if (settings)
    sendToMainWindowRenderers(SITE_SETTINGS_CHANGED_CHANNEL, settings);
}

/** The popover's switch: blocking on/off for a site (all layers), saved in its site settings. */
function setSiteBlocking(
  origin: unknown,
  enabled: unknown,
): { ok: true; enabled: boolean } | { ok: false; error: string } {
  const current =
    typeof origin === "string" ? getBrowserSiteSettings(origin) : null;
  if (!current || typeof enabled !== "boolean")
    return {
      ok: false,
      error: "Ad blocking can be switched only for http(s) sites.",
    };
  const saved = saveBrowserSiteSettings(current.origin, {
    ...current,
    blockAds: enabled,
  });
  if (!saved)
    return { ok: false, error: "Could not save this site’s setting." };
  broadcastSiteSettings(saved);
  return { ok: true, enabled: saved.blockAds };
}

export function registerAdblockStatsIpc(): void {
  const handle = (
    channel: string,
    run: (...args: unknown[]) => unknown,
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!isMainWindowRenderer(event.sender, event.senderFrame))
        throw new Error(
          "The ad blocker controls are available only to the app window.",
        );
      return run(...args);
    });
  };
  handle("browser:adblock:page", (tabId) => adblockPageInfo(tabId));
  handle("browser:adblock:counts:get", () => adblockCounts());
  handle("browser:adblock:set-site", (origin, enabled) =>
    setSiteBlocking(origin, enabled),
  );
}
