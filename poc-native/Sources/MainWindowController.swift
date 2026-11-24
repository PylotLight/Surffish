import AppKit
import WebKit

public final class MainWindowController: NSWindowController, NSWindowDelegate, OmniboxViewDelegate, SidebarViewDelegate, TabManagerDelegate, WKWebExtensionWindow {
    
    private var omniboxView: OmniboxView!
    private var sidebarView: SidebarView!
    private var webContainerView: NSView!
    
    private var sidebarLeadingConstraint: NSLayoutConstraint!
    private var isSidebarVisible: Bool = true
    private let sidebarWidth: CGFloat = 260.0
    
    private var bramblePopover: NSPopover?
    private var installSheet: ExtensionInstallSheet?
    
    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 1240, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Surffish Native"
        window.isOpaque = false
        window.backgroundColor = .clear // Enables true macOS desktop glass blur
        window.hasShadow = true
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 860, height: 540)
        
        super.init(window: window)
        window.delegate = self
        setupUI()
    }
    
    public required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupUI() {
        guard let window = window, let contentView = window.contentView else { return }
        contentView.wantsLayer = true
        
        // 1. Unified root glass background (seamless single frame across entire window)
        let rootGlass = NSVisualEffectView()
        rootGlass.material = .underWindowBackground
        rootGlass.blendingMode = .behindWindow
        rootGlass.state = .active
        rootGlass.wantsLayer = true
        rootGlass.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(rootGlass)
        
        // 2. Full-height Left Sidebar (traffic lights sit inside top of sidebar)
        sidebarView = SidebarView(frame: .zero)
        sidebarView.delegate = self
        sidebarView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(sidebarView)
        
        // 3. Top Omnibox / Toolbar (aligned to right of sidebar)
        omniboxView = OmniboxView(frame: .zero)
        omniboxView.delegate = self
        omniboxView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(omniboxView)
        
        // 4. Web Content Container (inset dark rounded card)
        webContainerView = NSView()
        webContainerView.wantsLayer = true
        webContainerView.layer?.cornerRadius = 10
        webContainerView.layer?.masksToBounds = true
        webContainerView.layer?.borderColor = NSColor(white: 1.0, alpha: 0.12).cgColor
        webContainerView.layer?.borderWidth = 1
        webContainerView.layer?.backgroundColor = NSColor(red: 0.10, green: 0.11, blue: 0.13, alpha: 1.0).cgColor
        webContainerView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(webContainerView)
        
        // Constraints: Single unified frame!
        sidebarLeadingConstraint = sidebarView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor)
        
        NSLayoutConstraint.activate([
            // Root glass fills window
            rootGlass.topAnchor.constraint(equalTo: contentView.topAnchor),
            rootGlass.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            rootGlass.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            rootGlass.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            
            // Sidebar is full height on the left
            sidebarLeadingConstraint,
            sidebarView.topAnchor.constraint(equalTo: contentView.topAnchor),
            sidebarView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            sidebarView.widthAnchor.constraint(equalToConstant: sidebarWidth),
            
            // Omnibox starts to right of sidebar and extends across top
            omniboxView.topAnchor.constraint(equalTo: contentView.topAnchor),
            omniboxView.leadingAnchor.constraint(equalTo: sidebarView.trailingAnchor),
            omniboxView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            omniboxView.heightAnchor.constraint(equalToConstant: 46),
            
            // Web view container sits below Omnibox
            webContainerView.leadingAnchor.constraint(equalTo: sidebarView.trailingAnchor, constant: 6),
            webContainerView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
            webContainerView.topAnchor.constraint(equalTo: omniboxView.bottomAnchor, constant: 4),
            webContainerView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
        ])
        
        TabManager.shared.delegate = self
        WebExtensionManager.shared.onExtensionsChanged = { [weak self] exts in
            self?.sidebarView.updateExtensions(exts)
        }
        
        // Create initial tab
        _ = TabManager.shared.createTab(url: URL(string: "https://news.ycombinator.com"))
        setupProgressObserver()
    }
    
    private var progressObservation: NSKeyValueObservation?
    
    private func setupProgressObserver() {
        guard let active = TabManager.shared.activeTab else { return }
        progressObservation = active.webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                if let tab = TabManager.shared.activeTab {
                    self?.omniboxView.updateForTab(tab)
                }
            }
        }
    }
    
    // MARK: - WKWebExtensionWindow
    public func tabs(for context: WKWebExtensionContext) -> [WKWebExtensionTab] {
        return TabManager.shared.tabs
    }
    
    public func activeTab(for context: WKWebExtensionContext) -> WKWebExtensionTab? {
        return TabManager.shared.activeTab
    }
    
    // MARK: - Menu Actions
    @objc public func menuNewTab() { sidebarDidCreateNewTab() }
    @objc public func menuCloseTab() {
        if let id = TabManager.shared.activeTabId {
            sidebarDidCloseTab(id: id)
        }
    }
    @objc public func menuReload() { omniboxDidClickReload() }
    @objc public func menuToggleSidebar() { omniboxDidToggleSidebar() }
    @objc public func menuFocusAddress() { omniboxView.focusAddressField() }
    
    // MARK: - TabManagerDelegate
    public func tabManagerDidUpdateTabs() {
        sidebarView.reloadTabs()
        if let active = TabManager.shared.activeTab {
            omniboxView.updateForTab(active)
        }
    }
    
    public func tabManagerDidChangeActiveTab(to tab: TabItem) {
        webContainerView.subviews.forEach { $0.removeFromSuperview() }
        
        tab.webView.translatesAutoresizingMaskIntoConstraints = false
        webContainerView.addSubview(tab.webView)
        
        NSLayoutConstraint.activate([
            tab.webView.topAnchor.constraint(equalTo: webContainerView.topAnchor),
            tab.webView.leadingAnchor.constraint(equalTo: webContainerView.leadingAnchor),
            tab.webView.trailingAnchor.constraint(equalTo: webContainerView.trailingAnchor),
            tab.webView.bottomAnchor.constraint(equalTo: webContainerView.bottomAnchor),
        ])
        
        setupProgressObserver()
        omniboxView.updateForTab(tab)
        sidebarView.reloadTabs()
    }
    
    // MARK: - OmniboxViewDelegate
    public func omniboxDidSubmit(input: String) {
        guard let active = TabManager.shared.activeTab else { return }
        var targetUrl: URL?
        
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") || trimmed.hasPrefix("webkit-extension://") {
            targetUrl = URL(string: trimmed)
        } else if trimmed.contains(".") && !trimmed.contains(" ") {
            targetUrl = URL(string: "https://" + trimmed)
        } else if trimmed.hasPrefix("localhost:") || trimmed == "localhost" {
            targetUrl = URL(string: "http://" + trimmed)
        } else {
            let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            targetUrl = URL(string: "https://duckduckgo.com/?q=\(encoded)")
        }
        
        if let url = targetUrl {
            if url.scheme == "webkit-extension" {
                _ = TabManager.shared.createTab(url: url, makeActive: true)
            } else {
                active.webView.load(URLRequest(url: url))
            }
        }
    }
    
    public func omniboxDidClickBack() { TabManager.shared.activeTab?.webView.goBack() }
    public func omniboxDidClickForward() { TabManager.shared.activeTab?.webView.goForward() }
    public func omniboxDidClickReload() {
        guard let tab = TabManager.shared.activeTab else { return }
        if tab.isLoading {
            tab.webView.stopLoading()
        } else {
            tab.webView.reload()
        }
    }
    
    public func omniboxDidToggleSidebar() {
        isSidebarVisible.toggle()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.22
            context.allowsImplicitAnimation = true
            sidebarLeadingConstraint.constant = isSidebarVisible ? 0 : -sidebarWidth
            window?.contentView?.layoutSubtreeIfNeeded()
        }
    }
    
    public func omniboxDidToggleAdBlock() {
        let active = AdBlockManager.shared.toggle()
        sidebarView.updateAdBlock(enabled: active)
    }
    
    public func omniboxDidRequestInstallExtension() {
        if installSheet == nil {
            installSheet = ExtensionInstallSheet()
        }
        if let sheetWin = installSheet?.window, let win = window {
            win.beginSheet(sheetWin)
        }
    }
    
    public func omniboxDidRequestBramblePopup(sender: NSButton) {
        if let popover = bramblePopover, popover.isShown {
            popover.performClose(nil)
            return
        }
        
        guard let popupWebView = WebExtensionManager.shared.bramblePopupWebView else {
            WebExtensionManager.shared.openBrambleOptionsTab()
            return
        }
        
        let popover = NSPopover()
        popover.behavior = .transient
        // Bramble's native dimensions: 500 x 550
        popover.contentSize = NSSize(width: 500, height: 550)
        
        let vc = NSViewController()
        vc.view = popupWebView
        popover.contentViewController = vc
        
        popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .maxY)
        self.bramblePopover = popover
        
        // Make popover window key so inputs and password entry receive keyboard focus
        DispatchQueue.main.async {
            vc.view.window?.makeKey()
        }
    }
    
    public func closeBramblePopover() {
        bramblePopover?.performClose(nil)
    }

    // MARK: - SidebarViewDelegate
    public func sidebarDidSelectTab(id: UUID) { TabManager.shared.selectTab(id: id) }
    public func sidebarDidCloseTab(id: UUID) { TabManager.shared.closeTab(id: id) }
    public func sidebarDidCreateNewTab() { _ = TabManager.shared.createTab() }
    public func sidebarDidToggleAdBlock() { omniboxDidToggleAdBlock() }
    public func sidebarDidRequestInstallExtension() { omniboxDidRequestInstallExtension() }
    public func sidebarDidRequestOpenBrambleVault() { WebExtensionManager.shared.openBrambleOptionsTab() }
    
    public func sidebarDidTestBiometrics() {
        sidebarView.updateBiometrics(message: "Prompting Touch ID...", success: true)
        BrambleNativeBridge.shared.authenticateWithBiometrics { [weak self] success, err in
            if success {
                self?.sidebarView.updateBiometrics(message: "✓ Touch ID Verified!", success: true)
            } else {
                self?.sidebarView.updateBiometrics(message: "✗ Failed: \(err ?? "Cancelled")", success: false)
            }
        }
    }
}
