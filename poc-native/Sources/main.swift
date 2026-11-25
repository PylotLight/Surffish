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

        // Do not instantiate WKWebExtension from the bundled Bramble files during
        // startup. The current Bramble MV3 manifest triggers a crash inside
        // WebKit's WKWebExtension initializer on affected macOS builds.
        // Keep the browser launch path independent of extension parsing until
        // the manifest has been made WebKit-compatible and tested separately.
        Task { [weak self] in
            let settings = BrowserSettingsStore.shared.settings
            await SshTunnelManager.shared.configure(
                browserEnabled: settings.sshProxyEnabled,
                serverEnabled: settings.sshProxyShareEnabled,
                target: settings.sshHost,
                port: settings.sshProxyPort,
                bindAddress: settings.sshProxyBindAddress,
                upstreamHost: settings.sshRemoteSocksHost,
                upstreamPort: settings.sshRemoteSocksPort
            )
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
