const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("native sidebar has one collapse affordance in the toolbar", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const toolbar = read("poc-native/Sources/OmniboxView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");

  assert.doesNotMatch(
    sidebar,
    /collapseButton|sidebarDidToggleSidebar|onCollapse/,
  );
  assert.equal(
    (toolbar.match(/sidebarToggleBtn\s*=\s*NSButton/g) || []).length,
    1,
  );
  assert.match(toolbar, /omniboxDidShowTabs/);
  assert.match(window, /sidebarView\.showTabs\(\)/);
  assert.match(sidebar, /reloadPinnedTabs\(\)/);
  assert.match(
    window,
    /sidebarView\.topAnchor\.constraint\(equalTo: omniboxView\.bottomAnchor\)/,
  );
  assert.match(
    window,
    /contentView\.addSubview\(omniboxView, positioned: \.above, relativeTo: sidebarView\)/,
  );
});

test("native sidebar exposes real History and Bookmarks panels", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const library = read("poc-native/Sources/BrowserLibraryStore.swift");
  const tabs = read("poc-native/Sources/TabManager.swift");

  assert.match(sidebar, /func showHistory\(\)/);
  assert.match(sidebar, /func showBookmarks\(\)/);
  assert.match(
    library,
    /BrowserProfile\.current\.fileURL\("browser-library\.json"\)/,
  );
  assert.match(library, /guard !isPrivate/);
  assert.match(tabs, /BrowserLibraryStore\.shared\.recordVisit/);
});

test("settings pages expose saved ad blocking and profile-scoped website clearing", () => {
  const settings = read(
    "poc-native/Sources/BrowserSettingsWindowController.swift",
  );
  const model = read("poc-native/Sources/BrowserSettingsStore.swift");
  const blocker = read("poc-native/Sources/AdBlockManager.swift");

  for (const page of [
    "General",
    "Privacy",
    "Extensions",
    "Connection",
    "About",
  ]) {
    assert.ok(settings.includes(`"${page}"`), `missing ${page} settings page`);
  }
  assert.match(model, /adBlockingEnabled/);
  assert.match(
    settings,
    /AdBlockManager\.shared\.setEnabled\(next\.adBlockingEnabled\)/,
  );
  assert.match(
    settings,
    /WKWebsiteDataStore\(forIdentifier: BrowserProfile\.current\.websiteDataStoreIdentifier\)/,
  );
  assert.match(
    blocker,
    /BrowserSettingsStore\.shared\.settings\.adBlockingEnabled/,
  );
});

test("roadmap describes the implemented SSH dynamic SOCKS endpoint, not the obsolete NAS forward", () => {
  const roadmap = read("docs/native-webkit-mvp-roadmap.md");
  const readme = read("poc-native/README.md");

  assert.match(readme, /OpenSSH dynamic forwarding/);
  const acceptance = roadmap.slice(
    roadmap.indexOf("## MVP acceptance criteria"),
  );
  assert.match(acceptance, /ssh -D/);
  assert.match(acceptance, /local dynamic SOCKS5 listen port/);
  assert.doesNotMatch(acceptance, /existing SOCKS5 host\/port/);
  assert.doesNotMatch(roadmap, /SSH `-L`/);
  assert.doesNotMatch(roadmap, /^\s*- Verify the NAS SOCKS host\/port/m);
  assert.match(roadmap, /Obsolete roadmap assumptions/);
});
