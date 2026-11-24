import AppKit

public protocol SidebarViewDelegate: AnyObject {
    func sidebarDidSelectTab(id: UUID)
    func sidebarDidCloseTab(id: UUID)
    func sidebarDidCreateNewTab()
    func sidebarDidToggleAdBlock()
    func sidebarDidTestBiometrics()
    func sidebarDidRequestInstallExtension()
    func sidebarDidRequestOpenBrambleVault()
}

public final class SidebarView: NSVisualEffectView, NSTableViewDataSource, NSTableViewDelegate {
    public weak var delegate: SidebarViewDelegate?
    
    private let workspaceLabel = NSTextField(labelWithString: "🐟 Personal Space")
    private let newTabBtn = NSButton(title: "+ New Tab", target: nil, action: nil)
    
    private let tableView = NSTableView()
    private let scrollView = NSScrollView()
    
    // Extensions
    private let extHeader = NSTextField(labelWithString: "EXTENSIONS")
    private let extListView = NSTextView()
    private let openBrambleBtn = NSButton(title: "🫐 Open Bramble Vault", target: nil, action: nil)
    private let installExtBtn = NSButton(title: "+ Install Extension...", target: nil, action: nil)
    
    // Bottom Tools & Stats
    private let bottomDivider = NSBox()
    private let adBlockBtn = NSButton(title: "🛡️ AdBlock: Active", target: nil, action: nil)
    private let biometricsBtn = NSButton(title: "Touch ID Quick Unlock", target: nil, action: nil)
    private let biometricsStatus = NSTextField(labelWithString: "Touch ID: Ready")
    private let ramBadge = NSTextField(labelWithString: "RSS: -- MB")
    
    private var timer: Timer?
    
    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupUI()
    }
    
    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupUI()
    }
    
    private func setupUI() {
        material = .sidebar
        blendingMode = .behindWindow
        state = .active
        wantsLayer = true
        
        let tintView = NSView()
        tintView.wantsLayer = true
        tintView.layer?.backgroundColor = NSColor(red: 0.08, green: 0.09, blue: 0.11, alpha: 0.55).cgColor
        tintView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(tintView)
        
        // Header (starts at constant 50 to leave clean room for macOS traffic lights at the top!)
        workspaceLabel.font = NSFont.systemFont(ofSize: 13, weight: .bold)
        workspaceLabel.textColor = .labelColor
        workspaceLabel.translatesAutoresizingMaskIntoConstraints = false
        addSubview(workspaceLabel)
        
        newTabBtn.bezelStyle = .rounded
        newTabBtn.target = self
        newTabBtn.action = #selector(onNewTab)
        newTabBtn.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        newTabBtn.translatesAutoresizingMaskIntoConstraints = false
        addSubview(newTabBtn)
        
        // TableView for tabs
        let col = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("TabCol"))
        col.width = 240
        tableView.addTableColumn(col)
        tableView.headerView = nil
        tableView.backgroundColor = .clear
        tableView.dataSource = self
        tableView.delegate = self
        tableView.rowHeight = 34
        tableView.intercellSpacing = NSSize(width: 0, height: 4)
        tableView.selectionHighlightStyle = .none
        
        scrollView.documentView = tableView
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scrollView)
        
        // Extensions Header
        extHeader.font = NSFont.systemFont(ofSize: 10, weight: .bold)
        extHeader.textColor = .tertiaryLabelColor
        extHeader.translatesAutoresizingMaskIntoConstraints = false
        addSubview(extHeader)
        
        let extScroll = NSScrollView()
        extScroll.hasVerticalScroller = true
        extScroll.drawsBackground = false
        extScroll.borderType = .noBorder
        extScroll.translatesAutoresizingMaskIntoConstraints = false
        extListView.isEditable = false
        extListView.drawsBackground = false
        extListView.font = NSFont.systemFont(ofSize: 11)
        extListView.string = "Loading extensions..."
        extScroll.documentView = extListView
        addSubview(extScroll)
        
        openBrambleBtn.bezelStyle = .rounded
        openBrambleBtn.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        openBrambleBtn.target = self
        openBrambleBtn.action = #selector(onOpenBramble)
        openBrambleBtn.translatesAutoresizingMaskIntoConstraints = false
        addSubview(openBrambleBtn)
        
        installExtBtn.bezelStyle = .inline
        installExtBtn.font = NSFont.systemFont(ofSize: 11)
        installExtBtn.target = self
        installExtBtn.action = #selector(onInstallExt)
        installExtBtn.translatesAutoresizingMaskIntoConstraints = false
        addSubview(installExtBtn)
        
        // Divider
        bottomDivider.boxType = .separator
        bottomDivider.translatesAutoresizingMaskIntoConstraints = false
        addSubview(bottomDivider)
        
        // Controls
        adBlockBtn.bezelStyle = .rounded
        adBlockBtn.target = self
        adBlockBtn.action = #selector(onAdBlock)
        adBlockBtn.translatesAutoresizingMaskIntoConstraints = false
        addSubview(adBlockBtn)
        
        biometricsBtn.bezelStyle = .rounded
        biometricsBtn.target = self
        biometricsBtn.action = #selector(onBiometrics)
        biometricsBtn.translatesAutoresizingMaskIntoConstraints = false
        addSubview(biometricsBtn)
        
        biometricsStatus.font = NSFont.systemFont(ofSize: 10)
        biometricsStatus.textColor = .secondaryLabelColor
        biometricsStatus.translatesAutoresizingMaskIntoConstraints = false
        addSubview(biometricsStatus)
        
        ramBadge.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .bold)
        ramBadge.textColor = .systemGreen
        ramBadge.translatesAutoresizingMaskIntoConstraints = false
        addSubview(ramBadge)
        
        NSLayoutConstraint.activate([
            tintView.topAnchor.constraint(equalTo: topAnchor),
            tintView.leadingAnchor.constraint(equalTo: leadingAnchor),
            tintView.trailingAnchor.constraint(equalTo: trailingAnchor),
            tintView.bottomAnchor.constraint(equalTo: bottomAnchor),
            
            // Inset top 48 for window traffic lights
            workspaceLabel.topAnchor.constraint(equalTo: topAnchor, constant: 48),
            workspaceLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            
            newTabBtn.centerYAnchor.constraint(equalTo: workspaceLabel.centerYAnchor),
            newTabBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            newTabBtn.widthAnchor.constraint(equalToConstant: 78),
            
            scrollView.topAnchor.constraint(equalTo: workspaceLabel.bottomAnchor, constant: 12),
            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            scrollView.heightAnchor.constraint(equalToConstant: 210),
            
            extHeader.topAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: 14),
            extHeader.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            
            extScroll.topAnchor.constraint(equalTo: extHeader.bottomAnchor, constant: 6),
            extScroll.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            extScroll.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            extScroll.heightAnchor.constraint(equalToConstant: 90),
            
            openBrambleBtn.topAnchor.constraint(equalTo: extScroll.bottomAnchor, constant: 6),
            openBrambleBtn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            openBrambleBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            
            installExtBtn.topAnchor.constraint(equalTo: openBrambleBtn.bottomAnchor, constant: 6),
            installExtBtn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            installExtBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            
            bottomDivider.topAnchor.constraint(equalTo: installExtBtn.bottomAnchor, constant: 12),
            bottomDivider.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            bottomDivider.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            
            adBlockBtn.topAnchor.constraint(equalTo: bottomDivider.bottomAnchor, constant: 8),
            adBlockBtn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            adBlockBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            
            biometricsBtn.topAnchor.constraint(equalTo: adBlockBtn.bottomAnchor, constant: 6),
            biometricsBtn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            biometricsBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            
            biometricsStatus.topAnchor.constraint(equalTo: biometricsBtn.bottomAnchor, constant: 4),
            biometricsStatus.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            biometricsStatus.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            
            ramBadge.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14),
            ramBadge.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
        ])
        
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            let mb = PerformanceMonitor.shared.memoryUsageMB
            self?.ramBadge.stringValue = String(format: "RSS: %.1f MB", mb)
        }
    }
    
    public func reloadTabs() {
        tableView.reloadData()
    }
    
    public func updateExtensions(_ list: [LoadedExtensionInfo]) {
        var str = ""
        for ext in list {
            let badge = ext.name.lowercased().contains("bramble") ? "🫐" : "🧩"
            str += "\(badge) \(ext.name)\n   v\(ext.version) (MV\(Int(ext.manifestVersion)))\n"
        }
        extListView.string = str.isEmpty ? "No extensions loaded." : str
    }
    
    public func updateAdBlock(enabled: Bool) {
        adBlockBtn.title = enabled ? "🛡️ AdBlock: Active" : "🛡️ AdBlock: Disabled"
    }
    
    public func updateBiometrics(message: String, success: Bool) {
        biometricsStatus.stringValue = message
        biometricsStatus.textColor = success ? .systemGreen : .systemRed
    }
    
    // MARK: - NSTableViewDataSource & Delegate
    public func numberOfRows(in tableView: NSTableView) -> Int {
        return TabManager.shared.tabs.count
    }
    
    public func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let tabs = TabManager.shared.tabs
        guard row < tabs.count else { return nil }
        let tab = tabs[row]
        let isActive = (TabManager.shared.activeTabId == tab.id)
        
        let cell = NSView()
        cell.wantsLayer = true
        cell.layer?.cornerRadius = 8
        cell.layer?.backgroundColor = isActive
            ? NSColor(white: 1.0, alpha: 0.14).cgColor
            : NSColor(white: 1.0, alpha: 0.04).cgColor
        
        if isActive {
            let bar = NSView(frame: NSRect(x: 0, y: 4, width: 3, height: 26))
            bar.wantsLayer = true
            bar.layer?.backgroundColor = NSColor.systemBlue.cgColor
            bar.layer?.cornerRadius = 1.5
            cell.addSubview(bar)
        }
        
        let icon = NSTextField(labelWithString: tab.isLoading ? "⏳" : "🌐")
        icon.font = NSFont.systemFont(ofSize: 11)
        icon.frame = NSRect(x: 10, y: 8, width: 18, height: 18)
        cell.addSubview(icon)
        
        let label = NSTextField(labelWithString: tab.title)
        label.font = NSFont.systemFont(ofSize: 12, weight: isActive ? .medium : .regular)
        label.textColor = isActive ? .white : .labelColor
        label.lineBreakMode = .byTruncatingTail
        label.frame = NSRect(x: 32, y: 7, width: 165, height: 20)
        cell.addSubview(label)
        
        let closeBtn = NSButton(title: "✕", target: self, action: #selector(onCloseTabClicked(_:)))
        closeBtn.isBordered = false
        closeBtn.font = NSFont.systemFont(ofSize: 10)
        closeBtn.tag = row
        closeBtn.frame = NSRect(x: 205, y: 8, width: 20, height: 18)
        cell.addSubview(closeBtn)
        
        let clickGesture = NSClickGestureRecognizer(target: self, action: #selector(onTabRowClicked(_:)))
        cell.addGestureRecognizer(clickGesture)
        
        return cell
    }
    
    @objc private func onTabRowClicked(_ gesture: NSClickGestureRecognizer) {
        let point = gesture.location(in: tableView)
        let row = tableView.row(at: point)
        guard row >= 0 && row < TabManager.shared.tabs.count else { return }
        let id = TabManager.shared.tabs[row].id
        delegate?.sidebarDidSelectTab(id: id)
    }
    
    @objc private func onCloseTabClicked(_ sender: NSButton) {
        let row = sender.tag
        guard row >= 0 && row < TabManager.shared.tabs.count else { return }
        let id = TabManager.shared.tabs[row].id
        delegate?.sidebarDidCloseTab(id: id)
    }
    
    @objc private func onNewTab() { delegate?.sidebarDidCreateNewTab() }
    @objc private func onOpenBramble() { delegate?.sidebarDidRequestOpenBrambleVault() }
    @objc private func onInstallExt() { delegate?.sidebarDidRequestInstallExtension() }
    @objc private func onAdBlock() { delegate?.sidebarDidToggleAdBlock() }
    @objc private func onBiometrics() { delegate?.sidebarDidTestBiometrics() }
}
