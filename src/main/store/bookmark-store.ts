import { BOOKMARKS_ROOT_ID, type BookmarkStore } from "../../shared/bookmarks";
import { assignPositions } from "../../shared/fractional-index";
import type { BookmarkNode } from "../../shared/types";
import type { SurffishDatabase } from "./database";
import { RowMirror, type DesiredRow, type MirrorResult } from "./row-mirror";

/**
 * The bookmark tree in surffish.db (`bookmarks`): one row per folder/bookmark, keyed by the node's
 * existing id, top-level nodes with parent_id NULL. Order is a fractional-index `position`
 * (shared/fractional-index.ts), so a move or insert rewrites one row, not the folder.
 *
 * Deleted nodes are tombstoned with title/URL/favicon blanked: a peer learns the id is gone, but
 * the database keeps nothing about the page.
 */

export const BOOKMARK_COLUMNS = [
  "parent_id",
  "kind",
  "title",
  "url",
  "position",
  "favicon_url",
] as const;
const SAVED_KEY = "store:bookmarks:saved_at";

export interface SavedBookmarkTree {
  version: 1;
  nodes: BookmarkNode[];
}

export class BookmarkTable {
  private readonly mirror: RowMirror;
  /** Each folder's child order as last saved, so an unchanged folder skips position assignment. */
  private folderOrder = new Map<string, readonly string[]>();

  constructor(private readonly db: SurffishDatabase) {
    this.mirror = new RowMirror(db, {
      table: "bookmarks",
      columns: BOOKMARK_COLUMNS,
      blankOnDelete: { title: "", url: null, favicon_url: null },
    });
  }

  /** True once a tree has been saved here (an empty table could just mean "not imported yet"). */
  hasSavedTree(): boolean {
    return this.db.getMeta(SAVED_KEY) !== null;
  }

  /**
   * The saved tree in the bookmarks.json shape (so parseBookmarkStore validates it the same way),
   * or null when nothing was saved yet.
   */
  load(): SavedBookmarkTree | null {
    if (!this.hasSavedTree()) return null;
    const rows = this.mirror.loadLive();
    const byParent = new Map<string, typeof rows>();
    for (const row of rows) {
      const parent =
        row.values.parent_id === null
          ? BOOKMARKS_ROOT_ID
          : String(row.values.parent_id);
      const siblings = byParent.get(parent);
      if (siblings) siblings.push(row);
      else byParent.set(parent, [row]);
    }
    const nodes: BookmarkNode[] = [];
    for (const [parentId, siblings] of byParent) {
      siblings.sort((a, b) => {
        const left = String(a.values.position);
        const right = String(b.values.position);
        return left < right
          ? -1
          : left > right
            ? 1
            : a.key < b.key
              ? -1
              : a.key > b.key
                ? 1
                : 0;
      });
      siblings.forEach((row, index) => {
        const isFolder = row.values.kind === "folder";
        nodes.push({
          id: row.key,
          type: isFolder ? "folder" : "bookmark",
          title: String(row.values.title ?? ""),
          ...(!isFolder && typeof row.values.url === "string"
            ? { url: row.values.url }
            : {}),
          parentId,
          index,
          dateAdded: row.createdAt,
          ...(typeof row.values.favicon_url === "string"
            ? { faviconUrl: row.values.favicon_url }
            : {}),
        });
      });
    }
    return { version: 1, nodes };
  }

  /** Write `store` as the saved tree, touching only rows that changed. */
  save(store: BookmarkStore): MirrorResult {
    const desired = new Map<string, DesiredRow>();
    const order = new Map<string, readonly string[]>();
    const visit = (folderId: string, depth: number): void => {
      const children = store.children.get(folderId) ?? [];
      if (children.length === 0 || depth > 128) return;
      const previous = new Map<string, string>();
      for (const id of children) {
        const position = this.mirror.current(id)?.position;
        if (typeof position === "string") previous.set(id, position);
      }
      const last = this.folderOrder.get(folderId);
      const unchanged =
        last !== undefined &&
        last.length === children.length &&
        previous.size === children.length &&
        children.every((id, index) => last[index] === id);
      const positions = unchanged
        ? previous
        : assignPositions(children, previous);
      order.set(folderId, [...children]);
      for (const id of children) {
        const node = store.nodes.get(id);
        if (!node) continue;
        desired.set(id, {
          createdAt: node.dateAdded,
          values: {
            parent_id: folderId === BOOKMARKS_ROOT_ID ? null : folderId,
            kind: node.type === "folder" ? "folder" : "url",
            title: node.title,
            url: node.type === "bookmark" ? (node.url ?? null) : null,
            position: positions.get(id)!,
            favicon_url: node.faviconUrl ?? null,
          },
        });
        if (node.type === "folder") visit(id, depth + 1);
      }
    };
    visit(BOOKMARKS_ROOT_ID, 0);
    try {
      return this.db.transaction(() => {
        const result = this.mirror.sync(desired);
        this.folderOrder = order;
        if (!this.hasSavedTree())
          this.db.setMeta(SAVED_KEY, String(Date.now()));
        return result;
      });
    } catch (error) {
      this.mirror.reset();
      this.folderOrder.clear();
      throw error;
    }
  }
}
