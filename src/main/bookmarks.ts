import { app } from "electron";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { deferWrite, cancelDeferredWrite } from "./deferred-writes";
import { sendToMainWindowRenderers } from "./browser-shell";
import {
  addBookmark,
  addBookmarkFolder,
  applyFavouriteSites,
  BOOKMARKS_ROOT_ID,
  bookmarksSnapshot,
  FAVOURITES_FOLDER_ID,
  FAVOURITES_FOLDER_TITLE,
  favouriteSites,
  findBookmarksByUrl,
  getBookmarkNode,
  importBookmarkTree,
  migratePinnedSitesToBookmarks,
  moveBookmarkNode,
  moveBookmarkNodes,
  normalizeBookmarkUrl,
  parseBookmarkStore,
  removeBookmarkNodes,
  serializeBookmarkStore,
  toImportedTree,
  updateBookmarkFavicons,
  updateBookmarkNode,
  type BookmarkImportResult,
  type BookmarkStore,
  type ImportedBookmarkNode,
} from "../shared/bookmarks";
import {
  MAX_PINNED_SITES,
  parseBrowserPreferences,
} from "../shared/persistence";
import { exportNetscapeBookmarks } from "../shared/bookmark-import";
import type {
  BookmarkNode,
  BookmarksSnapshot,
  PinnedSite,
} from "../shared/types";
import { getProfileDatabase, reportStoreWriteError } from "./store";
import { BookmarkTable } from "./store/bookmark-store";
import { databaseCopyIsCurrent, settleDualWrite } from "./store/legacy-json";
import { writeUserJson } from "./user-json";

/**
 * The bookmark tree lives in surffish.db (`bookmarks`, see store/bookmark-store.ts) and in
 * bookmarks.json, both written through the coalesced deferred-write helper. The database write is
 * a diff (one row per changed node) after each burst of edits; the JSON file is kept alongside as
 * the fallback and for older builds, rewritten at most every 30 s and at quit. Startup reads the database when it has the tree and bookmarks.json is unchanged since
 * Surffish wrote it; otherwise the JSON wins and is imported into the database off the startup path.
 * `SURFFISH_STORE=json` (or a database that won't open) keeps the JSON-only behaviour.
 *
 * On first run the tree is seeded from the old 12-site pinned strip, which stays untouched in
 * browser-preferences.json so an older build still finds it.
 */

const BOOKMARKS_FILE = "bookmarks.json";
const LEGACY_PREFERENCES_FILE = "browser-preferences.json";
const WRITE_DELAY_MS = 800;
/**
 * With the database in use, bookmarks.json is only the fallback/downgrade copy, so it is rewritten
 * at most this often (and at quit) instead of after every edit. If Surffish dies in between, the
 * file is merely older than the database: its import stamp still matches, so the next start reads
 * the database, which has every edit.
 */
const JSON_MIRROR_DELAY_MS = 30_000;

let store: BookmarkStore | null = null;
let table: BookmarkTable | null | undefined;
let snapshotCache: BookmarksSnapshot | null = null;
let notifyScheduled = false;

function filePath(filename: string): string {
  return join(app.getPath("userData"), filename);
}

function readJsonFile(filename: string): {
  exists: boolean;
  value: unknown;
  error: boolean;
} {
  const path = filePath(filename);
  if (!existsSync(path)) return { exists: false, value: null, error: false };
  try {
    return {
      exists: true,
      value: JSON.parse(readFileSync(path, "utf8")) as unknown,
      error: false,
    };
  } catch (error) {
    console.warn(`Could not read ${filename}:`, error);
    return { exists: true, value: null, error: true };
  }
}

/** The bookmarks table, or null (no database, or it failed this run: bookmarks.json only). */
function sqlTable(): BookmarkTable | null {
  if (table !== undefined) return table;
  const db = getProfileDatabase();
  table = db ? new BookmarkTable(db) : null;
  return table;
}

/** The tree from the database when its copy is current (see the header), else null. */
function loadFromDatabase(): BookmarkStore | null {
  const db = getProfileDatabase();
  const target = sqlTable();
  if (!db || !target) return null;
  try {
    if (
      !databaseCopyIsCurrent(
        db,
        BOOKMARKS_FILE,
        filePath(BOOKMARKS_FILE),
        target.hasSavedTree(),
      )
    )
      return null;
    const saved = target.load();
    return saved ? parseBookmarkStore(saved) : null;
  } catch (error) {
    console.error(
      "Could not read bookmarks from the database; using bookmarks.json:",
      error,
    );
    return null;
  }
}

/** True when the database now holds `current`. A failure leaves bookmarks.json as the only copy for this run. */
function saveToDatabase(current: BookmarkStore): boolean {
  const target = sqlTable();
  if (!target) return false;
  try {
    target.save(current);
    return true;
  } catch (error) {
    reportStoreWriteError(
      "Could not save bookmarks to the database (bookmarks.json still has them):",
      error,
    );
    table = null;
    return false;
  }
}

/** Database-only write for an edit burst (bookmarks.json follows on the slower mirror timer). */
function saveEdit(current: BookmarkStore): void {
  if (saveToDatabase(current)) return;
  // The database just failed: bookmarks.json becomes the only copy, so bring it up to date now.
  settleDualWrite(
    getProfileDatabase(),
    BOOKMARKS_FILE,
    filePath(BOOKMARKS_FILE),
    false,
    false,
  );
  cancelDeferredWrite("bookmarks-json");
  writeUserJson(BOOKMARKS_FILE, serializeBookmarkStore(current));
}

/** Write both copies, then record whether bookmarks.json matches the database. */
function writeStore(current: BookmarkStore): void {
  const jsonSaved = writeUserJson(
    BOOKMARKS_FILE,
    serializeBookmarkStore(current),
  );
  const hadTable = sqlTable() !== null;
  const databaseSaved = saveToDatabase(current);
  if (hadTable)
    settleDualWrite(
      getProfileDatabase(),
      BOOKMARKS_FILE,
      filePath(BOOKMARKS_FILE),
      databaseSaved,
      jsonSaved,
    );
}

function legacyPinnedSites(): PinnedSite[] {
  return parseBrowserPreferences(readJsonFile(LEGACY_PREFERENCES_FILE).value)
    .pinnedSites;
}

function loadStore(): BookmarkStore {
  if (store) return store;
  const fromDatabase = loadFromDatabase();
  if (fromDatabase) {
    store = fromDatabase;
    return store;
  }
  const saved = readJsonFile(BOOKMARKS_FILE);
  const parsed = saved.exists ? parseBookmarkStore(saved.value) : null;
  if (parsed) {
    store = parsed;
    scheduleImport();
    return store;
  }
  if (saved.exists) {
    // Keep an unreadable file aside instead of overwriting someone's bookmarks with an empty tree.
    try {
      renameSync(
        filePath(BOOKMARKS_FILE),
        filePath(`${BOOKMARKS_FILE}.unreadable-${Date.now()}`),
      );
    } catch (error) {
      console.error(
        "Could not set aside the unreadable bookmarks file:",
        error,
      );
    }
  }
  store = migratePinnedSitesToBookmarks(legacyPinnedSites());
  writeUserJson(BOOKMARKS_FILE, serializeBookmarkStore(store));
  scheduleImport();
  return store;
}

/** The tree came from bookmarks.json: copy it into the database once startup has settled. */
function scheduleImport(): void {
  if (!sqlTable()) return;
  deferWrite(
    "bookmarks-import",
    () => {
      const current = store;
      if (!current) return;
      const databaseSaved = saveToDatabase(current);
      // The JSON file already holds this tree (it is what was just read), so stamp it as matching.
      settleDualWrite(
        getProfileDatabase(),
        BOOKMARKS_FILE,
        filePath(BOOKMARKS_FILE),
        databaseSaved,
        databaseSaved,
      );
    },
    1500,
  );
}

function persist(): void {
  snapshotCache = null;
  const current = store;
  if (!current) return;
  // A pending import is superseded: this write saves the current tree to both copies.
  cancelDeferredWrite("bookmarks-import");
  if (sqlTable()) {
    deferWrite("bookmarks", () => saveEdit(current), WRITE_DELAY_MS);
    deferWrite(
      "bookmarks-json",
      () => {
        if (store) writeStore(store);
      },
      JSON_MIRROR_DELAY_MS,
    );
  } else {
    deferWrite("bookmarks", () => writeStore(current), WRITE_DELAY_MS);
  }
  scheduleNotify();
}

function scheduleNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Batch a burst of edits (drag + drop, multi-delete) into one renderer update.
  setImmediate(() => {
    notifyScheduled = false;
    sendToMainWindowRenderers(
      "browser:bookmarks-changed",
      getBookmarksSnapshot(),
    );
  });
}

/** Run a mutation, then queue the write and the renderer update (nothing is saved if it throws). */
function mutate<T>(change: (current: BookmarkStore) => T): T {
  const result = change(loadStore());
  persist();
  return result;
}

export function getBookmarksSnapshot(): BookmarksSnapshot {
  if (!snapshotCache) snapshotCache = bookmarksSnapshot(loadStore());
  return snapshotCache;
}

/** The sidebar strip / new tab favourites: the first 12 bookmarks in Favourites. */
export function getFavouriteSites(): PinnedSite[] {
  return favouriteSites(loadStore(), MAX_PINNED_SITES);
}

/** Legacy pinned-sites API: replace the visible strip. */
export function saveFavouriteSites(sites: readonly PinnedSite[]): PinnedSite[] {
  mutate((current) => applyFavouriteSites(current, sites, MAX_PINNED_SITES));
  return getFavouriteSites();
}

export function findBookmarksForUrl(url: string): BookmarkNode[] {
  return findBookmarksByUrl(loadStore(), url);
}

export function isUrlBookmarked(url: string): boolean {
  return findBookmarksForUrl(url).length > 0;
}

export interface CreateBookmarkRequest {
  parentId?: unknown;
  title?: unknown;
  url?: unknown;
  index?: unknown;
  faviconUrl?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

export function createBookmark(request: CreateBookmarkRequest): BookmarkNode {
  if (typeof request.url !== "string")
    throw new Error("Only http(s) addresses can be bookmarked.");
  return mutate((current) =>
    addBookmark(current, {
      parentId: optionalString(request.parentId),
      title: optionalString(request.title),
      url: request.url as string,
      index: optionalIndex(request.index),
      faviconUrl: optionalString(request.faviconUrl),
    }),
  );
}

export function createBookmarkFolder(request: {
  parentId?: unknown;
  title?: unknown;
  index?: unknown;
}): BookmarkNode {
  return mutate((current) =>
    addBookmarkFolder(current, {
      parentId: optionalString(request.parentId),
      title: optionalString(request.title),
      index: optionalIndex(request.index),
    }),
  );
}

export function editBookmark(
  id: unknown,
  patch: { title?: unknown; url?: unknown; parentId?: unknown },
): BookmarkNode {
  if (typeof id !== "string")
    throw new Error("That bookmark no longer exists.");
  return mutate((current) => {
    let node = updateBookmarkNode(current, id, {
      title: patch.title,
      url: patch.url,
    });
    if (typeof patch.parentId === "string" && patch.parentId !== node.parentId)
      node = moveBookmarkNode(current, id, patch.parentId);
    return node;
  });
}

export function moveBookmarks(
  ids: unknown,
  parentId: unknown,
  index?: unknown,
): number {
  if (!Array.isArray(ids) || typeof parentId !== "string") return 0;
  const list = ids
    .filter((id): id is string => typeof id === "string")
    .slice(0, 10_000);
  // `index` is the slot in the target folder as it looks now (before the dragged items leave it).
  return mutate((current) =>
    moveBookmarkNodes(current, list, parentId, optionalIndex(index)),
  );
}

export function deleteBookmarks(ids: unknown): number {
  if (!Array.isArray(ids)) return 0;
  const list = ids
    .filter((id): id is string => typeof id === "string")
    .slice(0, 10_000);
  return mutate((current) => removeBookmarkNodes(current, list));
}

/** Star / Cmd+D: bookmark the page into Favourites (or return the existing bookmark). */
export function bookmarkPage(
  url: string,
  title: string,
  faviconUrl: string | null,
  isPrivate: boolean,
): { node: BookmarkNode; created: boolean } | null {
  if (!normalizeBookmarkUrl(url)) return null;
  const existing = findBookmarksForUrl(url)[0];
  if (existing) return { node: existing, created: false };
  // Private tabs may bookmark on an explicit action, but never leave a favicon behind.
  const node = createBookmark({
    parentId: FAVOURITES_FOLDER_ID,
    title,
    url,
    faviconUrl: isPrivate ? undefined : (faviconUrl ?? undefined),
  });
  return { node, created: true };
}

/** Tab menu "Remove Bookmark": drop every bookmark of that exact page. */
export function removeBookmarksForUrl(url: string): number {
  const ids = findBookmarksForUrl(url).map((node) => node.id);
  return ids.length > 0 ? deleteBookmarks(ids) : 0;
}

/** Cmd+Shift+D: a new top-level folder holding every given page. */
export function bookmarkPagesInNewFolder(
  pages: ReadonlyArray<{ url: string; title: string }>,
  folderTitle: string,
): { folder: BookmarkNode; added: number } | null {
  const valid = pages.filter((page) => normalizeBookmarkUrl(page.url));
  if (valid.length === 0) return null;
  return mutate((current) => {
    const folder = addBookmarkFolder(current, {
      parentId: BOOKMARKS_ROOT_ID,
      title: folderTitle,
    });
    for (const page of valid)
      addBookmark(current, {
        parentId: folder.id,
        title: page.title,
        url: page.url,
      });
    return {
      folder: getBookmarkNode(current, folder.id)!,
      added: valid.length,
    };
  });
}

/** Called for non-private page loads only (see persistPageFavicon). */
export function recordBookmarkFavicon(
  pageUrl: string,
  faviconUrl: string,
): void {
  const current = loadStore();
  if (updateBookmarkFavicons(current, pageUrl, faviconUrl)) persist();
}

export function importBookmarks(
  sourceLabel: string,
  items: readonly ImportedBookmarkNode[],
): BookmarkImportResult {
  return mutate((current) => importBookmarkTree(current, sourceLabel, items));
}

export function exportBookmarksHtml(): string {
  return exportNetscapeBookmarks(toImportedTree(loadStore()), {
    toolbarFolderTitle: FAVOURITES_FOLDER_TITLE,
  });
}
