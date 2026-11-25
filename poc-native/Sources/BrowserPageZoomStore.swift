import Foundation

public enum BrowserPageZoomAction {
    case zoomIn
    case zoomOut
    case reset
}

/// Native WebKit counterpart to Electron's per-origin page zoom. Normal-page
/// preferences are profile-local; private-session changes remain in memory only.
@MainActor
public final class BrowserPageZoomStore {
    public static let shared = BrowserPageZoomStore()

    private static let zoomFactors: [Double] = [
        0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5
    ]
    private static let maximumSavedOrigins = 200

    private let fileURL: URL
    private let encoder: JSONEncoder
    private var savedZooms: [String: Double]
    private var privateZooms: [String: Double] = [:]

    private init() {
        let directory = BrowserProfile.current.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = BrowserProfile.current.fileURL("browser-site-zoom.json")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([String: Double].self, from: data) {
            savedZooms = decoded.filter { Self.isValidOrigin($0.key) && Self.normalize($0.value) != 1 }
        } else {
            savedZooms = [:]
        }
    }

    public func zoom(for url: URL?, isPrivate: Bool) -> CGFloat {
        guard let origin = Self.origin(for: url) else { return 1 }
        if isPrivate, let privateZoom = privateZooms[origin] {
            return CGFloat(privateZoom)
        }
        return CGFloat(savedZooms[origin] ?? 1)
    }

    @discardableResult
    public func step(_ action: BrowserPageZoomAction, current: CGFloat, for url: URL?, isPrivate: Bool) -> CGFloat {
        guard let origin = Self.origin(for: url) else { return 1 }
        let value = Self.normalize(Double(current))
        let next: Double
        switch action {
        case .reset:
            next = 1
        case .zoomIn:
            next = Self.zoomFactors.first(where: { $0 > value + 0.001 }) ?? Self.zoomFactors.last ?? 5
        case .zoomOut:
            next = Self.zoomFactors.reversed().first(where: { $0 < value - 0.001 }) ?? Self.zoomFactors.first ?? 0.25
        }
        if isPrivate {
            privateZooms[origin] = next
        } else if next == 1 {
            savedZooms.removeValue(forKey: origin)
            persist()
        } else {
            savedZooms[origin] = next
            if savedZooms.count > Self.maximumSavedOrigins,
               let evictedOrigin = savedZooms.keys.sorted().first {
                savedZooms.removeValue(forKey: evictedOrigin)
            }
            persist()
        }
        return CGFloat(next)
    }

    public func clearPrivateOverrides() { privateZooms.removeAll() }

    public func clearAll() {
        savedZooms.removeAll()
        privateZooms.removeAll()
        persist()
    }

    private static func normalize(_ value: Double) -> Double {
        guard value.isFinite, value > 0 else { return 1 }
        return (min(5, max(0.25, value)) * 100).rounded() / 100
    }

    private static func isValidOrigin(_ value: String) -> Bool {
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              url.host != nil,
              url.path.isEmpty || url.path == "/",
              url.query == nil,
              url.fragment == nil else { return false }
        return true
    }

    private static func origin(for url: URL?) -> String? {
        guard let url,
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host.lowercased()
        if let port = url.port, !((scheme == "http" && port == 80) || (scheme == "https" && port == 443)) {
            components.port = port
        }
        return components.string
    }

    private func persist() {
        do {
            let data = try encoder.encode(savedZooms)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("[Page Zoom] Could not save site zoom: %@", error.localizedDescription)
        }
    }
}
