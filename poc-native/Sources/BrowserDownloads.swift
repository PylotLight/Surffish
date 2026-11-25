import AppKit
import Observation
import SwiftUI
import WebKit

public enum BrowserDownloadState: String, Codable, Hashable {
    case downloading
    case interrupted
    case completed
    case cancelled
    case failed

    public var displayName: String {
        switch self {
        case .downloading: return "Downloading"
        case .interrupted: return "Interrupted"
        case .completed: return "Complete"
        case .cancelled: return "Cancelled"
        case .failed: return "Failed"
        }
    }
}

/// Local download metadata. The complete source URL and destination path are never shown in the UI.
public struct BrowserDownloadEntry: Codable, Hashable, Identifiable {
    public let id: UUID
    public var filename: String
    public var source: String
    public var startedAt: Date
    public var completedAt: Date?
    public var receivedBytes: Int64
    public var totalBytes: Int64
    public var state: BrowserDownloadState
    public var message: String?
    fileprivate var filePath: String?
    fileprivate var isPrivate: Bool

    public var fileAvailable: Bool {
        guard state == .completed, let filePath else { return false }
        return FileManager.default.fileExists(atPath: filePath)
    }

    public var progress: Double? {
        guard totalBytes > 0 else { return nil }
        return min(1, max(0, Double(receivedBytes) / Double(totalBytes)))
    }
}

private final class WeakDownloadWebView {
    weak var value: WKWebView?
    init(_ value: WKWebView) { self.value = value }
}

@MainActor
@Observable
public final class BrowserDownloadManager: NSObject, WKDownloadDelegate {
    public static let shared = BrowserDownloadManager()
    private static let historyLimit = 300
    private static let historyFilename = "downloads-history.json"

    public private(set) var entries: [BrowserDownloadEntry] = []
    public private(set) var destinationWarning: String?
    private var activeDownloads: [UUID: WKDownload] = [:]
    private var idsByDownload: [ObjectIdentifier: UUID] = [:]
    private var webViewsByEntry: [UUID: WeakDownloadWebView] = [:]
    private var resumeDataByEntry: [UUID: Data] = [:]
    private var cancelledDownloads: Set<ObjectIdentifier> = []
    private var progressTimer: Timer?
    private var lastPersistedProgressAt = Date.distantPast

    private override init() {
        super.init()
        loadHistory()
    }

    public var activeCount: Int { activeDownloads.count }

    public func beginTracking(_ download: WKDownload, in webView: WKWebView, isPrivate: Bool) {
        attach(download, in: webView, isPrivate: isPrivate, entryID: nil)
    }

    public func canResume(_ id: UUID) -> Bool {
        resumeDataByEntry[id] != nil && webViewsByEntry[id]?.value != nil
    }

    public func cancel(_ id: UUID) {
        guard let download = activeDownloads[id],
              let index = entries.firstIndex(where: { $0.id == id }) else { return }
        let isPrivate = entries[index].isPrivate
        let objectID = ObjectIdentifier(download)
        cancelledDownloads.insert(objectID)
        download.cancel(nil)
        activeDownloads.removeValue(forKey: id)
        idsByDownload.removeValue(forKey: objectID)
        resumeDataByEntry.removeValue(forKey: id)
        entries[index].state = .cancelled
        entries[index].completedAt = Date()
        entries[index].message = "Cancelled."
        if isPrivate && !TabManager.shared.tabs.contains(where: \.isPrivate) {
            entries.remove(at: index)
            webViewsByEntry.removeValue(forKey: id)
        }
        refreshProgressTimer()
        persistHistory()
    }

    /// Resume is available only while WebKit's resume data and the originating WebView are still alive.
    public func resume(_ id: UUID) {
        guard let data = resumeDataByEntry[id],
              let webView = webViewsByEntry[id]?.value,
              let index = entries.firstIndex(where: { $0.id == id }) else { return }
        resumeDataByEntry.removeValue(forKey: id)
        entries[index].state = .downloading
        entries[index].completedAt = nil
        entries[index].message = nil
        webView.resumeDownload(fromResumeData: data) { [weak self, weak webView] download in
            guard let self, let webView else { return }
            self.attach(download, in: webView, isPrivate: self.entries.first(where: { $0.id == id })?.isPrivate ?? false, entryID: id)
        }
        persistHistory()
    }

    public func remove(_ id: UUID) {
        guard !activeDownloads.keys.contains(id) else { return }
        entries.removeAll { $0.id == id }
        resumeDataByEntry.removeValue(forKey: id)
        webViewsByEntry.removeValue(forKey: id)
        persistHistory()
    }

    /// Clears only finished metadata. It never removes the downloaded files or interrupts active transfers.
    public func clearFinishedHistory() {
        entries.removeAll { activeDownloads[$0.id] == nil }
        resumeDataByEntry.removeAll()
        webViewsByEntry = webViewsByEntry.filter { activeDownloads[$0.key] != nil }
        persistHistory()
    }

    public func forgetFinishedPrivateDownloads() {
        entries.removeAll { $0.isPrivate && activeDownloads[$0.id] == nil }
        resumeDataByEntry = resumeDataByEntry.filter { id, _ in
            entries.contains(where: { $0.id == id })
        }
        webViewsByEntry = webViewsByEntry.filter { id, _ in
            entries.contains(where: { $0.id == id })
        }
        persistHistory()
    }

    public func open(_ id: UUID) -> Bool {
        guard let entry = entries.first(where: { $0.id == id }),
              entry.state == .completed,
              let url = existingFileURL(entry) else { return false }
        return NSWorkspace.shared.open(url)
    }

    public func reveal(_ id: UUID) -> Bool {
        guard let entry = entries.first(where: { $0.id == id }),
              let url = existingFileURL(entry) else { return false }
        NSWorkspace.shared.activateFileViewerSelecting([url])
        return true
    }

    public func openDownloadsFolder() -> Bool {
        let directory = downloadsDirectory()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            NSLog("[Downloads] Could not create downloads folder: %@", error.localizedDescription)
            return false
        }
        return NSWorkspace.shared.open(directory)
    }

    // MARK: WKDownloadDelegate

    public func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        guard let id = idsByDownload[ObjectIdentifier(download)] else {
            completionHandler(nil)
            return
        }
        let filename = Self.safeFilename(suggestedFilename)
        if let index = entries.firstIndex(where: { $0.id == id }) {
            entries[index].filename = filename
        }

        let settings = BrowserSettingsStore.shared.settings
        guard settings.askWhereToSaveDownloads else {
            let destination = uniqueDestination(in: downloadsDirectory(), filename: filename)
            setDestination(destination, for: id)
            completionHandler(destination)
            return
        }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = filename
        panel.directoryURL = downloadsDirectory()
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK, let selected = panel.url else {
                self?.markCancelledBeforeDestination(id, download: download)
                completionHandler(nil)
                return
            }
            self?.setDestination(selected, for: id)
            completionHandler(selected)
        }
        if let window = NSApp.keyWindow {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            panel.begin(completionHandler: finish)
        }
    }

    public func downloadDidFinish(_ download: WKDownload) {
        guard let id = idsByDownload.removeValue(forKey: ObjectIdentifier(download)),
              let index = entries.firstIndex(where: { $0.id == id }) else { return }
        updateProgress(for: id, download: download)
        entries[index].state = .completed
        entries[index].completedAt = Date()
        entries[index].message = nil
        activeDownloads.removeValue(forKey: id)
        resumeDataByEntry.removeValue(forKey: id)
        if entries[index].isPrivate && !TabManager.shared.tabs.contains(where: \.isPrivate) {
            entries.remove(at: index)
        }
        refreshProgressTimer()
        persistHistory()
    }

    public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let objectID = ObjectIdentifier(download)
        guard let id = idsByDownload.removeValue(forKey: objectID) else {
            cancelledDownloads.remove(objectID)
            return
        }
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        updateProgress(for: id, download: download)
        activeDownloads.removeValue(forKey: id)
        if cancelledDownloads.remove(objectID) != nil {
            entries[index].state = .cancelled
            entries[index].completedAt = Date()
            entries[index].message = "Cancelled."
        } else if let resumeData, !resumeData.isEmpty, webViewsByEntry[id]?.value != nil {
            resumeDataByEntry[id] = resumeData
            entries[index].state = .interrupted
            entries[index].completedAt = Date()
            entries[index].message = "The download was interrupted. Resume to try again."
        } else {
            entries[index].state = .failed
            entries[index].completedAt = Date()
            entries[index].message = "The download failed or could not be resumed."
        }
        if entries[index].isPrivate && !TabManager.shared.tabs.contains(where: \.isPrivate) {
            entries.remove(at: index)
        }
        refreshProgressTimer()
        persistHistory()
    }

    // MARK: Internal lifecycle

    private func attach(_ download: WKDownload, in webView: WKWebView, isPrivate: Bool, entryID: UUID?) {
        let id: UUID
        if let entryID, let index = entries.firstIndex(where: { $0.id == entryID }) {
            id = entryID
            entries[index].state = .downloading
            entries[index].completedAt = nil
            entries[index].message = nil
        } else {
            id = UUID()
            let sourceURL = download.originalRequest?.url
            entries.insert(
                BrowserDownloadEntry(
                    id: id,
                    filename: Self.safeFilename(sourceURL?.lastPathComponent ?? "Download"),
                    source: Self.safeSource(sourceURL),
                    startedAt: Date(),
                    completedAt: nil,
                    receivedBytes: 0,
                    totalBytes: 0,
                    state: .downloading,
                    message: nil,
                    filePath: nil,
                    isPrivate: isPrivate
                ),
                at: 0
            )
        }
        activeDownloads[id] = download
        idsByDownload[ObjectIdentifier(download)] = id
        webViewsByEntry[id] = WeakDownloadWebView(webView)
        download.delegate = self
        updateProgress(for: id, download: download)
        refreshProgressTimer()
        persistHistory()
    }

    private func markCancelledBeforeDestination(_ id: UUID, download: WKDownload) {
        cancelledDownloads.insert(ObjectIdentifier(download))
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].state = .cancelled
        entries[index].completedAt = Date()
        entries[index].message = "Cancelled."
        persistHistory()
    }

    private func setDestination(_ url: URL, for id: UUID) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].filename = Self.safeFilename(url.lastPathComponent)
        entries[index].filePath = url.standardizedFileURL.path
        persistHistory()
    }

    private func updateProgress(for id: UUID, download: WKDownload) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        let progress = download.progress
        entries[index].receivedBytes = max(0, progress.completedUnitCount)
        entries[index].totalBytes = max(0, progress.totalUnitCount)
    }

    private func refreshProgressTimer() {
        guard !activeDownloads.isEmpty else {
            progressTimer?.invalidate()
            progressTimer = nil
            return
        }
        guard progressTimer == nil else { return }
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshProgress() }
        }
    }

    private func refreshProgress() {
        for (id, download) in activeDownloads { updateProgress(for: id, download: download) }
        if Date().timeIntervalSince(lastPersistedProgressAt) >= 1 {
            lastPersistedProgressAt = Date()
            persistHistory()
        }
    }

    private func loadHistory() {
        let url = BrowserProfile.current.fileURL(Self.historyFilename)
        guard let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode([BrowserDownloadEntry].self, from: data) else { return }
        entries = Array(saved.prefix(Self.historyLimit)).map { entry in
            var restored = entry
            if restored.state == .downloading || restored.state == .interrupted {
                restored.state = .failed
                restored.completedAt = Date()
                restored.message = "This download stopped when Surffish closed and cannot be resumed here."
            }
            return restored
        }
        if entries.contains(where: { $0.message == "This download stopped when Surffish closed and cannot be resumed here." }) {
            persistHistory()
        }
    }

    private func persistHistory() {
        entries = Array(entries.prefix(Self.historyLimit))
        let stored = entries.filter { !$0.isPrivate }
        let url = BrowserProfile.current.fileURL(Self.historyFilename)
        do {
            try FileManager.default.createDirectory(
                at: BrowserProfile.current.applicationSupportDirectory,
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try encoder.encode(stored).write(to: url, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            NSLog("[Downloads] Could not save download history: %@", error.localizedDescription)
        }
    }

    private func downloadsDirectory() -> URL {
        let configuredPath = BrowserSettingsStore.shared.settings.downloadsDirectory
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !configuredPath.isEmpty, configuredPath.hasPrefix("/") else {
            return defaultDownloadsDirectoryAfterFailure()
        }
        let configured = URL(fileURLWithPath: configuredPath, isDirectory: true)
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: configured.path, isDirectory: &isDirectory) {
            guard isDirectory.boolValue else { return defaultDownloadsDirectoryAfterFailure() }
            destinationWarning = nil
            return configured
        }
        do {
            try FileManager.default.createDirectory(at: configured, withIntermediateDirectories: true)
            destinationWarning = nil
            return configured
        } catch {
            NSLog("[Downloads] Could not create configured folder: %@", error.localizedDescription)
            return defaultDownloadsDirectoryAfterFailure()
        }
    }

    private func defaultDownloadsDirectoryAfterFailure() -> URL {
        destinationWarning = "The selected Downloads folder is unavailable. Using the default Downloads folder instead."
        let fallback = URL(fileURLWithPath: BrowserSettings.defaultDownloadsDirectory, isDirectory: true)
        try? FileManager.default.createDirectory(at: fallback, withIntermediateDirectories: true)
        return fallback
    }

    private func existingFileURL(_ entry: BrowserDownloadEntry) -> URL? {
        guard let path = entry.filePath else { return nil }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private func uniqueDestination(in directory: URL, filename: String) -> URL {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safe = safeFilename(filename)
        let original = URL(fileURLWithPath: safe)
        let stem = original.deletingPathExtension().lastPathComponent
        let suffix = original.pathExtension
        var candidate = directory.appendingPathComponent(safe, isDirectory: false)
        var index = 2
        while FileManager.default.fileExists(atPath: candidate.path)
            || entries.contains(where: { $0.filePath == candidate.standardizedFileURL.path }) {
            let nextName = suffix.isEmpty ? "\(stem) (\(index))" : "\(stem) (\(index)).\(suffix)"
            candidate = directory.appendingPathComponent(nextName, isDirectory: false)
            index += 1
        }
        return candidate
    }

    private static func safeFilename(_ value: String) -> String {
        let name = URL(fileURLWithPath: value.replacingOccurrences(of: "\\", with: "/")).lastPathComponent
            .components(separatedBy: .controlCharacters).joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != ".." else { return "Download" }
        return String(name.prefix(240))
    }

    private static func safeSource(_ url: URL?) -> String {
        guard let url else { return "Unknown source" }
        switch url.scheme?.lowercased() {
        case "http", "https": return url.host?.lowercased() ?? "Unknown source"
        case "file": return "Local file"
        case "data": return "Embedded content"
        case "blob": return URL(string: url.absoluteString.replacingOccurrences(of: "^blob:", with: "", options: .regularExpression))?.host?.lowercased() ?? "Unknown source"
        default: return "Unknown source"
        }
    }
}

@MainActor
public struct BrowserDownloadsSidebarView: View {
    @State private var manager = BrowserDownloadManager.shared
    let searchText: String

    public init(searchText: String) { self.searchText = searchText }

    private var filteredEntries: [BrowserDownloadEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return manager.entries }
        return manager.entries.filter {
            $0.filename.localizedCaseInsensitiveContains(query)
                || $0.source.localizedCaseInsensitiveContains(query)
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { _ = manager.openDownloadsFolder() } label: {
                    Label("Downloads folder", systemImage: "folder")
                }
                .buttonStyle(.plain)
                .help("Open Downloads folder")
                Spacer(minLength: 0)
                Button("Clear finished") { manager.clearFinishedHistory() }
                    .buttonStyle(.plain)
                    .disabled(!manager.entries.contains(where: { !$0.state.isActive }))
                    .help("Remove finished items from the list; files stay on disk")
            }
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)

            if let warning = manager.destinationWarning {
                Text(warning)
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if filteredEntries.isEmpty {
                VStack(spacing: 7) {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 24, weight: .light))
                        .foregroundStyle(.tertiary)
                    Text(searchText.isEmpty ? "No downloads yet" : "No downloads match ‘\(searchText)’")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 7) {
                        ForEach(filteredEntries) { entry in
                            BrowserDownloadRow(entry: entry, manager: manager)
                        }
                    }
                    .padding(.vertical, 3)
                }
                .scrollIndicators(.visible)
            }
        }
    }
}

@MainActor
public struct BrowserDownloadsPopoverView: View {
    @State private var manager = BrowserDownloadManager.shared
    @State private var searchText = ""
    let onShowAll: () -> Void

    public init(onShowAll: @escaping () -> Void) { self.onShowAll = onShowAll }

    private var filteredEntries: [BrowserDownloadEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return manager.entries }
        return manager.entries.filter {
            $0.filename.localizedCaseInsensitiveContains(query)
                || $0.source.localizedCaseInsensitiveContains(query)
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Downloads").font(.system(size: 15, weight: .semibold))
                Spacer()
                Button { _ = manager.openDownloadsFolder() } label: {
                    Image(systemName: "folder")
                }
                .buttonStyle(.plain)
                .help("Open Downloads folder")
                Button { manager.clearFinishedHistory() } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.plain)
                .disabled(!manager.entries.contains(where: { !$0.state.isActive }))
                .help("Clear finished downloads")
            }

            if let warning = manager.destinationWarning {
                Text(warning)
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.tertiary)
                TextField("Search downloads", text: $searchText)
                    .textFieldStyle(.plain)
                    .accessibilityLabel("Search downloads")
            }
            .font(.system(size: 11))
            .padding(8)
            .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))

            if filteredEntries.isEmpty {
                ContentUnavailableView(
                    searchText.isEmpty ? "No Downloads" : "No Matching Downloads",
                    systemImage: "arrow.down.circle",
                    description: Text(searchText.isEmpty ? "Files you download will appear here." : "Try another filename or source.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 7) {
                        ForEach(Array(filteredEntries.prefix(6))) { entry in
                            BrowserDownloadRow(entry: entry, manager: manager)
                        }
                    }
                }
                .scrollIndicators(.visible)
            }

            HStack {
                Text("\(manager.entries.count) items")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                Spacer()
                Button("Show all downloads") { onShowAll() }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: .medium))
            }
        }
        .padding(14)
        .frame(width: 390, height: 390)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

@MainActor
private struct BrowserDownloadRow: View {
    let entry: BrowserDownloadEntry
    let manager: BrowserDownloadManager

    private var status: String {
        switch entry.state {
        case .downloading:
            if let progress = entry.progress { return "Downloading · \(Int((progress * 100).rounded()))%" }
            return "Downloading · \(Self.byteString(entry.receivedBytes)) received"
        case .interrupted: return manager.canResume(entry.id) ? "Interrupted · can resume" : "Interrupted"
        case .completed: return "Complete · \(Self.byteString(entry.totalBytes > 0 ? entry.totalBytes : entry.receivedBytes))"
        case .cancelled: return "Cancelled"
        case .failed: return "Failed"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: entry.state == .completed ? "doc.fill" : "arrow.down.doc")
                .font(.system(size: 15))
                .foregroundStyle(entry.state == .completed ? Color.accentColor : Color.secondary)
                .frame(width: 24, height: 27)
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.filename)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .help(entry.filename)
                Text(status)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                if entry.state == .downloading || entry.state == .interrupted {
                    ProgressView(value: entry.progress)
                        .progressViewStyle(.linear)
                        .tint(.accentColor)
                    Text("\(entry.source) · \(entry.startedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                } else {
                    Text(entry.message ?? "\(entry.source) · \(entry.startedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 2)
            Menu {
                if entry.state == .downloading {
                    Button("Cancel Download", role: .destructive) { manager.cancel(entry.id) }
                }
                if entry.state == .interrupted && manager.canResume(entry.id) {
                    Button("Resume Download") { manager.resume(entry.id) }
                }
                if entry.fileAvailable {
                    if entry.state == .completed { Button("Open File") { _ = manager.open(entry.id) } }
                    Button("Show in Finder") { _ = manager.reveal(entry.id) }
                }
                if entry.state != .downloading {
                    Button("Remove from List", role: .destructive) { manager.remove(entry.id) }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 24, height: 26)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel("Actions for \(entry.filename)")
        }
        .padding(8)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
    }

    private static func byteString(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: max(0, value), countStyle: .file)
    }
}

private extension BrowserDownloadState {
    var isActive: Bool { self == .downloading }
}
