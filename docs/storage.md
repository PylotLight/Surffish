# Profile storage (surffish.db)

Surffish keeps its profile data in one SQLite database in the profile folder,
`surffish.db` (with `-wal`/`-shm` next to it). It's the groundwork for sync: every row has a
stable id, a clock stamp and a tombstone, and every write lands in a change log.

In the database today: **history**, the **open-windows session** (windows, tabs, pins, groups,
splits, each tab's Space), **bookmarks**, **browser preferences**, **Spaces** and the **Reading
List**. Each keeps its old JSON file (browser-session.json, bookmarks.json, …) as a fallback copy.
Everything else (small settings files such as spellcheck, HTTPS-only, proxy routing, search
keywords, feeds) is still JSON.

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

## Schema (v3)

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
| `reading_list` (v2) | Reading List: pages saved for later | `added_at`, `read_at` (NULL = unread); `snapshot`/`snapshot_at` hold an offline Reader copy that is **device-local** (not in the oplog payload, and saving it doesn't bump `hlc`); remove = tombstone with url/title/excerpt/snapshot blanked; no unique index on `url` (two devices can save the same page before syncing; the app de-duplicates on read). Lazily loaded (`src/main/reading-list.ts`); `SURFFISH_STORE=json` forces `reading-list.json` |
| `session_tab_history` (v3) | each open tab's back/forward list | keyed by the `session_tabs` row id; `entries` JSON (url, title, Chromium page state) + `active_index`. **Device-local**: no sync columns, no oplog triggers; hard-deleted when the tab closes or the session is cleared; orphans purged at first use |

## Change log and sync

Insert/update triggers on every synced table append `(entity, entity_id, 'upsert', hlc,
device_id, row JSON)` to `oplog` and delete that row's previous op, so the log stays roughly the
size of the data. Hard deletes go through `recordDeletes()` / `recordClear()` (a clear is one op,
not one per visit), and a trigger purges a deleted visit's earlier ops so its URL is gone from
the log too.

A peer asks for `changesSince(last_sent_seq)`, applies ops last-writer-wins by `hlc`
(`HybridLogicalClock.receive()` keeps local stamps ahead of anything seen), and acknowledges the
new `seq`. Transport (Inkfish-style LAN sealed HTTP with QR pairing) and the apply side come later.

## Bookmarks, settings and Spaces: the shared pattern

`store/row-mirror.ts` keeps a synced table equal to the in-memory model with the fewest row writes:
the store hands it the rows it wants, it upserts only the rows whose columns changed and
tombstones the rest (hard-deletes with a content-free `delete` op where the store asks, for privacy
deletes). Tombstones older than 30 days are purged at the first write of a run (not at startup).

- **Startup** reads the database when it has a saved copy and the JSON file is gone or unchanged
  since Surffish last wrote/imported it (size+mtime stamp in `meta`, `legacy:<file>`). Otherwise
  the JSON file wins (a `SURFFISH_STORE=json` run or an older build edited it) and is imported
  into the database ~1.5 s after startup, unless a real edit saves first.
- **Edits** write the database diff after the usual debounce. The JSON file is kept as the
  fallback/downgrade copy but rewritten at most every 30 s and at quit. If Surffish dies in
  between, the file is just older than the database; its stamp still matches, so the next start
  reads the database, which has every edit.
- **Stamps** (`settleDualWrite`): both copies written → stamp the file; database write failed →
  drop the stamp (and write the JSON now) so the next start reads the JSON; only the JSON write
  failed → keep the old stamp, so the newer database still wins.
- Order (bookmark siblings, Spaces) is a fractional-index `position` (`shared/fractional-index.ts`):
  moving or inserting one item rewrites one row; long runs of appends are respaced once if keys get
  long.

### Bookmarks

One row per folder/bookmark, keyed by the node's existing id (`favourites` is the fixed
Favourites folder on every device), top level `parent_id` NULL, `created_at` = date added. A
deleted bookmark is a tombstone with title, URL and favicon blanked, so neither the table nor the
change log keeps the page. Measured (Electron 44 as Node, Linux arm64, medians): an edit with 2,000
bookmarks was a 569 KB `bookmarks.json` rewrite (~1.2 ms); it is now a ~0.9 ms diff writing ~33 KB
of WAL, and the JSON copy follows at most every 30 s. Loading 2,000 bookmarks from the database is
~7.6 ms vs ~5.1 ms from JSON (~0.8 vs ~0.6 ms for 200). Importing 2,000 from JSON once: ~54 ms,
1.5 s after startup.

### Browser preferences

`browser-preferences.json` becomes one `settings` row per preference (`store/preferences-store.ts`,
glue in `preferences-persistence.ts`):

| Key | Value | Scope |
|---|---|---|
| `pref.searchEngine`, `pref.tabSleepMinutes`, `pref.newTabPage`, `pref.newTabPreferences` | JSON value | synced |
| `pref.sidebarWidth`, `pref.pinnedSites` (legacy copy for older builds) | JSON value | device |
| `site:<sha256(origin)[0:32]>` | `{ origin, ...site settings }` | synced |
| `zoom:<sha256(origin)[0:32]>` | `{ origin, factor }` | device (like Chrome/Safari) |
| `volume:<sha256(origin)[0:32]>` | `{ origin, volume }` (tab volume 0..1; 100% not kept) | device |

A change writes the changed row right away (the JSON write used to be immediate too); the JSON copy
follows on the 30 s timer and at quit. Per-site keys are hashes, so Forget this site / Clear
browsing data hard-delete the rows and leave only a `delete` op carrying the hash; those privacy
deletes also rewrite the JSON copy immediately and truncate the WAL. Rows are read back in write
order, so site zoom keeps "most recently changed last" for its cap. Measured: a change with 100
per-site entries ~0.17 ms (was a ~24 KB rewrite, ~0.10 ms); load ~0.5 ms vs ~0.17 ms from JSON.

### Spaces

One `spaces` row per Space, keyed by its id (`default` is the same row everywhere), ordered by a
fractional-index `position`; `separate_storage` is the "separate logins" switch and `proxy` the
Space's route as JSON. The "Enable Spaces" switch is the `spaces.enabled` settings row (synced).
Both copies are written on every change (browser-spaces.json is tiny and changes are rare); the
database write only touches the Spaces that changed. A deleted Space is a tombstone with its name,
icon and proxy blanked.

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
- **Back/forward history** (shared/tab-history.ts) rides along: each window's `histories` in
  browser-session.json (same order as `tabs`, null for none; older builds ignore it) and one
  `session_tab_history` row per tab, rewritten only when that tab's list changed. Live tabs are read
  from `navigationHistory` when the coalesced write runs (and at before-quit, while pages still
  exist); sleeping tabs use the list they went to sleep with. Restored tabs wake through
  `navigationHistory.restore()`, so Back/Forward, the hold-Back menu and scroll/form state come back.
  Caps: 50 entries around the current one (at most 10 forward), http(s) only with the same secret
  scrubbing as tab URLs, page states over 64 KB dropped (entry kept), 2 MB for all tabs together
  (page states go first, then whole lists). Private tabs, Glance and the Settings tab are never saved.
  A typical tab costs ~1 KB per entry (mostly page state).
  Clearing history (Clear browsing data → History, History → Clear, Forget This Site with history)
  takes those pages out of open tabs' lists too, as Chrome does: live tabs via `navigationHistory`
  (`clear()` for all time, `removeEntryAtIndex` otherwise), sleeping/restored tabs in the list they
  wake with, and both stores are rewritten at once. The current page always stays. Entries carry no
  visit time, so a time range drops the URLs visited in that range.
