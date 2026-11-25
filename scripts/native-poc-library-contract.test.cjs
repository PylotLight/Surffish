const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("native library panels count matching rows and offer sorting without changing the store schema", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const store = read("poc-native/Sources/BrowserLibraryStore.swift");
  assert.match(sidebar, /Text\("\\\(visibleLibraryCount\) results"\)/);
  assert.match(
    sidebar,
    /model\.historyMatches\(\$0\) && model\.historyTimeFilter\.includes\(\$0\.visitedAt\)/,
  );
  assert.match(sidebar, /model\.bookmarks\.filter\(model\.bookmarkMatches\)/);
  assert.match(
    sidebar,
    /model\.readingList\.filter\(model\.readingListMatches\)/,
  );
  assert.match(sidebar, /case defaultOrder = "Default"/);
  assert.match(sidebar, /case newestFirst = "Newest"/);
  assert.match(sidebar, /case oldestFirst = "Oldest"/);
  assert.match(sidebar, /case titleAscending = "Title A–Z"/);
  assert.match(sidebar, /case titleDescending = "Title Z–A"/);
  assert.match(sidebar, /case \.defaultOrder: return entries/);
  assert.match(sidebar, /var historySortOrder: LibrarySortOrder/);
  assert.match(sidebar, /var bookmarksSortOrder: LibrarySortOrder/);
  assert.match(sidebar, /var readingListSortOrder: LibrarySortOrder/);
  assert.match(sidebar, /Menu \{/);
  assert.match(sidebar, /pinnedStrip/);
  assert.match(sidebar, /Clear search/);
  assert.match(sidebar, /HistoryTimeFilter\.allCases/);
  assert.match(store, /struct Snapshot: Codable/);
  assert.match(store, /case history, bookmarks, readingList/);
  assert.doesNotMatch(store, /sortOrder/);
});

test("bookmark order persists and drag reorder stays inside the pinned partition", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const store = read("poc-native/Sources/BrowserLibraryStore.swift");
  assert.match(store, /bookmarks = saved\.bookmarks/);
  assert.match(store, /func moveBookmark\(id: UUID, beforeID targetID: UUID\)/);
  assert.match(store, /source\.isPinned == target\.isPinned/);
  assert.match(store, /orderedPartition\.insert\(moving, at: destination\)/);
  assert.match(
    sidebar,
    /func reorderBookmark\(draggedID: String, before target: BrowserBookmark\)/,
  );
  assert.match(sidebar, /\.draggable\(bookmark\.id\.uuidString\)/);
  assert.match(sidebar, /\.dropDestination\(for: String\.self\)/);
  assert.match(sidebar, /model\.bookmarksSortOrder == \.defaultOrder/);
  assert.match(
    sidebar,
    /BrowserLibraryStore\.shared\.moveBookmark\(id: id, beforeID: target\.id\)/,
  );
});
