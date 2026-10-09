# Browser view and local SOCKS5 proxy

## Request flow

1. On app startup, `src/main/proxy.ts` reads the saved loopback-only settings and calls `session.fromPartition('persist:fish-browser').setProxy(...)` before the browser view is constructed. The internal partition name is intentionally retained across the Sockfish rename so existing browser-session data remains available.
2. `src/main/browser.ts` creates the remote `WebContentsView` on that same persistent partition. The main-process IPC layer exposes a narrow set of address/history/reload/bounds/proxy operations to the trusted local React renderer.
3. The renderer reports the page-area rectangle; the main process positions the native view below the toolbar. The embedded page does not receive the app preload bridge.
4. A settings change updates the browser session, closes pooled connections, persists the choice, and reloads the current page. When enabled, the proxy rules use `socks5://<loopback-host>:<port>` and `<local>` bypasses local hostnames/IPs.

## SSH dynamic forwarding

On the Mac where this app is running, start:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

This creates a local SOCKS endpoint on `127.0.0.1:1080` for the lifetime of the SSH process. Choose another local port if needed, and set the same host/port in the Browser tab. This sample does not start or manage the SSH process, store SSH credentials, or authenticate the SOCKS endpoint.

## Boundaries

- Proxy changes apply only to the `fish-browser` Electron session. Other app traffic is not redirected.
- The local port check is a TCP connect test, not a SOCKS protocol handshake.
- HTTP(S) pages can be opened; other URL schemes are rejected. Popups and web permission requests are blocked.
- This implementation is a prototype, not a full-featured or audited browser. It does not promise that every browser-related traffic type uses the proxy or make DNS/WebRTC leak guarantees.
