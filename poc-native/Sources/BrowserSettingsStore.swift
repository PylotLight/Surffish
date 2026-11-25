import Foundation

public enum BrowserSearchEngine: String, CaseIterable, Codable, Hashable {
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

public enum NewTabTheme: String, CaseIterable, Codable, Identifiable, Hashable {
    case midnight
    case ocean
    case forest
    case ember

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .midnight: return "Midnight"
        case .ocean: return "Ocean"
        case .forest: return "Forest"
        case .ember: return "Ember"
        }
    }

    public var backgroundCSS: String {
        switch self {
        case .midnight:
            return "radial-gradient(ellipse at 50% 24%, rgba(78, 103, 139, .23), transparent 48%), linear-gradient(145deg, #171d27 0%, #10151d 52%, #151a23 100%)"
        case .ocean:
            return "radial-gradient(ellipse at 72% 18%, rgba(38, 139, 170, .24), transparent 48%), linear-gradient(145deg, #10232e 0%, #10171f 56%, #13242b 100%)"
        case .forest:
            return "radial-gradient(ellipse at 28% 20%, rgba(75, 133, 94, .25), transparent 48%), linear-gradient(145deg, #17251f 0%, #111914 56%, #1b2721 100%)"
        case .ember:
            return "radial-gradient(ellipse at 68% 22%, rgba(174, 100, 62, .24), transparent 48%), linear-gradient(145deg, #2b201d 0%, #171514 56%, #29201d 100%)"
        }
    }
}

public enum NewTabSiteSource: String, CaseIterable, Codable, Identifiable, Hashable {
    case automatic
    case pinned
    case recent
    case bookmarks
    case custom

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .automatic: return "Automatic"
        case .pinned: return "Pinned sites"
        case .recent: return "Recently visited"
        case .bookmarks: return "Bookmarks"
        case .custom: return "Custom shortcuts"
        }
    }
}

public struct BrowserNewTabQuickLink: Codable, Identifiable, Hashable {
    public var id: UUID
    public var title: String
    public var url: String

    public init(id: UUID = UUID(), title: String, url: String) {
        self.id = id
        self.title = title
        self.url = url
    }
}

public struct BrowserSettings: Codable {
    public var version: Int
    public var searchEngine: BrowserSearchEngine
    public var startPage: String
    public var restoreSession: Bool
    public var showSidebarAtStartup: Bool
    public var sidebarPinned: Bool
    public var sidebarWidth: Int
    public var sshProxyEnabled: Bool
    public var sshHost: String
    public var sshProxyPort: Int
    public var sshProxyShareEnabled: Bool
    public var sshProxyBindAddress: String
    public var adBlockingEnabled: Bool
    public var newTabTheme: NewTabTheme
    public var newTabSiteSource: NewTabSiteSource
    public var customQuickLinks: [BrowserNewTabQuickLink]

    private enum CodingKeys: String, CodingKey {
        case version, searchEngine, startPage, restoreSession, showSidebarAtStartup, sidebarPinned, sidebarWidth
        case sshProxyEnabled, sshHost, sshProxyPort, sshProxyShareEnabled, sshProxyBindAddress, adBlockingEnabled
        case newTabTheme, newTabSiteSource, customQuickLinks
    }

    public init(
        version: Int,
        searchEngine: BrowserSearchEngine,
        startPage: String,
        restoreSession: Bool,
        showSidebarAtStartup: Bool,
        sidebarPinned: Bool = false,
        sidebarWidth: Int = 280,
        sshProxyEnabled: Bool,
        sshHost: String,
        sshProxyPort: Int = 1080,
        sshProxyShareEnabled: Bool = false,
        sshProxyBindAddress: String = "127.0.0.1",
        adBlockingEnabled: Bool = false,
        newTabTheme: NewTabTheme = .midnight,
        newTabSiteSource: NewTabSiteSource = .automatic,
        customQuickLinks: [BrowserNewTabQuickLink] = []
    ) {
        self.version = version
        self.searchEngine = searchEngine
        self.startPage = startPage
        self.restoreSession = restoreSession
        self.showSidebarAtStartup = showSidebarAtStartup
        self.sidebarPinned = sidebarPinned
        self.sidebarWidth = min(max(sidebarWidth, Self.minimumSidebarWidth), Self.maximumSidebarWidth)
        self.sshProxyEnabled = sshProxyEnabled
        self.sshHost = sshHost
        self.sshProxyPort = sshProxyPort
        self.sshProxyShareEnabled = sshProxyShareEnabled
        self.sshProxyBindAddress = sshProxyBindAddress
        self.adBlockingEnabled = adBlockingEnabled
        self.newTabTheme = newTabTheme
        self.newTabSiteSource = newTabSiteSource
        self.customQuickLinks = customQuickLinks
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
        searchEngine = try values.decodeIfPresent(BrowserSearchEngine.self, forKey: .searchEngine) ?? .duckDuckGo
        startPage = try values.decodeIfPresent(String.self, forKey: .startPage) ?? BrowserSettings.defaults.startPage
        restoreSession = try values.decodeIfPresent(Bool.self, forKey: .restoreSession) ?? true
        showSidebarAtStartup = try values.decodeIfPresent(Bool.self, forKey: .showSidebarAtStartup) ?? true
        sidebarPinned = try values.decodeIfPresent(Bool.self, forKey: .sidebarPinned) ?? false
        let savedSidebarWidth = try values.decodeIfPresent(Int.self, forKey: .sidebarWidth) ?? 280
        sidebarWidth = min(max(savedSidebarWidth, Self.minimumSidebarWidth), Self.maximumSidebarWidth)
        sshProxyEnabled = try values.decodeIfPresent(Bool.self, forKey: .sshProxyEnabled) ?? false
        sshHost = try values.decodeIfPresent(String.self, forKey: .sshHost) ?? ""
        sshProxyPort = try values.decodeIfPresent(Int.self, forKey: .sshProxyPort) ?? 1080
        sshProxyShareEnabled = try values.decodeIfPresent(Bool.self, forKey: .sshProxyShareEnabled) ?? false
        sshProxyBindAddress = try values.decodeIfPresent(String.self, forKey: .sshProxyBindAddress) ?? "127.0.0.1"
        adBlockingEnabled = try values.decodeIfPresent(Bool.self, forKey: .adBlockingEnabled) ?? false
        newTabTheme = try values.decodeIfPresent(NewTabTheme.self, forKey: .newTabTheme) ?? .midnight
        newTabSiteSource = try values.decodeIfPresent(NewTabSiteSource.self, forKey: .newTabSiteSource) ?? .automatic
        customQuickLinks = try values.decodeIfPresent([BrowserNewTabQuickLink].self, forKey: .customQuickLinks) ?? []
    }

    public static let minimumSidebarWidth = 220
    public static let maximumSidebarWidth = 440

    public static let defaults = BrowserSettings(
        version: 1,
        searchEngine: .duckDuckGo,
        startPage: "surffish://newtab/",
        restoreSession: true,
        showSidebarAtStartup: true,
        sidebarPinned: false,
        sidebarWidth: 280,
        sshProxyEnabled: false,
        sshHost: "",
        sshProxyPort: 1080,
        sshProxyShareEnabled: false,
        sshProxyBindAddress: "127.0.0.1",
        adBlockingEnabled: false,
        newTabTheme: .midnight,
        newTabSiteSource: .automatic,
        customQuickLinks: []
    )

    public var startPageURL: URL {
        guard let url = URL(string: startPage),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" || (scheme == "surffish" && url.host == "newtab") else {
            return URL(string: BrowserSettings.defaults.startPage)!
        }
        return url
    }
}

public final class BrowserSettingsStore {
    public static let shared = BrowserSettingsStore()
    private static let legacyExternalStartPage = "https://online.bonjourr.fr/"

    public private(set) var settings: BrowserSettings
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()

    private init() {
        let directory = BrowserProfile.current.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = BrowserProfile.current.fileURL("browser-settings.json")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? Data(contentsOf: fileURL),
           let saved = try? decoder.decode(BrowserSettings.self, from: data),
           saved.version == BrowserSettings.defaults.version {
            if saved.startPage == Self.legacyExternalStartPage {
                var migrated = saved
                migrated.startPage = BrowserSettings.defaults.startPage
                settings = migrated
                persist(migrated)
            } else {
                settings = saved
            }
        } else {
            settings = BrowserSettings.defaults
        }
    }

    public func update(_ settings: BrowserSettings) {
        self.settings = settings
        persist(settings)
    }

    private func persist(_ settings: BrowserSettings) {
        do {
            let data = try encoder.encode(settings)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("[Settings] Could not save browser settings: %@", error.localizedDescription)
        }
    }
}
