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
        if let value = Bundle.main.object(forInfoDictionaryKey: "SurffishProfile") as? String,
           let profile = BrowserProfile(rawValue: value.lowercased()) {
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

    public var websiteDataStoreIdentifier: UUID {
        switch self {
        case .development:
            return UUID(uuidString: "D9D2C03A-9E57-4A0D-9F11-6F36A4D2A001")!
        case .production:
            return UUID(uuidString: "A4B7D10E-2C91-4F63-8B25-9E73C0D5B002")!
        }
    }
}
