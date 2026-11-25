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
    
    private override init() {
        super.init()
        controller.delegate = self
    }
    
    public var bramblePopupWebView: WKWebView? {
        guard let ctx = brambleContext, let action = ctx.action(for: nil) else { return nil }
        if let webView = action.popupWebView {
            BrambleNativeBridge.shared.applyTo(userContentController: webView.configuration.userContentController)
            return webView
        }
        return nil
    }
    
    public func context(for url: URL) -> WKWebExtensionContext? {
        for ext in loadedExtensions {
            if url.absoluteString.hasPrefix(ext.context.baseURL.absoluteString) {
                return ext.context
            }
        }
        return brambleContext
    }
    
    public func openBrambleOptionsTab() {
        guard let ctx = brambleContext else {
            print("[WebExtension] Warning: Bramble context is nil, cannot open options")
            return
        }
        guard let url = ctx.optionsPageURL else {
            print("[WebExtension] Warning: Bramble optionsPageURL is nil")
            return
        }
        print("[WebExtension] Opening Bramble options tab: \(url.absoluteString)")
        _ = TabManager.shared.createTab(url: url, makeActive: true)
    }
    
    @discardableResult
    public func loadExtension(from directoryURL: URL) async throws -> LoadedExtensionInfo {
        let ext = try await WKWebExtension(resourceBaseURL: directoryURL)
        let context = WKWebExtensionContext(for: ext)
        
        let name = ext.displayName ?? directoryURL.lastPathComponent
        let isBramble = name.lowercased().contains("bramble") || directoryURL.lastPathComponent.lowercased().contains("bramble")
        
        // Ensure stable uniqueIdentifier so WebKit storage/origin (IndexedDB, localStorage)
        // is never partitioned under random UUIDs across app launches!
        if isBramble {
            context.uniqueIdentifier = "bramble-extension-vault-stable"
            self.brambleContext = context
        } else {
            let safeName = name.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }
            context.uniqueIdentifier = safeName.isEmpty ? UUID().uuidString : safeName
        }
        
        // Grant all requested permissions
        for perm in ext.requestedPermissions {
            context.setPermissionStatus(.grantedExplicitly, for: perm)
        }
        for pattern in ext.requestedPermissionMatchPatterns {
            context.setPermissionStatus(.grantedExplicitly, for: pattern)
        }
        
        try controller.load(context)
        
        // Load background worker / service script so message passing and storage sync are immediately live
        try? await context.loadBackgroundContent()
        
        if let extConfig = context.webViewConfiguration {
            BrambleNativeBridge.shared.applyTo(userContentController: extConfig.userContentController)
        }
        
        let hasPopup = (context.action(for: nil)?.popupWebView != nil)
        
        let info = LoadedExtensionInfo(
            id: ext.displayName ?? UUID().uuidString,
            name: name,
            version: ext.version ?? "1.0",
            manifestVersion: ext.manifestVersion,
            path: directoryURL.path,
            hasPopup: hasPopup,
            context: context
        )
        
        if name.lowercased().contains("bramble") {
            self.brambleContext = context
        }
        
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.loadedExtensions.append(info)
            self.onExtensionsChanged?(self.loadedExtensions)
        }
        
        print("[WebExtension] Loaded: \(info.name) v\(info.version) (hasPopup: \(hasPopup))")
        return info
    }
    
    public func installFromChromeWebStore(idOrUrl: String) async throws -> LoadedExtensionInfo {
        var cleanId = idOrUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleanId.contains("/") {
            cleanId = (cleanId as NSString).lastPathComponent.components(separatedBy: "?").first ?? cleanId
        }
        
        guard cleanId.count == 32 else {
            throw NSError(domain: "WebExtension", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid Chrome extension ID: must be 32 characters."])
        }
        
        let crxUrlStr = "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0.0.0&acceptformat=crx3&x=id%3D\(cleanId)%26uc"
        guard let crxUrl = URL(string: crxUrlStr) else {
            throw NSError(domain: "WebExtension", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])
        }
        
        print("[WebExtension] Downloading CRX for \(cleanId)...")
        let (data, response) = try await URLSession.shared.data(from: crxUrl)
        guard let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 else {
            throw NSError(domain: "WebExtension", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to download CRX (HTTP status error)"])
        }
        
        let dest = extensionsDirectory().appendingPathComponent(cleanId)
        try extractCrx(data: data, destination: dest)
        
        return try await loadExtension(from: dest)
    }
    
    public func installFromZipOrDirectory(url: URL) async throws -> LoadedExtensionInfo {
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
            return try await loadExtension(from: url)
        }
        
        let id = UUID().uuidString
        let dest = extensionsDirectory().appendingPathComponent(id)
        try FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-q", "-o", url.path, "-d", dest.path]
        try process.run()
        process.waitUntilExit()
        
        return try await loadExtension(from: dest)
    }
    
    private func extractCrx(data: Data, destination: URL) throws {
        guard data.count > 16 else {
            throw NSError(domain: "CRX", code: 1, userInfo: [NSLocalizedDescriptionKey: "CRX file too small"])
        }
        let magic = String(data: data.subdata(in: 0..<4), encoding: .utf8)
        guard magic == "Cr24" else {
            throw NSError(domain: "CRX", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid CRX magic bytes"])
        }
        let headerSize = data.subdata(in: 8..<12).withUnsafeBytes { $0.load(as: UInt32.self) }
        let zipOffset = 12 + Int(headerSize)
        guard data.count > zipOffset else {
            throw NSError(domain: "CRX", code: 3, userInfo: [NSLocalizedDescriptionKey: "Malformed CRX header"])
        }
        
        let zipData = data.subdata(in: zipOffset..<data.count)
        let tempZip = destination.appendingPathComponent("temp.zip")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        try zipData.write(to: tempZip)
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-q", "-o", tempZip.path, "-d", destination.path]
        try process.run()
        process.waitUntilExit()
        try? FileManager.default.removeItem(at: tempZip)
    }
    
    public func extensionsDirectory() -> URL {
        let dir = BrowserProfile.current.applicationSupportDirectory.appendingPathComponent("Extensions", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    
    public func loadDefaultExtensions(basePath: String? = nil) async {
        var brambleUrl: URL?
        
        // 1. Check Application Support/SurffishNative/Bramble
        let appSupportBramble = BrowserProfile.current.applicationSupportDirectory.appendingPathComponent("Bramble", isDirectory: true)
        if FileManager.default.fileExists(atPath: appSupportBramble.appendingPathComponent("manifest.json").path) {
            brambleUrl = appSupportBramble
        }
        // 2. Check basePath
        else if let base = basePath {
            let path = (base as NSString).appendingPathComponent("poc-native/Resources/bramble")
            let u = URL(fileURLWithPath: path)
            if FileManager.default.fileExists(atPath: u.appendingPathComponent("manifest.json").path) {
                brambleUrl = u
            }
        }
        if let bUrl = brambleUrl {
            do {
                try await loadExtension(from: bUrl)
                print("[WebExtension] Loaded real Bramble successfully from \(bUrl.path)!")
            } catch {
                print("[WebExtension] Error loading real Bramble: \(error)")
            }
        } else {
            print("[WebExtension] Warning: Bramble extension directory could not be located!")
        }
        
        let extDir = extensionsDirectory()
        if let contents = try? FileManager.default.contentsOfDirectory(at: extDir, includingPropertiesForKeys: nil) {
            for subDir in contents {
                if FileManager.default.fileExists(atPath: subDir.appendingPathComponent("manifest.json").path) {
                    _ = try? await loadExtension(from: subDir)
                }
            }
        }
        
    }
    
    // MARK: - WKWebExtensionControllerDelegate
    public func webExtensionController(
        _ controller: WKWebExtensionController,
        openWindowsFor extensionContext: WKWebExtensionContext
    ) -> [WKWebExtensionWindow] {
        if let win = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
            return [win]
        }
        return []
    }
    
    public func webExtensionController(
        _ controller: WKWebExtensionController,
        focusedWindowFor extensionContext: WKWebExtensionContext
    ) -> WKWebExtensionWindow? {
        if let win = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
            return win
        }
        return nil
    }
    
    public func webExtensionController(
        _ controller: WKWebExtensionController,
        openNewTabUsing configuration: WKWebExtension.TabConfiguration,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (WKWebExtensionTab?, Error?) -> Void
    ) {
        print("[WebExtension] Delegate openNewTabUsing: \(configuration.url?.absoluteString ?? "nil")")
        DispatchQueue.main.async {
            if let win = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
                win.closeBramblePopover()
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
        print("[WebExtension] Delegate openOptionsPageFor called: \(extensionContext.optionsPageURL?.absoluteString ?? "nil")")
        DispatchQueue.main.async {
            if let win = NSApp.windows.first(where: { $0.windowController is MainWindowController })?.windowController as? MainWindowController {
                win.closeBramblePopover()
            }
            if let optionsURL = extensionContext.optionsPageURL {
                _ = TabManager.shared.createTab(url: optionsURL, makeActive: true)
            }
            completionHandler(nil)
        }
    }
}
