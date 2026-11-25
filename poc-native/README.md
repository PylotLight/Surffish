# Surffish Native

Native macOS browser built with Swift, AppKit, WebKit and Network.framework.

The Electron application on `main` is the behavioural and feature-parity reference. The native app does not embed Electron or reuse its renderer; it ports product behaviour onto macOS-native browser APIs.

## Platform

- macOS 26 or later.
- Apple Silicon (arm64) for the initial native target.
- Xcode / Swift toolchain for the macOS 26 SDK.
- WebKit provides site rendering, cookies, storage, extensions and browser networking.

## Development and Production profiles

The build creates two independently launchable applications:

- `Surffish.app` — Production.
- `Surffish Dev.app` — Development.

Each profile has a separate Application Support directory under:

```
~/Library/Application Support/SurffishNative/Profiles/Production/
~/Library/Application Support/SurffishNative/Profiles/Development/
```

Settings, sessions, installed extensions and profile website data are isolated. Extensions are downloaded on demand and stored under each profile's `Extensions/` directory; no third-party extension code is bundled in either app. Persistent WebKit stores use distinct stable identifiers; private tabs use non-persistent stores. The two app bundles have distinct bundle identifiers and can run side-by-side.

For command-line launches, `--profile production`, `--profile development` or `SURFFISH_PROFILE=development` selects the profile.

## Native architecture

- `BrowserProfile.swift`: profile selection, profile storage paths and persistent WebKit store identity.
- `TabManager.swift`: WKWebView tab lifecycle, stable IDs, active selection, pinning, groups and Space metadata.
- `BrowserSessionStore.swift`: versioned, atomic session persistence.
- `BrowserSettingsStore.swift`: versioned settings with backward-compatible defaults.
- `MainWindowController.swift`: native window, sidebar, toolbar, WebKit content and browser commands.
- `SidebarView.swift` and `OmniboxView.swift`: native browser chrome.
- `WebExtensionManager.swift`: WebKit Web Extensions, Chrome Web Store CRX installs, Firefox Add-ons XPI installs and profile-specific extension storage.
- `SshTunnelManager.swift`: native OpenSSH local TCP forwarding to the NAS SOCKS5 service, readiness, status and reconnect.
- `WebKitProxyController.swift`: WebKit SOCKSv5 proxy configuration with failover disabled.

## SSH to NAS SOCKS5 service

Surffish does not create a second SOCKS implementation and does not use OpenSSH dynamic forwarding (`-D`). The NAS already runs the SOCKS5 server; Surffish connects to that server through an SSH local port forward (`-L`).

- SSH destination: one host alias or `user@host`, resolved by native OpenSSH using the user's SSH config, IdentityFile, known_hosts, ProxyJump, ProxyCommand and ssh-agent.
- NAS SOCKS endpoint: configurable host and port, default `127.0.0.1:1080` as seen from the NAS itself.
- Local endpoint: configurable port, default `1080`.
- The SSH client binds the local endpoint on `127.0.0.1` by default and forwards raw TCP to the NAS SOCKS endpoint. SOCKS5 negotiation and remote DNS remain end-to-end with the NAS daemon.
- Browser routing and external application sharing can be enabled independently. When either is enabled, both use the same local forwarded endpoint.
- Optional LAN sharing binds the local forward to `0.0.0.0` using OpenSSH `-g`; the NAS SOCKS server still remains the upstream proxy.
- Use `socks5h://127.0.0.1:1080` in other applications. The `h` ensures destination hostnames are resolved by the SOCKS server on the NAS.
- LAN exposure has no added SOCKS authentication. Use a trusted network and firewall.

Example:

```bash
curl --proxy socks5h://127.0.0.1:1080 https://ifconfig.me
```

The app's "SSH forward ready" status confirms the local SSH forward is listening. It does not independently prove that the NAS SOCKS daemon is reachable; the first real proxied request validates that final leg. Runtime validation on the actual NAS is required for SSH authentication, SOCKS negotiation, remote DNS, concurrent clients, sleep/wake and tunnel-drop behaviour.

## Roadmap and Electron parity

The full feature inventory and phased MVP roadmap is in [native-webkit-mvp-roadmap.md](../docs/native-webkit-mvp-roadmap.md).

The roadmap covers browser shell, tabs, groups, Spaces, split view, profiles/storage, bookmarks, history, reading list, downloads, extensions/Bramble, ad blocking, privacy/security, proxy/networking, developer tools, Reader/Read Aloud, translation, PDF, capture/media, New Tab, feeds/watchers, Glance/mini windows, Local AI, performance, settings, updates and diagnostics.

## Testing menu

Developer-only hooks remain separated under **Testing**:

- Diagnostics
- Test Ad Blocker
- Install Extension
- Test Touch ID

They are not production browser controls.

## Build

On macOS 26+ with Xcode command-line tools:

```bash
./scripts/build-native-poc.sh
open "poc-native/build/Surffish.app"
open "poc-native/build/Surffish Dev.app"
```

The script compiles the Swift sources against `arm64-apple-macosx26.0` and packages both profile apps. Third-party extensions are installed separately from their official stores through Testing → Install Extension. GitHub Actions validates the build on a macOS 26 arm64 runner.
