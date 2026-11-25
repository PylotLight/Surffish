import AppKit
import WebKit

public protocol OmniboxViewDelegate: AnyObject {
    func omniboxDidSubmit(input: String)
    func omniboxDidClickBack()
    func omniboxDidClickForward()
    func omniboxDidClickReload()
    func omniboxDidToggleSidebar()
    func omniboxDidShowTabs()
    func omniboxDidShowHistory()
    func omniboxDidShowBookmarks()
    func omniboxDidShowReadingList()
    func omniboxDidToggleBookmark()
    func omniboxDidToggleReadingList()
    func omniboxDidRequestBramblePopup(sender: NSButton)
    func omniboxDidRequestExtensionManagement()
}

private final class ExtensionToolbarButton: NSButton {
    var contextMenu: NSMenu?

    override func rightMouseDown(with event: NSEvent) {
        guard let menu = contextMenu else {
            super.rightMouseDown(with: event)
            return
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.height), in: self)
    }
}

public final class OmniboxView: NSVisualEffectView, NSTextFieldDelegate {
    public weak var delegate: OmniboxViewDelegate?

    private let sidebarToggleBtn = NSButton()
    private let backBtn = NSButton()
    private let forwardBtn = NSButton()
    private let reloadBtn = NSButton()
    private let tabsBtn = NSButton()
    private let historyBtn = NSButton()
    private let bookmarksBtn = NSButton()
    private let readingListBtn = NSButton()
    private let bookmarkBtn = NSButton()
    private let readingListSaveBtn = NSButton()

    private let pillContainer = NSView()
    private let securityIcon = NSImageView()
    private let addressField = NSTextField()
    private let progressBar = NSProgressIndicator()

    private let brambleBtn = ExtensionToolbarButton()

    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupView()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupView()
    }

    private func setupView() {
        material = .underWindowBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true

        configureButton(sidebarToggleBtn, symbol: "sidebar.left", label: "Toggle Sidebar", action: #selector(onToggleSidebar))
        sidebarToggleBtn.toolTip = "Toggle Sidebar (Cmd+\\)"

        configureButton(backBtn, symbol: "chevron.left", label: "Back", action: #selector(onBack))
        configureButton(forwardBtn, symbol: "chevron.right", label: "Forward", action: #selector(onForward))
        configureButton(reloadBtn, symbol: "arrow.clockwise", label: "Reload", action: #selector(onReload))
        configureButton(tabsBtn, symbol: "square.stack", label: "Tabs", action: #selector(onTabs))
        configureButton(historyBtn, symbol: "clock.arrow.circlepath", label: "History", action: #selector(onHistory))
        configureButton(bookmarksBtn, symbol: "bookmark", label: "Bookmarks", action: #selector(onBookmarks))
        configureButton(readingListBtn, symbol: "text.book.closed", label: "Reading List", action: #selector(onReadingList))
        configureButton(bookmarkBtn, symbol: "bookmark", label: "Bookmark this page", action: #selector(onToggleBookmark))
        configureButton(readingListSaveBtn, symbol: "text.badge.plus", label: "Save for later", action: #selector(onToggleReadingList))

        pillContainer.wantsLayer = true
        pillContainer.layer?.backgroundColor = NSColor(white: 0.12, alpha: 0.52).cgColor
        pillContainer.layer?.cornerRadius = 11
        pillContainer.layer?.borderColor = NSColor(white: 1.0, alpha: 0.10).cgColor
        pillContainer.layer?.borderWidth = 1
        pillContainer.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pillContainer)

        securityIcon.imageScaling = .scaleProportionallyDown
        securityIcon.contentTintColor = .secondaryLabelColor
        securityIcon.translatesAutoresizingMaskIntoConstraints = false
        pillContainer.addSubview(securityIcon)

        addressField.isBordered = false
        addressField.drawsBackground = false
        addressField.focusRingType = .none
        addressField.font = NSFont.systemFont(ofSize: 13, weight: .regular)
        addressField.textColor = .labelColor
        addressField.placeholderString = "Search or enter address"
        addressField.target = self
        addressField.action = #selector(onFieldSubmit)
        addressField.delegate = self
        addressField.translatesAutoresizingMaskIntoConstraints = false
        pillContainer.addSubview(addressField)

        progressBar.style = .bar
        progressBar.isIndeterminate = false
        progressBar.minValue = 0.0
        progressBar.maxValue = 1.0
        progressBar.doubleValue = 0.0
        progressBar.isHidden = true
        progressBar.controlSize = .mini
        progressBar.translatesAutoresizingMaskIntoConstraints = false
        pillContainer.addSubview(progressBar)

        configureButton(brambleBtn, title: "🫐", label: "Bramble Password Manager", action: #selector(onBrambleClicked))
        let extensionMenu = NSMenu()
        extensionMenu.addItem(withTitle: "Manage Extensions…", action: #selector(onManageExtensions), keyEquivalent: "")
        extensionMenu.addItem(.separator())
        extensionMenu.addItem(withTitle: "Open Bramble", action: #selector(onBrambleClicked), keyEquivalent: "")
        extensionMenu.items.forEach { $0.target = self }
        brambleBtn.contextMenu = extensionMenu

        NSLayoutConstraint.activate([
            sidebarToggleBtn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            sidebarToggleBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            sidebarToggleBtn.widthAnchor.constraint(equalToConstant: 30),
            sidebarToggleBtn.heightAnchor.constraint(equalToConstant: 30),

            backBtn.leadingAnchor.constraint(equalTo: sidebarToggleBtn.trailingAnchor, constant: 4),
            backBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            backBtn.widthAnchor.constraint(equalToConstant: 28),
            backBtn.heightAnchor.constraint(equalToConstant: 30),

            forwardBtn.leadingAnchor.constraint(equalTo: backBtn.trailingAnchor, constant: 2),
            forwardBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            forwardBtn.widthAnchor.constraint(equalToConstant: 28),
            forwardBtn.heightAnchor.constraint(equalToConstant: 30),

            reloadBtn.leadingAnchor.constraint(equalTo: forwardBtn.trailingAnchor, constant: 2),
            reloadBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            reloadBtn.widthAnchor.constraint(equalToConstant: 28),
            reloadBtn.heightAnchor.constraint(equalToConstant: 30),

            tabsBtn.leadingAnchor.constraint(equalTo: reloadBtn.trailingAnchor, constant: 2),
            tabsBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            tabsBtn.widthAnchor.constraint(equalToConstant: 28),
            tabsBtn.heightAnchor.constraint(equalToConstant: 30),

            historyBtn.leadingAnchor.constraint(equalTo: tabsBtn.trailingAnchor, constant: 2),
            historyBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            historyBtn.widthAnchor.constraint(equalToConstant: 28),
            historyBtn.heightAnchor.constraint(equalToConstant: 30),

            bookmarksBtn.leadingAnchor.constraint(equalTo: historyBtn.trailingAnchor, constant: 2),
            bookmarksBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            bookmarksBtn.widthAnchor.constraint(equalToConstant: 28),
            bookmarksBtn.heightAnchor.constraint(equalToConstant: 30),

            readingListBtn.leadingAnchor.constraint(equalTo: bookmarksBtn.trailingAnchor, constant: 2),
            readingListBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            readingListBtn.widthAnchor.constraint(equalToConstant: 28),
            readingListBtn.heightAnchor.constraint(equalToConstant: 30),

            bookmarkBtn.leadingAnchor.constraint(equalTo: readingListBtn.trailingAnchor, constant: 2),
            bookmarkBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            bookmarkBtn.widthAnchor.constraint(equalToConstant: 28),
            bookmarkBtn.heightAnchor.constraint(equalToConstant: 30),

            readingListSaveBtn.leadingAnchor.constraint(equalTo: bookmarkBtn.trailingAnchor, constant: 2),
            readingListSaveBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            readingListSaveBtn.widthAnchor.constraint(equalToConstant: 28),
            readingListSaveBtn.heightAnchor.constraint(equalToConstant: 30),

            pillContainer.leadingAnchor.constraint(equalTo: readingListSaveBtn.trailingAnchor, constant: 10),
            pillContainer.trailingAnchor.constraint(equalTo: brambleBtn.leadingAnchor, constant: -10),
            pillContainer.centerYAnchor.constraint(equalTo: centerYAnchor),
            pillContainer.heightAnchor.constraint(equalToConstant: 32),

            securityIcon.leadingAnchor.constraint(equalTo: pillContainer.leadingAnchor, constant: 10),
            securityIcon.centerYAnchor.constraint(equalTo: pillContainer.centerYAnchor),
            securityIcon.widthAnchor.constraint(equalToConstant: 13),
            securityIcon.heightAnchor.constraint(equalToConstant: 13),

            addressField.leadingAnchor.constraint(equalTo: securityIcon.trailingAnchor, constant: 8),
            addressField.trailingAnchor.constraint(equalTo: pillContainer.trailingAnchor, constant: -10),
            addressField.centerYAnchor.constraint(equalTo: pillContainer.centerYAnchor),

            progressBar.leadingAnchor.constraint(equalTo: pillContainer.leadingAnchor, constant: 2),
            progressBar.trailingAnchor.constraint(equalTo: pillContainer.trailingAnchor, constant: -2),
            progressBar.bottomAnchor.constraint(equalTo: pillContainer.bottomAnchor),
            progressBar.heightAnchor.constraint(equalToConstant: 2),

            brambleBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            brambleBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            brambleBtn.widthAnchor.constraint(equalToConstant: 30),
            brambleBtn.heightAnchor.constraint(equalToConstant: 30),
        ])
    }

    private func configureButton(_ button: NSButton, symbol: String, label: String, action: Selector) {
        button.image = NSImage(
            systemSymbolName: symbol,
            accessibilityDescription: label
        )?.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
        configureButtonBase(button, label: label, action: action)
        button.imagePosition = .imageOnly
        button.contentTintColor = .secondaryLabelColor
    }

    private func configureButton(_ button: NSButton, title: String, label: String, action: Selector) {
        button.title = title
        configureButtonBase(button, label: label, action: action)
        button.font = NSFont.systemFont(ofSize: 15)
        button.imagePosition = .imageOnly
    }

    private func configureButtonBase(_ button: NSButton, label: String, action: Selector) {
        button.bezelStyle = .toolbar
        button.isBordered = false
        button.target = self
        button.action = action
        button.toolTip = label
        button.setAccessibilityLabel(label)
        button.translatesAutoresizingMaskIntoConstraints = false
        addSubview(button)
    }

    public func refreshExtensionButton() {
        let icon = WebExtensionManager.shared.brambleIcon
        brambleBtn.image = (icon ?? NSImage(systemSymbolName: "puzzlepiece.extension", accessibilityDescription: "Extensions"))?
            .copy() as? NSImage
        brambleBtn.imageScaling = .scaleProportionallyDown
        brambleBtn.contentTintColor = icon == nil ? .secondaryLabelColor : nil
        brambleBtn.title = ""
        brambleBtn.toolTip = WebExtensionManager.shared.brambleContext == nil
            ? "Install Extensions"
            : "Bramble Password Manager"
    }

    public func updateForTab(_ tab: TabItem) {
        refreshExtensionButton()
        backBtn.isEnabled = tab.webView.canGoBack
        forwardBtn.isEnabled = tab.webView.canGoForward
        let activeURL = tab.webView.url ?? tab.url
        let isBookmarked = BrowserLibraryStore.shared.isBookmarked(url: activeURL)
        bookmarkBtn.image = NSImage(
            systemSymbolName: isBookmarked ? "bookmark.fill" : "bookmark",
            accessibilityDescription: isBookmarked ? "Remove bookmark" : "Bookmark this page"
        )?.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
        bookmarkBtn.toolTip = isBookmarked ? "Remove bookmark" : "Bookmark this page"
        bookmarkBtn.isEnabled = activeURL?.scheme == "http" || activeURL?.scheme == "https"

        let canSaveForLater = !tab.isPrivate && (activeURL?.scheme == "http" || activeURL?.scheme == "https")
        let isInReadingList = activeURL.map { url in
            BrowserLibraryStore.shared.readingList.contains { $0.url == url.absoluteString }
        } ?? false
        readingListSaveBtn.image = NSImage(
            systemSymbolName: isInReadingList ? "text.badge.minus" : "text.badge.plus",
            accessibilityDescription: isInReadingList ? "Remove from Reading List" : "Save for later"
        )?.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
        readingListSaveBtn.toolTip = isInReadingList ? "Remove from Reading List" : "Save for later"
        readingListSaveBtn.isEnabled = canSaveForLater

        let reloadSymbol = tab.isLoading ? "xmark" : "arrow.clockwise"
        reloadBtn.image = NSImage(
            systemSymbolName: reloadSymbol,
            accessibilityDescription: tab.isLoading ? "Stop Loading" : "Reload"
        )?.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
        reloadBtn.toolTip = tab.isLoading ? "Stop Loading" : "Reload"

        if let url = tab.url {
            let secure = url.scheme == "https"
            let symbol = secure ? "lock.fill" : (url.scheme == "http" ? "exclamationmark.triangle.fill" : "globe")
            securityIcon.image = NSImage(
                systemSymbolName: symbol,
                accessibilityDescription: secure ? "Secure Connection" : "Connection"
            )
            securityIcon.contentTintColor = secure ? .secondaryLabelColor : (url.scheme == "http" ? .systemYellow : .secondaryLabelColor)
            addressField.stringValue = url.absoluteString
        } else {
            securityIcon.image = NSImage(systemSymbolName: "globe", accessibilityDescription: "Address")
            securityIcon.contentTintColor = .secondaryLabelColor
            addressField.stringValue = ""
        }

        let progress = tab.webView.estimatedProgress
        if tab.isLoading && progress < 1.0 {
            progressBar.isHidden = false
            progressBar.doubleValue = progress
        } else {
            progressBar.isHidden = true
        }
    }

    public func focusAddressField() {
        window?.makeFirstResponder(addressField)
        addressField.currentEditor()?.selectAll(nil)
    }

    @objc private func onFieldSubmit() {
        let input = addressField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        delegate?.omniboxDidSubmit(input: input)
    }

    @objc private func onToggleSidebar() { delegate?.omniboxDidToggleSidebar() }
    @objc private func onTabs() { delegate?.omniboxDidShowTabs() }
    @objc private func onHistory() { delegate?.omniboxDidShowHistory() }
    @objc private func onBookmarks() { delegate?.omniboxDidShowBookmarks() }
    @objc private func onReadingList() { delegate?.omniboxDidShowReadingList() }
    @objc private func onToggleBookmark() { delegate?.omniboxDidToggleBookmark() }
    @objc private func onToggleReadingList() { delegate?.omniboxDidToggleReadingList() }
    @objc private func onBack() { delegate?.omniboxDidClickBack() }
    @objc private func onForward() { delegate?.omniboxDidClickForward() }
    @objc private func onReload() { delegate?.omniboxDidClickReload() }
    @objc private func onBrambleClicked() { delegate?.omniboxDidRequestBramblePopup(sender: brambleBtn) }
    @objc private func onManageExtensions() { delegate?.omniboxDidRequestExtensionManagement() }
}
