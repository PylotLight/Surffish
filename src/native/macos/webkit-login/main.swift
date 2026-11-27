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
//   {"type":"bramble-list","host":"www.torbox.app"}
//   {"type":"bramble-fill","id":"<entry id>"}
// stdin -> helper: bramble-list / bramble-fill replies. Credentials stay in memory, never logged.
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
    if parts.count > 2, parts.first == "www" {
        return Array(parts.dropFirst()).joined(separator: ".")
    }
    return parts.joined(separator: ".")
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

func send(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

/// Fill a typical email/password login form. Does not press Submit: sites often add a challenge or
/// a second step, and the user can finish in the WebKit window.
let fillScript = """
const visible = (el) => !!el && el.offsetParent !== null && !el.disabled;
const pick = (sel) => [...document.querySelectorAll(sel)].find(visible);
const wait = async (sel, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const el = pick(sel); if (el) return el; await new Promise(r => setTimeout(r, 200)); }
  return null;
};
const set = (el, value) => {
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) descriptor.set.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const emailSel = 'input[type=email], input[name=email], input#email, input[autocomplete=username]';
const passSel = 'input[type=password]';
const email = pick(emailSel);
if (email && username) set(email, username);
const pass = await wait(passSel, email ? 10000 : 1500);
if (pass && password) set(pass, password);
return [email, pass].filter(Boolean).length;
"""

@MainActor
final class LoginDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var fillButton: NSButton!
    var finished = false
    var stdinBuffer = Data()

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
        installButtons()
        installMenu()
        placeWindow(size: size)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        listenToSurffish()
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

    func installButtons() {
        fillButton = NSButton(title: "Fill from Bramble", target: self, action: #selector(requestBrambleLogins))
        fillButton.bezelStyle = .rounded
        fillButton.controlSize = .small
        fillButton.toolTip = "Fill this login from Bramble (⇧⌘L)"
        fillButton.sizeToFit()
        let doneButton = NSButton(title: "Done — import session", target: self, action: #selector(done))
        doneButton.bezelStyle = .rounded
        doneButton.controlSize = .small
        doneButton.toolTip = "Return to Surffish with this site's session"
        doneButton.sizeToFit()
        let width = fillButton.frame.width + doneButton.frame.width + 18
        let container = NSView(frame: NSRect(x: 0, y: 0, width: width, height: 28))
        fillButton.frame.origin = NSPoint(x: 0, y: (28 - fillButton.frame.height) / 2)
        doneButton.frame.origin = NSPoint(x: fillButton.frame.width + 8, y: (28 - doneButton.frame.height) / 2)
        container.addSubview(fillButton)
        container.addSubview(doneButton)
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
        let fill = editMenu.addItem(withTitle: "Fill from Bramble", action: #selector(requestBrambleLogins), keyEquivalent: "l")
        fill.keyEquivalentModifierMask = [.command, .shift]
        fill.target = self
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Done — import session", action: #selector(done), keyEquivalent: "\r")
        editItem.submenu = editMenu
        NSApp.mainMenu = mainMenu
    }

    // MARK: Bramble bridge

    func listenToSurffish() {
        FileHandle.standardInput.readabilityHandler = { handle in
            let chunk = handle.availableData
            Task { @MainActor in
                guard let delegate = WebKitLoginHelper.delegate else { return }
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
        guard let host = webView.url?.host?.lowercased(),
              host == targetDomain || host == "www.\(targetDomain)" else {
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
        fillButton.sizeToFit()
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
            notice("No login in Bramble", "Bramble has no saved login for this site.")
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
