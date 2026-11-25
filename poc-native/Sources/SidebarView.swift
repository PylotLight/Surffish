import AppKit

public protocol SidebarViewDelegate: AnyObject {
    func sidebarDidSelectTab(id: UUID)
    func sidebarDidCloseTab(id: UUID)
    func sidebarDidCreateNewTab()
    func sidebarDidTogglePinTab(id: UUID)
    func sidebarDidOpenExtensions()
    func sidebarDidOpenSettings()
    func sidebarDidQuit()
}

private final class SidebarRowView: NSView {
    var onSelect: (() -> Void)?

    override func mouseDown(with event: NSEvent) {
        onSelect?()
    }
}

public final class SidebarView: NSVisualEffectView, NSTableViewDataSource, NSTableViewDelegate {
    public weak var delegate: SidebarViewDelegate?
    private let workspaceLabel = NSTextField(labelWithString: "Tabs")
    private let newTabButton = NSButton(title: "+ New Tab", target: nil, action: nil)
    private let tableView = NSTableView()
    private let scrollView = NSScrollView()
    private let footer = NSStackView()
    private let extensionsButton = NSButton(title: "Extensions", target: nil, action: nil)
    private let settingsButton = NSButton(title: "Settings", target: nil, action: nil)
    private let quitButton = NSButton(title: "Quit Surffish", target: nil, action: nil)
    private var isSettingsTabActive = false

    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupUI()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupUI()
    }

    private func setupUI() {
        material = .underWindowBackground
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true

        let tintView = NSView()
        tintView.wantsLayer = true
        tintView.layer?.backgroundColor = NSColor(red: 0.08, green: 0.09, blue: 0.11, alpha: 0.24).cgColor
        tintView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(tintView)

        workspaceLabel.font = NSFont.systemFont(ofSize: 13, weight: .bold)
        workspaceLabel.textColor = .labelColor
        workspaceLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(workspaceLabel)

        newTabButton.bezelStyle = .rounded
        newTabButton.target = self
        newTabButton.action = #selector(onNewTab)
        newTabButton.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        newTabButton.translatesAutoresizingMaskIntoConstraints = false
        addSubview(newTabButton)

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("TabColumn"))
        column.width = 280
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.backgroundColor = .clear
        tableView.dataSource = self
        tableView.delegate = self
        tableView.rowHeight = 36
        tableView.intercellSpacing = NSSize(width: 0, height: 4)
        tableView.selectionHighlightStyle = .none

        scrollView.documentView = tableView
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scrollView)

        footer.orientation = .vertical
        footer.alignment = .leading
        footer.distribution = .fill
        footer.spacing = 5
        footer.translatesAutoresizingMaskIntoConstraints = false
        addSubview(footer)

        configureFooterButton(extensionsButton, symbol: "puzzlepiece.extension", action: #selector(onExtensions))
        configureFooterButton(settingsButton, symbol: "gearshape", action: #selector(onSettings))
        configureFooterButton(quitButton, symbol: "power", action: #selector(onQuit))
        footer.addArrangedSubview(extensionsButton)
        footer.addArrangedSubview(settingsButton)
        footer.addArrangedSubview(quitButton)

        NSLayoutConstraint.activate([
            tintView.topAnchor.constraint(equalTo: topAnchor),
            tintView.leadingAnchor.constraint(equalTo: leadingAnchor),
            tintView.trailingAnchor.constraint(equalTo: trailingAnchor),
            tintView.bottomAnchor.constraint(equalTo: bottomAnchor),

            workspaceLabel.topAnchor.constraint(equalTo: topAnchor, constant: 48),
            workspaceLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            newTabButton.centerYAnchor.constraint(equalTo: workspaceLabel.centerYAnchor),
            newTabButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            newTabButton.widthAnchor.constraint(equalToConstant: 90),

            scrollView.topAnchor.constraint(equalTo: workspaceLabel.bottomAnchor, constant: 12),
            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            scrollView.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -12),

            footer.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            footer.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            footer.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -18)
        ])
    }

    private func configureFooterButton(_ button: NSButton, symbol: String, action: Selector) {
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: button.title)
        button.imagePosition = .imageLeading
        button.alignment = .left
        button.font = .systemFont(ofSize: 12, weight: .medium)
        button.contentTintColor = .secondaryLabelColor
        button.bezelStyle = .rounded
        button.isBordered = false
        button.target = self
        button.action = action
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(equalToConstant: 30).isActive = true
    }

    public func reloadTabs() { tableView.reloadData() }

    public func setSettingsTabActive(_ active: Bool) {
        isSettingsTabActive = active
        tableView.reloadData()
    }

    public func numberOfRows(in tableView: NSTableView) -> Int {
        TabManager.shared.tabs.count + (isSettingsTabActive ? 1 : 0)
    }

    public func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let tabs = TabManager.shared.tabs
        if isSettingsTabActive && row == tabs.count {
            let cell = SidebarRowView()
            cell.wantsLayer = true
            cell.layer?.cornerRadius = 8
            cell.layer?.backgroundColor = NSColor(white: 1.0, alpha: 0.14).cgColor

            let bar = NSView(frame: NSRect(x: 0, y: 4, width: 3, height: 28))
            bar.wantsLayer = true
            bar.layer?.backgroundColor = NSColor.systemBlue.cgColor
            bar.layer?.cornerRadius = 1.5
            cell.addSubview(bar)

            let icon = NSImageView(frame: NSRect(x: 10, y: 10, width: 15, height: 15))
            icon.image = NSImage(systemSymbolName: "gearshape.fill", accessibilityDescription: "Settings")
            icon.contentTintColor = .secondaryLabelColor
            cell.addSubview(icon)

            let title = NSTextField(labelWithString: "Settings")
            title.font = NSFont.systemFont(ofSize: 12, weight: .medium)
            title.textColor = .white
            title.frame = NSRect(x: 34, y: 8, width: 188, height: 20)
            cell.addSubview(title)

            cell.onSelect = { [weak self] in self?.delegate?.sidebarDidOpenSettings() }
            return cell
        }
        guard row >= 0, row < tabs.count else { return nil }
        let tab = tabs[row]
        let active = !isSettingsTabActive && TabManager.shared.activeTabId == tab.id
        let cell = SidebarRowView()
        cell.wantsLayer = true
        cell.layer?.cornerRadius = 8
        cell.layer?.backgroundColor = active
            ? NSColor(white: 1.0, alpha: 0.14).cgColor
            : NSColor(white: 1.0, alpha: 0.04).cgColor

        if active {
            let bar = NSView(frame: NSRect(x: 0, y: 4, width: 3, height: 28))
            bar.wantsLayer = true
            bar.layer?.backgroundColor = NSColor.systemBlue.cgColor
            bar.layer?.cornerRadius = 1.5
            cell.addSubview(bar)
        }

        let iconName = tab.isPinned ? "pin.fill" : (tab.isLoading ? "arrow.triangle.2.circlepath" : "globe")
        let icon = NSImageView(frame: NSRect(x: 10, y: 10, width: 15, height: 15))
        icon.image = NSImage(systemSymbolName: iconName, accessibilityDescription: "Tab")
        icon.contentTintColor = .secondaryLabelColor
        cell.addSubview(icon)

        let title = NSTextField(labelWithString: tab.title.isEmpty ? "New Tab" : tab.title)
        title.font = NSFont.systemFont(ofSize: 12, weight: active ? .medium : .regular)
        title.textColor = active ? .white : .labelColor
        title.lineBreakMode = .byTruncatingTail
        title.frame = NSRect(x: 34, y: 8, width: 188, height: 20)
        cell.addSubview(title)

        let pin = NSButton(image: NSImage(systemSymbolName: tab.isPinned ? "pin.slash" : "pin", accessibilityDescription: "Toggle pin")!, target: self, action: #selector(onPinTabClicked(_:)))
        pin.isBordered = false
        pin.contentTintColor = .secondaryLabelColor
        pin.tag = row
        pin.frame = NSRect(x: 228, y: 8, width: 20, height: 20)
        cell.addSubview(pin)

        let close = NSButton(
            image: NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close tab")!,
            target: self,
            action: #selector(onCloseTabClicked(_:))
        )
        close.isBordered = false
        close.contentTintColor = .tertiaryLabelColor
        close.toolTip = "Close tab"
        close.tag = row
        close.frame = NSRect(x: 254, y: 8, width: 20, height: 20)
        cell.addSubview(close)

        cell.onSelect = { [weak self] in self?.delegate?.sidebarDidSelectTab(id: tab.id) }
        return cell
    }

    @objc private func onTabRowClicked(_ gesture: NSClickGestureRecognizer) {
        let row = tableView.row(at: gesture.location(in: tableView))
        let tabs = TabManager.shared.tabs
        if isSettingsTabActive && row == tabs.count {
            delegate?.sidebarDidOpenSettings()
            return
        }
        guard row >= 0, row < tabs.count else { return }
        delegate?.sidebarDidSelectTab(id: tabs[row].id)
    }

    @objc private func onPinTabClicked(_ sender: NSButton) {
        let row = sender.tag
        guard row >= 0, row < TabManager.shared.tabs.count else { return }
        delegate?.sidebarDidTogglePinTab(id: TabManager.shared.tabs[row].id)
    }

    @objc private func onCloseTabClicked(_ sender: NSButton) {
        let row = sender.tag
        guard row >= 0, row < TabManager.shared.tabs.count else { return }
        delegate?.sidebarDidCloseTab(id: TabManager.shared.tabs[row].id)
    }

    @objc private func onNewTab() { delegate?.sidebarDidCreateNewTab() }
    @objc private func onExtensions() { delegate?.sidebarDidOpenExtensions() }
    @objc private func onSettings() { delegate?.sidebarDidOpenSettings() }
    @objc private func onQuit() { delegate?.sidebarDidQuit() }
}
