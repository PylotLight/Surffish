import AppKit
import WebKit

public protocol OmniboxViewDelegate: AnyObject {
    func omniboxDidSubmit(input: String)
    func omniboxDidClickBack()
    func omniboxDidClickForward()
    func omniboxDidClickReload()
    func omniboxDidToggleSidebar()
    func omniboxDidToggleAdBlock()
    func omniboxDidRequestInstallExtension()
    func omniboxDidRequestBramblePopup(sender: NSButton)
}

public final class OmniboxView: NSVisualEffectView, NSTextFieldDelegate {
    public weak var delegate: OmniboxViewDelegate?
    
    private let sidebarToggleBtn = NSButton()
    private let backBtn = NSButton()
    private let forwardBtn = NSButton()
    private let reloadBtn = NSButton()
    
    private let pillContainer = NSView()
    private let lockIcon = NSTextField(labelWithString: "🔒")
    private let addressField = NSTextField()
    private let progressBar = NSProgressIndicator()
    
    private let brambleBtn = NSButton()
    private let adBlockBtn = NSButton()
    private let installExtBtn = NSButton()
    
    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupView()
    }
    
    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupView()
    }
    
    private func setupView() {
        material = .headerView
        blendingMode = .withinWindow
        state = .active
        wantsLayer = true
        
        // Buttons
        configureButton(sidebarToggleBtn, title: "☰", action: #selector(onToggleSidebar))
        sidebarToggleBtn.toolTip = "Toggle Sidebar (Cmd+\\)"
        
        configureButton(backBtn, title: "◀", action: #selector(onBack))
        configureButton(forwardBtn, title: "▶", action: #selector(onForward))
        configureButton(reloadBtn, title: "⟳", action: #selector(onReload))
        
        // Pill container (dark translucent glass pill)
        pillContainer.wantsLayer = true
        pillContainer.layer?.backgroundColor = NSColor(white: 0.15, alpha: 0.45).cgColor
        pillContainer.layer?.cornerRadius = 9
        pillContainer.layer?.borderColor = NSColor(white: 1.0, alpha: 0.12).cgColor
        pillContainer.layer?.borderWidth = 1
        pillContainer.translatesAutoresizingMaskIntoConstraints = false
        addSubview(pillContainer)
        
        lockIcon.font = NSFont.systemFont(ofSize: 11)
        lockIcon.textColor = .secondaryLabelColor
        lockIcon.translatesAutoresizingMaskIntoConstraints = false
        pillContainer.addSubview(lockIcon)
        
        addressField.isBordered = false
        addressField.drawsBackground = false
        addressField.focusRingType = .none
        addressField.font = NSFont.systemFont(ofSize: 13, weight: .regular)
        addressField.textColor = .labelColor
        addressField.placeholderString = "Search with DuckDuckGo or enter address..."
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
        
        // Right tool buttons
        configureButton(brambleBtn, title: "🫐", action: #selector(onBrambleClicked))
        brambleBtn.toolTip = "Bramble Password Manager"
        
        configureButton(adBlockBtn, title: "🛡️", action: #selector(onAdBlockClicked))
        adBlockBtn.toolTip = "Toggle AdBlock"
        
        configureButton(installExtBtn, title: "🧩+", action: #selector(onInstallExtClicked))
        installExtBtn.toolTip = "Install Extension..."
        
        NSLayoutConstraint.activate([
            // Inset 10pt (clean alignment with right side of sidebar)
            sidebarToggleBtn.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            sidebarToggleBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            sidebarToggleBtn.widthAnchor.constraint(equalToConstant: 28),
            sidebarToggleBtn.heightAnchor.constraint(equalToConstant: 28),
            
            backBtn.leadingAnchor.constraint(equalTo: sidebarToggleBtn.trailingAnchor, constant: 6),
            backBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            backBtn.widthAnchor.constraint(equalToConstant: 28),
            backBtn.heightAnchor.constraint(equalToConstant: 28),
            
            forwardBtn.leadingAnchor.constraint(equalTo: backBtn.trailingAnchor, constant: 4),
            forwardBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            forwardBtn.widthAnchor.constraint(equalToConstant: 28),
            forwardBtn.heightAnchor.constraint(equalToConstant: 28),
            
            reloadBtn.leadingAnchor.constraint(equalTo: forwardBtn.trailingAnchor, constant: 4),
            reloadBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            reloadBtn.widthAnchor.constraint(equalToConstant: 28),
            reloadBtn.heightAnchor.constraint(equalToConstant: 28),
            
            // Omnibox Pill
            pillContainer.leadingAnchor.constraint(equalTo: reloadBtn.trailingAnchor, constant: 10),
            pillContainer.trailingAnchor.constraint(equalTo: brambleBtn.leadingAnchor, constant: -10),
            pillContainer.centerYAnchor.constraint(equalTo: centerYAnchor),
            pillContainer.heightAnchor.constraint(equalToConstant: 30),
            
            lockIcon.leadingAnchor.constraint(equalTo: pillContainer.leadingAnchor, constant: 8),
            lockIcon.centerYAnchor.constraint(equalTo: pillContainer.centerYAnchor),
            
            addressField.leadingAnchor.constraint(equalTo: lockIcon.trailingAnchor, constant: 6),
            addressField.trailingAnchor.constraint(equalTo: pillContainer.trailingAnchor, constant: -8),
            addressField.centerYAnchor.constraint(equalTo: pillContainer.centerYAnchor),
            
            progressBar.leadingAnchor.constraint(equalTo: pillContainer.leadingAnchor, constant: 2),
            progressBar.trailingAnchor.constraint(equalTo: pillContainer.trailingAnchor, constant: -2),
            progressBar.bottomAnchor.constraint(equalTo: pillContainer.bottomAnchor),
            progressBar.heightAnchor.constraint(equalToConstant: 2),
            
            // Right controls
            installExtBtn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            installExtBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            installExtBtn.widthAnchor.constraint(equalToConstant: 32),
            installExtBtn.heightAnchor.constraint(equalToConstant: 28),
            
            adBlockBtn.trailingAnchor.constraint(equalTo: installExtBtn.leadingAnchor, constant: -6),
            adBlockBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            adBlockBtn.widthAnchor.constraint(equalToConstant: 32),
            adBlockBtn.heightAnchor.constraint(equalToConstant: 28),
            
            brambleBtn.trailingAnchor.constraint(equalTo: adBlockBtn.leadingAnchor, constant: -6),
            brambleBtn.centerYAnchor.constraint(equalTo: centerYAnchor),
            brambleBtn.widthAnchor.constraint(equalToConstant: 32),
            brambleBtn.heightAnchor.constraint(equalToConstant: 28),
        ])
    }
    
    private func configureButton(_ btn: NSButton, title: String, action: Selector) {
        btn.title = title
        btn.bezelStyle = .texturedRounded
        btn.target = self
        btn.action = action
        btn.font = NSFont.systemFont(ofSize: 13)
        btn.translatesAutoresizingMaskIntoConstraints = false
        addSubview(btn)
    }
    
    public func updateForTab(_ tab: TabItem) {
        backBtn.isEnabled = tab.webView.canGoBack
        forwardBtn.isEnabled = tab.webView.canGoForward
        reloadBtn.title = tab.isLoading ? "✕" : "⟳"
        
        if let url = tab.url {
            let isHttps = url.scheme == "https"
            lockIcon.stringValue = isHttps ? "🔒" : "⚠️"
            lockIcon.textColor = isHttps ? .secondaryLabelColor : .systemYellow
            addressField.stringValue = url.absoluteString
        } else {
            lockIcon.stringValue = "🌐"
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
    @objc private func onBack() { delegate?.omniboxDidClickBack() }
    @objc private func onForward() { delegate?.omniboxDidClickForward() }
    @objc private func onReload() { delegate?.omniboxDidClickReload() }
    @objc private func onBrambleClicked() { delegate?.omniboxDidRequestBramblePopup(sender: brambleBtn) }
    @objc private func onAdBlockClicked() { delegate?.omniboxDidToggleAdBlock() }
    @objc private func onInstallExtClicked() { delegate?.omniboxDidRequestInstallExtension() }
}
