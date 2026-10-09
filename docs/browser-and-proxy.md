# Browser and local SOCKS5 proxy

## Browser flow

1. On startup, `src/main/proxy.ts` reads the saved loopback-only settings and configures `session.fromPartition('persist:fish-browser')` before the remote page is created.
2. `src/main/browser.ts` creates the remote `WebContentsView` on that same persistent session. The React window reports the page rectangle; the main process positions the native view beneath the browser toolbar.
3. The narrow preload bridge provides address navigation, back/forward/reload, view bounds, and SOCKS5 settings. The remote page does not receive the app preload bridge.
4. `src/shared/navigation.ts` resolves omnibox input: HTTP(S) URLs and domain-like hosts navigate directly, loopback addresses use HTTP, and other text becomes a DuckDuckGo query. Non-HTTP(S) schemes are rejected.

## SSH dynamic forwarding

On the computer running Sockfish, start:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

This creates a local SOCKS endpoint on `127.0.0.1:1080` for the lifetime of the SSH process. Choose another local port if needed and set the same host/port in the toolbar's **SOCKS5** panel. Sockfish does not start or manage the SSH process, store SSH credentials, or authenticate the SOCKS endpoint.

## Boundaries

- Proxy changes apply only to the `fish-browser` Electron session.
- The local port check is a TCP connect test, not a SOCKS protocol handshake.
- Web pages may navigate only over HTTP(S); popups and web permission requests are blocked.
- This implementation is a prototype, not a system-wide VPN or audited browser. Proxy configuration alone does not guarantee that every browser-related traffic type is proxied or prevent DNS/WebRTC leaks.
