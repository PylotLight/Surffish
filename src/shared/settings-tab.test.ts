import assert from "node:assert/strict";
import test from "node:test";
import {
  siteSettingsHaveOverrides,
  isSettingsUrl,
  normalizeSettingsTarget,
  parseSettingsUrl,
  settingsSiteOrigin,
  settingsSitesList,
  settingsTabInsertIndex,
  settingsUrl,
  SURFFISH_SETTINGS_URL,
} from "./settings-tab.ts";

test("recognises the settings address only", () => {
  assert.equal(isSettingsUrl(SURFFISH_SETTINGS_URL), true);
  assert.equal(isSettingsUrl("surffish://settings/"), true);
  assert.equal(isSettingsUrl("surffish://settings#privacy"), true);
  assert.equal(isSettingsUrl("surffish://settings?section=sites"), true);
  assert.equal(isSettingsUrl("SURFFISH://Settings"), true);
  assert.equal(isSettingsUrl("surffish://settingsx"), false);
  assert.equal(isSettingsUrl("surffish://quick-links"), false);
  assert.equal(isSettingsUrl("https://example.com/surffish://settings"), false);
  assert.equal(isSettingsUrl(undefined), false);
});

test("parses sections from ?section=, the path or the fragment", () => {
  assert.deepEqual(parseSettingsUrl(SURFFISH_SETTINGS_URL), {
    section: "settings",
  });
  assert.deepEqual(parseSettingsUrl("surffish://settings#privacy"), {
    section: "privacy",
  });
  assert.deepEqual(parseSettingsUrl("surffish://settings/newtab"), {
    section: "newtab",
  });
  assert.deepEqual(parseSettingsUrl("surffish://settings?section=general"), {
    section: "settings",
  });
  assert.deepEqual(parseSettingsUrl("surffish://settings?section=extensions"), {
    section: "integrations",
  });
  assert.deepEqual(parseSettingsUrl("surffish://settings?section=nope"), {
    section: "settings",
  });
  assert.equal(parseSettingsUrl("https://example.com"), null);
});

test("site deep links keep an http(s) origin and drop anything else", () => {
  assert.deepEqual(
    parseSettingsUrl(
      "surffish://settings?section=sites&host=https://example.com/path?q=1",
    ),
    { section: "site", host: "https://example.com" },
  );
  assert.deepEqual(
    parseSettingsUrl("surffish://settings?section=sites&host=example.com"),
    { section: "site", host: "https://example.com" },
  );
  assert.deepEqual(
    parseSettingsUrl(
      "surffish://settings?section=sites&host=javascript:alert(1)",
    ),
    { section: "site" },
  );
  assert.deepEqual(
    parseSettingsUrl(
      "surffish://settings?section=sites&host=file:///etc/passwd",
    ),
    { section: "site" },
  );
  // A host is only for Sites.
  assert.deepEqual(
    parseSettingsUrl(
      "surffish://settings?section=privacy&host=https://example.com",
    ),
    { section: "privacy" },
  );
  assert.equal(
    settingsSiteOrigin("http://127.0.0.1:8080/x"),
    "http://127.0.0.1:8080",
  );
  assert.equal(settingsSiteOrigin("chrome-extension://abc/"), null);
  assert.equal(settingsSiteOrigin(""), null);
});

test("general can name a category to scroll to", () => {
  assert.deepEqual(
    parseSettingsUrl("surffish://settings?section=general&focus=mini-window"),
    { section: "settings", focus: "mini-window" },
  );
  assert.deepEqual(
    normalizeSettingsTarget({ section: "settings", focus: "<img>" }),
    { section: "settings" },
  );
});

test("builds addresses that parse back to the same target", () => {
  for (const target of [
    { section: "settings" as const },
    { section: "privacy" as const },
    { section: "site" as const, host: "https://example.com" },
    { section: "settings" as const, focus: "mini-window" },
    { section: "feeds" as const },
    { section: "languages" as const },
    { section: "readaloud" as const },
  ]) {
    assert.deepEqual(parseSettingsUrl(settingsUrl(target)), target);
  }
  assert.equal(settingsUrl(), SURFFISH_SETTINGS_URL);
  assert.equal(
    settingsUrl({ section: "readaloud" }),
    "surffish://settings?section=read-aloud",
  );
  assert.deepEqual(parseSettingsUrl("surffish://settings#read-aloud"), {
    section: "readaloud",
  });
  assert.equal(
    settingsUrl({ section: "site", host: "https://example.com" }),
    "surffish://settings?section=sites&host=https%3A%2F%2Fexample.com",
  );
});

test("normalizes untrusted targets (IPC input)", () => {
  assert.deepEqual(normalizeSettingsTarget(null), { section: "settings" });
  assert.deepEqual(normalizeSettingsTarget({ section: "bogus" }), {
    section: "settings",
  });
  assert.deepEqual(
    normalizeSettingsTarget({ section: "sites", host: "https://a.test" }),
    { section: "site", host: "https://a.test" },
  );
  assert.deepEqual(normalizeSettingsTarget({ section: "site", host: 42 }), {
    section: "site",
  });
});

test("a new Settings tab goes right after the active tab", () => {
  assert.equal(settingsTabInsertIndex(["a", "b", "c"], "a"), 1);
  assert.equal(settingsTabInsertIndex(["a", "b", "c"], "c"), 3);
  assert.equal(settingsTabInsertIndex(["a", "b"], null), 2);
  assert.equal(settingsTabInsertIndex([], "x"), 0);
});

test("sites list: deep-linked site first, then newest overrides first, no duplicates", () => {
  assert.deepEqual(
    settingsSitesList(["https://old.test", "https://new.test"]),
    ["https://new.test", "https://old.test"],
  );
  assert.deepEqual(
    settingsSitesList(
      ["https://old.test", "https://new.test"],
      "https://old.test",
    ),
    ["https://old.test", "https://new.test"],
  );
  assert.deepEqual(settingsSitesList([], "https://fresh.test/page"), [
    "https://fresh.test",
  ]);
  assert.deepEqual(
    settingsSitesList(["not a url", "https://a.test"], "javascript:alert(1)"),
    ["https://a.test"],
  );
});

test("a site counts as overridden only when a switch differs from its default", () => {
  assert.equal(
    siteSettingsHaveOverrides({ blockAds: true, allowMedia: false }),
    false,
  );
  assert.equal(siteSettingsHaveOverrides({ blockAds: false }), true);
  assert.equal(siteSettingsHaveOverrides({ allowClipboardRead: true }), true);
  assert.equal(siteSettingsHaveOverrides({}), false);
});

test("translation deep links open Languages, not General", () => {
  assert.deepEqual(
    parseSettingsUrl("surffish://settings?section=translation"),
    { section: "languages" },
  );
  assert.deepEqual(normalizeSettingsTarget({ section: "languages" }), {
    section: "languages",
  });
});
