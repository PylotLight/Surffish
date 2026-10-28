import type { WebContents } from "electron";
import {
  countUnread,
  dedupeReadingList,
  READING_LIST_META_SCRIPT,
  READING_LIST_MAX_ITEMS,
  readingListKey,
  sanitizeReadingListInput,
  type ReadingListItem,
  type ReadingListSnapshot,
  type SanitizedReadingListInput,
} from "../shared/reading-list";
import { MAX_READER_CONTENT_CHARS, type ReaderArticle } from "../shared/reader";
import { sendToMainWindowRenderers } from "./browser-shell";
import {
  getBrowserTabPageInfo,
  getBrowserTabWebContents,
  navigateBrowser,
  newBrowserTab,
  flashBrowserStatus,
} from "./browser";
import {
  extractReaderArticle,
  openReaderMode,
  openReaderWithArticle,
  readerStateFor,
} from "./reader-mode";
import { readAloudEnabled, readAloudFromPage } from "./read-aloud-feature";
import { getProfileDatabase, reportStoreWriteError } from "./store";
import {
  ReadingListFullError,
  ReadingListTable,
  type ReadingListBackend,
} from "./store/reading-list-table";
import { readUserJson, writeUserJson } from "./user-json";
import { deferWrite } from "./deferred-writes";
import { randomUUID } from "node:crypto";

/**
 * Reading List (lazy chunk: loaded on the first Reading List IPC call, menu item or shortcut, never
 * at launch). Items live in surffish.db (`reading_list`); when the database can't be opened (or
 * SURFFISH_STORE=json) they fall back to reading-list.json so the feature still works.
 *
 * Saving the current tab also records the page's description / site name, and, when the page reads
 * as an article, keeps a Reader copy on this device so it can be read later offline.
 */

const JSON_FILE = "reading-list.json";
const OPEN_READER_TIMEOUT_MS = 30_000;
/** Isolated world for the metadata read (its own, so it never shares globals with Reader's). */
const READING_LIST_META_WORLD_ID = 1315;

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** reading-list.json: used only when surffish.db is unavailable. No offline copies there. */
class JsonReadingList implements ReadingListBackend {
  private items: ReadingListItem[];

  constructor() {
    const raw = readUserJson(JSON_FILE) as { items?: unknown } | null;
    this.items = Array.isArray(raw?.items)
      ? raw.items.flatMap((value): ReadingListItem[] => {
          const record = value as Record<string, unknown>;
          const clean = sanitizeReadingListInput(record);
          if (
            !clean ||
            typeof record.id !== "string" ||
            typeof record.addedAt !== "number"
          )
            return [];
          return [
            {
              ...clean,
              id: record.id,
              addedAt: record.addedAt,
              readAt: typeof record.readAt === "number" ? record.readAt : null,
              hasSnapshot: false,
            },
          ];
        })
      : [];
  }

  private save(): void {
    deferWrite(
      "reading-list-json",
      () => {
        writeUserJson(JSON_FILE, { version: 1, items: this.items });
      },
      400,
    );
  }

  list(): ReadingListItem[] {
    return [...this.items];
  }

  add(input: SanitizedReadingListInput): {
    item: ReadingListItem;
    created: boolean;
  } {
    const key = readingListKey(input.url);
    const index = this.items.findIndex(
      (item) => readingListKey(item.url) === key,
    );
    const now = Date.now();
    if (index >= 0) {
      const current = this.items[index]!;
      const item: ReadingListItem = {
        ...current,
        url: input.url,
        title: input.title || current.title,
        faviconUrl: input.faviconUrl ?? current.faviconUrl,
        siteName: input.siteName ?? current.siteName,
        excerpt: input.excerpt ?? current.excerpt,
        addedAt: now,
        readAt: null,
      };
      this.items.splice(index, 1);
      this.items.unshift(item);
      this.save();
      return { item, created: false };
    }
    if (this.items.length >= READING_LIST_MAX_ITEMS)
      throw new ReadingListFullError();
    const item: ReadingListItem = {
      ...input,
      id: randomUUID(),
      addedAt: now,
      readAt: null,
      hasSnapshot: false,
    };
    this.items.unshift(item);
    this.save();
    return { item, created: true };
  }

  setRead(id: string, read: boolean): ReadingListItem | null {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = this.items[index]!;
    if ((current.readAt !== null) === read) return current;
    const item = { ...current, readAt: read ? Date.now() : null };
    this.items[index] = item;
    this.save();
    return item;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  clearRead(): number {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.readAt === null);
    if (this.items.length !== before) this.save();
    return before - this.items.length;
  }

  setSnapshot(): boolean {
    return false;
  }

  getSnapshot(): string | null {
    return null;
  }
}

let backend: ReadingListBackend | null = null;
let cache: ReadingListSnapshot | null = null;

function store(): ReadingListBackend {
  if (backend) return backend;
  const db = getProfileDatabase();
  backend = db ? new ReadingListTable(db) : new JsonReadingList();
  return backend;
}

function failure(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function readingListSnapshot(): ReadingListSnapshot {
  if (cache) return cache;
  const items = dedupeReadingList(store().list());
  cache = { items, unread: countUnread(items) };
  return cache;
}

function publish(): ReadingListSnapshot {
  cache = null;
  const snapshot = readingListSnapshot();
  try {
    sendToMainWindowRenderers("browser:reading-list:changed", snapshot);
  } catch {
    /* window closing */
  }
  return snapshot;
}

function write<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ReadingListFullError))
      reportStoreWriteError("Could not update the Reading List:", error);
    throw error;
  }
}

/** Save a page (from IPC, a link's context menu, or the current tab). Bad input resolves { ok: false }. */
export function addToReadingList(input: unknown): Result<{
  item: ReadingListItem;
  created: boolean;
  snapshot: ReadingListSnapshot;
}> {
  const clean = sanitizeReadingListInput(input);
  if (!clean)
    return {
      ok: false,
      error: "Only web pages (http/https) can be saved to the Reading List.",
    };
  try {
    const { item, created } = write(() => store().add(clean));
    return { ok: true, item, created, snapshot: publish() };
  } catch (error) {
    return failure(error);
  }
}

/** A link from a page's context menu: saved without opening it (title = the link text, if any). */
export function addLinkToReadingList(url: string, title?: string): void {
  const result = addToReadingList({ url, title });
  flashBrowserStatus(
    result.ok
      ? result.created
        ? "Link added to Reading List"
        : "Already in Reading List: moved to the top"
      : result.error,
  );
}

async function pageMetadata(
  contents: WebContents | null,
): Promise<{ siteName?: string; excerpt?: string; title?: string }> {
  if (!contents || contents.isDestroyed()) return {};
  try {
    // Isolated world: the page can't see or patch it. Bounded so a hung page can't stall a save.
    const result = await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(READING_LIST_META_WORLD_ID, [
        { code: READING_LIST_META_SCRIPT },
      ]),
      new Promise((resolve) => setTimeout(() => resolve(null), 800)),
    ]);
    return typeof result === "object" && result !== null
      ? (result as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Save a tab's page (the active tab when `tabId` is omitted). Private tabs are refused: their pages
 * are meant to leave nothing behind, and the Reading List keeps (and will sync) what it saves.
 */
export async function addTabToReadingList(
  tabId?: string | null,
  options: { notify?: boolean } = {},
): Promise<
  Result<{
    item: ReadingListItem;
    created: boolean;
    snapshot: ReadingListSnapshot;
  }>
> {
  const page = getBrowserTabPageInfo(tabId ?? undefined);
  const notify = (message: string): void => {
    if (options.notify) flashBrowserStatus(message);
  };
  if (!page) return failure("No tab to save.");
  if (page.private) {
    notify("Private tabs can’t be added to the Reading List");
    return failure("Private tabs can’t be added to the Reading List.");
  }
  const contents = getBrowserTabWebContents(page.id);
  const meta = await pageMetadata(contents);
  const result = addToReadingList({
    url: page.url,
    title: page.title || meta.title,
    faviconUrl: page.faviconUrl,
    siteName: meta.siteName,
    excerpt: meta.excerpt,
  });
  if (!result.ok) {
    notify(result.error);
    return result;
  }
  notify(
    result.created
      ? "Added to Reading List"
      : "Already in Reading List: moved to the top",
  );
  if (contents && readerStateFor(contents) !== null)
    void saveOfflineCopy(result.item.id, contents);
  return result;
}

/** Keep a Reader copy of the article on this device (best effort, after the save itself). */
async function saveOfflineCopy(
  id: string,
  contents: WebContents,
): Promise<void> {
  try {
    const article = await extractReaderArticle(contents);
    if (!article || article.content.length > MAX_READER_CONTENT_CHARS) return;
    if (store().setSnapshot(id, JSON.stringify(article))) publish();
  } catch (error) {
    console.warn("Could not save a Reading List offline copy:", error);
  }
}

function parseSavedArticle(value: string | null): ReaderArticle | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    const strings = [
      "url",
      "title",
      "byline",
      "siteName",
      "excerpt",
      "lang",
      "publishedTime",
      "content",
    ] as const;
    if (strings.some((key) => typeof record[key] !== "string")) return null;
    if ((record.content as string).length > MAX_READER_CONTENT_CHARS)
      return null;
    return {
      url: record.url as string,
      title: record.title as string,
      byline: record.byline as string,
      siteName: record.siteName as string,
      excerpt: record.excerpt as string,
      lang: record.lang as string,
      dir: record.dir === "rtl" || record.dir === "ltr" ? record.dir : "auto",
      publishedTime: record.publishedTime as string,
      content: record.content as string,
      readingMinutes:
        typeof record.readingMinutes === "number" ? record.readingMinutes : 0,
      wordCount: typeof record.wordCount === "number" ? record.wordCount : 0,
    };
  } catch {
    return null;
  }
}

/** Every live row for the same page as `id` (a page saved on two devices before they synced has two). */
function sameItemIds(id: string): string[] {
  const rows = store().list();
  const item = rows.find((row) => row.id === id);
  if (!item) return [];
  const key = readingListKey(item.url);
  return rows
    .filter((row) => readingListKey(row.url) === key)
    .map((row) => row.id);
}

export function setReadingListItemRead(
  id: unknown,
  read: unknown,
): Result<{ snapshot: ReadingListSnapshot }> {
  if (typeof id !== "string" || typeof read !== "boolean")
    return failure("Bad request.");
  try {
    const ids = sameItemIds(id);
    if (ids.length === 0)
      return failure("That item is no longer in your Reading List.");
    write(() => {
      for (const each of ids) store().setRead(each, read);
    });
    return { ok: true, snapshot: publish() };
  } catch (error) {
    return failure(error);
  }
}

export function removeReadingListItem(
  id: unknown,
): Result<{ snapshot: ReadingListSnapshot }> {
  if (typeof id !== "string") return failure("Bad request.");
  try {
    write(() => {
      for (const each of sameItemIds(id)) store().remove(each);
    });
    return { ok: true, snapshot: publish() };
  } catch (error) {
    return failure(error);
  }
}

export function clearReadReadingListItems(): Result<{
  removed: number;
  snapshot: ReadingListSnapshot;
}> {
  try {
    const removed = write(() => store().clearRead());
    return { ok: true, removed, snapshot: publish() };
  } catch (error) {
    return failure(error);
  }
}

export type ReadingListOpenTarget = "current" | "new-tab";

/** How long after a load to wait for Reader detection (isProbablyReaderable) before using the saved copy. */
const READERABLE_WAIT_MS = 2_000;

/**
 * When `contents` next finishes loading (or gives up), show Reader view. With a saved copy, the live
 * page is only used when Reader detection says it is an article (an offline / error / paywall page
 * would otherwise "parse"); otherwise the saved copy is shown.
 */
function openInReaderWhenLoaded(
  contents: WebContents,
  saved: ReaderArticle | null,
  options: { preferSaved?: boolean; onShown?: () => void } = {},
): void {
  let done = false;
  const cleanup = (): void => {
    done = true;
    clearTimeout(timer);
    contents.removeListener("did-stop-loading", loaded);
  };
  const showSaved = (): void => {
    if (
      saved &&
      !contents.isDestroyed() &&
      openReaderWithArticle(contents, saved)
    )
      options.onShown?.();
  };
  const live = (): void => {
    void openReaderMode(contents, { quiet: saved !== null })
      .then((opened) => {
        if (!opened) showSaved();
        else options.onShown?.();
      })
      .catch(showSaved);
  };
  const loaded = (): void => {
    if (done) return;
    cleanup();
    if (contents.isDestroyed()) return;
    if (!saved) {
      live();
      return;
    }
    if (options.preferSaved) {
      showSaved();
      return;
    }
    const deadline = Date.now() + READERABLE_WAIT_MS;
    const poll = (): void => {
      if (contents.isDestroyed()) return;
      if (readerStateFor(contents) === "available") live();
      else if (Date.now() >= deadline) showSaved();
      else setTimeout(poll, 100);
    };
    poll();
  };
  const timer = setTimeout(loaded, OPEN_READER_TIMEOUT_MS);
  contents.on("did-stop-loading", loaded);
  contents.once("destroyed", cleanup);
}

/**
 * Open an item (marks it read). `reader`: show it in Reader view, from the saved copy if the live
 * page has no article. `listen`: Reader view from the saved offline copy when there is one (the live
 * page otherwise), then Read Aloud reads it.
 */
export async function openReadingListItem(
  id: unknown,
  options: unknown,
): Promise<Result<{ tabId: string | null }>> {
  if (typeof id !== "string") return failure("Bad request.");
  const item = readingListSnapshot().items.find(
    (candidate) => candidate.id === id,
  );
  if (!item) return failure("That item is no longer in your Reading List.");
  const record =
    typeof options === "object" && options !== null
      ? (options as Record<string, unknown>)
      : {};
  const target: ReadingListOpenTarget =
    record.target === "new-tab" ? "new-tab" : "current";
  const listen = record.listen === true && readAloudEnabled();
  const reader = record.reader === true || listen;
  let tabId: string | null;
  if (target === "new-tab") {
    tabId = newBrowserTab(item.url);
  } else {
    const result = await navigateBrowser(item.url);
    if (!result.ok) return failure("Could not open that page.");
    tabId = getBrowserTabPageInfo()?.id ?? null;
  }
  setReadingListItemRead(item.id, true);
  if (reader && tabId) {
    const contents = getBrowserTabWebContents(tabId);
    const saved = item.hasSnapshot
      ? parseSavedArticle(store().getSnapshot(item.id))
      : null;
    if (contents)
      openInReaderWhenLoaded(
        contents,
        saved,
        listen
          ? {
              preferSaved: true,
              onShown: () => {
                void readAloudFromPage(contents, "page");
              },
            }
          : {},
      );
  }
  return { ok: true, tabId };
}
