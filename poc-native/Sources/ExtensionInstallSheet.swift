import AppKit

public final class ExtensionInstallSheet: NSWindowController {
    private let idField = NSTextField()
    private let statusLabel = NSTextField(labelWithString: "")
    private let spinner = NSProgressIndicator()
    private var installButtons: [NSButton] = []

    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 540, height: 330),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Install Extension"
        super.init(window: window)
        setupUI()
    }

    public required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let header = NSTextField(labelWithString: "Install Bramble Password Manager")
        header.font = .systemFont(ofSize: 16, weight: .bold)
        header.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(header)

        let description = NSTextField(wrappingLabelWithString:
            "Install the signed extension package directly from its official browser store. The extension is stored in this Surffish profile, not inside the app bundle.")
        description.font = .systemFont(ofSize: 12)
        description.textColor = .secondaryLabelColor
        description.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(description)

        let chromeButton = NSButton(title: "Install from Chrome Web Store", target: self, action: #selector(installBrambleChrome))
        chromeButton.bezelStyle = .rounded
        chromeButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(chromeButton)
        installButtons.append(chromeButton)

        let firefoxButton = NSButton(title: "Install from Firefox Add-ons", target: self, action: #selector(installBrambleFirefox))
        firefoxButton.bezelStyle = .rounded
        firefoxButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(firefoxButton)
        installButtons.append(firefoxButton)

        let separator = NSBox()
        separator.boxType = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(separator)

        let customLabel = NSTextField(labelWithString: "Or install another Chromium extension by store ID or URL:")
        customLabel.font = .systemFont(ofSize: 11, weight: .medium)
        customLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(customLabel)

        idField.placeholderString = "32-character Chrome Web Store extension ID or URL"
        idField.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(idField)

        let customButton = NSButton(title: "Install", target: self, action: #selector(installCustomChrome))
        customButton.bezelStyle = .rounded
        customButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(customButton)
        installButtons.append(customButton)

        let fileButton = NSButton(title: "Choose unpacked folder, .zip or .xpi…", target: self, action: #selector(onChooseFile))
        fileButton.bezelStyle = .rounded
        fileButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(fileButton)

        let cancelButton = NSButton(title: "Close", target: self, action: #selector(onCancel))
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(cancelButton)

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(spinner)

        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.maximumNumberOfLines = 2
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            header.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),

            description.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 7),
            description.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            description.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),

            chromeButton.topAnchor.constraint(equalTo: description.bottomAnchor, constant: 16),
            chromeButton.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            chromeButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            chromeButton.heightAnchor.constraint(equalToConstant: 30),

            firefoxButton.topAnchor.constraint(equalTo: chromeButton.bottomAnchor, constant: 8),
            firefoxButton.leadingAnchor.constraint(equalTo: chromeButton.leadingAnchor),
            firefoxButton.trailingAnchor.constraint(equalTo: chromeButton.trailingAnchor),
            firefoxButton.heightAnchor.constraint(equalToConstant: 30),

            separator.topAnchor.constraint(equalTo: firefoxButton.bottomAnchor, constant: 14),
            separator.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),

            customLabel.topAnchor.constraint(equalTo: separator.bottomAnchor, constant: 12),
            customLabel.leadingAnchor.constraint(equalTo: header.leadingAnchor),

            idField.topAnchor.constraint(equalTo: customLabel.bottomAnchor, constant: 7),
            idField.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            idField.trailingAnchor.constraint(equalTo: customButton.leadingAnchor, constant: -8),
            idField.heightAnchor.constraint(equalToConstant: 28),

            customButton.centerYAnchor.constraint(equalTo: idField.centerYAnchor),
            customButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            customButton.widthAnchor.constraint(equalToConstant: 86),

            fileButton.topAnchor.constraint(equalTo: idField.bottomAnchor, constant: 12),
            fileButton.leadingAnchor.constraint(equalTo: header.leadingAnchor),

            cancelButton.centerYAnchor.constraint(equalTo: fileButton.centerYAnchor),
            cancelButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            cancelButton.widthAnchor.constraint(equalToConstant: 80),

            spinner.topAnchor.constraint(equalTo: fileButton.bottomAnchor, constant: 13),
            spinner.leadingAnchor.constraint(equalTo: header.leadingAnchor),

            statusLabel.centerYAnchor.constraint(equalTo: spinner.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: spinner.trailingAnchor, constant: 8),
            statusLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20)
        ])
    }

    private func setInstalling(_ installing: Bool, message: String) {
        spinner.isHidden = !installing
        if installing { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }
        installButtons.forEach { $0.isEnabled = !installing }
        statusLabel.stringValue = message
        statusLabel.textColor = .secondaryLabelColor
    }

    private func install(_ operation: @escaping () async throws -> LoadedExtensionInfo) {
        setInstalling(true, message: "Downloading, unpacking and loading extension…")
        Task { [weak self] in
            do {
                let info = try await operation()
                await MainActor.run {
                    guard let self else { return }
                    self.setInstalling(false, message: "Installed and loaded \(info.name) v\(info.version).")
                    self.statusLabel.textColor = .systemGreen
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    self.setInstalling(false, message: "Install failed: \(error.localizedDescription)")
                    self.statusLabel.textColor = .systemRed
                }
            }
        }
    }

    @objc private func installBrambleChrome() {
        install { try await WebExtensionManager.shared.installBrambleFromChromeStore() }
    }

    @objc private func installBrambleFirefox() {
        install { try await WebExtensionManager.shared.installBrambleFromFirefoxAddons() }
    }

    @objc private func installCustomChrome() {
        let input = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else {
            statusLabel.stringValue = "Enter a Chrome Web Store extension ID or URL."
            statusLabel.textColor = .systemRed
            return
        }
        install { try await WebExtensionManager.shared.installFromChromeWebStore(idOrUrl: input) }
    }

    @objc private func onCancel() {
        if let window { window.sheetParent?.endSheet(window, returnCode: .cancel) }
    }

    @objc private func onChooseFile() {
        guard let window else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Install"
        panel.allowedContentTypes = []
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.install { try await WebExtensionManager.shared.installFromZipOrDirectory(url: url) }
        }
    }
}
