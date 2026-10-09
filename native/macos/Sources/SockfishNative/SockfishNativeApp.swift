import AppKit
import NativeCore
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@main
struct SockfishNativeApp: App {
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

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button("Back", action: browser.goBack)
                    .disabled(!browser.webView.canGoBack)
                Button("Forward", action: browser.goForward)
                    .disabled(!browser.webView.canGoForward)
                Button("Reload", action: browser.reload)
                TextField("https://example.com", text: $browser.address)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { browser.navigate() }
                Button("Go") { browser.navigate() }
                Toggle("SOCKS5 · 127.0.0.1:1080", isOn: Binding(
                    get: { browser.proxyEnabled },
                    set: { browser.configureSOCKS5Proxy(enabled: $0) }
                ))
                .toggleStyle(.switch)
                Button("Passkey APIs") {
                    Task { await browser.inspectPasskeyAPIs() }
                }
                Button("Add extension…", action: chooseExtension)
            }
            .padding(10)

            Divider()

            WebViewHost(webView: browser.webView)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !browser.loadedExtensions.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Loaded extensions (prototype host)")
                        .font(.headline)
                    ForEach(browser.loadedExtensions) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(item.name) · v\(item.version) · MV\(item.manifestVersion, specifier: "%.0f")")
                                Text("Permissions: \(item.requestedPermissions.joined(separator: ", "))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("Sites: \(item.requestedHostPatterns.joined(separator: ", "))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Unload") {
                                do { try browser.uninstallExtension(item) }
                                catch { browser.setStatus("Unload failed: \(error.localizedDescription)") }
                            }
                        }
                    }
                }
                .padding(10)
            }

            Divider()
            Text(browser.status)
                .font(.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
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
