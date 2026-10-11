# Sockfish

Sockfish is a compact Electron browser with isolated Chromium tabs, a vertical glass sidebar, local browsing history, a downloads manager, uBlock Origin-style ad blocking (network, cosmetic, and scriptlet filters), an optional local SOCKS5 proxy, and a tested Bramble extension integration for a password-fill flow.

![Sockfish New Tab with a compact site-icon grid over a rotating nature photo](docs/screenshots/new-tab-page.png)

## Quick start

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```

`bun run dev` runs `bun install` on the first start and whenever `package.json`, `bun.lock`, or `.bun-version` changes. Run `bun install` manually when you want to refresh dependencies without starting the app.

## Address bar and new tabs

Enter a web address or search phrase in the slim address bar. Local suggestions come from pinned sites, open tabs, and history; queries are not sent to a remote suggestion service. Choose Brave Search (the default), DuckDuckGo, Google, or Bing from **Settings → General**. Domain-like addresses open over HTTPS by default; `localhost` and loopback addresses use HTTP. Only HTTP(S) pages can be opened.

Fresh profiles open Sockfish's **New Tab** page: a full-window nature photograph with a small, low-set frosted-glass favicon grid in the compact Quick Links style, not large tiles. Pinned sites appear first, followed by up to eight unpinned origins computed from local history. Favicons are requested directly from each site's `/favicon.ico` without a referrer and fall back to an initial if unavailable; the pinned-site strip uses the same direct-origin behavior. The two active backgrounds rotate locally every 15 minutes; **Next background** skips and **Refresh nature photos** requests another set. When the local New Tab is in use, Sockfish normally refreshes at most once per 24 hours from two fixed, generic Wikimedia Commons searches for mountain-lake and forest-lake photos. Requests use the browser session and its saved proxy choice, omit cookies and referrers, and contain no browsing history, pins, current page, typed address, or visited URLs. Only CC0 or attribution-only CC BY images are accepted; at most two remote thumbnails and their title, creator, source, and license metadata are cached. The two bundled CC0 fallback images keep rotation available offline. In **Settings → General → New tab page**, switch future tabs to [Bonjourr's hosted start page](https://online.bonjourr.fr/) or the selected search engine. Sockfish's local icon grid covers pinned favorites and local frequent sites; Bonjourr's extension-only bookmark import is not included in its hosted-page integration. See the [photo source, license, and cache notes](docs/new-tab-photo-sources.md).

Project screenshots use genuine live Linux Electron app windows with synthetic demo sites and data; they are not mockups. See the [browser UI guide](docs/browser-ui-overhaul.md) for New Tab, Tabs, History, and Downloads screenshots and platform limitations.

## Tabs, sidebar, and history

Use the **Tabs** and **History** icons at the right end of the address field to open those sidebar views. Tabs also shows pinned sites as a compact, horizontally scrollable favicon strip; icons load from each site's `/favicon.ico` and use an initial if unavailable. Its full-height translucent panel opens from the toolbar button or its left-edge hover reveal strip and has a smooth slide animation. Settings and Quit remain in the sidebar footer. Pins are stored locally by website origin and can be removed with a right-click. On macOS, **⌘-click** a page link opens a background tab without switching away.

Explicitly opened tabs load immediately, including background tabs. On startup the previously active restored tab resumes automatically; other restored tabs may defer loading until selected. The active “Load page” sleep screen has been removed. Loaded tabs keep playing media when you switch away, and audible tabs stay awake. In **Settings → General**, choose when inactive tabs hibernate (30 minutes by default, or Never). Hibernated tabs reload their last URL when selected, so unsaved forms and in-page state are not retained. **Alt-click** the new-tab button for the configured default start page or to duplicate the active tab. **Ctrl/⌘+T** creates a tab, **Ctrl/⌘+W** closes the current tab, and **Ctrl/⌘+Tab** switches tabs. Sockfish restores open tabs and the active tab after a normal quit/restart. History and pins are stored locally in Sockfish's app data.

## Toolbar, settings, and site controls

The toolbar provides back, forward, reload/stop, Tabs and History panel icons inside the address field, favorite, Picture in Picture, site settings, the official circular Bramble extension icon, and Downloads. The Downloads icon opens a compact anchored popup for recent transfers and links to the full Downloads page. Picture in Picture asks Chromium to open a ready page video in its separate floating player window, where supported.

General settings contain the search engine, new-tab page, Bramble management, tab hibernation, and SOCKS5 configuration. **This site** and **Network** are settings sections rather than items mixed into the tab list. The Network inspector and Electron's native Web inspector remain available; the separate Diagnostics page and runtime compatibility card have been removed. Per-site controls store ad-blocking and popup-to-tab choices plus explicit camera/microphone, location, and notification grants for that origin. Web permissions remain denied by default; operating-system privacy prompts may still apply. See [the browser UI overhaul notes](docs/browser-ui-overhaul.md) for behavior, limitations, and a smoke checklist.

## Downloads

Downloads are tracked through Electron's native download events. The popup shows recent/in-progress items; **Show all** opens the full history page. Items display a filename, source host (not a full URL), date, size and status. Pause/resume, cancel, Open and Show in folder are offered only where available. A file opens only after the user selects **Open**; removing a completed item clears its history entry but never deletes the downloaded file. History is saved locally across restarts, with filesystem paths kept in the main process and no file contents or credentials stored in the UI or logs. See [Downloads manager details and smoke coverage](docs/downloads-manager.md).

## Bramble passkeys and macOS Touch ID

The Bramble toolbar shortcut and popup remain available for password filling, with the extension's official circular icon. Sockfish does not spoof a browser identity. Bramble's documented Chrome 122+ floor is necessary for its extension custom-RP-ID passkey flow but is not sufficient: a rejected RP ID, a `SecurityError`, or missing extension host permissions can show the same “too old” message. Use the native Web inspector for low-level page/runtime investigation.

Native macOS Touch ID for arbitrary website passkeys requires Apple's managed browser public-key-credential entitlement and app signing/review ([Apple documentation](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential)). This UI work does not claim that entitlement or require Apple Developer enrollment/signing. Native browser Touch ID and Bramble's extension-vault passkeys are separate capabilities.

## Browser engine and extensions

Sockfish already uses Chromium with Blink through Electron, so adding Blink would not change the engine. Electron's extension support is intentionally partial and loads unpacked extensions only; see the [official compatibility list](https://www.electronjs.org/docs/latest/api/extensions). The Bramble integration adapts its tested Firefox MV3 build for the existing password-fill flow; it is not a general Chrome-extension manager. For an extension-specific app, first test the exact extensions against Electron's supported APIs. Moving to [CEF](https://chromiumembedded.github.io/cef/) still embeds Chromium/Blink and requires replacing much of this Electron shell; it does not by itself provide Chrome-browser extension compatibility. GeckoView is Mozilla's maintained Gecko embedder for Android, rather than a drop-in desktop Electron replacement.

An isolated [native macOS WebKit proof of concept](native/macos/README.md) exercises Apple's embedded WebExtension, SOCKSv5 proxy, and passkey-detection APIs on macOS 15.4+. It does not change the Electron app; see the [evaluation and extension installation notes](docs/native-webkit-evaluation.md) for supported test paths and Apple entitlement limits.

## Use a local SSH SOCKS tunnel

Fresh profiles start with **Use proxy** off so the browser can load sites without a local tunnel. Enable SOCKS5 in **Settings → General** when you want to route browser traffic through your tunnel; the saved choice is retained across launches.

Run the tunnel on the same computer as Sockfish:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

Replace `user@your-ssh-host` with your SSH account/host or an SSH config alias, and keep the command running. Open **Settings → General** to test the local port or change the host/port, then choose **Save**. The loopback-only proxy setting is saved for later launches. If the tunnel is down while proxying is enabled, pages fail to load rather than silently falling back to a direct connection. Turn **Use proxy** off to browse directly.

A successful port test confirms only that something is listening; it does not authenticate or validate the SOCKS handshake or SSH destination.

## Ad blocking

Sockfish runs uBlock Origin's own filter lists on Ghostery's matcher (`@ghostery/adblocker-electron`): uBlock filters (with every `!#include`d yearly file), badware, privacy, unbreak, quick-fixes and resource-abuse, plus EasyList, EasyPrivacy, Peter Lowe and URLhaus, fetched straight from uBO's uAssets rather than Ghostery's mirror. All three filter kinds are on:

- **Network** rules block subresources; `googlevideo.com` is always allowed so YouTube playback never breaks.
- **Cosmetic** rules hide ad slots, including generic rules matched against classes/ids/links the page adds later.
- **Scriptlets** (`##+js(...)`) run uBO page fixes; this is what removes YouTube video and feed ads. A sandboxed frame preload (`src/preload/adblock-frame.cjs`) fetches them synchronously and runs them in the page's main world *before* the page's own scripts, in iframes too.

uBO `!#if` blocks are evaluated for desktop Chromium. Lists refresh every 8 hours (uBO's quick-fixes expiry) through the browser session, so the SOCKS proxy applies; the last good engine keeps blocking if a refresh fails. Per-site "block ads" off disables all three kinds for that site. Test with `bun run test:electron-adblock` (offline) and `bun run test:electron-youtube` / `bun run test:electron-adblock-sites` (live; see [browser and proxy notes](docs/browser-and-proxy.md)).

## Scope and security

- Remote pages run in Electron `WebContentsView`, not in the React renderer. Node integration is off; context isolation, sandboxing, and web security are on. Pop-ups and web permission requests are denied unless the current site's settings explicitly allow routing pop-ups into tabs or grant a listed permission.
- Cookies and site storage use the persistent `persist:fish-browser` Chromium profile under Electron's app-data directory. Open tab URLs, pinned site origins, preferences, and history are also saved there. Session-only cookies are separately encrypted with Electron safeStorage and the operating system's credential store when available; on Linux without a secure keyring, these cookies are not backed up. Sites can still expire or revoke login sessions.
- SOCKS5 is configured on the dedicated persistent browser session before its first remote page loads. It affects this browser session only, not other apps or system traffic.
- Download history is local metadata only; it does not retain downloaded contents. The main process keeps local file paths private from the renderer; remove-history actions never remove user files.
- This is a small browser prototype, not an audited privacy browser. It does not promise that every traffic type uses the proxy or provide DNS/WebRTC leak guarantees. Per-site settings do not yet claim JavaScript, cookie, or cosmetic-filter controls.
- See [`docs/browser-and-proxy.md`](docs/browser-and-proxy.md), [`docs/bramble-integration.md`](docs/bramble-integration.md), [`docs/browser-ui-overhaul.md`](docs/browser-ui-overhaul.md), and [`docs/downloads-manager.md`](docs/downloads-manager.md) for implementation details.
