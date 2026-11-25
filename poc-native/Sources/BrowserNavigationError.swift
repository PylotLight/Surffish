import Foundation

public struct BrowserNavigationError: Identifiable, Equatable {
    public let id: UUID
    public let url: URL?
    public let title: String
    public let message: String
    public let symbolName: String

    public init(
        id: UUID = UUID(),
        url: URL?,
        title: String,
        message: String,
        symbolName: String = "exclamationmark.icloud"
    ) {
        self.id = id
        self.url = url
        self.title = title
        self.message = message
        self.symbolName = symbolName
    }

    public static func from(_ error: Error, fallbackURL: URL?) -> BrowserNavigationError? {
        let nsError = error as NSError
        guard nsError.domain != NSURLErrorDomain || nsError.code != NSURLErrorCancelled else {
            return nil
        }

        let failedURL = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL)
            ?? (nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String).flatMap { URL(string: $0) }
            ?? fallbackURL

        let title: String
        let message: String
        let symbolName: String

        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost:
                title = "You’re offline"
                message = "Check your network connection, then try again."
                symbolName = "wifi.slash"
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
                title = "Server not found"
                message = "Check the address or your network connection."
                symbolName = "network.slash"
            case NSURLErrorCannotConnectToHost, NSURLErrorTimedOut:
                title = "Can’t reach this site"
                message = "The server didn’t respond. Try again in a moment."
                symbolName = "bolt.horizontal.circle"
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted:
                title = "Secure connection failed"
                message = "Surffish couldn’t verify a secure connection, so the page wasn’t opened."
                symbolName = "lock.trianglebadge.exclamationmark"
            default:
                title = "This page couldn’t be loaded"
                message = "Check the address and connection, then try again."
                symbolName = "exclamationmark.icloud"
            }
        } else {
            title = "This page couldn’t be loaded"
            message = "Check the address and connection, then try again."
            symbolName = "exclamationmark.icloud"
        }

        return BrowserNavigationError(
            url: failedURL,
            title: title,
            message: message,
            symbolName: symbolName
        )
    }

    public static func webContentProcessTerminated(url: URL?) -> BrowserNavigationError {
        BrowserNavigationError(
            url: url,
            title: "This tab stopped unexpectedly",
            message: "The page process ended before it could finish. Reload the page to continue.",
            symbolName: "exclamationmark.arrow.trianglehead.2.clockwise.rotate.90"
        )
    }

    public var siteName: String? {
        url?.host
    }
}
