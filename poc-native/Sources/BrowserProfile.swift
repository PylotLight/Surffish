import Foundation

public enum BrowserProfile: String, CaseIterable {
    case development
    case production

    public static let current: BrowserProfile = {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--profile"),
           arguments.indices.contains(index + 1),
           let profile = BrowserProfile(rawValue: arguments[index + 1].lowercased()) {
            return profile
        }
        if let value = ProcessInfo.processInfo.environment["SURFFISH_PROFILE"]?.lowercased(),
           let profile = BrowserProfile(rawValue: value) {
            return profile
        }
        return .production
    }()

    public var displayName: String {
        switch self {
        case .development: return "Development"
        case .production: return "Production"
        }
    }

    public var directoryName: String { displayName }

    public var applicationSupportDirectory: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return support
            .appendingPathComponent("SurffishNative", isDirectory: true)
            .appendingPathComponent("Profiles", isDirectory: true)
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    public func fileURL(_ filename: String) -> URL {
        applicationSupportDirectory.appendingPathComponent(filename)
    }
}
