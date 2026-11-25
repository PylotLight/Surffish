const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("history filters use calendar-day boundaries and expose all requested choices", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  assert.match(sidebar, /case all = "All"/);
  assert.match(sidebar, /case today = "Today"/);
  assert.match(sidebar, /case sevenDays = "7 days"/);
  assert.match(sidebar, /case thirtyDays = "30 days"/);
  assert.match(sidebar, /calendar\.startOfDay\(for: now\)/);
  assert.match(sidebar, /calendar\.date\(byAdding: \.day, value: -days/);
  assert.match(sidebar, /return date >= start && date <= now/);
  assert.match(sidebar, /model\.historyTimeFilter\.includes\(\$0\.visitedAt\)/);
  assert.doesNotMatch(sidebar, /timeIntervalSince\(now\).*86400/);
});

test("history clear actions honor the selected period and persist in profile JSON", () => {
  const store = read("poc-native/Sources/BrowserLibraryStore.swift");
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  assert.match(store, /func clearHistory\(since startDate: Date/);
  assert.match(store, /history\.removeAll \{ \$0\.visitedAt >= startDate \}/);
  assert.match(sidebar, /BrowserLibraryStore\.shared\.clearHistory\(since: start\)/);
  assert.match(sidebar, /model\.historyTimeFilter\.startDate\(\)/);
  assert.match(store, /BrowserProfile\.current\.fileURL\("browser-library\.json"\)/);
  assert.match(store, /try data\.write\(to: fileURL, options: \.atomic\)/);
  assert.match(store, /guard !isPrivate/);
});

test("individual entries and exact URLs can be removed; site clearing matches host boundaries", () => {
  const store = read("poc-native/Sources/BrowserLibraryStore.swift");
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  assert.match(store, /func removeHistoryEntry\(id: UUID\)/);
  assert.match(store, /history\.removeAll \{ \$0\.id == id \}/);
  assert.match(store, /func removeHistoryURL\(_ url: String\)/);
  assert.match(store, /history\.removeAll \{ \$0\.url == url \}/);
  assert.match(store, /func clearHistory\(forSite site: String\)/);
  assert.match(store, /host == normalizedSite \|\| host\.hasSuffix\("\." \+ normalizedSite\)/);
  assert.match(sidebar, /Remove from History/);
  assert.ok(sidebar.includes("Clear History for \\(host)"));
  assert.match(sidebar, /BrowserLibraryStore\.shared\.clearHistory\(forSite: host\)/);
  assert.doesNotMatch(sidebar, /WKWebsiteDataStore/);
  assert.doesNotMatch(store, /WKWebsiteDataStore/);
});
