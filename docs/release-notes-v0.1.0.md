# Surffish 0.1.0

An early Apple-silicon release of Surffish, a focused Electron desktop browser.

## Highlights

- A resizable translucent sidebar for tabs, pinned sites, and browsing history.
- A nature-photo New Tab page with compact favorite and frequent-site shortcuts.
- Built-in downloads, network ad and tracker blocking, and optional app-level SOCKS5 proxy support.
- Bramble password-manager integration, with vault setup in a regular browser tab.
- Per-site controls, Picture in Picture, and persistent site icons.

## Security and privacy

- Trusted app surfaces are sandboxed; navigation and privileged IPC are restricted to their expected local documents.
- Saved session URLs remove fragments and common secret-like query parameters while preserving ordinary search parameters.
- Bramble release metadata and downloads use the configured browser session and proxy.

## Compatibility and limitations

- macOS Ventura 13 or later; Apple silicon only.
- This build is unsigned and not notarized. macOS may require Control-click → Open or, after verifying the official app and confirming you trust it, removing its quarantine attribute with `xattr -cr /Applications/Surffish.app`.
- Surffish starts with a fresh profile and does not import legacy Sockfish profile or vault data.
