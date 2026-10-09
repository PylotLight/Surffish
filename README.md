# Fish SOCKS Browser

A compact Electron browser sample based on the PylotLight Bun/Electron fish-app template. It adds one isolated Chromium page view and a built-in SOCKS5 setting for a local SSH dynamic-forwarding tunnel; the original kitchen-sink, tray, glass, and agent demo tabs remain available.

## Quick start

```bash
bun install
bun run dev
bun run typecheck
bun run build
```

## Use a local SSH SOCKS tunnel on macOS

Run the tunnel **on the same Mac that runs Fish Browser**:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

Replace `user@your-ssh-host` with your SSH account/host (or an SSH config alias). Keep that terminal session running. In Fish Browser, the Browser tab starts with SOCKS5 enabled at `127.0.0.1:1080`; choose **Test local port** and then **Save & apply** if you change settings. The proxy setting is saved for later launches. If the tunnel is down while proxying is enabled, page loads fail rather than silently falling back to a direct connection. Turn **Use proxy** off to browse directly.

The setting is restricted to loopback hosts (`localhost`, `127.0.0.1`, or `::1`) because this sample is intended for a local tunnel. A successful port test confirms only that something is listening; it does not authenticate or validate the SOCKS handshake or SSH destination.

## Scope and security notes

- The embedded remote page runs in Electron `WebContentsView`, not in the React app renderer. Node integration is off, context isolation and sandboxing are on, popups are denied, navigations are limited to HTTP(S), and permission requests are denied.
- SOCKS5 is configured on the dedicated browser session before the first remote page is loaded. The setting applies to this embedded browser only—not to Orion, other apps, or macOS system traffic.
- This is a small sample, not a production browser: it has no tabs, downloads UI, password manager, extensions, or browser-level privacy guarantees. It is not a system-wide VPN, and proxy configuration alone should not be treated as an anonymity or leak-prevention guarantee.

See [`docs/browser-and-proxy.md`](docs/browser-and-proxy.md) for implementation details.
