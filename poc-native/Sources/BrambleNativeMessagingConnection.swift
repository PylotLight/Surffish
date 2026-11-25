import Foundation
import Network
import WebKit

/// Bridges Bramble's WebExtension native-messaging port directly to the local
/// Unix-domain socket opened by the Bramble desktop app.
///
/// Bramble's wire format is a 4-byte little-endian payload length followed by
/// one JSON value. The desktop app uses the same framing on bramble.sock.
@MainActor
final class BrambleNativeMessagingConnection {
    private static let maximumFrameSize = 1024 * 1024
    private static let errorDomain = "SurffishBrambleNativeMessaging"

    private let port: WKWebExtension.MessagePort
    private let queue = DispatchQueue(label: "app.surffish.bramble-native-messaging")
    private let connection: NWConnection
    private var didCompleteStart = false
    private var isClosed = false

    var onDisconnect: (() -> Void)?

    init(port: WKWebExtension.MessagePort) {
        self.port = port

        let socketURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/app.bramble.desktop/bramble.sock")
        connection = NWConnection(to: .unix(path: socketURL.path), using: .tcp)

        port.messageHandler = { [weak self] message, error in
            Task { @MainActor in
                guard let self, !self.isClosed else { return }
                if let error {
                    self.fail(error)
                    return
                }
                self.send(message ?? NSNull())
            }
        }

        port.disconnectHandler = { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    DeveloperConsole.shared.record(level: "WARN", source: "Native Messaging · Bramble", message: "Extension port disconnected: \(error.localizedDescription)")
                }
                self.close()
            }
        }
    }

    func start(completion: @escaping (Error?) -> Void) {
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self, !self.isClosed else { return }
                switch state {
                case .ready:
                    guard !self.didCompleteStart else { return }
                    self.didCompleteStart = true
                    completion(nil)
                    self.receiveNextFrame()
                case .failed(let error):
                    if !self.didCompleteStart {
                        self.didCompleteStart = true
                        completion(error)
                    } else {
                        self.fail(error)
                    }
                case .cancelled:
                    if !self.didCompleteStart {
                        self.didCompleteStart = true
                        completion(Self.makeError(2, "The Bramble desktop socket closed before connecting."))
                    }
                default:
                    break
                }
            }
        }
        connection.start(queue: queue)
    }

    private func send(_ message: Any) {
        guard !isClosed else { return }
        do {
            let body = try JSONSerialization.data(withJSONObject: message, options: [.fragmentsAllowed])
            guard body.count <= Self.maximumFrameSize else {
                throw Self.makeError(3, "Bramble message exceeds the 1 MiB native-messaging limit.")
            }

            var length = UInt32(body.count).littleEndian
            var frame = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
            frame.append(body)

            connection.send(content: frame, completion: .contentProcessed { [weak self] error in
                guard let error else { return }
                Task { @MainActor in self?.fail(error) }
            })
        } catch {
            fail(error)
        }
    }

    private func receiveNextFrame() {
        receiveExactly(4) { [weak self] header, error in
            guard let self else { return }
            if let error {
                Task { @MainActor in self.fail(error) }
                return
            }
            guard let header, header.count == 4 else {
                Task { @MainActor in self.fail(Self.makeError(4, "Bramble returned an incomplete message header.")) }
                return
            }

            let length = UInt32(header[0])
                | (UInt32(header[1]) << 8)
                | (UInt32(header[2]) << 16)
                | (UInt32(header[3]) << 24)

            guard length > 0, length <= Self.maximumFrameSize else {
                Task { @MainActor in self.fail(Self.makeError(5, "Bramble returned an invalid native-messaging frame length: \(length).")) }
                return
            }

            self.receiveExactly(Int(length)) { [weak self] body, bodyError in
                guard let self else { return }
                if let bodyError {
                    Task { @MainActor in self.fail(bodyError) }
                    return
                }
                guard let body else {
                    Task { @MainActor in self.fail(Self.makeError(6, "Bramble returned an empty message.")) }
                    return
                }

                do {
                    let message = try JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed])
                    Task { @MainActor [weak self] in
                        guard let self, !self.isClosed else { return }
                        do {
                            try await self.port.sendMessage(message)
                            guard !self.isClosed else { return }
                            self.receiveNextFrame()
                        } catch {
                            self.fail(error)
                        }
                    }
                } catch {
                    Task { @MainActor in self.fail(error) }
                }
            }
        }
    }

    /// Reads exactly the requested byte count, accounting for stream reads that
    /// return only part of a header or body.
    private func receiveExactly(
        _ count: Int,
        accumulated: Data = Data(),
        completion: @escaping (Data?, Error?) -> Void
    ) {
        guard !isClosed else {
            completion(nil, Self.makeError(7, "The Bramble native-messaging connection is closed."))
            return
        }
        let remaining = count - accumulated.count
        guard remaining > 0 else {
            completion(accumulated, nil)
            return
        }

        connection.receive(minimumIncompleteLength: 1, maximumLength: remaining) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            Task { @MainActor in
                guard !self.isClosed else {
                    completion(nil, Self.makeError(7, "The Bramble native-messaging connection is closed."))
                    return
                }
                var next = accumulated
                if let data, !data.isEmpty { next.append(data) }

                if next.count == count {
                    completion(next, nil)
                } else if let error {
                    completion(nil, error)
                } else if isComplete {
                    completion(nil, Self.makeError(8, "The Bramble desktop app closed the native-messaging socket."))
                } else if next.count == accumulated.count {
                    completion(nil, Self.makeError(9, "The Bramble desktop socket returned no data."))
                } else {
                    self.receiveExactly(count, accumulated: next, completion: completion)
                }
            }
        }
    }

    private func fail(_ error: Error) {
        guard !isClosed else { return }
        DeveloperConsole.shared.record(
            level: "ERROR",
            source: "Native Messaging · Bramble",
            message: error.localizedDescription
        )
        port.disconnect(throwing: error)
        close()
    }

    private func close() {
        guard !isClosed else { return }
        isClosed = true
        connection.stateUpdateHandler = nil
        connection.cancel()
        port.messageHandler = nil
        port.disconnectHandler = nil
        onDisconnect?()
        onDisconnect = nil
    }

    private static func makeError(_ code: Int, _ message: String) -> NSError {
        NSError(domain: errorDomain, code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
