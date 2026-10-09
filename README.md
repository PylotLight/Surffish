# Sockfish

Sockfish is a compact Electron browser with an isolated Chromium page and an optional local SOCKS5 proxy. The main window is kept deliberately browser-like: back, forward, reload, one combined address/search bar, and a small proxy control. The template dashboard and sample demo screens have been removed.

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
