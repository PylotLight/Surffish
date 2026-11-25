import Foundation
import WebKit

/// Serves Surffish's built-in New Tab dashboard without a network dependency.
public final class BrowserNewTabSchemeHandler: NSObject, WKURLSchemeHandler {
    public static let shared = BrowserNewTabSchemeHandler()
    public static let newTabURL = URL(string: "surffish://newtab/")!
    private let activeTaskLock = NSLock()
    private var activeTaskIDs = Set<ObjectIdentifier>()

    private override init() { super.init() }

    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)
        activeTaskLock.lock()
        activeTaskIDs.insert(taskID)
        activeTaskLock.unlock()

        Task { @MainActor in
            guard self.isTaskActive(taskID) else { return }
            guard let url = urlSchemeTask.request.url,
                  url.host == "newtab" || url.path == "/newtab" else {
                urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
                self.finishTask(taskID)
                return
            }
            let isPrivateTab = TabManager.shared.tabs.first(where: { $0.webView === webView })?.isPrivate ?? false
            let html = Self.pageHTML(includeHistory: !isPrivateTab)
            let data = Data(html.utf8)
            let response = URLResponse(
                url: url,
                mimeType: "text/html",
                expectedContentLength: data.count,
                textEncodingName: "utf-8"
            )
            guard self.isTaskActive(taskID) else { return }
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
            self.finishTask(taskID)
        }
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        finishTask(ObjectIdentifier(urlSchemeTask as AnyObject))
    }

    private func isTaskActive(_ id: ObjectIdentifier) -> Bool {
        activeTaskLock.lock()
        defer { activeTaskLock.unlock() }
        return activeTaskIDs.contains(id)
    }

    private func finishTask(_ id: ObjectIdentifier) {
        activeTaskLock.lock()
        activeTaskIDs.remove(id)
        activeTaskLock.unlock()
    }

    @MainActor
    private static func pageHTML(includeHistory: Bool) -> String {
        let library = BrowserLibraryStore.shared
        let settings = BrowserSettingsStore.shared.settings
        let pinned = library.bookmarks.filter(\.isPinned)
        let fallbackBookmarks = library.bookmarks
        let recent = includeHistory ? recentHistory(from: library.history) : []
        let pinnedLinks = Array(pinned.prefix(8)).compactMap { SiteLink(title: $0.title, url: $0.url) }
        let bookmarkLinks = Array(fallbackBookmarks.prefix(8)).compactMap { SiteLink(title: $0.title, url: $0.url) }
        let sites: [SiteLink]
        let sectionTitle: String
        switch settings.newTabSiteSource {
        case .automatic where !pinnedLinks.isEmpty:
            sites = pinnedLinks
            sectionTitle = "Pinned sites"
        case .automatic where !recent.isEmpty:
            sites = Array(recent.prefix(8))
            sectionTitle = "Recently visited"
        case .automatic:
            sites = bookmarkLinks
            sectionTitle = sites.isEmpty ? "Your web, at a glance" : "Bookmarks"
        case .pinned:
            sites = pinnedLinks
            sectionTitle = "Pinned sites"
        case .recent:
            sites = Array(recent.prefix(8))
            sectionTitle = "Recently visited"
        case .bookmarks:
            sites = bookmarkLinks
            sectionTitle = "Bookmarks"
        case .custom:
            sites = Array(settings.customQuickLinks.prefix(12)).compactMap {
                SiteLink(title: $0.title, url: $0.url)
            }
            sectionTitle = "Your shortcuts"
        }
        let links = sites.map { site in
            let label = escapeHTML(site.title.isEmpty ? (site.url.host ?? site.url.absoluteString) : site.title)
            let host = escapeHTML(site.url.host ?? site.url.absoluteString)
            let initial = escapeHTML(String(label.first ?? "•").uppercased())
            let href = escapeHTML(site.url.absoluteString)
            return "<a class=\"site\" href=\"\(href)\"><span class=\"site-mark\" aria-hidden=\"true\">\(initial)</span><span class=\"site-copy\"><strong>\(label)</strong><small>\(host)</small></span></a>"
        }.joined(separator: "\n")
        let emptyMessage = settings.newTabSiteSource == .custom
            ? "Add custom shortcuts in Settings → Appearance to see them here."
            : "Bookmark a page or visit a site and it will be easy to find here."
        let emptyState = sites.isEmpty
            ? "<p class=\"empty\">\(escapeHTML(emptyMessage))</p>"
            : ""
        let engine = settings.searchEngine
        let marker = "SURFFISHQUERYTOKEN"
        let searchPrefix = engine.searchURL(for: marker)?.absoluteString.replacingOccurrences(of: marker, with: "")
            ?? "https://duckduckgo.com/?q="
        let searchPrefixJSON = (try? JSONEncoder().encode(searchPrefix)).flatMap { String(data: $0, encoding: .utf8) }
            ?? "\"https://duckduckgo.com/?q=\""

        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <meta name="color-scheme" content="dark">
          <title>New Tab — Surffish</title>
          <style>
            :root { color-scheme: dark; font: 15px -apple-system, BlinkMacSystemFont, sans-serif; }
            * { box-sizing: border-box; }
            body { min-height: 100vh; margin: 0; display: grid; place-items: center; color: #f4f6fa;
              background: \(settings.newTabTheme.backgroundCSS); }
            main { width: min(760px, calc(100% - 40px)); padding: 52px 0 40px; }
            .brand { margin: 0 0 7px; color: #b8c4d6; font-size: 11px; font-weight: 700; letter-spacing: .24em; text-align: center; }
            #clock { margin: 0; font-size: clamp(58px, 10vw, 88px); font-weight: 300; letter-spacing: -.065em; text-align: center; font-variant-numeric: tabular-nums; }
            #date { margin: 4px 0 30px; color: #aeb9c8; font-size: 14px; text-align: center; }
            form { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 17px;
              border: 1px solid rgba(255,255,255,.13); border-radius: 16px; background: rgba(255,255,255,.075);
              box-shadow: 0 18px 55px rgba(0,0,0,.20); }
            form:focus-within { border-color: rgba(160,190,235,.52); background: rgba(255,255,255,.10); }
            form span { color: #aeb9c8; font-size: 18px; }
            input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; }
            input::placeholder { color: #aeb9c8; }
            section { margin-top: 39px; }
            h2 { margin: 0 0 14px; color: #aeb9c8; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
            .sites { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 9px; }
            .site { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 13px; border: 1px solid rgba(255,255,255,.08);
              border-radius: 13px; background: rgba(255,255,255,.045); color: inherit; text-decoration: none; transition: background .16s, transform .16s; }
            .site:hover { background: rgba(255,255,255,.10); transform: translateY(-1px); }
            .site-mark { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 34px; border-radius: 10px;
              background: linear-gradient(140deg, rgba(151,181,224,.32), rgba(91,118,157,.19)); color: #e2ebfa; font-size: 14px; font-weight: 600; }
            .site-copy { display: grid; min-width: 0; gap: 3px; }
            .site-copy strong, .site-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .site-copy strong { font-size: 13px; font-weight: 550; }
            .site-copy small, .empty { color: #aeb9c8; font-size: 11px; }
            .empty { margin: 0; padding: 18px; border: 1px dashed rgba(255,255,255,.13); border-radius: 13px; text-align: center; }
            footer { margin-top: 28px; color: rgba(205,216,232,.46); font-size: 11px; text-align: center; }
            @media (max-width: 520px) { main { padding-top: 32px; } .sites { grid-template-columns: 1fr; } }
          </style>
        </head>
        <body>
          <main>
            <p class="brand">SURFFISH</p>
            <h1 id="clock">--:--</h1>
            <p id="date"></p>
            <form id="search" role="search">
              <span aria-hidden="true">⌕</span>
              <input id="query" type="search" placeholder="Search the web or enter a URL" aria-label="Search the web" autocomplete="off" autofocus>
            </form>
            <section aria-label="\(escapeHTML(sectionTitle))">
              <h2>\(escapeHTML(sectionTitle))</h2>
              <div class="sites">\(links)\(emptyState)</div>
            </section>
            <footer>New Tab · Your profile, your browsing data</footer>
          </main>
          <script>
            const searchPrefix = \(searchPrefixJSON);
            const clock = document.getElementById('clock');
            const date = document.getElementById('date');
            const query = document.getElementById('query');
            function updateClock() {
              const now = new Date();
              clock.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now);
              date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
            }
            updateClock(); setInterval(updateClock, 30000);
            document.getElementById('search').addEventListener('submit', event => {
              event.preventDefault();
              const value = query.value.trim();
              if (!value) return;
              if (/^(https?:\\/\\/|webkit-extension:\\/\\/)/i.test(value)) { location.href = value; return; }
              if (/^[^\\s]+\\.[^\\s]+$/.test(value)) { location.href = 'https://' + value; return; }
              location.href = searchPrefix + encodeURIComponent(value);
            });
          </script>
        </body>
        </html>
        """
    }

    @MainActor
    private static func recentHistory(from entries: [BrowserHistoryEntry]) -> [SiteLink] {
        var seenHosts = Set<String>()
        return entries.compactMap { entry in
            guard let site = SiteLink(title: entry.title, url: entry.url),
                  let host = site.url.host?.lowercased(),
                  seenHosts.insert(host).inserted else { return nil }
            return site
        }
    }

    private static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}

private struct SiteLink {
    let title: String
    let url: URL

    init?(title: String, url: String) {
        guard let parsed = URL(string: url),
              let scheme = parsed.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else { return nil }
        self.title = title
        self.url = parsed
    }
}
