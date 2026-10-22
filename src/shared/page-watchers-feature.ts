/**
 * "Enable page watchers" (Settings → General → Page Watchers): on by default. Off means no watcher
 * timers or fetches, the watcher module is never loaded, Settings → Watchers and every "watch this
 * page" entry point are hidden, and watcher IPC answers WATCHERS_DISABLED instead of acting. Saved
 * watchers stay in page-watchers.json and pick up again when the feature is turned back on.
 */
export const PAGE_WATCHERS_FEATURE_FILE = "browser-page-watchers-feature.json";
export const WATCHERS_DISABLED_ERROR = "watchers disabled";

export interface PageWatchersFeatureSettings {
  enabled: boolean;
}

export interface WatchersDisabledResult {
  ok: false;
  error: typeof WATCHERS_DISABLED_ERROR;
}

/** Missing or unreadable settings keep watchers on (the behaviour before the toggle existed). */
export function parsePageWatchersFeature(
  value: unknown,
): PageWatchersFeatureSettings {
  if (typeof value === "boolean") return { enabled: value };
  if (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).enabled === false
  )
    return { enabled: false };
  return { enabled: true };
}

export function watchersDisabledResult(): WatchersDisabledResult {
  return { ok: false, error: WATCHERS_DISABLED_ERROR };
}

export function isWatchersDisabledResult(
  value: unknown,
): value is WatchersDisabledResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).ok === false &&
    (value as Record<string, unknown>).error === WATCHERS_DISABLED_ERROR
  );
}

/** What main does with the watcher module when the setting changes. */
export type WatchersTransition = "start" | "stop" | "none";

export function watchersTransition(
  wasEnabled: boolean,
  enabled: boolean,
): WatchersTransition {
  if (wasEnabled === enabled) return "none";
  return enabled ? "start" : "stop";
}

/** Command palette entries that only exist while watchers are on. */
export const WATCHER_COMMAND_IDS: readonly string[] = ["settings.watchers"];

export function isCommandHiddenByWatchers(
  id: string,
  watchersEnabled: boolean,
): boolean {
  return !watchersEnabled && WATCHER_COMMAND_IDS.includes(id);
}

/** Settings sub-nav without the Watchers section while watchers are off. */
export function visibleWatcherSections<T extends { mode: string }>(
  sections: readonly T[],
  watchersEnabled: boolean,
): T[] {
  return watchersEnabled
    ? [...sections]
    : sections.filter((section) => section.mode !== "watchers");
}

/** Leaving Settings → Watchers open after turning watchers off falls back to General. */
export function sidebarModeForWatchers<T extends string>(
  mode: T,
  watchersEnabled: boolean,
): T | "settings" {
  return !watchersEnabled && mode === "watchers" ? "settings" : mode;
}

/** The page context menu's "Watch This Page…" items: watchers on, a normal (non-private) tab, a watchable URL. */
export function canOfferWatchPage(options: {
  watchersEnabled: boolean;
  isPrivate: boolean;
  watchableUrl: boolean;
}): boolean {
  return options.watchersEnabled && !options.isPrivate && options.watchableUrl;
}
