import Foundation

public struct SavedBrowserTab: Codable {
    public let id: UUID
    public let url: String
    public let title: String
    public let isPinned: Bool
    public let groupID: UUID?
    public let spaceID: String

    public init(id: UUID, url: String, title: String, isPinned: Bool, groupID: UUID?, spaceID: String) {
        self.id = id
        self.url = url
        self.title = title
        self.isPinned = isPinned
        self.groupID = groupID
        self.spaceID = spaceID
    }
}

public struct SavedBrowserSession: Codable {
    public let version: Int
    public let tabs: [SavedBrowserTab]
    public let activeTabID: UUID?

    public init(tabs: [SavedBrowserTab], activeTabID: UUID?) {
        self.version = 1
        self.tabs = tabs
        self.activeTabID = activeTabID
    }
}

public final class BrowserSessionStore {
    public static let shared = BrowserSessionStore()

    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()

    private init() {
        let directory = BrowserProfile.current.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = BrowserProfile.current.fileURL("browser-session.json")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    public func load() -> SavedBrowserSession? {
        guard let data = try? Data(contentsOf: fileURL),
              let session = try? decoder.decode(SavedBrowserSession.self, from: data),
              session.version == 1 else {
            return nil
        }
        return session
    }

    public func save(_ session: SavedBrowserSession) {
        do {
            let data = try encoder.encode(session)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("[Session] Could not save browser session: %@", error.localizedDescription)
        }
    }

    public func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
