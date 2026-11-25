# Surffish Native

Native macOS browser implementation using Swift, AppKit and WebKit.

This branch is a native-first browser implementation. The production Electron application on `main` is the behavioural reference for browser state, tabs, settings and feature parity; its React UI is not embedded in this app.

## Current native architecture

- `TabManager.swift`: native WKWebView tab lifecycle, stable tab IDs, active selection, pinning, group/Space metadata and navigation updates.
- `BrowserSessionStore.swift`: versioned, atomic browser-session persistence under `~/Library/Application Support/SurffishNative/browser-session.json`.
- `MainWindowController.swift`: native window, sidebar, toolbar, WebKit content, browser commands and extension-window integration.
- `SidebarView.swift`: tab list and pin/close/new-tab actions only. Prototype diagnostics and test controls do not appear in the browser sidebar.
- `OmniboxView.swift`: native navigation controls, address/search field, load progress and Bramble extension action.
- `MainMenu.swift`: standard macOS menus plus a dedicated **Testing** menu for temporary prototype hooks.

Normal tabs use WebKit's persistent default website data store. Private tabs use a non-persistent data store and are excluded from the saved session. The session restores stable tab IDs, URLs, titles, pin state, group metadata, Space metadata and the active tab.

## Production parity migration

See [the migration plan](../docs/native-webkit-frame-ui.md). The work is phased:

1. Core browser state and session persistence.
2. Production tab organization: groups, Spaces, split views, tab overview and drag/drop.
3. Production browser shell: full sidebar, toolbar, overflow and native settings entry point.
4. Production settings and preference migrations.
5. Browser feature parity: history, bookmarks, reading list, downloads, permissions, security, PDF, reader mode, translation and extension management.
6. macOS validation, regression tests and hardening.

The current implementation is the start of phase 1, not a claim of production parity.

## Testing menu

Temporary proof-of-concept hooks are available under **Testing**:

- Diagnostics
- Test Ad Blocker
- Install Extension
- Test Touch ID

These are developer/testing tools, not production browser controls. The real Bramble extension action remains in the toolbar.

## Build and run

On macOS 15.4 or later with Xcode command-line tools installed:

```bash
./scripts/build-native-poc.sh
open poc-native/build/SurffishNative.app
```

The build script compiles all Swift sources in `poc-native/Sources`. This repository environment cannot compile AppKit/WebKit; the native build and runtime checks must be performed on macOS.
