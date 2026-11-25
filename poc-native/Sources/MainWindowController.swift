import AppKit
import QuartzCore
import SwiftUI
import WebKit

private final class SurffishBrowserWindow: NSWindow {
    weak var titlebarBackgroundView: NSView?

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown,
           event.clickCount == 2,
           let contentView,
           let titlebarBackgroundView {
            let hitView = contentView.hitTest(contentView.convert(event.locationInWindow, from: nil))
            var viewIsToolbarDescendant = false
            var ancestor = hitView
            while let current = ancestor {
                if current === titlebarBackgroundView {
                    viewIsToolbarDescendant = true
                    break
                }
                ancestor = current.superview
            }
            let point = contentView.convert(event.locationInWindow, from: nil)
            let titlebarRect = NSRect(
                x: contentView.bounds.minX,
                y: contentView.bounds.maxY - 34,
                width: contentView.bounds.width,
                height: 34
            )
            if titlebarRect.contains(point),
               viewIsToolbarDescendant {
                zoom(nil)
                return
            }
        }
        super.sendEvent(event)
    }
}

public final class MainWindowController: NSWindowController, NSWindowDelegate, NSMenuItemValidation, NSPopoverDelegate, OmniboxViewDelegate, SidebarViewDelegate, TabManagerDelegate, FindBarViewDelegate, WKWebExtensionWindow {
    
    private var omniboxView: OmniboxView!
    private var sidebarView: SidebarView!
    private var webContainerView: NSView!
    private var findBarView: FindBarView!
    private var shellHostingView: NSHostingView<BrowserShellView>!
    private let shellLayoutModel = BrowserShellLayoutModel()

    private var isSidebarVisible: Bool = true
    private var isSidebarHovered: Bool = false
    private var isSidebarFocused: Bool = false
    private var isSidebarRevealRequested: Bool = false
    private var isSidebarPinned: Bool = false
    private var sidebarRevealTask: Task<Void, Never>?
    private var sidebarWidth: CGFloat = 280.0
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
        
        // 2. AppKit/WebKit surfaces hosted by the SwiftUI-first browser shell.
        sidebarView = SidebarView(frame: .zero)
        sidebarView.delegate = self
        sidebarView.onHoverChange = { [weak self] hovering in
            self?.sidebarHoverChanged(hovering)
        }
        sidebarView.onFocusChange = { [weak self] focused in
            self?.sidebarFocusChanged(focused)
        }

        // 3. Top Omnibox / Toolbar (the one persistent collapse control).
        omniboxView = OmniboxView(frame: .zero)
        omniboxView.delegate = self
        (window as? SurffishBrowserWindow)?.titlebarBackgroundView = omniboxView
        
        // 4. Web Content Container (inset dark rounded card)
        webContainerView = NSView()
        webContainerView.wantsLayer = true
        webContainerView.layer?.cornerRadius = 10
        webContainerView.layer?.masksToBounds = true
        webContainerView.layer?.borderColor = NSColor(white: 1.0, alpha: 0.12).cgColor
        webContainerView.layer?.borderWidth = 1
        webContainerView.layer?.backgroundColor = NSColor(red: 0.10, green: 0.11, blue: 0.13, alpha: 1.0).cgColor

        findBarView = FindBarView(frame: .zero)
        findBarView.delegate = self
        findBarView.translatesAutoresizingMaskIntoConstraints = false
        findBarView.isHidden = true
        webContainerView.addSubview(findBarView)

        let savedSettings = BrowserSettingsStore.shared.settings
        sidebarWidth = CGFloat(savedSettings.sidebarWidth)
        isSidebarPinned = savedSettings.sidebarPinned
        isSidebarVisible = savedSettings.showSidebarAtStartup
        shellLayoutModel.sidebarWidth = sidebarWidth
        shellLayoutModel.onSidebarWidthCommitted = { [weak self] width in
            self?.sidebarWidthDidChange(width)
        }
        sidebarView.setPinned(isSidebarPinned)
        shellHostingView = NSHostingView(rootView: BrowserShellView(
            layout: shellLayoutModel,
            toolbar: omniboxView,
            sidebar: sidebarView,
            pageCard: webContainerView
        ))
        shellHostingView.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(shellHostingView)
        NSLayoutConstraint.activate([
            rootGlass.topAnchor.constraint(equalTo: contentView.topAnchor),
            rootGlass.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            rootGlass.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            rootGlass.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            shellHostingView.topAnchor.constraint(equalTo: contentView.topAnchor),
            shellHostingView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            shellHostingView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            shellHostingView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            findBarView.topAnchor.constraint(equalTo: webContainerView.topAnchor, constant: 12),
            findBarView.trailingAnchor.constraint(equalTo: webContainerView.trailingAnchor, constant: -12),
            findBarView.widthAnchor.constraint(equalToConstant: 420),
            findBarView.heightAnchor.constraint(equalToConstant: 42)
        ])
        
        TabManager.shared.delegate = self
        WebExtensionManager.shared.onExtensionsChanged = { [weak self] _ in
            DispatchQueue.main.async { self?.omniboxView.refreshExtensionButton() }
        }
        updateSidebarWidth(animated: false)

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
    @objc public func menuFind() { showFindBar() }
    @objc public func menuFindNext() {
        if findBarView.isHidden { showFindBar() }
        findBarView.findNextOccurrence()
    }
    @objc public func menuFindPrevious() {
        if findBarView.isHidden { showFindBar() }
        findBarView.findPreviousOccurrence()
    }
    @objc public func menuReopenClosedTab() { _ = TabManager.shared.reopenClosedTab() }
    @objc public func menuDuplicateActiveTab() {
        if let id = TabManager.shared.activeTabId { _ = TabManager.shared.duplicateTab(id: id) }
    }
    public func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(MainWindowController.menuReopenClosedTab) {
            return TabManager.shared.canReopenClosedTab
        }
        return true
    }
    @objc public func menuToggleSidebar() { omniboxDidToggleSidebar() }
    @objc public func menuFocusAddress() { omniboxView.focusAddressField() }
    @objc public func menuShowTabs() { omniboxDidShowTabs() }
    @objc public func menuShowHistory() { omniboxDidShowHistory() }
    @objc public func menuShowBookmarks() { omniboxDidShowBookmarks() }
    @objc public func menuShowReadingList() { omniboxDidShowReadingList() }
    @objc public func menuOpenSettings() {
        showSettingsTab()
    }

    private func showFindBar() {
        if settingsViewController?.view.superview != nil { showActiveBrowserTab() }
        guard TabManager.shared.activeTab != nil else { return }
        findBarView.isHidden = false
        findBarView.focusAndSelectAll()
    }

    private func searchInPage(_ query: String, backwards: Bool) {
        guard !query.isEmpty, let tab = TabManager.shared.activeTab else {
            findBarView.setStatus("")
            return
        }
        let configuration = WKFindConfiguration()
        configuration.caseSensitive = false
        configuration.wraps = true
        configuration.backwards = backwards
        tab.webView.find(query, configuration: configuration) { [weak self] result in
            DispatchQueue.main.async {
                self?.findBarView.setStatus(result.matchFound ? "Found" : "No matches")
            }
        }
    }

    public func findBar(_ findBar: FindBarView, didSearch query: String, backwards: Bool) {
        searchInPage(query, backwards: backwards)
    }

    public func findBarDidClose(_ findBar: FindBarView) {
        findBarView.isHidden = true
        if let active = TabManager.shared.activeTab { window?.makeFirstResponder(active.webView) }
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
        webContainerView.subviews.forEach { if $0 !== findBarView { $0.removeFromSuperview() } }

        tab.webView.translatesAutoresizingMaskIntoConstraints = false
        webContainerView.addSubview(tab.webView)

        NSLayoutConstraint.activate([
            tab.webView.topAnchor.constraint(equalTo: webContainerView.topAnchor),
            tab.webView.leadingAnchor.constraint(equalTo: webContainerView.leadingAnchor),
            tab.webView.trailingAnchor.constraint(equalTo: webContainerView.trailingAnchor),
            tab.webView.bottomAnchor.constraint(equalTo: webContainerView.bottomAnchor),
        ])
        webContainerView.addSubview(findBarView, positioned: .above, relativeTo: tab.webView)

        setupProgressObserver()
        omniboxView.updateForTab(tab)
        sidebarView.reloadTabs()
        if !findBarView.isHidden { searchInPage(findBarView.query, backwards: false) }
    }
    
    // MARK: - OmniboxViewDelegate
    public func omniboxDidSubmit(input: String) {
        guard let active = TabManager.shared.activeTab else { return }
        var targetUrl: URL?
        
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") || trimmed.hasPrefix("webkit-extension://") || trimmed.hasPrefix("surffish://newtab") {
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
        if isSidebarPinned {
            isSidebarPinned = false
            sidebarView.setPinned(false)
        }
        isSidebarVisible.toggle()
        isSidebarRevealRequested = false
        if !isSidebarVisible && sidebarView.requiresExpandedPanel {
            sidebarView.showTabs()
        }
        updateSidebarWidth(animated: true)
        var settings = BrowserSettingsStore.shared.settings
        settings.showSidebarAtStartup = isSidebarVisible
        settings.sidebarPinned = isSidebarPinned
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

    public func omniboxDidShowReadingList() {
        revealSidebarForLibrary()
        sidebarView.showReadingList()
    }

    public func omniboxDidToggleBookmark() {
        guard let tab = TabManager.shared.activeTab,
              let url = tab.webView.url ?? tab.url else { return }
        _ = BrowserLibraryStore.shared.toggleBookmark(url: url, title: tab.webView.title ?? tab.title)
        sidebarView.reloadTabs()
        omniboxView.updateForTab(tab)
    }

    public func omniboxDidToggleReadingList() {
        guard let tab = TabManager.shared.activeTab,
              !tab.isPrivate,
              let url = tab.webView.url ?? tab.url,
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
        _ = BrowserLibraryStore.shared.toggleReadingList(url: url, title: tab.webView.title ?? tab.title)
        sidebarView.reloadTabs()
        omniboxView.updateForTab(tab)
    }

    private func revealSidebarForLibrary() {
        if settingsViewController?.view.superview != nil {
            showActiveBrowserTab()
        }
        if !isSidebarVisible {
            isSidebarVisible = true
            isSidebarRevealRequested = false
            var settings = BrowserSettingsStore.shared.settings
            settings.showSidebarAtStartup = true
            BrowserSettingsStore.shared.update(settings)
            updateSidebarWidth(animated: true)
        }
    }

    private func settingsDidChange(_ settings: BrowserSettings) {
        isSidebarVisible = settings.showSidebarAtStartup
        isSidebarPinned = settings.sidebarPinned
        sidebarWidth = CGFloat(settings.sidebarWidth)
        sidebarView.setPinned(isSidebarPinned)
        updateSidebarWidth(animated: true)
        for tab in TabManager.shared.tabs where tab.webView.url?.scheme == "surffish" && tab.webView.url?.host == "newtab" {
            tab.webView.reload()
        }
    }

    private func sidebarHoverChanged(_ hovering: Bool) {
        sidebarRevealTask?.cancel()
        if hovering {
            isSidebarHovered = true
            updateSidebarWidth(animated: true)
            return
        }
        sidebarRevealTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard let self, !Task.isCancelled else { return }
            self.isSidebarHovered = false
            self.updateSidebarWidth(animated: true)
        }
    }

    private func sidebarFocusChanged(_ focused: Bool) {
        isSidebarFocused = focused
        if !focused && !isSidebarHovered {
            isSidebarRevealRequested = false
        }
        updateSidebarWidth(animated: true)
    }

    private func updateSidebarWidth(animated: Bool) {
        let expanded = isSidebarVisible || isSidebarPinned || isSidebarHovered || isSidebarFocused
            || isSidebarRevealRequested || sidebarView.requiresExpandedPanel
        shellLayoutModel.sidebarWidth = expanded ? sidebarWidth : collapsedSidebarWidth
        sidebarView.setCollapsed(!expanded)
        window?.contentView?.layoutSubtreeIfNeeded()
    }

    private func sidebarWidthDidChange(_ width: CGFloat) {
        sidebarWidth = min(
            max(width, CGFloat(BrowserSettings.minimumSidebarWidth)),
            CGFloat(BrowserSettings.maximumSidebarWidth)
        )
        var settings = BrowserSettingsStore.shared.settings
        settings.sidebarWidth = Int(sidebarWidth.rounded())
        BrowserSettingsStore.shared.update(settings)
        settingsViewController?.synchronizeSidebarSettings(isPinned: isSidebarPinned, width: sidebarWidth)
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
    public func sidebarDidDuplicateTab(id: UUID) { _ = TabManager.shared.duplicateTab(id: id) }
    public func sidebarDidTogglePinTab(id: UUID) { TabManager.shared.togglePinned(id: id) }
    public func sidebarDidOpenExtensions() { menuOpenSettings() }
    public func sidebarDidOpenSettings() { menuOpenSettings() }
    public func sidebarDidQuit() { NSApp.terminate(nil) }
    public func sidebarDidRequestReveal() {
        isSidebarRevealRequested = true
        updateSidebarWidth(animated: true)
    }
    public func sidebarDidTogglePinSidebar() {
        isSidebarPinned.toggle()
        sidebarView.setPinned(isSidebarPinned)
        var settings = BrowserSettingsStore.shared.settings
        settings.sidebarPinned = isSidebarPinned
        BrowserSettingsStore.shared.update(settings)
        settingsViewController?.synchronizeSidebarSettings(isPinned: isSidebarPinned, width: sidebarWidth)
        updateSidebarWidth(animated: true)
    }
    public func sidebarDidOpenLibraryURL(_ url: URL) {
        guard let tab = TabManager.shared.activeTab else {
            _ = TabManager.shared.createTab(url: url, makeActive: true)
            return
        }
        tab.webView.load(URLRequest(url: url))
    }
    public func sidebarDidRemoveBookmark(id: UUID) {
        BrowserLibraryStore.shared.removeBookmark(id: id)
        sidebarView.reloadTabs()
        if let tab = TabManager.shared.activeTab { omniboxView.updateForTab(tab) }
    }
    public func sidebarDidToggleBookmarkPin(id: UUID) {
        _ = BrowserLibraryStore.shared.togglePinnedBookmark(id: id)
        sidebarView.reloadTabs()
    }
    public func sidebarDidClearHistory() {
        BrowserLibraryStore.shared.clearHistory()
        sidebarView.reloadTabs()
    }

    public func sidebarDidOpenReadingListEntry(id: UUID, url: URL) {
        BrowserLibraryStore.shared.setReadingListRead(id: id, isRead: true)
        sidebarView.reloadTabs()
        sidebarDidOpenLibraryURL(url)
    }
    public func sidebarDidToggleReadingListRead(id: UUID) {
        guard let entry = BrowserLibraryStore.shared.readingList.first(where: { $0.id == id }) else { return }
        BrowserLibraryStore.shared.setReadingListRead(id: id, isRead: !entry.isRead)
        sidebarView.reloadTabs()
    }
    public func sidebarDidRemoveReadingListEntry(id: UUID) {
        BrowserLibraryStore.shared.removeReadingListEntry(id: id)
        sidebarView.reloadTabs()
        if let tab = TabManager.shared.activeTab { omniboxView.updateForTab(tab) }
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
