import AppKit
import WebKit

public final class MainWindowController: NSWindowController, NSWindowDelegate, NSPopoverDelegate, OmniboxViewDelegate, SidebarViewDelegate, TabManagerDelegate, WKWebExtensionWindow {
    
    private var omniboxView: OmniboxView!
    private var sidebarView: SidebarView!
    private var webContainerView: NSView!
    
    private var sidebarLeadingConstraint: NSLayoutConstraint!
    private var isSidebarVisible: Bool = true
    private let sidebarWidth: CGFloat = 320.0
    
    private var bramblePopover: NSPopover?
    private var installSheet: ExtensionInstallSheet?
    private var settingsViewController: BrowserSettingsViewController?
    
    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 1240, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Surffish — \(BrowserProfile.current.displayName)"
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
        // Keep the root transparent so the unified NSVisualEffectView below can
        // actually sample the desktop backdrop. An opaque layer here disables glass.
        contentView.layer?.backgroundColor = NSColor.clear.cgColor
        
        // 1. Unified root glass background (seamless single frame across entire window)
        let rootGlass = NSVisualEffectView()
        rootGlass.material = .underWindowBackground
        rootGlass.blendingMode = .behindWindow
        rootGlass.state = .active
        rootGlass.wantsLayer = true
        rootGlass.translatesAutoresizingMaskIntoConstraints = false

        // One shared tint surface spans the sidebar and toolbar. This avoids the visible
        // material seam caused by giving the two adjacent regions separate backgrounds.
        let frameTint = NSView(frame: rootGlass.bounds)
        frameTint.wantsLayer = true
        let frameGradient = CAGradientLayer()
        frameGradient.colors = [
            NSColor(red: 0.063, green: 0.078, blue: 0.098, alpha: 0.60).cgColor,
            NSColor(red: 0.153, green: 0.180, blue: 0.216, alpha: 0.44).cgColor,
            NSColor(red: 0.071, green: 0.086, blue: 0.106, alpha: 0.56).cgColor
        ]
        frameGradient.locations = [0.0, 0.58, 1.0]
        frameGradient.startPoint = CGPoint(x: 0.5, y: 1.0)
        frameGradient.endPoint = CGPoint(x: 0.5, y: 0.0)
        frameTint.layer = frameGradient
        frameTint.autoresizingMask = [.width, .height]
        rootGlass.addSubview(frameTint)
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
            omniboxView.heightAnchor.constraint(equalToConstant: 50),
            
            // Web view container sits below Omnibox
            webContainerView.leadingAnchor.constraint(equalTo: sidebarView.trailingAnchor, constant: 8),
            webContainerView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
            webContainerView.topAnchor.constraint(equalTo: omniboxView.bottomAnchor, constant: 8),
            webContainerView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
        ])
        
        TabManager.shared.delegate = self
        WebExtensionManager.shared.onExtensionsChanged = { [weak self] _ in
            DispatchQueue.main.async { self?.omniboxView.refreshExtensionButton() }
        }
        let savedSidebarState = BrowserSettingsStore.shared.settings.showSidebarAtStartup
        isSidebarVisible = savedSidebarState
        sidebarLeadingConstraint.constant = savedSidebarState ? 0 : -sidebarWidth

    }

    public func restoreBrowserSession() {
        // Called after SSH routing and native extensions are initialized.
        TabManager.shared.restoreSession()
        setupProgressObserver()
    }

    private var progressObservation: NSKeyValueObservation?
    
    private func setupProgressObserver() {
        guard let active = TabManager.shared.activeTab else { return }
        progressObservation?.invalidate()
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
    @objc public func menuOpenSettings() {
        showSettingsTab()
    }

    private func showSettingsTab() {
        guard let webContainerView else { return }
        if settingsViewController == nil {
            let controller = BrowserSettingsViewController()
            controller.onClose = { [weak self] in self?.showActiveBrowserTab() }
            settingsViewController = controller
        }
        guard let settingsView = settingsViewController?.view else { return }
        webContainerView.subviews.forEach { $0.isHidden = true }
        if settingsView.superview !== webContainerView {
            settingsView.translatesAutoresizingMaskIntoConstraints = false
            webContainerView.addSubview(settingsView)
            NSLayoutConstraint.activate([
                settingsView.topAnchor.constraint(equalTo: webContainerView.topAnchor),
                settingsView.leadingAnchor.constraint(equalTo: webContainerView.leadingAnchor),
                settingsView.trailingAnchor.constraint(equalTo: webContainerView.trailingAnchor),
                settingsView.bottomAnchor.constraint(equalTo: webContainerView.bottomAnchor)
            ])
        }
        settingsView.isHidden = false
        window?.title = "Settings — Surffish · \(BrowserProfile.current.displayName)"
        sidebarView.setSettingsTabActive(true)
    }

    private func showActiveBrowserTab() {
        sidebarView.setSettingsTabActive(false)
        settingsViewController?.view.removeFromSuperview()
        if let active = TabManager.shared.activeTab {
            displayBrowserTab(active)
        }
        window?.title = "Surffish — \(BrowserProfile.current.displayName)"
        sidebarView.reloadTabs()
    }
    @objc public func menuOpenDeveloperTools() { DeveloperConsole.shared.show() }
    @objc public func menuTestAdBlock() { _ = AdBlockManager.shared.toggle() }
    @objc public func menuTestInstallExtension() { showExtensionInstallSheet() }
    @objc public func menuTestTouchID() { runTouchIDTest() }
    @objc public func menuShowDiagnostics() {
        let memory = PerformanceMonitor.shared.memoryUsageMB
        let extensionCount = WebExtensionManager.shared.loadedExtensions.count
        let message = "Resident memory: \(String(format: "%.1f", memory)) MB\nLoaded extensions: \(extensionCount)\nOpen tabs: \(TabManager.shared.tabs.count)"
        let alert = NSAlert()
        alert.messageText = "Surffish Native Diagnostics"
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.runModal()
    }

    // MARK: - TabManagerDelegate
    public func tabManagerDidUpdateTabs() {
        sidebarView.reloadTabs()
        if let active = TabManager.shared.activeTab {
            omniboxView.updateForTab(active)
        }
    }
    
    public func tabManagerDidChangeActiveTab(to tab: TabItem) {
        sidebarView.setSettingsTabActive(false)
        settingsViewController?.view.removeFromSuperview()
        displayBrowserTab(tab)
        window?.title = "Surffish — \(BrowserProfile.current.displayName)"
    }

    private func displayBrowserTab(_ tab: TabItem) {
        progressObservation?.invalidate()
        progressObservation = nil
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
            targetUrl = BrowserSettingsStore.shared.settings.searchEngine.searchURL(for: trimmed)
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
        var settings = BrowserSettingsStore.shared.settings
        settings.showSidebarAtStartup = isSidebarVisible
        BrowserSettingsStore.shared.update(settings)
        TabManager.shared.persistSession()
    }
    
    private func showExtensionInstallSheet() {
        if installSheet == nil {
            installSheet = ExtensionInstallSheet()
        }
        if let sheetWin = installSheet?.window, let win = window {
            win.beginSheet(sheetWin)
        }
    }
    
    public func omniboxDidRequestBramblePopup(sender: NSButton) {
        guard WebExtensionManager.shared.brambleContext != nil else {
            showExtensionInstallSheet()
            return
        }

        if let popover = bramblePopover, popover.isShown {
            popover.performClose(nil)
            bramblePopover = nil
            return
        }
        
        guard let popupWebView = WebExtensionManager.shared.bramblePopupWebView else {
            WebExtensionManager.shared.openBrambleOptionsTab()
            return
        }
        
        // Give the extension popup a predictable, roomy viewport. WebKit can
        // otherwise retain a narrow size from the popup's initial layout.
        let popupSize = NSSize(width: 500, height: 550)
        popupWebView.reload()
        popupWebView.removeFromSuperview()
        popupWebView.translatesAutoresizingMaskIntoConstraints = false

        let popupHost = NSView(frame: NSRect(origin: .zero, size: popupSize))
        popupHost.wantsLayer = true
        popupHost.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        popupHost.addSubview(popupWebView)
        NSLayoutConstraint.activate([
            popupWebView.leadingAnchor.constraint(equalTo: popupHost.leadingAnchor),
            popupWebView.trailingAnchor.constraint(equalTo: popupHost.trailingAnchor),
            popupWebView.topAnchor.constraint(equalTo: popupHost.topAnchor),
            popupWebView.bottomAnchor.constraint(equalTo: popupHost.bottomAnchor)
        ])

        let popover = NSPopover()
        popover.behavior = .transient
        popover.delegate = self
        popover.contentSize = popupSize

        let vc = NSViewController()
        vc.preferredContentSize = popupSize
        vc.view = popupHost
        popover.contentViewController = vc
        popover.contentSize = popupSize
        
        popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .maxY)
        self.bramblePopover = popover
        
        // Make popover window key so inputs and password entry receive keyboard focus
        DispatchQueue.main.async {
            vc.view.window?.makeKey()
        }
    }
    
    public func closeBramblePopover() {
        bramblePopover?.performClose(nil)
        bramblePopover = nil
    }
    
    // MARK: - NSPopoverDelegate
    public func popoverDidClose(_ notification: Notification) {
        WebExtensionManager.shared.brambleContext?.action(for: nil)?.closePopup()
        bramblePopover = nil
    }

    // MARK: - SidebarViewDelegate
    public func sidebarDidSelectTab(id: UUID) { TabManager.shared.selectTab(id: id) }
    public func sidebarDidCloseTab(id: UUID) { TabManager.shared.closeTab(id: id) }
    public func sidebarDidCreateNewTab() { _ = TabManager.shared.createTab() }
    public func sidebarDidTogglePinTab(id: UUID) { TabManager.shared.togglePinned(id: id) }
    public func sidebarDidOpenExtensions() { showExtensionInstallSheet() }
    public func sidebarDidOpenSettings() { menuOpenSettings() }
    public func sidebarDidQuit() { NSApp.terminate(nil) }

    private func runTouchIDTest() {
        BrambleNativeBridge.shared.authenticateWithBiometrics { success, error in
            let alert = NSAlert()
            alert.messageText = success ? "Touch ID test passed" : "Touch ID test failed"
            alert.informativeText = success ? "Authentication completed successfully." : (error ?? "Authentication was cancelled.")
            alert.alertStyle = success ? .informational : .warning
            alert.runModal()
        }
    }

    public func windowWillClose(_ notification: Notification) {
        TabManager.shared.persistSession()
    }
}
