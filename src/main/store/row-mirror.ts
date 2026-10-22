import type { SqlValue, SurffishDatabase } from "./database";
import { SYNCED_TABLES } from "./schema";

/**
 * Keeps one synced table (bookmarks, spaces, settings) equal to an in-memory model with the fewest
 * row writes. The store hands over the rows it wants (key → column values); the mirror compares
 * them with what it last wrote and only upserts rows that changed, so an edit costs one row and one
 * change-log op instead of a whole-file rewrite. Rows that disappear are tombstoned (deleted_at,
 * with `blankOnDelete` columns wiped so a deleted bookmark keeps no URL or title), or hard-deleted
 * with a content-free `delete` op when `hardDelete(key)` says so (privacy deletes in settings).
 *
 * `owns(key)` scopes a mirror to part of a table (preferences and the Spaces switch share
 * `settings`), so one mirror never tombstones another's rows. Tombstones older than 30 days are
 * purged when the mirror first reads the table.
 */

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MirrorTable = "bookmarks" | "spaces" | "settings";
export type RowValues = Record<string, SqlValue>;

export interface DesiredRow {
  values: RowValues;
  /** created_at for a new row (e.g. a bookmark's dateAdded); now when absent. */
  createdAt?: number;
}

export interface LiveRow {
  key: string;
  values: RowValues;
  createdAt: number;
  hlc: string;
}

export interface RowMirrorOptions {
  table: MirrorTable;
  /** Data columns this mirror writes (not the key or the bookkeeping columns). */
  columns: readonly string[];
  owns?: (key: string) => boolean;
  blankOnDelete?: Readonly<Record<string, SqlValue>>;
  hardDelete?: (key: string) => boolean;
  /** loadLive() returns rows in write (hlc) order; otherwise in no particular order (faster). */
  ordered?: boolean;
}

export interface MirrorResult {
  upserted: number;
  tombstoned: number;
  deleted: number;
}

export class RowMirror {
  private readonly keyColumn: string;
  private readonly entity: string;
  /** key → column values last written (or read). */
  private values = new Map<string, RowValues>();
  private primed = false;
  private pruned = false;

  constructor(
    private readonly db: SurffishDatabase,
    private readonly options: RowMirrorOptions,
  ) {
    this.keyColumn = options.table === "settings" ? "key" : "id";
    this.entity = SYNCED_TABLES[options.table]!.entity;
  }

  private owns(key: string): boolean {
    return this.options.owns ? this.options.owns(key) : true;
  }

  private same(previous: RowValues | undefined, next: RowValues): boolean {
    if (!previous) return false;
    for (const column of this.options.columns) {
      if ((previous[column] ?? null) !== (next[column] ?? null)) return false;
    }
    return true;
  }

  /** Live rows this mirror owns (oldest write first when `ordered`). Also primes the diff cache. */
  loadLive(): LiveRow[] {
    const rows = this.readLive();
    this.values = new Map(rows.map((row) => [row.key, row.values]));
    this.primed = true;
    return rows;
  }

  /** Values last written for `key` (e.g. a bookmark's previous position), if live. */
  current(key: string): RowValues | undefined {
    this.prime();
    return this.values.get(key);
  }

  /** Make the owned live rows exactly `desired`. One transaction; the cache only moves on commit. */
  sync(desired: ReadonlyMap<string, DesiredRow>): MirrorResult {
    this.purgeOldTombstones();
    this.prime();
    const { table, columns } = this.options;
    const key = this.keyColumn;
    const nextValues = new Map<string, RowValues>();
    const result: MirrorResult = { upserted: 0, tombstoned: 0, deleted: 0 };
    const hardDeleted: string[] = [];
    const upsertSql = `INSERT INTO ${table} (${key}, ${columns.join(", ")}, device_id, created_at, updated_at, hlc, deleted_at)
      VALUES (?, ${columns.map(() => "?").join(", ")}, ?, ?, ?, ?, NULL)
      ON CONFLICT (${key}) DO UPDATE SET ${columns.map((column) => `${column} = excluded.${column}`).join(", ")},
        device_id = excluded.device_id, updated_at = excluded.updated_at, hlc = excluded.hlc, deleted_at = NULL`;
    const blanks = Object.entries(this.options.blankOnDelete ?? {});
    const tombstoneSql = `UPDATE ${table} SET deleted_at = ?, updated_at = ?, hlc = ?, device_id = ?${blanks.map(([column]) => `, ${column} = ?`).join("")} WHERE ${key} = ? AND deleted_at IS NULL`;
    this.db.transaction(() => {
      for (const [rowKey, row] of desired) {
        if (!this.owns(rowKey))
          throw new Error(`${table} row ${rowKey} is outside this mirror`);
        nextValues.set(rowKey, row.values);
        if (this.same(this.values.get(rowKey), row.values)) continue;
        const { now, hlc, deviceId } = this.db.stamp();
        this.db.run(
          upsertSql,
          rowKey,
          ...columns.map((column) => row.values[column] ?? null),
          deviceId,
          row.createdAt ?? now,
          now,
          hlc,
        );
        result.upserted += 1;
      }
      for (const rowKey of this.values.keys()) {
        if (nextValues.has(rowKey)) continue;
        if (this.options.hardDelete?.(rowKey)) {
          this.db.run(`DELETE FROM ${table} WHERE ${key} = ?`, rowKey);
          hardDeleted.push(rowKey);
          result.deleted += 1;
          continue;
        }
        const { now, hlc, deviceId } = this.db.stamp();
        this.db.run(
          tombstoneSql,
          now,
          now,
          hlc,
          deviceId,
          ...blanks.map(([, value]) => value),
          rowKey,
        );
        result.tombstoned += 1;
      }
      // Replaces each row's earlier ops (whose payload held the row) with a content-free delete.
      this.db.recordDeletes(this.entity, hardDeleted);
    });
    this.values = nextValues;
    return result;
  }

  /** Forget the diff cache (e.g. after another writer changed the table); the next sync re-reads it. */
  reset(): void {
    this.primed = false;
    this.values.clear();
  }

  private prime(): void {
    if (this.primed) return;
    this.loadLive();
  }

  /** Drop tombstones older than 30 days (and their ops). Once per run, at the first write, not at startup. */
  private purgeOldTombstones(): void {
    if (this.pruned) return;
    this.pruned = true;
    const { table } = this.options;
    const key = this.keyColumn;
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const stale = this.db
      .all<{ key: string }>(
        `SELECT ${key} AS key FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
        cutoff,
      )
      .filter((row) => this.owns(row.key));
    if (stale.length === 0) return;
    this.db.transaction(() => {
      for (const row of stale) {
        this.db.run(
          "DELETE FROM oplog WHERE entity = ? AND entity_id = ?",
          this.entity,
          row.key,
        );
        this.db.run(`DELETE FROM ${table} WHERE ${key} = ?`, row.key);
      }
    });
  }

  private readLive(): LiveRow[] {
    const { table, columns } = this.options;
    const key = this.keyColumn;
    // Arrays instead of row objects: noticeably cheaper for a few thousand bookmarks at startup.
    const statement = this.db.db.prepare(
      `SELECT ${key}, created_at, hlc, ${columns.join(", ")} FROM ${table} WHERE deleted_at IS NULL${this.options.ordered ? ` ORDER BY hlc, ${key}` : ""}`,
    );
    statement.setReturnArrays(true);
    const rows: LiveRow[] = [];
    for (const raw of statement.all() as unknown as SqlValue[][]) {
      const rowKey = String(raw[0]);
      if (!this.owns(rowKey)) continue;
      const values: RowValues = {};
      for (let index = 0; index < columns.length; index += 1) {
        const value = raw[index + 3] ?? null;
        values[columns[index]!] =
          typeof value === "bigint" ? Number(value) : value;
      }
      rows.push({
        key: rowKey,
        values,
        createdAt: Number(raw[1]),
        hlc: String(raw[2]),
      });
    }
    return rows;
  }
}
