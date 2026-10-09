# Sockfish

Sockfish is a compact Electron browser with isolated Chromium tabs, a vertical sidebar, local browsing history, and an optional local SOCKS5 proxy. The template dashboard and sample demo screens have been removed.

## Quick start

```bash
bun install
bun run dev
bun run typecheck
bun run test
bun run build
```

## Address bar

Enter a web address or a search phrase in the same bar. Domain-like addresses open over HTTPS by default; `localhost` and loopback addresses use HTTP. Plain text is searched with DuckDuckGo. Only HTTP(S) pages can be opened.

## Tabs and history

Use the left sidebar to switch tabs, create a tab, or close one. **Ctrl/⌘+T** creates a tab, **Ctrl/⌘+W** closes the current tab, and **Ctrl/⌘+Tab** switches tabs. Choose **History** in the sidebar to search recent visits; history is stored locally in Sockfish's app data, limited to the latest 5,000 entries, and can be cleared from that view.

## Browser engine and extensions

Sockfish already uses Chromium with Blink through Electron, so adding Blink would not change the engine. Electron's extension support is intentionally partial and loads unpacked extensions only; see the [official compatibility list](https://www.electronjs.org/docs/latest/api/extensions). For an extension-specific app, first test the exact extensions against Electron's supported APIs. Moving to [CEF](https://chromiumembedded.github.io/cef/) still embeds Chromium/Blink and requires replacing much of this Electron shell; it does not by itself provide Chrome-browser extension compatibility. Broad Chrome-extension compatibility is a product-level browser project, not an engine toggle. GeckoView is Mozilla's maintained Gecko embedder for Android, rather than a drop-in desktop Electron replacement ([GeckoView overview](https://mozilla.github.io/geckoview/)).

## Use a local SSH SOCKS tunnel

Run the tunnel on the same computer as Sockfish:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

Replace `user@your-ssh-host` with your SSH account/host or an SSH config alias, and keep the command running. Click **SOCKS5** in the browser toolbar to test the local port or change the host/port, then choose **Save & apply**. The loopback-only proxy setting is saved for later launches. If the tunnel is down while proxying is enabled, pages fail to load rather than silently falling back to a direct connection. Turn **Use proxy** off to browse directly.

A successful port test confirms only that something is listening; it does not authenticate or validate the SOCKS handshake or SSH destination.

## Scope and security

- Remote pages run in Electron `WebContentsView`, not in the React renderer. Node integration is off; context isolation, sandboxing, and web security are on. Popups and web permission requests are denied.
- SOCKS5 is configured on the dedicated persistent browser session before its first remote page loads. It affects this browser session only, not other apps or system traffic.
- This is a small browser prototype, not an audited privacy browser. It does not promise that every traffic type uses the proxy or provide DNS/WebRTC leak guarantees.
- There is no extension manager, ad blocker, download manager, or password manager in the current build. See [`docs/extensions-roadmap.md`](docs/extensions-roadmap.md) for feasible next steps.

See [`docs/browser-and-proxy.md`](docs/browser-and-proxy.md) for implementation details.
