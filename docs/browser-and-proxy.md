# Browser and local SOCKS5 proxy

## Browser flow

1. On startup, Sockfish restores any encrypted session-only cookie snapshot, then `src/main/proxy.ts` reads the saved loopback-only settings and configures the shared `persist:fish-browser` session before any remote page is created.
2. `src/main/adblock.ts` loads a cached Ghostery ads-only engine or refreshes the maintained filter lists through that same session. Its configuration enables network request filters only; cosmetic, CSP, and HTML filtering are disabled. A stale cache is retained if refresh fails, and a first-launch failure does not prevent the browser from opening.
3. `src/main/browser.ts` creates one remote `WebContentsView` per tab on that same persistent session. Tabs keep independent page state while sharing the browser's cookies, SOCKS configuration, and network filters. Inactive views are assigned zero-size bounds.
4. Open tab URLs, the selected tab, search engine, and SOCKS5 preferences are stored in Electron's app-data directory and restored at startup. The narrow preload bridge provides tab switching, address navigation, back/forward/reload, view bounds, browsing history, settings, and clean application exit. Remote pages do not receive the app preload bridge.
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
- Network ad filtering applies only to that session and blocks matching requests; it does not cosmetically hide page elements. Electron supports only one active listener per `webRequest` event, so any future request interception must be composed with the blocker rather than registering a competing listener.
- The local port check is a TCP connect test, not a SOCKS protocol handshake.
- Web pages may navigate only over HTTP(S); popups and web permission requests are blocked.
- This implementation is a prototype, not a system-wide VPN or audited browser. Proxy configuration alone does not guarantee that every browser-related traffic type is proxied or prevent DNS/WebRTC leaks.
