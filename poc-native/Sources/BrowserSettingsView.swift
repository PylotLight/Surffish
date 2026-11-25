import AppKit
import Observation
import SwiftUI
import WebKit

private enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case general = "General"
    case privacy = "Privacy"
    case extensions = "Extensions"
    case connection = "Connection"
    case about = "About"

    var id: String { rawValue }
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
    public var adBlockingEnabled: Bool
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
        adBlockingEnabled = settings.adBlockingEnabled
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

    public init(model: BrowserSettingsModel) { self.model = model }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Settings").font(.system(size: 25, weight: .semibold))
                    Text("Native browser preferences for this profile")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Done") { model.onClose?() }
                    .keyboardShortcut(.cancelAction)
            }

            Picker("Settings section", selection: $selectedSection) {
                ForEach(SettingsSection.allCases) { section in
                    Text(section.rawValue).tag(section)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    switch selectedSection {
                    case .general: generalPage
                    case .privacy: privacyPage
                    case .extensions: extensionsPage
                    case .connection: connectionPage
                    case .about: aboutPage
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 3)
            }
            .scrollIndicators(.visible)

            HStack {
                Text(model.saveStatus)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
                if selectedSection == .connection {
                    Button("Copy local SOCKS5 address") { model.copyProxyAddress() }
                }
                Button("Save & Apply") { model.saveSettings() }
                    .keyboardShortcut(.defaultAction)
            }
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

    private var generalPage: some View {
        VStack(alignment: .leading, spacing: 14) {
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
                            Text("\(Int(model.sidebarWidth.rounded())) px")
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

            GroupBox("New Tab appearance and shortcuts") {
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Background", selection: $model.newTabTheme) {
                        ForEach(NewTabTheme.allCases) { theme in
                            Text(theme.displayName).tag(theme)
                        }
                    }
                    Picker("Quick links", selection: $model.newTabSiteSource) {
                        ForEach(NewTabSiteSource.allCases) { source in
                            Text(source.displayName).tag(source)
                        }
                    }
                    Text("Automatic prefers pinned sites, then recent sites, then bookmarks. Recent history is always hidden in private tabs.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
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
