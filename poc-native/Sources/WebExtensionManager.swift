import Foundation
import WebKit

public struct LoadedExtensionInfo: Identifiable {
    public let id: String
    public let name: String
    public let version: String
    public let manifestVersion: Double
    public let path: String
    public let hasPopup: Bool
    public let context: WKWebExtensionContext
}

public final class WebExtensionManager: NSObject, WKWebExtensionControllerDelegate {
    public static let shared = WebExtensionManager()

    public let controller = WKWebExtensionController()
    public private(set) var loadedExtensions: [LoadedExtensionInfo] = []
    public var onExtensionsChanged: (([LoadedExtensionInfo]) -> Void)?
    public private(set) var brambleContext: WKWebExtensionContext?

    private let brambleChromeStoreID = "kmokhdhoggbdcgoepifeckhgbfakaknm"
    private let brambleFirefoxSlug = "bramble"

    private override init() {
        super.init()
        controller.delegate = self
    }

    public var brambleIcon: NSImage? {
        guard let context = brambleContext else { return nil }
        return context.action(for: nil)?.icon(for: NSSize(width: 24, height: 24))
            ?? context.webExtension.actionIcon(for: NSSize(width: 24, height: 24))
            ?? context.webExtension.icon(for: NSSize(width: 24, height: 24))
    }

    public var bramblePopupWebView: WKWebView? {
        guard let ctx = brambleContext, let action = ctx.action(for: nil) else { return nil }
        guard let webView = action.popupWebView else { return nil }
        BrambleNativeBridge.shared.applyTo(userContentController: webView.configuration.userContentController)
        return webView
    }

    public func context(for url: URL) -> WKWebExtensionContext? {
        for ext in loadedExtensions where url.absoluteString.hasPrefix(ext.context.baseURL.absoluteString) {
            return ext.context
        }
        return brambleContext
    }

    public func openBrambleOptionsTab() {
        guard let ctx = brambleContext, let url = ctx.optionsPageURL else {
            print("[WebExtension] Bramble options page is not available")
            return
        }
        _ = TabManager.shared.createTab(url: url, makeActive: true)
    }

    @discardableResult
    public func installBrambleFromChromeStore() async throws -> LoadedExtensionInfo {
        try await installFromChromeWebStore(idOrUrl: brambleChromeStoreID, installName: "bramble")
    }

    @discardableResult
    public func installBrambleFromFirefoxAddons() async throws -> LoadedExtensionInfo {
        let url = URL(string: "https://addons.mozilla.org/firefox/downloads/latest/\(brambleFirefoxSlug)/latest.xpi")!
        return try await downloadAndInstall(url: url, installName: "bramble", archiveType: .zip)
    }

    @discardableResult
    public func loadExtension(from directoryURL: URL) async throws -> LoadedExtensionInfo {
        let ext = try await WKWebExtension(resourceBaseURL: directoryURL)
        let context = WKWebExtensionContext(for: ext)
        // Expose extension pages, popups and background content to Safari Web Inspector.
        context.isInspectable = true
        let name = ext.displayName ?? directoryURL.lastPathComponent
        let isBramble = name.localizedCaseInsensitiveContains("bramble") ||
            directoryURL.lastPathComponent.localizedCaseInsensitiveContains("bramble")
        DeveloperConsole.shared.observeExtension(context, name: name)

        if let configuration = context.webViewConfiguration {
            BrambleNativeBridge.shared.applyTo(userContentController: configuration.userContentController)
            DeveloperConsole.shared.install(on: configuration.userContentController)
        }

        if isBramble {
            // Keep WebKit's extension origin stable between app launches and updates.
            context.uniqueIdentifier = "bramble-extension-vault-stable"
        } else {
            let safeName = name.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }
            context.uniqueIdentifier = safeName.isEmpty ? UUID().uuidString : safeName
        }

        // WebKit requires the host to make a permission decision before loading.
        // This POC grants the extension's declared permissions so the vault's
        // storage, autofill and background features can be exercised end-to-end.
        for permission in ext.requestedPermissions {
            context.setPermissionStatus(.grantedExplicitly, for: permission)
        }
        for pattern in ext.requestedPermissionMatchPatterns {
            context.setPermissionStatus(.grantedExplicitly, for: pattern)
        }

        do {
            try controller.load(context)
        } catch {
            DeveloperConsole.shared.record(level: "ERROR", source: "Extension · \(name)", message: "WebKit refused to load extension: \(error.localizedDescription)")
            throw error
        }

        do {
            try await context.loadBackgroundContent()
        } catch {
            DeveloperConsole.shared.record(level: "ERROR", source: "Extension background · \(name)", message: error.localizedDescription)
        }
        DeveloperConsole.shared.captureExtensionErrors(context, name: name)

        let info = LoadedExtensionInfo(
            id: isBramble ? "bramble" : (ext.displayName ?? UUID().uuidString),
            name: name,
            version: ext.version ?? "1.0",
            manifestVersion: ext.manifestVersion,
            path: directoryURL.path,
            hasPopup: context.action(for: nil)?.popupWebView != nil,
            context: context
        )

        if isBramble {
            brambleContext = context
        }

        await MainActor.run {
            if !loadedExtensions.contains(where: { $0.id == info.id }) {
                loadedExtensions.append(info)
            }
            onExtensionsChanged?(loadedExtensions)
        }

        print("[WebExtension] Loaded: \(info.name) v\(info.version) (manifest \(info.manifestVersion), popup: \(info.hasPopup))")
        return info
    }

    @discardableResult
    public func installFromChromeWebStore(idOrUrl: String, installName: String? = nil) async throws -> LoadedExtensionInfo {
        let cleanID = Self.chromeExtensionID(from: idOrUrl)
        guard cleanID.count == 32, cleanID.allSatisfy({ ("a"..."p").contains(String($0)) }) else {
            throw Self.error("Invalid Chrome Web Store extension ID or URL.")
        }

        let urlString = "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx3&x=id%3D\(cleanID)%26uc"
        guard let url = URL(string: urlString) else { throw Self.error("Could not construct Chrome Web Store download URL.") }
        return try await downloadAndInstall(url: url, installName: installName ?? cleanID, archiveType: .crx)
    }

    @discardableResult
    public func installFromZipOrDirectory(url: URL) async throws -> LoadedExtensionInfo {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            throw Self.error("The selected extension path does not exist.")
        }
        if isDirectory.boolValue {
            let root = try Self.findManifestRoot(in: url)
            return try await loadExtension(from: root)
        }
        return try await downloadAndInstall(url: url, installName: UUID().uuidString, archiveType: .zip)
    }

    public func extensionsDirectory() -> URL {
        let directory = BrowserProfile.current.applicationSupportDirectory
            .appendingPathComponent("Extensions", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    // Load only extensions explicitly installed into this profile. There is no
    // app-bundle copy and no source-tree fallback.
    public func loadInstalledExtensions() async {
        let root = extensionsDirectory()
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        for entry in entries {
            do {
                let extensionRoot = try Self.findManifestRoot(in: entry)
                _ = try await loadExtension(from: extensionRoot)
            } catch {
                print("[WebExtension] Skipping \(entry.lastPathComponent): \(error.localizedDescription)")
            }
        }
    }

    private enum ArchiveType { case crx, zip }

    private func downloadAndInstall(url: URL, installName: String, archiveType: ArchiveType) async throws -> LoadedExtensionInfo {
        print("[WebExtension] Downloading extension from \(url.absoluteString)")
        var request = URLRequest(url: url)
        request.setValue("Surffish Native Extension Installer", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw Self.error("Extension download failed (HTTP \(status)).")
        }
        guard !data.isEmpty else { throw Self.error("The extension download was empty.") }

        let staging = extensionsDirectory().appendingPathComponent(".install-\(UUID().uuidString)", isDirectory: true)
        let destination = extensionsDirectory().appendingPathComponent(installName, isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        do {
            let zipData: Data
            switch archiveType {
            case .crx: zipData = try Self.crxPayload(from: data)
            case .zip: zipData = data
            }
            let archive = staging.appendingPathComponent("package.zip")
            try zipData.write(to: archive, options: .atomic)
            try Self.unzip(archive, into: staging)
            try? FileManager.default.removeItem(at: archive)
            let extensionRoot = try Self.findManifestRoot(in: staging)

            // Preserve the previous installed copy until the new package has
            // downloaded and unpacked successfully.
            let replacement = extensionsDirectory().appendingPathComponent(".replacement-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.moveItem(at: extensionRoot, to: replacement)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: replacement, to: destination)
            try? FileManager.default.removeItem(at: staging)
            return try await loadExtension(from: destination)
        } catch {
            try? FileManager.default.removeItem(at: staging)
            throw error
        }
    }

    private static func chromeExtensionID(from input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let components = URLComponents(string: trimmed),
           let lastPathComponent = components.path.split(separator: "/").last {
            return String(lastPathComponent)
        }
        return trimmed.components(separatedBy: "?").first ?? trimmed
    }

    private static func crxPayload(from data: Data) throws -> Data {
        guard data.count >= 12, String(data: data.prefix(4), encoding: .utf8) == "Cr24" else {
            throw error("The Chrome Web Store did not return a valid CRX package.")
        }
        let version = readUInt32LE(data, at: 4)
        let zipOffset: Int
        switch version {
        case 2:
            let publicKeyLength = Int(readUInt32LE(data, at: 8))
            guard data.count >= 16 + publicKeyLength else { throw error("Malformed CRX2 header.") }
            let signatureLength = Int(readUInt32LE(data, at: 12 + publicKeyLength))
            zipOffset = 16 + publicKeyLength + signatureLength
        case 3:
            let headerLength = Int(readUInt32LE(data, at: 8))
            zipOffset = 12 + headerLength
        default:
            throw error("Unsupported CRX package version \(version).")
        }
        guard zipOffset > 0, zipOffset < data.count else { throw error("Malformed CRX header or missing ZIP payload.") }
        return data.subdata(in: zipOffset..<data.count)
    }

    private static func readUInt32LE(_ data: Data, at offset: Int) -> UInt32 {
        guard offset >= 0, offset + 4 <= data.count else { return 0 }
        return UInt32(data[offset]) |
            (UInt32(data[offset + 1]) << 8) |
            (UInt32(data[offset + 2]) << 16) |
            (UInt32(data[offset + 3]) << 24)
    }

    private static func unzip(_ archive: URL, into directory: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-q", archive.path, "-d", directory.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw error("The downloaded extension archive could not be unpacked.")
        }
    }

    private static func findManifestRoot(in directory: URL) throws -> URL {
        let directManifest = directory.appendingPathComponent("manifest.json")
        if FileManager.default.fileExists(atPath: directManifest.path) { return directory }

        let children = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        for child in children {
            var isDirectory: ObjCBool = false
            if FileManager.default.fileExists(atPath: child.path, isDirectory: &isDirectory),
               isDirectory.boolValue,
               FileManager.default.fileExists(atPath: child.appendingPathComponent("manifest.json").path) {
                return child
            }
        }
        throw error("No manifest.json was found in the downloaded extension package.")
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "Surffish.WebExtensionInstaller", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    // MARK: WKWebExtensionControllerDelegate

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        openWindowsFor extensionContext: WKWebExtensionContext
    ) -> [WKWebExtensionWindow] {
        if let window = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
            return [window]
        }
        return []
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        focusedWindowFor extensionContext: WKWebExtensionContext
    ) -> WKWebExtensionWindow? {
        NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        openNewTabUsing configuration: WKWebExtension.TabConfiguration,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (WKWebExtensionTab?, Error?) -> Void
    ) {
        DispatchQueue.main.async {
            if let window = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
                window.closeBramblePopover()
            }
            let tab = TabManager.shared.createTab(url: configuration.url, makeActive: configuration.shouldBeActive)
            completionHandler(tab, nil)
        }
    }

    public func webExtensionController(
        _ controller: WKWebExtensionController,
        openOptionsPageFor extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Error?) -> Void
    ) {
        DispatchQueue.main.async {
            if let window = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
                window.closeBramblePopover()
            }
            if let url = extensionContext.optionsPageURL {
                _ = TabManager.shared.createTab(url: url, makeActive: true)
            }
            completionHandler(nil)
        }
    }
}
