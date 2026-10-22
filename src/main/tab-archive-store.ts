import {
  addArchivedTabs,
  applyTabArchiveSettingsPatch,
  normalizeArchivedList,
  parseArchivedTabs,
  parseTabActivity,
  parseTabArchiveSettings,
  restoredInactiveSince,
  type ArchivedTab,
  type TabArchiveSettings,
  type TabArchiveSnapshot,
} from "../shared/tab-archive";
import { readUserJson, writeUserJson } from "./user-json";
import { deferWrite } from "./deferred-writes";
import { sendToMainWindowRenderers } from "./browser-shell";

// Kept free of browser.ts imports so browser.ts can read restored activity times without a cycle.

const FILE = "tab-archive.json";
const WRITE_KEY = "tab-archive";

interface StoredArchive {
  settings: TabArchiveSettings;
  tabs: ArchivedTab[];
  /** Last time each open tab's URL was used, so "not used for a day" survives a restart. */
  activity: Map<string, number>;
}

let stored: StoredArchive | null = null;

function load(): StoredArchive {
  if (stored) return stored;
  const value = readUserJson(FILE);
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  stored = {
    settings: parseTabArchiveSettings(record.settings),
    tabs: parseArchivedTabs(record.tabs),
    activity: parseTabActivity(record.activity),
  };
  return stored;
}

function save(): void {
  deferWrite(
    WRITE_KEY,
    () => {
      const current = load();
      writeUserJson(FILE, {
        version: 1,
        settings: current.settings,
        tabs: current.tabs,
        activity: Object.fromEntries(current.activity),
      });
    },
    1500,
  );
}

function publish(): void {
  sendToMainWindowRenderers(
    "browser:tab-archive:changed",
    getTabArchiveSnapshot(),
  );
}

export function getTabArchiveSnapshot(): TabArchiveSnapshot {
  const current = load();
  return { settings: { ...current.settings }, tabs: [...current.tabs] };
}

export function getTabArchiveSettings(): TabArchiveSettings {
  return { ...load().settings };
}

export function setTabArchiveSettings(patch: unknown): TabArchiveSettings {
  const current = load();
  const next = applyTabArchiveSettingsPatch(current.settings, patch);
  if (JSON.stringify(next) !== JSON.stringify(current.settings)) {
    current.settings = next;
    save();
    publish();
  }
  return getTabArchiveSettings();
}

export function getArchivedTabs(): ArchivedTab[] {
  return [...load().tabs];
}

export function getArchivedTab(id: string): ArchivedTab | null {
  return load().tabs.find((tab) => tab.id === id) ?? null;
}

export function addToArchive(added: readonly ArchivedTab[]): void {
  if (added.length === 0) return;
  const current = load();
  current.tabs = addArchivedTabs(current.tabs, added);
  save();
  publish();
}

export function removeFromArchive(ids: readonly string[]): number {
  const current = load();
  const remove = new Set(ids);
  const before = current.tabs.length;
  current.tabs = normalizeArchivedList(
    current.tabs.filter((tab) => !remove.has(tab.id)),
  );
  const removed = before - current.tabs.length;
  if (removed > 0) {
    save();
    publish();
  }
  return removed;
}

export function clearArchive(): number {
  const current = load();
  const removed = current.tabs.length;
  if (removed === 0) return 0;
  current.tabs = [];
  save();
  publish();
  return removed;
}

/** Replace the saved last-used times with the open tabs' current ones. */
export function recordTabActivity(snapshot: Record<string, number>): void {
  const current = load();
  const next = new Map(Object.entries(snapshot));
  if (
    next.size === current.activity.size &&
    [...next].every(([url, at]) => current.activity.get(url) === at)
  )
    return;
  current.activity = next;
  save();
}

/** For session restore in browser.ts: when a restored tab was last used (else `fallback`, i.e. now). */
export function restoredTabInactiveSince(
  url: string,
  fallback: number,
): number {
  return restoredInactiveSince(load().activity, url, fallback);
}

/** Clearing history also forgets tabs archived in that range (the archive is a list of visited pages). */
export function forgetArchivedTabsSince(since: number): number {
  const current = load();
  const before = current.tabs.length;
  current.tabs = current.tabs.filter((tab) => tab.archivedAt < since);
  if (since <= 0) current.activity = new Map();
  const removed = before - current.tabs.length;
  save();
  if (removed > 0) publish();
  return removed;
}
