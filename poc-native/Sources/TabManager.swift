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

public final class TabManager: NSObject, WKNavigationDelegate {
    public static let shared = TabManager()
    public static var startPage: URL { BrowserSettingsStore.shared.settings.startPageURL }

    public weak var delegate: TabManagerDelegate?
    public private(set) var tabs: [TabItem] = []
    public private(set) var activeTabId: UUID?
    public private(set) var isRestoringSession = false
    public private(set) var sidebarVisible = true

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
            configuration = extensionConfiguration
            BrambleNativeBridge.shared.applyTo(userContentController: configuration.userContentController)
        } else {
            configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = isPrivate ? .nonPersistent() : .default()
            configuration.webExtensionController = WebExtensionManager.shared.controller
            AdBlockManager.shared.applyTo(userContentController: configuration.userContentController)
            BrambleNativeBridge.shared.applyTo(userContentController: configuration.userContentController)
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        if #available(macOS 13.3, *) { webView.isInspectable = true }
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
        guard BrowserSettingsStore.shared.settings.restoreSession,\n              let saved = BrowserSessionStore.shared.load(), !saved.tabs.isEmpty else {
            _ = createTab(url: Self.startPage)
            return
        }

        isRestoringSession = true
        for savedTab in saved.tabs {
            guard let url = URL(string: savedTab.url),
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https", "file", "webkit-extension"].contains(scheme) else { continue }
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

    public func updateTab(id: UUID, groupID: UUID?, spaceID: String) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        tab.groupID = groupID
        tab.spaceID = spaceID
        notifyTabsChanged()
    }

    public func setSidebarVisible(_ visible: Bool) {
        sidebarVisible = visible
    }

    public func persistSession(sidebarVisible: Bool? = nil) {
        guard !isRestoringSession else { return }
        if let sidebarVisible { self.sidebarVisible = sidebarVisible }
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
            SavedBrowserSession(tabs: persistentTabs, activeTabID: savedActiveID, sidebarVisible: self.sidebarVisible)
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
        notifyTabsChanged()
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard let tab = tabs.first(where: { $0.webView === webView }) else { return }
        tab.isLoading = false
        notifyTabsChanged()
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard let tab = tabs.first(where: { $0.webView === webView }) else { return }
        tab.isLoading = false
        notifyTabsChanged()
    }
}
