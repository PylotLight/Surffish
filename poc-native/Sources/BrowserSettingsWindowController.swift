import AppKit
import SwiftUI

@MainActor
public final class BrowserSettingsViewController: NSViewController {
    public var onClose: (() -> Void)?
    public var onInstallExtension: (() -> Void)?
    public var onSettingsSaved: ((BrowserSettings) -> Void)?

    private var settingsModel: BrowserSettingsModel?

    public override func loadView() {
        let model = BrowserSettingsModel()
        model.onClose = { [weak self] in self?.onClose?() }
        model.onInstallExtension = { [weak self] in self?.onInstallExtension?() }
        model.onSettingsSaved = { [weak self] settings in self?.onSettingsSaved?(settings) }
        settingsModel = model

        let root = NSView(frame: NSRect(x: 0, y: 0, width: 640, height: 620))
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(red: 0.075, green: 0.08, blue: 0.095, alpha: 1).cgColor

        let hostingView = NSHostingView(rootView: BrowserSettingsView(model: model))
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: root.topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
        view = root
    }
}
