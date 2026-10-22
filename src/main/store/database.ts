import type { DatabaseSync, StatementSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import {
  HybridLogicalClock,
  compareHlc,
  uuidv7,
} from "../../shared/sync-clock";
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from "./schema";

/**
 * The profile database: one SQLite file, opened with the SQLite that ships inside the runtime.
 *
 * Runtime: `node:sqlite` (DatabaseSync). Electron 44's main process is Node 24, where it is built
 * in and needs no flag, so there is no native module to rebuild and no wasm copy of the database
 * in memory. Bun implements the same `node:sqlite` API, so this exact file runs under `bun test`
 * and in any Bun tool or sync service that opens a profile. (`bun:sqlite` itself only exists in
 * Bun, not in Electron's Node; see docs/storage.md for the options weighed.)
 *
 * Nothing here imports Electron: the Electron glue (path, fallback, quit hook) is store/index.ts.
 */

export type StoreErrorKind = "unavailable" | "too-new" | "corrupt" | "io";

export class StoreOpenError extends Error {
  constructor(
    readonly kind: StoreErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StoreOpenError";
  }
}

/**
 * A read or write after `close()` (the app is quitting). Callers that also keep a JSON copy treat
 * it as "the database has gone for this run" and skip the error log: see `isStoreClosedError`.
 */
export class StoreClosedError extends Error {
  constructor(readonly path: string) {
    super(`surffish.db is closed (${path})`);
    this.name = "StoreClosedError";
  }
}

export function isStoreClosedError(error: unknown): error is StoreClosedError {
  return error instanceof StoreClosedError;
}

export interface OpenStoreOptions {
  /** File path, or ':memory:' for tests. */
  path: string;
  platform?: string;
  appVersion?: string;
  now?: () => number;
  /** Extra migrations after the built-in ones (tests). */
  migrations?: readonly Migration[];
}

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | null | undefined;

/** node:sqlite, or null when this runtime does not have it (older Electron/Node). */
export function loadSqlite(): SqliteModule | null {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    sqliteModule =
      (process.getBuiltinModule?.("node:sqlite") as SqliteModule | undefined) ??
      null;
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

const CORRUPT_CODES =
  /SQLITE_(CORRUPT|NOTADB)|file is not a database|malformed/i;

export class SurffishDatabase {
  readonly deviceId: string;
  readonly clock: HybridLogicalClock;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  private closed = false;

  private constructor(
    readonly db: DatabaseSync,
    readonly path: string,
    private readonly now: () => number,
    options: OpenStoreOptions,
  ) {
    this.deviceId = this.ensureDeviceId(options);
    this.clock = new HybridLogicalClock(this.deviceId, now, this.lastStamp());
  }

  /**
   * Open (creating if needed) and migrate. Throws StoreOpenError; `corrupt` means the file is not a
   * usable database (the caller may move it aside and open a fresh one).
   */
  static open(options: OpenStoreOptions): SurffishDatabase {
    const sqlite = loadSqlite();
    if (!sqlite)
      throw new StoreOpenError(
        "unavailable",
        "node:sqlite is not available in this runtime",
      );
    const now = options.now ?? Date.now;
    const memory = options.path === ":memory:";
    if (!memory) {
      try {
        mkdirSync(dirname(options.path), { recursive: true });
      } catch (error) {
        throw new StoreOpenError(
          "io",
          `Cannot create ${dirname(options.path)}`,
          error,
        );
      }
    }
    let db: DatabaseSync;
    try {
      db = new sqlite.DatabaseSync(options.path);
    } catch (error) {
      throw new StoreOpenError(
        CORRUPT_CODES.test(String(error)) ? "corrupt" : "io",
        `Cannot open ${options.path}: ${String(error)}`,
        error,
      );
    }
    try {
      configure(db, memory);
      migrate(db, [...MIGRATIONS, ...(options.migrations ?? [])]);
      if (!memory) restrictPermissions(options.path);
      return new SurffishDatabase(db, options.path, now, options);
    } catch (error) {
      try {
        db.close();
      } catch {
        /* already broken */
      }
      if (error instanceof StoreOpenError) throw error;
      throw new StoreOpenError(
        CORRUPT_CODES.test(String(error)) ? "corrupt" : "io",
        `Cannot prepare ${options.path}: ${String(error)}`,
        error,
      );
    }
  }

  /** Move an unusable database (and its WAL/SHM) aside so a fresh one can be created. */
  static quarantine(path: string, now: number = Date.now()): string | null {
    if (path === ":memory:" || !existsSync(path)) return null;
    const target = `${path}.corrupt-${now}`;
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        if (existsSync(path + suffix))
          renameSync(path + suffix, target + suffix);
      } catch (error) {
        console.error(`Could not move ${path + suffix} aside:`, error);
        return null;
      }
    }
    return target;
  }

  /** A cached prepared statement. */
  statement(sql: string): StatementSync {
    this.assertOpen();
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  run(
    sql: string,
    ...params: SqlValue[]
  ): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.statement(sql).run(...params);
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.statement(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /** Run `fn` in one transaction (nested calls join the outer one). Rolls back if it throws. */
  transaction<T>(fn: () => T): T {
    this.assertOpen();
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* transaction already gone */
      }
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  getMeta(key: string): string | null {
    return (
      this.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
        ?.value ?? null
    );
  }

  setMeta(key: string, value: string): void {
    this.run(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  deleteMeta(key: string): void {
    this.run("DELETE FROM meta WHERE key = ?", key);
  }

  /** Bookkeeping values for a local write: `{ now, hlc, deviceId }`. */
  stamp(): { now: number; hlc: string; deviceId: string } {
    return { now: this.now(), hlc: this.clock.tick(), deviceId: this.deviceId };
  }

  newId(): string {
    return uuidv7(this.now());
  }

  /** Record hard deletes in the change log (rows already removed; payloads purged by triggers). */
  recordDeletes(entity: string, ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.transaction(() => {
      for (const id of ids) {
        const { now, hlc, deviceId } = this.stamp();
        this.run(
          "DELETE FROM oplog WHERE entity = ? AND entity_id = ?",
          entity,
          id,
        );
        this.run(
          "INSERT INTO oplog (entity, entity_id, op, hlc, device_id, payload, created_at) VALUES (?, ?, 'delete', ?, ?, NULL, ?)",
          entity,
          id,
          hlc,
          deviceId,
          now,
        );
      }
    });
  }

  /** Record "everything of this entity up to now is gone" (Clear history) as a single op. */
  recordClear(entity: string): void {
    this.transaction(() => {
      const { now, hlc, deviceId } = this.stamp();
      this.run("DELETE FROM oplog WHERE entity = ?", entity);
      this.run(
        "INSERT INTO oplog (entity, entity_id, op, hlc, device_id, payload, created_at) VALUES (?, '*', 'clear', ?, ?, NULL, ?)",
        entity,
        hlc,
        deviceId,
        now,
      );
    });
  }

  /** Change log after `seq`, oldest first (what a sync peer that acknowledged `seq` still needs). */
  changesSince(
    seq: number,
    limit = 500,
  ): Array<{
    seq: number;
    entity: string;
    entity_id: string;
    op: string;
    hlc: string;
    device_id: string;
    payload: string | null;
  }> {
    return this.all(
      "SELECT seq, entity, entity_id, op, hlc, device_id, payload FROM oplog WHERE seq > ? ORDER BY seq LIMIT ?",
      seq,
      limit,
    );
  }

  /** Fold WAL back into the main file (TRUNCATE also shrinks the -wal to zero, e.g. after Clear history). */
  checkpoint(mode: "PASSIVE" | "TRUNCATE" = "PASSIVE"): void {
    if (this.closed) return;
    try {
      this.db.exec(`PRAGMA wal_checkpoint(${mode})`);
    } catch (error) {
      console.warn("WAL checkpoint failed:", error);
    }
  }

  close(): void {
    if (this.closed) return;
    try {
      this.setMeta("hlc_last", this.clock.last());
      this.db.exec("PRAGMA optimize");
      this.checkpoint("PASSIVE");
    } catch {
      /* closing anyway */
    }
    this.closed = true;
    this.statements.clear();
    this.db.close();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  private assertOpen(): void {
    if (this.closed) throw new StoreClosedError(this.path);
  }

  private ensureDeviceId(options: OpenStoreOptions): string {
    const existing = this.getMeta("device_id");
    const now = this.now();
    if (existing) {
      this.run(
        "UPDATE devices SET last_seen_at = ?, app_version = coalesce(?, app_version) WHERE id = ?",
        now,
        options.appVersion ?? null,
        existing,
      );
      return existing;
    }
    const id = uuidv7(now);
    this.transaction(() => {
      this.setMeta("device_id", id);
      this.setMeta("created_at", String(now));
      this.run(
        "INSERT INTO devices (id, name, platform, app_version, created_at, last_seen_at) VALUES (?, NULL, ?, ?, ?, ?)",
        id,
        options.platform ?? process.platform,
        options.appVersion ?? null,
        now,
        now,
      );
    });
    return id;
  }

  /** The newest stamp this database has seen, so the clock never goes backwards across restarts. */
  private lastStamp(): string | null {
    const saved = this.getMeta("hlc_last");
    const logged =
      this.get<{ hlc: string }>(
        "SELECT hlc FROM oplog ORDER BY seq DESC LIMIT 1",
      )?.hlc ?? null;
    if (saved && logged) return compareHlc(saved, logged) >= 0 ? saved : logged;
    return saved ?? logged;
  }
}

function configure(db: DatabaseSync, memory: boolean): void {
  // WAL: readers never block the writer, commits append instead of rewriting pages.
  // synchronous=NORMAL is safe with WAL (a power cut may lose the last commit, never corrupts).
  if (!memory) db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 2000;
    PRAGMA temp_store = MEMORY;
    PRAGMA secure_delete = ON;
    PRAGMA journal_size_limit = 4194304;
  `);
}

function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  const current = Number(
    (
      db.prepare("PRAGMA user_version").get() as {
        user_version: number | bigint;
      }
    ).user_version,
  );
  const latest = Math.max(
    SCHEMA_VERSION,
    ...migrations.map((migration) => migration.version),
  );
  if (current > latest) {
    throw new StoreOpenError(
      "too-new",
      `surffish.db schema v${current} is newer than this build understands (v${latest})`,
    );
  }
  for (const migration of [...migrations].sort(
    (a, b) => a.version - b.version,
  )) {
    if (migration.version <= current) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* nothing to roll back */
      }
      throw new StoreOpenError(
        "io",
        `Migration ${migration.version} (${migration.name}) failed: ${String(error)}`,
        error,
      );
    }
  }
}

function restrictPermissions(path: string): void {
  if (process.platform === "win32") return;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
    } catch {
      /* best effort */
    }
  }
}
