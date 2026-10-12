// Surffish Google sign-in helper.
//
// Google refuses sign-in from embedded Chromium (Electron), but accepts real
// WebKit with a Safari identity. This tiny AppKit app shows Google's sign-in in
// a WKWebView, and once the user lands on the continue page it prints the
// Google/YouTube cookies as JSON on stdout and exits 0. Surffish imports them
// into its Electron session. Closing the window exits 2 without output.
//
// Usage: google-sign-in [continue-url]   (default: https://myaccount.google.com/)
// The flow finishes once WebKit lands on the continue URL's host, so services
// such as YouTube complete their own SetSID hop inside WebKit first.
import AppKit
import WebKit

let continueURL: URL = {
    if CommandLine.arguments.count > 1, let url = URL(string: CommandLine.arguments[1]),
       url.scheme == "https", url.host != nil {
        return url
    }
    return URL(string: "https://myaccount.google.com/")!
}()
let doneHost = continueURL.host!.lowercased()
let startURL = URL(string: "https://accounts.google.com/ServiceLogin?continue=" +
    (continueURL.absoluteString.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""))!

func safariUserAgent() -> String {
    var version = "26.0"
    if let info = NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist"),
       let installed = info["CFBundleShortVersionString"] as? String {
        version = installed
    }
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(version) Safari/605.1.15"
}

func isSessionCookieDomain(_ domain: String) -> Bool {
    let d = domain.lowercased()
    return d == "google.com" || d.hasSuffix(".google.com") || d == "youtube.com" || d.hasSuffix(".youtube.com")
}

@MainActor
final class SignInDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var finished = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        let frame = NSRect(x: 0, y: 0, width: 520, height: 720)
        webView = WKWebView(frame: frame, configuration: configuration)
        webView.customUserAgent = safariUserAgent()
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "Sign in to Google · Surffish"
        window.contentView = webView
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        installMenu()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: startURL))
    }

    // Without a main menu carrying Edit items, Cmd+C/V/X/A never reach WebKit.
    func installMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Google Sign-In", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
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
        editItem.submenu = editMenu
        NSApp.mainMenu = mainMenu
    }

    func applicationWillTerminate(_ notification: Notification) {
        if !finished { exit(2) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        checkSignedIn()
    }

    // Help links and passkey pop-ups open in the same view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    func checkSignedIn() {
        guard !finished, let host = webView.url?.host?.lowercased(), host == doneHost else { return }
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            let session = cookies.filter { isSessionCookieDomain($0.domain) }
            guard session.contains(where: { $0.name == "SID" || $0.name == "__Secure-1PSID" }) else { return }
            self.finished = true
            self.emit(session)
        }
    }

    func emit(_ cookies: [HTTPCookie]) {
        let list: [[String: Any]] = cookies.map { cookie in
            var item: [String: Any] = [
                "name": cookie.name,
                "value": cookie.value,
                "domain": cookie.domain,
                "path": cookie.path,
                "secure": cookie.isSecure,
                "httpOnly": cookie.isHTTPOnly
            ]
            if let expires = cookie.expiresDate { item["expirationDate"] = expires.timeIntervalSince1970 }
            if let sameSite = cookie.sameSitePolicy { item["sameSite"] = sameSite.rawValue }
            return item
        }
        if let data = try? JSONSerialization.data(withJSONObject: list) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write("\n".data(using: .utf8)!)
        }
        exit(0)
    }

    func windowWillClose(_ notification: Notification) {
        if !finished { exit(2) }
    }
}

@main
struct GoogleSignInHelper {
    // NSApplication.delegate is weak; keep the delegate alive for the run.
    @MainActor static var delegate: SignInDelegate?

    @MainActor static func main() {
        let application = NSApplication.shared
        let signInDelegate = SignInDelegate()
        delegate = signInDelegate
        application.delegate = signInDelegate
        application.run()
    }
}
