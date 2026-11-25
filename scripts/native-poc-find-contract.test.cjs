const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("native find reports an explicitly approximate count separately from WebKit navigation", () => {
  const window = read("poc-native/Sources/MainWindowController.swift");
  const bar = read("poc-native/Sources/FindBarView.swift");
  assert.match(
    window,
    /tab\.webView\.find\(query, configuration: configuration\)/,
  );
  assert.match(window, /evaluateJavaScript\(countScript\)/);
  assert.match(window, /document\.createTreeWalker/);
  assert.match(window, /matches\*/);
  assert.match(window, /Match count unavailable/);
  assert.match(window, /findRequestID == requestID/);
  assert.match(window, /activeTab\?\.webView === searchedWebView/);
  assert.match(bar, /Approximate text-node count/);
  assert.match(bar, /Approximate find result count/);
  assert.doesNotMatch(window, /activeMatchOrdinal/);
});

test("native count deliberately avoids claiming exact Electron active ordinal parity", () => {
  const electronTypes = require("child_process").execFileSync(
    "git",
    ["show", "origin/main:src/shared/types.ts"],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(electronTypes, /activeMatchOrdinal: number/);
  const window = read("poc-native/Sources/MainWindowController.swift");
  assert.match(window, /WKWebView\.find reports only matchFound/);
  assert.match(window, /approximate total/);
  assert.doesNotMatch(window, /activeMatchOrdinal\s*=/);
});
