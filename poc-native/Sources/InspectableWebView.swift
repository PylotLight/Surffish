import AppKit
import WebKit

/// Browser context menu. Surffish's native Developer Tools console is the default
/// inspection surface; Safari Web Inspector remains available for advanced debugging.
public final class InspectableWebView: WKWebView {
    private var contextMenuPoint: NSPoint = .zero

    public override func rightMouseDown(with event: NSEvent) {
        showBrowserContextMenu(for: event)
    }

    public override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.option) {
            showBrowserContextMenu(for: event)
            return
        }
        super.mouseDown(with: event)
    }

    private func showBrowserContextMenu(for event: NSEvent) {
        contextMenuPoint = convert(event.locationInWindow, from: nil)
        let menu = NSMenu()

        let back = NSMenuItem(title: "Back", action: #selector(goBackFromMenu), keyEquivalent: "")
        back.target = self
        back.isEnabled = canGoBack
        menu.addItem(back)

        let forward = NSMenuItem(title: "Forward", action: #selector(goForwardFromMenu), keyEquivalent: "")
        forward.target = self
        forward.isEnabled = canGoForward
        menu.addItem(forward)

        menu.addItem(.separator())

        let reload = NSMenuItem(title: isLoading ? "Stop Loading" : "Reload Page", action: #selector(reloadFromMenu), keyEquivalent: "")
        reload.target = self
        menu.addItem(reload)

        let copy = NSMenuItem(title: "Copy Page URL", action: #selector(copyPageURL), keyEquivalent: "")
        copy.target = self
        copy.isEnabled = url != nil
        menu.addItem(copy)

        menu.addItem(.separator())

        let inspect = NSMenuItem(title: "Developer Tools", action: #selector(openDeveloperTools), keyEquivalent: "")
        inspect.target = self
        menu.addItem(inspect)

        let safariInspect = NSMenuItem(title: "Inspect with Safari Web Inspector…", action: #selector(openSafariInspector), keyEquivalent: "")
        safariInspect.target = self
        menu.addItem(safariInspect)

        menu.popUp(positioning: nil, at: contextMenuPoint, in: self)
    }

    @objc private func goBackFromMenu() { goBack() }
    @objc private func goForwardFromMenu() { goForward() }
    @objc private func reloadFromMenu() {
        if isLoading { stopLoading() } else { reload() }
    }

    @objc private func copyPageURL() {
        guard let url else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
    }

    @objc private func openDeveloperTools() {
        DeveloperConsole.shared.show()
    }

    @objc private func openSafariInspector() {
        isInspectable = true
        guard let safariURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") else {
            DeveloperConsole.shared.record(level: "ERROR", source: "Web Inspector", message: "Safari could not be located.")
            return
        }

        NSWorkspace.shared.openApplication(
            at: safariURL,
            configuration: NSWorkspace.OpenConfiguration()
        ) { _, error in
            if let error {
                Task { @MainActor in
                    DeveloperConsole.shared.record(level: "ERROR", source: "Web Inspector", message: error.localizedDescription)
                }
            }
        }
    }
}
