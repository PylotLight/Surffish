# Sockfish

Sockfish is a compact Electron browser with isolated Chromium tabs, a vertical sidebar, local browsing history, network-only ad blocking, and an optional local SOCKS5 proxy. The template dashboard and sample demo screens have been removed.

## Quick start

```bash
bun install
bun run dev
bun run typecheck
bun run test
bun run build
```

## Address bar

Enter a web address or a search phrase in the slim address bar. Choose Brave Search (the default), DuckDuckGo, Google, or Bing from **Settings** in the sidebar; the choice is saved in Sockfish's app data. Domain-like addresses open over HTTPS by default; `localhost` and loopback addresses use HTTP. Only HTTP(S) pages can be opened.

## Tabs and history

Use the left sidebar to switch tabs, create a tab, or close one. On macOS, **⌘-click** a page link to open a background tab without switching away; new background tabs do not load until selected. On startup, all restored tabs—including the previously active tab—stay unloaded until you choose **Load page** or select one, so a restored YouTube tab cannot autoplay just because Sockfish reopened. Loaded tabs keep playing media when you switch away; audible tabs stay awake while playing, even past the hibernation interval. In **Settings**, choose when inactive tabs hibernate (30 minutes by default, or Never). A sleeping tab reloads its last URL when selected, so unsaved form and in-page state and that tab's back/forward history are not retained. **Alt-click** the new-tab button for options to open the selected search provider’s start page or duplicate the active tab. **Ctrl/⌘+T** creates a tab, **Ctrl/⌘+W** closes the current tab, and **Ctrl/⌘+Tab** switches tabs. Sockfish restores open tabs and the active tab after a normal quit/restart. The web page is hidden at launch; choose the compact page icon beside the address bar to show or hide it. On macOS, trackpad pinch zoom is enabled and horizontal page swipes go back/forward (subject to the macOS trackpad swipe preference). Choose **History** in the sidebar to search recent visits; history is stored locally in Sockfish's app data, limited to the latest 5,000 entries, and can be cleared from that view. **Settings** also contains the search-engine and SOCKS5 choices; **Quit Sockfish** is at the bottom of the sidebar.

## Browser engine and extensions

Sockfish already uses Chromium with Blink through Electron, so adding Blink would not change the engine. Electron's extension support is intentionally partial and loads unpacked extensions only; see the [official compatibility list](https://www.electronjs.org/docs/latest/api/extensions). For an extension-specific app, first test the exact extensions against Electron's supported APIs. Moving to [CEF](https://chromiumembedded.github.io/cef/) still embeds Chromium/Blink and requires replacing much of this Electron shell; it does not by itself provide Chrome-browser extension compatibility. Broad Chrome-extension compatibility is a product-level browser project, not an engine toggle. GeckoView is Mozilla's maintained Gecko embedder for Android, rather than a drop-in desktop Electron replacement ([GeckoView overview](https://mozilla.github.io/geckoview/)).

## Use a local SSH SOCKS tunnel

Run the tunnel on the same computer as Sockfish:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

Replace `user@your-ssh-host` with your SSH account/host or an SSH config alias, and keep the command running. Open **Settings** in the sidebar to test the local port or change the host/port, then choose **Save**. The loopback-only proxy setting is saved for later launches. If the tunnel is down while proxying is enabled, pages fail to load rather than silently falling back to a direct connection. Turn **Use proxy** off to browse directly.

A successful port test confirms only that something is listening; it does not authenticate or validate the SOCKS handshake or SSH destination.

## Network-only ad blocking

Sockfish uses Ghostery's Electron adapter and its maintained ads-only filter lists to block matching subresource requests in the browser session. It does not inject cosmetic CSS or scripts, hide ad placeholders, or apply tracker/annoyance lists; some empty ad spaces may remain visible. Filter lists are refreshed at startup when the cached engine is older than 24 hours. Updates use the same browser session (and configured SOCKS proxy); if an update is unavailable, Sockfish uses the last cached engine, or starts without filtering on a first launch. This does not block requests made by Sockfish's app UI outside the browser session.

## Scope and security

- Remote pages run in Electron `WebContentsView`, not in the React renderer. Node integration is off; context isolation, sandboxing, and web security are on. Popups and web permission requests are denied.
- Cookies and site storage use the persistent `persist:fish-browser` Chromium profile under Electron's app-data directory. Open tab URLs and the selected search engine are also saved there. Session-only cookies are separately encrypted with Electron safeStorage and the operating system's credential store when available; on Linux without a secure keyring, these cookies are not backed up. Sites can still expire or revoke login sessions.
- SOCKS5 is configured on the dedicated persistent browser session before its first remote page loads. It affects this browser session only, not other apps or system traffic.
- This is a small browser prototype, not an audited privacy browser. It does not promise that every traffic type uses the proxy or provide DNS/WebRTC leak guarantees.
- There is no extension manager, cosmetic ad blocker, download manager, or password manager in the current build. See [`docs/extensions-roadmap.md`](docs/extensions-roadmap.md) for feasible next steps.

See [`docs/browser-and-proxy.md`](docs/browser-and-proxy.md) for implementation details.
