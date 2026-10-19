// Surffish Google sign-in helper.
//
// Google refuses sign-in from embedded Chromium (Electron), but accepts real
// WebKit with a Safari identity. This tiny AppKit app shows Google's sign-in in
// a WKWebView. Once the user lands on the continue page it sends the
// Google/YouTube cookies to Surffish and exits 0. Closing the window exits 2.
//
// Usage: google-sign-in [continue-url] [--frame=x,y,w,h]
//   continue-url  default https://myaccount.google.com/. The flow finishes once
//                 WebKit lands on its host, so services such as YouTube finish
//                 their own SetSID hop inside WebKit first.
//   --frame       Surffish's window frame in top-left screen points; the helper
//                 opens centred over it.
//
// Protocol with Surffish: one JSON object per line.
//   helper -> stdout  {"type":"bramble-list","host":"accounts.google.com"}
//                     {"type":"bramble-fill","id":"<entry id>"}
//                     {"type":"cookies","cookies":[...]}
//   stdin  -> helper  {"type":"bramble-list","status":"ok|locked|unavailable","logins":[{"id","label"}]}
//                     {"type":"bramble-fill","status":"ok|unavailable","username","password","totp"}
// Credentials only live in memory for the fill and are never logged.
import AppKit
import WebKit

let arguments = Array(CommandLine.arguments.dropFirst())

let continueURL: URL = {
    if let raw = arguments.first(where: { !$0.hasPrefix("--") }), let url = URL(string: raw),
       url.scheme == "https", url.host != nil {
        return url
    }
    return URL(string: "https://myaccount.google.com/")!
}()
let doneHost = continueURL.host!.lowercased()
/// YouTube needs its own SetSID hop inside WebKit, so it only finishes on its host.
let doneNeedsExactHost = doneHost == "youtube.com" || doneHost.hasSuffix(".youtube.com")

/// Signed in and off Google's sign-in pages: the continue host, or (unless the continue page is
/// YouTube) any other Google service Google sent us to instead, e.g. Gmail when the continue page
/// was www.google.com, or a myaccount/gds interstitial after 2-step.
func isDoneHost(_ host: String) -> Bool {
    if host == doneHost { return true }
    if doneNeedsExactHost { return false }
    if host == "accounts.google.com" || host.hasPrefix("accounts.") { return false }
    return host == "google.com" || host.hasSuffix(".google.com")
}
let startURL = URL(string: "https://accounts.google.com/ServiceLogin?continue=" +
    (continueURL.absoluteString.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""))!

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

func isSessionCookieDomain(_ domain: String) -> Bool {
    let d = domain.lowercased()
    return d == "google.com" || d.hasSuffix(".google.com") || d == "youtube.com" || d.hasSuffix(".youtube.com")
}

func send(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

// Fills Google's two-step form: email -> Next, then password -> Next, then a
// TOTP code if Google asks for one and the entry has it. Google swaps steps
// in-page, so this polls for each field instead of waiting on navigations.
let fillScript = """
const visible = (el) => !!el && el.offsetParent !== null && !el.disabled;
const pick = (sel) => [...document.querySelectorAll(sel)].find(visible);
const wait = async (sel, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const el = pick(sel); if (el) return el; await new Promise(r => setTimeout(r, 200)); }
  return null;
};
const type = (el, value) => {
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const next = (id) => { const b = document.querySelector('#' + id + ' button') || document.getElementById(id); if (b) b.click(); };
const emailSel = 'input[type=email], input#identifierId';
const passSel = 'input[type=password][name=Passwd], input[type=password]';
const totpSel = 'input[name=totpPin], input#totpPin';
let did = [];
const email = pick(emailSel);
if (email && username) { type(email, username); next('identifierNext'); did.push('email'); }
const pass = await wait(passSel, email ? 15000 : 1500);
if (pass && password) { type(pass, password); next('passwordNext'); did.push('password'); }
if (totp) {
  const code = await wait(totpSel, pass ? 15000 : 1500);
  if (code) { type(code, totp); next('totpNext'); did.push('totp'); }
}
return did.join(',');
"""

@MainActor
final class SignInDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var fillButton: NSButton!
    var finished = false
    var checking = false
    var stdinBuffer = Data()
    var urlObservation: NSKeyValueObservation?
    var pollTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        let size = NSSize(width: 520, height: 720)
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.customUserAgent = safariUserAgent()
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "Sign in to Google · Surffish"
        window.contentView = webView
        window.delegate = self
        installFillButton()
        placeWindow(size: size)
        installMenu()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        listenToSurffish()
        // didFinish alone misses landings that never finish loading (Gmail streams its page) and
        // in-page URL changes, so also check on every URL change and once a second.
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.checkSignedIn() }
        }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkSignedIn() }
        }
        webView.load(URLRequest(url: startURL))
    }

    /// Centre over Surffish's window so the sign-in reads as part of it.
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

    func installFillButton() {
        fillButton = NSButton(title: "Fill from Bramble", target: self, action: #selector(requestBrambleLogins))
        fillButton.bezelStyle = .rounded
        fillButton.controlSize = .small
        fillButton.toolTip = "Fill your Google login from Bramble (⇧⌘L)"
        fillButton.sizeToFit()
        let container = NSView(frame: NSRect(x: 0, y: 0, width: fillButton.frame.width + 12, height: 28))
        fillButton.frame.origin = NSPoint(x: 0, y: (28 - fillButton.frame.height) / 2)
        container.addSubview(fillButton)
        let accessory = NSTitlebarAccessoryViewController()
        accessory.view = container
        accessory.layoutAttribute = .trailing
        window.addTitlebarAccessoryViewController(accessory)
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
        editMenu.addItem(NSMenuItem.separator())
        let fill = editMenu.addItem(withTitle: "Fill from Bramble", action: #selector(requestBrambleLogins), keyEquivalent: "l")
        fill.keyEquivalentModifierMask = [.command, .shift]
        fill.target = self
        editItem.submenu = editMenu
        NSApp.mainMenu = mainMenu
    }

    // MARK: Bramble bridge

    func listenToSurffish() {
        FileHandle.standardInput.readabilityHandler = { handle in
            let chunk = handle.availableData
            Task { @MainActor in
                guard let delegate = GoogleSignInHelper.delegate else { return }
                if chunk.isEmpty {
                    FileHandle.standardInput.readabilityHandler = nil
                    return
                }
                delegate.receive(chunk)
            }
        }
    }

    func receive(_ chunk: Data) {
        stdinBuffer.append(chunk)
        while let newline = stdinBuffer.firstIndex(of: 0x0A) {
            let line = stdinBuffer.subdata(in: stdinBuffer.startIndex..<newline)
            stdinBuffer.removeSubrange(stdinBuffer.startIndex...newline)
            guard let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                  let type = message["type"] as? String else { continue }
            if type == "bramble-list" { handleLoginList(message) }
            else if type == "bramble-fill" { handleFill(message) }
        }
    }

    @objc func requestBrambleLogins() {
        guard let host = webView.url?.host?.lowercased(), host == "accounts.google.com" else {
            NSSound.beep()
            return
        }
        fillButton.isEnabled = false
        fillButton.title = "Asking Bramble…"
        send(["type": "bramble-list", "host": host])
    }

    func resetFillButton() {
        fillButton.isEnabled = true
        fillButton.title = "Fill from Bramble"
    }

    func handleLoginList(_ message: [String: Any]) {
        let status = message["status"] as? String ?? "unavailable"
        let logins = (message["logins"] as? [[String: Any]] ?? []).compactMap { item -> (String, String)? in
            guard let id = item["id"] as? String, let label = item["label"] as? String else { return nil }
            return (id, label)
        }
        resetFillButton()
        switch status {
        case "locked":
            notice("Bramble is locked", "Unlock Bramble in the Surffish window, then press Fill from Bramble again.")
        case "ok" where logins.isEmpty:
            notice("No Google login in Bramble", "Bramble has no saved login for accounts.google.com.")
        case "ok" where logins.count == 1:
            send(["type": "bramble-fill", "id": logins[0].0])
        case "ok":
            let menu = NSMenu()
            for (id, label) in logins {
                let item = menu.addItem(withTitle: label, action: #selector(pickLogin(_:)), keyEquivalent: "")
                item.representedObject = id
                item.target = self
            }
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: fillButton.bounds.height + 4), in: fillButton)
        default:
            notice("Bramble isn’t available", "Install and unlock Bramble in Surffish to fill from it.")
        }
    }

    @objc func pickLogin(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        send(["type": "bramble-fill", "id": id])
    }

    func handleFill(_ message: [String: Any]) {
        guard message["status"] as? String == "ok" else {
            notice("Couldn’t fill from Bramble", "Bramble didn’t return that login. It may have locked; unlock it and try again.")
            return
        }
        let values: [String: Any] = [
            "username": message["username"] as? String ?? "",
            "password": message["password"] as? String ?? "",
            "totp": message["totp"] as? String ?? ""
        ]
        window.makeFirstResponder(webView)
        webView.callAsyncJavaScript(fillScript, arguments: values, in: nil, in: .page) { _ in }
    }

    func notice(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.beginSheetModal(for: window)
    }

    // MARK: Navigation

    func applicationWillTerminate(_ notification: Notification) {
        if !finished { exit(2) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        checkSignedIn()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        checkSignedIn()
    }

    // Help links and pop-ups open in the same view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    func checkSignedIn() {
        guard !finished, !checking, let host = webView.url?.host?.lowercased(), isDoneHost(host) else { return }
        checking = true
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            self.checking = false
            guard !self.finished else { return }
            let session = cookies.filter { isSessionCookieDomain($0.domain) }
            guard session.contains(where: { $0.name == "SID" || $0.name == "__Secure-1PSID" }) else { return }
            self.finished = true
            self.pollTimer?.invalidate()
            FileHandle.standardError.write("[google sign-in] signed in, landed on \(host)\n".data(using: .utf8)!)
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
        send(["type": "cookies", "cookies": list])
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
