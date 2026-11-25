const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../poc-native/Sources/TabManager.swift"),
  "utf8",
);
const between = (start, end) =>
  source.slice(
    source.indexOf(start),
    source.indexOf(end, source.indexOf(start)),
  );

const createTab = between(
  "public func createTab(",
  "public func restoreSession()",
);
const restore = between(
  "public func restoreSession()",
  "public func selectTab(id: UUID)",
);
const select = between(
  "public func selectTab(id: UUID)",
  "public func closeTab(id: UUID)",
);
const close = between(
  "public func closeTab(id: UUID)",
  "public var canReopenClosedTab",
);

assert.match(
  createTab,
  /deferNavigation: Bool = false/,
  "normal createTab calls load immediately by default",
);
assert.match(
  createTab,
  /if deferNavigation \{ deferredRestoredTabIDs\.insert\(id\) \}\s*else \{ webView\.load\(URLRequest\(url: targetURL\)\) \}/,
);
assert.match(
  restore,
  /deferNavigation: true/,
  "restored tabs are created as shells",
);
assert.ok(
  restore.indexOf("activeTabId = restoredID") <
    restore.indexOf("deferredRestoredTabIDs.remove(activeID)"),
  "active saved ID is restored before active navigation starts",
);
assert.match(
  restore,
  /deferredRestoredTabIDs\.remove\(activeID\)[\s\S]*?active\.webView\.load\(/,
  "only the active restored tab starts navigation during restore",
);
assert.match(
  select,
  /deferredRestoredTabIDs\.remove\(id\)[\s\S]*?tab\.webView\.load\(/,
  "selecting a deferred tab consumes its pending load before loading",
);
assert.match(
  close,
  /deferredRestoredTabIDs\.remove\(id\)/,
  "closing a deferred tab clears pending state",
);
assert.match(
  source,
  /restoredSessionTabIDs\.remove\(tab\.id\)/,
  "restore-navigation history suppression remains one-shot",
);
assert.match(
  source,
  /tabs\.filter \{ \!\$0\.isPrivate \}/,
  "private tabs remain excluded from persistence",
);
assert.match(
  source,
  /isPinned: savedTab\.isPinned[\s\S]*?groupID: savedTab\.groupID[\s\S]*?spaceID: savedTab\.spaceID/,
  "saved pin/group/space metadata is preserved",
);
console.log("native lazy-restore source contract: passed");
