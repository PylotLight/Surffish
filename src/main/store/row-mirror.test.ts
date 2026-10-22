import assert from "node:assert/strict";
import test from "node:test";
import { SurffishDatabase } from "./database.ts";
import { RowMirror, type DesiredRow } from "./row-mirror.ts";

const rows = (entries: Record<string, string>): Map<string, DesiredRow> =>
  new Map(
    Object.entries(entries).map(([key, value]) => [
      key,
      { values: { value, scope: "synced" } },
    ]),
  );

test("upserts only changed rows and tombstones removed ones", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const mirror = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
  });
  assert.deepEqual(mirror.sync(rows({ a: "1", b: "2" })), {
    upserted: 2,
    tombstoned: 0,
    deleted: 0,
  });
  assert.deepEqual(mirror.sync(rows({ a: "1", b: "2" })), {
    upserted: 0,
    tombstoned: 0,
    deleted: 0,
  });
  assert.deepEqual(mirror.sync(rows({ a: "1", b: "3" })), {
    upserted: 1,
    tombstoned: 0,
    deleted: 0,
  });
  assert.deepEqual(mirror.sync(rows({ a: "1" })), {
    upserted: 0,
    tombstoned: 1,
    deleted: 0,
  });
  assert.ok(
    db.get<{ deleted_at: number | null }>(
      "SELECT deleted_at FROM settings WHERE key = 'b'",
    )!.deleted_at !== null,
  );
  assert.deepEqual(
    mirror.sync(rows({ a: "1", b: "4" })),
    { upserted: 1, tombstoned: 0, deleted: 0 },
    "a tombstoned key can come back",
  );
  assert.equal(
    db.get<{ deleted_at: number | null }>(
      "SELECT deleted_at FROM settings WHERE key = 'b'",
    )!.deleted_at,
    null,
  );
});

test("a new mirror on the same table diffs against what is stored", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  new RowMirror(db, { table: "settings", columns: ["value", "scope"] }).sync(
    rows({ a: "1", b: "2" }),
  );
  const restarted = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
    ordered: true,
  });
  assert.deepEqual(
    restarted.loadLive().map((row) => [row.key, row.values.value]),
    [
      ["a", "1"],
      ["b", "2"],
    ],
    "oldest write first",
  );
  assert.deepEqual(restarted.sync(rows({ a: "1", b: "2" })), {
    upserted: 0,
    tombstoned: 0,
    deleted: 0,
  });
});

test("owns() keeps two mirrors on one table apart", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const prefs = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
    owns: (key) => key.startsWith("pref."),
  });
  const other = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
    owns: (key) => key.startsWith("spaces."),
  });
  prefs.sync(rows({ "pref.a": "1" }));
  other.sync(rows({ "spaces.enabled": "true" }));
  prefs.sync(rows({ "pref.a": "2" }));
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) AS n FROM settings WHERE deleted_at IS NULL",
    )!.n,
    2,
  );
  assert.throws(
    () => prefs.sync(rows({ "spaces.enabled": "false" })),
    /outside this mirror/,
  );
});

test("hard deletes leave no row and only a content-free delete op", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const mirror = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
    hardDelete: (key) => key.startsWith("site:"),
  });
  mirror.sync(
    rows({
      "site:x": JSON.stringify({ origin: "https://secret.test" }),
      keep: "1",
    }),
  );
  assert.deepEqual(mirror.sync(rows({ keep: "1" })), {
    upserted: 0,
    tombstoned: 0,
    deleted: 1,
  });
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) AS n FROM settings WHERE key = 'site:x'",
    )!.n,
    0,
  );
  const ops = db.all<{ op: string; payload: string | null }>(
    "SELECT op, payload FROM oplog WHERE entity_id = 'site:x'",
  );
  assert.deepEqual(
    ops.map((row) => [row.op, row.payload]),
    [["delete", null]],
  );
  assert.ok(
    !JSON.stringify(db.all("SELECT * FROM oplog")).includes("secret.test"),
  );
});

test("a failed sync leaves the cache unchanged so the next sync retries", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const mirror = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
  });
  mirror.sync(rows({ a: "1" }));
  assert.throws(
    () =>
      mirror.sync(
        new Map([["a", { values: { value: null, scope: "synced" } }]]),
      ),
    /NOT NULL/,
  );
  assert.deepEqual(mirror.sync(rows({ a: "2" })), {
    upserted: 1,
    tombstoned: 0,
    deleted: 0,
  });
});

test("tombstones older than 30 days are purged at the first write of a run", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  new RowMirror(db, { table: "settings", columns: ["value", "scope"] }).sync(
    rows({ old: "1", keep: "2" }),
  );
  new RowMirror(db, { table: "settings", columns: ["value", "scope"] }).sync(
    rows({ keep: "2" }),
  );
  db.run("UPDATE settings SET deleted_at = 1 WHERE key = 'old'");
  const next = new RowMirror(db, {
    table: "settings",
    columns: ["value", "scope"],
  });
  next.loadLive();
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) AS n FROM settings WHERE key = 'old'",
    )!.n,
    1,
    "startup reads do not purge",
  );
  next.sync(rows({ keep: "2" }));
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) AS n FROM settings WHERE key = 'old'",
    )!.n,
    0,
  );
  assert.equal(
    db.get<{ n: number }>(
      "SELECT count(*) AS n FROM oplog WHERE entity_id = 'old'",
    )!.n,
    0,
  );
});
