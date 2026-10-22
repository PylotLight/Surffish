import assert from "node:assert/strict";
import test from "node:test";
import { SurffishDatabase } from "./database.ts";
import { PreferencesTable } from "./preferences-store.ts";
import {
  parseBrowserPreferences,
  parseBrowserSiteSettings,
  type BrowserPreferences,
} from "../../shared/persistence.ts";

function samplePreferences(): BrowserPreferences {
  const base = parseBrowserPreferences(null);
  return {
    ...base,
    searchEngine: "duckduckgo",
    tabSleepMinutes: base.tabSleepMinutes,
    sidebarWidth: 300,
    pinnedSites: [{ title: "Old pin", url: "https://pin.test/" }],
    siteSettings: {
      "https://maps.test": {
        ...parseBrowserSiteSettings("https://maps.test", {})!,
        allowGeolocation: true,
      },
      "https://news.test": {
        ...parseBrowserSiteSettings("https://news.test", {})!,
        blockAds: false,
      },
    },
    siteZoom: { "https://small.test": 1.25, "https://big.test": 0.8 },
    siteVolume: { "https://quiet.test": 0.3 },
  };
}

function settingsOps(
  db: SurffishDatabase,
): Array<{ entity_id: string; op: string; payload: string | null }> {
  return db.all(
    "SELECT entity_id, op, payload FROM oplog WHERE entity = 'setting' ORDER BY seq",
  );
}

test("round-trips preferences through parseBrowserPreferences", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const table = new PreferencesTable(db);
  assert.equal(table.load(), null, "nothing saved yet");
  const preferences = samplePreferences();
  table.save(preferences);
  const loaded = parseBrowserPreferences(new PreferencesTable(db).load());
  assert.deepEqual(
    loaded,
    parseBrowserPreferences({ version: 1, ...preferences }),
  );
  assert.deepEqual(
    Object.keys(loaded.siteZoom),
    ["https://small.test", "https://big.test"],
    "zoom keeps its order (oldest change first)",
  );
  assert.deepEqual(
    loaded.siteVolume,
    { "https://quiet.test": 0.3 },
    "tab volume per site round-trips",
  );
});

test("one change writes one row; device-only values are scoped", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const table = new PreferencesTable(db);
  const preferences = samplePreferences();
  table.save(preferences);
  assert.deepEqual(table.save(preferences), {
    upserted: 0,
    tombstoned: 0,
    deleted: 0,
  });
  assert.deepEqual(table.save({ ...preferences, searchEngine: "google" }), {
    upserted: 1,
    tombstoned: 0,
    deleted: 0,
  });
  assert.deepEqual(
    table.save({
      ...preferences,
      searchEngine: "google",
      siteZoom: { ...preferences.siteZoom, "https://small.test": 1.5 },
    }),
    { upserted: 1, tombstoned: 0, deleted: 0 },
  );
  const scopes = Object.fromEntries(
    db
      .all<{ key: string; scope: string }>("SELECT key, scope FROM settings")
      .map((row) => [row.key, row.scope]),
  );
  assert.equal(scopes["pref.sidebarWidth"], "device");
  assert.equal(scopes["pref.pinnedSites"], "device");
  assert.equal(scopes["pref.searchEngine"], "synced");
  assert.ok(
    Object.entries(scopes)
      .filter(([key]) => key.startsWith("zoom:"))
      .every(([, scope]) => scope === "device"),
  );
  assert.ok(
    Object.entries(scopes)
      .filter(([key]) => key.startsWith("site:"))
      .every(([, scope]) => scope === "synced"),
  );
});

test("per-site keys never contain the origin, and removing a site leaves no trace of it", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const table = new PreferencesTable(db);
  const preferences = samplePreferences();
  table.save(preferences);
  assert.ok(
    db
      .all<{ key: string }>("SELECT key FROM settings")
      .every((row) => !row.key.includes(".test")),
  );
  const { "https://maps.test": _removed, ...siteSettings } =
    preferences.siteSettings;
  const { "https://big.test": _zoom, ...siteZoom } = preferences.siteZoom;
  assert.deepEqual(table.save({ ...preferences, siteSettings, siteZoom }), {
    upserted: 0,
    tombstoned: 0,
    deleted: 2,
  });
  const dump = JSON.stringify([
    db.all("SELECT * FROM settings"),
    settingsOps(db),
  ]);
  assert.ok(
    !dump.includes("maps.test"),
    "the forgotten site is gone from the table and the change log",
  );
  assert.ok(!dump.includes("big.test"));
  assert.equal(
    settingsOps(db).filter((op) => op.op === "delete" && op.payload === null)
      .length,
    2,
    "two content-free delete ops for sync",
  );
  const loaded = parseBrowserPreferences(new PreferencesTable(db).load());
  assert.deepEqual(Object.keys(loaded.siteSettings), ["https://news.test"]);
  assert.deepEqual(Object.keys(loaded.siteZoom), ["https://small.test"]);
});

test("preferences rows do not touch other settings rows", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const { now, hlc, deviceId } = db.stamp();
  db.run(
    "INSERT INTO settings (key, value, scope, device_id, created_at, updated_at, hlc) VALUES ('spaces.enabled', 'true', 'synced', ?, ?, ?, ?)",
    deviceId,
    now,
    now,
    hlc,
  );
  const table = new PreferencesTable(db);
  table.save(samplePreferences());
  table.save(parseBrowserPreferences(null));
  assert.equal(
    db.get<{ deleted_at: number | null }>(
      "SELECT deleted_at FROM settings WHERE key = 'spaces.enabled'",
    )!.deleted_at,
    null,
  );
});
