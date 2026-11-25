import AppKit
import QuartzCore
import WebKit

private final class SurffishBrowserWindow: NSWindow {
    weak var titlebarBackgroundView: NSView?

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown,
           event.clickCount == 2,
           let contentView,
           let titlebarBackgroundView {
            let point = contentView.convert(event.locationInWindow, from: nil)
            let titlebarRect = NSRect(
                x: contentView.bounds.minX,
                y: contentView.bounds.maxY - 34,
                width: contentView.bounds.width,
                height: 34
            )
            if titlebarRect.contains(point),
               contentView.hitTest(point) === titlebarBackgroundView {
                zoom(nil)
                return
            }
        }
        super.sendEvent(event)
    }
}

public final class MainWindowController: NSWindowController, NSWindowDelegate, NSPopoverDelegate, OmniboxViewDelegate, SidebarViewDelegate, TabManagerDelegate, WKWebExtensionWindow {
    
    private var omniboxView: OmniboxView!
    private var sidebarView: SidebarView!
    private var webContainerView: NSView!
    
    private var sidebarLeadingConstraint: NSLayoutConstraint!
    private var sidebarWidthConstraint: NSLayoutConstraint!
    private var isSidebarVisible: Bool = true
    private var isSidebarHovered: Bool = false
    private let sidebarWidth: CGFloat = 280.0
    private let collapsedSidebarWidth: CGFloat = 64.0
    
    private var bramblePopover: NSPopover?
    private var installSheet: ExtensionInstallSheet?
    private var settingsViewController: BrowserSettingsViewController?
    
    public init() {
        let window = SurffishBrowserWindow(
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
        window.isMovableByWindowBackground = true
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
        (window as? SurffishBrowserWindow)?.titlebarBackgroundView = omniboxView
        
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
        sidebarWidthConstraint = sidebarView.widthAnchor.constraint(equalToConstant: sidebarWidth)
        sidebarView.onHoverChange = { [weak self] hovering in
            self?.sidebarHoverChanged(hovering)
        }

        NSLayoutConstraint.activate([
            // Root glass fills window
            rootGlass.topAnchor.constraint(equalTo: contentView.topAnchor),
            rootGlass.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            rootGlass.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            rootGlass.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            
            // Sidebar starts below the shared toolbar frame and floats over the page.
            sidebarLeadingConstraint,
            sidebarView.topAnchor.constraint(equalTo: omniboxView.bottomAnchor),
            sidebarView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            sidebarWidthConstraint,
            
            // Omnibox starts to right of sidebar and extends across top
            omniboxView.topAnchor.constraint(equalTo: contentView.topAnchor),
            omniboxView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: collapsedSidebarWidth),
            omniboxView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            omniboxView.heightAnchor.constraint(equalToConstant: 50),
            
            // Web view container sits below Omnibox
            webContainerView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: collapsedSidebarWidth + 8),
            webContainerView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
            webContainerView.topAnchor.constraint(equalTo: omniboxView.bottomAnchor, constant: 8),
            webContainerView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -8),
        ])
        // Keep the page card behind the sidebar while leaving the toolbar (including
        // its only sidebar-toggle button) visible above the panel in both states.
        contentView.addSubview(sidebarView, positioned: .above, relativeTo: webContainerView)
        contentView.addSubview(omniboxView, positioned: .above, relativeTo: sidebarView)
        
        TabManager.shared.delegate = self
        WebExtensionManager.shared.onExtensionsChanged = { [weak self] _ in
            DispatchQueue.main.async { self?.omniboxView.refreshExtensionButton() }
        }
        let savedSidebarState = BrowserSettingsStore.shared.settings.showSidebarAtStartup
        isSidebarVisible = savedSidebarState
        sidebarLeadingConstraint.constant = 0
        sidebarWidthConstraint.constant = savedSidebarState ? sidebarWidth : collapsedSidebarWidth
        sidebarView.setCollapsed(!savedSidebarState)

    }

    public func restoreBrowserSession() {
        // Called after SSH routing and native extensions are initialized.
        AdBlockManager.shared.setEnabled(BrowserSettingsStore.shared.settings.adBlockingEnabled)
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
    @objc public func menuShowTabs() { omniboxDidShowTabs() }
    @objc public func menuShowHistory() { omniboxDidShowHistory() }
    @objc public func menuShowBookmarks() { omniboxDidShowBookmarks() }
    @objc public func menuOpenSettings() {
        showSettingsTab()
    }

    private func showSettingsTab() {
        guard let webContainerView else { return }
        if settingsViewController == nil {
            let controller = BrowserSettingsViewController()
            controller.onClose = { [weak self] in self?.showActiveBrowserTab() }
            controller.onInstallExtension = { [weak self] in self?.showExtensionInstallSheet() }
            controller.onSettingsSaved = { [weak self] settings in self?.settingsDidChange(settings) }
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
        updateSidebarWidth(animated: true)
        var settings = BrowserSettingsStore.shared.settings
        settings.showSidebarAtStartup = isSidebarVisible
        BrowserSettingsStore.shared.update(settings)
        TabManager.shared.persistSession()
    }

    public func omniboxDidShowTabs() {
        revealSidebarForLibrary()
        sidebarView.showTabs()
    }

    public func omniboxDidShowHistory() {
        revealSidebarForLibrary()
        sidebarView.showHistory()
    }

    public func omniboxDidShowBookmarks() {
        revealSidebarForLibrary()
        sidebarView.showBookmarks()
    }

    public func omniboxDidToggleBookmark() {
        guard let tab = TabManager.shared.activeTab,
              let url = tab.webView.url ?? tab.url else { return }
        _ = BrowserLibraryStore.shared.toggleBookmark(url: url, title: tab.webView.title ?? tab.title)
        sidebarView.reloadTabs()
        omniboxView.updateForTab(tab)
    }

    private func revealSidebarForLibrary() {
        if settingsViewController?.view.superview != nil {
            showActiveBrowserTab()
        }
        if !isSidebarVisible {
            isSidebarVisible = true
            var settings = BrowserSettingsStore.shared.settings
            settings.showSidebarAtStartup = true
            BrowserSettingsStore.shared.update(settings)
            updateSidebarWidth(animated: true)
        }
    }

    private func settingsDidChange(_ settings: BrowserSettings) {
        guard isSidebarVisible != settings.showSidebarAtStartup else { return }
        isSidebarVisible = settings.showSidebarAtStartup
        updateSidebarWidth(animated: true)
    }

    private func sidebarHoverChanged(_ hovering: Bool) {
        isSidebarHovered = hovering
        guard !isSidebarVisible else { return }
        updateSidebarWidth(animated: true)
    }

    private func updateSidebarWidth(animated: Bool) {
        let expanded = isSidebarVisible || isSidebarHovered
        sidebarWidthConstraint.constant = expanded ? sidebarWidth : collapsedSidebarWidth
        sidebarView.setCollapsed(!expanded)
        let changes = { self.window?.contentView?.layoutSubtreeIfNeeded() }
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.34
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1.0, 0.3, 1.0)
                context.allowsImplicitAnimation = true
                changes()
            }
        } else {
            changes()
        }
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
        if NSEvent.modifierFlags.contains(.option) {
            showSettingsTab()
            return
        }
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
    
    public func omniboxDidRequestExtensionManagement() { showSettingsTab() }

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
    public func sidebarDidOpenExtensions() { menuOpenSettings() }
    public func sidebarDidOpenSettings() { menuOpenSettings() }
    public func sidebarDidQuit() { NSApp.terminate(nil) }
    public func sidebarDidOpenLibraryURL(_ url: URL) {
        guard let tab = TabManager.shared.activeTab else { return }
        tab.webView.load(URLRequest(url: url))
    }
    public func sidebarDidRemoveBookmark(id: UUID) {
        BrowserLibraryStore.shared.removeBookmark(id: id)
        sidebarView.reloadTabs()
        if let tab = TabManager.shared.activeTab { omniboxView.updateForTab(tab) }
    }
    public func sidebarDidClearHistory() {
        BrowserLibraryStore.shared.clearHistory()
        sidebarView.reloadTabs()
    }

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
