import AppKit
import WebKit

public final class TabItem: NSObject, Identifiable, WKWebExtensionTab {
    public let id: UUID
    public var title: String
    public var url: URL?
    public var isLoading: Bool
    public var isPinned: Bool
    public var isPrivate: Bool
    public var groupID: UUID?
    public var spaceID: String
    public let webView: WKWebView

    public init(
        id: UUID,
        title: String,
        url: URL?,
        isLoading: Bool,
        isPinned: Bool = false,
        isPrivate: Bool = false,
        groupID: UUID? = nil,
        spaceID: String = "default",
        webView: WKWebView
    ) {
        self.id = id
        self.title = title
        self.url = url
        self.isLoading = isLoading
        self.isPinned = isPinned
        self.isPrivate = isPrivate
        self.groupID = groupID
        self.spaceID = spaceID
        self.webView = webView
        super.init()
    }

    public func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
    public func url(for context: WKWebExtensionContext) -> URL? { webView.url ?? url }
    public func title(for context: WKWebExtensionContext) -> String? { webView.title ?? title }
    public func isLoading(for context: WKWebExtensionContext) -> Bool { webView.isLoading }

    public func activate(for context: WKWebExtensionContext, completionHandler: @escaping (Error?) -> Void) {
        DispatchQueue.main.async {
            TabManager.shared.selectTab(id: self.id)
            completionHandler(nil)
        }
    }

    public func close(for context: WKWebExtensionContext, completionHandler: @escaping (Error?) -> Void) {
        DispatchQueue.main.async {
            TabManager.shared.closeTab(id: self.id)
            completionHandler(nil)
        }
    }
}

public protocol TabManagerDelegate: AnyObject {
    func tabManagerDidUpdateTabs()
    func tabManagerDidChangeActiveTab(to tab: TabItem)
}

@MainActor
public final class TabManager: NSObject, WKNavigationDelegate {
    public static let shared = TabManager()
    public static var startPage: URL { BrowserSettingsStore.shared.settings.startPageURL }

    public weak var delegate: TabManagerDelegate?
    public private(set) var tabs: [TabItem] = []
    public private(set) var activeTabId: UUID?
    public private(set) var isRestoringSession = false
    private var restoredSessionTabIDs: Set<UUID> = []
    private var recentlyClosedTabs: [SavedBrowserTab] = []
    private let maximumRecentlyClosedTabs = 20

    public var activeTab: TabItem? {
        guard let id = activeTabId else { return nil }
        return tabs.first { $0.id == id }
    }

    private override init() { super.init() }

    @discardableResult
    public func createTab(
        url: URL? = nil,
        makeActive: Bool = true,
        isPrivate: Bool = false,
        id: UUID = UUID(),
        isPinned: Bool = false,
        groupID: UUID? = nil,
        spaceID: String = "default"
    ) -> TabItem {
        let targetURL = url ?? Self.startPage
        let configuration: WKWebViewConfiguration

        if targetURL.scheme == "webkit-extension",
           let context = WebExtensionManager.shared.context(for: targetURL),
           let extensionConfiguration = context.webViewConfiguration,
           !isPrivate {
            // WebKit requires this context-provided configuration for every
            // webkit-extension:// page. The property returns a customized copy.
            configuration = extensionConfiguration
            // Keep the extension context's own data store/configuration intact.
            // WebKit owns extension-origin storage isolation; replacing its
            // data store can make WKWebView reject the configuration at init.
            BrambleNativeBridge.shared.applyTo(userContentController: configuration.userContentController)
            DeveloperConsole.shared.install(on: configuration.userContentController)
        } else {
            configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = isPrivate ? .nonPersistent() : WKWebsiteDataStore(forIdentifier: BrowserProfile.current.websiteDataStoreIdentifier)
            configuration.webExtensionController = WebExtensionManager.shared.controller
            AdBlockManager.shared.applyTo(userContentController: configuration.userContentController)
            BrambleNativeBridge.shared.applyTo(userContentController: configuration.userContentController)
            DeveloperConsole.shared.install(on: configuration.userContentController)
        }

        configuration.setURLSchemeHandler(BrowserNewTabSchemeHandler.shared, forURLScheme: "surffish")
        WebKitProxyController.apply(port: SshTunnelManager.shared.browserProxyPort, to: configuration.websiteDataStore)

        let webView = InspectableWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true

        let tab = TabItem(
            id: id,
            title: targetURL.scheme == "webkit-extension" ? "Extension" : "New Tab",
            url: targetURL,
            isLoading: true,
            isPinned: isPinned,
            isPrivate: isPrivate,
            groupID: groupID,
            spaceID: spaceID,
            webView: webView
        )
        webView.navigationDelegate = self

        let insertionIndex = isPinned
            ? tabs.firstIndex(where: { !$0.isPinned }) ?? tabs.endIndex
            : tabs.endIndex
        tabs.insert(tab, at: insertionIndex)

        if makeActive || activeTabId == nil { activeTabId = tab.id }
        webView.load(URLRequest(url: targetURL))
        notifyTabsChanged()
        if let active = activeTab { delegate?.tabManagerDidChangeActiveTab(to: active) }
        return tab
    }

    public func restoreSession() {
        guard tabs.isEmpty else { return }
        guard BrowserSettingsStore.shared.settings.restoreSession,
              let saved = BrowserSessionStore.shared.load(), !saved.tabs.isEmpty else {
            _ = createTab(url: Self.startPage)
            return
        }

        isRestoringSession = true
        for savedTab in saved.tabs {
            guard let url = URL(string: savedTab.url),
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https", "file", "webkit-extension", "surffish"].contains(scheme) else { continue }
            restoredSessionTabIDs.insert(savedTab.id)
            _ = createTab(
                url: url,
                makeActive: false,
                id: savedTab.id,
                isPinned: savedTab.isPinned,
                groupID: savedTab.groupID,
                spaceID: savedTab.spaceID
            )
            if let tab = tabs.first(where: { $0.id == savedTab.id }), !savedTab.title.isEmpty {
                tab.title = savedTab.title
            }
        }

        if tabs.isEmpty {
            isRestoringSession = false
            _ = createTab(url: Self.startPage)
            return
        }

        if let restoredID = saved.activeTabID, tabs.contains(where: { $0.id == restoredID }) {
            activeTabId = restoredID
        } else {
            activeTabId = tabs.first?.id
        }
        isRestoringSession = false
        if let active = activeTab { delegate?.tabManagerDidChangeActiveTab(to: active) }
        notifyTabsChanged()
        persistSession()
    }

    public func selectTab(id: UUID) {
        guard activeTabId != id, let tab = tabs.first(where: { $0.id == id }) else { return }
        activeTabId = id
        delegate?.tabManagerDidChangeActiveTab(to: tab)
        notifyTabsChanged()
    }

    public func closeTab(id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closingActive = activeTabId == id
        let closingTab = tabs.remove(at: index)
        if !closingTab.isPrivate,
           let url = closingTab.webView.url ?? closingTab.url,
           let scheme = url.scheme?.lowercased(),
           ["http", "https", "file", "webkit-extension", "surffish"].contains(scheme) {
            recentlyClosedTabs.insert(
                SavedBrowserTab(
                    id: closingTab.id,
                    url: url.absoluteString,
                    title: closingTab.webView.title ?? closingTab.title,
                    isPinned: closingTab.isPinned,
                    groupID: closingTab.groupID,
                    spaceID: closingTab.spaceID
                ),
                at: 0
            )
            if recentlyClosedTabs.count > maximumRecentlyClosedTabs {
                recentlyClosedTabs.removeLast(recentlyClosedTabs.count - maximumRecentlyClosedTabs)
            }
        }
        restoredSessionTabIDs.remove(id)
        closingTab.webView.stopLoading()
        closingTab.webView.navigationDelegate = nil

        if tabs.isEmpty {
            activeTabId = nil
            _ = createTab(url: Self.startPage)
            return
        }

        if closingActive {
            let nextIndex = min(index, tabs.count - 1)
            activeTabId = tabs[nextIndex].id
            delegate?.tabManagerDidChangeActiveTab(to: tabs[nextIndex])
        }
        notifyTabsChanged()
    }

    public var canReopenClosedTab: Bool { !recentlyClosedTabs.isEmpty }

    @discardableResult
    public func reopenClosedTab() -> TabItem? {
        guard !recentlyClosedTabs.isEmpty else { return nil }
        let saved = recentlyClosedTabs.removeFirst()
        guard let url = URL(string: saved.url) else { return nil }
        return createTab(
            url: url,
            makeActive: true,
            isPinned: saved.isPinned,
            groupID: saved.groupID,
            spaceID: saved.spaceID
        )
    }

    @discardableResult
    public func duplicateTab(id: UUID) -> TabItem? {
        guard let tab = tabs.first(where: { $0.id == id }),
              let url = tab.webView.url ?? tab.url else { return nil }
        return createTab(
            url: url,
            makeActive: true,
            isPrivate: tab.isPrivate,
            isPinned: tab.isPinned,
            groupID: tab.groupID,
            spaceID: tab.spaceID
        )
    }

    public func togglePinned(id: UUID) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        tab.isPinned.toggle()
        let moving = tabs.remove(at: tabs.firstIndex(where: { $0.id == id })!)
        let destination = moving.isPinned
            ? (tabs.firstIndex(where: { !$0.isPinned }) ?? tabs.endIndex)
            : (tabs.lastIndex(where: { $0.isPinned }).map { $0 + 1 } ?? 0)
        tabs.insert(moving, at: destination)
        notifyTabsChanged()
    }

    public func moveTab(id: UUID, to destination: Int) {
        guard let source = tabs.firstIndex(where: { $0.id == id }) else { return }
        let moving = tabs.remove(at: source)
        let pinnedCount = tabs.filter(\.isPinned).count
        let lowerBound = moving.isPinned ? 0 : pinnedCount
        let upperBound = moving.isPinned ? max(0, pinnedCount - 1) : tabs.count
        tabs.insert(moving, at: min(max(destination, lowerBound), upperBound))
        notifyTabsChanged()
    }

    public func applyProxyConfiguration(port: UInt16?) {
        for tab in tabs {
            WebKitProxyController.apply(port: port, to: tab.webView.configuration.websiteDataStore)
        }
    }

    public func reloadAllTabs() {
        for tab in tabs {
            tab.webView.reload()
        }
    }

    public func updateTab(id: UUID, groupID: UUID?, spaceID: String) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        tab.groupID = groupID
        tab.spaceID = spaceID
        notifyTabsChanged()
    }

    public func persistSession() {
        guard !isRestoringSession else { return }
        let persistentTabs = tabs.filter { !$0.isPrivate }.compactMap { tab -> SavedBrowserTab? in
            guard let url = tab.webView.url ?? tab.url else { return nil }
            return SavedBrowserTab(
                id: tab.id,
                url: url.absoluteString,
                title: tab.webView.title ?? tab.title,
                isPinned: tab.isPinned,
                groupID: tab.groupID,
                spaceID: tab.spaceID
            )
        }
        let savedActiveID = activeTab.flatMap { $0.isPrivate ? nil : $0.id }
            ?? persistentTabs.first?.id
        BrowserSessionStore.shared.save(
            SavedBrowserSession(tabs: persistentTabs, activeTabID: savedActiveID)
        )
    }

    private func notifyTabsChanged() {
        delegate?.tabManagerDidUpdateTabs()
        persistSession()
    }

    // MARK: WKNavigationDelegate

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard let tab = tabs.first(where: { $0.webView === webView }) else { return }
        tab.isLoading = true
        notifyTabsChanged()
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let tab = tabs.first(where: { $0.webView === webView }) else { return }
        tab.isLoading = false
        tab.url = webView.url
        if let title = webView.title, !title.isEmpty { tab.title = title }
        else if let host = webView.url?.host { tab.title = host }
        let wasRestoredNavigation = restoredSessionTabIDs.remove(tab.id) != nil
        if !wasRestoredNavigation, let url = webView.url {
            BrowserLibraryStore.shared.recordVisit(url: url, title: tab.title, isPrivate: tab.isPrivate)
        }
        notifyTabsChanged()
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard let tab = tabs.first(where: { $0.webView === webView }) else { return }
        restoredSessionTabIDs.remove(tab.id)
        DeveloperConsole.shared.recordNavigationFailure(url: webView.url ?? tab.url, error: error, provisional: false)
        tab.isLoading = false
        notifyTabsChanged()
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard let tab = tabs.first(where: { $0.webView === webView }) else { return }
        restoredSessionTabIDs.remove(tab.id)
        DeveloperConsole.shared.recordNavigationFailure(url: webView.url ?? tab.url, error: error, provisional: true)
        tab.isLoading = false
        notifyTabsChanged()
    }
}
