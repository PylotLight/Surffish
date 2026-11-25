import Foundation

public struct BrowserHistoryEntry: Codable, Identifiable {
    public let id: UUID
    public let url: String
    public var title: String
    public let visitedAt: Date

    public init(id: UUID = UUID(), url: String, title: String, visitedAt: Date = Date()) {
        self.id = id
        self.url = url
        self.title = title
        self.visitedAt = visitedAt
    }
}

public struct BrowserBookmark: Codable, Identifiable {
    public let id: UUID
    public var url: String
    public var title: String
    public let createdAt: Date
    public var isPinned: Bool

    private enum CodingKeys: String, CodingKey {
        case id, url, title, createdAt, isPinned
    }

    public init(id: UUID = UUID(), url: String, title: String, createdAt: Date = Date(), isPinned: Bool = false) {
        self.id = id
        self.url = url
        self.title = title
        self.createdAt = createdAt
        self.isPinned = isPinned
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(UUID.self, forKey: .id)
        url = try values.decode(String.self, forKey: .url)
        title = try values.decode(String.self, forKey: .title)
        createdAt = try values.decode(Date.self, forKey: .createdAt)
        isPinned = try values.decodeIfPresent(Bool.self, forKey: .isPinned) ?? false
    }
}

@MainActor
public final class BrowserLibraryStore {
    public static let shared = BrowserLibraryStore()
    public private(set) var history: [BrowserHistoryEntry] = []
    public private(set) var bookmarks: [BrowserBookmark] = []

    private struct Snapshot: Codable {
        var history: [BrowserHistoryEntry]
        var bookmarks: [BrowserBookmark]
    }

    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()
    private let maximumHistoryEntries = 2_000

    private init() {
        let directory = BrowserProfile.current.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = BrowserProfile.current.fileURL("browser-library.json")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        if let data = try? Data(contentsOf: fileURL),
           let saved = try? decoder.decode(Snapshot.self, from: data) {
            history = saved.history.sorted { $0.visitedAt > $1.visitedAt }
            bookmarks = saved.bookmarks.sorted { $0.createdAt < $1.createdAt }
        }
    }

    public func recordVisit(url: URL, title: String, isPrivate: Bool) {
        guard !isPrivate,
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return }

        let absoluteURL = url.absoluteString
        if let latest = history.first,
           latest.url == absoluteURL,
           Date().timeIntervalSince(latest.visitedAt) < 5 {
            return
        }

        history.insert(BrowserHistoryEntry(url: absoluteURL, title: title), at: 0)
        if history.count > maximumHistoryEntries {
            history.removeLast(history.count - maximumHistoryEntries)
        }
        persist()
    }

    @discardableResult
    public func toggleBookmark(url: URL, title: String) -> Bool {
        let absoluteURL = url.absoluteString
        if let index = bookmarks.firstIndex(where: { $0.url == absoluteURL }) {
            bookmarks.remove(at: index)
            persist()
            return false
        }
        bookmarks.insert(BrowserBookmark(url: absoluteURL, title: title), at: 0)
        persist()
        return true
    }

    public func isBookmarked(url: URL?) -> Bool {
        guard let url else { return false }
        return bookmarks.contains { $0.url == url.absoluteString }
    }

    public func removeBookmark(id: UUID) {
        bookmarks.removeAll { $0.id == id }
        persist()
    }

    @discardableResult
    public func togglePinnedBookmark(id: UUID) -> Bool {
        guard let index = bookmarks.firstIndex(where: { $0.id == id }) else { return false }
        bookmarks[index].isPinned.toggle()
        persist()
        return bookmarks[index].isPinned
    }

    public func clearHistory() {
        history.removeAll()
        persist()
    }

    private func persist() {
        do {
            let data = try encoder.encode(Snapshot(history: history, bookmarks: bookmarks))
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("[Library] Could not save bookmarks/history: %@", error.localizedDescription)
        }
    }
}
