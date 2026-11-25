const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("clock preferences migrate missing fields to stable defaults and persist as profile settings", () => {
  const store = read("poc-native/Sources/BrowserSettingsStore.swift");
  assert.match(store, /public enum NewTabClockSize: String, CaseIterable, Codable/);
  assert.match(store, /newTabUses24HourClock: Bool/);
  assert.match(store, /newTabShowsDate: Bool/);
  assert.match(store, /newTabClockSize: NewTabClockSize/);
  assert.match(store, /decodeIfPresent\(Bool\.self, forKey: \.newTabUses24HourClock\) \?\? false/);
  assert.match(store, /decodeIfPresent\(Bool\.self, forKey: \.newTabShowsDate\) \?\? true/);
  assert.match(store, /decodeIfPresent\(NewTabClockSize\.self, forKey: \.newTabClockSize\) \?\? \.regular/);
  assert.match(store, /newTabUses24HourClock: false/);
  assert.match(store, /newTabShowsDate: true/);
  assert.match(store, /newTabClockSize: \.regular/);
  assert.match(store, /BrowserProfile\.current\.fileURL\("browser-settings\.json"\)/);
});

test("Appearance controls are searchable and saved through the existing apply flow", () => {
  const view = read("poc-native/Sources/BrowserSettingsView.swift");
  assert.match(view, /public var newTabUses24HourClock: Bool/);
  assert.match(view, /public var newTabShowsDate: Bool/);
  assert.match(view, /public var newTabClockSize: NewTabClockSize/);
  assert.match(view, /title: "New Tab clock"/);
  assert.match(view, /terms: "clock time 12 24 hour date size appearance new tab"/);
  assert.match(view, /Picker\("Clock format", selection: \$model\.newTabUses24HourClock\)/);
  assert.match(view, /Toggle\("Show date", isOn: \$model\.newTabShowsDate\)/);
  assert.match(view, /Picker\("Clock size", selection: \$model\.newTabClockSize\)/);
  assert.match(view, /next\.newTabUses24HourClock = newTabUses24HourClock/);
  assert.match(view, /next\.newTabShowsDate = newTabShowsDate/);
  assert.match(view, /next\.newTabClockSize = newTabClockSize/);
  assert.match(view, /BrowserSettingsStore\.shared\.update\(next\)/);
  assert.match(view, /onSettingsSaved\?\(next\)/);
});

test("New Tab renders selected clock size, hour cycle, and date visibility", () => {
  const page = read("poc-native/Sources/BrowserNewTabSchemeHandler.swift");
  assert.match(page, /settings\.newTabClockSize/);
  assert.match(page, /clock-compact/);
  assert.match(page, /clock-regular/);
  assert.match(page, /clock-large/);
  assert.match(page, /JSONSerialization\.data\(withJSONObject: clockConfig/);
  assert.match(page, /const clockConfig = \\\(clockConfigJSON\);/);
  assert.match(page, /hourCycle: clockConfig\.uses24Hour \? 'h23' : 'h12'/);
  assert.match(page, /date\.hidden = !clockConfig\.showsDate/);
  assert.match(page, /if \(clockConfig\.showsDate\)/);
});
