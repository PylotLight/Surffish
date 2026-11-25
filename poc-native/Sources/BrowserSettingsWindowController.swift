import AppKit

@MainActor
public final class BrowserSettingsViewController: NSViewController {
    public var onClose: (() -> Void)?
    public var onInstallExtension: (() -> Void)?

    private let installedExtensionsStack = NSStackView()
    private let extensionStatus = NSTextField(labelWithString: "")

    private let searchEngine = NSPopUpButton()
    private let startPage = NSTextField()
    private let restoreSession = NSButton(checkboxWithTitle: "Restore tabs from the previous session", target: nil, action: nil)
    private let showSidebar = NSButton(checkboxWithTitle: "Show sidebar at startup", target: nil, action: nil)
    private let sshProxyEnabled = NSButton(checkboxWithTitle: "Route browser traffic through an SSH SOCKS5 proxy", target: nil, action: nil)
    private let sshHost = NSComboBox()
    private let sshHostSearchButton = NSButton(title: "Search SSH configs", target: nil, action: nil)
    private let sshHostSearchStatus = NSTextField(labelWithString: "")
    private let sshProxyShareEnabled = NSButton(checkboxWithTitle: "Keep the local SOCKS endpoint running when browser routing is off", target: nil, action: nil)
    private let sshProxyPort = NSTextField()
    private let sshProxyBindAddress = NSPopUpButton()

    public override func loadView() {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(red: 0.075, green: 0.08, blue: 0.095, alpha: 1).cgColor
        view = root
        buildInterface()
        loadSettings()
        refreshExtensions()
        WebExtensionManager.shared.addExtensionsObserver { [weak self] _ in self?.refreshExtensions() }
    }

    private func buildInterface() {
        let heading = NSTextField(labelWithString: "Settings")
        heading.font = .systemFont(ofSize: 25, weight: .semibold)

        let description = NSTextField(wrappingLabelWithString: "Configure Surffish browser and connection preferences.")
        description.textColor = .secondaryLabelColor
        description.maximumNumberOfLines = 2

        searchEngine.addItems(withTitles: BrowserSearchEngine.allCases.map(\.displayName))
        searchEngine.widthAnchor.constraint(equalToConstant: 220).isActive = true
        startPage.placeholderString = "https://online.bonjourr.fr/"
        startPage.widthAnchor.constraint(equalToConstant: 440).isActive = true

        let extensionsHeading = NSTextField(labelWithString: "Extensions")
        extensionsHeading.font = .systemFont(ofSize: 17, weight: .semibold)
        let installExtensionButton = NSButton(title: "Install extension…", target: self, action: #selector(installExtension))
        installExtensionButton.bezelStyle = .rounded
        let extensionDescription = NSTextField(wrappingLabelWithString: "Manage extensions installed in this Surffish profile. Remove an extension here; use Option-click or right-click its toolbar icon for quick actions.")
        extensionDescription.textColor = .secondaryLabelColor
        extensionDescription.maximumNumberOfLines = 2
        installedExtensionsStack.orientation = .vertical
        installedExtensionsStack.alignment = .leading
        installedExtensionsStack.spacing = 8
        extensionStatus.textColor = .secondaryLabelColor

        let connectionHeading = NSTextField(labelWithString: "Connection")
        connectionHeading.font = .systemFont(ofSize: 17, weight: .semibold)
        sshHost.placeholderString = "Select an SSH host or enter user@host"
        sshHost.widthAnchor.constraint(equalToConstant: 340).isActive = true
        sshHostSearchButton.target = self
        sshHostSearchButton.action = #selector(searchSshHosts)
        sshHostSearchButton.bezelStyle = .rounded
        sshHostSearchStatus.textColor = .secondaryLabelColor
        sshHostSearchStatus.maximumNumberOfLines = 2
        sshProxyPort.placeholderString = "1080"
        sshProxyPort.widthAnchor.constraint(equalToConstant: 110).isActive = true
        sshProxyBindAddress.addItems(withTitles: ["This Mac only (127.0.0.1)", "LAN devices (0.0.0.0)"])
        sshProxyBindAddress.widthAnchor.constraint(equalToConstant: 220).isActive = true

        let sshHostControls = NSStackView(views: [sshHost, sshHostSearchButton])
        sshHostControls.orientation = .horizontal
        sshHostControls.alignment = .centerY
        sshHostControls.spacing = 8

        let hostHint = NSTextField(wrappingLabelWithString: "Search reads Host names from your local ~/.ssh/config (including included config files). Select one to fill this field, or enter an SSH alias or user@host manually. OpenSSH reads the host, SSH port, identity and authentication settings from that configuration.")
        hostHint.textColor = .secondaryLabelColor
        hostHint.maximumNumberOfLines = 3

        let warning = NSTextField(wrappingLabelWithString: "Surffish opens a local SOCKS5 endpoint and carries browser connections through SSH. Destination traffic exits from the SSH host. LAN sharing exposes the local endpoint without SOCKS authentication; use only on a trusted network.")
        warning.textColor = .secondaryLabelColor
        warning.maximumNumberOfLines = 3

        let copyProxyButton = NSButton(title: "Copy local SOCKS5 address", target: self, action: #selector(copyProxyAddress))
        copyProxyButton.bezelStyle = .rounded
        let saveButton = NSButton(title: "Save & Apply", target: self, action: #selector(saveSettings))
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        let doneButton = NSButton(title: "Done", target: self, action: #selector(closeSettings))
        doneButton.bezelStyle = .rounded

        let actionRow = NSStackView(views: [copyProxyButton, NSView(), saveButton, doneButton])
        actionRow.orientation = .horizontal
        actionRow.alignment = .centerY
        actionRow.distribution = .fill
        actionRow.spacing = 10

        let stack = NSStackView(views: [
            heading,
            description,
            makeRow(title: "Search engine", control: searchEngine),
            makeRow(title: "New tab page", control: startPage),
            restoreSession,
            showSidebar,
            extensionsHeading,
            extensionDescription,
            installExtensionButton,
            extensionStatus,
            installedExtensionsStack,
            connectionHeading,
            sshProxyEnabled,
            makeRow(title: "SSH host", control: sshHostControls),
            hostHint,
            sshHostSearchStatus,
            sshProxyShareEnabled,
            makeRow(title: "Shared SOCKS5 port", control: sshProxyPort),
            makeRow(title: "Listen address", control: sshProxyBindAddress),
            warning,
            actionRow
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 13
        stack.translatesAutoresizingMaskIntoConstraints = false

        let scroll = NSScrollView()
        scroll.documentView = stack
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 34),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -34),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor, constant: -4),
            actionRow.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])

    }

    private func makeRow(title: String, control: NSView) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.widthAnchor.constraint(equalToConstant: 130).isActive = true
        let row = NSStackView(views: [label, control])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 16
        return row
    }

    @objc private func installExtension() { onInstallExtension?() }

    private func refreshExtensions() {
        installedExtensionsStack.arrangedSubviews.forEach { view in
            installedExtensionsStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        let extensions = WebExtensionManager.shared.loadedExtensions
        extensionStatus.stringValue = extensions.isEmpty ? "No extensions installed" : "\(extensions.count) installed"
        for item in extensions {
            let name = NSTextField(labelWithString: "\(item.name)  ·  v\(item.version)")
            name.font = .systemFont(ofSize: 13, weight: .medium)
            let details = NSTextField(labelWithString: item.hasPopup ? "Toolbar popup available" : "Background / options extension")
            details.font = .systemFont(ofSize: 11)
            details.textColor = .secondaryLabelColor
            let remove = NSButton(title: "Uninstall", target: self, action: #selector(uninstallExtension(_:)))
            remove.bezelStyle = .rounded
            remove.tag = extensions.firstIndex(where: { $0.id == item.id }) ?? 0
            let row = NSStackView(views: [name, NSView(), remove])
            row.orientation = .horizontal
            row.alignment = .centerY
            row.distribution = .fill
            row.widthAnchor.constraint(equalToConstant: 560).isActive = true
            let group = NSStackView(views: [row, details])
            group.orientation = .vertical
            group.alignment = .leading
            group.spacing = 3
            installedExtensionsStack.addArrangedSubview(group)
        }
        if extensions.isEmpty {
            let empty = NSTextField(labelWithString: "Install Bramble or another compatible WebExtension to get started.")
            empty.textColor = .secondaryLabelColor
            installedExtensionsStack.addArrangedSubview(empty)
        }
    }

    @objc private func uninstallExtension(_ sender: NSButton) {
        let extensions = WebExtensionManager.shared.loadedExtensions
        guard sender.tag >= 0, sender.tag < extensions.count else { return }
        let item = extensions[sender.tag]
        let alert = NSAlert()
        alert.messageText = "Uninstall \(item.name)?"
        alert.informativeText = "The extension will be unloaded and removed from this Surffish profile."
        alert.addButton(withTitle: "Uninstall")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        Task {
            do {
                try await WebExtensionManager.shared.uninstallExtension(id: item.id)
            } catch {
                showValidationAlert(title: "Could not uninstall extension", message: error.localizedDescription)
            }
        }
    }

    private func loadSettings() {
        let settings = BrowserSettingsStore.shared.settings
        searchEngine.selectItem(withTitle: settings.searchEngine.displayName)
        startPage.stringValue = settings.startPage
        restoreSession.state = settings.restoreSession ? .on : .off
        showSidebar.state = settings.showSidebarAtStartup ? .on : .off
        sshProxyEnabled.state = settings.sshProxyEnabled ? .on : .off
        sshHost.stringValue = settings.sshHost
        searchSshHosts()
        sshProxyShareEnabled.state = settings.sshProxyShareEnabled ? .on : .off
        sshProxyPort.stringValue = String(settings.sshProxyPort)
        sshProxyBindAddress.selectItem(at: settings.sshProxyBindAddress == "0.0.0.0" ? 1 : 0)
    }

    @objc private func searchSshHosts() {
        sshHostSearchButton.isEnabled = false
        sshHostSearchStatus.stringValue = "Searching your SSH config…"
        Task { [weak self] in
            do {
                let aliases = try await Task.detached {
                    try SshConfigHostDiscovery.discover()
                }.value
                guard let self else { return }
                self.sshHost.removeAllItems()
                self.sshHost.addItems(withObjectValues: aliases)
                self.sshHostSearchStatus.stringValue = aliases.isEmpty
                    ? "No saved Host aliases found in ~/.ssh/config. You can still enter user@host manually."
                    : "Found \(aliases.count) saved SSH \(aliases.count == 1 ? "host" : "hosts"). Choose one or keep typing manually."
                self.sshHostSearchButton.isEnabled = true
            } catch {
                guard let self else { return }
                self.sshHostSearchStatus.stringValue = "Could not search SSH config: \(error.localizedDescription)"
                self.sshHostSearchButton.isEnabled = true
            }
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
            showValidationAlert(title: "Invalid new tab page", message: "Enter a complete HTTP or HTTPS URL.")
            return
        }

        next.restoreSession = restoreSession.state == .on
        next.showSidebarAtStartup = showSidebar.state == .on
        next.sshProxyEnabled = sshProxyEnabled.state == .on
        next.sshProxyShareEnabled = sshProxyShareEnabled.state == .on
        next.sshHost = sshHost.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let port = Int(sshProxyPort.stringValue), (1...65535).contains(port) else {
            showValidationAlert(title: "Invalid SOCKS5 port", message: "Enter a port between 1 and 65535.")
            return
        }
        next.sshProxyPort = port
        next.sshProxyBindAddress = next.sshProxyShareEnabled && sshProxyBindAddress.indexOfSelectedItem == 1 ? "0.0.0.0" : "127.0.0.1"

        if (next.sshProxyEnabled || next.sshProxyShareEnabled) && next.sshHost.isEmpty {
            showValidationAlert(title: "SSH host required", message: "Enter an SSH config alias or user@host, or turn off browser proxy routing and external SOCKS sharing.")
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
        }
    }

    private func showValidationAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    @objc private func closeSettings() {
        onClose?()
    }
}
