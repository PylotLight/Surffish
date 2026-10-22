import assert from "node:assert/strict";
import test from "node:test";
import { SurffishDatabase } from "./database.ts";
import { SpacesTable } from "./spaces-table.ts";
import {
  DEFAULT_SPACE,
  parseSpacesSettings,
  type SpacesSettings,
} from "../../shared/spaces.ts";

function sample(): SpacesSettings {
  return {
    enabled: true,
    spaces: [
      { ...DEFAULT_SPACE },
      {
        id: "swork01",
        name: "Work",
        icon: "💼",
        color: "green",
        partitioned: true,
        proxy: "direct" as SpacesSettings["spaces"][number]["proxy"],
      },
      {
        id: "sfun002",
        name: "Fun",
        icon: "",
        color: "pink",
        partitioned: false,
        proxy: "inherit",
      },
    ],
  };
}

test("round-trips Spaces and the enabled switch through parseSpacesSettings", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const table = new SpacesTable(db);
  assert.equal(table.load(), null);
  const settings = parseSpacesSettings(sample());
  table.save(settings);
  assert.deepEqual(parseSpacesSettings(new SpacesTable(db).load()), settings);
  assert.equal(
    db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'spaces.enabled'",
    )!.value,
    "true",
  );
});

test("rename, reorder and toggle each write one row", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const table = new SpacesTable(db);
  const settings = parseSpacesSettings(sample());
  table.save(settings);
  assert.deepEqual(table.save(settings), { upserted: 0, tombstoned: 0 });
  const renamed = {
    ...settings,
    spaces: settings.spaces.map((space) =>
      space.id === "sfun002" ? { ...space, name: "Weekend" } : space,
    ),
  };
  assert.deepEqual(table.save(renamed), { upserted: 1, tombstoned: 0 });
  const reordered = {
    ...renamed,
    spaces: [renamed.spaces[0]!, renamed.spaces[2]!, renamed.spaces[1]!],
  };
  assert.deepEqual(table.save(reordered), { upserted: 1, tombstoned: 0 });
  assert.deepEqual(table.save({ ...reordered, enabled: false }), {
    upserted: 1,
    tombstoned: 0,
  });
  const loaded = parseSpacesSettings(new SpacesTable(db).load());
  assert.deepEqual(
    loaded.spaces.map((space) => space.name),
    ["Default", "Weekend", "Work"],
  );
  assert.equal(loaded.enabled, false);
});

test("a deleted Space is a tombstone without its name, icon or proxy", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const table = new SpacesTable(db);
  const settings = parseSpacesSettings(sample());
  table.save(settings);
  assert.deepEqual(
    table.save({
      ...settings,
      spaces: settings.spaces.filter((space) => space.id !== "swork01"),
    }),
    { upserted: 0, tombstoned: 1 },
  );
  const row = db.get<{
    name: string;
    icon: string | null;
    proxy: string | null;
    deleted_at: number | null;
  }>("SELECT name, icon, proxy, deleted_at FROM spaces WHERE id = 'swork01'")!;
  assert.ok(
    row.deleted_at !== null &&
      row.name === "" &&
      row.icon === null &&
      row.proxy === null,
  );
  assert.ok(
    !JSON.stringify(
      db.all("SELECT payload FROM oplog WHERE entity = 'space'"),
    ).includes("Work"),
  );
  assert.deepEqual(
    parseSpacesSettings(new SpacesTable(db).load()).spaces.map(
      (space) => space.id,
    ),
    ["default", "sfun002"],
  );
});
