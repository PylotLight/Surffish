# Native browser migration overview

Target branch: `poc/native-webkit-app`

The native browser is a full product replacement effort, not a UI-only WebKit wrapper.

## Product decisions

- Native runtime: Swift, AppKit, WebKit and Network.framework.
- Platform baseline: macOS 26+, Apple Silicon (arm64).
- Electron `main` remains the behavioural and feature-parity reference.
- Two isolated app profiles: Development and Production. They share implementation but never share cookies, website data, sessions, settings or installed extensions.
- One managed SSH destination and one SOCKS5 endpoint. Multiple named upstream proxy profiles are not required.
- SOCKS5 listener uses a custom port (default 1080), loopback by default, optional LAN binding with an explicit security warning.
- Browser proxy routing and external SOCKS service availability can be enabled independently.

## Current native components

- Native AppKit browser window, sidebar, toolbar/omnibox and menu.
- WKWebView tabs, tab identity, pinning and session persistence.
- Private browsing with non-persistent website data stores.
- Separate Development and Production Application Support roots and persistent WebKit data-store identifiers.
- Profile-isolated extension installation and Bramble lookup.
- Native OpenSSH process management and WebKit SOCKSv5 configuration.
- Configurable external SOCKS5 port, loopback/LAN binding and copyable client URI.
- macOS 26 arm64 build workflow.

## Authoritative roadmap

See [Native MVP and Electron feature parity roadmap](native-webkit-mvp-roadmap.md).

That document contains:

- The current landed implementation and outstanding networking/browser MVP acceptance criteria.
- The full Electron feature inventory grouped into 22 categories.
- The complete Settings category inventory.
- Delivery phases M0–M6 and explicit MVP acceptance criteria.

## Implementation rule

A feature is not complete because a settings control exists or the project compiles. It must be connected to real native behaviour, persisted where appropriate, tested, and checked against the Electron reference. WebKit platform limitations must be recorded rather than silently represented as parity.
