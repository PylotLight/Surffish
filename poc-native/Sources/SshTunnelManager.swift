import AppKit
import Darwin
import Network

@MainActor
public final class SshTunnelManager {
    public static let shared = SshTunnelManager()

    public private(set) var status = "Not configured"
    public private(set) var proxyPort: UInt16?
    public var onStatusChange: ((String) -> Void)?

    private let executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
    private var process: Process?
    private var stderrPipe: Pipe?
    private var stderrText = ""
    private var target = ""
    private var enabled = false
    private var generation = 0
    private var reconnectTask: Task<Void, Never>?

    private let startupTimeout: TimeInterval = 8
    private let stopTimeout: TimeInterval = 1

    private init() {}

    public func configure(enabled: Bool, target: String) async {
        self.enabled = enabled
        self.target = target.trimmingCharacters(in: .whitespacesAndNewlines)
        generation += 1
        reconnectTask?.cancel()
        reconnectTask = nil
        await stopProcess()

        guard enabled else {
            proxyPort = nil
            applyProxyToBrowserStores(port: nil)
            TabManager.shared.reloadAllTabs()
            updateStatus("SOCKS5 proxy disabled")
            return
        }

        guard !self.target.isEmpty else {
            proxyPort = 1
            applyProxyToBrowserStores(port: 1)
            updateStatus("Enter an SSH host alias or user@host · traffic remains blocked")
            return
        }

        await startTunnel(generation: generation)
    }

    public func stop() async {
        enabled = false
        generation += 1
        reconnectTask?.cancel()
        reconnectTask = nil
        await stopProcess()
        proxyPort = nil
        applyProxyToBrowserStores(port: nil)
        TabManager.shared.reloadAllTabs()
        updateStatus("Stopped")
    }

    private func startTunnel(generation runID: Int) async {
        guard enabled, runID == generation else { return }
        updateStatus("Connecting to \(target)…")

        do {
            let port = try Self.allocateLoopbackPort()
            proxyPort = port

            // Install the proxy before launching SSH. If the tunnel fails, WebKit continues
            // pointing at this loopback endpoint and cannot silently fall back to a direct route.
            applyProxyToBrowserStores(port: port)
            TabManager.shared.reloadAllTabs()

            let child = Process()
            child.executableURL = executableURL
            child.arguments = [
                "-N",
                "-D", "127.0.0.1:\(port)",
                "-o", "ExitOnForwardFailure=yes",
                "-o", "BatchMode=yes",
                "-o", "ServerAliveInterval=30",
                "-o", "ServerAliveCountMax=3",
                "--", target
            ]
            child.environment = Self.sshEnvironment()

            let pipe = Pipe()
            child.standardError = pipe
            child.standardOutput = FileHandle.nullDevice
            stderrPipe = pipe
            stderrText = ""
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    handle.readabilityHandler = nil
                    return
                }
                guard let output = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.stderrText = String((self.stderrText + output).suffix(4_000))
                }
            }

            child.terminationHandler = { [weak self] terminated in
                Task { @MainActor [weak self] in
                    guard let self, runID == self.generation, self.enabled else { return }
                    let detail = self.stderrText
                        .split(separator: "\n")
                        .map(String.init)
                        .filter { !$0.hasPrefix("debug") && !$0.isEmpty }
                        .suffix(2)
                        .joined(separator: " ")
                    self.updateStatus(detail.isEmpty
                        ? "SSH tunnel exited (code \(terminated.terminationStatus))"
                        : "SSH tunnel exited: \(detail)")
                    if Self.shouldRetry(detail) {
                        self.scheduleReconnect(generation: runID)
                    }
                }
            }

            try child.run()
            process = child

            let deadline = Date().addingTimeInterval(startupTimeout)
            while Date() < deadline {
                guard runID == generation, enabled else { return }
                if child.isRunning {
                    let listening = await Self.isListening(port: port)
                    if listening {
                        updateStatus("Connected · 127.0.0.1:\(port)")
                        TabManager.shared.reloadAllTabs()
                        return
                    }
                }
                if !child.isRunning {
                    let detail = stderrText
                        .split(separator: "\n")
                        .map(String.init)
                        .filter { !$0.hasPrefix("debug") && !$0.isEmpty }
                        .suffix(2)
                        .joined(separator: " ")
                    updateStatus(detail.isEmpty ? "SSH exited before opening the SOCKS5 port" : detail)
                    if Self.shouldRetry(detail) {
                        scheduleReconnect(generation: runID)
                    }
                    return
                }
                try? await Task.sleep(for: .milliseconds(100))
            }

            updateStatus("SSH did not open the SOCKS5 port within 8 seconds")
            child.terminate()
            scheduleReconnect(generation: runID)
        } catch {
            updateStatus(error.localizedDescription)
            scheduleReconnect(generation: runID)
        }
    }

    private func scheduleReconnect(generation runID: Int) {
        guard enabled, runID == generation else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, let self, runID == self.generation, self.enabled else { return }
            await self.stopProcess()
            await self.startTunnel(generation: runID)
        }
    }

    private func stopProcess() async {
        guard let child = process else { return }
        process = nil
        child.terminationHandler = nil
        if child.isRunning {
            child.terminate()
            let deadline = Date().addingTimeInterval(stopTimeout)
            while child.isRunning && Date() < deadline {
                try? await Task.sleep(for: .milliseconds(50))
            }
            if child.isRunning {
                _ = Darwin.kill(child.processIdentifier, SIGKILL)
            }
        }
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe = nil
    }

    private static func shouldRetry(_ detail: String) -> Bool {
        let message = detail.lowercased()
        let permanentFailures = [
            "host key verification failed",
            "permission denied",
            "bad configuration option",
            "bad owner or permissions",
            "invalid format",
            "no such identity",
            "too many authentication failures"
        ]
        return !permanentFailures.contains(where: { message.contains($0) })
    }

    private func applyProxyToBrowserStores(port: UInt16?) {
        WebKitProxyController.apply(port: port)
        TabManager.shared.applyProxyConfiguration(port: port)
    }

    private func updateStatus(_ value: String) {
        status = value
        onStatusChange?(value)
        NSLog("[SSH] %@", value)
    }

    private static func sshEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let paths = [
            "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
            "/bin", "/usr/sbin", "/sbin"
        ]
        let existing = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
        environment["PATH"] = (existing + paths.filter { !existing.contains($0) }).joined(separator: ":")

        if environment["SSH_AUTH_SOCK"] == nil,
           let socket = launchdEnvironmentValue("SSH_AUTH_SOCK") {
            environment["SSH_AUTH_SOCK"] = socket
        }
        return environment
    }

    private static func launchdEnvironmentValue(_ key: String) -> String? {
        let command = Process()
        command.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        command.arguments = ["getenv", key]
        let output = Pipe()
        command.standardOutput = output
        command.standardError = FileHandle.nullDevice
        do {
            try command.run()
            command.waitUntilExit()
            guard command.terminationStatus == 0 else { return nil }
            let value = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return value?.isEmpty == false ? value : nil
        } catch {
            return nil
        }
    }

    private static func allocateLoopbackPort() throws -> UInt16 {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        defer { close(descriptor) }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindResult = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }

        var assigned = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let result = withUnsafeMutablePointer(to: &assigned) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(descriptor, $0, &length)
            }
        }
        guard result == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        return UInt16(bigEndian: assigned.sin_port)
    }

    private static func isListening(port: UInt16) async -> Bool {
        await withCheckedContinuation { continuation in
            let connection = NWConnection(
                to: .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port)!),
                using: .tcp
            )
            let lock = NSLock()
            var completed = false
            let finish: (Bool) -> Void = { result in
                lock.lock()
                guard !completed else { lock.unlock(); return }
                completed = true
                lock.unlock()
                connection.cancel()
                continuation.resume(returning: result)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready: finish(true)
                case .failed: finish(false)
                default: break
                }
            }
            connection.start(queue: .global(qos: .utility))
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
                finish(false)
            }
        }
    }
}
