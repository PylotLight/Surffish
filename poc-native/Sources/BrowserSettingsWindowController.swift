import AppKit

public final class BrowserSettingsWindowController: NSWindowController {
    private let searchEngine = NSPopUpButton()
    private let startPage = NSTextField()
    private let restoreSession = NSButton(checkboxWithTitle: "Restore tabs from the previous session", target: nil, action: nil)
    private let showSidebar = NSButton(checkboxWithTitle: "Show sidebar at startup", target: nil, action: nil)
    private let sshProxyEnabled = NSButton(checkboxWithTitle: "Route browser traffic through an SSH SOCKS5 proxy", target: nil, action: nil)
    private let sshHost = NSTextField()
    private let sshProxyShareEnabled = NSButton(checkboxWithTitle: "Keep SOCKS5 service running when browser routing is off", target: nil, action: nil)
    private let sshProxyPort = NSTextField()
    private let sshProxyBindAddress = NSPopUpButton()
    private let sshStatus = NSTextField(labelWithString: "Not configured")

    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 700),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Surffish Settings — \(BrowserProfile.current.displayName)"
        window.center()
        super.init(window: window)
        buildInterface()
        loadSettings()
    }

    public required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func buildInterface() {
        guard let content = window?.contentView else { return }
        let heading = NSTextField(labelWithString: "Browser — \(BrowserProfile.current.displayName)")
        heading.font = .systemFont(ofSize: 22, weight: .semibold)

        let description = NSTextField(wrappingLabelWithString: "Core browser preferences. More production settings categories will be migrated into this native settings window in subsequent phases.")
        description.textColor = .secondaryLabelColor
        description.maximumNumberOfLines = 2

        searchEngine.addItems(withTitles: BrowserSearchEngine.allCases.map(\.displayName))
        searchEngine.widthAnchor.constraint(equalToConstant: 220).isActive = true

        startPage.placeholderString = "https://online.bonjourr.fr/"
        startPage.widthAnchor.constraint(equalToConstant: 440).isActive = true

        let searchRow = makeRow(title: "Search engine", control: searchEngine)
        let startRow = makeRow(title: "New tab page", control: startPage)

        let connectionHeading = NSTextField(labelWithString: "Connection")
        connectionHeading.font = .systemFont(ofSize: 17, weight: .semibold)
        sshHost.placeholderString = "SSH config alias or user@host"
        sshHost.widthAnchor.constraint(equalToConstant: 440).isActive = true
        sshProxyPort.placeholderString = "1080"
        sshProxyPort.widthAnchor.constraint(equalToConstant: 110).isActive = true
        sshProxyBindAddress.addItems(withTitles: ["This Mac only (127.0.0.1)", "LAN devices (0.0.0.0)"])
        sshProxyBindAddress.widthAnchor.constraint(equalToConstant: 220).isActive = true
        sshStatus.textColor = .secondaryLabelColor
        sshStatus.maximumNumberOfLines = 3
        let sshHostRow = makeRow(title: "SSH host", control: sshHost)
        let sshPortRow = makeRow(title: "SOCKS5 port", control: sshProxyPort)
        let sshBindRow = makeRow(title: "Listen address", control: sshProxyBindAddress)
        let proxySharingWarning = NSTextField(wrappingLabelWithString: "Other applications on this Mac can use the loopback endpoint whenever the tunnel is running. LAN mode additionally exposes an unauthenticated SOCKS5 listener to other devices; only enable it on a trusted network and protect access with your firewall.") 
        proxySharingWarning.textColor = .secondaryLabelColor
        proxySharingWarning.maximumNumberOfLines = 3

        let copyProxyButton = NSButton(title: "Copy SOCKS5 address", target: self, action: #selector(copyProxyAddress))
        copyProxyButton.bezelStyle = .rounded
        let saveButton = NSButton(title: "Save", target: self, action: #selector(saveSettings))
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"

        let stack = NSStackView(views: [heading, description, searchRow, startRow, restoreSession, showSidebar, connectionHeading, sshProxyEnabled, sshHostRow, sshProxyShareEnabled, sshPortRow, sshBindRow, proxySharingWarning, sshStatus, copyProxyButton, saveButton])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -32),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24)
        ])
    }

    private func makeRow(title: String, control: NSView) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.widthAnchor.constraint(equalToConstant: 110).isActive = true
        let row = NSStackView(views: [label, control])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 16
        return row
    }

    private func loadSettings() {
        let settings = BrowserSettingsStore.shared.settings
        searchEngine.selectItem(withTitle: settings.searchEngine.displayName)
        startPage.stringValue = settings.startPage
        restoreSession.state = settings.restoreSession ? .on : .off
        showSidebar.state = settings.showSidebarAtStartup ? .on : .off
        sshProxyEnabled.state = settings.sshProxyEnabled ? .on : .off
        sshHost.stringValue = settings.sshHost
        sshProxyShareEnabled.state = settings.sshProxyShareEnabled ? .on : .off
        sshProxyPort.stringValue = String(settings.sshProxyPort)
        sshProxyBindAddress.selectItem(at: settings.sshProxyBindAddress == "0.0.0.0" ? 1 : 0)
        sshStatus.stringValue = SshTunnelManager.shared.status
        SshTunnelManager.shared.onStatusChange = { [weak self] status in
            DispatchQueue.main.async { self?.sshStatus.stringValue = status }
        }
    }

    @objc private func copyProxyAddress() {
        let settings = BrowserSettingsStore.shared.settings
        let host = settings.sshProxyBindAddress == "0.0.0.0" ? "127.0.0.1" : settings.sshProxyBindAddress
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("socks5h://\(host):\(settings.sshProxyPort)", forType: .string)
    }

    @objc private func saveSettings() {
        let current = BrowserSettingsStore.shared.settings
        var next = current
        if let title = searchEngine.titleOfSelectedItem,
           let engine = BrowserSearchEngine.allCases.first(where: { $0.displayName == title }) {
            next.searchEngine = engine
        }
        let proposedStartPage = startPage.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: proposedStartPage),
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            next.startPage = url.absoluteString
        } else {
            let alert = NSAlert()
            alert.messageText = "Invalid new tab page"
            alert.informativeText = "Enter a complete HTTP or HTTPS URL."
            alert.alertStyle = .warning
            alert.runModal()
            return
        }
        next.restoreSession = restoreSession.state == .on
        next.showSidebarAtStartup = showSidebar.state == .on
        next.sshProxyEnabled = sshProxyEnabled.state == .on
        next.sshProxyShareEnabled = sshProxyShareEnabled.state == .on
        next.sshHost = sshHost.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(sshProxyPort.stringValue), (1...65535).contains(port) else {
            let alert = NSAlert()
            alert.messageText = "Invalid SOCKS5 port"
            alert.informativeText = "Enter a port between 1 and 65535."
            alert.alertStyle = .warning
            alert.runModal()
            return
        }
        next.sshProxyPort = port
        next.sshProxyBindAddress = next.sshProxyShareEnabled && sshProxyBindAddress.indexOfSelectedItem == 1 ? "0.0.0.0" : "127.0.0.1"
        if (next.sshProxyEnabled || next.sshProxyShareEnabled) && next.sshHost.isEmpty {
            let alert = NSAlert()
            alert.messageText = "SSH host required"
            alert.informativeText = "Enter an SSH config alias or user@host, or turn off browser proxy routing and external SOCKS sharing."
            alert.alertStyle = .warning
            alert.runModal()
            return
        }
        BrowserSettingsStore.shared.update(next)
        Task {
            await SshTunnelManager.shared.configure(
                browserEnabled: next.sshProxyEnabled,
                serverEnabled: next.sshProxyShareEnabled,
                target: next.sshHost,
                port: next.sshProxyPort,
                bindAddress: next.sshProxyBindAddress
            )
            sshStatus.stringValue = SshTunnelManager.shared.status
        }
        window?.close()
    }
}
