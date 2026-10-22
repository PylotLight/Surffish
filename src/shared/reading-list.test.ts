import assert from "node:assert/strict";
import test from "node:test";
import {
  canSaveToReadingList,
  countUnread,
  dedupeReadingList,
  filterReadingList,
  normalizeReadingListUrl,
  readingListAge,
  readingListBadge,
  readingListKey,
  sanitizeReadingListInput,
  type ReadingListItem,
} from "./reading-list.ts";

function item(overrides: Partial<ReadingListItem>): ReadingListItem {
  return {
    id: "a",
    url: "https://example.com/",
    title: "Example",
    faviconUrl: null,
    siteName: null,
    excerpt: null,
    addedAt: 1_000,
    readAt: null,
    hasSnapshot: false,
    ...overrides,
  };
}

test("only web pages can be saved, without credentials", () => {
  assert.equal(
    normalizeReadingListUrl("https://example.com/a?b=1#c"),
    "https://example.com/a?b=1#c",
  );
  assert.equal(
    normalizeReadingListUrl("https://user:pw@example.com/x"),
    "https://example.com/x",
  );
  for (const bad of [
    "about:blank",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "surffish://newtab",
    "",
    "   ",
    42,
    null,
    `https://example.com/${"x".repeat(9000)}`,
  ]) {
    assert.equal(normalizeReadingListUrl(bad), null, String(bad).slice(0, 40));
  }
});

test("the same page under a fragment, trailing slash, www or http is one key", () => {
  const key = readingListKey("https://example.com/post?id=1");
  assert.equal(
    readingListKey("http://www.example.com/post/?id=1".replace("/?", "?")),
    key,
  );
  assert.equal(readingListKey("https://example.com/post?id=1#comments"), key);
  assert.equal(
    readingListKey("https://example.com/post/?id=1"),
    readingListKey("https://example.com/post?id=1"),
  );
  assert.notEqual(readingListKey("https://example.com/post?id=2"), key);
  assert.notEqual(readingListKey("https://example.com:8080/post?id=1"), key);
});

test("sanitize trims, caps and drops junk", () => {
  const clean = sanitizeReadingListInput({
    url: " https://example.com/x ",
    title: "  A\n\ttitle  ",
    faviconUrl: "javascript:1",
    siteName: "S".repeat(500),
    excerpt: "",
    extra: 1,
  })!;
  assert.deepEqual(
    { ...clean, siteName: clean.siteName!.length },
    {
      url: "https://example.com/x",
      title: "A title",
      faviconUrl: null,
      siteName: 120,
      excerpt: null,
    },
  );
  assert.equal(sanitizeReadingListInput({ url: "about:blank" }), null);
  assert.equal(sanitizeReadingListInput("https://example.com"), null);
  assert.equal(
    sanitizeReadingListInput({
      url: "https://e.com",
      faviconUrl: "data:image/png;base64,AAAA",
    })!.faviconUrl,
    "data:image/png;base64,AAAA",
  );
});

test("dedupe keeps the newest save, and it stays unread if any copy is unread", () => {
  const items = [
    item({ id: "1", url: "https://example.com/a", addedAt: 100, readAt: null }),
    item({
      id: "2",
      url: "https://example.com/a#x",
      addedAt: 300,
      readAt: 400,
    }),
    item({ id: "3", url: "https://example.com/b", addedAt: 200, readAt: 250 }),
  ];
  const list = dedupeReadingList(items);
  assert.deepEqual(
    list.map((entry) => [entry.id, entry.readAt]),
    [
      ["2", null],
      ["3", 250],
    ],
  );
  assert.equal(countUnread(list), 1);
});

test("filter by unread and by every search word", () => {
  const items = [
    item({
      id: "1",
      title: "Rust async deep dive",
      url: "https://blog.example.com/rust",
      readAt: null,
    }),
    item({
      id: "2",
      title: "Bun release notes",
      url: "https://bun.sh/blog",
      siteName: "Bun",
      readAt: 5,
    }),
    item({
      id: "3",
      title: "Untitled",
      url: "https://news.example.org/x",
      excerpt: "All about async Rust",
      readAt: null,
    }),
  ];
  assert.deepEqual(
    filterReadingList(items, "unread").map((entry) => entry.id),
    ["1", "3"],
  );
  assert.deepEqual(
    filterReadingList(items, "all", "RUST async").map((entry) => entry.id),
    ["1", "3"],
  );
  assert.deepEqual(
    filterReadingList(items, "all", "bun").map((entry) => entry.id),
    ["2"],
  );
  assert.deepEqual(filterReadingList(items, "unread", "bun"), []);
});

test("badge, age and who may save", () => {
  assert.equal(readingListBadge(0), "");
  assert.equal(readingListBadge(7), "7");
  assert.equal(readingListBadge(140), "99+");
  const now = Date.UTC(2026, 9, 14, 12);
  assert.equal(readingListAge(now - 10_000, now), "now");
  assert.equal(readingListAge(now - 5 * 60_000, now), "5m");
  assert.equal(readingListAge(now - 3 * 3_600_000, now), "3h");
  assert.equal(readingListAge(now - 2 * 86_400_000, now), "2d");
  assert.equal(canSaveToReadingList({ url: "https://example.com" }), true);
  assert.equal(
    canSaveToReadingList({ url: "https://example.com", private: true }),
    false,
  );
  assert.equal(canSaveToReadingList({ url: "" }), false);
  assert.equal(canSaveToReadingList(null), false);
});
