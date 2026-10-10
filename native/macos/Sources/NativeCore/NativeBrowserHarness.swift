import AppKit
import AuthenticationServices
import Combine
import Network
import WebKit

public enum NativeNavigationTarget: Equatable {
    case website(URL)
    case braveSearch(URL)

    public var url: URL {
        switch self {
        case .website(let url), .braveSearch(let url): return url
        }
    }
}

public struct ExtensionInstallSummary: Identifiable {
    public let id: UUID
    public let name: String
    public let version: String
    public let manifestVersion: Double
    public let requestedPermissions: [String]
    public let requestedHostPatterns: [String]
    let context: WKWebExtensionContext

    public var isLoaded: Bool { context.isLoaded }
}

public struct ExtensionDiagnostic: Identifiable, Equatable {
    public let id: UUID
    public let extensionName: String
    public let isLoaded: Bool
    public let messages: [String]
}

public enum NativePrototypeError: LocalizedError {
    case notAnAppExtensionBundle(URL)
    case invalidWebAuthnProbeResult
    case extensionWasDeclined
    case invalidAddress
    case extensionActionUnavailable(String)
    case popupPresentationUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .notAnAppExtensionBundle(let url):
            return "Could not open this as an app-extension bundle: \(url.path)"
        case .invalidWebAuthnProbeResult:
            return "WebKit returned an unexpected WebAuthn feature-probe result."
        case .extensionWasDeclined:
            return "Extension installation was cancelled."
        case .invalidAddress:
            return "Enter an HTTP or HTTPS address, or a search query."
        case .extensionActionUnavailable(let name):
            return "\(name) does not declare a browser action."
        case .popupPresentationUnavailable(let name):
            return "Could not present the popup for \(name): the popup view or toolbar anchor is unavailable."
        }
    }
}

@MainActor
public final class NativeBrowserHarness: NSObject, ObservableObject, WKNavigationDelegate, WKWebExtensionControllerDelegate {
    @Published public var address = ""
    @Published public var status = "Ready — macOS 15.4 or later"
    @Published public private(set) var proxyEnabled = false
    @Published public private(set) var loadedExtensions: [ExtensionInstallSummary] = []
    @Published public private(set) var extensionDiagnostics: [ExtensionDiagnostic] = []
    @Published public private(set) var extensionActionRevision = 0

    public let dataStore: WKWebsiteDataStore
    public let extensionController: WKWebExtensionController
    public let webView: WKWebView

    private weak var popupAnchorView: NSView?
    private var popupExtensionIDs: [ObjectIdentifier: UUID] = [:]
    private var hostDiagnosticsByExtensionID: [UUID: [String]] = [:]

    public override init() {
        let dataStore = WKWebsiteDataStore.default()
        let extensionController = WKWebExtensionController()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configuration.webExtensionController = extensionController
        let webView = WKWebView(frame: .zero, configuration: configuration)

        self.dataStore = dataStore
        self.extensionController = extensionController
        self.webView = webView
        super.init()

        extensionController.delegate = self
        webView.navigationDelegate = self
    }

    public static func destination(for rawAddress: String) throws -> NativeNavigationTarget {
        let raw = rawAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { throw NativePrototypeError.invalidAddress }

        if raw.contains("://") {
            guard let url = URL(string: raw),
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https"].contains(scheme),
                  url.host != nil else {
                throw NativePrototypeError.invalidAddress
            }
            return .website(url)
        }

        let hasWhitespace = raw.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
        let isHostWithPort = raw.range(of: #"^[^:/\s]+:\d+(?:/.*)?$"#, options: .regularExpression) != nil
        let looksLikeHost = !hasWhitespace && (
            raw.contains(".") || raw.lowercased() == "localhost" || raw.hasPrefix("[") || isHostWithPort
        )

        if looksLikeHost {
            guard let url = URL(string: "https://\(raw)"),
                  let scheme = url.scheme?.lowercased(),
                  ["http", "https"].contains(scheme),
                  url.host != nil else {
                throw NativePrototypeError.invalidAddress
            }
            return .website(url)
        }

        var components = URLComponents(string: "https://search.brave.com/search")
        components?.queryItems = [URLQueryItem(name: "q", value: raw)]
        guard let searchURL = components?.url else { throw NativePrototypeError.invalidAddress }
        return .braveSearch(searchURL)
    }

    public func navigate(_ rawAddress: String? = nil) {
        let raw = rawAddress ?? address
        do {
            let target = try Self.destination(for: raw)
            address = target.url.absoluteString
            webView.load(URLRequest(url: target.url))
            switch target {
            case .website:
                status = "Loading \(target.url.host ?? target.url.absoluteString)…"
            case .braveSearch:
                status = "Searching Brave for \(raw.trimmingCharacters(in: .whitespacesAndNewlines))…"
            }
        } catch {
            status = error.localizedDescription
        }
    }

    public func goBack() {
        guard webView.canGoBack else { return }
        webView.goBack()
    }

    public func goForward() {
        guard webView.canGoForward else { return }
        webView.goForward()
    }

    public func reload() {
        webView.reload()
    }

    public func configureSOCKS5Proxy(enabled: Bool, host: String = "127.0.0.1", port: UInt16 = 1080) {
        if enabled {
            guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
                status = "Invalid SOCKS5 port."
                return
            }
            let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: endpointPort)
            var configuration = ProxyConfiguration(socksv5Proxy: endpoint)
            configuration.allowFailover = false
            dataStore.proxyConfigurations = [configuration]
            proxyEnabled = true
            status = "SOCKSv5 configured for this WebKit data store only (\(host):\(port)); no direct failover."
        } else {
            dataStore.proxyConfigurations = []
            proxyEnabled = false
            status = "SOCKSv5 disabled for this WebKit data store."
        }
    }

    public func installExtension(at url: URL, askForImportApproval: Bool = true) async throws -> ExtensionInstallSummary {
        let webExtension: WKWebExtension
        if url.pathExtension.lowercased() == "appex" {
            guard let bundle = Bundle(url: url) else {
                throw NativePrototypeError.notAnAppExtensionBundle(url)
            }
            webExtension = try await WKWebExtension(appExtensionBundle: bundle)
        } else {
            webExtension = try await WKWebExtension(resourceBaseURL: url)
        }

        if askForImportApproval && !confirmImport(of: webExtension) {
            throw NativePrototypeError.extensionWasDeclined
        }

        let context = WKWebExtensionContext(for: webExtension)
        try extensionController.load(context)

        let summary = ExtensionInstallSummary(
            id: UUID(),
            name: webExtension.displayName ?? "Unnamed extension",
            version: webExtension.version ?? "unknown",
            manifestVersion: webExtension.manifestVersion,
            requestedPermissions: webExtension.requestedPermissions.map(String.init(describing:)).sorted(),
            requestedHostPatterns: webExtension.requestedPermissionMatchPatterns.map(String.init(describing:)).sorted(),
            context: context
        )
        loadedExtensions.append(summary)
        extensionActionRevision += 1
        refreshExtensionDiagnostics()
        status = "Loaded \(summary.name). This confirms WebKit accepted it—not that its features work; use its toolbar icon and Diagnostics."
        return summary
    }

    public func uninstallExtension(_ summary: ExtensionInstallSummary) throws {
        guard let index = loadedExtensions.firstIndex(where: { $0.id == summary.id }) else { return }
        if summary.context.isLoaded {
            try extensionController.unload(summary.context)
        }
        loadedExtensions.remove(at: index)
        hostDiagnosticsByExtensionID.removeValue(forKey: summary.id)
        extensionActionRevision += 1
        refreshExtensionDiagnostics()
        status = "Unloaded \(summary.name)."
    }

    public func hasExtensionAction(for id: UUID) -> Bool {
        loadedExtensions.first(where: { $0.id == id })?.context.action(for: nil) != nil
    }

    public func extensionActionIcon(for id: UUID) -> NSImage? {
        guard let summary = loadedExtensions.first(where: { $0.id == id }) else { return nil }
        let size = CGSize(width: 24, height: 24)
        return summary.context.action(for: nil)?.icon(for: size)
            ?? summary.context.webExtension.actionIcon(for: size)
            ?? summary.context.webExtension.icon(for: size)
    }

    public func performExtensionAction(for id: UUID, anchoredTo anchor: NSView) {
        guard let summary = loadedExtensions.first(where: { $0.id == id }),
              let action = summary.context.action(for: nil) else {
            status = NativePrototypeError.extensionActionUnavailable(
                loadedExtensions.first(where: { $0.id == id })?.name ?? "Extension"
            ).localizedDescription
            return
        }

        popupAnchorView = anchor
        if action.presentsPopup, let popupWebView = action.popupWebView {
            popupWebView.navigationDelegate = self
            popupExtensionIDs[ObjectIdentifier(popupWebView)] = summary.id
        }

        if action.presentsPopup, action.popupPopover?.isShown == true {
            action.closePopup()
            popupAnchorView = nil
            status = "Closed \(summary.name) popup."
            return
        }

        summary.context.performAction(for: nil)
        if !action.presentsPopup {
            status = "Dispatched \(summary.name)'s extension action. No popup is declared; inspect Diagnostics for runtime errors."
        } else {
            status = "Opening \(summary.name) popup…"
        }
        refreshExtensionDiagnostics()
    }

    public func refreshExtensionDiagnostics() {
        let refreshedDiagnostics = loadedExtensions.map { summary in
            let webKitErrors = summary.context.errors.map { error -> String in
                let nsError = error as NSError
                let backgroundFailure = nsError.domain == "WKWebExtensionContextErrorDomain" && nsError.code == 6
                    ? " The extension's background script or service worker did not start; this is separate from the browser page load. A script error or an unsupported WebExtension API may be the cause, and popup features that depend on it may remain blank."
                    : ""
                return "WebKit \(nsError.domain) (\(nsError.code)): \(nsError.localizedDescription)\(backgroundFailure)"
            }
            let hostErrors = hostDiagnosticsByExtensionID[summary.id] ?? []
            return ExtensionDiagnostic(
                id: summary.id,
                extensionName: summary.name,
                isLoaded: summary.isLoaded,
                messages: webKitErrors + hostErrors
            )
        }
        if extensionDiagnostics != refreshedDiagnostics {
            extensionDiagnostics = refreshedDiagnostics
        }
    }

    public var extensionDiagnosticCount: Int {
        extensionDiagnostics.reduce(0) { $0 + $1.messages.count }
    }

    public func readWebAuthnFeatureProbe() async throws -> [String: Any] {
        let script = """
        ({
          secureContext: window.isSecureContext,
          publicKeyCredential: typeof PublicKeyCredential,
          userVerifyingPlatformAuthenticator: typeof PublicKeyCredential !== 'undefined' && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function',
          conditionalMediation: typeof PublicKeyCredential !== 'undefined' && typeof PublicKeyCredential.isConditionalMediationAvailable === 'function'
        })
        """
        guard let result = try await webView.evaluateJavaScript(script) as? [String: Any] else {
            throw NativePrototypeError.invalidWebAuthnProbeResult
        }
        return result
    }

    public func browserPasskeyAuthorizationStateDescription() -> String {
        let manager = ASAuthorizationWebBrowserPublicKeyCredentialManager()
        return String(describing: manager.authorizationStateForPlatformCredentials)
    }

    public func inspectPasskeyAPIs() async {
        let state = browserPasskeyAuthorizationStateDescription()
        do {
            let probe = try await readWebAuthnFeatureProbe()
            status = "Passkey API probe: browser credential access=\(state); WKWebView WebAuthn=\(probe). Actual use is entitlement-gated."
        } catch {
            status = "Passkey API state=\(state); WebAuthn probe failed: \(error.localizedDescription)"
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === self.webView {
            if let url = webView.url {
                address = url.absoluteString
                status = "Loaded \(url.host ?? url.absoluteString)"
            }
        } else if let extensionID = popupExtensionIDs[ObjectIdentifier(webView)],
                  let summary = loadedExtensions.first(where: { $0.id == extensionID }) {
            status = "Loaded \(summary.name) popup. Review Diagnostics if it does not behave correctly."
        }
        refreshExtensionDiagnostics()
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        recordNavigationFailure(in: webView, error: error)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        recordNavigationFailure(in: webView, error: error)
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard webView === self.webView else {
            // WebKit-managed extension pages use an internal extension URL scheme.
            decisionHandler(.allow)
            return
        }
        guard let scheme = navigationAction.request.url?.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        presentActionPopup action: WKWebExtension.Action,
        for context: WKWebExtensionContext,
        completionHandler: @escaping ((any Error)?) -> Void
    ) {
        if let popupWebView = action.popupWebView,
           let summary = loadedExtensions.first(where: { $0.context === context }) {
            popupWebView.navigationDelegate = self
            popupExtensionIDs[ObjectIdentifier(popupWebView)] = summary.id
        }

        let anchor: NSView?
        if let popupAnchorView {
            anchor = popupAnchorView
        } else if webView.window != nil {
            anchor = webView
        } else {
            anchor = nil
        }

        guard let popover = action.popupPopover, let anchor else {
            let name = context.webExtension.displayName ?? "extension"
            let error = NativePrototypeError.popupPresentationUnavailable(name)
            status = error.localizedDescription
            if let summary = loadedExtensions.first(where: { $0.context === context }) {
                recordHostDiagnostic(error.localizedDescription, for: summary)
            }
            completionHandler(error)
            return
        }

        popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .maxY)
        status = "Opened \(context.webExtension.displayName ?? "extension") popup. WebKit runtime errors appear in Diagnostics."
        refreshExtensionDiagnostics()
        popupAnchorView = nil
        completionHandler(nil)
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        didUpdate action: WKWebExtension.Action,
        forExtensionContext context: WKWebExtensionContext
    ) {
        extensionActionRevision += 1
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissions permissions: Set<WKWebExtension.Permission>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Set<WKWebExtension.Permission>, Date?) -> Void
    ) {
        let description = permissions.map(String.init(describing:)).sorted().joined(separator: "\n")
        let allow = permissionAlert(
            title: "Extension permission request",
            details: "This extension requests these capabilities:\n\n\(description)"
        )
        completionHandler(allow ? permissions : [], nil)
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Set<WKWebExtension.MatchPattern>, Date?) -> Void
    ) {
        let description = matchPatterns.map(String.init(describing:)).sorted().joined(separator: "\n")
        let allow = permissionAlert(
            title: "Extension website access request",
            details: "This extension requests access to these site patterns:\n\n\(description)"
        )
        completionHandler(allow ? matchPatterns : [], nil)
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissionToAccess urls: Set<URL>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Set<URL>, Date?) -> Void
    ) {
        let description = urls.map(\.absoluteString).sorted().joined(separator: "\n")
        let allow = permissionAlert(
            title: "Extension page access request",
            details: "This extension requests access to these URLs:\n\n\(description)"
        )
        completionHandler(allow ? urls : [], nil)
    }

    private func recordNavigationFailure(in webView: WKWebView, error: Error) {
        let message = "Popup navigation failed: \(error.localizedDescription)"
        if webView === self.webView {
            status = "Navigation failed: \(error.localizedDescription)"
            return
        }

        if let id = popupExtensionIDs[ObjectIdentifier(webView)],
           let summary = loadedExtensions.first(where: { $0.id == id }) {
            recordHostDiagnostic(message, for: summary)
            status = "\(summary.name) popup failed: \(error.localizedDescription)"
        } else {
            status = message
        }
    }

    private func recordHostDiagnostic(_ message: String, for summary: ExtensionInstallSummary) {
        var messages = hostDiagnosticsByExtensionID[summary.id] ?? []
        if messages.last != message { messages.append(message) }
        hostDiagnosticsByExtensionID[summary.id] = Array(messages.suffix(50))
        refreshExtensionDiagnostics()
    }

    private func confirmImport(of webExtension: WKWebExtension) -> Bool {
        let permissions = webExtension.requestedPermissions.map(String.init(describing:)).sorted()
        let hosts = webExtension.requestedPermissionMatchPatterns.map(String.init(describing:)).sorted()
        let permissionText = permissions.isEmpty ? "None declared" : permissions.joined(separator: "\n")
        let hostText = hosts.isEmpty ? "No site patterns declared" : hosts.joined(separator: "\n")
        return permissionAlert(
            title: "Install \(webExtension.displayName ?? "this extension")?",
            details: "Importing runs third-party extension code in this separate prototype.\n\nRequested capabilities:\n\(permissionText)\n\nRequested site access:\n\(hostText)\n\nCompatibility is not guaranteed."
        )
    }

    private func permissionAlert(title: String, details: String) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = details
        alert.addButton(withTitle: "Allow")
        alert.addButton(withTitle: "Deny")
        return alert.runModal() == .alertFirstButtonReturn
    }
}
