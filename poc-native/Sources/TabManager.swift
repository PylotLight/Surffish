import AppKit
import WebKit

public final class TabItem: NSObject, Identifiable, WKWebExtensionTab {
    public let id: UUID
    public var title: String
    public var url: URL?
    public var isLoading: Bool
    public let webView: WKWebView
    
    public init(id: UUID, title: String, url: URL?, isLoading: Bool, webView: WKWebView) {
        self.id = id
        self.title = title
        self.url = url
        self.isLoading = isLoading
        self.webView = webView
        super.init()
    }
    
    // MARK: - WKWebExtensionTab
    public func webView(for context: WKWebExtensionContext) -> WKWebView? {
        return webView
    }
    
    public func url(for context: WKWebExtensionContext) -> URL? {
        return webView.url ?? url
    }
    
    public func title(for context: WKWebExtensionContext) -> String? {
        return webView.title ?? title
    }
    
    public func isLoading(for context: WKWebExtensionContext) -> Bool {
        return webView.isLoading
    }
    
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
    
    public weak var delegate: TabManagerDelegate?
    public private(set) var tabs: [TabItem] = []
    public private(set) var activeTabId: UUID?
    
    public var activeTab: TabItem? {
        guard let id = activeTabId else { return nil }
        return tabs.first { $0.id == id }
    }
    
    private override init() {
        super.init()
    }
    
    public func createTab(url: URL? = URL(string: "https://news.ycombinator.com"), makeActive: Bool = true) -> TabItem {
        let config: WKWebViewConfiguration
        if let url = url, url.scheme == "webkit-extension",
           let ctx = WebExtensionManager.shared.context(for: url),
           let extConfig = ctx.webViewConfiguration {
            config = extConfig
        } else {
            config = WKWebViewConfiguration()
            config.webExtensionController = WebExtensionManager.shared.controller
            AdBlockManager.shared.applyTo(userContentController: config.userContentController)
        }
        
        let webView = WKWebView(frame: .zero, configuration: config)
        
        // Native gestures
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        
        let defaultTitle = (url?.scheme == "webkit-extension") ? "Extension" : "New Tab"
        let tab = TabItem(
            id: UUID(),
            title: defaultTitle,
            url: url,
            isLoading: true,
            webView: webView
        )
        
        webView.navigationDelegate = self
        tabs.append(tab)
        
        if let url = url {
            webView.load(URLRequest(url: url))
        }
        
        if makeActive || activeTabId == nil {
            activeTabId = tab.id
        }
        
        delegate?.tabManagerDidUpdateTabs()
        if let active = activeTab {
            delegate?.tabManagerDidChangeActiveTab(to: active)
        }
        
        return tab
    }
    
    public func selectTab(id: UUID) {
        guard activeTabId != id, let tab = tabs.first(where: { $0.id == id }) else { return }
        activeTabId = id
        delegate?.tabManagerDidChangeActiveTab(to: tab)
        delegate?.tabManagerDidUpdateTabs()
    }
    
    public func closeTab(id: UUID) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let closingActive = (activeTabId == id)
        
        let closingTab = tabs.remove(at: index)
        closingTab.webView.stopLoading()
        closingTab.webView.navigationDelegate = nil
        
        if tabs.isEmpty {
            _ = createTab(url: URL(string: "https://duckduckgo.com"))
            return
        }
        
        if closingActive {
            let nextIndex = min(index, tabs.count - 1)
            activeTabId = tabs[nextIndex].id
            delegate?.tabManagerDidChangeActiveTab(to: tabs[nextIndex])
        }
        
        delegate?.tabManagerDidUpdateTabs()
    }
    
    // MARK: - WKNavigationDelegate
    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard let index = tabs.firstIndex(where: { $0.webView == webView }) else { return }
        tabs[index].isLoading = true
        delegate?.tabManagerDidUpdateTabs()
    }
    
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let index = tabs.firstIndex(where: { $0.webView == webView }) else { return }
        tabs[index].isLoading = false
        tabs[index].url = webView.url
        if let title = webView.title, !title.isEmpty {
            tabs[index].title = title
        } else if let host = webView.url?.host {
            tabs[index].title = host
        }
        delegate?.tabManagerDidUpdateTabs()
    }
    
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard let index = tabs.firstIndex(where: { $0.webView == webView }) else { return }
        tabs[index].isLoading = false
        delegate?.tabManagerDidUpdateTabs()
    }
}
