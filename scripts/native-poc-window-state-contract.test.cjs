const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const store = read("poc-native/Sources/BrowserWindowStateStore.swift");
const controller = read("poc-native/Sources/MainWindowController.swift");
const app = read("poc-native/Sources/main.swift");

test("window state is versioned and isolated in the active profile", () => {
  assert.match(
    store,
    /BrowserProfile\.current\.fileURL\("browser-window-state\.json"\)/,
  );
  assert.match(
    store,
    /public struct SavedBrowserWindowState: Codable, Equatable/,
  );
  assert.match(store, /version == 1/);
  assert.match(store, /state\.frame\.isValid/);
  assert.doesNotMatch(store, /BrowserSessionStore/);
  assert.doesNotMatch(store, /fullScreen/);
});

test("saved geometry is validated, fitted to a live display, and falls back safely", () => {
  assert.match(store, /allSatisfy\(\\\.isFinite\)/);
  assert.match(store, /width > 0/);
  assert.match(store, /height > 0/);
  assert.match(store, /screen\.visibleFrame/);
  assert.match(store, /NSIntersectionRect\(candidate, visibleFrame\)/);
  assert.match(store, /minimumVisibleArea/);
  assert.match(store, /visibleFrame\.maxX - width/);
  assert.match(store, /visibleFrame\.maxY - height/);
  assert.match(store, /safeFallback/);
});

test("main browser restores its frame before showing and its zoom state after showing", () => {
  assert.match(
    controller,
    /BrowserWindowStateStore\.shared\.restoration\(fallbackFrame: defaultFrame\)/,
  );
  assert.match(controller, /public func restoreSavedWindowState\(\)/);
  assert.match(controller, /window\.zoom\(nil\)/);
  assert.match(
    app,
    /wc\.showWindow\(nil\)[\s\S]*?wc\.restoreSavedWindowState\(\)/,
  );
});

test("move and resize persistence is debounced and avoids saving fullscreen frames", () => {
  assert.match(
    controller,
    /func windowDidMove\(_ notification: Notification\)/,
  );
  assert.match(
    controller,
    /func windowDidResize\(_ notification: Notification\)/,
  );
  assert.match(
    controller,
    /func windowDidEndLiveResize\(_ notification: Notification\)/,
  );
  assert.match(controller, /DispatchQueue\.main\.asyncAfter/);
  assert.match(controller, /window\.styleMask\.contains\(\.fullScreen\)/);
  assert.match(
    controller,
    /func windowShouldZoom\(_ window: NSWindow, toFrame newFrame: NSRect\) -> Bool/,
  );
  assert.match(
    controller,
    /if window\.isZoomed \{\s*frame = lastNormalWindowFrame \?\? window\.frame/,
  );
  assert.match(
    controller,
    /BrowserWindowStateStore\.shared\.save\(frame: frame, isZoomed: window\.isZoomed\)/,
  );
  assert.match(app, /windowController\?\.persistWindowState\(\)/);
});

test("screen validation follows the Electron reference's useful-visible-area policy", () => {
  const electron = require("child_process").execFileSync(
    "git",
    ["show", "origin/main:src/shared/window-geometry.ts"],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(electron, /fitBoundsToDisplays/);
  assert.match(electron, /at least the title bar region/);
  assert.match(electron, /Math\.min\(bounds\.width, 120\)/);
  assert.match(store, /min\(candidate\.width, 120\)/);
  assert.match(store, /min\(candidate\.height, 40\)/);
});

console.log("native window-state source contract: passed");
