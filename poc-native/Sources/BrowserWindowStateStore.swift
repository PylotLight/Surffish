import AppKit
import Foundation

public struct BrowserWindowFrame: Codable, Equatable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(_ frame: NSRect) {
        x = Double(frame.origin.x)
        y = Double(frame.origin.y)
        width = Double(frame.size.width)
        height = Double(frame.size.height)
    }

    public var rect: NSRect {
        NSRect(x: CGFloat(x), y: CGFloat(y), width: CGFloat(width), height: CGFloat(height))
    }

    public var isValid: Bool {
        [x, y, width, height].allSatisfy(\.isFinite)
            && abs(x) <= 1_000_000
            && abs(y) <= 1_000_000
            && width > 0
            && height > 0
            && width <= 100_000
            && height <= 100_000
    }
}

public struct SavedBrowserWindowState: Codable, Equatable {
    public let version: Int
    public let frame: BrowserWindowFrame
    public let isZoomed: Bool

    public init(frame: NSRect, isZoomed: Bool) {
        version = 1
        self.frame = BrowserWindowFrame(frame)
        self.isZoomed = isZoomed
    }
}

public struct BrowserWindowRestoration {
    public let frame: NSRect
    public let isZoomed: Bool

    public init(frame: NSRect, isZoomed: Bool) {
        self.frame = frame
        self.isZoomed = isZoomed
    }
}

@MainActor
public final class BrowserWindowStateStore {
    public static let shared = BrowserWindowStateStore()

    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()
    private let minimumWindowSize = NSSize(width: 860, height: 540)

    private init() {
        let directory = BrowserProfile.current.applicationSupportDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        fileURL = BrowserProfile.current.fileURL("browser-window-state.json")
        encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    public func load() -> SavedBrowserWindowState? {
        guard let data = try? Data(contentsOf: fileURL),
              let state = try? decoder.decode(SavedBrowserWindowState.self, from: data),
              state.version == 1,
              state.frame.isValid else {
            return nil
        }
        return state
    }

    public func save(frame: NSRect, isZoomed: Bool) {
        let state = SavedBrowserWindowState(frame: frame, isZoomed: isZoomed)
        guard state.frame.isValid else { return }

        do {
            let data = try encoder.encode(state)
            if let previous = try? Data(contentsOf: fileURL), previous == data { return }
            try FileManager.default.createDirectory(
                at: BrowserProfile.current.applicationSupportDirectory,
                withIntermediateDirectories: true
            )
            try data.write(to: fileURL, options: .atomic)
        } catch {
            NSLog("[Window] Could not save browser window state: %@", error.localizedDescription)
        }
    }

    public func restoration(
        fallbackFrame: NSRect,
        screens: [NSScreen] = NSScreen.screens
    ) -> BrowserWindowRestoration {
        let safeFallback = fit(fallbackFrame, to: screens) ?? fallbackFrame
        guard let saved = load(),
              let fitted = fit(saved.frame.rect, to: screens) else {
            return BrowserWindowRestoration(frame: safeFallback, isZoomed: false)
        }
        return BrowserWindowRestoration(frame: fitted, isZoomed: saved.isZoomed)
    }

    private func fit(_ candidate: NSRect, to screens: [NSScreen]) -> NSRect? {
        guard BrowserWindowFrame(candidate).isValid else { return nil }

        var bestVisibleFrame: NSRect?
        var bestOverlapArea: CGFloat = 0
        for screen in screens {
            let visibleFrame = screen.visibleFrame
            let intersection = NSIntersectionRect(candidate, visibleFrame)
            let overlapArea = max(0, intersection.width) * max(0, intersection.height)
            if overlapArea > bestOverlapArea {
                bestVisibleFrame = visibleFrame
                bestOverlapArea = overlapArea
            }
        }

        let minimumVisibleArea = min(candidate.width, 120) * min(candidate.height, 40)
        guard let visibleFrame = bestVisibleFrame,
              bestOverlapArea >= minimumVisibleArea else {
            return nil
        }

        let width = min(max(candidate.width, min(minimumWindowSize.width, visibleFrame.width)), visibleFrame.width)
        let height = min(max(candidate.height, min(minimumWindowSize.height, visibleFrame.height)), visibleFrame.height)
        let x = min(max(candidate.minX, visibleFrame.minX), visibleFrame.maxX - width)
        let y = min(max(candidate.minY, visibleFrame.minY), visibleFrame.maxY - height)
        return NSRect(x: x, y: y, width: width, height: height)
    }
}
