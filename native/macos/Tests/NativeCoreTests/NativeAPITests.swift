import AuthenticationServices
import Network
import WebKit
import XCTest
@testable import NativeCore

@MainActor
final class NativeAPITests: XCTestCase {
    func testWebsiteDataStoreAcceptsSOCKSv5ProxyAndDoesNotFailOver() throws {
        let store = WKWebsiteDataStore.nonPersistent()
        let port = try XCTUnwrap(NWEndpoint.Port(rawValue: 1080))
        let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host("127.0.0.1"), port: port)
        var proxy = ProxyConfiguration(socksv5Proxy: endpoint)
        proxy.allowFailover = false

        store.proxyConfigurations = [proxy]
        XCTAssertEqual(store.proxyConfigurations.count, 1)
        XCTAssertFalse(store.proxyConfigurations[0].allowFailover)

        store.proxyConfigurations = []
        XCTAssertTrue(store.proxyConfigurations.isEmpty)
    }

    func testAddressBarResolvesHostsAndSearchQueries() throws {
        let website = try NativeBrowserHarness.destination(for: "example.com/path?q=1")
        XCTAssertEqual(website, .website(URL(string: "https://example.com/path?q=1")!))

        let localhost = try NativeBrowserHarness.destination(for: "localhost:8080")
        XCTAssertEqual(localhost, .website(URL(string: "https://localhost:8080")!))

        let search = try NativeBrowserHarness.destination(for: "Bramble browser extension")
        guard case .braveSearch(let searchURL) = search else {
            return XCTFail("A multiword input should be sent to Brave Search.")
        }
        let components = try XCTUnwrap(URLComponents(url: searchURL, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.host, "search.brave.com")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "q" })?.value, "Bramble browser extension")
    }

    func testExtensionDirectoryLoadsAndUnloadsThroughController() async throws {
        let browser = NativeBrowserHarness()
        // Keep the directory outside Bundle.module: WebKit traps on this test-bundle path on macOS 26.6.2,
        // while the same fixture loads through the POC UI and the ZIP initializer.
        let directory = try temporaryProbeExtensionDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let extensionSummary = try await browser.installExtension(at: directory, askForImportApproval: false)

        XCTAssertEqual(extensionSummary.name, "Sockfish Native API Probe")
        XCTAssertEqual(extensionSummary.version, "1.0.0")
        XCTAssertEqual(extensionSummary.manifestVersion, 3)
        XCTAssertTrue(extensionSummary.isLoaded)
        XCTAssertFalse(extensionSummary.requestedPermissions.isEmpty)
        XCTAssertFalse(extensionSummary.requestedHostPatterns.isEmpty)
        XCTAssertEqual(browser.extensionController.extensions.count, 1)
        XCTAssertTrue(try XCTUnwrap(extensionSummary.context.action(for: nil)).presentsPopup)

        #if DEBUG
        XCTAssertTrue(extensionSummary.context.isInspectable)
        #else
        XCTAssertFalse(extensionSummary.context.isInspectable)
        #endif

        let didLoadBackground = await browser.loadBackgroundContent(for: extensionSummary)
        XCTAssertTrue(didLoadBackground, browser.status)

        try browser.reloadExtension(extensionSummary)
        XCTAssertTrue(extensionSummary.isLoaded)
        XCTAssertEqual(browser.extensionController.extensions.count, 1)

        browser.refreshExtensionDiagnostics()
        XCTAssertEqual(browser.extensionDiagnostics.first?.extensionName, extensionSummary.name)

        try browser.uninstallExtension(extensionSummary)
        XCTAssertFalse(extensionSummary.isLoaded)
        XCTAssertTrue(browser.extensionController.extensions.isEmpty)
    }

    func testExtensionZipLoadsThroughResourceBaseURLInitializer() async throws {
        let sourceDirectory = try probeExtensionDirectory()
        let archive = FileManager.default.temporaryDirectory
            .appendingPathComponent("sockfish-probe-\(UUID().uuidString).zip")
        defer { try? FileManager.default.removeItem(at: archive) }

        let zip = Process()
        zip.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
        zip.currentDirectoryURL = sourceDirectory
        zip.arguments = ["-q", "-r", archive.path, "manifest.json", "background.js", "content.js", "popup.html", "popup.js"]
        try zip.run()
        zip.waitUntilExit()
        XCTAssertEqual(zip.terminationStatus, 0, "The system zip utility should create the test archive.")

        let webExtension = try await WKWebExtension(resourceBaseURL: archive)
        XCTAssertEqual(webExtension.displayName, "Sockfish Native API Probe")
        XCTAssertTrue(webExtension.supportsManifestVersion(3))
        XCTAssertTrue(webExtension.hasInjectedContent)
    }

    func testWKWebViewExposesWebAuthnFeatureProbeShape() async throws {
        let browser = NativeBrowserHarness()
        let result = try await browser.readWebAuthnFeatureProbe()

        XCTAssertNotNil(result["secureContext"])
        XCTAssertNotNil(result["publicKeyCredential"])
        XCTAssertNotNil(result["userVerifyingPlatformAuthenticator"])
        XCTAssertNotNil(result["conditionalMediation"])
    }

    func testPasskeyManagerStateCanBeReadWithoutRequestingAccess() {
        let browser = NativeBrowserHarness()
        XCTAssertFalse(browser.browserPasskeyAuthorizationStateDescription().isEmpty)
        // Deliberately do not request passkey access: Apple restricts the browser entitlement.
    }

    func testNonWebNavigationIsRejected() {
        let browser = NativeBrowserHarness()
        browser.navigate("file:///etc/passwd")
        XCTAssertTrue(browser.status.contains("HTTP or HTTPS"))
        XCTAssertNil(browser.webView.url)
    }

    func testWebInspectorIsEnabledOnlyForDebugBuilds() {
        let browser = NativeBrowserHarness()
        #if DEBUG
        XCTAssertTrue(browser.webView.isInspectable)
        #else
        XCTAssertFalse(browser.webView.isInspectable)
        #endif
    }

    private func probeExtensionDirectory() throws -> URL {
        let root = try XCTUnwrap(Bundle.module.resourceURL)
        let directory = root.appendingPathComponent("Fixtures/ProbeExtension", isDirectory: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("manifest.json").path))
        return directory
    }

    private func temporaryProbeExtensionDirectory() throws -> URL {
        let source = try probeExtensionDirectory()
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("sockfish-probe-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }
}
