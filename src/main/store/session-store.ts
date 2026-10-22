import {
  normalizeWindowsSession,
  type SavedSessionWindow,
  type SavedWindowsSession,
} from "../../shared/window-session";
import type { SavedTabGroup } from "../../shared/tab-groups";
import type { SavedSplit } from "../../shared/split-view";
import { DEFAULT_SPACE_ID, type SavedWindowSpaces } from "../../shared/spaces";
import { parseSavedWindowState } from "../../shared/window-geometry";
import {
  forgetTabHistoryEntries,
  normalizeTabHistory,
  type SavedTabHistory,
  type TabHistoryForget,
} from "../../shared/tab-history";
import type { SurffishDatabase } from "./database";

/**
 * The open-windows session in the profile database (session_windows / session_tabs / tab_groups /
 * session_splits), one row per window, tab, group and split, each with a stable id.
 *
 * Saving diffs against what was last written and only touches rows that changed, so a tab
 * navigating rewrites one row (one oplog op), not the whole session. Closed tabs/windows are
 * tombstoned (deleted_at) so a sync peer sees them go; tombstones older than 30 days are purged.
 *
 * Stable ids across restarts: restored tabs get new runtime ids, so the first save after a load
 * adopts the loaded row whose window/position/URL matches; after that the runtime id → row id map
 * keeps a tab's row through navigations and moves.
 *
 * Each tab's back/forward list lives beside its row in session_tab_history (device-local, no
 * change log), diffed the same way: a navigation rewrites that one tab's list, nothing else.
 */

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SAVED_AT_KEY = "session:saved_at";

interface WindowRow {
  id: string;
  position: number;
  focused: number;
  geometry: string | null;
  active_space_id: string | null;
  extra: string | null;
}
interface TabRow {
  id: string;
  window_id: string;
  position: number;
  url: string;
  pinned: number;
  active: number;
  space_id: string | null;
  group_id: string | null;
}
interface GroupRow {
  id: string;
  window_id: string;
  name: string;
  color: string;
  collapsed: number;
  position: number;
}
interface SplitRow {
  id: string;
  window_id: string;
  tab_ids: string;
  sizes: string;
}
interface HistoryRow {
  tab_id: string;
  entries: string;
  active_index: number;
}

type Table =
  "session_windows" | "session_tabs" | "tab_groups" | "session_splits";

interface Desired {
  table: Table;
  id: string;
  values: Record<string, string | number | null>;
}

const COLUMNS: Record<Table, readonly string[]> = {
  session_windows: [
    "position",
    "focused",
    "geometry",
    "active_space_id",
    "extra",
  ],
  session_tabs: [
    "window_id",
    "position",
    "url",
    "pinned",
    "active",
    "space_id",
    "group_id",
  ],
  tab_groups: ["window_id", "name", "color", "collapsed", "position"],
  session_splits: ["window_id", "tab_ids", "sizes"],
};

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export class SessionStore {
  private readonly windowRows = new Map<string, string>();
  private readonly tabRows = new Map<string, string>();
  /** Group/split identity → row id. */
  private readonly derived = new Map<string, string>();
  /** rowKey (table:id) → serialized values last written. */
  private written = new Map<string, string>();
  /** Tab row id → back/forward list as last written (JSON of entries + index). */
  private writtenHistory = new Map<string, string>();
  /** Rows from the last load, by window position, for adopting on the first save. */
  private adoptable: Array<{
    windowId: string;
    tabs: Array<{ id: string; url: string }>;
  }> = [];
  private primed = false;

  constructor(private readonly db: SurffishDatabase) {}

  /** When this device's session was last saved to the database (ms), or null. */
  savedAt(): number | null {
    const value = Number(this.db.getMeta(SAVED_AT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /** This device's saved windows, oldest position first; null if nothing was ever saved here. */
  load(): SavedWindowsSession | null {
    this.prime();
    if (this.savedAt() === null) return null;
    const device = this.db.deviceId;
    const windows = this.db.all<WindowRow>(
      "SELECT id, position, focused, geometry, active_space_id, extra FROM session_windows WHERE device_id = ? AND deleted_at IS NULL ORDER BY position",
      device,
    );
    const sessionWindows: SavedSessionWindow[] = [];
    let focusedIndex = -1;
    this.adoptable = [];
    for (const window of windows) {
      const tabs = this.db.all<TabRow>(
        "SELECT id, window_id, position, url, pinned, active, space_id, group_id FROM session_tabs WHERE window_id = ? AND deleted_at IS NULL ORDER BY position",
        window.id,
      );
      if (tabs.length === 0) continue;
      const historyRows = new Map(
        this.db
          .all<HistoryRow>(
            "SELECT h.tab_id, h.entries, h.active_index FROM session_tab_history h JOIN session_tabs t ON t.id = h.tab_id WHERE t.window_id = ? AND t.deleted_at IS NULL",
            window.id,
          )
          .map((row) => [row.tab_id, row]),
      );
      // Validated against each tab's URL by normalizeWindowsSession below, like the JSON copy.
      const histories = tabs.map((tab) => {
        const row = historyRows.get(tab.id);
        return row
          ? { entries: parseJson(row.entries), index: row.active_index }
          : null;
      });
      const indexOf = new Map(tabs.map((tab, index) => [tab.id, index]));
      const groups = this.db.all<GroupRow>(
        "SELECT id, window_id, name, color, collapsed, position FROM tab_groups WHERE window_id = ? AND deleted_at IS NULL ORDER BY position",
        window.id,
      );
      const splits = this.db.all<SplitRow>(
        "SELECT id, window_id, tab_ids, sizes FROM session_splits WHERE window_id = ? AND deleted_at IS NULL",
        window.id,
      );
      const extra = (parseJson(window.extra) ?? {}) as {
        spaceActiveTabs?: Record<string, string>;
      };
      const savedGroups: SavedTabGroup[] = groups
        .map((group) => ({
          tabs: tabs.flatMap((tab, index) =>
            tab.group_id === group.id ? [index] : [],
          ),
          name: group.name,
          color: group.color as SavedTabGroup["color"],
          collapsed: group.collapsed === 1,
        }))
        .filter((group) => group.tabs.length > 0);
      const savedSplits: SavedSplit[] = splits.flatMap((split) => {
        const ids = parseJson(split.tab_ids);
        const sizes = parseJson(split.sizes);
        if (!Array.isArray(ids) || !Array.isArray(sizes)) return [];
        const indexes = ids.map((id) => indexOf.get(String(id)) ?? -1);
        return indexes.every((index) => index >= 0)
          ? [{ tabs: indexes, sizes: sizes.map(Number) }]
          : [];
      });
      const tabSpaces = tabs.map((tab) => tab.space_id ?? DEFAULT_SPACE_ID);
      const spaceActiveTabs: Record<string, number> = {};
      for (const [space, tabId] of Object.entries(
        extra.spaceActiveTabs ?? {},
      )) {
        const index = indexOf.get(tabId);
        if (index !== undefined) spaceActiveTabs[space] = index;
      }
      const spaces: SavedWindowSpaces = {
        tabSpaces,
        activeSpace: window.active_space_id ?? DEFAULT_SPACE_ID,
        ...(Object.keys(spaceActiveTabs).length > 0 ? { spaceActiveTabs } : {}),
      };
      if (window.focused === 1) focusedIndex = sessionWindows.length;
      sessionWindows.push({
        urls: tabs.map((tab) => tab.url),
        activeIndex: Math.max(
          0,
          tabs.findIndex((tab) => tab.active === 1),
        ),
        pinnedIndexes: tabs.flatMap((tab, index) =>
          tab.pinned === 1 ? [index] : [],
        ),
        geometry: parseSavedWindowState(parseJson(window.geometry)),
        splits: savedSplits,
        spaces,
        groups: savedGroups,
        ...(histories.some(Boolean)
          ? { histories: histories as unknown as Array<SavedTabHistory | null> }
          : {}),
      });
      this.adoptable.push({
        windowId: window.id,
        tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url })),
      });
      groups.forEach((group, index) =>
        this.derived.set(
          `group:${window.id}:${index}:${group.name}:${group.color}`,
          group.id,
        ),
      );
      for (const split of splits) {
        const ids = parseJson(split.tab_ids);
        if (Array.isArray(ids))
          this.derived.set(`split:${window.id}:${ids.join(",")}`, split.id);
      }
    }
    // Same validation as the JSON file (safe URLs, caps, index checks).
    const normalized = normalizeWindowsSession(
      sessionWindows,
      focusedIndex < 0 ? sessionWindows.length - 1 : focusedIndex,
    );
    return normalized.windows.length > 0 ? normalized : null;
  }

  /** Write `session` (already normalized) as this device's open windows. */
  save(session: SavedWindowsSession): void {
    this.prime();
    const desired: Desired[] = [];
    const desiredHistory = new Map<string, SavedTabHistory>();
    const liveWindowRows = new Set<string>();
    session.windows.forEach((window, windowIndex) => {
      const windowId = this.windowRowId(window, windowIndex);
      liveWindowRows.add(windowId);
      const adopt = this.adoptable[windowIndex];
      const usedAdopted = new Set<string>();
      const tabIds = window.urls.map((url, index) =>
        this.tabRowId(window.tabIds?.[index], url, index, adopt, usedAdopted),
      );
      const groupIds = (window.groups ?? []).map((group, index) =>
        this.stableId(
          `group:${windowId}:${index}:${group.name}:${group.color}`,
        ),
      );
      const groupOf = new Map<number, string>();
      (window.groups ?? []).forEach((group, index) => {
        for (const tab of group.tabs) groupOf.set(tab, groupIds[index]!);
      });
      const spaceActiveTabs: Record<string, string> = {};
      for (const [space, index] of Object.entries(
        window.spaces?.spaceActiveTabs ?? {},
      )) {
        const id = tabIds[index];
        if (id) spaceActiveTabs[space] = id;
      }
      desired.push({
        table: "session_windows",
        id: windowId,
        values: {
          position: windowIndex,
          focused: windowIndex === session.focusedIndex ? 1 : 0,
          geometry: window.geometry ? JSON.stringify(window.geometry) : null,
          active_space_id: window.spaces?.activeSpace ?? null,
          extra:
            Object.keys(spaceActiveTabs).length > 0
              ? JSON.stringify({ spaceActiveTabs })
              : null,
        },
      });
      window.urls.forEach((url, index) => {
        const history = window.histories?.[index];
        if (history) desiredHistory.set(tabIds[index]!, history);
        desired.push({
          table: "session_tabs",
          id: tabIds[index]!,
          values: {
            window_id: windowId,
            position: index,
            url,
            pinned: window.pinnedIndexes.includes(index) ? 1 : 0,
            active: index === window.activeIndex ? 1 : 0,
            space_id: window.spaces?.tabSpaces[index] ?? null,
            group_id: groupOf.get(index) ?? null,
          },
        });
      });
      (window.groups ?? []).forEach((group, index) => {
        desired.push({
          table: "tab_groups",
          id: groupIds[index]!,
          values: {
            window_id: windowId,
            name: group.name,
            color: group.color,
            collapsed: group.collapsed ? 1 : 0,
            position: index,
          },
        });
      });
      for (const split of window.splits ?? []) {
        const ids = split.tabs.map((index) => tabIds[index]!);
        desired.push({
          table: "session_splits",
          id: this.stableId(`split:${windowId}:${ids.join(",")}`),
          values: {
            window_id: windowId,
            tab_ids: JSON.stringify(ids),
            sizes: JSON.stringify(split.sizes),
          },
        });
      }
    });
    // Adoption only applies to the first save after a load. A save without runtime ids (importing
    // the JSON session at startup) is itself what the restored tabs should adopt.
    const imported = session.windows.every((window) => !window.tabIds);
    this.adoptable = imported
      ? session.windows.map((_window, windowIndex) => {
          const windowId = desired.find(
            (row) =>
              row.table === "session_windows" &&
              row.values.position === windowIndex,
          )!.id;
          return {
            windowId,
            tabs: desired
              .filter(
                (row) =>
                  row.table === "session_tabs" &&
                  row.values.window_id === windowId,
              )
              .map((row) => ({ id: row.id, url: String(row.values.url) })),
          };
        })
      : [];
    for (const key of [...this.windowRows.keys()])
      if (!liveWindowRows.has(this.windowRows.get(key)!))
        this.windowRows.delete(key);
    this.apply(desired, desiredHistory);
    const liveRows = new Set(desired.map((row) => row.id));
    for (const [runtimeId, rowId] of [...this.tabRows])
      if (!liveRows.has(rowId)) this.tabRows.delete(runtimeId);
    for (const [identity, rowId] of [...this.derived])
      if (!liveRows.has(rowId)) this.derived.delete(identity);
  }

  /** Forget the saved session (Clear browsing data → "open tabs"): tombstone every row. */
  clear(): void {
    this.prime();
    this.apply([], new Map());
    this.windowRows.clear();
    this.tabRows.clear();
    this.derived.clear();
    this.adoptable = [];
  }

  /**
   * Take history-cleared pages out of every saved back/forward list (each tab's current page
   * stays); a list left with nothing worth restoring is deleted. Clearing history runs this after
   * the session save, so lists of tabs no longer open (or saved while no window was) go too.
   */
  forgetHistories(forget: TabHistoryForget): void {
    this.prime();
    const rows = this.db.all<HistoryRow & { url: string | null }>(
      "SELECT h.tab_id, h.entries, h.active_index, t.url FROM session_tab_history h LEFT JOIN session_tabs t ON t.id = h.tab_id AND t.deleted_at IS NULL",
    );
    this.db.transaction(() => {
      const now = Date.now();
      for (const row of rows) {
        const current = row.url
          ? normalizeTabHistory(
              { entries: parseJson(row.entries), index: row.active_index },
              row.url,
            )
          : null;
        const next = current
          ? normalizeTabHistory(
              forgetTabHistoryEntries(current, forget),
              row.url!,
            )
          : null;
        if (!next) {
          this.db.run(
            "DELETE FROM session_tab_history WHERE tab_id = ?",
            row.tab_id,
          );
          this.writtenHistory.delete(row.tab_id);
          continue;
        }
        const serialized = JSON.stringify([next.entries, next.index]);
        if (
          serialized ===
          JSON.stringify([parseJson(row.entries), row.active_index])
        )
          continue;
        this.db.run(
          "UPDATE session_tab_history SET entries = ?, active_index = ?, updated_at = ? WHERE tab_id = ?",
          JSON.stringify(next.entries),
          next.index,
          now,
          row.tab_id,
        );
        this.writtenHistory.set(row.tab_id, serialized);
      }
    });
  }

  private apply(
    desired: Desired[],
    histories: ReadonlyMap<string, SavedTabHistory>,
  ): void {
    const next = new Map<string, string>();
    const nextHistory = new Map<string, string>();
    this.db.transaction(() => {
      const stamp = this.db.stamp();
      for (const row of desired) {
        const key = `${row.table}:${row.id}`;
        const serialized = JSON.stringify(
          COLUMNS[row.table].map((column) => row.values[column] ?? null),
        );
        next.set(key, serialized);
        if (this.written.get(key) === serialized) continue;
        const { now, hlc, deviceId } = this.db.stamp();
        const columns = COLUMNS[row.table];
        const values = columns.map((column) => row.values[column] ?? null);
        this.db.run(
          `INSERT INTO ${row.table} (id, ${columns.join(", ")}, device_id, created_at, updated_at, hlc, deleted_at) VALUES (?, ${columns.map(() => "?").join(", ")}, ?, ?, ?, ?, NULL)
           ON CONFLICT (id) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}, device_id = excluded.device_id, updated_at = excluded.updated_at, hlc = excluded.hlc, deleted_at = NULL`,
          row.id,
          ...values,
          deviceId,
          now,
          now,
          hlc,
        );
      }
      for (const key of this.written.keys()) {
        if (next.has(key)) continue;
        const separator = key.indexOf(":");
        const table = key.slice(0, separator) as Table;
        const id = key.slice(separator + 1);
        const { now, hlc, deviceId } = this.db.stamp();
        // A closed tab's tombstone keeps no URL or title: only that it is gone.
        const blank =
          table === "session_tabs"
            ? ", url = '', title = '', favicon_url = NULL"
            : "";
        this.db.run(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?, hlc = ?, device_id = ?${blank} WHERE id = ? AND deleted_at IS NULL`,
          now,
          now,
          hlc,
          deviceId,
          id,
        );
      }
      for (const [tabId, history] of histories) {
        const serialized = JSON.stringify([history.entries, history.index]);
        nextHistory.set(tabId, serialized);
        if (this.writtenHistory.get(tabId) === serialized) continue;
        this.db.run(
          "INSERT INTO session_tab_history (tab_id, entries, active_index, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (tab_id) DO UPDATE SET entries = excluded.entries, active_index = excluded.active_index, updated_at = excluded.updated_at",
          tabId,
          JSON.stringify(history.entries),
          history.index,
          stamp.now,
        );
      }
      // A closed tab (or one whose list is gone) keeps no back/forward pages on disk.
      for (const tabId of this.writtenHistory.keys()) {
        if (!nextHistory.has(tabId))
          this.db.run(
            "DELETE FROM session_tab_history WHERE tab_id = ?",
            tabId,
          );
      }
      this.db.setMeta(SAVED_AT_KEY, String(stamp.now));
    });
    this.written = next;
    this.writtenHistory = nextHistory;
  }

  /** Read this device's live rows once, so the first save only writes what changed. */
  private prime(): void {
    if (this.primed) return;
    this.primed = true;
    const device = this.db.deviceId;
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    this.db.transaction(() => {
      for (const table of Object.keys(COLUMNS) as Table[]) {
        this.db.run(
          `DELETE FROM oplog WHERE entity_id IN (SELECT id FROM ${table} WHERE device_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?)`,
          device,
          cutoff,
        );
        this.db.run(
          `DELETE FROM ${table} WHERE device_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`,
          device,
          cutoff,
        );
      }
      // Lists whose tab is gone (closed by a build without this table, or another device's row).
      this.db.run(
        "DELETE FROM session_tab_history WHERE tab_id NOT IN (SELECT id FROM session_tabs WHERE device_id = ? AND deleted_at IS NULL)",
        device,
      );
    });
    for (const table of Object.keys(COLUMNS) as Table[]) {
      const columns = COLUMNS[table];
      for (const row of this.db.all<Record<string, string | number | null>>(
        `SELECT id, ${columns.join(", ")} FROM ${table} WHERE device_id = ? AND deleted_at IS NULL`,
        device,
      )) {
        this.written.set(
          `${table}:${String(row.id)}`,
          JSON.stringify(columns.map((column) => row[column] ?? null)),
        );
      }
    }
    for (const row of this.db.all<HistoryRow>(
      "SELECT tab_id, entries, active_index FROM session_tab_history",
    )) {
      this.writtenHistory.set(
        row.tab_id,
        JSON.stringify([parseJson(row.entries), row.active_index]),
      );
    }
  }

  private windowRowId(window: SavedSessionWindow, windowIndex: number): string {
    const key = window.windowKey;
    if (key && this.windowRows.has(key)) return this.windowRows.get(key)!;
    const adopted = this.adoptable[windowIndex]?.windowId;
    const id =
      adopted && ![...this.windowRows.values()].includes(adopted)
        ? adopted
        : this.db.newId();
    if (key) this.windowRows.set(key, id);
    return id;
  }

  private tabRowId(
    runtimeId: string | undefined,
    url: string,
    index: number,
    adopt: { tabs: Array<{ id: string; url: string }> } | undefined,
    used: Set<string>,
  ): string {
    if (runtimeId && this.tabRows.has(runtimeId))
      return this.tabRows.get(runtimeId)!;
    let id: string | undefined;
    const candidate = adopt?.tabs[index];
    if (candidate && candidate.url === url && !used.has(candidate.id))
      id = candidate.id;
    id ??= adopt?.tabs.find((tab) => tab.url === url && !used.has(tab.id))?.id;
    id ??= this.db.newId();
    used.add(id);
    if (runtimeId) this.tabRows.set(runtimeId, id);
    return id;
  }

  /** Groups and splits have no runtime id; reuse the row id for the same window+identity. */
  private stableId(identity: string): string {
    let id = this.derived.get(identity);
    if (!id) {
      id = this.db.newId();
      this.derived.set(identity, id);
    }
    return id;
  }
}
