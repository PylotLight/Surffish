import AppKit
import WebKit

@MainActor
public final class DeveloperConsole: NSObject, WKScriptMessageHandler {
    public static let shared = DeveloperConsole()

    private let handlerName = "surffishDeveloperConsole"
    private let maximumEntries = 1000
    private var installedControllers = NSHashTable<WKUserContentController>.weakObjects()
    private var extensionObservers: [NSObjectProtocol] = []
    private var previousExtensionErrors: [ObjectIdentifier: Set<String>] = [:]
    private var entries: [String] = []
    private var windowController: DeveloperConsoleWindowController?

    private override init() {
        super.init()
        loadSavedEntries()
    }

    public func install(on controller: WKUserContentController) {
        guard !installedControllers.contains(controller) else { return }
        installedControllers.add(controller)
        controller.add(self, name: handlerName)
        controller.addUserScript(WKUserScript(
            source: Self.pageErrorMonitor,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false,
            in: .page
        ))
    }

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let level = body["level"] as? String,
              let text = body["message"] as? String else { return }

        let pageURL = body["url"] as? String ?? message.webView?.url?.absoluteString ?? ""
        let frameHost = message.frameInfo.securityOrigin.host
        let source = (body["source"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (frameHost.isEmpty ? pageURL : frameHost)
        record(level: level.uppercased(), source: source, message: text)
    }

    public func observeExtension(_ context: WKWebExtensionContext, name: String) {
        let token = NotificationCenter.default.addObserver(
            forName: WKWebExtensionContext.errorsDidUpdateNotification,
            object: context,
            queue: .main
        ) { [weak self, weak context] _ in
            Task { @MainActor in
                guard let self, let context else { return }
                self.captureExtensionErrors(context, name: name)
            }
        }
        extensionObservers.append(token)
        captureExtensionErrors(context, name: name)
    }

    public func captureExtensionErrors(_ context: WKWebExtensionContext, name: String) {
        let identity = ObjectIdentifier(context)
        let current = Set(context.errors.map { $0.localizedDescription })
        let previous = previousExtensionErrors[identity] ?? []

        for description in current.subtracting(previous).sorted() {
            record(level: "ERROR", source: "Extension · \(name)", message: description)
        }
        previousExtensionErrors[identity] = current
    }

    public func record(level: String, source: String, message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let line = "\(timestamp)  [\(level)]  \(source)  \(message)"
        entries.append(line)
        if entries.count > maximumEntries {
            entries.removeFirst(entries.count - maximumEntries)
        }
        persistEntries()
        windowController?.setLogText(entries.joined(separator: "\n"))
        NSLog("[Surffish DevTools] %@", line)
    }

    public func recordNavigationFailure(url: URL?, error: Error, provisional: Bool) {
        let nsError = error as NSError
        let stage = provisional ? "Navigation / TLS" : "Navigation"
        let failingURL = nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String
        let target = failingURL ?? url?.absoluteString ?? "(unknown URL)"
        record(
            level: "ERROR",
            source: stage,
            message: "\(target) — \(nsError.domain) (\(nsError.code)): \(nsError.localizedDescription)"
        )
    }

    public func show() {
        if windowController == nil {
            windowController = DeveloperConsoleWindowController()
        }
        windowController?.setLogText(entries.joined(separator: "\n"))
        windowController?.showWindow(nil)
        windowController?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    fileprivate func clear() {
        entries.removeAll()
        persistEntries()
        windowController?.setLogText("")
    }

    fileprivate func copyAll() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(entries.joined(separator: "\n"), forType: .string)
    }

    private func loadSavedEntries() {
        let url = logURL
        guard let content = try? String(contentsOf: url, encoding: .utf8) else { return }
        entries = Array(content.components(separatedBy: .newlines).filter { !$0.isEmpty }.suffix(maximumEntries))
    }

    private func persistEntries() {
        let directory = logURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(entries.joined(separator: "\n").utf8).write(to: logURL, options: .atomic)
        } catch {
            NSLog("[Surffish DevTools] Could not save log: %@", error.localizedDescription)
        }
    }

    private var logURL: URL {
        BrowserProfile.current.applicationSupportDirectory
            .appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent("developer-console.log")
    }

    private static let pageErrorMonitor = #"""
    (() => {
      if (window.__surffishDeveloperConsoleInstalled) return;
      window.__surffishDeveloperConsoleInstalled = true;

      const bridge = window.webkit?.messageHandlers?.surffishDeveloperConsole;
      if (!bridge) return;

      const redact = (key, value) => {
        if (/(password|passwd|secret|token|private.?key|credential|authorization|cookie)/i.test(key)) {
          return "[REDACTED]";
        }
        return value;
      };

      const format = (value) => {
        try {
          if (value instanceof Error) return value.stack || (value.name + ": " + value.message);
          if (typeof value === "string") return value;
          const encoded = JSON.stringify(value, (key, item) => redact(key, item));
          return encoded === undefined ? String(value) : encoded;
        } catch {
          return String(value);
        }
      };

      const send = (level, values, source = "") => {
        try {
          const message = values.map(format).join(" ").slice(0, 8000);
          bridge.postMessage({
            level,
            message,
            source,
            url: location.href
          });
        } catch {}
      };

      for (const level of ["warn", "error"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
          send(level, args);
          original(...args);
        };
      }

      window.addEventListener("error", (event) => {
        const location = event.filename
          ? event.filename + ":" + (event.lineno || 0) + ":" + (event.colno || 0)
          : "";
        send("error", [event.message || "Uncaught JavaScript error", event.error || ""], location);
      }, true);

      window.addEventListener("unhandledrejection", (event) => {
        send("error", ["Unhandled promise rejection", event.reason || "No rejection reason"]);
      });
    })();
    """#
}

@MainActor
private final class DeveloperConsoleWindowController: NSWindowController {
    private let textView = NSTextView()

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 180, y: 140, width: 980, height: 420),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Surffish Developer Tools — Console"
        window.minSize = NSSize(width: 640, height: 260)
        super.init(window: window)
        buildInterface()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setLogText(_ text: String) {
        textView.string = text
        let end = (textView.string as NSString).length
        if end > 0 {
            textView.scrollRangeToVisible(NSRange(location: end, length: 0))
        }
    }

    private func buildInterface() {
        guard let content = window?.contentView else { return }

        let clearButton = NSButton(title: "Clear", target: self, action: #selector(clearLogs))
        clearButton.bezelStyle = .rounded
        let copyButton = NSButton(title: "Copy All", target: self, action: #selector(copyLogs))
        copyButton.bezelStyle = .rounded

        let toolbar = NSStackView(views: [clearButton, copyButton])
        toolbar.orientation = .horizontal
        toolbar.alignment = .centerY
        toolbar.spacing = 8
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(toolbar)

        textView.isEditable = false
        textView.isRichText = false
        textView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.textColor = .textColor
        textView.backgroundColor = NSColor(white: 0.08, alpha: 1)
        textView.textContainerInset = NSSize(width: 10, height: 10)

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .bezelBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(scrollView)

        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: content.topAnchor, constant: 10),
            toolbar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            toolbar.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -12),
            scrollView.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 8),
            scrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 10),
            scrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -10),
            scrollView.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -10)
        ])
    }

    @objc private func clearLogs() {
        DeveloperConsole.shared.clear()
    }

    @objc private func copyLogs() {
        DeveloperConsole.shared.copyAll()
    }
}
