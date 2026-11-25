import AppKit
import Observation
import SwiftUI

public protocol SidebarViewDelegate: AnyObject {
    func sidebarDidSelectTab(id: UUID)
    func sidebarDidCloseTab(id: UUID)
    func sidebarDidCreateNewTab()
    func sidebarDidDuplicateTab(id: UUID)
    func sidebarDidTogglePinTab(id: UUID)
    func sidebarDidOpenLibraryURL(_ url: URL)
    func sidebarDidRemoveBookmark(id: UUID)
    func sidebarDidToggleBookmarkPin(id: UUID)
    func sidebarDidOpenReadingListEntry(id: UUID, url: URL)
    func sidebarDidToggleReadingListRead(id: UUID)
    func sidebarDidRemoveReadingListEntry(id: UUID)
    func sidebarDidClearHistory()
    func sidebarDidOpenExtensions()
    func sidebarDidOpenSettings()
    func sidebarDidRequestReveal()
    func sidebarDidTogglePinSidebar()
    func sidebarDidQuit()
}

private enum SidebarContentMode: Equatable {
    case tabs
    case history
    case bookmarks
    case readingList
}

private enum LibrarySortOrder: String, CaseIterable, Identifiable {
    case defaultOrder = "Default"
    case newestFirst = "Newest"
    case oldestFirst = "Oldest"
    case titleAscending = "Title A–Z"
    case titleDescending = "Title Z–A"
    var id: String { rawValue }
}
private enum HistoryTimeFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case today = "Today"
    case sevenDays = "7 days"
    case thirtyDays = "30 days"
    var id: String { rawValue }

    func includes(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard self != .all else { return true }
        let days = self == .today ? 0 : (self == .sevenDays ? 6 : 29)
        guard let start = calendar.date(byAdding: .day, value: -days, to: calendar.startOfDay(for: now)) else { return false }
        return date >= start && date <= now
    }

    func startDate(now: Date = Date(), calendar: Calendar = .current) -> Date? {
        guard self != .all else { return nil }
        let days = self == .today ? 0 : (self == .sevenDays ? 6 : 29)
        return calendar.date(byAdding: .day, value: -days, to: calendar.startOfDay(for: now))
    }
}

@MainActor
@Observable
private final class SidebarViewModel {
    weak var delegate: SidebarViewDelegate?
    var tabs: [TabItem] = []
    var history: [BrowserHistoryEntry] = []
    var bookmarks: [BrowserBookmark] = []
    var readingList: [BrowserReadingListEntry] = []
    var activeTabID: UUID?
    var contentMode: SidebarContentMode = .tabs
    var searchText = ""
    var historyTimeFilter: HistoryTimeFilter = .all
    var historySortOrder: LibrarySortOrder = .defaultOrder
    var bookmarksSortOrder: LibrarySortOrder = .defaultOrder
    var readingListSortOrder: LibrarySortOrder = .defaultOrder
    var librarySortOrder: LibrarySortOrder {
        get {
            switch contentMode {
            case .history: return historySortOrder
            case .bookmarks: return bookmarksSortOrder
            case .readingList: return readingListSortOrder
            case .tabs: return .defaultOrder
            }
        }
        set {
            switch contentMode {
            case .history: historySortOrder = newValue
            case .bookmarks: bookmarksSortOrder = newValue
            case .readingList: readingListSortOrder = newValue
            case .tabs: break
            }
        }
    }
    var isSettingsTabActive = false
    var isExpanded = true
    var isPinned = false
    var isFocused = false
    var panelWidth: CGFloat = 280
    var onHoverChange: ((Bool) -> Void)?
    var onFocusChange: ((Bool) -> Void)?

    var requiresExpandedPanel: Bool { contentMode != .tabs }
    var pinnedTabs: [TabItem] { tabs.filter(\.isPinned) }
    var unpinnedTabs: [TabItem] { tabs.filter { !$0.isPinned } }
    var pinnedSites: [BrowserBookmark] { bookmarks.filter(\.isPinned) }
    var pinnedItemCount: Int { pinnedTabs.count + pinnedSites.count }

    private func matches(_ query: String, title: String, url: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return true }
        let host = URL(string: url)?.host ?? ""
        return title.localizedCaseInsensitiveContains(needle)
            || url.localizedCaseInsensitiveContains(needle)
            || host.localizedCaseInsensitiveContains(needle)
    }

    func tabMatches(_ tab: TabItem) -> Bool {
        matches(searchText, title: tab.webView.title ?? tab.title,
                url: (tab.webView.url ?? tab.url)?.absoluteString ?? "")
    }
    func historyMatches(_ entry: BrowserHistoryEntry) -> Bool {
        matches(searchText, title: entry.title, url: entry.url)
    }
    func bookmarkMatches(_ entry: BrowserBookmark) -> Bool {
        matches(searchText, title: entry.title, url: entry.url)
    }
    func readingListMatches(_ entry: BrowserReadingListEntry) -> Bool {
        matches(searchText, title: entry.title, url: entry.url)
    }

    func reorderTab(draggedID: String, onto target: TabItem) -> Bool {
        guard let id = UUID(uuidString: draggedID),
              let moving = tabs.first(where: { $0.id == id }),
              moving.isPinned == target.isPinned,
              let sourceIndex = tabs.firstIndex(where: { $0.id == id }),
              let targetIndex = tabs.firstIndex(where: { $0.id == target.id }) else { return false }
        let destination = targetIndex - (sourceIndex < targetIndex ? 1 : 0)
        TabManager.shared.moveTab(id: id, to: destination)
        refresh()
        return true
    }

    init() { refresh() }

    func refresh() {
        tabs = TabManager.shared.tabs
        activeTabID = TabManager.shared.activeTabId
        history = BrowserLibraryStore.shared.history
        bookmarks = BrowserLibraryStore.shared.bookmarks
        readingList = BrowserLibraryStore.shared.readingList
    }

    func show(_ mode: SidebarContentMode) {
        contentMode = mode
        isSettingsTabActive = false
        refresh()
    }
}

/// AppKit keeps the window integration stable; the actual sidebar UI is a SwiftUI view.
@MainActor
public final class SidebarView: NSView {
    private let model: SidebarViewModel
    private let hostingView: NSHostingView<NativeSidebarRootView>

    public weak var delegate: SidebarViewDelegate? {
        didSet { model.delegate = delegate }
    }

    public var onHoverChange: ((Bool) -> Void)? {
        didSet { model.onHoverChange = onHoverChange }
    }

    public var onFocusChange: ((Bool) -> Void)? {
        didSet { model.onFocusChange = onFocusChange }
    }

    public var requiresExpandedPanel: Bool { model.requiresExpandedPanel }
    public var isInteractionFocused: Bool { model.isFocused }

    public override init(frame frameRect: NSRect) {
        let model = SidebarViewModel()
        self.model = model
        hostingView = NSHostingView(rootView: NativeSidebarRootView(model: model))
        super.init(frame: frameRect)
        installHostingView()
    }

    public required init?(coder: NSCoder) {
        let model = SidebarViewModel()
        self.model = model
        hostingView = NSHostingView(rootView: NativeSidebarRootView(model: model))
        super.init(coder: coder)
        installHostingView()
    }

    private func installHostingView() {
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = NSColor.clear.cgColor
        addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    public func setCollapsed(_ collapsed: Bool) {
        model.isExpanded = !collapsed
    }

    public func setPinned(_ pinned: Bool) {
        model.isPinned = pinned
    }

    public func setPanelWidth(_ width: CGFloat) {
        model.panelWidth = max(width, CGFloat(BrowserSettings.minimumSidebarWidth))
    }

    public func reloadTabs() { model.refresh() }

    public func showTabs() { model.show(.tabs) }
    public func showHistory() { model.show(.history) }
    public func showBookmarks() { model.show(.bookmarks) }
    public func showReadingList() { model.show(.readingList) }

    public func setSettingsTabActive(_ active: Bool) {
        model.isSettingsTabActive = active
        if active { model.contentMode = .tabs }
        model.refresh()
    }
}

@MainActor
private struct NativeSidebarRootView: View {
    @Bindable var model: SidebarViewModel
    @FocusState private var hasFocus: Bool
    @Namespace private var morphNamespace

    private let railWidth: CGFloat = 64
    private var showsTabRail: Bool { model.contentMode == .tabs && !model.isExpanded }

    var body: some View {
        HStack(spacing: 0) {
            if showsTabRail {
                tabRail
                    .frame(width: railWidth)
                    .transition(.opacity)
            } else {
                expandedPanel
                    .frame(width: model.panelWidth)
                    .transition(.asymmetric(
                        insertion: .move(edge: .leading).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(SidebarVisualEffectBackground())
        .onHover { model.onHoverChange?($0) }
        .onChange(of: hasFocus) { _, focused in
            model.isFocused = focused
            model.onFocusChange?(focused)
        }
        .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.34), value: model.isExpanded)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Surffish sidebar")
    }

    private var tabRail: some View {
        VStack(spacing: 7) {
            if model.pinnedItemCount > 0 {
                pinnedClusterButton
            }

            ForEach(model.unpinnedTabs) { tab in
                compactTabButton(tab)
            }

            Spacer(minLength: 6)

            railButton("New tab", symbol: "plus", action: { model.delegate?.sidebarDidCreateNewTab() })
            railButton("Settings", symbol: "gearshape", action: { model.delegate?.sidebarDidOpenSettings() })
            railButton(
                model.isPinned ? "Auto-hide sidebar" : "Keep sidebar open",
                symbol: model.isPinned ? "pin.fill" : "pin",
                action: { model.delegate?.sidebarDidTogglePinSidebar() }
            )
        }
        .padding(.horizontal, 8)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .frame(maxHeight: .infinity)
    }

    private var pinnedClusterButton: some View {
        let firstSite = model.pinnedSites.first
        let firstTab = model.pinnedTabs.first
        let title = firstSite?.title ?? firstTab?.title ?? "Pinned items"
        let count = model.pinnedItemCount
        return Button {
            model.delegate?.sidebarDidRequestReveal()
        } label: {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(Color.white.opacity(0.09))
                    .frame(width: 36, height: 36)
                    .matchedGeometryEffect(id: "pinned-cluster", in: morphNamespace)
                    .overlay {
                        Text(String(title.first ?? "•").uppercased())
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.primary)
                    }
                if count > 1 {
                    Text("+\(count - 1)")
                        .font(.system(size: 8, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(.gray.opacity(0.82), in: Capsule())
                        .offset(x: 8, y: 5)
                }
            }
            .frame(width: 48, height: 42)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($hasFocus)
        .help("Show \(count) pinned tabs and sites")
        .accessibilityLabel("Pinned sites and tabs, \(count) total")
        .contextMenu {
            Button("Show Tabs") { model.delegate?.sidebarDidRequestReveal() }
        }
    }

    private func compactTabButton(_ tab: TabItem) -> some View {
        Button {
            model.delegate?.sidebarDidSelectTab(id: tab.id)
        } label: {
            ZStack(alignment: .bottomTrailing) {
            RoundedRectangle(cornerRadius: 11)
                    .fill(tab.id == model.activeTabID ? Color.accentColor.opacity(0.28) : Color.white.opacity(0.055))
                    .frame(width: 38, height: 38)
                    .matchedGeometryEffect(id: "tab-\(tab.id)", in: morphNamespace)
                    .overlay {
                        Text(String((tab.webView.title ?? tab.title).first ?? "•").uppercased())
                            .font(.system(size: 12, weight: tab.id == model.activeTabID ? .semibold : .medium))
                            .foregroundStyle(tab.id == model.activeTabID ? .primary : .secondary)
                    }
                if tab.isPrivate {
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.purple)
                        .padding(2)
                        .background(.black.opacity(0.72), in: Circle())
                        .offset(x: 4, y: 4)
                }
                if tab.webView.isLoading {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 6, height: 6)
                        .offset(x: 3, y: 3)
                }
            }
            .frame(width: 48, height: 42)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused($hasFocus)
        .help(tab.title.isEmpty ? "New Tab" : tab.title)
        .accessibilityLabel(tab.title.isEmpty ? "New Tab" : tab.title)
        .contextMenu {
            Button("Duplicate Tab") { model.delegate?.sidebarDidDuplicateTab(id: tab.id) }
            Button("Pin Tab") { model.delegate?.sidebarDidTogglePinTab(id: tab.id) }
            Divider()
            Button("Close Tab", role: .destructive) { model.delegate?.sidebarDidCloseTab(id: tab.id) }
        }
    }

    private func railButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 40, height: 38)
                .contentShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
        .focused($hasFocus)
        .help(title)
        .accessibilityLabel(title)
    }

    private var expandedPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(panelTitle)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if model.contentMode != .tabs {
                    Text("\(visibleLibraryCount) results")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.tertiary)
                        .accessibilityLabel("\(visibleLibraryCount) results")
                }
                if model.contentMode == .history {
                    Button {
                        if let start = model.historyTimeFilter.startDate() {
                            BrowserLibraryStore.shared.clearHistory(since: start)
                        } else {
                            model.delegate?.sidebarDidClearHistory()
                        }
                        model.refresh()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .help(model.historyTimeFilter == .all ? "Clear all history" : "Clear history for \(model.historyTimeFilter.rawValue)")
                    .accessibilityLabel(model.historyTimeFilter == .all ? "Clear all history" : "Clear history for \(model.historyTimeFilter.rawValue)")
                }
            }
            .frame(height: 24)

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.tertiary)
                TextField(searchPlaceholder, text: $model.searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .focused($hasFocus)
                    .accessibilityLabel("Search \(panelTitle.lowercased())")
                if !model.searchText.isEmpty {
                    Button { model.searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .help("Clear search")
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 9)
            .frame(height: 30)
            .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))

            if model.contentMode == .history {
                HStack(spacing: 5) {
                    ForEach(HistoryTimeFilter.allCases) { filter in
                        Button(filter.rawValue) { model.historyTimeFilter = filter }
                            .font(.system(size: 10, weight: model.historyTimeFilter == filter ? .semibold : .regular))
                            .foregroundStyle(model.historyTimeFilter == filter ? .primary : .secondary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 5)
                            .background(model.historyTimeFilter == filter ? Color.white.opacity(0.13) : Color.white.opacity(0.045), in: Capsule())
                            .buttonStyle(.plain)
                    }
                    Spacer(minLength: 0)
                }
            }

            if model.contentMode != .tabs {
                HStack(spacing: 5) {
                    if model.contentMode == .history { Spacer(minLength: 0) }
                    Menu {
                        ForEach(LibrarySortOrder.allCases) { order in
                            Button {
                                model.librarySortOrder = order
                            } label: {
                                if model.librarySortOrder == order {
                                    Label(order.rawValue, systemImage: "checkmark")
                                } else {
                                    Text(order.rawValue)
                                }
                            }
                        }
                    } label: {
                        Label("Sort: \(model.librarySortOrder.rawValue)", systemImage: "arrow.up.arrow.down")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .accessibilityLabel("Sort \(panelTitle.lowercased())")
                }
            }
            if model.contentMode == .tabs {
                Button {
                    model.delegate?.sidebarDidCreateNewTab()
                } label: {
                    Label("New tab", systemImage: "plus")
                        .font(.system(size: 12, weight: .medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(.plain)
                .focused($hasFocus)

                if !filteredPinnedTabs.isEmpty || !filteredPinnedSites.isEmpty { pinnedStrip }
            }

            ScrollView {
                LazyVStack(spacing: 5) {
                    switch model.contentMode {
                    case .tabs:
                        if filteredTabs.isEmpty && filteredPinnedTabs.isEmpty && filteredPinnedSites.isEmpty && !model.isSettingsTabActive { emptyMessage(model.searchText.isEmpty ? "No tabs open" : "No tabs match ‘\(model.searchText)’") }
                        ForEach(filteredTabs) { tab in tabRow(tab) }
                        if model.isSettingsTabActive { settingsRow }
                    case .history:
                        if filteredHistory.isEmpty { emptyMessage(model.searchText.isEmpty ? "No browsing history yet" : "No history matches ‘\(model.searchText)’") }
                        ForEach(filteredHistory) { entry in historyRow(entry) }
                    case .bookmarks:
                        if filteredBookmarks.isEmpty { emptyMessage(model.searchText.isEmpty ? "Save a page to see it here" : "No bookmarks match ‘\(model.searchText)’") }
                        ForEach(filteredBookmarks) { bookmark in bookmarkRow(bookmark) }
                    case .readingList:
                        if filteredReadingList.isEmpty { emptyMessage(model.searchText.isEmpty ? "Save a page for later from the toolbar" : "No reading-list items match ‘\(model.searchText)’") }
                        ForEach(filteredReadingList) { entry in readingListRow(entry) }
                    }
                }
                .padding(.bottom, 6)
            }
            .scrollIndicators(.visible)

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                footerButton(
                    model.isPinned ? "Auto-hide" : "Keep open",
                    symbol: model.isPinned ? "pin.fill" : "pin",
                    action: { model.delegate?.sidebarDidTogglePinSidebar() }
                )
                footerButton("Settings", symbol: "gearshape", action: { model.delegate?.sidebarDidOpenSettings() })
                footerButton("Quit", symbol: "power", action: { model.delegate?.sidebarDidQuit() })
            }
        }
        .padding(.horizontal, 11)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(Color.black.opacity(0.035))
    }

    private var panelTitle: String {
        switch model.contentMode {
        case .tabs: return model.isSettingsTabActive ? "TABS · SETTINGS" : "TABS"
        case .history: return "HISTORY"
        case .bookmarks: return "BOOKMARKS"
        case .readingList: return "READING LIST"
        }
    }

    private var searchPlaceholder: String {
        switch model.contentMode {
        case .tabs: return "Search tabs"
        case .history: return "Search history"
        case .bookmarks: return "Search bookmarks"
        case .readingList: return "Search reading list"
        }
    }

    private var filteredTabs: [TabItem] { model.unpinnedTabs.filter(model.tabMatches) }
    private var filteredPinnedTabs: [TabItem] { model.pinnedTabs.filter(model.tabMatches) }
    private var filteredPinnedSites: [BrowserBookmark] { model.pinnedSites.filter(model.bookmarkMatches) }
    private var filteredHistory: [BrowserHistoryEntry] {
        sorted(model.history.filter { model.historyMatches($0) && model.historyTimeFilter.includes($0.visitedAt) }, date: \.visitedAt, title: \.title)
    }
    private var filteredBookmarks: [BrowserBookmark] {
        sorted(model.bookmarks.filter(model.bookmarkMatches), date: \.createdAt, title: \.title)
    }
    private var filteredReadingList: [BrowserReadingListEntry] {
        sorted(model.readingList.filter(model.readingListMatches), date: \.addedAt, title: \.title)
    }
    private var visibleLibraryCount: Int {
        switch model.contentMode {
        case .history: return filteredHistory.count
        case .bookmarks: return filteredBookmarks.count
        case .readingList: return filteredReadingList.count
        case .tabs: return 0
        }
    }
    private func sorted<Entry>(_ entries: [Entry], date: KeyPath<Entry, Date>, title: KeyPath<Entry, String>) -> [Entry] {
        switch model.librarySortOrder {
        case .defaultOrder: return entries
        case .newestFirst: return entries.sorted { $0[keyPath: date] > $1[keyPath: date] }
        case .oldestFirst: return entries.sorted { $0[keyPath: date] < $1[keyPath: date] }
        case .titleAscending: return entries.sorted { $0[keyPath: title].localizedCaseInsensitiveCompare($1[keyPath: title]) == .orderedAscending }
        case .titleDescending: return entries.sorted { $0[keyPath: title].localizedCaseInsensitiveCompare($1[keyPath: title]) == .orderedDescending }
        }
    }

    private var pinnedStrip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(filteredPinnedSites) { bookmark in
                    Button {
                        guard let url = URL(string: bookmark.url) else { return }
                        model.delegate?.sidebarDidOpenLibraryURL(url)
                    } label: {
                        pinMark(title: bookmark.title, symbol: "globe", isClusterTarget: bookmark.id == filteredPinnedSites.first?.id)
                    }
                    .buttonStyle(.plain)
                    .help(bookmark.title.isEmpty ? bookmark.url : bookmark.title)
                    .accessibilityLabel(bookmark.title.isEmpty ? "Pinned site" : bookmark.title)
                }
                ForEach(filteredPinnedTabs) { tab in
                    Button {
                        model.delegate?.sidebarDidSelectTab(id: tab.id)
                    } label: {
                        pinMark(
                            title: tab.title,
                            symbol: "pin.fill",
                            isClusterTarget: filteredPinnedSites.isEmpty && tab.id == filteredPinnedTabs.first?.id
                        )
                    }
                    .buttonStyle(.plain)
                    .help(tab.title.isEmpty ? "Pinned tab" : tab.title)
                    .accessibilityLabel(tab.title.isEmpty ? "Pinned tab" : tab.title)
                    .draggable(tab.id.uuidString)
                    .dropDestination(for: String.self) { items, _ in
                        guard let draggedID = items.first else { return false }
                        return model.reorderTab(draggedID: draggedID, onto: tab)
                    }
                }
            }
            .padding(.horizontal, 2)
        }
        .scrollIndicators(.hidden)
        .frame(height: 36)
    }

    private func pinMark(title: String, symbol: String, isClusterTarget: Bool = false) -> some View {
        ZStack {
            if isClusterTarget {
                RoundedRectangle(cornerRadius: 9)
                    .fill(Color.white.opacity(0.075))
                    .frame(width: 30, height: 30)
                    .matchedGeometryEffect(id: "pinned-cluster", in: morphNamespace)
            } else {
                RoundedRectangle(cornerRadius: 9)
                    .fill(Color.white.opacity(0.075))
                    .frame(width: 30, height: 30)
            }
            Text(String(title.first ?? "•").uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: symbol)
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.tertiary)
                        .offset(x: 3, y: 3)
                }
        }
    }

    private func tabRow(_ tab: TabItem) -> some View {
        HStack(spacing: 4) {
            Button {
                model.delegate?.sidebarDidSelectTab(id: tab.id)
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: tab.isPrivate ? "hand.raised.fill" : "globe")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(tab.isPrivate ? Color.purple : Color.secondary)
                        .frame(width: 18)
                    Text(tab.webView.title ?? (tab.title.isEmpty ? "New Tab" : tab.title))
                        .font(.system(size: 12, weight: tab.id == model.activeTabID ? .semibold : .regular))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 2)
                    if tab.webView.isLoading {
                        ProgressView().controlSize(.mini).frame(width: 14, height: 14)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .focused($hasFocus)
            .help(tab.title.isEmpty ? "New Tab" : tab.title)

            Button {
                model.delegate?.sidebarDidCloseTab(id: tab.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .frame(width: 20, height: 24)
            }
            .buttonStyle(.plain)
            .help("Close tab")
            .accessibilityLabel("Close \(tab.title.isEmpty ? "New Tab" : tab.title)")
        }
        .padding(.horizontal, 9)
        .frame(height: 36)
        .background(tab.id == model.activeTabID ? Color.white.opacity(0.13) : Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 9))
        .background {
            RoundedRectangle(cornerRadius: 9)
                .fill(Color.clear)
                .matchedGeometryEffect(id: "tab-\(tab.id)", in: morphNamespace)
        }
        .contentShape(RoundedRectangle(cornerRadius: 9))
        .draggable(tab.id.uuidString)
        .dropDestination(for: String.self) { items, _ in
            guard let draggedID = items.first else { return false }
            return model.reorderTab(draggedID: draggedID, onto: tab)
        }
        .focused($hasFocus)
        .contextMenu {
            Button("Duplicate Tab") { model.delegate?.sidebarDidDuplicateTab(id: tab.id) }
            Button("Pin Tab") { model.delegate?.sidebarDidTogglePinTab(id: tab.id) }
            Divider()
            Button("Close Tab", role: .destructive) { model.delegate?.sidebarDidCloseTab(id: tab.id) }
        }
    }

    private func historyRow(_ entry: BrowserHistoryEntry) -> some View {
        let url = URL(string: entry.url)
        return libraryRow(
            title: entry.title,
            detail: url?.host ?? entry.url,
            symbol: "clock.arrow.circlepath",
            action: { if let url { model.delegate?.sidebarDidOpenLibraryURL(url) } }
        )
        .contextMenu {
            Button("Remove from History", role: .destructive) {
                BrowserLibraryStore.shared.removeHistoryEntry(id: entry.id)
                model.refresh()
            }
            if let host = url?.host {
                Button("Clear History for \(host)", role: .destructive) {
                    BrowserLibraryStore.shared.clearHistory(forSite: host)
                    model.refresh()
                }
            }
        }
    }

    private func bookmarkRow(_ bookmark: BrowserBookmark) -> some View {
        libraryRow(
            title: bookmark.title,
            detail: URL(string: bookmark.url)?.host ?? bookmark.url,
            symbol: bookmark.isPinned ? "pin.fill" : "bookmark.fill",
            action: { if let url = URL(string: bookmark.url) { model.delegate?.sidebarDidOpenLibraryURL(url) } }
        )
        .contextMenu {
            Button(bookmark.isPinned ? "Remove from Pinned Sites" : "Pin to Pinned Sites") {
                model.delegate?.sidebarDidToggleBookmarkPin(id: bookmark.id)
            }
            Button("Open") {
                if let url = URL(string: bookmark.url) { model.delegate?.sidebarDidOpenLibraryURL(url) }
            }
            Divider()
            Button("Remove Bookmark", role: .destructive) { model.delegate?.sidebarDidRemoveBookmark(id: bookmark.id) }
        }
    }

    private func readingListRow(_ entry: BrowserReadingListEntry) -> some View {
        libraryRow(
            title: entry.title,
            detail: URL(string: entry.url)?.host ?? entry.url,
            symbol: entry.isRead ? "book.closed" : "book.closed.fill",
            action: {
                guard let url = URL(string: entry.url) else { return }
                model.delegate?.sidebarDidOpenReadingListEntry(id: entry.id, url: url)
            }
        )
        .opacity(entry.isRead ? 0.68 : 1)
        .contextMenu {
            Button(entry.isRead ? "Mark as Unread" : "Mark as Read") {
                model.delegate?.sidebarDidToggleReadingListRead(id: entry.id)
            }
            Button("Open") {
                if let url = URL(string: entry.url) {
                    model.delegate?.sidebarDidOpenReadingListEntry(id: entry.id, url: url)
                }
            }
            Divider()
            Button("Remove from Reading List", role: .destructive) {
                model.delegate?.sidebarDidRemoveReadingListEntry(id: entry.id)
            }
        }
    }

    private func libraryRow(title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title.isEmpty ? detail : title)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(detail)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 9)
            .frame(height: 42)
            .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 9))
            .contentShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .focused($hasFocus)
    }

    private var settingsRow: some View {
        Button {
            model.delegate?.sidebarDidOpenSettings()
        } label: {
            Label("Settings", systemImage: "gearshape.fill")
                .font(.system(size: 12, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(Color.accentColor.opacity(0.16), in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .focused($hasFocus)
    }

    private func footerButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 11, weight: .medium))
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .focused($hasFocus)
        .help(title)
    }

    private func emptyMessage(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 11))
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 12)
    }
}

@MainActor
private struct SidebarVisualEffectBackground: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .underWindowBackground
        view.blendingMode = .withinWindow
        view.state = .active
        view.wantsLayer = true
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}
