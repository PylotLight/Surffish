import Foundation

public enum BrowserSearchEngine: String, CaseIterable, Codable {
    case duckDuckGo
    case google
    case bing

    public var displayName: String {
        switch self {
        case .duckDuckGo: return "DuckDuckGo"
        case .google: return "Google"
        case .bing: return "Bing"
        }
    }

    public func searchURL(for query: String) -> URL? {
        var components: URLComponents?
        switch self {
        case .duckDuckGo:
            components = URLComponents(string: "https://duckduckgo.com/")
        case .google:
            components = URLComponents(string: "https://www.google.com/search")
        case .bing:
            components = URLComponents(string: "https://www.bing.com/search")
        }
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        return components?.url
    }
}

public struct BrowserSettings: Codable {
    public var version: Int
    public var searchEngine: BrowserSearchEngine
    public var startPage: String
    public var restoreSession: Bool
    public var showSidebarAtStartup: Bool
    public var sshProxyEnabled: Bool
    public var sshHost: String

    private enum CodingKeys: String, CodingKey {
        case version, searchEngine, startPage, restoreSession, showSidebarAtStartup
        case sshProxyEnabled, sshHost
    }

    public init(
        version: Int,
        searchEngine: BrowserSearchEngine,
        startPage: String,
        restoreSession: Bool,
        showSidebarAtStartup: Bool,
        sshProxyEnabled: Bool,
        sshHost: String
    ) {
        self.version = version
        self.searchEngine = searchEngine
        self.startPage = startPage
        self.restoreSession = restoreSession
        self.showSidebarAtStartup = showSidebarAtStartup
        self.sshProxyEnabled = sshProxyEnabled
        self.sshHost = sshHost
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
        searchEngine = try values.decodeIfPresent(BrowserSearchEngine.self, forKey: .searchEngine) ?? .duckDuckGo
        startPage = try values.decodeIfPresent(String.self, forKey: .startPage) ?? BrowserSettings.defaults.startPage
        restoreSession = try values.decodeIfPresent(Bool.self, forKey: .restoreSession) ?? true
        showSidebarAtStartup = try values.decodeIfPresent(Bool.self, forKey: .showSidebarAtStartup) ?? true
        sshProxyEnabled = try values.decodeIfPresent(Bool.self, forKey: .sshProxyEnabled) ?? false
        sshHost = try values.decodeIfPresent(String.self, forKey: .sshHost) ?? ""
    }

    public static let defaults = BrowserSettings(
        version: 1,
        searchEngine: .duckDuckGo,
        startPage: "https://online.bonjourr.fr/",
        restoreSession: true,
        showSidebarAtStartup: true,
        sshProxyEnabled: false,
        sshHost: ""
    )

    public var startPageURL: URL {
        guard let url = URL(string: startPage),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return URL(string: BrowserSettings.defaults.startPage)!
        }
        return url
    }
}

public final class BrowserSettingsStore {
    public static let shared = BrowserSettingsStore()

    public private(set) var settings: BrowserSettings
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()

    private init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let directory = support.appendingPathComponent("SurffishNative", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = directory.appendingPathComponent("browser-settings.json")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? Data(contentsOf: fileURL),
           let saved = try? decoder.decode(BrowserSettings.self, from: data),
           saved.version == BrowserSettings.defaults.version {
            settings = saved
        } else {
            settings = BrowserSettings.defaults
        }
    }

    public func update(_ settings: BrowserSettings) {
        self.settings = settings
        do {
            let data = try encoder.encode(settings)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("[Settings] Could not save browser settings: %@", error.localizedDescription)
        }
    }
}
