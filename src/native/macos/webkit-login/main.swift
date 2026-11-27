// Surffish native WebKit login helper.
//
// Some sites (TorBox) reject Cloudflare's Turnstile challenge from embedded Chromium but accept
// real WebKit. This tiny AppKit app shows the login in a WKWebView; when the user is done, it writes
// the session cookies for the target site to stdout and exits 0. Surffish imports them into its
// browser session and reloads the tab. Closing the window exits 2 (cancelled).
//
// Usage: webkit-login [login-url] [--domain=example.com] [--frame=x,y,w,h]
//
// Protocol with Surffish: one JSON object per line on stdout.
//   {"type":"cookies","cookies":[{"name","value","domain","path","secure","httpOnly",...}]}
import AppKit
import WebKit

let arguments = Array(CommandLine.arguments.dropFirst())

let startURL: URL = {
    if let raw = arguments.first(where: { !$0.hasPrefix("--") }),
       let url = URL(string: raw), url.scheme == "https", url.host != nil {
        return url
    }
    return URL(string: "https://www.torbox.app/login")!
}()

let targetDomain: String = {
    if let raw = arguments.first(where: { $0.hasPrefix("--domain=") }) {
        return String(raw.dropFirst("--domain=".count)).lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }
    let parts = (startURL.host ?? "").lowercased().split(separator: ".")
    return (parts.count > 2 && parts.first == "www" ? parts.dropFirst() : parts)
        .joined(separator: ".")
}()

/// Surffish's window frame, converted from top-left to AppKit's bottom-left coordinates.
let ownerFrame: NSRect? = {
    guard let raw = arguments.first(where: { $0.hasPrefix("--frame=") }) else { return nil }
    let parts = raw.dropFirst("--frame=".count).split(separator: ",").compactMap { Double($0) }
    guard parts.count == 4, parts[2] > 0, parts[3] > 0, let primary = NSScreen.screens.first else { return nil }
    return NSRect(x: parts[0], y: primary.frame.height - parts[1] - parts[3], width: parts[2], height: parts[3])
}()

func safariUserAgent() -> String {
    var version = "26.0"
    if let info = NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist"),
       let installed = info["CFBundleShortVersionString"] as? String {
        version = installed
    }
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(version) Safari/605.1.15"
}

@MainActor
final class LoginDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var finished = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        let size = NSSize(width: 560, height: 760)
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.customUserAgent = safariUserAgent()
        webView.navigationDelegate = self

        window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "Sign in with WebKit · Surffish"
        window.contentView = webView
        window.delegate = self
        installDoneButton()
        installMenu()
        placeWindow(size: size)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        webView.load(URLRequest(url: startURL))
    }

    func placeWindow(size: NSSize) {
        guard let owner = ownerFrame else { window.center(); return }
        var origin = NSPoint(x: owner.midX - size.width / 2, y: owner.midY - size.height / 2)
        if let screen = NSScreen.screens.first(where: { $0.frame.intersects(owner) }) {
            let area = screen.visibleFrame
            origin.x = min(max(origin.x, area.minX), area.maxX - size.width)
            origin.y = min(max(origin.y, area.minY), area.maxY - size.height)
        }
        window.setFrame(NSRect(origin: origin, size: size), display: false)
    }

    func installDoneButton() {
        let button = NSButton(title: "Done — import session", target: self, action: #selector(done))
        button.bezelStyle = .rounded
        button.controlSize = .small
        button.toolTip = "Return to Surffish with this site's session"
        button.sizeToFit()
        let container = NSView(frame: NSRect(x: 0, y: 0, width: button.frame.width + 12, height: 28))
        button.frame.origin = NSPoint(x: 0, y: (28 - button.frame.height) / 2)
        container.addSubview(button)
        let accessory = NSTitlebarAccessoryViewController()
        accessory.view = container
        accessory.layoutAttribute = .trailing
        window.addTitlebarAccessoryViewController(accessory)
    }

    func installMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Cancel", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Done — import session", action: #selector(done), keyEquivalent: "\r")
        editItem.submenu = editMenu
        NSApp.mainMenu = mainMenu
    }

    func windowWillClose(_ notification: Notification) {
        if !finished { exit(2) }
    }

    @objc func done() {
        guard !finished else { return }
        finished = true
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { cookies in
            let rows: [[String: Any]] = cookies.compactMap { cookie in
                let domain = cookie.domain.lowercased()
                    .trimmingCharacters(in: CharacterSet(charactersIn: "."))
                guard domain == targetDomain || domain.hasSuffix("." + targetDomain) else { return nil }
                var row: [String: Any] = [
                    "name": cookie.name,
                    "value": cookie.value,
                    "domain": cookie.domain,
                    "path": cookie.path,
                    "secure": cookie.isSecure,
                    "httpOnly": cookie.isHTTPOnly
                ]
                if let expires = cookie.expiresDate {
                    row["expirationDate"] = expires.timeIntervalSince1970
                }
                if let sameSite = cookie.sameSitePolicy {
                    row["sameSite"] = sameSite.rawValue
                }
                return row
            }
            let message: [String: Any] = ["type": "cookies", "cookies": rows]
            DispatchQueue.main.async {
                if let data = try? JSONSerialization.data(withJSONObject: message),
                   let line = String(data: data, encoding: .utf8) {
                    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
                }
                exit(0)
            }
        }
    }
}

@main
struct WebKitLoginHelper {
    // NSApplication.delegate is weak; keep the delegate alive for the run.
    @MainActor static var delegate: LoginDelegate?

    @MainActor static func main() {
        let application = NSApplication.shared
        let loginDelegate = LoginDelegate()
        delegate = loginDelegate
        application.delegate = loginDelegate
        application.run()
    }
}
