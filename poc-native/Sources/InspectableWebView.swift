import AppKit
import WebKit

/// Browser context menu exposed by right-click and Option-click. Inspection is
/// performed by Safari Web Inspector, which is the supported public WebKit UI.
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

        let inspect = NSMenuItem(title: "Inspect Page in Web Inspector…", action: #selector(inspectPage), keyEquivalent: "")
        inspect.target = self
        menu.addItem(inspect)

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

    @objc private func inspectPage() {
        isInspectable = true
        let alert = NSAlert()
        alert.messageText = "Inspect this page"
        alert.informativeText = """
        Surffish has enabled Web Inspector for this page.

        Safari owns the Web Inspector interface. Open Safari, enable Develop > Show Web Inspector if needed, then choose Develop > This Mac > Surffish Dev > \(title ?? url?.host ?? "Current Page").

        For extension background pages and service workers, use Safari > Develop > Inspect Apps and Devices, then select Surffish.
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Open Safari")
        alert.addButton(withTitle: "OK")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.launchApplication("Safari")
        }
    }
}
