import AppKit
import NativeCore
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@MainActor
private final class SockfishNativeAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // SwiftPM-launched SwiftUI executables can have a visible window without
        // becoming the active regular app. That leaves controls unable to accept
        // keyboard input and macOS beeps when the user types.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct SockfishNativeApp: App {
    @NSApplicationDelegateAdaptor(SockfishNativeAppDelegate.self) private var appDelegate
    @StateObject private var browser = NativeBrowserHarness()

    var body: some Scene {
        WindowGroup {
            NativeBrowserWindow(browser: browser)
                .frame(minWidth: 900, minHeight: 620)
        }
        .windowResizability(.contentSize)
    }
}

private struct NativeBrowserWindow: View {
    @ObservedObject var browser: NativeBrowserHarness
    @FocusState private var addressFieldFocused: Bool
    @State private var diagnosticsExpanded = true
    @State private var extensionsExpanded = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Button("Back", action: browser.goBack)
                        .disabled(!browser.webView.canGoBack)
                    Button("Forward", action: browser.goForward)
                        .disabled(!browser.webView.canGoForward)
                    Button("Reload", action: browser.reload)
                    TextField("Search Brave or enter an address", text: $browser.address)
                        .textFieldStyle(.roundedBorder)
                        .focused($addressFieldFocused)
                        .accessibilityIdentifier("address-search-field")
                        .onSubmit {
                            browser.navigate()
                            addressFieldFocused = false
                        }
                        .frame(maxWidth: .infinity)
                    Button("Go") {
                        browser.navigate()
                        addressFieldFocused = false
                    }
                }

                HStack(spacing: 8) {
                    Toggle("SOCKS5 · 127.0.0.1:1080", isOn: Binding(
                        get: { browser.proxyEnabled },
                        set: { browser.configureSOCKS5Proxy(enabled: $0) }
                    ))
                    .toggleStyle(.switch)
                    .controlSize(.small)

                    Button("Passkey APIs") {
                        Task { await browser.inspectPasskeyAPIs() }
                    }
                    Button("Add extension…", action: chooseExtension)

                    if !browser.loadedExtensions.isEmpty {
                        Divider().frame(height: 20)
                        Text("Actions")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(browser.loadedExtensions) { item in
                                    ExtensionActionButton(browser: browser, extensionID: item.id, name: item.name)
                                        .frame(height: 28)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Spacer(minLength: 0)
                    }
                }
            }
            .padding(10)

            Divider()

            WebViewHost(webView: browser.webView)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()

            VStack(alignment: .leading, spacing: 5) {
                DisclosureGroup("Installed extensions (\(browser.loadedExtensions.count))", isExpanded: $extensionsExpanded) {
                    if browser.loadedExtensions.isEmpty {
                        Text("No extensions loaded.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 4)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(browser.loadedExtensions) { item in
                                    HStack(alignment: .top, spacing: 8) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("\(item.name) · v\(item.version) · MV\(item.manifestVersion, specifier: "%.0f")")
                                                .font(.subheadline.weight(.medium))
                                            Text("Permissions: \(item.requestedPermissions.isEmpty ? "none declared" : item.requestedPermissions.joined(separator: ", "))")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text("Sites: \(item.requestedHostPatterns.isEmpty ? "none declared" : item.requestedHostPatterns.joined(separator: ", "))")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer(minLength: 8)
                                        Button("Load background") {
                                            Task { await browser.loadBackgroundContent(for: item) }
                                        }
                                        .help("Ask WebKit to force-load this extension’s on-demand background content")
                                        Button("Reload") {
                                            do {
                                                try browser.reloadExtension(item)
                                            } catch {
                                                browser.setStatus("Reload failed: \(error.localizedDescription)")
                                            }
                                        }
                                        .help("Restart this extension context without closing the browser window")
                                        Button("Unload") {
                                            do {
                                                try browser.uninstallExtension(item)
                                            } catch {
                                                browser.setStatus("Unload failed: \(error.localizedDescription)")
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .frame(maxHeight: 100)
                    }
                }
                .font(.caption.weight(.semibold))

                DisclosureGroup(isExpanded: $diagnosticsExpanded) {
                    if browser.extensionDiagnostics.isEmpty {
                        Text("No extensions loaded. Import one to view WebKit parse/runtime errors and popup failures.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 4)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(browser.extensionDiagnostics) { diagnostic in
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack {
                                            Text(diagnostic.extensionName)
                                                .font(.caption.weight(.semibold))
                                            Text(diagnostic.isLoaded ? "Loaded" : "Not loaded")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                            Spacer()
                                        }
                                        if diagnostic.messages.isEmpty {
                                            Text("No errors currently reported by WebKit for this extension context.")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        } else {
                                            ForEach(Array(diagnostic.messages.enumerated()), id: \.offset) { _, message in
                                                Text("• \(message)")
                                                    .font(.caption.monospaced())
                                                    .textSelection(.enabled)
                                                    .fixedSize(horizontal: false, vertical: true)
                                            }
                                        }
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .frame(maxHeight: 125)
                    }
                    Text("WebKit’s context errors include extension parse/runtime errors. A clean list is not proof of Chrome API parity or full extension health.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.top, 2)
                } label: {
                    HStack(spacing: 6) {
                        Text("Extension diagnostics (\(browser.extensionDiagnosticCount))")
                        Spacer()
                        Button("Refresh") { browser.refreshExtensionDiagnostics() }
                            .buttonStyle(.link)
                            .font(.caption)
                    }
                    .font(.caption.weight(.semibold))
                }

                Text(browser.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 2)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .onAppear {
            // Wait until SwiftUI has attached the window before requesting focus.
            // Setting FocusState earlier can be ignored when the app/window is not
            // key yet, which looks like a disabled address field to the user.
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
                if let window = NSApp.windows.first(where: \.isVisible) {
                    window.makeKeyAndOrderFront(nil)
                }
                addressFieldFocused = true
            }
        }
        .task {
            while !Task.isCancelled {
                browser.refreshExtensionDiagnostics()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func chooseExtension() {
        let panel = NSOpenPanel()
        panel.title = "Choose an extension folder, ZIP, or Safari app-extension bundle"
        panel.prompt = "Inspect and install"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.treatsFilePackagesAsDirectories = false
        panel.allowedContentTypes = [
            .zip,
            .folder,
            .application,
            UTType(filenameExtension: "appex") ?? .item
        ]
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                do {
                    _ = try await browser.installExtension(at: url)
                } catch NativePrototypeError.extensionWasDeclined {
                    browser.setStatus("Extension import cancelled.")
                } catch {
                    browser.setStatus("Extension load failed: \(error.localizedDescription)")
                }
            }
        }
    }
}

private struct ExtensionActionButton: NSViewRepresentable {
    @ObservedObject var browser: NativeBrowserHarness
    let extensionID: UUID
    let name: String

    func makeCoordinator() -> Coordinator {
        Coordinator(browser: browser, extensionID: extensionID, name: name)
    }

    func makeNSView(context: Context) -> NSButton {
        let button = NSButton(title: name, target: context.coordinator, action: #selector(Coordinator.activate(_:)))
        button.bezelStyle = .rounded
        button.imagePosition = .imageLeading
        button.imageScaling = .scaleProportionallyDown
        button.toolTip = "Open the \(name) extension action popup or dispatch its action"
        button.setAccessibilityLabel("\(name) extension action")
        context.coordinator.update(button: button, browser: browser, extensionID: extensionID, name: name)
        return button
    }

    func updateNSView(_ button: NSButton, context: Context) {
        context.coordinator.update(button: button, browser: browser, extensionID: extensionID, name: name)
    }

    @MainActor
    final class Coordinator: NSObject {
        private var browser: NativeBrowserHarness
        private var extensionID: UUID
        private var name: String

        init(browser: NativeBrowserHarness, extensionID: UUID, name: String) {
            self.browser = browser
            self.extensionID = extensionID
            self.name = name
        }

        func update(button: NSButton, browser: NativeBrowserHarness, extensionID: UUID, name: String) {
            self.browser = browser
            self.extensionID = extensionID
            self.name = name
            button.title = name
            button.image = browser.extensionActionIcon(for: extensionID)
                ?? NSImage(systemSymbolName: "puzzlepiece.extension", accessibilityDescription: name)
                ?? NSImage(systemSymbolName: "puzzlepiece", accessibilityDescription: name)
            button.isEnabled = true
        }

        @objc func activate(_ sender: NSButton) {
            browser.performExtensionAction(for: extensionID, anchoredTo: sender)
        }
    }
}

private struct WebViewHost: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

private extension NativeBrowserHarness {
    func setStatus(_ value: String) {
        status = value
    }
}
