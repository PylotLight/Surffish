import { describe, expect, test } from "bun:test";
import {
  capSessionHistories,
  forgetTabHistoryEntries,
  forgottenEntryIndexes,
  hostUrlMatcher,
  visitedUrlMatcher,
  MAX_SAVED_FORWARD_ENTRIES,
  MAX_SAVED_HISTORY_ENTRIES,
  MAX_SAVED_PAGE_STATE_CHARS,
  normalizeTabHistory,
  type SavedTabHistory,
} from "./tab-history";

const entry = (
  path: string,
  pageState?: string,
): { url: string; title: string; pageState?: string } => ({
  url: `https://a.test/${path}`,
  title: `Page ${path}`,
  ...(pageState ? { pageState } : {}),
});

describe("normalizeTabHistory", () => {
  test("keeps a restorable list as it is", () => {
    const history = {
      entries: [entry("a"), entry("b", "st-b"), entry("c", "st-c")],
      index: 2,
    };
    expect(normalizeTabHistory(history, "https://a.test/c")).toEqual(history);
  });

  test("null for missing or malformed input (old sessions have none)", () => {
    expect(normalizeTabHistory(undefined, "https://a.test/a")).toBeNull();
    expect(normalizeTabHistory(null, "https://a.test/a")).toBeNull();
    expect(
      normalizeTabHistory({ entries: "nope", index: 0 }, "https://a.test/a"),
    ).toBeNull();
    expect(
      normalizeTabHistory(
        { entries: [entry("a"), entry("b")], index: 2 },
        "https://a.test/a",
      ),
    ).toBeNull();
    expect(
      normalizeTabHistory(
        { entries: [entry("a"), entry("b")], index: 0.5 },
        "https://a.test/a",
      ),
    ).toBeNull();
  });

  test("null when the current entry is not the tab URL or cannot be restored", () => {
    expect(
      normalizeTabHistory(
        { entries: [entry("a"), entry("b")], index: 1 },
        "https://a.test/other",
      ),
    ).toBeNull();
    expect(
      normalizeTabHistory(
        {
          entries: [entry("a"), { url: "blob:https://a.test/x", title: "" }],
          index: 1,
        },
        "blob:https://a.test/x",
      ),
    ).toBeNull();
  });

  test("a single entry is only worth saving with its page state", () => {
    expect(
      normalizeTabHistory(
        { entries: [entry("a")], index: 0 },
        "https://a.test/a",
      ),
    ).toBeNull();
    expect(
      normalizeTabHistory(
        { entries: [entry("a", "st")], index: 0 },
        "https://a.test/a",
      ),
    ).toEqual({ entries: [entry("a", "st")], index: 0 });
  });

  test("drops blob:, data:, file:, internal and credential URLs and re-points the index", () => {
    const history = {
      entries: [
        { url: "surffish://quick-links", title: "New Tab" },
        entry("a"),
        { url: "data:text/html,hi", title: "" },
        { url: "file:///etc/passwd", title: "" },
        { url: "chrome://gpu", title: "" },
        { url: "https://user:pw@a.test/secret", title: "" },
        entry("b"),
        entry("c"),
      ],
      index: 6,
    };
    expect(normalizeTabHistory(history, "https://a.test/b")).toEqual({
      entries: [entry("a"), entry("b"), entry("c")],
      index: 1,
    });
  });

  test("scrubs secret query params and fragments; a changed URL loses its page state", () => {
    const history = {
      entries: [
        {
          url: "https://a.test/a?token=abc&q=1",
          title: "A",
          pageState: "st-a",
        },
        { url: "https://a.test/b#top", title: "B", pageState: "st-b" },
        entry("c", "st-c"),
      ],
      index: 2,
    };
    expect(normalizeTabHistory(history, "https://a.test/c")).toEqual({
      entries: [
        { url: "https://a.test/a?q=1", title: "A" },
        { url: "https://a.test/b", title: "B" },
        entry("c", "st-c"),
      ],
      index: 2,
    });
  });

  test("entries that only differed by fragment collapse into one, keeping the current one", () => {
    const history = {
      entries: [
        entry("a"),
        { url: "https://a.test/b#one", title: "B1" },
        { url: "https://a.test/b#two", title: "B2" },
        { url: "https://a.test/b#three", title: "B3" },
        entry("c"),
      ],
      index: 2,
    };
    expect(normalizeTabHistory(history, "https://a.test/b")).toEqual({
      entries: [
        entry("a"),
        { url: "https://a.test/b", title: "B2" },
        entry("c"),
      ],
      index: 1,
    });
  });

  test("strips an oversized page state but keeps the entry; cleans titles", () => {
    const huge = "x".repeat(MAX_SAVED_PAGE_STATE_CHARS + 1);
    const history = {
      entries: [
        {
          url: "https://a.test/a",
          title: "  Long \n  title ",
          pageState: huge,
        },
        { url: "https://a.test/b", title: 7, pageState: "ok" },
      ],
      index: 1,
    };
    expect(normalizeTabHistory(history, "https://a.test/b")).toEqual({
      entries: [
        { url: "https://a.test/a", title: "Long title" },
        { url: "https://a.test/b", title: "", pageState: "ok" },
      ],
      index: 1,
    });
  });

  test("caps the list around the current entry: up to 10 forward, the rest back", () => {
    const entries = Array.from({ length: 80 }, (_value, at) =>
      entry(String(at)),
    );
    const result = normalizeTabHistory(
      { entries, index: 60 },
      "https://a.test/60",
    )!;
    expect(result.entries.length).toBe(MAX_SAVED_HISTORY_ENTRIES);
    expect(result.entries[result.index]!.url).toBe("https://a.test/60");
    expect(result.entries.length - 1 - result.index).toBe(
      MAX_SAVED_FORWARD_ENTRIES,
    );
    expect(result.entries[0]!.url).toBe("https://a.test/21");
    // Few forward entries: the room goes to Back.
    const atEnd = normalizeTabHistory(
      { entries, index: 79 },
      "https://a.test/79",
    )!;
    expect(atEnd.entries.length).toBe(MAX_SAVED_HISTORY_ENTRIES);
    expect(atEnd.index).toBe(MAX_SAVED_HISTORY_ENTRIES - 1);
    // Near the start: forward fills the rest.
    const atStart = normalizeTabHistory(
      { entries, index: 2 },
      "https://a.test/2",
    )!;
    expect(atStart.index).toBe(2);
    expect(atStart.entries.length).toBe(MAX_SAVED_HISTORY_ENTRIES);
  });

  test("is idempotent (the session is normalised again on every load)", () => {
    const history = {
      entries: [
        entry("a", "st-a"),
        { url: "https://a.test/b#x", title: "B" },
        entry("c"),
      ],
      index: 2,
    };
    const once = normalizeTabHistory(history, "https://a.test/c");
    expect(normalizeTabHistory(once, "https://a.test/c")).toEqual(once);
  });
});

describe("capSessionHistories", () => {
  const big = (path: string, chars: number): SavedTabHistory => ({
    entries: [
      entry(`${path}-1`, "b".repeat(chars)),
      entry(`${path}-2`, "c".repeat(chars)),
    ],
    index: 1,
  });

  test("passes everything through under the cap", () => {
    const lists = [big("a", 100), null, big("b", 100)];
    const capped = capSessionHistories(lists, 10_000);
    expect(capped).toEqual(lists);
    expect(capped[0]).toBe(lists[0]!);
  });

  test("strips back/forward page states first, largest list first", () => {
    const lists = [big("small", 100), big("large", 4000)];
    const capped = capSessionHistories(lists, 5000);
    expect(capped[0]).toBe(lists[0]!);
    expect(capped[1]!.entries[0]!.pageState).toBeUndefined();
    expect(capped[1]!.entries[1]!.pageState).toBe("c".repeat(4000));
  });

  test("then the current page states, then whole lists; same length out", () => {
    const lists = [big("a", 4000), null, big("b", 4000)];
    const states = capSessionHistories(lists, 1000);
    expect(states.length).toBe(3);
    expect(
      states
        .flatMap((list) => list?.entries ?? [])
        .some((item) => item.pageState),
    ).toBe(false);
    expect(states.filter(Boolean).length).toBe(2);
    const tiny = capSessionHistories(lists, 150);
    expect(tiny.filter(Boolean).length).toBe(1);
    expect(capSessionHistories(lists, 0).every((list) => list === null)).toBe(
      true,
    );
  });
});

describe("clearing history out of back/forward lists", () => {
  const urls = [
    "https://a.test/a",
    "https://b.test/b",
    "https://a.test/c",
    "https://b.test/d",
  ];
  test("live tab: indexes to remove, highest first, never the current entry", () => {
    expect(forgottenEntryIndexes(urls, 2, "all")).toEqual([3, 1, 0]);
    expect(forgottenEntryIndexes(urls, 2, hostUrlMatcher("a.test"))).toEqual([
      0,
    ]);
    expect(forgottenEntryIndexes(urls, 0, () => false)).toEqual([]);
    expect(forgottenEntryIndexes(["https://a.test/a"], 0, "all")).toEqual([]);
  });

  test("saved list: all-time keeps only the current page, so Back and Forward go away", () => {
    const history = {
      entries: [entry("a"), entry("b", "st-b"), entry("c")],
      index: 1,
    };
    expect(forgetTabHistoryEntries(history, "all")).toEqual({
      entries: [entry("b", "st-b")],
      index: 0,
    });
    // The input is left alone.
    expect(history.entries.length).toBe(3);
  });

  test("saved list: matched pages go and the index follows the current one", () => {
    const history = {
      entries: [entry("a"), entry("b"), entry("c"), entry("d")],
      index: 2,
    };
    const out = forgetTabHistoryEntries(
      history,
      visitedUrlMatcher(["https://a.test/a#top", "https://a.test/d"]),
    );
    expect(out).toEqual({ entries: [entry("b"), entry("c")], index: 1 });
    // The current page stays even when it was visited in the range.
    expect(
      forgetTabHistoryEntries(history, visitedUrlMatcher(["https://a.test/c"])),
    ).toEqual(history);
    expect(forgetTabHistoryEntries(null, "all")).toBeNull();
    expect(
      forgetTabHistoryEntries({ entries: [entry("a")], index: 4 }, "all"),
    ).toBeNull();
  });

  test("a cleared list normalizes to nothing to save unless the current page has state", () => {
    const plain = forgetTabHistoryEntries(
      { entries: [entry("a"), entry("b")], index: 1 },
      "all",
    );
    expect(normalizeTabHistory(plain, "https://a.test/b")).toBeNull();
    const scrolled = forgetTabHistoryEntries(
      { entries: [entry("a"), entry("b", "st")], index: 1 },
      "all",
    );
    expect(normalizeTabHistory(scrolled, "https://a.test/b")).toEqual({
      entries: [entry("b", "st")],
      index: 0,
    });
  });

  test("matchers: visited URLs ignore #fragments; host match is exact and safe on junk", () => {
    const visited = visitedUrlMatcher(["https://a.test/x", ""]);
    expect(visited("https://a.test/x#y")).toBe(true);
    expect(visited("https://a.test/xy")).toBe(false);
    const host = hostUrlMatcher("A.test");
    expect(host("https://a.test/q")).toBe(true);
    expect(host("https://sub.a.test/q")).toBe(false);
    expect(host("not a url")).toBe(false);
  });
});
