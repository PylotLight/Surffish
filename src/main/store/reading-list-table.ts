import {
  READING_LIST_MAX_ITEMS,
  READING_LIST_TOMBSTONE_TTL_MS,
  readingListKey,
  type ReadingListItem,
  type SanitizedReadingListInput,
} from "../../shared/reading-list";
import type { SurffishDatabase } from "./database";

/**
 * The Reading List in surffish.db (`reading_list`, schema v2): one row per saved page, written one
 * row at a time (each save / read / remove is a single-row write and a single change-log op).
 * Removing an item tombstones it with the page details blanked, so a sync peer learns the id is gone
 * without the database keeping anything about the page. Tombstones older than 30 days are purged.
 *
 * Every method is synchronous and cheap; callers keep no cache of their own beyond what `list()`
 * returns. Nothing here imports Electron.
 */

export interface ReadingListBackend {
  list(): ReadingListItem[];
  add(input: SanitizedReadingListInput): {
    item: ReadingListItem;
    created: boolean;
  };
  setRead(id: string, read: boolean): ReadingListItem | null;
  remove(id: string): boolean;
  clearRead(): number;
  setSnapshot(id: string, snapshot: string): boolean;
  getSnapshot(id: string): string | null;
}

export class ReadingListFullError extends Error {
  constructor() {
    super(
      `Your Reading List is full (${READING_LIST_MAX_ITEMS} items). Remove some read items first.`,
    );
    this.name = "ReadingListFullError";
  }
}

interface ItemRow {
  id: string;
  url: string;
  title: string;
  favicon_url: string | null;
  site_name: string | null;
  excerpt: string | null;
  added_at: number | bigint;
  read_at: number | bigint | null;
  has_snapshot: number | bigint;
}

const ITEM_COLUMNS =
  "id, url, title, favicon_url, site_name, excerpt, added_at, read_at, snapshot IS NOT NULL AS has_snapshot";

function toItem(row: ItemRow): ReadingListItem {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    faviconUrl: row.favicon_url,
    siteName: row.site_name,
    excerpt: row.excerpt,
    addedAt: Number(row.added_at),
    readAt: row.read_at === null ? null : Number(row.read_at),
    hasSnapshot: Number(row.has_snapshot) === 1,
  };
}

export class ReadingListTable implements ReadingListBackend {
  private pruned = false;

  constructor(private readonly db: SurffishDatabase) {}

  /** Every live item, newest first (not de-duplicated: see dedupeReadingList). */
  list(): ReadingListItem[] {
    this.prune();
    return this.db
      .all<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM reading_list WHERE deleted_at IS NULL ORDER BY added_at DESC, id DESC`,
      )
      .map(toItem);
  }

  get(id: string): ReadingListItem | null {
    const row = this.db.get<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM reading_list WHERE id = ? AND deleted_at IS NULL`,
      id,
    );
    return row ? toItem(row) : null;
  }

  /**
   * Save a page. The same page saved again (same address apart from the fragment, trailing slash,
   * www or scheme) moves to the top as unread and picks up the newer title and details; no second row.
   */
  add(input: SanitizedReadingListInput): {
    item: ReadingListItem;
    created: boolean;
  } {
    return this.db.transaction(() => {
      const key = readingListKey(input.url);
      const live = this.db.all<{ id: string; url: string }>(
        "SELECT id, url FROM reading_list WHERE deleted_at IS NULL",
      );
      const existing = live.find((row) => readingListKey(row.url) === key);
      const { now, hlc, deviceId } = this.db.stamp();
      // The list sorts by added_at: a save in the same millisecond as the current top item (or a
      // clock step back) must still land on top, so never stamp it at or below the newest one.
      const newest = this.db.get<{ at: number | null }>(
        "SELECT max(added_at) AS at FROM reading_list WHERE deleted_at IS NULL",
      )?.at;
      const addedAt = newest == null ? now : Math.max(now, Number(newest) + 1);
      if (existing) {
        this.db.run(
          `UPDATE reading_list SET url = ?, title = CASE WHEN ? <> '' THEN ? ELSE title END,
             favicon_url = coalesce(?, favicon_url), site_name = coalesce(?, site_name), excerpt = coalesce(?, excerpt),
             added_at = ?, read_at = NULL, updated_at = ?, hlc = ?, device_id = ?
           WHERE id = ?`,
          input.url,
          input.title,
          input.title,
          input.faviconUrl,
          input.siteName,
          input.excerpt,
          addedAt,
          now,
          hlc,
          deviceId,
          existing.id,
        );
        return { item: this.get(existing.id)!, created: false };
      }
      if (live.length >= READING_LIST_MAX_ITEMS)
        throw new ReadingListFullError();
      const id = this.db.newId();
      this.db.run(
        `INSERT INTO reading_list (id, url, title, favicon_url, site_name, excerpt, added_at, read_at, device_id, created_at, updated_at, hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        id,
        input.url,
        input.title,
        input.faviconUrl,
        input.siteName,
        input.excerpt,
        addedAt,
        deviceId,
        now,
        now,
        hlc,
      );
      return { item: this.get(id)!, created: true };
    });
  }

  /** Mark read (opening an item does this) or back to unread. No write when it is already so. */
  setRead(id: string, read: boolean): ReadingListItem | null {
    const current = this.get(id);
    if (!current) return null;
    if ((current.readAt !== null) === read) return current;
    const { now, hlc, deviceId } = this.db.stamp();
    this.db.run(
      "UPDATE reading_list SET read_at = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ?",
      read ? now : null,
      now,
      hlc,
      deviceId,
      id,
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    const { now, hlc, deviceId } = this.db.stamp();
    const result = this.db.run(
      `UPDATE reading_list SET url = '', title = '', favicon_url = NULL, site_name = NULL, excerpt = NULL, snapshot = NULL, snapshot_at = NULL,
         deleted_at = ?, updated_at = ?, hlc = ?, device_id = ? WHERE id = ? AND deleted_at IS NULL`,
      now,
      now,
      hlc,
      deviceId,
      id,
    );
    return Number(result.changes) > 0;
  }

  /** Remove every read item; returns how many. */
  clearRead(): number {
    return this.db.transaction(() => {
      const ids = this.db
        .all<{ id: string }>(
          "SELECT id FROM reading_list WHERE deleted_at IS NULL AND read_at IS NOT NULL",
        )
        .map((row) => row.id);
      for (const id of ids) this.remove(id);
      return ids.length;
    });
  }

  /**
   * Keep a Reader copy (JSON) on this device. Snapshot columns are not in the change log payload, and
   * this deliberately leaves hlc/updated_at alone so a snapshot never looks like a user edit to sync.
   */
  setSnapshot(id: string, snapshot: string): boolean {
    const result = this.db.run(
      "UPDATE reading_list SET snapshot = ?, snapshot_at = ? WHERE id = ? AND deleted_at IS NULL",
      snapshot,
      Date.now(),
      id,
    );
    return Number(result.changes) > 0;
  }

  getSnapshot(id: string): string | null {
    return (
      this.db.get<{ snapshot: string | null }>(
        "SELECT snapshot FROM reading_list WHERE id = ? AND deleted_at IS NULL",
        id,
      )?.snapshot ?? null
    );
  }

  private prune(): void {
    if (this.pruned) return;
    this.pruned = true;
    try {
      this.db.run(
        "DELETE FROM reading_list WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        Date.now() - READING_LIST_TOMBSTONE_TTL_MS,
      );
    } catch (error) {
      console.warn("Could not prune Reading List tombstones:", error);
    }
  }
}
