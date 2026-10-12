// Surffish Google sign-in helper.
//
// Google refuses sign-in from embedded Chromium (Electron), but accepts real
// WebKit with a Safari identity. This tiny AppKit app shows Google's sign-in in
// a WKWebView, and once the user lands on the continue page it prints the
// Google/YouTube cookies as JSON on stdout and exits 0. Surffish imports them
// into its Electron session. Closing the window exits 2 without output.
//
// Usage: google-sign-in [continue-host]   (default: myaccount.google.com)
import AppKit
import WebKit

let doneHost = CommandLine.arguments.count > 1 ? CommandLine.arguments[1].lowercased() : "myaccount.google.com"
let startURL = URL(string: "https://accounts.google.com/ServiceLogin?continue=" +
    ("https://\(doneHost)/".addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""))!

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
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: startURL))
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
