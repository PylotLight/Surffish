import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: MainWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

        // Setup application menu with Cmd+Q, Cmd+W, Cmd+T, text editing shortcuts
        setupApplicationMenu()

        let wc = MainWindowController()
        wc.showWindow(nil)
        wc.window?.makeKeyAndOrderFront(nil)
        self.windowController = wc

        NSApp.activate(ignoringOtherApps: true)

        // Restore extensions from this profile's persistent Extensions directory.
        // Loading happens before session restoration so restored webkit-extension:// tabs
        // can resolve their owning extension context.
        Task { [weak self] in
            let settings = BrowserSettingsStore.shared.settings
            await SshTunnelManager.shared.configure(
                browserEnabled: settings.sshProxyEnabled,
                serverEnabled: settings.sshProxyShareEnabled,
                target: settings.sshHost,
                port: settings.sshProxyPort,
                bindAddress: settings.sshProxyBindAddress
            )
            await WebExtensionManager.shared.loadInstalledExtensions()
            await MainActor.run {
                self?.windowController?.restoreBrowserSession()
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        SshTunnelManager.shared.shutdown()
    }
}

@main
struct Main {
    static func main() {
        setbuf(stdout, nil)
        setbuf(stderr, nil)
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
