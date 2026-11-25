import AppKit
import Darwin
import Network

@MainActor
public final class SshTunnelManager {
    public static let shared = SshTunnelManager()

    public private(set) var status = "Not configured"
    public private(set) var diagnosticsText = "SSH diagnostics will appear here after saving the connection settings."
    public var onDiagnosticsChange: ((String) -> Void)?
    public private(set) var proxyPort: UInt16?
    public var browserProxyPort: UInt16? { browserEnabled ? proxyPort : nil }
    public var onStatusChange: ((String) -> Void)?

    private let executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
    private var process: Process?
    private var stderrPipe: Pipe?
    private var stderrText = ""
    private var target = ""
    private var enabled = false
    private var browserEnabled = false
    private var bindAddress = "127.0.0.1"
    private var configuredPort: UInt16 = 1080
    private var generation = 0
    private var reconnectAttempt = 0
    private var hasReloadedTabsForCurrentConfiguration = false
    private var hasAppliedProxyConfiguration = false
    private var appliedBrowserProxyPort: UInt16?
    private var reconnectTask: Task<Void, Never>?

    private let startupTimeout: TimeInterval = 20
    private let stopTimeout: TimeInterval = 1

    private init() {}

    public func configure(
        browserEnabled: Bool,
        serverEnabled: Bool,
        target: String,
        port: Int,
        bindAddress: String
    ) async {
        self.browserEnabled = browserEnabled
        self.enabled = browserEnabled || serverEnabled
        self.target = target.trimmingCharacters(in: .whitespacesAndNewlines)
        self.bindAddress = serverEnabled ? bindAddress : "127.0.0.1"
        diagnosticsText = "Target: \(self.target)\nSSH executable: /usr/bin/ssh\nSOCKS5 listener: \(self.bindAddress):\(port)\n\nStarting OpenSSH with verbose connection diagnostics…"
        onDiagnosticsChange?(diagnosticsText)
        guard (1...65535).contains(port), let validPort = UInt16(exactly: port) else {
            generation += 1
            reconnectTask?.cancel()
            reconnectTask = nil
            await stopProcess()
            proxyPort = browserEnabled ? 1 : nil
            applyProxyToBrowserStores(port: browserEnabled ? 1 : nil)
            TabManager.shared.reloadAllTabs()
            updateStatus("SOCKS5 port must be between 1 and 65535 · browser traffic remains blocked")
            return
        }
        self.configuredPort = validPort
        generation += 1
        reconnectAttempt = 0
        hasReloadedTabsForCurrentConfiguration = false
        reconnectTask?.cancel()
        reconnectTask = nil
        await stopProcess()

        guard self.enabled else {
            proxyPort = nil
            applyProxyToBrowserStores(port: nil)
            TabManager.shared.reloadAllTabs()
            updateStatus("SOCKS5 proxy disabled")
            return
        }

        guard !self.target.isEmpty else {
            proxyPort = browserEnabled ? 1 : nil
            applyProxyToBrowserStores(port: browserEnabled ? 1 : nil)
            updateStatus("Enter an SSH host alias or user@host")
            return
        }
        guard Self.isValidTarget(self.target) else {
            proxyPort = browserEnabled ? 1 : nil
            applyProxyToBrowserStores(port: browserEnabled ? 1 : nil)
            updateStatus("Invalid SSH target · use one host alias or user@host")
            return
        }
        guard ["127.0.0.1", "0.0.0.0"].contains(bindAddress) else {
            proxyPort = browserEnabled ? 1 : nil
            applyProxyToBrowserStores(port: browserEnabled ? 1 : nil)
            updateStatus("SOCKS5 bind address must be 127.0.0.1 or 0.0.0.0 · browser traffic remains blocked")
            return
        }

        await startTunnel(generation: generation)
    }

    public func shutdown() {
        enabled = false
        generation += 1
        reconnectTask?.cancel()
        reconnectTask = nil
        process?.terminationHandler = nil
        if let child = process, child.isRunning {
            child.terminate()
            if child.isRunning {
                _ = Darwin.kill(child.processIdentifier, SIGKILL)
            }
        }
        process = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe = nil
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
            let port = configuredPort
            proxyPort = port

            // Trigger Local Network privacy from the Surffish process itself.
            // A child /usr/bin/ssh process is not a reliable way to attribute the
            // macOS permission request to this app.
            if let endpoint = try Self.resolveDirectPrivateEndpoint(target) {
                appendDiagnostics("Checking this app's Local Network access to \(endpoint.host):\(endpoint.port)…\n")
                do {
                    try await Self.preflightLocalNetworkAccess(host: endpoint.host, port: endpoint.port)
                    appendDiagnostics("Local Network preflight succeeded.\n")
                } catch {
                    updateStatus("Local Network access check failed: \(error.localizedDescription)")
                    appendDiagnostics("Local Network preflight failed: \(error.localizedDescription)\n")
                    DeveloperConsole.shared.record(
                        level: "ERROR",
                        source: "SSH",
                        message: "Surffish could not open a direct local-network connection to \(endpoint.host):\(endpoint.port): \(error.localizedDescription)"
                    )
                    return
                }
            }

            // Install the proxy before launching SSH. If the tunnel fails, WebKit continues
            // pointing at this loopback endpoint and cannot silently fall back to a direct route.
            applyProxyToBrowserStores(port: browserEnabled ? port : nil)
            let child = Process()
            child.executableURL = executableURL
            child.arguments = (bindAddress == "0.0.0.0" ? ["-g"] : []) + [
                "-vvv",
                "-N",
                "-D", "\(bindAddress):\(port)",
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
                    self.stderrText = String((self.stderrText + output).suffix(12_000))
                    self.appendDiagnostics(output)
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
                    let failureHint = detail.localizedCaseInsensitiveContains("No route to host")
                        ? "macOS reports no route to the SSH host. Check this app's Local Network permission and confirm the host is reachable from this Mac."
                        : detail
                    self.updateStatus(failureHint.isEmpty
                        ? "SSH tunnel exited (code \(terminated.terminationStatus))"
                        : "SSH tunnel exited: \(failureHint)")
                    self.appendDiagnostics("\nSSH process exited with code \(terminated.terminationStatus).\n")
                    DeveloperConsole.shared.record(
                        level: "ERROR",
                        source: "SSH",
                        message: "SSH process exited with code \(terminated.terminationStatus). \(self.stderrText.suffix(8_000))"
                    )
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
                    // OpenSSH creates the local -D listener before the remote SSH
                    // connection is authenticated. Require both signals before readiness.
                    let authenticated = stderrText.localizedCaseInsensitiveContains("Authenticated to ")
                    if authenticated {
                        let listening = await Self.isListening(port: port)
                        if listening {
                            reconnectAttempt = 0
                            updateStatus("SSH authenticated · SOCKS5 ready · \(bindAddress):\(port) via \(target)")
                            if browserEnabled && !hasReloadedTabsForCurrentConfiguration {
                                TabManager.shared.reloadAllTabs()
                                hasReloadedTabsForCurrentConfiguration = true
                            }
                            return
                        }
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
                    DeveloperConsole.shared.record(level: "ERROR", source: "SSH", message: "SSH exited before opening SOCKS5. \(stderrText.suffix(8_000))")
                    if Self.shouldRetry(detail) {
                        scheduleReconnect(generation: runID)
                    }
                    return
                }
                try? await Task.sleep(for: .milliseconds(100))
            }

            updateStatus("SSH did not authenticate and open the SOCKS5 port within 20 seconds")
            appendDiagnostics("\nTimed out waiting for SSH authentication and the local SOCKS5 listener. The local -D socket alone is not proof that the SSH tunnel is connected.\n")
            DeveloperConsole.shared.record(level: "ERROR", source: "SSH", message: "Timed out waiting for SSH authentication and SOCKS5 listener. \(stderrText.suffix(8_000))")
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
        let delays: [Double] = [1, 2, 5, 10, 20, 30]
        let delay = delays[min(reconnectAttempt, delays.count - 1)]
        reconnectAttempt += 1
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self, runID == self.generation, self.enabled else { return }
            await self.stopProcess()
            await self.startTunnel(generation: runID)
        }
    }

    private func stopProcess() async {
        guard let child = process else {
            stderrPipe?.fileHandleForReading.readabilityHandler = nil
            stderrPipe = nil
            return
        }
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

    private static func isValidTarget(_ value: String) -> Bool {
        guard !value.isEmpty, value.utf8.count <= 255,
              let first = value.unicodeScalars.first,
              CharacterSet.alphanumerics.contains(first) else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._@%+:-[]")
        return value.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func shouldRetry(_ detail: String) -> Bool {
        let message = detail.lowercased()
        let permanentFailures = [
            "host key verification failed",
            "remote host identification has changed",
            "no matching host key type found",
            "no matching key exchange method found",
            "no matching cipher found",
            "permission denied",
            "bad configuration option",
            "bad owner or permissions",
            "invalid format",
            "no such identity",
            "too many authentication failures",
            "address already in use",
            "cannot listen to port",
            "could not request local forwarding",
            "administratively prohibited"
        ]
        return !permanentFailures.contains(where: { message.contains($0) })
    }

    private func applyProxyToBrowserStores(port: UInt16?) {
        let browserPort = browserEnabled ? port : nil
        guard !hasAppliedProxyConfiguration || appliedBrowserProxyPort != browserPort else { return }
        WebKitProxyController.apply(port: browserPort)
        TabManager.shared.applyProxyConfiguration(port: browserPort)
        appliedBrowserProxyPort = browserPort
        hasAppliedProxyConfiguration = true
    }

    private func appendDiagnostics(_ value: String) {
        diagnosticsText = String((diagnosticsText + value).suffix(16_000))
        onDiagnosticsChange?(diagnosticsText)
    }

    private func updateStatus(_ value: String) {
        status = value
        onStatusChange?(value)
        let level = value.localizedCaseInsensitiveContains("ready") ? "INFO"
            : (value.localizedCaseInsensitiveContains("connect") || value.localizedCaseInsensitiveContains("disabled") ? "INFO" : "ERROR")
        DeveloperConsole.shared.record(level: level, source: "SSH", message: value)
        appendDiagnostics("\n[\(Date())] \(value)\n")
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

        if environment["SSH_AUTH_SOCK"]?.isEmpty != false,
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

    private static func resolveDirectPrivateEndpoint(_ target: String) throws -> (host: String, port: UInt16)? {
        let command = Process()
        command.executableURL = URL(fileURLWithPath: "/usr/bin/ssh")
        command.arguments = ["-G", "--", target]
        command.environment = sshEnvironment()
        let output = Pipe()
        command.standardOutput = output
        command.standardError = FileHandle.nullDevice
        try command.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        command.waitUntilExit()
        guard command.terminationStatus == 0,
              let text = String(data: data, encoding: .utf8) else {
            return nil
        }

        var values: [String: String] = [:]
        for line in text.split(separator: "\n") {
            let parts = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard parts.count == 2 else { continue }
            values[String(parts[0]).lowercased()] = String(parts[1])
        }

        // Do not probe through a jump host or proxy command; OpenSSH owns those routes.
        guard (values["proxyjump"] ?? "none").lowercased() == "none",
              (values["proxycommand"] ?? "none").lowercased() == "none",
              let host = values["hostname"], !host.isEmpty,
              let portText = values["port"],
              let portValue = UInt16(portText), portValue > 0 else {
            return nil
        }

        let octets = host.split(separator: ".").compactMap { UInt8(String($0)) }
        guard octets.count == 4 else { return nil }
        let isPrivate =
            octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 169 && octets[1] == 254)
        return isPrivate ? (host, portValue) : nil
    }

    private static func preflightLocalNetworkAccess(host: String, port: UInt16) async throws {
        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(domain: "SurffishSSH", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Invalid SSH destination port \(port)."
            ])
        }
        let connection = NWConnection(
            to: .hostPort(host: NWEndpoint.Host(host), port: endpointPort),
            using: .tcp
        )
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let lock = NSLock()
            var completed = false
            let finish: (Error?) -> Void = { error in
                lock.lock()
                guard !completed else { lock.unlock(); return }
                completed = true
                lock.unlock()
                connection.cancel()
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(nil)
                case .failed(let error):
                    finish(error)
                case .cancelled:
                    finish(NSError(domain: "SurffishSSH", code: 2, userInfo: [
                        NSLocalizedDescriptionKey: "The local-network connection was cancelled."
                    ]))
                default:
                    break
                }
            }
            connection.start(queue: .global(qos: .utility))
            DispatchQueue.global().asyncAfter(deadline: .now() + 6) {
                finish(NSError(domain: "SurffishSSH", code: 3, userInfo: [
                    NSLocalizedDescriptionKey: "Timed out waiting for macOS Local Network access to \(host):\(port)."
                ]))
            }
        }
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
