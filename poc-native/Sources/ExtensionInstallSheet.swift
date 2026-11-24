import AppKit

public final class ExtensionInstallSheet: NSWindowController {
    private let idField = NSTextField()
    private let statusLabel = NSTextField(labelWithString: "")
    private let spinner = NSProgressIndicator()
    
    public init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 280),
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
        guard let window = window, let contentView = window.contentView else { return }
        
        let headerLabel = NSTextField(labelWithString: "Install Chrome or Firefox Extension")
        headerLabel.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        headerLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(headerLabel)
        
        let hintLabel = NSTextField(labelWithString: "Enter a 32-character Chrome Web Store ID or store URL:")
        hintLabel.font = NSFont.systemFont(ofSize: 12)
        hintLabel.textColor = .secondaryLabelColor
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(hintLabel)
        
        idField.placeholderString = "e.g. cjpalhdlnbpafiamejdnhcphjbkeiagm (uBlock Origin)"
        idField.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(idField)
        
        let installWebStoreButton = NSButton(title: "Install from Web Store", target: self, action: #selector(onInstallWebStore))
        installWebStoreButton.bezelStyle = .rounded
        installWebStoreButton.keyEquivalent = "\r" // Enter key default!
        installWebStoreButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(installWebStoreButton)
        
        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(onCancel))
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}" // Escape key!
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(cancelButton)
        
        let fileButton = NSButton(title: "Choose Unpacked Folder or .zip / .xpi...", target: self, action: #selector(onChooseFile))
        fileButton.bezelStyle = .rounded
        fileButton.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(fileButton)
        
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(spinner)
        
        statusLabel.font = NSFont.systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(statusLabel)
        
        NSLayoutConstraint.activate([
            headerLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            headerLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            
            hintLabel.topAnchor.constraint(equalTo: headerLabel.bottomAnchor, constant: 6),
            hintLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            
            idField.topAnchor.constraint(equalTo: hintLabel.bottomAnchor, constant: 10),
            idField.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            idField.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            cancelButton.topAnchor.constraint(equalTo: idField.bottomAnchor, constant: 14),
            cancelButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            cancelButton.widthAnchor.constraint(equalToConstant: 80),
            
            installWebStoreButton.centerYAnchor.constraint(equalTo: cancelButton.centerYAnchor),
            installWebStoreButton.trailingAnchor.constraint(equalTo: cancelButton.leadingAnchor, constant: -8),
            
            spinner.centerYAnchor.constraint(equalTo: installWebStoreButton.centerYAnchor),
            spinner.trailingAnchor.constraint(equalTo: installWebStoreButton.leadingAnchor, constant: -10),
            
            fileButton.topAnchor.constraint(equalTo: cancelButton.bottomAnchor, constant: 14),
            fileButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            
            statusLabel.topAnchor.constraint(equalTo: fileButton.bottomAnchor, constant: 14),
            statusLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
        ])
    }
    
    @objc private func onCancel() {
        if let win = window {
            win.sheetParent?.endSheet(win, returnCode: .cancel)
        }
    }
    
    @objc private func onInstallWebStore() {
        let input = idField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }
        
        spinner.startAnimation(nil)
        statusLabel.stringValue = "Downloading & unpacking extension..."
        statusLabel.textColor = .secondaryLabelColor
        
        Task { [weak self] in
            do {
                let info = try await WebExtensionManager.shared.installFromChromeWebStore(idOrUrl: input)
                DispatchQueue.main.async {
                    self?.spinner.stopAnimation(nil)
                    self?.statusLabel.stringValue = "✓ Successfully installed \(info.name) v\(info.version)!"
                    self?.statusLabel.textColor = .systemGreen
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                        self?.onCancel()
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self?.spinner.stopAnimation(nil)
                    self?.statusLabel.stringValue = "✗ Failed: \(error.localizedDescription)"
                    self?.statusLabel.textColor = .systemRed
                }
            }
        }
    }
    
    @objc private func onChooseFile() {
        guard let window = self.window else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Install"
        panel.allowedContentTypes = []
        
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self = self else { return }
            if response == .OK, let url = panel.url {
                self.spinner.startAnimation(nil)
                self.statusLabel.stringValue = "Loading..."
                Task {
                    do {
                        let info = try await WebExtensionManager.shared.installFromZipOrDirectory(url: url)
                        DispatchQueue.main.async {
                            self.spinner.stopAnimation(nil)
                            self.statusLabel.stringValue = "✓ Installed \(info.name) v\(info.version)!"
                            self.statusLabel.textColor = .systemGreen
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                                self.onCancel()
                            }
                        }
                    } catch {
                        DispatchQueue.main.async {
                            self.spinner.stopAnimation(nil)
                            self.statusLabel.stringValue = "✗ Error: \(error.localizedDescription)"
                            self.statusLabel.textColor = .systemRed
                        }
                    }
                }
            }
        }
    }
}
