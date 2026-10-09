# Browser and local SOCKS5 proxy

## Browser flow

1. On startup, Sockfish restores any encrypted session-only cookie snapshot, then `src/main/proxy.ts` reads the saved loopback-only settings and configures the shared `persist:fish-browser` session before any remote page is created.
2. `src/main/adblock.ts` loads a cached Ghostery ads-only engine or refreshes the maintained filter lists through that same session. Its configuration enables network request filters only; cosmetic, CSP, and HTML filtering are disabled. A stale cache is retained if refresh fails, and a first-launch failure does not prevent the browser from opening. The sidebar's **Diagnostics** view reports the current engine source, list/rule counts, aggregate allowed/blocked subresource requests, and a 20-entry host-only block history; it also allows a manual list refresh while the active engine continues blocking.
3. `src/main/browser.ts` creates a remote `WebContentsView` only when a tab is selected, on the same persistent session. Newly opened background tabs stay URL-only until selected. At startup, **all restored tabs**, including the previously active tab, remain unloaded until the user chooses **Load page** or selects one, preventing a restored YouTube page from autoplaying just because Sockfish reopened. Switching away from a loaded tab does not mute or pause its media; inactive views are assigned zero-size bounds.
4. The configurable tab-sleep interval defaults to 30 minutes and can be set to Never, 5, 15, 30, or 60 minutes in **Settings**. Once a loaded tab has remained inactive for the selected interval, Sockfish closes its view and retains the last URL; tabs currently producing audible playback stay loaded and are checked again periodically. Selecting a sleeping tab creates a fresh view and reloads the page on the same persistent profile. This releases the old renderer but does not preserve unsaved forms, in-page state, scroll position, or the tab's back/forward history. Open tab URLs, the selected tab, search engine, tab-sleep interval, and SOCKS5 preferences are stored in Electron's app-data directory. The narrow preload bridge provides tab switching, address navigation, back/forward/reload, view bounds, browsing history, settings, and clean application exit. Remote pages do not receive the app preload bridge.
5. `src/shared/navigation.ts` resolves omnibox input: HTTP(S) URLs and domain-like hosts navigate directly, loopback addresses use HTTP, and other text becomes a DuckDuckGo query. Non-HTTP(S) schemes are rejected.

Each committed HTTP(S) page navigation is added to `browsing-history.json` in the application's user-data directory. The store keeps at most 5,000 visits; the sidebar can search or clear it. Closing tabs does not clear history.

The named persistent partition keeps ordinary cookies and site storage on disk. Because Electron does not keep session-only cookies between launches by default, Sockfish snapshots them into an encrypted file using `safeStorage` and restores them before pages load. Snapshots are skipped when OS-backed encryption is unavailable (including Linux's `basic_text` fallback); site-side expiry or revocation can still end a login. On normal quit, Sockfish saves the cookie snapshot and flushes the persistent cookie store before closing.

## SSH dynamic forwarding

On the computer running Sockfish, start:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

This creates a local SOCKS endpoint on `127.0.0.1:1080` for the lifetime of the SSH process. Choose another local port if needed and set the same host/port in **Settings**. Sockfish does not start or manage the SSH process, store SSH credentials, or authenticate the SOCKS endpoint.

## Boundaries

- Proxy changes apply only to the `fish-browser` Electron session.
- Network ad filtering applies only to that session and blocks matching requests; it does not cosmetically hide page elements. Requests to `googlevideo.com` delivery hosts are allowed through so ad rules cannot interrupt video playback; ads delivered through those shared hosts may remain. Electron supports only one active listener per `webRequest` event, so any future request interception must be composed with the blocker rather than registering a competing listener.
- The local port check is a TCP connect test, not a SOCKS protocol handshake.
- Web pages may navigate only over HTTP(S); popups and web permission requests are blocked.
- This implementation is a prototype, not a system-wide VPN or audited browser. Proxy configuration alone does not guarantee that every browser-related traffic type is proxied or prevent DNS/WebRTC leaks.
