# Surffish Native

Native macOS browser built with Swift, AppKit, WebKit and Network.framework.

The Electron application on `main` (currently pinned to Electron `46.0.0-alpha.12`) is the behavioural and feature-parity reference. The native app does not embed Electron or reuse its renderer; it ports product behaviour onto macOS-native browser APIs.

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

Settings, sessions, bookmarks, browsing history, installed extensions and profile website data are isolated. Extensions are downloaded on demand and stored under each profile's `Extensions/` directory; no third-party extension code is bundled in either app. Persistent WebKit stores use distinct stable identifiers; private tabs use non-persistent stores and their visits are not written to history. The two app bundles have distinct bundle identifiers and can run side-by-side.

For command-line launches, `--profile production`, `--profile development` or `SURFFISH_PROFILE=development` selects the profile.

## Native architecture

- `BrowserProfile.swift`: profile selection, profile storage paths and persistent WebKit store identity.
- `TabManager.swift`: WKWebView tab lifecycle, stable IDs, active selection, pinning, groups and Space metadata.
- `BrowserSessionStore.swift`: versioned, atomic session persistence.
- `BrowserSettingsStore.swift`: versioned settings with backward-compatible defaults.
- `BrowserLibraryStore.swift`: profile-local bookmarks and capped browsing history; private visits are excluded.
- `MainWindowController.swift`: native window, sidebar, toolbar, WebKit content and browser commands.
- `SidebarView.swift` and `OmniboxView.swift`: native browser chrome.
- Native sidebar panels cover Tabs, History, Bookmarks and Reading List, with title/URL search, pinned/unpinned tab drag reordering, a separate keep-open pin and adjustable width. Back/Forward buttons expose each tab's WebKit navigation history on right-click. Settings is organized into General, Privacy, Extensions, Connection and About, with the supported sidebar and New Tab preferences backed by profile-local storage.
- `WebExtensionManager.swift`: WebKit Web Extensions, Chrome Web Store CRX installs, Firefox Add-ons XPI installs and profile-specific extension storage.
- `SshTunnelManager.swift`: native OpenSSH dynamic SOCKS5 forwarding (`-D`), readiness, status and reconnect.
- `WebKitProxyController.swift`: WebKit SOCKSv5 proxy configuration with failover disabled.

## SSH SOCKS5 proxy

Surffish creates one local SOCKS5 endpoint and uses OpenSSH dynamic forwarding (`-D`) to carry browser and optional LAN-client traffic through the configured SSH host. The SSH host is the proxy exit point; no separate SOCKS daemon or NAS-side SOCKS host/port is required.

- SSH destination: one host alias or `user@host`, resolved by native OpenSSH using the user's SSH config, IdentityFile, known_hosts, ProxyJump, ProxyCommand and ssh-agent.
- Local endpoint: configurable port, default `1080`.
- The SSH client binds to `127.0.0.1` by default. Optional LAN sharing binds to `0.0.0.0` so trusted LAN devices can use the same SOCKS5 endpoint.
- macOS Local Network access is declared in the app bundle because SSH destinations may be on a private LAN. Allow the permission prompt when macOS asks; Production and Development profiles request access independently.
- The build signs both app bundles with an installed Apple Development or Developer ID Application identity when available. Set `SURFFISH_CODESIGN_IDENTITY` to choose one explicitly. Ad-hoc signing is used only as a fallback; Apple recommends an Apple-issued identity so macOS can reliably track Local Network permission.
- Browser routing and external application sharing can be enabled independently. When either is enabled, both use the same local dynamic SOCKS5 endpoint.
- Use `socks5h://127.0.0.1:1080` in other applications when you want hostnames sent through the SOCKS5 connection.
- LAN exposure has no added SOCKS authentication. Use a trusted network and firewall.

Example:

```bash
curl --proxy socks5h://127.0.0.1:1080 https://ifconfig.me
```

The app's "SSH SOCKS5 ready" status confirms the local dynamic SOCKS endpoint is listening. It does not independently prove that every destination is reachable through the SSH host; validate with a real proxied request. Runtime validation on the actual SSH host is required for authentication, DNS behaviour, concurrent clients, sleep/wake and tunnel-drop behaviour.

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
