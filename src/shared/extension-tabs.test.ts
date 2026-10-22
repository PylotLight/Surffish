import assert from "node:assert/strict";
import test from "node:test";
import {
  canSeeTabDetails,
  filterTabsForQuery,
  isAllowedExtensionTabUrl,
  matchesChromePattern,
  planExtensionTabReveal,
  toChromeTab,
  type ExtensionTabRecord,
} from "./extension-tabs.ts";

const tabs: ExtensionTabRecord[] = [
  {
    id: 5,
    index: 0,
    active: true,
    pinned: false,
    url: "https://news.ycombinator.com/news",
    title: "Hacker News",
    faviconUrl: null,
    loading: false,
    sleeping: false,
  },
  {
    id: 6,
    index: 1,
    active: false,
    pinned: true,
    url: "https://example.com/a?b=1",
    title: "Example",
    faviconUrl: "https://example.com/favicon.ico",
    loading: true,
    sleeping: false,
  },
  {
    id: 1_000_000,
    index: 2,
    active: false,
    pinned: false,
    url: "https://github.com/",
    title: "GitHub",
    faviconUrl: null,
    loading: false,
    sleeping: true,
  },
];

test("Chrome match patterns", () => {
  assert.equal(
    matchesChromePattern(
      "*://news.ycombinator.com/*",
      "https://news.ycombinator.com/item?id=1",
    ),
    true,
  );
  assert.equal(
    matchesChromePattern(
      "*://news.ycombinator.com/*",
      "http://news.ycombinator.com/",
    ),
    true,
  );
  assert.equal(
    matchesChromePattern(
      "*://news.ycombinator.com/*",
      "https://evil.com/news.ycombinator.com",
    ),
    false,
  );
  assert.equal(
    matchesChromePattern(
      "https://*.example.com/*",
      "https://a.b.example.com/x",
    ),
    true,
  );
  assert.equal(
    matchesChromePattern("https://*.example.com/*", "https://example.com/"),
    true,
  );
  assert.equal(
    matchesChromePattern("https://*.example.com/*", "https://notexample.com/"),
    false,
  );
  assert.equal(matchesChromePattern("<all_urls>", "https://x.test/"), true);
  assert.equal(
    matchesChromePattern("<all_urls>", "chrome-extension://abc/popup.html"),
    false,
  );
  assert.equal(
    matchesChromePattern("https://example.com/a*", "https://example.com/a?b=1"),
    true,
  );
});

test("tabs.query filters on active/pinned/url/status/title", () => {
  assert.deepEqual(
    filterTabsForQuery(tabs, { active: true, currentWindow: true }).map(
      (tab) => tab.id,
    ),
    [5],
  );
  assert.deepEqual(
    filterTabsForQuery(tabs, { pinned: true }).map((tab) => tab.id),
    [6],
  );
  assert.deepEqual(
    filterTabsForQuery(tabs, {
      url: ["*://news.ycombinator.com/*", "*://github.com/*"],
    }).map((tab) => tab.id),
    [5, 1_000_000],
  );
  assert.deepEqual(
    filterTabsForQuery(tabs, { status: "loading" }).map((tab) => tab.id),
    [6],
  );
  assert.deepEqual(
    filterTabsForQuery(tabs, { discarded: true }).map((tab) => tab.id),
    [1_000_000],
  );
  assert.deepEqual(
    filterTabsForQuery(tabs, { title: "hacker*" }).map((tab) => tab.id),
    [5],
  );
  assert.deepEqual(filterTabsForQuery(tabs, { windowId: 2 }), []);
  assert.equal(filterTabsForQuery(tabs, null).length, 3);
});

test("tabs.query currentWindow / lastFocusedWindow narrow to the window the user last used", () => {
  // Two Surffish windows, each with an active tab: { active, currentWindow } must be one tab.
  const twoWindows: ExtensionTabRecord[] = [
    { ...tabs[0]!, currentWindow: false },
    { ...tabs[1]!, active: true, currentWindow: true },
    { ...tabs[2]!, currentWindow: true },
  ];
  assert.deepEqual(
    filterTabsForQuery(twoWindows, { active: true, currentWindow: true }).map(
      (tab) => tab.id,
    ),
    [6],
  );
  assert.deepEqual(
    filterTabsForQuery(twoWindows, {
      active: true,
      lastFocusedWindow: true,
    }).map((tab) => tab.id),
    [6],
  );
  assert.deepEqual(
    filterTabsForQuery(twoWindows, { currentWindow: false }).map(
      (tab) => tab.id,
    ),
    [5],
  );
  assert.deepEqual(
    filterTabsForQuery(twoWindows, { active: true }).map((tab) => tab.id),
    [5, 6],
  );
  // When the current window is unknown the key is ignored rather than hiding every tab.
  assert.deepEqual(
    filterTabsForQuery(tabs, { active: true, currentWindow: true }).map(
      (tab) => tab.id,
    ),
    [5],
  );
});

test("url/title are exposed only with tabs, activeTab on the active tab, or host access", () => {
  const mhn = {
    permissions: ["activeTab", "storage"],
    hostPermissions: ["*://news.ycombinator.com/*"],
  };
  assert.equal(canSeeTabDetails(mhn, tabs[0]!), true);
  assert.equal(canSeeTabDetails(mhn, tabs[1]!), false);
  assert.equal(
    canSeeTabDetails({ permissions: ["tabs"], hostPermissions: [] }, tabs[1]!),
    true,
  );
  assert.equal(
    canSeeTabDetails({ permissions: [], hostPermissions: [] }, tabs[0]!),
    false,
  );
  const hidden = toChromeTab(tabs[1]!, mhn);
  assert.equal(hidden.url, undefined);
  assert.equal(hidden.status, "loading");
  const shown = toChromeTab(tabs[0]!, mhn);
  assert.equal(shown.url, "https://news.ycombinator.com/news");
  assert.equal(shown.windowId, 1);
  assert.equal(
    toChromeTab(tabs[2]!, { permissions: ["tabs"], hostPermissions: [] })
      .status,
    "unloaded",
  );
});

test("extensions may open web pages and their own pages only", () => {
  const id = "dabkegjlekdcmefifaolmdhnhdcplklo";
  assert.equal(
    isAllowedExtensionTabUrl("https://news.ycombinator.com/news", id),
    true,
  );
  assert.equal(
    isAllowedExtensionTabUrl(`chrome-extension://${id}/options.html`, id),
    true,
  );
  assert.equal(
    isAllowedExtensionTabUrl(
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/x.html",
      id,
    ),
    false,
  );
  assert.equal(isAllowedExtensionTabUrl("file:///etc/passwd", id), false);
  assert.equal(isAllowedExtensionTabUrl("javascript:alert(1)", id), false);
  assert.equal(
    isAllowedExtensionTabUrl("https://user:pw@example.com/", id),
    false,
  );
  assert.equal(isAllowedExtensionTabUrl(undefined, id), false);
});

test("bringing an extension tab forward closes covering panels and raises its window", () => {
  assert.deepEqual(
    planExtensionTabReveal({
      sidebarMode: "tabs",
      minimized: false,
      visible: true,
    }),
    { closePanel: false, restore: false, show: false, focus: true },
  );
  for (const mode of [
    "settings",
    "integrations",
    "downloads",
    "bookmarks",
    "history",
    "feeds",
  ]) {
    assert.equal(
      planExtensionTabReveal({
        sidebarMode: mode,
        minimized: false,
        visible: true,
      }).closePanel,
      true,
      mode,
    );
  }
  assert.deepEqual(
    planExtensionTabReveal({
      sidebarMode: "tabs",
      minimized: true,
      visible: true,
    }),
    { closePanel: false, restore: true, show: true, focus: true },
  );
  assert.deepEqual(
    planExtensionTabReveal({
      sidebarMode: "tabs",
      minimized: false,
      visible: false,
    }),
    { closePanel: false, restore: false, show: true, focus: true },
  );
});
