import AppKit
import AuthenticationServices
import Combine
import Network
import WebKit

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

public enum NativePrototypeError: LocalizedError {
    case notAnAppExtensionBundle(URL)
    case invalidWebAuthnProbeResult
    case extensionWasDeclined
    case invalidAddress

    public var errorDescription: String? {
        switch self {
        case .notAnAppExtensionBundle(let url):
            return "Could not open this as an app-extension bundle: \(url.path)"
        case .invalidWebAuthnProbeResult:
            return "WebKit returned an unexpected WebAuthn feature-probe result."
        case .extensionWasDeclined:
            return "Extension installation was cancelled."
        case .invalidAddress:
            return "Enter a valid HTTP or HTTPS URL."
        }
    }
}

@MainActor
public final class NativeBrowserHarness: NSObject, ObservableObject, WKNavigationDelegate, WKWebExtensionControllerDelegate {
    @Published public var address = "https://example.com"
    @Published public var status = "Ready — macOS 15.4 or later"
    @Published public private(set) var proxyEnabled = false
    @Published public private(set) var loadedExtensions: [ExtensionInstallSummary] = []

    public let dataStore: WKWebsiteDataStore
    public let extensionController: WKWebExtensionController
    public let webView: WKWebView

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

    public func navigate(_ rawAddress: String? = nil) {
        let raw = (rawAddress ?? address).trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = raw.contains("://") ? raw : "https://\(raw)"
        guard let url = URL(string: candidate),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            status = NativePrototypeError.invalidAddress.localizedDescription
            return
        }
        address = url.absoluteString
        webView.load(URLRequest(url: url))
        status = "Loading \(url.host ?? url.absoluteString)…"
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
        status = "Loaded \(summary.name) (Manifest V\(summary.manifestVersion)); inspect runtime errors and permissions before relying on it."
        return summary
    }

    public func uninstallExtension(_ summary: ExtensionInstallSummary) throws {
        guard let index = loadedExtensions.firstIndex(where: { $0.id == summary.id }) else { return }
        if summary.context.isLoaded {
            try extensionController.unload(summary.context)
        }
        loadedExtensions.remove(at: index)
        status = "Unloaded \(summary.name)."
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
        if let url = webView.url {
            address = url.absoluteString
            status = "Loaded \(url.host ?? url.absoluteString)"
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        status = "Navigation failed: \(error.localizedDescription)"
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        status = "Navigation failed: \(error.localizedDescription)"
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let scheme = navigationAction.request.url?.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
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
