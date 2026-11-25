import AppKit
import WebKit

@MainActor
public final class BrowserSettingsViewController: NSViewController {
    public var onClose: (() -> Void)?
    public var onInstallExtension: (() -> Void)?
    public var onSettingsSaved: ((BrowserSettings) -> Void)?

    private let installedExtensionsStack = NSStackView()
    private let extensionStatus = NSTextField(labelWithString: "")
    private let searchEngine = NSPopUpButton()
    private let startPage = NSTextField()
    private let restoreSession = NSButton(checkboxWithTitle: "Restore tabs from the previous session", target: nil, action: nil)
    private let showSidebar = NSButton(checkboxWithTitle: "Show sidebar at startup", target: nil, action: nil)
    private let adBlockingEnabled = NSButton(checkboxWithTitle: "Block common advertising and tracking requests", target: nil, action: nil)
    private let sshProxyEnabled = NSButton(checkboxWithTitle: "Route browser traffic through an SSH SOCKS5 proxy", target: nil, action: nil)
    private let sshHost = NSComboBox()
    private let sshHostSearchButton = NSButton(title: "Search SSH configs", target: nil, action: nil)
    private let sshHostSearchStatus = NSTextField(labelWithString: "")
    private let sshProxyShareEnabled = NSButton(checkboxWithTitle: "Keep the local SOCKS endpoint running when browser routing is off", target: nil, action: nil)
    private let sshProxyPort = NSTextField()
    private let sshProxyBindAddress = NSPopUpButton()
    private let pagePicker = NSSegmentedControl(labels: ["General", "Privacy", "Extensions", "Connection", "About"], trackingMode: .selectOne, target: nil, action: nil)
    private let scrollView = NSScrollView()
    private let clearWebsiteDataButton = NSButton(title: "Clear profile website data…", target: nil, action: nil)
    private let copyProxyButton = NSButton(title: "Copy local SOCKS5 address", target: nil, action: nil)
    private var pageStacks: [NSStackView] = []
    private var activePageWidthConstraint: NSLayoutConstraint?

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

        let description = NSTextField(wrappingLabelWithString: "A focused set of native browser preferences, organized by task.")
        description.textColor = .secondaryLabelColor
        description.maximumNumberOfLines = 2

        searchEngine.addItems(withTitles: BrowserSearchEngine.allCases.map(\.displayName))
        searchEngine.widthAnchor.constraint(equalToConstant: 220).isActive = true
        startPage.placeholderString = "surffish://newtab/ or https://example.com"
        startPage.widthAnchor.constraint(equalToConstant: 440).isActive = true

        let extensionHeading = makeSectionHeading("Extensions")
        let installExtensionButton = NSButton(title: "Install extension…", target: self, action: #selector(installExtension))
        installExtensionButton.bezelStyle = .rounded
        let extensionDescription = NSTextField(wrappingLabelWithString: "Manage extensions installed in this Surffish profile. Remove an extension here; use Option-click or right-click its toolbar icon for quick actions.")
        extensionDescription.textColor = .secondaryLabelColor
        extensionDescription.maximumNumberOfLines = 3
        installedExtensionsStack.orientation = .vertical
        installedExtensionsStack.alignment = .leading
        installedExtensionsStack.spacing = 8
        extensionStatus.textColor = .secondaryLabelColor

        let connectionHeading = makeSectionHeading("SSH SOCKS5 connection")
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

        let hostHint = NSTextField(wrappingLabelWithString: "Choose an SSH alias or enter user@host. OpenSSH reads the host, port, identity, ProxyJump and authentication settings from your local SSH configuration.")
        hostHint.textColor = .secondaryLabelColor
        hostHint.maximumNumberOfLines = 3

        let networkWarning = NSTextField(wrappingLabelWithString: "Surffish opens a local SOCKS5 endpoint and carries traffic through SSH; the SSH host is the exit point. LAN sharing exposes the endpoint without SOCKS authentication, so use it only on a trusted network.")
        networkWarning.textColor = .secondaryLabelColor
        networkWarning.maximumNumberOfLines = 4

        let privacyDescription = NSTextField(wrappingLabelWithString: "The current native blocker uses a small built-in WebKit rule set. It is not yet equivalent to the Electron build’s full filter-list and scriptlet coverage.")
        privacyDescription.textColor = .secondaryLabelColor
        privacyDescription.maximumNumberOfLines = 4
        clearWebsiteDataButton.bezelStyle = .rounded
        clearWebsiteDataButton.target = self
        clearWebsiteDataButton.action = #selector(clearWebsiteData)

        copyProxyButton.bezelStyle = .rounded
        copyProxyButton.target = self
        copyProxyButton.action = #selector(copyProxyAddress)
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

        pageStacks = [
            makePage([
                makeSection(title: "Browser", description: "Choose how Surffish opens and searches.", content: [
                    makeRow(title: "Search engine", control: searchEngine),
                    makeRow(title: "New tab page", control: startPage),
                    restoreSession,
                    showSidebar
                ])
            ]),
            makePage([
                makeSection(title: "Privacy & site data", description: "These controls apply to this app profile only.", content: [
                    adBlockingEnabled,
                    privacyDescription,
                    clearWebsiteDataButton
                ])
            ]),
            makePage([
                makeSection(title: "Extensions", description: "Extensions are installed separately into the selected Surffish profile.", content: [
                    extensionHeading,
                    extensionDescription,
                    installExtensionButton,
                    extensionStatus,
                    installedExtensionsStack
                ])
            ]),
            makePage([
                makeSection(title: "Connection", description: "Use the SSH host as the SOCKS5 exit. Browser routing and external sharing can be enabled independently.", content: [
                    sshProxyEnabled,
                    makeRow(title: "SSH host", control: sshHostControls),
                    hostHint,
                    sshHostSearchStatus,
                    sshProxyShareEnabled,
                    makeRow(title: "Local SOCKS5 port", control: sshProxyPort),
                    makeRow(title: "Listen address", control: sshProxyBindAddress),
                    networkWarning
                ])
            ]),
            makePage([
                makeSection(title: "About this profile", description: "Native Surffish uses AppKit and WebKit on macOS 26 or later.", content: [
                    makeInfoRow(title: "Profile", value: BrowserProfile.current.displayName),
                    makeInfoRow(title: "Profile storage", value: "Settings, bookmarks, history, extensions and website data are isolated by profile."),
                    makeInfoRow(title: "Engine", value: "WebKit (native macOS)"),
                    makeInfoRow(title: "Platform", value: ProcessInfo.processInfo.operatingSystemVersionString)
                ])
            ])
        ]

        pagePicker.segmentStyle = .rounded
        pagePicker.selectedSegment = 0
        pagePicker.target = self
        pagePicker.action = #selector(selectPage(_:))
        pagePicker.translatesAutoresizingMaskIntoConstraints = false

        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(heading)
        view.addSubview(description)
        view.addSubview(pagePicker)
        view.addSubview(scrollView)
        view.addSubview(actionRow)

        heading.translatesAutoresizingMaskIntoConstraints = false
        description.translatesAutoresizingMaskIntoConstraints = false
        actionRow.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            heading.topAnchor.constraint(equalTo: view.topAnchor, constant: 24),
            heading.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 30),
            description.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 6),
            description.leadingAnchor.constraint(equalTo: heading.leadingAnchor),
            description.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -30),
            pagePicker.topAnchor.constraint(equalTo: description.bottomAnchor, constant: 18),
            pagePicker.leadingAnchor.constraint(equalTo: heading.leadingAnchor),
            pagePicker.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -30),
            scrollView.topAnchor.constraint(equalTo: pagePicker.bottomAnchor, constant: 14),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 26),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -26),
            scrollView.bottomAnchor.constraint(equalTo: actionRow.topAnchor, constant: -12),
            actionRow.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 30),
            actionRow.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -30),
            actionRow.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -18),
            actionRow.heightAnchor.constraint(equalToConstant: 34)
        ])
        displayPage(at: 0)
    }

    private func makePage(_ sections: [NSView]) -> NSStackView {
        let stack = NSStackView(views: sections)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }

    private func makeSection(title: String, description: String, content: [NSView]) -> NSView {
        let titleLabel = makeSectionHeading(title)
        let descriptionLabel = NSTextField(wrappingLabelWithString: description)
        descriptionLabel.textColor = .secondaryLabelColor
        descriptionLabel.maximumNumberOfLines = 3

        let sectionViews: [NSView] = [titleLabel, descriptionLabel] + content
        let stack = NSStackView(views: sectionViews)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 11
        stack.translatesAutoresizingMaskIntoConstraints = false

        let card = NSView()
        card.wantsLayer = true
        card.layer?.cornerRadius = 12
        card.layer?.backgroundColor = NSColor(white: 1, alpha: 0.045).cgColor
        card.layer?.borderColor = NSColor(white: 1, alpha: 0.08).cgColor
        card.layer?.borderWidth = 1
        card.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            card.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor, constant: -4)
        ])
        return card
    }

    private func makeSectionHeading(_ title: String) -> NSTextField {
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 17, weight: .semibold)
        return heading
    }

    private func makeRow(title: String, control: NSView) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.widthAnchor.constraint(equalToConstant: 145).isActive = true
        let row = NSStackView(views: [label, control])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 16
        return row
    }

    private func makeInfoRow(title: String, value: String) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.widthAnchor.constraint(equalToConstant: 145).isActive = true
        let valueLabel = NSTextField(wrappingLabelWithString: value)
        valueLabel.textColor = .secondaryLabelColor
        valueLabel.maximumNumberOfLines = 3
        let row = NSStackView(views: [label, valueLabel])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 16
        return row
    }

    @objc private func selectPage(_ sender: NSSegmentedControl) {
        displayPage(at: sender.selectedSegment)
    }

    private func displayPage(at index: Int) {
        guard pageStacks.indices.contains(index) else { return }
        activePageWidthConstraint?.isActive = false
        let stack = pageStacks[index]
        scrollView.documentView = stack
        let width = stack.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor, constant: -4)
        width.isActive = true
        activePageWidthConstraint = width
        copyProxyButton.isHidden = index != 3
    }

    @objc private func installExtension() { onInstallExtension?() }

    private func refreshExtensions() {
        installedExtensionsStack.arrangedSubviews.forEach { subview in
            installedExtensionsStack.removeArrangedSubview(subview)
            subview.removeFromSuperview()
        }
        let extensions = WebExtensionManager.shared.loadedExtensions
        extensionStatus.stringValue = extensions.isEmpty ? "No extensions installed" : "\(extensions.count) installed"
        for (index, item) in extensions.enumerated() {
            let name = NSTextField(labelWithString: "\(item.name)  ·  v\(item.version)")
            name.font = .systemFont(ofSize: 13, weight: .medium)
            let details = NSTextField(labelWithString: item.hasPopup ? "Toolbar popup available" : "Background / options extension")
            details.font = .systemFont(ofSize: 11)
            details.textColor = .secondaryLabelColor
            let remove = NSButton(title: "Uninstall", target: self, action: #selector(uninstallExtension(_:)))
            remove.bezelStyle = .rounded
            remove.tag = index
            let row = NSStackView(views: [name, NSView(), remove])
            row.orientation = .horizontal
            row.alignment = .centerY
            row.distribution = .fill
            row.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor, constant: -44).isActive = true
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
        guard extensions.indices.contains(sender.tag) else { return }
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
        adBlockingEnabled.state = settings.adBlockingEnabled ? .on : .off
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

    @objc private func clearWebsiteData() {
        let alert = NSAlert()
        alert.messageText = "Clear website data for \(BrowserProfile.current.displayName)?"
        alert.informativeText = "This removes cookies, caches and other website storage for this native app profile. It does not clear bookmarks or browsing history."
        alert.addButton(withTitle: "Clear Website Data")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let dataStore = WKWebsiteDataStore(forIdentifier: BrowserProfile.current.websiteDataStoreIdentifier)
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        dataStore.fetchDataRecords(ofTypes: dataTypes) { [weak self] records in
            dataStore.removeData(ofTypes: dataTypes, for: records) {
                DispatchQueue.main.async {
                    self?.showValidationAlert(title: "Website data cleared", message: "Website data was removed from the \(BrowserProfile.current.displayName) profile.")
                }
            }
        }
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
           scheme == "http" || scheme == "https" || (scheme == "surffish" && url.host == "newtab") {
            next.startPage = url.absoluteString
        } else {
            showValidationAlert(title: "Invalid new tab page", message: "Enter the built-in surffish://newtab/ page or a complete HTTP or HTTPS URL.")
            return
        }

        next.restoreSession = restoreSession.state == .on
        next.showSidebarAtStartup = showSidebar.state == .on
        next.adBlockingEnabled = adBlockingEnabled.state == .on
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
        AdBlockManager.shared.setEnabled(next.adBlockingEnabled)
        onSettingsSaved?(next)
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
