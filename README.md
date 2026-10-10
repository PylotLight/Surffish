# Sockfish

Sockfish is a compact Electron browser with isolated Chromium tabs, a vertical glass sidebar, local browsing history, network-only ad blocking, an optional local SOCKS5 proxy, and a tested Bramble extension integration for a password-fill flow.

## Quick start

```bash
bun install
bun run dev
bun run typecheck
bun run test
bun run build
```

## Address bar and new tabs

Enter a web address or search phrase in the slim address bar. Local suggestions come from pinned sites, open tabs, and history; queries are not sent to a remote suggestion service. Choose Brave Search (the default), DuckDuckGo, Google, or Bing from **Settings → General**. Domain-like addresses open over HTTPS by default; `localhost` and loopback addresses use HTTP. Only HTTP(S) pages can be opened.

New tabs open [Bonjourr's online start page](https://online.bonjourr.fr/) by default. In **Settings → General → New tab page**, switch future tabs to the selected search engine. This uses Bonjourr's hosted page; a browser extension is not installed.

## Tabs, sidebar, and history

Use the left sidebar to switch Tabs/History, create a tab, close one, or open pinned sites. The full-height translucent sidebar opens from the toolbar button or its left-edge hover reveal strip and has a smooth slide animation. Pin sites with the star in the address bar; pins are stored locally by website origin and can be removed with a right-click. On macOS, **⌘-click** a page link opens a background tab without switching away.

Explicitly opened tabs load immediately, including background tabs. On startup the previously active restored tab resumes automatically; other restored tabs may defer loading until selected. The active “Load page” sleep screen has been removed. Loaded tabs keep playing media when you switch away, and audible tabs stay awake. In **Settings → General**, choose when inactive tabs hibernate (30 minutes by default, or Never). Hibernated tabs reload their last URL when selected, so unsaved forms and in-page state are not retained. **Alt-click** the new-tab button for the configured default start page or to duplicate the active tab. **Ctrl/⌘+T** creates a tab, **Ctrl/⌘+W** closes the current tab, and **Ctrl/⌘+Tab** switches tabs. Sockfish restores open tabs and the active tab after a normal quit/restart. **History** remains in the sidebar; History and Pins are stored locally in Sockfish's app data.

## Toolbar, settings, and site controls

The toolbar provides back, forward, reload/stop, favorite, Picture in Picture, site settings, and the Bramble action. Picture in Picture asks Chromium to open a ready page video in its separate floating player window, where supported.

General settings contain the search engine, new-tab page, Bramble management, tab hibernation, and SOCKS5 configuration. **This site**, **Ad blocking**, and **Network** are settings sections rather than items mixed into the tab list. Per-site controls store ad-blocking and popup-to-tab choices plus explicit camera/microphone, location, and notification grants for that origin. Web permissions remain denied by default; operating-system privacy prompts may still apply. See [the browser UI overhaul notes](docs/browser-ui-overhaul.md) for behavior, limitations, and a smoke checklist.

## Bramble passkeys and macOS Touch ID

The Bramble toolbar popup remains available for password filling. Settings shows actual Electron/Chromium versions, the active page's secure-context and Credentials/WebAuthn API status, and the unmodified User-Agent. Sockfish does not spoof a browser identity. Bramble's documented Chrome 122+ floor is necessary for its extension custom-RP-ID passkey flow but is not sufficient: a rejected RP ID, a `SecurityError`, or missing extension host permissions can show the same “too old” message.

Native macOS Touch ID for arbitrary website passkeys requires Apple's managed browser public-key-credential entitlement and app signing/review ([Apple documentation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential)). This UI work does not claim that entitlement or require Apple Developer enrollment/signing. Native browser Touch ID and Bramble's extension-vault passkeys are separate capabilities.

## Browser engine and extensions

Sockfish already uses Chromium with Blink through Electron, so adding Blink would not change the engine. Electron's extension support is intentionally partial and loads unpacked extensions only; see the [official compatibility list](https://www.electronjs.org/docs/latest/api/extensions). The Bramble integration adapts its tested Firefox MV3 build for the existing password-fill flow; it is not a general Chrome-extension manager. For an extension-specific app, first test the exact extensions against Electron's supported APIs. Moving to [CEF](https://chromiumembedded.github.io/cef/) still embeds Chromium/Blink and requires replacing much of this Electron shell; it does not by itself provide Chrome-browser extension compatibility. GeckoView is Mozilla's maintained Gecko embedder for Android, rather than a drop-in desktop Electron replacement ([GeckoView overview](https://mozilla.github.io/geckoview/)).

An isolated [native macOS WebKit proof of concept](native/macos/README.md) exercises Apple's embedded WebExtension, SOCKSv5 proxy, and passkey-detection APIs on macOS 15.4+. It does not change the Electron app; see the [evaluation and extension installation notes](docs/native-webkit-evaluation.md) for supported test paths and Apple entitlement limits.

## Use a local SSH SOCKS tunnel

Fresh profiles start with **Use proxy** off so the browser can load sites without a local tunnel. Enable SOCKS5 in **Settings → General** when you want to route browser traffic through your tunnel; the saved choice is retained across launches.

Run the tunnel on the same computer as Sockfish:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

Replace `user@your-ssh-host` with your SSH account/host or an SSH config alias, and keep the command running. Open **Settings → General** to test the local port or change the host/port, then choose **Save**. The loopback-only proxy setting is saved for later launches. If the tunnel is down while proxying is enabled, pages fail to load rather than silently falling back to a direct connection. Turn **Use proxy** off to browse directly.

A successful port test confirms only that something is listening; it does not authenticate or validate the SOCKS handshake or SSH destination.

## Network-only ad blocking

Sockfish uses Ghostery's Electron adapter and its maintained ads-only filter lists to block matching subresource requests in the browser session. It does not inject cosmetic CSS or scripts, hide ad placeholders, or apply tracker/annoyance lists; some empty ad spaces may remain visible. Filter lists are refreshed at startup when the cached engine is older than 24 hours, and can be refreshed from **Settings → Ad blocking**. That view shows the active rule/list counts, blocked and allowed request totals, and the 20 most recent blocked request hostnames (not full URLs). Updates use the same browser session (and configured SOCKS proxy); if an update is unavailable, Sockfish uses the last cached engine, or starts without filtering on a first launch. This does not block requests made by Sockfish's app UI outside the browser session.

YouTube serves ads and wanted video chunks through shared delivery hosts. Sockfish allows requests to `googlevideo.com` delivery hosts so ad rules cannot interrupt playback; ads delivered there may remain. Network filtering therefore cannot reliably remove every in-stream ad.

## Scope and security

- Remote pages run in Electron `WebContentsView`, not in the React renderer. Node integration is off; context isolation, sandboxing, and web security are on. Pop-ups and web permission requests are denied unless the current site's settings explicitly allow routing pop-ups into tabs or grant a listed permission.
- Cookies and site storage use the persistent `persist:fish-browser` Chromium profile under Electron's app-data directory. Open tab URLs, pinned site origins, preferences, and history are also saved there. Session-only cookies are separately encrypted with Electron safeStorage and the operating system's credential store when available; on Linux without a secure keyring, these cookies are not backed up. Sites can still expire or revoke login sessions.
- SOCKS5 is configured on the dedicated persistent browser session before its first remote page loads. It affects this browser session only, not other apps or system traffic.
- This is a small browser prototype, not an audited privacy browser. It does not promise that every traffic type uses the proxy or provide DNS/WebRTC leak guarantees. Per-site settings do not yet claim JavaScript, cookie, or cosmetic-filter controls.
- See [`docs/browser-and-proxy.md`](docs/browser-and-proxy.md), [`docs/bramble-integration.md`](docs/bramble-integration.md), and [`docs/browser-ui-overhaul.md`](docs/browser-ui-overhaul.md) for implementation details.
