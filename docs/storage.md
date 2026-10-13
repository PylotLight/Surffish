# Profile storage (surffish.db)

Surffish is moving its JSON stores into one SQLite database in the profile folder,
`surffish.db` (with `-wal`/`-shm` next to it). It's the groundwork for sync: every row has a
stable id, a clock stamp and a tombstone, and every write lands in a change log.

Status: **history** lives in the database (PR 1); the **open-windows session** (windows, tabs,
pins, groups, splits, each tab's Space) is saved to it too (PR 2), with browser-session.json still
written alongside as the fallback. Spaces definitions, bookmarks and settings have tables already
and move over next. Everything else is still JSON.

## Which SQLite

Electron's main process runs **Node**, not Bun, so `bun:sqlite` can't be imported at runtime.
Options weighed:

| Option | Verdict |
|---|---|
| **`node:sqlite` (`DatabaseSync`)** | **Chosen.** Built into Electron 44's Node 24.21 (SQLite 3.53), no flag, no warning. Synchronous API almost identical to `bun:sqlite`. Nothing to rebuild per Electron version or arch, nothing extra in the app bundle. **Bun implements `node:sqlite` too**, so the same store code runs under `bun test` and in any Bun tool or future Bun sync service that opens a profile. |
| `better-sqlite3` | Fast and mature, but a native module: rebuilt for every Electron ABI and arch, and a prebuild download/compile in `bun install` (the Mac CI runner's Defender already flags extra install steps). Its perf edge over `node:sqlite` doesn't matter at our write rates. |
| `sql.js` (wasm, already a dependency) | Whole database in memory; saving means exporting and rewriting the entire file, i.e. the same whole-file rewrite JSON has. No WAL. Fine for one-off reads of other browsers' files (bookmark/history import), wrong for a live store. |
| Bun sidecar process with `bun:sqlite` | The literal "Bun SQLite", but every read becomes async IPC, it ships a second ~60 MB runtime, adds a process to supervise, and spawning bun on the user's corporate Mac is exactly what Defender flagged. |
| `bun:sqlite` only in build/tests | Would mean two drivers for one schema. Unnecessary, since Bun runs `node:sqlite`. |

`database.ts` loads it with `process.getBuiltinModule('node:sqlite')`, so a runtime without it
just falls back to JSON instead of failing to start.

Measured (Electron 44 as Node, Linux arm64 VM): recording a visit was a 5,000-entry JSON rewrite
(~2.6 ms, ~790 KB, debounced 1.5 s); it's now one insert including the change-log trigger
(~0.03 ms). Loading the newest 5,000 visits at first use is ~6 ms vs ~2 ms for `JSON.parse`, a
one-off cost at first history access.

## Settings

- `journal_mode=WAL`, `synchronous=NORMAL` (a power cut can lose the last commit but never
  corrupts), `secure_delete=ON` (deleted rows are zeroed), `busy_timeout=2000`,
  `journal_size_limit=4 MB`, `temp_store=MEMORY`.
- File, WAL and SHM are chmod 600. `PRAGMA optimize` and a passive checkpoint run at quit;
  Clear history and Forget this site run `wal_checkpoint(TRUNCATE)` so the cleared pages don't
  sit in the WAL.
- Migrations: `PRAGMA user_version`, append-only list in `src/main/store/schema.ts`, each in its
  own transaction. A file from a newer build (`user_version` higher than we know) isn't touched;
  the run uses JSON.

## Safe fallback and migration from JSON

- `getProfileDatabase()` (`src/main/store/index.ts`) opens lazily. If it fails, stores keep
  using their JSON files exactly as before. `SURFFISH_STORE=json` forces that path.
- A corrupt file is moved to `surffish.db.corrupt-<time>` once and a fresh one created.
- Import is **non-destructive**: the JSON file stays where it is. The database records the file's
  size+mtime at import. If the file changes later (a fallback run wrote to it), the next open
  imports it again, merging by id, so nothing written during a fallback run is lost.
- Privacy deletes (Clear history, Forget this site, Clear browsing data) are applied to the
  legacy JSON copy too, so the old file never keeps what the database forgot.
- Downgrading to a build without the database shows history as of the upgrade (the JSON copy
  isn't written once the database is in use).

## Schema (v1)

Every synced table has `id` (UUID, v7 for new rows), `device_id`, `created_at`, `updated_at`,
`hlc` (hybrid logical clock stamp, `src/shared/sync-clock.ts`) and, except history,
`deleted_at` (tombstone).

| Table | What | Notes |
|---|---|---|
| `meta` | key/value | `device_id`, `hlc_last`, `legacy:<file>` import stamps |
| `devices` | this device (+ peers later) | platform, app version, last seen |
| `oplog` | change log | `seq` autoincrement; `op` upsert (row JSON) / delete / clear; triggers keep only the newest op per row |
| `sync_peers` | paired devices | `last_sent_seq`, `last_received_hlc` |
| `settings` | preferences as JSON | `scope` `synced` or `device` (geometry, sidebar width never leave the machine) |
| `history_visits` | one row per visit | hard-deleted; deletes become content-free `delete`/`clear` ops; capped at 50,000 visits |
| `bookmarks` | folder/URL tree | `position` is a fractional index so concurrent moves merge; no FK on `parent_id` (children can arrive before folders) |
| `spaces` | Spaces | `separate_storage`, `proxy` JSON |
| `session_windows` / `session_tabs` / `tab_groups` / `session_splits` | open windows and tabs | rows belong to their `device_id`; another device's rows are its "tabs on other devices" |

## Change log and sync

Insert/update triggers on every synced table append `(entity, entity_id, 'upsert', hlc,
device_id, row JSON)` to `oplog` and delete that row's previous op, so the log stays roughly the
size of the data. Hard deletes go through `recordDeletes()` / `recordClear()` (a clear is one op,
not one per visit), and a trigger purges a deleted visit's earlier ops so its URL is gone from
the log too.

A peer asks for `changesSince(last_sent_seq)`, applies ops last-writer-wins by `hlc`
(`HybridLogicalClock.receive()` keeps local stamps ahead of anything seen), and acknowledges the
new `seq`. Transport (Inkfish-style LAN sealed HTTP with QR pairing) and the apply side come later.

## Session (windows / tabs / groups / splits)

- Saved on the same 600 ms debounce as before. Each save diffs against what was last written and
  upserts only changed rows (a tab navigating = one row, one oplog op); closed tabs/windows are
  tombstoned with their URL/title blanked, and tombstones older than 30 days are purged.
- Row ids are stable: the browser passes runtime tab ids and the window id; after a restart the
  restored tabs adopt the row at the same window/position/URL, so a tab keeps its id across
  restarts (what sync needs for "tabs on other devices").
- Restore reads the database when it has this device's session **and** browser-session.json is
  unchanged since Surffish last wrote it (size+mtime in `meta`). If the JSON file changed (a
  fallback run, an older build) or the database write failed, the JSON file wins and is imported.
- browser-session.json keeps being written for now, so downgrading or `SURFFISH_STORE=json` still
  restores the exact session. It can stop once sync ships.
