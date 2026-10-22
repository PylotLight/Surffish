import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TOOLBAR_LAYOUT,
  DOWNLOADS_RECENT_MS,
  downloadsAttention,
  fitToolbarItems,
  isDefaultToolbarLayout,
  moveToolbarItem,
  OMNIBOX_MIN_CENTERED,
  OMNIBOX_MIN_INLINE,
  parseToolbarLayout,
  sameToolbarSet,
  setToolbarPlacement,
  shiftToolbarItem,
  TOOLBAR_ITEM_IDS,
  TOOLBAR_UNFOLD_HYSTERESIS,
  toolbarItemAvailable,
  toolbarItemsBudget,
  toolbarItemWanted,
  togglePinned,
  wantedToolbarItems,
  type ToolbarContext,
  type ToolbarItemId,
} from "./toolbar-layout";

const quiet: ToolbarContext = {
  castEnabled: true,
  castLive: false,
  castDevices: 0,
  tabHasMedia: false,
  downloadsActive: false,
  downloadsRecent: false,
};

describe("toolbar layout: defaults and migration", () => {
  test("nothing stored (every existing profile) gets the new defaults", () => {
    const layout = parseToolbarLayout(null);
    expect(layout).toEqual(DEFAULT_TOOLBAR_LAYOUT);
    expect(layout).not.toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(isDefaultToolbarLayout(layout)).toBe(true);
    expect(wantedToolbarItems(layout, quiet)).toEqual([
      "bookmarks",
      "adblock",
      "extensions",
    ]);
  });

  test("default pins: bookmarks, ad blocker, extensions; cast/downloads contextual; reading list and history in the menu", () => {
    const { placement } = DEFAULT_TOOLBAR_LAYOUT;
    expect(placement).toEqual({
      bookmarks: "pinned",
      "reading-list": "menu",
      adblock: "pinned",
      cast: "auto",
      history: "menu",
      extensions: "pinned",
      downloads: "auto",
    });
  });

  test("junk, wrong types and future versions fall back to defaults", () => {
    for (const value of [
      undefined,
      3,
      "x",
      [],
      { version: 99, order: ["history"] },
    ])
      expect(parseToolbarLayout(value)).toEqual(DEFAULT_TOOLBAR_LAYOUT);
  });

  test("a partial layout keeps what it says and fills in the rest", () => {
    const layout = parseToolbarLayout({
      version: 1,
      order: ["downloads", "history", "nope", "history"],
      placement: { history: "pinned", adblock: "bogus", bookmarks: "menu" },
    });
    expect(layout.order.indexOf("downloads")).toBeLessThan(
      layout.order.indexOf("history"),
    );
    expect([...layout.order].sort()).toEqual([...TOOLBAR_ITEM_IDS].sort());
    expect(layout.placement.history).toBe("pinned");
    expect(layout.placement.bookmarks).toBe("menu");
    expect(layout.placement.adblock).toBe("pinned");
  });

  test("an id missing from a stored order lands after its default neighbour", () => {
    const order = TOOLBAR_ITEM_IDS.filter((id) => id !== "cast");
    const layout = parseToolbarLayout({ version: 1, order, placement: {} });
    expect(layout.order).toEqual([...TOOLBAR_ITEM_IDS]);
  });

  test("auto only sticks for contextual buttons", () => {
    const layout = parseToolbarLayout({
      placement: { history: "auto", cast: "auto", downloads: "menu" },
    });
    expect(layout.placement.history).toBe("pinned");
    expect(layout.placement.cast).toBe("auto");
    expect(layout.placement.downloads).toBe("menu");
    expect(
      setToolbarPlacement(layout, "reading-list", "auto").placement[
        "reading-list"
      ],
    ).toBe("pinned");
  });

  test("round-trips through JSON", () => {
    const layout = togglePinned(
      moveToolbarItem(DEFAULT_TOOLBAR_LAYOUT, "history", "bookmarks", false),
      "history",
    );
    expect(parseToolbarLayout(JSON.parse(JSON.stringify(layout)))).toEqual(
      layout,
    );
  });
});

describe("toolbar layout: pin, unpin, reorder", () => {
  test("pin / unpin toggles; contextual buttons unpin back to auto", () => {
    const pinned = togglePinned(DEFAULT_TOOLBAR_LAYOUT, "history");
    expect(pinned.placement.history).toBe("pinned");
    expect(togglePinned(pinned, "history").placement.history).toBe("menu");
    const castPinned = togglePinned(DEFAULT_TOOLBAR_LAYOUT, "cast");
    expect(castPinned.placement.cast).toBe("pinned");
    expect(togglePinned(castPinned, "cast").placement.cast).toBe("auto");
    expect(DEFAULT_TOOLBAR_LAYOUT.placement.history).toBe("menu");
  });

  test("no-op changes return the same object (no storage write, no re-render)", () => {
    expect(
      setToolbarPlacement(DEFAULT_TOOLBAR_LAYOUT, "bookmarks", "pinned"),
    ).toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(
      moveToolbarItem(DEFAULT_TOOLBAR_LAYOUT, "adblock", "adblock", true),
    ).toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(
      moveToolbarItem(
        DEFAULT_TOOLBAR_LAYOUT,
        "bookmarks",
        "reading-list",
        false,
      ),
    ).toBe(DEFAULT_TOOLBAR_LAYOUT);
    expect(shiftToolbarItem(DEFAULT_TOOLBAR_LAYOUT, "bookmarks", -1)).toBe(
      DEFAULT_TOOLBAR_LAYOUT,
    );
    expect(shiftToolbarItem(DEFAULT_TOOLBAR_LAYOUT, "downloads", 1)).toBe(
      DEFAULT_TOOLBAR_LAYOUT,
    );
  });

  test("drag before / after a target", () => {
    const before = moveToolbarItem(
      DEFAULT_TOOLBAR_LAYOUT,
      "extensions",
      "bookmarks",
      false,
    );
    expect(before.order).toEqual([
      "extensions",
      "bookmarks",
      "reading-list",
      "adblock",
      "cast",
      "history",
      "downloads",
    ]);
    const after = moveToolbarItem(
      DEFAULT_TOOLBAR_LAYOUT,
      "bookmarks",
      "adblock",
      true,
    );
    expect(wantedToolbarItems(after, quiet)).toEqual([
      "adblock",
      "bookmarks",
      "extensions",
    ]);
    expect(isDefaultToolbarLayout(after)).toBe(false);
  });

  test("shift one step in the full order", () => {
    expect(
      shiftToolbarItem(DEFAULT_TOOLBAR_LAYOUT, "adblock", -1).order.slice(0, 3),
    ).toEqual(["bookmarks", "adblock", "reading-list"]);
    expect(
      shiftToolbarItem(DEFAULT_TOOLBAR_LAYOUT, "bookmarks", 1).order.slice(
        0,
        2,
      ),
    ).toEqual(["reading-list", "bookmarks"]);
  });
});

describe("toolbar layout: contextual buttons", () => {
  test("cast (auto): only with a device and media on the page, or while casting", () => {
    expect(toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "cast", quiet)).toBe(
      false,
    );
    expect(
      toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "cast", {
        ...quiet,
        castDevices: 1,
      }),
    ).toBe(false);
    expect(
      toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "cast", {
        ...quiet,
        tabHasMedia: true,
      }),
    ).toBe(false);
    expect(
      toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "cast", {
        ...quiet,
        castDevices: 1,
        tabHasMedia: true,
      }),
    ).toBe(true);
    expect(
      toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "cast", {
        ...quiet,
        castLive: true,
      }),
    ).toBe(true);
  });

  test("cast pinned = always (while cast is on); cast off = nowhere", () => {
    const pinned = setToolbarPlacement(
      DEFAULT_TOOLBAR_LAYOUT,
      "cast",
      "pinned",
    );
    expect(toolbarItemWanted(pinned, "cast", quiet)).toBe(true);
    expect(
      toolbarItemWanted(pinned, "cast", { ...quiet, castEnabled: false }),
    ).toBe(false);
    expect(toolbarItemAvailable("cast", { ...quiet, castEnabled: false })).toBe(
      false,
    );
  });

  test("menu placement never takes a slot, even while it matters", () => {
    const menu = setToolbarPlacement(
      DEFAULT_TOOLBAR_LAYOUT,
      "downloads",
      "menu",
    );
    expect(
      toolbarItemWanted(menu, "downloads", { ...quiet, downloadsActive: true }),
    ).toBe(false);
  });

  test("downloads (auto): while running or recently finished", () => {
    expect(toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "downloads", quiet)).toBe(
      false,
    );
    expect(
      toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "downloads", {
        ...quiet,
        downloadsActive: true,
      }),
    ).toBe(true);
    expect(
      toolbarItemWanted(DEFAULT_TOOLBAR_LAYOUT, "downloads", {
        ...quiet,
        downloadsRecent: true,
      }),
    ).toBe(true);
  });

  test("downloads attention: active, progress, recent until an hour or until seen", () => {
    const now = 10_000_000;
    const running = {
      state: "progressing",
      startedAt: now - 5000,
      completedAt: null,
      receivedBytes: 25,
      totalBytes: 100,
    };
    const unknownSize = {
      state: "progressing",
      startedAt: now - 5000,
      completedAt: null,
      receivedBytes: 25,
      totalBytes: 0,
    };
    const done = {
      state: "completed",
      startedAt: now - 60_000,
      completedAt: now - 30_000,
      receivedBytes: 10,
      totalBytes: 10,
    };
    const cancelled = {
      state: "cancelled",
      startedAt: now - 10,
      completedAt: now - 5,
      receivedBytes: 1,
      totalBytes: 10,
    };
    expect(downloadsAttention([], 0, now)).toEqual({
      active: false,
      recent: false,
      progress: null,
      recentUntil: null,
    });
    expect(downloadsAttention([running, unknownSize], 0, now)).toMatchObject({
      active: true,
      progress: 0.25,
    });
    expect(downloadsAttention([unknownSize], 0, now).progress).toBe(null);
    expect(downloadsAttention([done], 0, now)).toEqual({
      active: false,
      recent: true,
      progress: null,
      recentUntil: now - 30_000 + DOWNLOADS_RECENT_MS,
    });
    expect(downloadsAttention([done], now - 1000, now).recent).toBe(false);
    expect(
      downloadsAttention([done], 0, now - 30_000 + DOWNLOADS_RECENT_MS).recent,
    ).toBe(false);
    expect(downloadsAttention([cancelled], 0, now).recent).toBe(false);
  });
});

describe("toolbar layout: narrow-window overflow", () => {
  const items = (
    ids: ToolbarItemId[],
    width = 30,
  ): Array<{ id: ToolbarItemId; width: number }> =>
    ids.map((id) => ({ id, width }));
  const all: ToolbarItemId[] = [
    "bookmarks",
    "reading-list",
    "adblock",
    "history",
    "extensions",
  ];

  test("everything fits: nothing folds", () => {
    expect(fitToolbarItems(items(all), 500, 2).size).toBe(0);
  });

  test("folds lowest priority first: history, then reading list, then extensions", () => {
    expect([...fitToolbarItems(items(all), 4 * 32, 2)]).toEqual(["history"]);
    expect([...fitToolbarItems(items(all), 3 * 32, 2)].sort()).toEqual([
      "history",
      "reading-list",
    ]);
    expect([...fitToolbarItems(items(all), 2 * 32, 2)].sort()).toEqual([
      "extensions",
      "history",
      "reading-list",
    ]);
    expect(fitToolbarItems(items(all), 0, 2).size).toBe(5);
  });

  test("strict priority: once one folds, smaller lower-priority buttons fold too", () => {
    const folded = fitToolbarItems(
      [
        { id: "adblock", width: 30 },
        { id: "bookmarks", width: 80 },
        { id: "history", width: 20 },
      ],
      60,
      0,
    );
    expect([...folded].sort()).toEqual(["bookmarks", "history"]);
  });

  test("hysteresis: a folded button needs a few px to spare to come back (no flicker at the edge)", () => {
    const exact = 5 * 32;
    expect(fitToolbarItems(items(all), exact, 2).size).toBe(0);
    expect([
      ...fitToolbarItems(items(all), exact, 2, new Set(["history"])),
    ]).toEqual(["history"]);
    expect(
      fitToolbarItems(
        items(all),
        exact + TOOLBAR_UNFOLD_HYSTERESIS,
        2,
        new Set(["history"]),
      ).size,
    ).toBe(0);
  });

  test("the result is stable: re-fitting with its own output gives the same set", () => {
    for (let budget = 0; budget < 220; budget += 3) {
      const first = fitToolbarItems(items(all), budget, 2);
      const second = fitToolbarItems(items(all), budget, 2, first);
      expect(sameToolbarSet(first, second)).toBe(true);
    }
  });

  test("budget: centered address bar leaves half; inline leaves the rest; never negative", () => {
    expect(
      toolbarItemsBudget({
        toolbarWidth: 1400,
        leadingWidth: 0,
        fixedWidth: 110,
        centered: true,
        gap: 5,
      }),
    ).toBe(Math.floor((1400 - OMNIBOX_MIN_CENTERED - 40) / 2 - 110));
    expect(
      toolbarItemsBudget({
        toolbarWidth: 800,
        leadingWidth: 70,
        fixedWidth: 110,
        centered: false,
        gap: 5,
      }),
    ).toBe(800 - 70 - OMNIBOX_MIN_INLINE - 5 - 110);
    expect(
      toolbarItemsBudget({
        toolbarWidth: 300,
        leadingWidth: 70,
        fixedWidth: 110,
        centered: false,
        gap: 5,
      }),
    ).toBe(0);
  });

  test("sameToolbarSet", () => {
    expect(sameToolbarSet(new Set(["cast"]), new Set(["cast"]))).toBe(true);
    expect(sameToolbarSet(new Set(["cast"]), new Set(["history"]))).toBe(false);
    expect(sameToolbarSet(new Set(), new Set(["history"]))).toBe(false);
  });
});
