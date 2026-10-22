import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SurffishDatabase } from "./database.ts";
import { SessionStore } from "./session-store.ts";
import {
  normalizeWindowsSession,
  type SessionWindowInput,
} from "../../shared/window-session.ts";
import { FILE_DB_TEST_TIMEOUT_MS, storeTestDir } from "./test-temp-dir.ts";

const geometry = {
  bounds: { x: 10, y: 20, width: 1200, height: 800 },
  maximized: false,
  fullScreen: false,
};

function sampleWindows(): SessionWindowInput[] {
  return [
    {
      urls: [
        "https://a.test/",
        "https://b.test/",
        "https://c.test/",
        "https://d.test/",
      ],
      activeIndex: 2,
      pinnedIndexes: [0],
      geometry,
      tabIds: ["t-a", "t-b", "t-c", "t-d"],
      windowKey: "1",
      groups: [{ tabs: [1, 2], name: "Work", color: "blue", collapsed: true }],
      splits: [{ tabs: [2, 3], sizes: [0.4, 0.6] }],
      spaces: {
        tabSpaces: ["default", "default", "default", "research"],
        activeSpace: "default",
        spaceActiveTabs: { research: 3 },
      },
    },
    {
      urls: ["https://e.test/"],
      activeIndex: 0,
      pinnedIndexes: [],
      geometry: null,
      tabIds: ["t-e"],
      windowKey: "2",
    },
  ];
}

function liveTabIds(db: SurffishDatabase): string[] {
  return db
    .all<{ id: string }>(
      "SELECT t.id FROM session_tabs t JOIN session_windows w ON w.id = t.window_id WHERE t.deleted_at IS NULL ORDER BY w.position, t.position",
    )
    .map((row) => row.id);
}

test("round-trips windows, tabs, pins, groups, splits and spaces", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const store = new SessionStore(db);
  assert.equal(store.load(), null, "nothing saved yet");
  const saved = normalizeWindowsSession(sampleWindows(), 0);
  store.save(saved);
  const loaded = new SessionStore(db).load()!;
  assert.equal(loaded.focusedIndex, 0);
  assert.equal(loaded.windows.length, 2);
  const [first, second] = loaded.windows;
  assert.deepEqual(first!.urls, saved.windows[0]!.urls);
  assert.equal(first!.activeIndex, 2);
  assert.deepEqual(first!.pinnedIndexes, [0]);
  assert.deepEqual(first!.geometry, geometry);
  assert.deepEqual(first!.groups, [
    { tabs: [1, 2], name: "Work", color: "blue", collapsed: true },
  ]);
  assert.deepEqual(first!.splits, [{ tabs: [2, 3], sizes: [0.4, 0.6] }]);
  assert.deepEqual(first!.spaces, {
    tabSpaces: ["default", "default", "default", "research"],
    activeSpace: "default",
    spaceActiveTabs: { research: 3 },
  });
  assert.deepEqual(second!.urls, ["https://e.test/"]);
  assert.equal(second!.geometry, null);
  db.close();
});

test("saving again only writes rows that changed, and closed tabs become tombstones", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const store = new SessionStore(db);
  const windows = sampleWindows();
  store.save(normalizeWindowsSession(windows, 0));
  const before = Number(
    db.get<{ seq: number }>("SELECT max(seq) AS seq FROM oplog")!.seq,
  );
  const ids = liveTabIds(db);
  const closedTabId = db.get<{ id: string }>(
    "SELECT id FROM session_tabs WHERE url = 'https://e.test/'",
  )!.id;

  store.save(normalizeWindowsSession(windows, 0));
  assert.equal(
    Number(db.get<{ seq: number }>("SELECT max(seq) AS seq FROM oplog")!.seq),
    before,
    "an unchanged session writes nothing",
  );

  // Navigate tab b: same runtime id, so the same row, one op.
  windows[0] = {
    ...windows[0]!,
    urls: [
      "https://a.test/",
      "https://b.test/next",
      "https://c.test/",
      "https://d.test/",
    ],
  };
  store.save(normalizeWindowsSession(windows, 0));
  const changed = db.changesSince(before);
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.entity, "session_tab");
  assert.deepEqual(
    liveTabIds(db),
    ids,
    "row ids stay stable through navigation",
  );

  // Close window 2.
  store.save(normalizeWindowsSession([windows[0]!], 0));
  const closed = db.all<{ deleted_at: number | null; url: string }>(
    "SELECT deleted_at, url FROM session_tabs WHERE id = ?",
    closedTabId,
  );
  assert.equal(closed.length, 1);
  assert.ok(closed[0]!.deleted_at, "the closed tab is tombstoned, not deleted");
  assert.equal(closed[0]!.url, "", "and its tombstone keeps no URL");
  assert.ok(
    !JSON.stringify(db.all("SELECT payload FROM oplog")).includes("e.test"),
    "nor does the change log",
  );
  assert.equal(
    db.all("SELECT id FROM session_windows WHERE deleted_at IS NULL").length,
    1,
  );
  db.close();
});

test(
  "restored tabs adopt their old rows after a restart (new runtime ids)",
  { timeout: FILE_DB_TEST_TIMEOUT_MS },
  () => {
    const dir = storeTestDir("surffish-session-");
    try {
      const path = join(dir, "surffish.db");
      const first = SurffishDatabase.open({ path });
      new SessionStore(first).save(normalizeWindowsSession(sampleWindows(), 1));
      const ids = liveTabIds(first);
      const groupId = first.get<{ id: string }>(
        "SELECT id FROM tab_groups WHERE deleted_at IS NULL",
      )!.id;
      first.close();

      const db = SurffishDatabase.open({ path });
      const store = new SessionStore(db);
      const restored = store.load()!;
      assert.equal(restored.focusedIndex, 1);
      const before = Number(
        db.get<{ seq: number }>("SELECT max(seq) AS seq FROM oplog")!.seq,
      );
      // The browser recreates the tabs with fresh runtime ids and saves.
      const fresh = sampleWindows().map((window, index) => ({
        ...window,
        tabIds: window.urls.map((_url, tab) => `new-${index}-${tab}`),
        windowKey: `w${index + 10}`,
      }));
      store.save(normalizeWindowsSession(fresh, 1));
      assert.deepEqual(liveTabIds(db), ids, "same row ids");
      assert.equal(
        db.get<{ id: string }>(
          "SELECT id FROM tab_groups WHERE deleted_at IS NULL",
        )!.id,
        groupId,
        "same group row",
      );
      assert.equal(db.changesSince(before).length, 0, "nothing rewritten");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("an imported session (no runtime ids) is adopted by the first real save; clear tombstones everything", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const store = new SessionStore(db);
  const imported = normalizeWindowsSession(
    sampleWindows().map(
      ({ tabIds: _ids, windowKey: _key, ...window }) => window,
    ),
    0,
  );
  store.save(imported);
  const ids = liveTabIds(db);
  store.save(normalizeWindowsSession(sampleWindows(), 0));
  assert.deepEqual(liveTabIds(db), ids);
  store.clear();
  assert.equal(liveTabIds(db).length, 0);
  assert.equal(store.load(), null);
  assert.ok(store.savedAt());
  db.close();
});

test("unsafe URLs written into the table are dropped on load, like the JSON file", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const store = new SessionStore(db);
  store.save(
    normalizeWindowsSession(
      [
        {
          urls: ["https://ok.test/"],
          activeIndex: 0,
          pinnedIndexes: [],
          geometry: null,
        },
      ],
      0,
    ),
  );
  const { now, hlc, deviceId } = db.stamp();
  const windowId = db.get<{ id: string }>("SELECT id FROM session_windows")!.id;
  db.run(
    "INSERT INTO session_tabs (id, window_id, position, url, device_id, created_at, updated_at, hlc) VALUES ('evil', ?, 1, 'javascript:alert(1)', ?, ?, ?, ?)",
    windowId,
    deviceId,
    now,
    now,
    hlc,
  );
  assert.deepEqual(new SessionStore(db).load()!.windows[0]!.urls, [
    "https://ok.test/",
  ]);
  db.close();
});

test("back/forward lists are saved beside their tab rows, rewritten only when they change, and gone with the tab", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const store = new SessionStore(db);
  const history = (url: string, state: string) => ({
    entries: [
      { url: "https://z.test/", title: "Z" },
      { url, title: "Here", pageState: state },
    ],
    index: 1,
  });
  const windows = (): SessionWindowInput[] =>
    sampleWindows().map((window, index) =>
      index === 0
        ? {
            ...window,
            histories: [
              history("https://a.test/", "s1"),
              null,
              history("https://c.test/", "s3"),
              null,
            ],
          }
        : window,
    );
  store.save(normalizeWindowsSession(windows(), 0));
  assert.equal(db.all("SELECT tab_id FROM session_tab_history").length, 2);
  const loaded = new SessionStore(db).load()!;
  assert.deepEqual(loaded.windows[0]!.histories, [
    history("https://a.test/", "s1"),
    null,
    history("https://c.test/", "s3"),
    null,
  ]);
  assert.equal(loaded.windows[1]!.histories, undefined);
  // Not synced: nothing about it in the change log.
  assert.ok(
    !JSON.stringify(db.all("SELECT payload FROM oplog")).includes("z.test"),
  );
  const stamp = (url: string): number =>
    db.get<{ updated_at: number }>(
      "SELECT h.updated_at FROM session_tab_history h JOIN session_tabs t ON t.id = h.tab_id WHERE t.url = ?",
      url,
    )!.updated_at;
  const before = stamp("https://a.test/");
  db.run("UPDATE session_tab_history SET updated_at = 1");
  const changed = windows();
  changed[0] = {
    ...changed[0]!,
    histories: [
      history("https://a.test/", "s1"),
      null,
      history("https://c.test/", "s3-scrolled"),
      null,
    ],
  };
  store.save(normalizeWindowsSession(changed, 0));
  assert.equal(
    stamp("https://a.test/"),
    1,
    "an unchanged list is not rewritten",
  );
  assert.ok(stamp("https://c.test/") >= before, "the changed one is");
  // Close the tab with a list: its row goes (hard delete, no tombstone keeping the pages).
  const closed = windows();
  closed[0] = {
    ...closed[0]!,
    urls: closed[0]!.urls.slice(1),
    tabIds: closed[0]!.tabIds!.slice(1),
    histories: closed[0]!.histories!.slice(1),
    groups: [],
    splits: [],
    spaces: undefined,
    activeIndex: 0,
  };
  store.save(normalizeWindowsSession(closed, 0));
  assert.equal(db.all("SELECT tab_id FROM session_tab_history").length, 1);
  store.clear();
  assert.equal(db.all("SELECT tab_id FROM session_tab_history").length, 0);
  db.close();
});

test("orphaned back/forward lists (their tab row is gone) are purged on first use", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  db.run(
    "INSERT INTO session_tab_history (tab_id, entries, active_index, updated_at) VALUES ('ghost', '[]', 0, 1)",
  );
  new SessionStore(db).load();
  assert.equal(db.all("SELECT tab_id FROM session_tab_history").length, 0);
  db.close();
});

test("clearing history trims saved back/forward lists in place and deletes ones left with nothing to restore", () => {
  const db = SurffishDatabase.open({ path: ":memory:" });
  const store = new SessionStore(db);
  const z = { url: "https://z.test/", title: "Z" };
  const y = { url: "https://y.test/", title: "Y" };
  const windows = (): SessionWindowInput[] =>
    sampleWindows().map((window, index) =>
      index === 0
        ? {
            ...window,
            histories: [
              {
                entries: [
                  z,
                  y,
                  { url: "https://a.test/", title: "A", pageState: "s1" },
                ],
                index: 2,
              },
              null,
              {
                entries: [z, { url: "https://c.test/", title: "C" }],
                index: 1,
              },
              null,
            ],
          }
        : window,
    );
  store.save(normalizeWindowsSession(windows(), 0));
  assert.equal(db.all("SELECT tab_id FROM session_tab_history").length, 2);
  store.forgetHistories((url) => url === "https://y.test/");
  assert.deepEqual(new SessionStore(db).load()!.windows[0]!.histories, [
    {
      entries: [z, { url: "https://a.test/", title: "A", pageState: "s1" }],
      index: 1,
    },
    null,
    { entries: [z, { url: "https://c.test/", title: "C" }], index: 1 },
    null,
  ]);
  store.forgetHistories("all");
  // a.test keeps only its current page (scroll state); c.test had nothing else, so its row is gone.
  const rows = db.all<{ entries: string; active_index: number }>(
    "SELECT entries, active_index FROM session_tab_history",
  );
  assert.deepEqual(
    rows.map((row) => [JSON.parse(row.entries), row.active_index]),
    [[[{ url: "https://a.test/", title: "A", pageState: "s1" }], 0]],
  );
  // A later save with the same (trimmed) live lists writes nothing back.
  const trimmed = windows();
  trimmed[0] = {
    ...trimmed[0]!,
    histories: [
      {
        entries: [{ url: "https://a.test/", title: "A", pageState: "s1" }],
        index: 0,
      },
      null,
      null,
      null,
    ],
  };
  db.run("UPDATE session_tab_history SET updated_at = 1");
  store.save(normalizeWindowsSession(trimmed, 0));
  assert.equal(
    db.get<{ updated_at: number }>(
      "SELECT updated_at FROM session_tab_history",
    )!.updated_at,
    1,
  );
  db.close();
});
