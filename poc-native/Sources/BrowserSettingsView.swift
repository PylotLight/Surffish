import AppKit
import Observation
import SwiftUI
import WebKit

private enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case general = "General"
    case appearance = "Appearance"
    case privacy = "Privacy"
    case extensions = "Extensions"
    case connection = "Connection"
    case about = "About"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .general: return "slider.horizontal.3"
        case .appearance: return "paintbrush"
        case .privacy: return "hand.raised"
        case .extensions: return "puzzlepiece.extension"
        case .connection: return "network"
        case .about: return "info.circle"
        }
    }
}

private struct SettingsSearchEntry: Identifiable {
    let id: String
    let title: String
    let detail: String
    let section: SettingsSection
    let terms: String
}

@MainActor
@Observable
public final class BrowserSettingsModel {
    public var searchEngine: BrowserSearchEngine
    public var startPage: String
    public var restoreSession: Bool
    public var showSidebarAtStartup: Bool
    public var sidebarPinned: Bool
    public var sidebarWidth: Double
    public var newTabTheme: NewTabTheme
    public var newTabSiteSource: NewTabSiteSource
    public var newTabUses24HourClock: Bool
    public var newTabShowsDate: Bool
    public var newTabClockSize: NewTabClockSize
    public var customQuickLinks: [BrowserNewTabQuickLink]
    public var newQuickLinkTitle = ""
    public var newQuickLinkURL = ""
    public var adBlockingEnabled: Bool
    public var historyRetention: HistoryRetention
    public var sshProxyEnabled: Bool
    public var sshHost: String
    public var sshProxyShareEnabled: Bool
    public var sshProxyPort: String
    public var sshProxyBindAddress: String
    public private(set) var sshHosts: [String] = []
    public private(set) var sshSearchStatus = ""
    public private(set) var isSearchingSSHHosts = false
    public private(set) var extensions: [LoadedExtensionInfo] = []
    public var isShowingAlert = false
    public var alertTitle = ""
    public var alertMessage = ""
    public var isConfirmingClearData = false
    public var isConfirmingUninstall = false
    public var pendingUninstallID: String?
    public private(set) var saveStatus = ""

    public var onClose: (() -> Void)?
    public var onInstallExtension: (() -> Void)?
    public var onSettingsSaved: ((BrowserSettings) -> Void)?

    public init() {
        let settings = BrowserSettingsStore.shared.settings
        searchEngine = settings.searchEngine
        startPage = settings.startPage
        restoreSession = settings.restoreSession
        showSidebarAtStartup = settings.showSidebarAtStartup
        sidebarPinned = settings.sidebarPinned
        sidebarWidth = Double(settings.sidebarWidth)
        newTabTheme = settings.newTabTheme
        newTabSiteSource = settings.newTabSiteSource
        newTabUses24HourClock = settings.newTabUses24HourClock
        newTabShowsDate = settings.newTabShowsDate
        newTabClockSize = settings.newTabClockSize
        customQuickLinks = settings.customQuickLinks
        adBlockingEnabled = settings.adBlockingEnabled
        historyRetention = settings.historyRetention
        sshProxyEnabled = settings.sshProxyEnabled
        sshHost = settings.sshHost
        sshProxyShareEnabled = settings.sshProxyShareEnabled
        sshProxyPort = String(settings.sshProxyPort)
        sshProxyBindAddress = settings.sshProxyBindAddress
        extensions = WebExtensionManager.shared.loadedExtensions

        WebExtensionManager.shared.addExtensionsObserver { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.extensions = WebExtensionManager.shared.loadedExtensions
            }
        }
        searchSSHHosts()
    }

    public var pendingUninstall: LoadedExtensionInfo? {
        extensions.first { $0.id == pendingUninstallID }
    }

    public func addCustomQuickLink() {
        let title = newQuickLinkTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawURL = newQuickLinkURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            showAlert(title: "Shortcut title required", message: "Enter a short name for the New Tab shortcut.")
            return
        }
        guard let components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              let url = components.url else {
            showAlert(title: "Invalid shortcut URL", message: "Use a complete HTTP or HTTPS address, such as https://example.com.")
            return
        }
        guard customQuickLinks.count < 12 else {
            showAlert(title: "Shortcut limit reached", message: "New Tab supports up to 12 custom shortcuts.")
            return
        }
        guard !customQuickLinks.contains(where: { $0.url.caseInsensitiveCompare(url.absoluteString) == .orderedSame }) else {
            showAlert(title: "Shortcut already added", message: "Each custom shortcut must use a different URL.")
            return
        }
        customQuickLinks.append(BrowserNewTabQuickLink(title: title, url: url.absoluteString))
        newQuickLinkTitle = ""
        newQuickLinkURL = ""
    }

    public func removeCustomQuickLink(id: UUID) {
        customQuickLinks.removeAll { $0.id == id }
    }

    public func canMoveCustomQuickLink(id: UUID, by offset: Int) -> Bool {
        guard let index = customQuickLinks.firstIndex(where: { $0.id == id }) else { return false }
        return customQuickLinks.indices.contains(index + offset)
    }

    public func moveCustomQuickLink(id: UUID, by offset: Int) {
        guard canMoveCustomQuickLink(id: id, by: offset),
              let index = customQuickLinks.firstIndex(where: { $0.id == id }) else { return }
        customQuickLinks.swapAt(index, index + offset)
    }

    public func searchSSHHosts() {
        guard !isSearchingSSHHosts else { return }
        isSearchingSSHHosts = true
        sshSearchStatus = "Searching your SSH config…"
        Task { [weak self] in
            do {
                let aliases = try await Task.detached(priority: .utility) {
                    try SshConfigHostDiscovery.discover()
                }.value
                guard let self else { return }
                sshHosts = aliases
                sshSearchStatus = aliases.isEmpty
                    ? "No saved Host aliases found in ~/.ssh/config. You can still enter user@host manually."
                    : "Found \(aliases.count) saved SSH \(aliases.count == 1 ? "host" : "hosts")."
                isSearchingSSHHosts = false
            } catch {
                guard let self else { return }
                sshSearchStatus = "Could not search SSH config: \(error.localizedDescription)"
                isSearchingSSHHosts = false
            }
        }
    }

    public func saveSettings() {
        var next = BrowserSettingsStore.shared.settings
        next.searchEngine = searchEngine

        let proposedStartPage = startPage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: proposedStartPage),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" || (scheme == "surffish" && url.host == "newtab") else {
            showAlert(title: "Invalid new tab page", message: "Enter the built-in surffish://newtab/ page or a complete HTTP or HTTPS URL.")
            return
        }
        next.startPage = url.absoluteString
        next.restoreSession = restoreSession
        next.showSidebarAtStartup = showSidebarAtStartup
        next.sidebarPinned = sidebarPinned
        next.sidebarWidth = min(max(Int(sidebarWidth.rounded()), BrowserSettings.minimumSidebarWidth), BrowserSettings.maximumSidebarWidth)
        next.newTabTheme = newTabTheme
        next.newTabSiteSource = newTabSiteSource
        next.newTabUses24HourClock = newTabUses24HourClock
        next.newTabShowsDate = newTabShowsDate
        next.newTabClockSize = newTabClockSize
        next.historyRetention = historyRetention
        guard customQuickLinks.count <= 12 else {
            showAlert(title: "Too many shortcuts", message: "New Tab supports up to 12 custom shortcuts.")
            return
        }
        var normalizedLinks: [BrowserNewTabQuickLink] = []
        var linkURLs = Set<String>()
        for link in customQuickLinks {
            let title = link.title.trimmingCharacters(in: .whitespacesAndNewlines)
            let rawURL = link.url.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty,
                  let components = URLComponents(string: rawURL),
                  let scheme = components.scheme?.lowercased(),
                  ["http", "https"].contains(scheme),
                  let host = components.host, !host.isEmpty,
                  components.user == nil, components.password == nil,
                  let url = components.url else {
                showAlert(title: "Invalid custom shortcut", message: "Every shortcut needs a title and a complete HTTP or HTTPS address without embedded credentials.")
                return
            }
            let canonicalURL = url.absoluteString
            guard linkURLs.insert(canonicalURL.lowercased()).inserted else {
                showAlert(title: "Duplicate custom shortcut", message: "Each custom shortcut must use a different URL.")
                return
            }
            normalizedLinks.append(BrowserNewTabQuickLink(id: link.id, title: title, url: canonicalURL))
        }
        next.customQuickLinks = normalizedLinks
        next.adBlockingEnabled = adBlockingEnabled
        next.sshProxyEnabled = sshProxyEnabled
        next.sshProxyShareEnabled = sshProxyShareEnabled
        next.sshHost = sshHost.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let port = Int(sshProxyPort), (1...65535).contains(port) else {
            showAlert(title: "Invalid SOCKS5 port", message: "Enter a port between 1 and 65535.")
            return
        }
        next.sshProxyPort = port
        next.sshProxyBindAddress = sshProxyShareEnabled && sshProxyBindAddress == "0.0.0.0" ? "0.0.0.0" : "127.0.0.1"

        if (next.sshProxyEnabled || next.sshProxyShareEnabled) && next.sshHost.isEmpty {
            showAlert(title: "SSH host required", message: "Enter an SSH config alias or user@host, or turn off browser proxy routing and external SOCKS sharing.")
            return
        }

        BrowserSettingsStore.shared.update(next)
        AdBlockManager.shared.setEnabled(next.adBlockingEnabled)
        onSettingsSaved?(next)
        saveStatus = "Saved and applied"
        Task {
            await SshTunnelManager.shared.configure(
                browserEnabled: next.sshProxyEnabled,
                serverEnabled: next.sshProxyShareEnabled,
                target: next.sshHost,
                port: next.sshProxyPort,
                bindAddress: next.sshProxyBindAddress
            )
        }
    }

    public func copyProxyAddress() {
        let settings = BrowserSettingsStore.shared.settings
        let host = settings.sshProxyBindAddress == "0.0.0.0" ? "127.0.0.1" : settings.sshProxyBindAddress
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("socks5h://\(host):\(settings.sshProxyPort)", forType: .string)
        saveStatus = "SOCKS5 address copied"
    }

    public func resetAllPageZoom() {
        BrowserPageZoomStore.shared.clearAll()
        for tab in TabManager.shared.tabs { TabManager.shared.applyPageZoom(to: tab) }
        saveStatus = "All saved page zoom reset to 100%"
    }

    public func clearWebsiteData() {
        let dataStore = WKWebsiteDataStore(forIdentifier: BrowserProfile.current.websiteDataStoreIdentifier)
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        dataStore.fetchDataRecords(ofTypes: dataTypes) { [weak self] records in
            dataStore.removeData(ofTypes: dataTypes, for: records) {
                Task { @MainActor [weak self] in
                    self?.showAlert(
                        title: "Website data cleared",
                        message: "Website data was removed from the \(BrowserProfile.current.displayName) profile. Bookmarks and browsing history were not changed."
                    )
                }
            }
        }
    }

    public func requestUninstall(_ id: String) {
        pendingUninstallID = id
        isConfirmingUninstall = true
    }

    public func uninstallPendingExtension() {
        guard let id = pendingUninstallID else { return }
        pendingUninstallID = nil
        Task { [weak self] in
            do {
                try await WebExtensionManager.shared.uninstallExtension(id: id)
            } catch {
                guard let self else { return }
                showAlert(title: "Could not uninstall extension", message: error.localizedDescription)
            }
        }
    }

    public func showAlert(title: String, message: String) {
        alertTitle = title
        alertMessage = message
        isShowingAlert = true
    }
}

@MainActor
public struct BrowserSettingsView: View {
    @Bindable var model: BrowserSettingsModel
    @State private var selectedSection: SettingsSection = .general
    @State private var settingsSearchQuery = ""

    public init(model: BrowserSettingsModel) { self.model = model }

    private var searchEntries: [SettingsSearchEntry] {
        [
            .init(id: "search-engine", title: "Search engine", detail: "Choose DuckDuckGo, Google or Bing", section: .general, terms: "search engine provider web query"),
            .init(id: "start-page", title: "New Tab page", detail: "Set the startup and new-tab destination", section: .general, terms: "startup home page url new tab"),
            .init(id: "restore-session", title: "Restore previous session", detail: "Reopen tabs from the last session", section: .general, terms: "startup restore tabs session"),
            .init(id: "sidebar-startup", title: "Sidebar visibility", detail: "Choose whether the sidebar opens at startup", section: .general, terms: "sidebar startup show"),
            .init(id: "sidebar-pinned", title: "Keep sidebar open", detail: "Keep the sidebar expanded when the pointer leaves", section: .general, terms: "sidebar pin keep open hover"),
            .init(id: "sidebar-width", title: "Sidebar width", detail: "Adjust the sidebar between 220 and 440 points", section: .general, terms: "sidebar resize width size"),
            .init(id: "newtab-theme", title: "New Tab background", detail: "Choose one of the built-in color themes", section: .appearance, terms: "appearance theme background color new tab"),
            .init(id: "newtab-clock", title: "New Tab clock", detail: "Choose 12- or 24-hour time, date visibility and clock size", section: .appearance, terms: "clock time 12 24 hour date size appearance new tab"),
            .init(id: "newtab-links", title: "New Tab shortcuts", detail: "Choose a source or manage custom shortcuts", section: .appearance, terms: "quick links favorites bookmarks pinned recent custom new tab"),
            .init(id: "ad-blocking", title: "Advertising and tracking", detail: "Enable the built-in WebKit content rules", section: .privacy, terms: "privacy ad blocker tracking content rules"),
            .init(id: "history-retention", title: "History retention", detail: "Automatically remove profile history older than the selected limit", section: .privacy, terms: "privacy history retention delete clear 30 90 days year"),
            .init(id: "site-data", title: "Website data", detail: "Clear cookies, caches and storage for this profile", section: .privacy, terms: "privacy cookies cache storage clear site data"),
            .init(id: "extensions", title: "Extensions", detail: "Install or remove profile extensions", section: .extensions, terms: "extensions add install remove webkit bramble"),
            .init(id: "ssh-route", title: "Browser proxy routing", detail: "Route browser traffic through the SSH tunnel", section: .connection, terms: "network proxy ssh socks5 route browser"),
            .init(id: "ssh-host", title: "SSH host", detail: "Choose a saved SSH alias or enter user@host", section: .connection, terms: "network proxy ssh host alias nas"),
            .init(id: "socks-port", title: "SOCKS5 port and sharing", detail: "Configure the local endpoint and optional LAN access", section: .connection, terms: "network proxy socks5 port listen address lan share"),
            .init(id: "profile", title: "Profile and engine", detail: "View profile storage and the native WebKit engine", section: .about, terms: "about profile storage engine webkit platform version")
        ]
    }

    private var filteredSearchEntries: [SettingsSearchEntry] {
        let query = settingsSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return searchEntries.filter {
            $0.title.localizedCaseInsensitiveContains(query)
                || $0.detail.localizedCaseInsensitiveContains(query)
                || $0.terms.localizedCaseInsensitiveContains(query)
        }
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Settings").font(.system(size: 25, weight: .semibold))
                    Text("Native browser preferences for this profile")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.tertiary)
                    TextField("Search settings", text: $settingsSearchQuery)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                        .accessibilityLabel("Search settings")
                    if !settingsSearchQuery.isEmpty {
                        Button { settingsSearchQuery = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(.tertiary)
                        }
                        .buttonStyle(.plain)
                        .help("Clear settings search")
                    }
                }
                .padding(.horizontal, 9)
                .frame(height: 32)
                .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))

                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(SettingsSection.allCases) { section in
                            Button {
                                selectedSection = section
                                settingsSearchQuery = ""
                            } label: {
                                Label(section.rawValue, systemImage: section.symbol)
                                    .font(.system(size: 12, weight: selectedSection == section ? .semibold : .regular))
                                    .foregroundStyle(selectedSection == section ? .primary : .secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 10)
                                    .frame(height: 34)
                                    .background(
                                        selectedSection == section ? Color.accentColor.opacity(0.20) : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 9)
                                    )
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(selectedSection == section ? .isSelected : [])
                        }
                    }
                }
                .scrollIndicators(.hidden)
                Spacer(minLength: 0)
            }
            .frame(width: 190, alignment: .topLeading)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .overlay(alignment: .trailing) {
                Rectangle().fill(Color.white.opacity(0.08)).frame(width: 1)
            }

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(selectedSection.rawValue).font(.system(size: 20, weight: .semibold))
                        Text(sectionSubtitle)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Done") { model.onClose?() }
                        .keyboardShortcut(.cancelAction)
                }

                if settingsSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            selectedPage
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 3)
                    }
                    .scrollIndicators(.visible)
                } else {
                    settingsSearchResults
                }

                HStack {
                    Text(model.saveStatus)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if selectedSection == .connection && settingsSearchQuery.isEmpty {
                        Button("Copy local SOCKS5 address") { model.copyProxyAddress() }
                    }
                    Button("Save & Apply") { model.saveSettings() }
                        .keyboardShortcut(.defaultAction)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(26)
        .background(Color(nsColor: NSColor(red: 0.075, green: 0.08, blue: 0.095, alpha: 1)))
        .preferredColorScheme(.dark)
        .alert(model.alertTitle, isPresented: $model.isShowingAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.alertMessage)
        }
        .confirmationDialog("Clear website data for \(BrowserProfile.current.displayName)?", isPresented: $model.isConfirmingClearData, titleVisibility: .visible) {
            Button("Clear Website Data", role: .destructive) { model.clearWebsiteData() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes cookies, caches and other website storage for this native app profile. It does not clear bookmarks or browsing history.")
        }
        .confirmationDialog("Uninstall \(model.pendingUninstall?.name ?? "extension")?", isPresented: $model.isConfirmingUninstall, titleVisibility: .visible) {
            Button("Uninstall", role: .destructive) { model.uninstallPendingExtension() }
            Button("Cancel", role: .cancel) { model.pendingUninstallID = nil }
        } message: {
            Text("The extension will be unloaded and removed from this Surffish profile.")
        }
    }

    private var sectionSubtitle: String {
        switch selectedSection {
        case .general: return "Browser startup, search and sidebar behavior"
        case .appearance: return "Built-in New Tab themes and shortcuts"
        case .privacy: return "Profile data and native content rules"
        case .extensions: return "WebKit extensions installed in this profile"
        case .connection: return "Managed SSH and local SOCKS5 routing"
        case .about: return "Native engine and profile details"
        }
    }

    private var newTabSourceDescription: String {
        switch model.newTabSiteSource {
        case .automatic: return "Automatic prefers pinned sites, then recent sites, then bookmarks. Recent history is hidden in private tabs."
        case .pinned: return "Only pinned sites are shown."
        case .recent: return "Recently visited sites are hidden in private tabs."
        case .bookmarks: return "Your saved bookmarks are shown as quick links."
        case .custom: return "Only your custom shortcuts are shown on New Tab."
        }
    }

    @ViewBuilder
    private var selectedPage: some View {
        switch selectedSection {
        case .general: generalPage
        case .appearance: appearancePage
        case .privacy: privacyPage
        case .extensions: extensionsPage
        case .connection: connectionPage
        case .about: aboutPage
        }
    }

    private var settingsSearchResults: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text(filteredSearchEntries.isEmpty
                     ? "No supported settings match ‘\(settingsSearchQuery)’"
                     : "\(filteredSearchEntries.count) matching settings")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 3)
                ForEach(filteredSearchEntries) { entry in
                    Button {
                        selectedSection = entry.section
                        settingsSearchQuery = ""
                    } label: {
                        HStack(alignment: .top, spacing: 11) {
                            Image(systemName: entry.section.symbol)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(entry.title).font(.system(size: 12, weight: .semibold))
                                Text(entry.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 4)
                            Text(entry.section.rawValue)
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(11)
                        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
                        .contentShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .scrollIndicators(.visible)
    }

    private var generalPage: some View {
        GroupBox("Browser") {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Search engine", selection: $model.searchEngine) {
                    ForEach(BrowserSearchEngine.allCases, id: \.self) { engine in
                        Text(engine.displayName).tag(engine)
                    }
                }
                TextField("New tab page URL", text: $model.startPage)
                    .textFieldStyle(.roundedBorder)
                Toggle("Restore tabs from the previous session", isOn: $model.restoreSession)
                Toggle("Show the sidebar at startup", isOn: $model.showSidebarAtStartup)
                Toggle("Keep the sidebar open when the pointer leaves", isOn: $model.sidebarPinned)
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text("Sidebar width")
                        Spacer()
                        Text("\(Int(model.sidebarWidth.rounded())) pt")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    Slider(
                        value: $model.sidebarWidth,
                        in: Double(BrowserSettings.minimumSidebarWidth)...Double(BrowserSettings.maximumSidebarWidth),
                        step: 10
                    )
                    .accessibilityLabel("Sidebar width")
                }
            }
            .padding(.top, 6)
        }
    }

    private var appearancePage: some View {
        VStack(alignment: .leading, spacing: 14) {
            GroupBox("New Tab look and links") {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Background", selection: $model.newTabTheme) {
                        ForEach(NewTabTheme.allCases) { theme in
                            Text(theme.displayName).tag(theme)
                        }
                    }
                    Picker("Quick link source", selection: $model.newTabSiteSource) {
                        ForEach(NewTabSiteSource.allCases) { source in
                            Text(source.displayName).tag(source)
                        }
                    }
                    Picker("Clock format", selection: $model.newTabUses24HourClock) {
                        Text("12-hour").tag(false)
                        Text("24-hour").tag(true)
                    }
                    Toggle("Show date", isOn: $model.newTabShowsDate)
                    Picker("Clock size", selection: $model.newTabClockSize) {
                        ForEach(NewTabClockSize.allCases) { size in
                            Text(size.displayName).tag(size)
                        }
                    }
                    Text(newTabSourceDescription)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 6)
            }

            GroupBox("Custom shortcuts") {
                VStack(alignment: .leading, spacing: 10) {
                    if model.customQuickLinks.isEmpty {
                        Text("No custom shortcuts yet. Add a title and website below, then choose Custom shortcuts as the New Tab source.")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach($model.customQuickLinks) { $link in
                        HStack(alignment: .center, spacing: 9) {
                            VStack(spacing: 6) {
                                TextField("Shortcut title", text: $link.title)
                                    .textFieldStyle(.roundedBorder)
                                TextField("https://example.com", text: $link.url)
                                    .textFieldStyle(.roundedBorder)
                                    .font(.system(size: 11, design: .monospaced))
                            }
                            VStack(spacing: 3) {
                                Button {
                                    model.moveCustomQuickLink(id: link.id, by: -1)
                                } label: {
                                    Image(systemName: "chevron.up")
                                }
                                .disabled(!model.canMoveCustomQuickLink(id: link.id, by: -1))
                                .help("Move shortcut up")
                                .accessibilityLabel("Move \(link.title) up")
                                Button {
                                    model.moveCustomQuickLink(id: link.id, by: 1)
                                } label: {
                                    Image(systemName: "chevron.down")
                                }
                                .disabled(!model.canMoveCustomQuickLink(id: link.id, by: 1))
                                .help("Move shortcut down")
                                .accessibilityLabel("Move \(link.title) down")
                            }
                            Button(role: .destructive) {
                                model.removeCustomQuickLink(id: link.id)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("Remove shortcut")
                            .accessibilityLabel("Remove \(link.title.isEmpty ? "shortcut" : link.title)")
                        }
                        .padding(.vertical, 2)
                    }
                    Divider()
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Shortcut title", text: $model.newQuickLinkTitle)
                            .textFieldStyle(.roundedBorder)
                        TextField("https://example.com", text: $model.newQuickLinkURL)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 11, design: .monospaced))
                        HStack {
                            Text("\(model.customQuickLinks.count) of 12 shortcuts")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Add shortcut") { model.addCustomQuickLink() }
                                .disabled(model.customQuickLinks.count >= 12)
                        }
                    }
                    Text("Only complete HTTP or HTTPS addresses are accepted. Changes are saved with Save & Apply and stay within this app profile.")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 6)
            }
        }
    }

    private var privacyPage: some View {
        VStack(alignment: .leading, spacing: 14) {
            GroupBox("Privacy & site data") {
                VStack(alignment: .leading, spacing: 12) {
                    Toggle("Block common advertising and tracking requests", isOn: $model.adBlockingEnabled)
                    Text("The native blocker uses a small built-in WebKit rule set. It is not equivalent to Electron’s full filter-list and scriptlet coverage.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Picker("Keep history for", selection: $model.historyRetention) {
                        ForEach(HistoryRetention.allCases) { retention in
                            Text(retention.displayName).tag(retention)
                        }
                    }
                    Text("Older profile history is removed when you save and at startup. The default is Never; bookmarks and Reading List are not affected.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Reset all saved page zoom") { model.resetAllPageZoom() }
                    Text("Page zoom is saved per website for this profile; private-session changes are temporary.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                    Button("Clear profile website data…") { model.isConfirmingClearData = true }
                }
                .padding(.top, 6)
            }
        }
    }

    private var extensionsPage: some View {
        GroupBox("Extensions") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Extensions are installed separately into the selected Surffish profile. Chrome-only APIs are not assumed to work in WebKit.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Install extension…") { model.onInstallExtension?() }
                if model.extensions.isEmpty {
                    Text("No extensions installed")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.extensions) { item in
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(item.name) · v\(item.version)")
                                    .font(.system(size: 12, weight: .medium))
                                Text(item.hasPopup ? "Toolbar popup available" : "Background / options extension")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Uninstall") { model.requestUninstall(item.id) }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .padding(.top, 6)
        }
    }

    private var connectionPage: some View {
        VStack(alignment: .leading, spacing: 14) {
            GroupBox("SSH SOCKS5 connection") {
                VStack(alignment: .leading, spacing: 12) {
                    Toggle("Route browser traffic through an SSH SOCKS5 proxy", isOn: $model.sshProxyEnabled)
                    Picker("Saved SSH host", selection: $model.sshHost) {
                        Text("Choose or enter manually").tag("")
                        ForEach(model.sshHosts, id: \.self) { host in Text(host).tag(host) }
                    }
                    TextField("SSH alias or user@host", text: $model.sshHost)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Button(model.isSearchingSSHHosts ? "Searching…" : "Search SSH configs") { model.searchSSHHosts() }
                            .disabled(model.isSearchingSSHHosts)
                        Text(model.sshSearchStatus)
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                    Toggle("Keep the local SOCKS endpoint running when browser routing is off", isOn: $model.sshProxyShareEnabled)
                    HStack {
                        Text("Local SOCKS5 port").frame(width: 150, alignment: .leading)
                        TextField("1080", text: $model.sshProxyPort)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 120)
                    }
                    Picker("Listen address", selection: $model.sshProxyBindAddress) {
                        Text("This Mac only (127.0.0.1)").tag("127.0.0.1")
                        Text("LAN devices (0.0.0.0)").tag("0.0.0.0")
                    }
                    Text("The SSH host is the exit point. LAN sharing exposes the endpoint without SOCKS authentication; use it only on a trusted network.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 6)
            }
        }
    }

    private var aboutPage: some View {
        GroupBox("About this profile") {
            VStack(alignment: .leading, spacing: 10) {
                infoRow("Profile", BrowserProfile.current.displayName)
                infoRow("Profile storage", "Settings, bookmarks, history, reading list, extensions and website data are isolated by profile.")
                infoRow("Engine", "WebKit with a SwiftUI-first native browser shell")
                infoRow("Platform", ProcessInfo.processInfo.operatingSystemVersionString)
            }
            .padding(.top, 6)
        }
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Text(title).font(.system(size: 12, weight: .medium)).frame(width: 130, alignment: .leading)
            Text(value).font(.system(size: 11)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
