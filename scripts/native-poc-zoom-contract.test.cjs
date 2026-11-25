const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
test("per-origin zoom is profile-persisted and private-session scoped", () => {
  const store = read("poc-native/Sources/BrowserPageZoomStore.swift");
  assert.match(store, /browser-site-zoom\.json/);
  assert.match(store, /BrowserProfile\.current\.applicationSupportDirectory/);
  assert.match(store, /privateZooms: \[String: Double\] = \[:\]/);
  assert.match(store, /scheme == "http" \|\| scheme == "https"/);
  assert.match(store, /privateZooms\[origin\] = next/);
  assert.match(store, /savedZooms\[origin\] = next/);
  assert.match(store, /try data\.write\(to: fileURL, options: \.atomic\)/);
});
test("tabs apply each origin zoom on setup and committed navigation with menu controls", () => {
  const tabs = read("poc-native/Sources/TabManager.swift");
  const menu = read("poc-native/Sources/MainMenu.swift");
  assert.match(tabs, /webView\.pageZoom = BrowserPageZoomStore\.shared\.zoom/);
  assert.match(tabs, /didFinish navigation[\s\S]*?applyPageZoom\(to: tab\)/);
  assert.match(tabs, /menuZoomIn\(\)/);
  assert.match(tabs, /menuZoomOut\(\)/);
  assert.match(tabs, /menuZoomReset\(\)/);
  assert.match(menu, /Zoom In/);
  assert.match(menu, /Zoom Out/);
  assert.match(menu, /Reset Zoom/);
  assert.match(menu, /zoomIn\.target = TabManager\.shared/);
});
test("omnibox exposes reset indicator and settings can reset all saved zoom", () => {
  const omnibox = read("poc-native/Sources/OmniboxView.swift");
  const settings = read("poc-native/Sources/BrowserSettingsView.swift");
  assert.match(omnibox, /zoomButton\.title = "\\\(Int\(\(zoom \* 100\)/);
  assert.match(omnibox, /onResetZoom/);
  assert.match(omnibox, /Page zoom — click to reset to 100%/);
  assert.match(settings, /func resetAllPageZoom\(\)/);
  assert.match(settings, /BrowserPageZoomStore\.shared\.clearAll\(\)/);
  assert.match(settings, /Reset all saved page zoom/);
});
