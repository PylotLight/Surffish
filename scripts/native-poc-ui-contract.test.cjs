const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("native sidebar has one collapse affordance and a persistent SwiftUI compact rail", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const toolbar = read("poc-native/Sources/OmniboxView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  const shell = read("poc-native/Sources/BrowserShellView.swift");

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
  assert.match(sidebar, /pinnedClusterButton/);
  assert.doesNotMatch(sidebar, /railButton\("Settings"/);
  assert.match(sidebar, /footerButton\("Settings"/);
  assert.match(sidebar, /matchedGeometryEffect/);
  assert.match(sidebar, /onFocusChange/);
  assert.match(window, /sidebarFocusChanged/);
  assert.match(window, /Task\.sleep\(for: \.milliseconds\(180\)\)/);
  assert.match(window, /shellLayoutModel\.sidebarWidth/);
  assert.match(shell, /Color\.clear\.frame\(width: layout\.sidebarWidth\)/);
  assert.match(shell, /HostedAppKitView\(view: pageCard\)/);
  assert.doesNotMatch(window, /sidebarWidthConstraint/);
});

test("native sidebar exposes real History, Bookmarks, and Reading List panels", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const library = read("poc-native/Sources/BrowserLibraryStore.swift");
  const tabs = read("poc-native/Sources/TabManager.swift");

  assert.match(sidebar, /func showHistory\(\)/);
  assert.match(sidebar, /func showBookmarks\(\)/);
  assert.match(sidebar, /func showReadingList\(\)/);
  assert.match(
    library,
    /BrowserProfile\.current\.fileURL\("browser-library\.json"\)/,
  );
  assert.match(library, /guard !isPrivate/);
  assert.match(tabs, /BrowserLibraryStore\.shared\.recordVisit/);
});

test("SwiftUI settings preserve real ad blocking, website clearing, SSH, extensions, and New Tab controls", () => {
  const settings = read("poc-native/Sources/BrowserSettingsView.swift");
  const model = read("poc-native/Sources/BrowserSettingsStore.swift");
  const blocker = read("poc-native/Sources/AdBlockManager.swift");

  for (const page of [
    "General",
    "Privacy",
    "Extensions",
    "Connection",
    "About",
  ]) {
    assert.ok(
      settings.includes(`= \"${page}\"`),
      `missing ${page} settings page`,
    );
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
  assert.match(settings, /WebExtensionManager\.shared\.uninstallExtension/);
  assert.match(settings, /SshConfigHostDiscovery\.discover\(\)/);
  assert.match(settings, /model\.newTabTheme/);
  assert.match(settings, /model\.newTabSiteSource/);
  assert.match(model, /newTabTheme/);
  assert.match(model, /newTabSiteSource/);
  assert.match(
    blocker,
    /BrowserSettingsStore\.shared\.settings\.adBlockingEnabled/,
  );
});

test("built-in New Tab uses profile settings and hides recent history in private tabs", () => {
  const page = read("poc-native/Sources/BrowserNewTabSchemeHandler.swift");
  const settings = read("poc-native/Sources/BrowserSettingsStore.swift");
  const tabs = read("poc-native/Sources/TabManager.swift");

  assert.match(settings, /startPage: "surffish:\/\/newtab\/"/);
  assert.match(settings, /scheme == "surffish" && url\.host == "newtab"/);
  assert.match(settings, /legacyExternalStartPage/);
  assert.match(
    settings,
    /migrated\.startPage = BrowserSettings\.defaults\.startPage/,
  );
  assert.match(
    tabs,
    /setURLSchemeHandler\(BrowserNewTabSchemeHandler\.shared, forURLScheme: "surffish"\)/,
  );
  assert.match(page, /includeHistory: !isPrivateTab/);
  assert.match(page, /let recent = includeHistory \? recentHistory/);
  assert.match(page, /let settings = BrowserSettingsStore\.shared\.settings/);
  assert.match(page, /settings\.searchEngine/);
  assert.match(page, /settings\.newTabTheme\.backgroundCSS/);
  assert.match(page, /switch settings\.newTabSiteSource/);
  assert.match(page, /searchURL\(for: marker\)/);
});

test("pinned bookmarks migrate safely and share an animated compact-rail cluster", () => {
  const library = read("poc-native/Sources/BrowserLibraryStore.swift");
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");

  assert.match(
    library,
    /decodeIfPresent\(Bool\.self, forKey: \.isPinned\) \?\? false/,
  );
  assert.match(library, /togglePinnedBookmark\(id: UUID\)/);
  assert.match(sidebar, /bookmarks\.filter\(\\\.isPinned\)/);
  assert.match(sidebar, /pinnedSites/);
  assert.match(sidebar, /pinned-cluster/);
  assert.match(sidebar, /Pin to Pinned Sites/);
  assert.match(window, /sidebarDidToggleBookmarkPin/);
});

test("reading list is profile-local, private-safe, and wired through toolbar, panel, and menu", () => {
  const library = read("poc-native/Sources/BrowserLibraryStore.swift");
  const toolbar = read("poc-native/Sources/OmniboxView.swift");
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  const menu = read("poc-native/Sources/MainMenu.swift");

  assert.match(library, /readingList: \[BrowserReadingListEntry\]/);
  assert.match(library, /toggleReadingList\(url: URL, title: String\)/);
  assert.match(library, /setReadingListRead\(id: UUID, isRead: Bool\)/);
  assert.match(library, /removeReadingListEntry\(id: UUID\)/);
  assert.match(toolbar, /!tab\.isPrivate/);
  assert.match(toolbar, /omniboxDidToggleReadingList/);
  assert.match(window, /!tab\.isPrivate/);
  assert.match(window, /sidebarDidOpenReadingListEntry/);
  assert.match(window, /sidebarDidToggleReadingListRead/);
  assert.match(window, /sidebarDidRemoveReadingListEntry/);
  assert.match(sidebar, /case readingList/);
  assert.match(sidebar, /Mark as Unread/);
  assert.match(menu, /menuShowReadingList/);
});

test("native find-in-page and duplicate/reopen actions are wired to WebKit and menus", () => {
  const findBar = read("poc-native/Sources/FindBarView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  const menu = read("poc-native/Sources/MainMenu.swift");
  const tabs = read("poc-native/Sources/TabManager.swift");
  const sidebar = read("poc-native/Sources/SidebarView.swift");

  assert.match(window, /WKFindConfiguration\(\)/);
  assert.match(window, /configuration\.caseSensitive = false/);
  assert.match(window, /configuration\.wraps = true/);
  assert.match(
    window,
    /tab\.webView\.find\(query, configuration: configuration\)/,
  );
  assert.match(findBar, /findPreviousOccurrence/);
  assert.match(findBar, /cancelOperation/);
  assert.match(menu, /menuFind/);
  assert.match(menu, /menuDuplicateActiveTab/);
  assert.match(menu, /menuReopenClosedTab/);
  assert.match(tabs, /func duplicateTab\(id: UUID\)/);
  assert.match(tabs, /func reopenClosedTab\(\)/);
  assert.match(tabs, /if !closingTab\.isPrivate/);
  assert.match(tabs, /isPrivate: tab\.isPrivate/);
  assert.match(sidebar, /Duplicate Tab/);
});

test("browser shell and settings are hosted in SwiftUI with AppKit/WebKit bridges", () => {
  const shell = read("poc-native/Sources/BrowserShellView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  const settingsWindow = read(
    "poc-native/Sources/BrowserSettingsWindowController.swift",
  );
  const build = read("scripts/build-native-poc.sh");

  assert.match(shell, /import SwiftUI/);
  assert.match(shell, /HostedAppKitView/);
  assert.match(window, /NSHostingView<BrowserShellView>/);
  assert.match(window, /WKWebExtensionWindow/);
  assert.match(settingsWindow, /NSHostingView\(rootView: BrowserSettingsView/);
  assert.match(build, /-framework SwiftUI/);
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

test("native sidebar filters all content modes and supports partition-safe tab drag reordering", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");

  assert.match(
    sidebar,
    /TextField\(searchPlaceholder, text: \$model\.searchText\)/,
  );
  assert.match(sidebar, /Clear search/);
  assert.match(sidebar, /No history matches/);
  assert.match(sidebar, /No bookmarks match/);
  assert.match(sidebar, /No reading-list items match/);
  assert.match(sidebar, /filteredTabs/);
  assert.match(sidebar, /filteredPinnedTabs/);
  assert.match(sidebar, /\.draggable\(tab\.id\.uuidString\)/);
  assert.match(sidebar, /\.dropDestination\(for: String\.self\)/);
  assert.match(sidebar, /moving\.isPinned == target\.isPinned/);
  assert.match(
    sidebar,
    /TabManager\.shared\.moveTab\(id: id, to: destination\)/,
  );
  assert.match(sidebar, /refresh\(\)\n        return true/);
});

test("native sidebar pin and resize preferences persist without a second collapse button", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const settings = read("poc-native/Sources/BrowserSettingsView.swift");
  const store = read("poc-native/Sources/BrowserSettingsStore.swift");
  const shell = read("poc-native/Sources/BrowserShellView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  const toolbar = read("poc-native/Sources/OmniboxView.swift");

  assert.match(sidebar, /sidebarDidTogglePinSidebar/);
  assert.match(sidebar, /Keep sidebar open/);
  assert.match(window, /isSidebarPinned = settings\.sidebarPinned/);
  assert.match(window, /isSidebarVisible \|\| isSidebarPinned/);
  assert.match(store, /sidebarPinned: Bool/);
  assert.match(store, /sidebarWidth: Int/);
  assert.match(store, /sidebarWidth = min\(max\(savedSidebarWidth/);
  assert.match(settings, /Keep the sidebar open when the pointer leaves/);
  assert.match(settings, /Slider\(/);
  assert.match(shell, /DragGesture\(minimumDistance: 3\)/);
  assert.match(shell, /onSidebarWidthCommitted/);
  assert.equal(
    (toolbar.match(/sidebarToggleBtn\s*=\s*NSButton/g) || []).length,
    1,
  );
});

test("native back and forward buttons expose each tab's WebKit history on right-click", () => {
  const toolbar = read("poc-native/Sources/OmniboxView.swift");

  assert.match(toolbar, /private final class NavigationHistoryButton/);
  assert.match(toolbar, /historyMenuProvider/);
  assert.match(toolbar, /backForwardList\.backList/);
  assert.match(toolbar, /backForwardList\.forwardList/);
  assert.match(toolbar, /historyItem\.title \?\? ""/);
  assert.match(toolbar, /webView\.go\(to: item\)/);
  assert.match(toolbar, /right-click for history/);
});

test("native Settings uses searchable section navigation without implying unsupported controls", () => {
  const settings = read("poc-native/Sources/BrowserSettingsView.swift");

  assert.match(settings, /case appearance = "Appearance"/);
  assert.match(
    settings,
    /TextField\("Search settings", text: \$settingsSearchQuery\)/,
  );
  assert.match(settings, /filteredSearchEntries/);
  assert.match(settings, /No supported settings match/);
  assert.match(settings, /case \.appearance: appearancePage/);
  assert.doesNotMatch(settings, /pickerStyle\(\.segmented\)/);
  assert.match(settings, /New Tab shortcuts/);
  assert.match(settings, /AdBlockManager\.shared\.setEnabled/);
  assert.match(settings, /WebExtensionManager\.shared\.uninstallExtension/);
});

test("custom New Tab shortcuts are validated, profile-persisted, rendered, and refreshed on apply", () => {
  const settings = read("poc-native/Sources/BrowserSettingsView.swift");
  const store = read("poc-native/Sources/BrowserSettingsStore.swift");
  const page = read("poc-native/Sources/BrowserNewTabSchemeHandler.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");

  assert.match(
    store,
    /struct BrowserNewTabQuickLink: Codable, Identifiable, Hashable/,
  );
  assert.match(store, /customQuickLinks: \[BrowserNewTabQuickLink\]/);
  assert.match(
    store,
    /decodeIfPresent\(\[BrowserNewTabQuickLink\]\.self, forKey: \.customQuickLinks\) \?\? \[\]/,
  );
  assert.match(store, /case custom/);
  assert.match(settings, /func addCustomQuickLink\(\)/);
  assert.match(settings, /\["http", "https"\]\.contains\(scheme\)/);
  assert.match(
    settings,
    /components\.user == nil, components\.password == nil/,
  );
  assert.match(settings, /customQuickLinks\.count < 12/);
  assert.match(settings, /func removeCustomQuickLink\(id: UUID\)/);
  assert.match(page, /case \.custom:/);
  assert.match(page, /settings\.customQuickLinks\.prefix\(12\)/);
  assert.match(page, /Add custom shortcuts in Settings/);
  assert.match(page, /includeHistory: !isPrivateTab/);
  assert.match(window, /tab\.webView\.reload\(\)/);
});

test("expanded sidebar content follows the live resizable shell width", () => {
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const shell = read("poc-native/Sources/BrowserShellView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");

  assert.match(sidebar, /var panelWidth: CGFloat = 280/);
  assert.match(sidebar, /func setPanelWidth\(_ width: CGFloat\)/);
  assert.match(sidebar, /expandedPanel\s*\.frame\(width: model\.panelWidth\)/);
  assert.doesNotMatch(sidebar, /private let panelWidth: CGFloat = 280/);
  assert.match(shell, /onSidebarWidthChanged/);
  assert.match(
    window,
    /sidebarView\.setPanelWidth\(shellLayoutModel\.sidebarWidth\)/,
  );
});

test("New Tab shortcuts can be reordered accessibly and the saved order is rendered", () => {
  const settings = read("poc-native/Sources/BrowserSettingsView.swift");
  const page = read("poc-native/Sources/BrowserNewTabSchemeHandler.swift");
  assert.match(
    settings,
    /func canMoveCustomQuickLink\(id: UUID, by offset: Int\)/,
  );
  assert.match(
    settings,
    /func moveCustomQuickLink\(id: UUID, by offset: Int\)/,
  );
  assert.match(settings, /customQuickLinks\.swapAt\(index, index \+ offset\)/);
  assert.ok(settings.includes(String.raw`Move \(link.title) up`));
  assert.ok(settings.includes(String.raw`Move \(link.title) down`));
  assert.match(page, /settings\.customQuickLinks\.prefix\(12\)/);
});

test("native downloads use WebKit, profile-local history, private exclusion, and supported actions", () => {
  const downloads = read("poc-native/Sources/BrowserDownloads.swift");
  const settings = read("poc-native/Sources/BrowserSettingsStore.swift");
  const settingsView = read("poc-native/Sources/BrowserSettingsView.swift");
  const tabs = read("poc-native/Sources/TabManager.swift");

  assert.match(
    downloads,
    /BrowserDownloadManager: NSObject, WKDownloadDelegate/,
  );
  assert.match(
    downloads,
    /BrowserProfile\.current\.fileURL\(Self\.historyFilename\)/,
  );
  assert.match(downloads, /let stored = entries\.filter \{ !\$0\.isPrivate \}/);
  assert.match(downloads, /func forgetFinishedPrivateDownloads\(\)/);
  assert.match(downloads, /resumeDownload\(fromResumeData:/);
  assert.match(downloads, /download\.cancel\(nil\)/);
  assert.match(downloads, /func canResume\(_ id: UUID\)/);
  assert.match(downloads, /safeFilename\(_ value: String\)/);
  assert.match(downloads, /safeSource\(_ url: URL\?\)/);
  assert.match(downloads, /defaultDownloadsDirectoryAfterFailure\(\)/);
  assert.match(downloads, /destinationWarning/);
  assert.match(
    downloads,
    /createDirectory\(at: configured, withIntermediateDirectories: true\)/,
  );
  assert.match(downloads, /activateFileViewerSelecting/);
  assert.match(downloads, /NSWorkspace\.shared\.open\(url\)/);
  assert.doesNotMatch(downloads, /func pause\(/);
  assert.match(settings, /downloadsDirectory: String/);
  assert.match(settings, /askWhereToSaveDownloads: Bool/);
  assert.match(settingsView, /chooseDownloadsDirectory\(\)/);
  assert.match(settingsView, /Ask where to save each download/);
  assert.match(settingsView, /downloads-folder/);
  assert.match(
    tabs,
    /navigationAction\.shouldPerformDownload \? \.download : \.allow/,
  );
  assert.match(
    tabs,
    /responseRequiresDownload\(navigationResponse\) \|\| !navigationResponse\.canShowMIMEType/,
  );
  assert.match(tabs, /value\(forHTTPHeaderField: "Content-Disposition"\)/);
  assert.match(
    tabs,
    /disposition\.caseInsensitiveCompare\("attachment"\) == \.orderedSame/,
  );
  assert.match(
    tabs,
    /beginTracking\(download, in: webView, isPrivate: isPrivate\)/,
  );
  assert.match(tabs, /forgetFinishedPrivateDownloads\(\)/);
});

test("downloads are reachable from toolbar, full sidebar, and View menu without adding a collapse control", () => {
  const toolbar = read("poc-native/Sources/OmniboxView.swift");
  const sidebar = read("poc-native/Sources/SidebarView.swift");
  const window = read("poc-native/Sources/MainWindowController.swift");
  const menu = read("poc-native/Sources/MainMenu.swift");

  assert.match(toolbar, /downloadsBtn = NSButton/);
  assert.match(toolbar, /omniboxDidRequestDownloads\(sender: NSButton\)/);
  assert.match(sidebar, /case downloads/);
  assert.match(
    sidebar,
    /BrowserDownloadsSidebarView\(searchText: model\.searchText\)/,
  );
  assert.match(window, /BrowserDownloadsPopoverView/);
  assert.match(window, /showDownloadsSidebar\(\)/);
  assert.match(menu, /menuShowDownloads/);
  assert.equal(
    (toolbar.match(/sidebarToggleBtn\s*=\s*NSButton/g) || []).length,
    1,
  );
  assert.doesNotMatch(
    sidebar,
    /collapseButton|sidebarDidToggleSidebar|onCollapse/,
  );
});
