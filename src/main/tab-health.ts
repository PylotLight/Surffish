import type { WebContents } from "electron";
import {
  canAutoReload,
  crashReasonLabel,
  emptyCrashRecord,
  recordAutoReload,
  recordCrash,
  type TabCrashRecord,
} from "../shared/tab-crash";
import { markTabContents } from "./crash-guard";
import {
  forgetTabInterstitial,
  getTabInterstitial,
  setTabInterstitial,
} from "./tab-interstitials";

/**
 * Crashed and hung site tabs: an in-tab "This page crashed" screen with Reload, a
 * "Page not responding" Wait / Kill prompt, and one automatic reload when a crashed
 * background tab is opened again (capped so crash-on-load pages don't loop).
 */
interface TabHealth {
  crashed: boolean;
  unresponsive: boolean;
  record: TabCrashRecord;
  waitTimer: ReturnType<typeof setTimeout> | null;
}

/** After Wait, ask again if the page is still stuck this much later. */
const WAIT_BEFORE_ASKING_AGAIN_MS = 10_000;
const health = new Map<number, TabHealth>();

function stateFor(contents: WebContents): TabHealth {
  let entry = health.get(contents.id);
  if (!entry) {
    entry = {
      crashed: false,
      unresponsive: false,
      record: emptyCrashRecord(),
      waitTimer: null,
    };
    health.set(contents.id, entry);
  }
  return entry;
}

function clearWaitTimer(entry: TabHealth): void {
  if (entry.waitTimer) clearTimeout(entry.waitTimer);
  entry.waitTimer = null;
}

function showCrash(
  contents: WebContents,
  reason: string,
  entry: TabHealth,
): void {
  setTabInterstitial(contents, {
    kind: "crashed",
    reason,
    label: crashReasonLabel(reason),
    repeated: !canAutoReload(entry.record, Date.now()),
  });
}

export function attachTabHealth(contents: WebContents): void {
  const id = contents.id;
  markTabContents(contents);
  contents.on("render-process-gone", (_event, details) => {
    const entry = stateFor(contents);
    clearWaitTimer(entry);
    entry.crashed = true;
    entry.unresponsive = false;
    entry.record = recordCrash(entry.record, Date.now());
    console.warn(
      `[tab health] page process gone (${details.reason}, exit ${details.exitCode})`,
    );
    showCrash(contents, details.reason, entry);
  });
  contents.on("unresponsive", () => {
    const entry = stateFor(contents);
    if (entry.crashed) return;
    entry.unresponsive = true;
    setTabInterstitial(contents, { kind: "unresponsive" });
  });
  contents.on("responsive", () => {
    const entry = stateFor(contents);
    entry.unresponsive = false;
    clearWaitTimer(entry);
    if (getTabInterstitial(contents)?.kind === "unresponsive")
      setTabInterstitial(contents, null);
  });
  // A reload or a new address in a crashed tab starts a fresh page process.
  contents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      const entry = health.get(id);
      if (!entry?.crashed) return;
      entry.crashed = false;
      if (getTabInterstitial(contents)?.kind === "crashed")
        setTabInterstitial(contents, null);
    },
  );
  contents.once("destroyed", () => {
    const entry = health.get(id);
    if (entry) clearWaitTimer(entry);
    health.delete(id);
    forgetTabInterstitial(id);
  });
}

export function isTabCrashed(
  contents: WebContents | null | undefined,
): boolean {
  return Boolean(
    contents && !contents.isDestroyed() && health.get(contents.id)?.crashed,
  );
}

function restart(contents: WebContents): void {
  const entry = stateFor(contents);
  entry.crashed = false;
  setTabInterstitial(contents, null);
  contents.reload();
}

/** Reload button on the crash screen: always allowed. */
export function reloadCrashedTab(contents: WebContents): boolean {
  if (contents.isDestroyed() || !isTabCrashed(contents)) return false;
  restart(contents);
  return true;
}

/** A crashed background tab was just opened: reload it once, unless it keeps crashing on load. */
export function recoverCrashedTabOnActivate(contents: WebContents): boolean {
  if (contents.isDestroyed() || !isTabCrashed(contents)) return false;
  const entry = stateFor(contents);
  const now = Date.now();
  if (!canAutoReload(entry.record, now)) {
    const shown = getTabInterstitial(contents);
    if (shown?.kind === "crashed" && !shown.repeated)
      setTabInterstitial(contents, { ...shown, repeated: true });
    return false;
  }
  entry.record = recordAutoReload(entry.record, now);
  restart(contents);
  return true;
}

/** "Wait": hide the prompt; ask again if the page is still stuck a little later. */
export function waitForUnresponsiveTab(contents: WebContents): boolean {
  const entry = health.get(contents.id);
  if (!entry?.unresponsive) return false;
  setTabInterstitial(contents, null);
  clearWaitTimer(entry);
  entry.waitTimer = setTimeout(() => {
    entry.waitTimer = null;
    if (!contents.isDestroyed() && entry.unresponsive && !entry.crashed)
      setTabInterstitial(contents, { kind: "unresponsive" });
  }, WAIT_BEFORE_ASKING_AGAIN_MS);
  entry.waitTimer.unref?.();
  return true;
}

/** "Kill page": end the stuck renderer; render-process-gone then shows the crash screen. */
export function killUnresponsiveTab(contents: WebContents): boolean {
  if (contents.isDestroyed()) return false;
  const entry = stateFor(contents);
  clearWaitTimer(entry);
  contents.forcefullyCrashRenderer();
  return true;
}
