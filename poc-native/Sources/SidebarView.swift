import AppKit

public protocol SidebarViewDelegate: AnyObject {
    func sidebarDidSelectTab(id: UUID)
    func sidebarDidCloseTab(id: UUID)
    func sidebarDidCreateNewTab()
    func sidebarDidTogglePinTab(id: UUID)
    func sidebarDidOpenExtensions()
    func sidebarDidOpenSettings()
    func sidebarDidQuit()
    func sidebarDidToggleSidebar()
}

private final class SidebarRowView: NSView {
    var onSelect: (() -> Void)?
    var onHover: ((Bool) -> Void)?
    private var tracking: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(next)
        tracking = next
    }

    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
    override func mouseDown(with event: NSEvent) { onSelect?() }
}

public final class SidebarView: NSVisualEffectView, NSTableViewDataSource, NSTableViewDelegate {
    public weak var delegate: SidebarViewDelegate?
    public var onHoverChange: ((Bool) -> Void)?
    private let workspaceLabel = NSTextField(labelWithString: "TABS")
    private let collapseButton = NSButton()
    private let newTabButton = NSButton()
    private let tableView = NSTableView()
    private let scrollView = NSScrollView()
    private let pinnedScrollView = NSScrollView()
    private let pinnedStrip = NSStackView()
    private var pinnedStripHeightConstraint: NSLayoutConstraint!
    private let footer = NSStackView()
    private let settingsButton = NSButton()
    private let quitButton = NSButton()
    private var isSettingsTabActive = false
    private var isCollapsed = false
    private var tracking: NSTrackingArea?

    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupUI()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupUI()
    }

    public override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(next)
        tracking = next
    }

    public override func mouseEntered(with event: NSEvent) { onHoverChange?(true) }
    public override func mouseExited(with event: NSEvent) { onHoverChange?(false) }

    private func setupUI() {
        material = .underWindowBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true

        workspaceLabel.font = .systemFont(ofSize: 11, weight: .semibold)
        workspaceLabel.textColor = NSColor(white: 0.95, alpha: 0.62)
        workspaceLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(workspaceLabel)

        configureIconButton(collapseButton, symbol: "sidebar.left", tooltip: "Collapse sidebar", action: #selector(onCollapse))
        configureIconButton(newTabButton, symbol: "plus", tooltip: "New tab", action: #selector(onNewTab))

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("TabColumn"))
        column.width = 260
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.backgroundColor = .clear
        tableView.dataSource = self
        tableView.delegate = self
        tableView.rowHeight = 42
        tableView.intercellSpacing = NSSize(width: 0, height: 3)
        tableView.selectionHighlightStyle = .none
        tableView.focusRingType = .none

        scrollView.documentView = tableView
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scrollView)

        pinnedStrip.orientation = .horizontal
        pinnedStrip.alignment = .centerY
        pinnedStrip.distribution = .fill
        pinnedStrip.spacing = 6
        pinnedStrip.translatesAutoresizingMaskIntoConstraints = true
        pinnedStrip.frame = NSRect(x: 0, y: 0, width: 260, height: 38)
        pinnedStrip.autoresizingMask = [.height]
        pinnedScrollView.documentView = pinnedStrip
        pinnedScrollView.hasHorizontalScroller = false
        pinnedScrollView.hasVerticalScroller = false
        pinnedScrollView.drawsBackground = false
        pinnedScrollView.borderType = .noBorder
        pinnedScrollView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pinnedScrollView)

        footer.orientation = .vertical
        footer.alignment = .leading
        footer.distribution = .fill
        footer.spacing = 4
        footer.translatesAutoresizingMaskIntoConstraints = false
        addSubview(footer)

        configureFooterButton(settingsButton, symbol: "gearshape", title: "Settings", action: #selector(onSettings))
        configureFooterButton(quitButton, symbol: "power", title: "Quit Surffish", action: #selector(onQuit))
        footer.addArrangedSubview(settingsButton)
        footer.addArrangedSubview(quitButton)

        pinnedStripHeightConstraint = pinnedScrollView.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            workspaceLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
            workspaceLabel.centerYAnchor.constraint(equalTo: collapseButton.centerYAnchor),
            collapseButton.topAnchor.constraint(equalTo: topAnchor, constant: 43),
            collapseButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            collapseButton.widthAnchor.constraint(equalToConstant: 30),
            collapseButton.heightAnchor.constraint(equalToConstant: 30),
            workspaceLabel.trailingAnchor.constraint(lessThanOrEqualTo: collapseButton.leadingAnchor, constant: -8),

            newTabButton.topAnchor.constraint(equalTo: collapseButton.bottomAnchor, constant: 14),
            newTabButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            newTabButton.widthAnchor.constraint(equalToConstant: 30),
            newTabButton.heightAnchor.constraint(equalToConstant: 30),

            pinnedScrollView.topAnchor.constraint(equalTo: newTabButton.bottomAnchor, constant: 8),
            pinnedScrollView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 4),
            pinnedScrollView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
            pinnedStripHeightConstraint,

            scrollView.topAnchor.constraint(equalTo: pinnedScrollView.bottomAnchor, constant: 6),
            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            scrollView.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -12),

            footer.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            footer.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            footer.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -16)
        ])
        setCollapsed(false)
    }

    private func configureIconButton(_ button: NSButton, symbol: String, tooltip: String, action: Selector) {
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tooltip)
        button.imagePosition = .imageOnly
        button.bezelStyle = .rounded
        button.isBordered = false
        button.contentTintColor = .secondaryLabelColor
        button.toolTip = tooltip
        button.target = self
        button.action = action
        button.translatesAutoresizingMaskIntoConstraints = false
        addSubview(button)
    }

    private func configureFooterButton(_ button: NSButton, symbol: String, title: String, action: Selector) {
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
        button.imagePosition = .imageLeading
        button.alignment = .left
        button.title = title
        button.font = .systemFont(ofSize: 12, weight: .medium)
        button.contentTintColor = .secondaryLabelColor
        button.bezelStyle = .rounded
        button.isBordered = false
        button.target = self
        button.action = action
        button.toolTip = title
        button.setAccessibilityLabel(title)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(equalToConstant: 32).isActive = true
    }

    public func setCollapsed(_ collapsed: Bool) {
        guard isCollapsed != collapsed else { return }
        isCollapsed = collapsed
        workspaceLabel.isHidden = collapsed
        collapseButton.image = NSImage(
            systemSymbolName: collapsed ? "sidebar.right" : "sidebar.left",
            accessibilityDescription: collapsed ? "Expand sidebar" : "Collapse sidebar"
        )
        collapseButton.toolTip = collapsed ? "Expand sidebar" : "Collapse sidebar"
        newTabButton.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "New tab")
        newTabButton.title = collapsed ? "" : "New tab"
        newTabButton.imagePosition = collapsed ? .imageOnly : .imageLeading
        newTabButton.alignment = collapsed ? .center : .left
        newTabButton.contentTintColor = .secondaryLabelColor
        newTabButton.toolTip = "New tab"
        for button in [settingsButton, quitButton] {
            button.title = collapsed ? "" : (button === settingsButton ? "Settings" : "Quit Surffish")
            button.imagePosition = collapsed ? .imageOnly : .imageLeading
            button.alignment = collapsed ? .center : .left
            button.toolTip = button === settingsButton ? "Settings" : "Quit Surffish"
        }
        footer.alignment = collapsed ? .centerX : .leading
        tableView.reloadData()
        needsLayout = true
    }

    public func reloadTabs() {
        tableView.reloadData()
        reloadPinnedTabs()
    }

    private func reloadPinnedTabs() {
        pinnedStrip.arrangedSubviews.forEach { view in
            pinnedStrip.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        let pinned = TabManager.shared.tabs.filter(\.isPinned)
        pinnedScrollView.isHidden = pinned.isEmpty
        pinnedStripHeightConstraint.constant = pinned.isEmpty ? 0 : 38
        let displayed = isCollapsed ? Array(pinned.prefix(1)) : pinned
        for (index, tab) in displayed.enumerated() {
            let button = NSButton()
            button.bezelStyle = .regularSquare
            button.isBordered = false
            button.imagePosition = .imageOnly
            button.imageScaling = .scaleProportionallyDown
            button.image = NSImage(systemSymbolName: "globe", accessibilityDescription: tab.title)
            button.toolTip = tab.title.isEmpty ? "Pinned tab" : tab.title
            button.tag = index
            button.target = self
            button.action = #selector(onPinnedTabClicked(_:))
            button.translatesAutoresizingMaskIntoConstraints = false
            button.widthAnchor.constraint(equalToConstant: isCollapsed ? 26 : 30).isActive = true
            button.heightAnchor.constraint(equalToConstant: 30).isActive = true
            pinnedStrip.addArrangedSubview(button)
            loadFavicon(for: tab, into: button)
        }
        if isCollapsed && pinned.count > 1 {
            let overflow = NSTextField(labelWithString: "+\(pinned.count - 1)")
            overflow.font = .systemFont(ofSize: 10, weight: .semibold)
            overflow.textColor = .secondaryLabelColor
            pinnedStrip.addArrangedSubview(overflow)
        }
        let stripWidth = isCollapsed ? 56 : max(260, CGFloat(displayed.count) * 36)
        pinnedStrip.setFrameSize(NSSize(width: stripWidth, height: 38))
    }

    public func setSettingsTabActive(_ active: Bool) {
        isSettingsTabActive = active
        tableView.reloadData()
        settingsButton.contentTintColor = active ? .controlAccentColor : .secondaryLabelColor
    }

    public func numberOfRows(in tableView: NSTableView) -> Int {
        TabManager.shared.tabs.filter { !$0.isPinned }.count + (isSettingsTabActive ? 1 : 0)
    }

    public func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let tabs = TabManager.shared.tabs.filter { !$0.isPinned }
        let cell = SidebarRowView()
        cell.wantsLayer = true
        cell.layer?.cornerRadius = 9
        cell.layer?.backgroundColor = NSColor(white: 1, alpha: 0.035).cgColor

        if isSettingsTabActive && row == tabs.count {
            configureSettingsRow(cell)
            cell.onSelect = { [weak self] in self?.delegate?.sidebarDidOpenSettings() }
            return cell
        }
        guard row >= 0, row < tabs.count else { return nil }
        let tab = tabs[row]
        let active = !isSettingsTabActive && TabManager.shared.activeTabId == tab.id
        cell.layer?.backgroundColor = active
            ? NSColor(white: 1, alpha: 0.13).cgColor
            : NSColor(white: 1, alpha: 0.025).cgColor

        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: tab.isPinned ? "pin.fill" : "globe", accessibilityDescription: "Tab")
        icon.contentTintColor = .secondaryLabelColor
        icon.imageScaling = .scaleProportionallyDown
        icon.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(icon)

        let title = NSTextField(labelWithString: tab.title.isEmpty ? "New Tab" : tab.title)
        title.font = .systemFont(ofSize: 12, weight: active ? .semibold : .regular)
        title.textColor = active ? .labelColor : .secondaryLabelColor
        title.lineBreakMode = .byTruncatingTail
        title.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(title)

        let close = NSButton(image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close tab")!, target: self, action: #selector(onCloseTabClicked(_:)))
        close.isBordered = false
        close.contentTintColor = .tertiaryLabelColor
        close.toolTip = "Close tab"
        close.tag = row
        close.translatesAutoresizingMaskIntoConstraints = false
        close.isHidden = true
        cell.addSubview(close)

        let pin = NSButton(image: NSImage(systemSymbolName: tab.isPinned ? "pin.slash" : "pin", accessibilityDescription: "Toggle pin")!, target: self, action: #selector(onPinTabClicked(_:)))
        pin.isBordered = false
        pin.contentTintColor = .tertiaryLabelColor
        pin.toolTip = tab.isPinned ? "Unpin tab" : "Pin tab"
        pin.tag = row
        pin.translatesAutoresizingMaskIntoConstraints = false
        pin.isHidden = true
        cell.addSubview(pin)

        var iconConstraints: [NSLayoutConstraint] = [
            icon.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 18),
            icon.heightAnchor.constraint(equalToConstant: 18),
            icon.trailingAnchor.constraint(equalTo: title.leadingAnchor, constant: -10),
            title.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            title.trailingAnchor.constraint(equalTo: pin.leadingAnchor, constant: -4),
            pin.trailingAnchor.constraint(equalTo: close.leadingAnchor, constant: -2),
            pin.widthAnchor.constraint(equalToConstant: 22),
            pin.heightAnchor.constraint(equalToConstant: 22),
            close.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -6),
            close.widthAnchor.constraint(equalToConstant: 22),
            close.heightAnchor.constraint(equalToConstant: 22)
        ]
        iconConstraints.append(
            isCollapsed
                ? icon.centerXAnchor.constraint(equalTo: cell.centerXAnchor)
                : icon.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 12)
        )
        NSLayoutConstraint.activate(iconConstraints)
        title.isHidden = isCollapsed
        cell.onSelect = { [weak self] in self?.delegate?.sidebarDidSelectTab(id: tab.id) }
        cell.onHover = { [weak close, weak pin] hovering in
            close?.isHidden = !hovering || self.isCollapsed
            pin?.isHidden = !hovering || self.isCollapsed
        }
        loadFavicon(for: tab, into: icon)
        return cell
    }

    private func configureSettingsRow(_ cell: SidebarRowView) {
        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: "gearshape.fill", accessibilityDescription: "Settings")
        icon.contentTintColor = .secondaryLabelColor
        icon.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(icon)
        let title = NSTextField(labelWithString: "Settings")
        title.font = .systemFont(ofSize: 12, weight: .medium)
        title.textColor = .labelColor
        title.translatesAutoresizingMaskIntoConstraints = false
        title.isHidden = isCollapsed
        cell.addSubview(title)
        var settingsConstraints: [NSLayoutConstraint] = [
            icon.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 18),
            icon.heightAnchor.constraint(equalToConstant: 18),
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 10),
            title.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            title.trailingAnchor.constraint(lessThanOrEqualTo: cell.trailingAnchor, constant: -8)
        ]
        settingsConstraints.append(
            isCollapsed
                ? icon.centerXAnchor.constraint(equalTo: cell.centerXAnchor)
                : icon.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 12)
        )
        NSLayoutConstraint.activate(settingsConstraints)
    }

    private func loadFavicon(for tab: TabItem, into button: NSButton) {
        guard let host = tab.webView.url?.host ?? tab.url?.host,
              let encodedHost = host.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed),
              let url = URL(string: "https://www.google.com/s2/favicons?domain=\(encodedHost)&sz=64") else { return }
        URLSession.shared.dataTask(with: url) { [weak button] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let button, button.window != nil else { return }
                button.image = image
            }
        }.resume()
    }

    private func loadFavicon(for tab: TabItem, into imageView: NSImageView) {
        guard let host = tab.webView.url?.host ?? tab.url?.host,
              let encodedHost = host.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed),
              let url = URL(string: "https://www.google.com/s2/favicons?domain=\(encodedHost)&sz=64") else {
            imageView.image = NSImage(systemSymbolName: "globe", accessibilityDescription: "Tab")
            return
        }
        let tabID = tab.id
        URLSession.shared.dataTask(with: url) { [weak imageView] data, _, _ in
            guard let data, let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let imageView, imageView.window != nil else { return }
                imageView.image = image
            }
        }.resume()
        _ = tabID
    }

    @objc private func onCollapse() { delegate?.sidebarDidToggleSidebar() }
    @objc private func onPinnedTabClicked(_ sender: NSButton) {
        let tabs = TabManager.shared.tabs.filter(\.isPinned)
        guard sender.tag >= 0, sender.tag < tabs.count else { return }
        delegate?.sidebarDidSelectTab(id: tabs[sender.tag].id)
    }
    @objc private func onNewTab() { delegate?.sidebarDidCreateNewTab() }
    @objc private func onSettings() { delegate?.sidebarDidOpenSettings() }
    @objc private func onQuit() { delegate?.sidebarDidQuit() }
    @objc private func onPinTabClicked(_ sender: NSButton) {
        let row = sender.tag
        let tabs = TabManager.shared.tabs.filter { !$0.isPinned }
        guard row >= 0, row < tabs.count else { return }
        delegate?.sidebarDidTogglePinTab(id: tabs[row].id)
    }
    @objc private func onCloseTabClicked(_ sender: NSButton) {
        let row = sender.tag
        let tabs = TabManager.shared.tabs.filter { !$0.isPinned }
        guard row >= 0, row < tabs.count else { return }
        delegate?.sidebarDidCloseTab(id: tabs[row].id)
    }
}
