import { ipcRenderer } from "electron";
import type { BrowserTabSummary } from "../shared/types";
import {
  applyTabPatch,
  resolveTabs,
  type TabPatch,
  type TabSyncState,
} from "../shared/tab-broadcast";

// Main sends `browser:tabs` as diffs against what this surface last got (shared/tab-broadcast);
// rebuild the full list here so the renderer API is unchanged.
let synced: TabSyncState | null = null;
let resyncRequested = false;
const listeners = new Set<(tabs: BrowserTabSummary[]) => void>();

ipcRenderer.on("browser:tabs", (_event, patch: TabPatch) => {
  const next = applyTabPatch(synced, patch);
  if (!next) {
    // This surface (re)loaded or missed a patch: ask for the full list once.
    if (!resyncRequested) {
      resyncRequested = true;
      ipcRenderer.send("browser:tabs:resync");
    }
    return;
  }
  resyncRequested = false;
  synced = next;
  const tabs = resolveTabs(next);
  for (const listener of listeners) listener(tabs);
});

export function onTabsChange(
  callback: (tabs: BrowserTabSummary[]) => void,
): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}
