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

- `Surffish Native.app` — Production.
- `Surffish Native Dev.app` — Development.

Each profile has a separate Application Support directory under:

```
~/Library/Application Support/SurffishNative/Profiles/Production/
~/Library/Application Support/SurffishNative/Profiles/Development/
```

Settings, sessions, installed extensions and profile website data are isolated. Persistent WebKit stores use distinct stable identifiers; private tabs use non-persistent stores. The two app bundles have distinct bundle identifiers and can run side-by-side.

For command-line launches, `--profile production`, `--profile development` or `SURFFISH_PROFILE=development` selects the profile.

## Native architecture

- `BrowserProfile.swift`: profile selection, profile storage paths and persistent WebKit store identity.
- `TabManager.swift`: WKWebView tab lifecycle, stable IDs, active selection, pinning, groups and Space metadata.
- `BrowserSessionStore.swift`: versioned, atomic session persistence.
- `BrowserSettingsStore.swift`: versioned settings with backward-compatible defaults.
- `MainWindowController.swift`: native window, sidebar, toolbar, WebKit content and browser commands.
- `SidebarView.swift` and `OmniboxView.swift`: native browser chrome.
- `WebExtensionManager.swift`: WebKit Web Extensions and profile-specific extension installation.
- `SshTunnelManager.swift`: native OpenSSH process, SOCKS5 listener, readiness, status and reconnect.
- `WebKitProxyController.swift`: WebKit SOCKSv5 proxy configuration with failover disabled.

## SSH SOCKS5 service

Connection settings support one managed SSH destination and one SOCKS5 endpoint. Multiple upstream proxy profiles are intentionally out of scope.

- SSH uses macOS `/usr/bin/ssh`, so OpenSSH resolves `~/.ssh/config`, Include, ProxyJump, ProxyCommand, IdentityFile, known_hosts and ssh-agent.
- The local SOCKS5 port is configurable (default `1080`).
- Browser routing and external-client availability are independent.
- The listener defaults to `127.0.0.1`; optional `0.0.0.0` binding requires explicit LAN sharing.
- The endpoint is usable by other local apps as `socks5h://127.0.0.1:1080`.
- `socks5h` requests remote DNS resolution through the SOCKS server.
- The NAS is the SSH destination and performs outbound connections. The SOCKS listener itself is on the Mac.
- LAN binding is unauthenticated at the SOCKS layer; use a trusted network and firewall.
- If browser proxying is enabled, WebKit has no direct fallback when the tunnel is down.

Example:

```bash
curl --proxy socks5h://127.0.0.1:1080 https://ifconfig.me
```

The native networking MVP still requires runtime validation against the actual NAS, authentication setup, proxy DNS, concurrent external clients, sleep/wake and tunnel-drop behaviour.

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
open "poc-native/build/Surffish Native.app"
open "poc-native/build/Surffish Native Dev.app"
```

The script compiles the Swift sources against `arm64-apple-macosx26.0` and packages both profile apps, including the Bramble extension resources. GitHub Actions validates the build on a macOS 26 arm64 runner.
