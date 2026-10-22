import type { BookmarkNode, BookmarksSnapshot, PinnedSite } from "./types";

/**
 * Bookmark store: a tree of folders and bookmarks. The order of each folder lives in `children`
 * (the source of truth); every node's `parentId`/`index` is derived from it when the store is
 * serialised or snapshotted, so moves never leave gaps or duplicate positions.
 *
 * The invisible root holds the top level. "Favourites" is a fixed top-level folder: its first
 * MAX_PINNED_SITES bookmarks are the sidebar strip and the new tab favourites.
 */

export const BOOKMARKS_ROOT_ID = "root";
export const FAVOURITES_FOLDER_ID = "favourites";
export const FAVOURITES_FOLDER_TITLE = "Favourites";
export const MAX_BOOKMARK_NODES = 50_000;
export const MAX_BOOKMARK_TITLE_LENGTH = 300;
export const MAX_BOOKMARK_URL_LENGTH = 8_192;
const MAX_FOLDER_DEPTH = 64;

export interface BookmarkStore {
  nodes: Map<string, BookmarkNode>;
  children: Map<string, string[]>;
}

export type IdFactory = () => string;

const defaultId: IdFactory = () => globalThis.crypto.randomUUID();

export interface ImportedBookmarkNode {
  title: string;
  url?: string;
  dateAdded?: number;
  children?: ImportedBookmarkNode[];
}

export interface BookmarkImportResult {
  folderId: string | null;
  folderTitle: string;
  added: number;
  folders: number;
  duplicates: number;
  skipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bookmarks keep the exact URL (query and hash included) but only for http(s) without credentials. */
export function normalizeBookmarkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_BOOKMARK_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeBookmarkTitle(value: unknown, fallback = ""): string {
  const title =
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().slice(0, MAX_BOOKMARK_TITLE_LENGTH)
      : "";
  return title || fallback;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function safeFavicon(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4_096) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function finiteTime(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

export function createBookmarkStore(now = Date.now()): BookmarkStore {
  const store: BookmarkStore = { nodes: new Map(), children: new Map() };
  store.nodes.set(BOOKMARKS_ROOT_ID, {
    id: BOOKMARKS_ROOT_ID,
    type: "folder",
    title: "Bookmarks",
    parentId: null,
    index: 0,
    dateAdded: now,
  });
  store.children.set(BOOKMARKS_ROOT_ID, []);
  ensureFavouritesFolder(store, now);
  return store;
}

function ensureFavouritesFolder(store: BookmarkStore, now: number): void {
  const existing = store.nodes.get(FAVOURITES_FOLDER_ID);
  if (existing && existing.type === "folder") {
    existing.title = FAVOURITES_FOLDER_TITLE;
    return;
  }
  store.nodes.set(FAVOURITES_FOLDER_ID, {
    id: FAVOURITES_FOLDER_ID,
    type: "folder",
    title: FAVOURITES_FOLDER_TITLE,
    parentId: BOOKMARKS_ROOT_ID,
    index: 0,
    dateAdded: now,
  });
  store.children.set(FAVOURITES_FOLDER_ID, []);
  store.children.get(BOOKMARKS_ROOT_ID)!.unshift(FAVOURITES_FOLDER_ID);
}

export function isFixedBookmarkFolder(id: string): boolean {
  return id === BOOKMARKS_ROOT_ID || id === FAVOURITES_FOLDER_ID;
}

export function getBookmarkNode(
  store: BookmarkStore,
  id: string,
): BookmarkNode | null {
  const node = store.nodes.get(id);
  if (!node) return null;
  const parentId = parentOf(store, id);
  return {
    ...node,
    parentId,
    index: parentId ? store.children.get(parentId)!.indexOf(id) : 0,
  };
}

function parentOf(store: BookmarkStore, id: string): string | null {
  return store.nodes.get(id)?.parentId ?? null;
}

export function getBookmarkChildren(
  store: BookmarkStore,
  parentId: string,
): BookmarkNode[] {
  return (store.children.get(parentId) ?? []).map((id, index) => ({
    ...store.nodes.get(id)!,
    parentId,
    index,
  }));
}

/** True when `id` is `ancestorId` or sits anywhere below it. */
export function isBookmarkDescendant(
  store: BookmarkStore,
  id: string,
  ancestorId: string,
): boolean {
  let current: string | null = id;
  let guard = 0;
  while (current && guard++ < MAX_BOOKMARK_NODES) {
    if (current === ancestorId) return true;
    current = parentOf(store, current);
  }
  return false;
}

function folderDepth(store: BookmarkStore, id: string): number {
  let depth = 0;
  let current = parentOf(store, id);
  while (current && depth < MAX_BOOKMARK_NODES) {
    depth++;
    current = parentOf(store, current);
  }
  return depth;
}

function insertChild(
  store: BookmarkStore,
  parentId: string,
  id: string,
  index?: number,
): void {
  const list = store.children.get(parentId)!;
  const at =
    index === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > list.length
      ? list.length
      : index;
  list.splice(at, 0, id);
  store.nodes.get(id)!.parentId = parentId;
}

function requireFolder(store: BookmarkStore, id: string): BookmarkNode {
  const node = store.nodes.get(id);
  if (!node || node.type !== "folder")
    throw new Error("That bookmark folder no longer exists.");
  return node;
}

function assertCapacity(store: BookmarkStore, extra = 1): void {
  if (store.nodes.size + extra > MAX_BOOKMARK_NODES)
    throw new Error(
      `Surffish keeps up to ${MAX_BOOKMARK_NODES.toLocaleString("en")} bookmarks and folders.`,
    );
}

export interface NewBookmarkInput {
  parentId?: string;
  title?: string;
  url: string;
  index?: number;
  dateAdded?: number;
  faviconUrl?: string | null;
}

export function addBookmark(
  store: BookmarkStore,
  input: NewBookmarkInput,
  makeId: IdFactory = defaultId,
  now = Date.now(),
): BookmarkNode {
  const url = normalizeBookmarkUrl(input.url);
  if (!url) throw new Error("Only http(s) addresses can be bookmarked.");
  const parentId = input.parentId ?? FAVOURITES_FOLDER_ID;
  requireFolder(store, parentId);
  assertCapacity(store);
  const faviconUrl = safeFavicon(input.faviconUrl);
  const node: BookmarkNode = {
    id: makeId(),
    type: "bookmark",
    title: normalizeBookmarkTitle(input.title, hostnameOf(url)),
    url,
    parentId,
    index: 0,
    dateAdded: finiteTime(input.dateAdded, now),
    ...(faviconUrl ? { faviconUrl } : {}),
  };
  store.nodes.set(node.id, node);
  insertChild(store, parentId, node.id, input.index);
  return getBookmarkNode(store, node.id)!;
}

export interface NewFolderInput {
  parentId?: string;
  title?: string;
  index?: number;
  dateAdded?: number;
}

export function addBookmarkFolder(
  store: BookmarkStore,
  input: NewFolderInput,
  makeId: IdFactory = defaultId,
  now = Date.now(),
): BookmarkNode {
  const parentId = input.parentId ?? BOOKMARKS_ROOT_ID;
  requireFolder(store, parentId);
  assertCapacity(store);
  if (folderDepth(store, parentId) >= MAX_FOLDER_DEPTH)
    throw new Error("Bookmark folders are nested too deeply.");
  const node: BookmarkNode = {
    id: makeId(),
    type: "folder",
    title: normalizeBookmarkTitle(input.title, "New folder"),
    parentId,
    index: 0,
    dateAdded: finiteTime(input.dateAdded, now),
  };
  store.nodes.set(node.id, node);
  store.children.set(node.id, []);
  insertChild(store, parentId, node.id, input.index);
  return getBookmarkNode(store, node.id)!;
}

export function updateBookmarkNode(
  store: BookmarkStore,
  id: string,
  patch: { title?: unknown; url?: unknown },
): BookmarkNode {
  const node = store.nodes.get(id);
  if (!node || id === BOOKMARKS_ROOT_ID)
    throw new Error("That bookmark no longer exists.");
  if (id === FAVOURITES_FOLDER_ID && patch.title !== undefined)
    throw new Error("The Favourites folder cannot be renamed.");
  if (node.type === "bookmark" && patch.url !== undefined) {
    const url = normalizeBookmarkUrl(patch.url);
    if (!url) throw new Error("Only http(s) addresses can be bookmarked.");
    if (url !== node.url) delete node.faviconUrl;
    node.url = url;
  }
  if (patch.title !== undefined)
    node.title = normalizeBookmarkTitle(
      patch.title,
      node.type === "bookmark" ? hostnameOf(node.url ?? "") : "Untitled folder",
    );
  return getBookmarkNode(store, id)!;
}

/**
 * Move `id` into `parentId` so it ends up at `index` among that folder's children (after the
 * move; out-of-range or missing means the end). Folders can't move into themselves.
 */
export function moveBookmarkNode(
  store: BookmarkStore,
  id: string,
  parentId: string,
  index?: number,
): BookmarkNode {
  const node = store.nodes.get(id);
  if (!node) throw new Error("That bookmark no longer exists.");
  if (isFixedBookmarkFolder(id))
    throw new Error(`${node.title} can't be moved.`);
  requireFolder(store, parentId);
  if (isBookmarkDescendant(store, parentId, id))
    throw new Error("A folder can't be moved into itself.");
  if (
    node.type === "folder" &&
    folderDepth(store, parentId) + subtreeHeight(store, id) >= MAX_FOLDER_DEPTH
  )
    throw new Error("Bookmark folders are nested too deeply.");
  const oldParent = node.parentId!;
  const oldList = store.children.get(oldParent)!;
  oldList.splice(oldList.indexOf(id), 1);
  insertChild(store, parentId, id, index);
  return getBookmarkNode(store, id)!;
}

function subtreeHeight(store: BookmarkStore, id: string): number {
  let height = 0;
  const stack: Array<[string, number]> = [[id, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    height = Math.max(height, depth);
    for (const child of store.children.get(current) ?? [])
      stack.push([child, depth + 1]);
  }
  return height;
}

/** Delete a node and everything below it; returns how many nodes were removed. */
export function removeBookmarkNode(store: BookmarkStore, id: string): number {
  const node = store.nodes.get(id);
  if (!node) return 0;
  if (isFixedBookmarkFolder(id))
    throw new Error(`${node.title} can't be deleted.`);
  const list = store.children.get(node.parentId!)!;
  list.splice(list.indexOf(id), 1);
  let removed = 0;
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of store.children.get(current) ?? []) stack.push(child);
    store.children.delete(current);
    if (store.nodes.delete(current)) removed++;
  }
  return removed;
}

/** Remove several nodes at once (descendants of a removed folder are skipped, not double-counted). */
export function removeBookmarkNodes(
  store: BookmarkStore,
  ids: readonly string[],
): number {
  let removed = 0;
  for (const id of ids) {
    if (!store.nodes.has(id) || isFixedBookmarkFolder(id)) continue;
    removed += removeBookmarkNode(store, id);
  }
  return removed;
}

/** Move several nodes into one folder, keeping their relative order, starting at `index`. */
export function moveBookmarkNodes(
  store: BookmarkStore,
  ids: readonly string[],
  parentId: string,
  index?: number,
): number {
  requireFolder(store, parentId);
  let at = index;
  let moved = 0;
  const ordered = orderedForMove(store, ids);
  for (const id of ordered) {
    if (
      !store.nodes.has(id) ||
      isFixedBookmarkFolder(id) ||
      isBookmarkDescendant(store, parentId, id)
    )
      continue;
    // Skip nodes whose folder is also moving: they travel with it.
    if (
      ordered.some(
        (other) => other !== id && isBookmarkDescendant(store, id, other),
      )
    )
      continue;
    const before = store.children.get(parentId)!.indexOf(id);
    if (at !== undefined && before >= 0 && before < at) at--;
    moveBookmarkNode(store, id, parentId, at);
    if (at !== undefined) at++;
    moved++;
  }
  return moved;
}

function orderedForMove(
  store: BookmarkStore,
  ids: readonly string[],
): string[] {
  const wanted = new Set(ids);
  return walkBookmarkTree(store)
    .filter((node) => wanted.has(node.id))
    .map((node) => node.id);
}

/** Pre-order walk (root excluded) with parentId/index filled in. */
export function walkBookmarkTree(
  store: BookmarkStore,
  fromId = BOOKMARKS_ROOT_ID,
): BookmarkNode[] {
  const result: BookmarkNode[] = [];
  const visit = (parentId: string): void => {
    const list = store.children.get(parentId) ?? [];
    list.forEach((id, index) => {
      const node = store.nodes.get(id);
      if (!node) return;
      result.push({ ...node, parentId, index });
      if (node.type === "folder") visit(id);
    });
  };
  visit(fromId);
  return result;
}

export function findBookmarksByUrl(
  store: BookmarkStore,
  urlInput: string,
): BookmarkNode[] {
  const url = normalizeBookmarkUrl(urlInput);
  if (!url) return [];
  return walkBookmarkTree(store).filter(
    (node) => node.type === "bookmark" && node.url === url,
  );
}

export function bookmarkUrlSet(store: BookmarkStore): Set<string> {
  const urls = new Set<string>();
  for (const node of store.nodes.values())
    if (node.type === "bookmark" && node.url) urls.add(node.url);
  return urls;
}

export function bookmarksSnapshot(store: BookmarkStore): BookmarksSnapshot {
  return { nodes: walkBookmarkTree(store) };
}

export function serializeBookmarkStore(store: BookmarkStore): {
  version: 1;
  nodes: BookmarkNode[];
} {
  return { version: 1, nodes: walkBookmarkTree(store) };
}

/**
 * Rebuild a store from disk. Nodes are re-sorted by (parent, index); anything whose parent is
 * missing, not a folder, or would form a cycle lands at the top level instead of disappearing.
 */
export function parseBookmarkStore(
  value: unknown,
  now = Date.now(),
): BookmarkStore | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes))
    return null;
  const store = createBookmarkStore(now);
  const pending: Array<{
    node: BookmarkNode;
    parentId: string;
    index: number;
  }> = [];
  for (const raw of value.nodes.slice(0, MAX_BOOKMARK_NODES)) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !raw.id ||
      raw.id.length > 128 ||
      raw.id === BOOKMARKS_ROOT_ID
    )
      continue;
    if (store.nodes.has(raw.id) && raw.id !== FAVOURITES_FOLDER_ID) continue;
    const type =
      raw.type === "folder"
        ? "folder"
        : raw.type === "bookmark"
          ? "bookmark"
          : null;
    if (!type) continue;
    if (raw.id === FAVOURITES_FOLDER_ID) {
      if (type === "folder")
        store.nodes.get(FAVOURITES_FOLDER_ID)!.dateAdded = finiteTime(
          raw.dateAdded,
          now,
        );
      continue;
    }
    const url = type === "bookmark" ? normalizeBookmarkUrl(raw.url) : null;
    if (type === "bookmark" && !url) continue;
    const faviconUrl =
      type === "bookmark" ? safeFavicon(raw.faviconUrl) : undefined;
    const node: BookmarkNode = {
      id: raw.id,
      type,
      title: normalizeBookmarkTitle(
        raw.title,
        type === "bookmark" ? hostnameOf(url!) : "Untitled folder",
      ),
      ...(url ? { url } : {}),
      parentId: null,
      index: 0,
      dateAdded: finiteTime(raw.dateAdded, now),
      ...(faviconUrl ? { faviconUrl } : {}),
    };
    store.nodes.set(node.id, node);
    if (type === "folder") store.children.set(node.id, []);
    pending.push({
      node,
      parentId:
        typeof raw.parentId === "string" ? raw.parentId : BOOKMARKS_ROOT_ID,
      index:
        typeof raw.index === "number" ? raw.index : Number.MAX_SAFE_INTEGER,
    });
  }
  pending.sort((a, b) => a.index - b.index);
  for (const { node, parentId } of pending) {
    const parent = store.nodes.get(parentId);
    node.parentId =
      parent && parent.type === "folder" && parentId !== node.id
        ? parentId
        : BOOKMARKS_ROOT_ID;
  }
  // Break cycles (a -> b -> a): any node that can't reach the root is re-parented to it.
  for (const { node } of pending) {
    const seen = new Set<string>();
    let current: string | null = node.id;
    while (current && current !== BOOKMARKS_ROOT_ID && !seen.has(current)) {
      seen.add(current);
      current = store.nodes.get(current)?.parentId ?? null;
    }
    if (current !== BOOKMARKS_ROOT_ID) node.parentId = BOOKMARKS_ROOT_ID;
  }
  for (const { node } of pending)
    store.children.get(node.parentId!)!.push(node.id);
  return store;
}

/** First run: the old 12-site strip becomes the Favourites folder, in the same order. */
export function migratePinnedSitesToBookmarks(
  pinnedSites: readonly PinnedSite[],
  makeId: IdFactory = defaultId,
  now = Date.now(),
): BookmarkStore {
  const store = createBookmarkStore(now);
  const seen = new Set<string>();
  for (const site of pinnedSites) {
    const url = normalizeBookmarkUrl(site.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    addBookmark(
      store,
      {
        parentId: FAVOURITES_FOLDER_ID,
        title: site.title,
        url,
        faviconUrl: site.faviconUrl,
        dateAdded: now,
      },
      makeId,
      now,
    );
  }
  return store;
}

/** The sidebar strip and new tab favourites: the first `limit` bookmarks directly in Favourites. */
export function favouriteSites(
  store: BookmarkStore,
  limit: number,
): PinnedSite[] {
  const sites: PinnedSite[] = [];
  for (const node of getBookmarkChildren(store, FAVOURITES_FOLDER_ID)) {
    if (node.type !== "bookmark" || !node.url) continue;
    sites.push({
      title: node.title,
      url: node.url,
      ...(node.faviconUrl ? { faviconUrl: node.faviconUrl } : {}),
    });
    if (sites.length >= limit) break;
  }
  return sites;
}

/**
 * Apply an edit of the visible strip (the legacy pinned-sites API): visible favourites missing
 * from `sites` are deleted, new URLs are added, and the visible ones take the given order.
 * Favourites past the strip limit and sub-folders are left alone.
 */
export function applyFavouriteSites(
  store: BookmarkStore,
  sites: readonly PinnedSite[],
  limit: number,
  makeId: IdFactory = defaultId,
  now = Date.now(),
): void {
  const visible = getBookmarkChildren(store, FAVOURITES_FOLDER_ID)
    .filter((node) => node.type === "bookmark")
    .slice(0, limit);
  const wanted: PinnedSite[] = [];
  const wantedUrls = new Set<string>();
  for (const site of sites) {
    const url = normalizeBookmarkUrl(site.url);
    if (!url || wantedUrls.has(url)) continue;
    wantedUrls.add(url);
    wanted.push({ ...site, url });
    if (wanted.length >= limit) break;
  }
  for (const node of visible)
    if (!wantedUrls.has(node.url!)) removeBookmarkNode(store, node.id);
  const remaining = new Map(
    getBookmarkChildren(store, FAVOURITES_FOLDER_ID)
      .filter((node) => node.type === "bookmark")
      .map((node) => [node.url!, node.id]),
  );
  const list = store.children.get(FAVOURITES_FOLDER_ID)!;
  // Visible bookmarks keep the slots bookmarks held before; anything else stays after them.
  const orderedIds = wanted.map((site) => {
    const existing = remaining.get(site.url);
    if (existing) {
      const node = store.nodes.get(existing)!;
      if (site.title)
        node.title = normalizeBookmarkTitle(site.title, node.title);
      return existing;
    }
    return addBookmark(
      store,
      {
        parentId: FAVOURITES_FOLDER_ID,
        title: site.title,
        url: site.url,
        faviconUrl: site.faviconUrl,
      },
      makeId,
      now,
    ).id;
  });
  const ordered = new Set(orderedIds);
  const rest = list.filter((id) => !ordered.has(id));
  list.splice(0, list.length, ...orderedIds, ...rest);
}

/** Record a page's favicon on every bookmark of that exact page or that site's root. */
export function updateBookmarkFavicons(
  store: BookmarkStore,
  pageUrl: string,
  faviconUrl: string,
): boolean {
  const icon = safeFavicon(faviconUrl);
  const url = normalizeBookmarkUrl(pageUrl);
  if (!icon || !url) return false;
  const origin = new URL(url).origin;
  let changed = false;
  for (const node of store.nodes.values()) {
    if (node.type !== "bookmark" || !node.url || node.faviconUrl === icon)
      continue;
    if (node.url === url || node.url === `${origin}/`) {
      node.faviconUrl = icon;
      changed = true;
    }
  }
  return changed;
}

/**
 * Add an imported tree under a new "Imported from X" top-level folder. URLs already bookmarked
 * (anywhere) or repeated within the import are skipped; folders left empty are dropped.
 */
export function importBookmarkTree(
  store: BookmarkStore,
  sourceLabel: string,
  items: readonly ImportedBookmarkNode[],
  makeId: IdFactory = defaultId,
  now = Date.now(),
): BookmarkImportResult {
  const existing = bookmarkUrlSet(store);
  const folderTitle = normalizeBookmarkTitle(
    `Imported from ${sourceLabel}`,
    "Imported bookmarks",
  );
  const result: BookmarkImportResult = {
    folderId: null,
    folderTitle,
    added: 0,
    folders: 0,
    duplicates: 0,
    skipped: 0,
  };
  const top = addBookmarkFolder(
    store,
    { parentId: BOOKMARKS_ROOT_ID, title: folderTitle, dateAdded: now },
    makeId,
    now,
  );
  const visit = (
    parentId: string,
    nodes: readonly ImportedBookmarkNode[],
    depth: number,
  ): void => {
    for (const item of nodes) {
      if (item.children) {
        if (
          depth >= MAX_FOLDER_DEPTH - 2 ||
          store.nodes.size >= MAX_BOOKMARK_NODES
        ) {
          result.skipped += countImported(item.children);
          continue;
        }
        const folder = addBookmarkFolder(
          store,
          {
            parentId,
            title: item.title || "Untitled folder",
            dateAdded: item.dateAdded,
          },
          makeId,
          now,
        );
        visit(folder.id, item.children, depth + 1);
        if ((store.children.get(folder.id) ?? []).length === 0)
          removeBookmarkNode(store, folder.id);
        else result.folders++;
        continue;
      }
      const url = normalizeBookmarkUrl(item.url);
      if (!url) {
        result.skipped++;
        continue;
      }
      if (existing.has(url)) {
        result.duplicates++;
        continue;
      }
      if (store.nodes.size >= MAX_BOOKMARK_NODES) {
        result.skipped++;
        continue;
      }
      existing.add(url);
      addBookmark(
        store,
        { parentId, title: item.title, url, dateAdded: item.dateAdded },
        makeId,
        now,
      );
      result.added++;
    }
  };
  visit(top.id, items, 1);
  if ((store.children.get(top.id) ?? []).length === 0)
    removeBookmarkNode(store, top.id);
  else result.folderId = top.id;
  return result;
}

function countImported(nodes: readonly ImportedBookmarkNode[]): number {
  let count = 0;
  for (const node of nodes)
    count += node.children ? countImported(node.children) : 1;
  return count;
}

/** The store as a plain nested tree (folders with children), e.g. for export. */
export function toImportedTree(
  store: BookmarkStore,
  fromId = BOOKMARKS_ROOT_ID,
): ImportedBookmarkNode[] {
  return getBookmarkChildren(store, fromId).map((node) =>
    node.type === "folder"
      ? {
          title: node.title,
          dateAdded: node.dateAdded,
          children: toImportedTree(store, node.id),
        }
      : { title: node.title, url: node.url!, dateAdded: node.dateAdded },
  );
}

// ---------------------------------------------------------------------------
// Snapshot helpers shared by the renderer (it receives a flat, pre-ordered node list).

export interface BookmarkIndex {
  byId: Map<string, BookmarkNode>;
  children: Map<string, BookmarkNode[]>;
  urls: Map<string, BookmarkNode[]>;
}

export function indexBookmarks(nodes: readonly BookmarkNode[]): BookmarkIndex {
  const byId = new Map<string, BookmarkNode>();
  const children = new Map<string, BookmarkNode[]>();
  const urls = new Map<string, BookmarkNode[]>();
  for (const node of nodes) {
    byId.set(node.id, node);
    const parent = node.parentId ?? BOOKMARKS_ROOT_ID;
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
    if (node.type === "bookmark" && node.url)
      urls.set(node.url, [...(urls.get(node.url) ?? []), node]);
  }
  for (const list of children.values()) list.sort((a, b) => a.index - b.index);
  return { byId, children, urls };
}

/** Folder path for display ("Imported from Chrome › Bookmarks bar"). */
export function bookmarkFolderPath(
  index: BookmarkIndex,
  id: string | null,
): string[] {
  const path: string[] = [];
  let current = id;
  let guard = 0;
  while (current && current !== BOOKMARKS_ROOT_ID && guard++ < 128) {
    const node = index.byId.get(current);
    if (!node) break;
    path.unshift(node.title);
    current = node.parentId;
  }
  return path;
}

/** Case-insensitive match on title and URL, bookmarks only, in tree order. */
export function searchBookmarkNodes(
  nodes: readonly BookmarkNode[],
  query: string,
  limit = 500,
): BookmarkNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const terms = needle.split(/\s+/);
  const matches: BookmarkNode[] = [];
  for (const node of nodes) {
    if (node.type !== "bookmark") continue;
    const haystack = `${node.title} ${node.url ?? ""}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    matches.push(node);
    if (matches.length >= limit) break;
  }
  return matches;
}

/** Every folder in tree order with its depth, for folder pickers. */
export function listBookmarkFolders(
  index: BookmarkIndex,
): Array<{ id: string; title: string; depth: number }> {
  const result: Array<{ id: string; title: string; depth: number }> = [];
  const visit = (parentId: string, depth: number): void => {
    for (const node of index.children.get(parentId) ?? []) {
      if (node.type !== "folder") continue;
      result.push({ id: node.id, title: node.title, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(BOOKMARKS_ROOT_ID, 0);
  return result;
}
