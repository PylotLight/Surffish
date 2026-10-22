import type { BrowserTabSummary } from "./types";

/**
 * Tab-list broadcasts as diffs.
 *
 * Main used to send every shell surface the whole tab list (inline `data:` favicons of up to
 * 500 KB included) several times per tab open. Now each surface gets a patch against the list it
 * last received: only the tabs and fields that changed, the order only when it changed, and each
 * inline favicon once (tabs carry a short `sf-icon:<n>` ref, the data travels in `icons` the first
 * time a ref shows up). The preload applies the patch and hands the renderer the same full
 * `BrowserTabSummary[]` as before.
 */

export const FAVICON_REF_PREFIX = "sf-icon:";

type TabKey = keyof BrowserTabSummary;
type TabFields = Partial<BrowserTabSummary> & { id: string };

export interface TabPatch {
  /** This patch's sequence number (per receiving surface). */
  seq: number;
  /** The `seq` this patch applies on top of; `null` = a full list (applies on top of nothing). */
  base: number | null;
  /** Tab ids in list order, present when the ids or their order changed (always on a full list). */
  order?: string[];
  /** Changed fields per tab (a new tab, or every tab of a full list, carries all its fields). */
  set?: TabFields[];
  /** Optional fields a tab no longer has (e.g. it left a split or group). */
  unset?: Array<[string, TabKey[]]>;
  /** Favicon data for refs the receiver doesn't have yet. */
  icons?: Record<string, string>;
}

/** What one receiver holds: the encoded list (favicons as refs) and the favicon data it was sent. */
export interface TabSyncState {
  seq: number;
  tabs: BrowserTabSummary[];
  /** Favicon refs currently referenced by `tabs` (the sender only needs the keys). */
  icons: Map<string, string>;
}

export function isFaviconRef(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.startsWith(FAVICON_REF_PREFIX);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function referencedIcons(tabs: readonly BrowserTabSummary[]): Set<string> {
  const refs = new Set<string>();
  for (const tab of tabs)
    if (isFaviconRef(tab.faviconUrl)) refs.add(tab.faviconUrl);
  return refs;
}

/**
 * The patch that turns `prev` (null = the receiver has nothing) into `next` (already encoded:
 * inline favicons replaced by refs), or null when nothing changed. `iconData` resolves a ref
 * the receiver hasn't seen.
 */
export function diffTabs(
  prev: TabSyncState | null,
  next: readonly BrowserTabSummary[],
  iconData: (ref: string) => string | undefined,
): { patch: TabPatch | null; state: TabSyncState } {
  const seq = (prev?.seq ?? 0) + 1;
  const nextRefs = referencedIcons(next);
  const prevById = new Map((prev?.tabs ?? []).map((tab) => [tab.id, tab]));
  const set: TabFields[] = [];
  const unset: Array<[string, TabKey[]]> = [];
  for (const tab of next) {
    const old = prevById.get(tab.id);
    if (!old) {
      set.push({ ...tab });
      continue;
    }
    const changed: TabFields = { id: tab.id };
    let any = false;
    const gone: TabKey[] = [];
    for (const key of Object.keys(tab) as TabKey[]) {
      if (key === "id") continue;
      if (!sameValue(old[key], tab[key])) {
        (changed as Record<string, unknown>)[key] = tab[key];
        any = true;
      }
    }
    for (const key of Object.keys(old) as TabKey[])
      if (!(key in tab)) gone.push(key);
    if (any) set.push(changed);
    if (gone.length > 0) unset.push([tab.id, gone]);
  }
  const prevOrder = prev?.tabs.map((tab) => tab.id) ?? null;
  const orderChanged =
    !prevOrder ||
    prevOrder.length !== next.length ||
    next.some((tab, index) => tab.id !== prevOrder[index]);
  const icons: Record<string, string> = {};
  let newIcons = 0;
  for (const ref of nextRefs) {
    if (prev?.icons.has(ref)) continue;
    const data = iconData(ref);
    if (data !== undefined) {
      icons[ref] = data;
      newIcons += 1;
    }
  }
  const stateIcons = new Map<string, string>();
  for (const ref of nextRefs) stateIcons.set(ref, "");
  const state: TabSyncState = {
    seq,
    tabs: next.map((tab) => ({ ...tab })),
    icons: stateIcons,
  };
  if (
    prev &&
    !orderChanged &&
    set.length === 0 &&
    unset.length === 0 &&
    newIcons === 0
  )
    return { patch: null, state: { ...state, seq: prev.seq } };
  const patch: TabPatch = { seq, base: prev ? prev.seq : null };
  if (orderChanged) patch.order = next.map((tab) => tab.id);
  if (set.length > 0) patch.set = set;
  if (unset.length > 0) patch.unset = unset;
  if (newIcons > 0) patch.icons = icons;
  return { patch, state };
}

/** Apply `patch` to what the receiver holds; null when it doesn't fit (the receiver should resync). */
export function applyTabPatch(
  prev: TabSyncState | null,
  patch: TabPatch,
): TabSyncState | null {
  if (!patch || typeof patch.seq !== "number") return null;
  if (patch.base !== null && (!prev || prev.seq !== patch.base)) return null;
  const base = patch.base === null ? null : prev;
  const byId = new Map((base?.tabs ?? []).map((tab) => [tab.id, { ...tab }]));
  for (const fields of patch.set ?? []) {
    const current = byId.get(fields.id);
    byId.set(
      fields.id,
      current
        ? { ...current, ...fields }
        : ({ ...fields } as BrowserTabSummary),
    );
  }
  for (const [id, keys] of patch.unset ?? []) {
    const current = byId.get(id);
    if (current)
      for (const key of keys)
        delete (current as Partial<BrowserTabSummary>)[key];
  }
  const order = patch.order ?? base?.tabs.map((tab) => tab.id) ?? [];
  const tabs: BrowserTabSummary[] = [];
  for (const id of order) {
    const tab = byId.get(id);
    if (!tab) return null;
    tabs.push(tab);
  }
  const refs = referencedIcons(tabs);
  const icons = new Map<string, string>();
  for (const ref of refs) {
    const data = patch.icons?.[ref] ?? base?.icons.get(ref);
    if (data !== undefined) icons.set(ref, data);
  }
  return { seq: patch.seq, tabs, icons };
}

/** The receiver's list as the renderer wants it: favicon refs swapped back for their data. */
export function resolveTabs(state: TabSyncState): BrowserTabSummary[] {
  return state.tabs.map((tab) =>
    isFaviconRef(tab.faviconUrl)
      ? { ...tab, faviconUrl: state.icons.get(tab.faviconUrl) ?? null }
      : tab,
  );
}

/**
 * Coalesces bursts of "something changed" into at most one flush per `frameMs` per key. An
 * isolated change flushes on the next tick (leading edge); changes inside the frame after a
 * flush wait for the frame to end (trailing edge), so a tab open's ~7 updates become 1–2 sends.
 */
export function createBroadcastQueue<K>(
  flush: (key: K, state: boolean) => void,
  frameMs = 16,
) {
  const dirty = new Map<K, boolean>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  const run = (): void => {
    timer = null;
    lastFlushAt = Date.now();
    const items = [...dirty];
    dirty.clear();
    for (const [key, state] of items) {
      try {
        flush(key, state);
      } catch (error) {
        console.error("Tab broadcast failed", error);
      }
    }
  };
  return {
    /** Something changed for `key`; `state` = the per-window browser state changed too. */
    mark(key: K, state: boolean): void {
      dirty.set(key, (dirty.get(key) ?? false) || state);
      if (timer) return;
      timer = setTimeout(run, Math.max(0, lastFlushAt + frameMs - Date.now()));
    },
    /** Send anything pending now (e.g. before a window closes or the session is saved). */
    flushNow(): void {
      if (timer) clearTimeout(timer);
      if (dirty.size > 0) run();
      else timer = null;
    },
    forget(key: K): void {
      dirty.delete(key);
    },
    get pending(): number {
      return dirty.size;
    },
  };
}
