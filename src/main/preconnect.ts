import {
  ipcMain,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from "electron";
import { omniboxPrerenderUrl } from "../shared/omnibox-prerender";
import {
  Debouncer,
  HOVER_DWELL_MS,
  parsePreconnectSettings,
  preconnectOrigin,
  PreconnectLimiter,
  typedPreconnectUrl,
  type PreconnectSettings,
} from "../shared/preconnect";
import {
  getActiveTabNetworkContext,
  getSelectedSearchEngine,
  getSleepingTabPreconnectTarget,
} from "./browser";
import {
  isMainWindowRenderer,
  sendToMainWindowRenderers,
} from "./browser-shell";
import { onGlanceLinkHover } from "./glance-entry";
import { isMemoryTight } from "./memory-saver";
import {
  cancelOmniboxPrerender,
  getOmniboxPrerenderStats,
  hintOmniboxPrerender,
  setPrerenderMemorySampler,
  type PrerenderStats,
} from "./omnibox-prerender";
import { getProxyGuardStatus } from "./proxy-kill-switch";
import { resolveAddressInput } from "./search-keywords";
import { readUserJson, writeUserJson } from "./user-json";

/**
 * Speculative preconnect (Settings → General → Tabs → "Preload pages for faster browsing", on by
 * default): one socket to the likely next origin while typing in the address bar and on link
 * hover. Rules are in shared/preconnect.ts.
 */

/** The network a preconnect goes out on: always the page's own session, so proxy/route/partition rules apply. */
export interface PreconnectContext {
  session: Session;
  /** Session partition, used as the cooldown key ('' is the private session). */
  partition: string;
  isPrivate: boolean;
}

export type PreconnectReason = "typing" | "hover" | "glance" | "sleeping-tab";

const FILE = "preconnect.json";
let settings: PreconnectSettings | null = null;
const limiter = new PreconnectLimiter();
const hoverDwell = new WeakMap<WebContents, Debouncer<string>>();
let issued = 0;

function current(): PreconnectSettings {
  settings ??= parsePreconnectSettings(readUserJson(FILE));
  return settings;
}

/**
 * Open one socket to `url`'s origin in `context`'s session. Returns true when a preconnect went
 * out. Never in private tabs (typing there must not reach the network before Enter), never while
 * the proxy kill switch is blocking traffic (a preconnect is not a request, so the request gate
 * can't see it), never twice for the same origin within the cooldown. Small and exported so other
 * entry points (e.g. a Glance preview) can call it.
 */
export function speculativePreconnect(
  url: string,
  context: PreconnectContext | null,
  reason: PreconnectReason = "typing",
): boolean {
  if (!context || !current().enabled || context.isPrivate) return false;
  const origin = preconnectOrigin(url);
  if (!origin) return false;
  try {
    if (getProxyGuardStatus().blocking) return false;
  } catch {
    return false;
  }
  if (!limiter.take(context.partition, origin)) return false;
  try {
    context.session.preconnect({ url: origin, numSockets: 1 });
  } catch (error) {
    console.warn(`[preconnect] ${reason} preconnect failed:`, error);
    return false;
  }
  issued += 1;
  return true;
}

/** A page's link hover (update-target-url): preconnect once the pointer has rested ~200 ms. */
export function noteLinkHover(
  contents: WebContents,
  url: string,
  context: () => PreconnectContext | null,
): void {
  if (contents.isDestroyed()) return;
  let dwell = hoverDwell.get(contents);
  if (!url || !current().enabled) {
    dwell?.cancel();
    return;
  }
  if (!dwell) {
    dwell = new Debouncer<string>(HOVER_DWELL_MS, (target) => {
      if (!contents.isDestroyed())
        speculativePreconnect(target, context(), "hover");
    });
    hoverDwell.set(contents, dwell);
    contents.once("destroyed", () => hoverDwell.get(contents)?.cancel());
  }
  dwell.push(url);
}

function snapshot(): PreconnectSettings & {
  issued: number;
  prerender: PrerenderStats;
} {
  return { ...current(), issued, prerender: getOmniboxPrerenderStats() };
}

function assertAppRenderer(event: IpcMainInvokeEvent): void {
  if (!isMainWindowRenderer(event.sender, event.senderFrame))
    throw new Error(
      "This browser operation is available only to the app window.",
    );
}

export function registerPreconnectIpc(): void {
  setPrerenderMemorySampler(isMemoryTight);
  ipcMain.handle("browser:preconnect:get", (event) => {
    assertAppRenderer(event);
    return snapshot();
  });
  ipcMain.handle("browser:preconnect:set", (event, patch: unknown) => {
    assertAppRenderer(event);
    const record =
      typeof patch === "object" && patch !== null
        ? (patch as Record<string, unknown>)
        : {};
    if (typeof record.enabled === "boolean") {
      settings = { ...current(), enabled: record.enabled };
      writeUserJson(FILE, settings);
      if (!settings.enabled) {
        limiter.clear();
        cancelOmniboxPrerender();
      }
      sendToMainWindowRenderers("browser:preconnect:changed", snapshot());
    }
    return snapshot();
  });
  // Links hovered inside a glance (tab pages already report through noteLinkHover in browser.ts).
  // A glance loads in its source tab's session and closes when that tab leaves the screen, so the
  // active tab's context is the glance's; anything else (split pane mismatch) is skipped.
  onGlanceLinkHover((hover) => {
    if (!hover.inGlance) return;
    noteLinkHover(hover.contents, hover.url, () => {
      const context = getActiveTabNetworkContext();
      return context && context.session === hover.session ? context : null;
    });
  });
  // The pointer rested on a sleeping tab in the sidebar (dwell timed in the renderer): warm the
  // origin it will wake to, in its own session, so the click's reload skips DNS/TCP/TLS.
  ipcMain.on("browser:preconnect:tab-hover", (event, tabId: unknown) => {
    if (!isMainWindowRenderer(event.sender, event.senderFrame)) return;
    if (typeof tabId !== "string" || !current().enabled) return;
    const target = getSleepingTabPreconnectTarget(tabId);
    if (target)
      speculativePreconnect(target.url, target.context, "sleeping-tab");
  });
  // Address bar, already debounced in the renderer: the typed text and the suggestion Enter is
  // about (the selected row, else the top one) with its source. A sure match is also prerendered
  // (omnibox-prerender.ts); anything else drops the previous prerender.
  ipcMain.on(
    "browser:preconnect:typed",
    (
      event,
      input: unknown,
      topSuggestionUrl: unknown,
      topSuggestionSource: unknown,
    ) => {
      if (!isMainWindowRenderer(event.sender, event.senderFrame)) return;
      if (
        typeof input !== "string" ||
        input.length > 2048 ||
        !current().enabled
      )
        return;
      const suggestion =
        typeof topSuggestionUrl === "string" ? topSuggestionUrl : null;
      const resolve = (text: string): string | null =>
        resolveAddressInput(text, getSelectedSearchEngine());
      const target = typedPreconnectUrl(input, suggestion, resolve);
      if (target)
        speculativePreconnect(target, getActiveTabNetworkContext(), "typing");
      const source =
        typeof topSuggestionSource === "string" ? topSuggestionSource : null;
      const prerenderUrl =
        suggestion && source
          ? omniboxPrerenderUrl({
              input,
              suggestionUrl: suggestion,
              suggestionSource: source,
              resolvedUrl: resolve(input.trim()),
            })
          : null;
      hintOmniboxPrerender(prerenderUrl, current().enabled);
    },
  );
  // The address bar stopped editing (blur, Escape, the text went back to the page URL).
  ipcMain.on("browser:preconnect:typing-ended", (event) => {
    if (!isMainWindowRenderer(event.sender, event.senderFrame)) return;
    cancelOmniboxPrerender();
  });
}
