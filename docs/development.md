# Development and technical notes

This page collects setup and implementation details for contributors. The project landing page remains focused on the Surffish experience; detailed feature notes live in the linked guides below.

## Local development

Use Bun from the repository root:

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```

`bun run dev` installs dependencies on first start and when the dependency manifests change. To run the native sidebar-overlay integration check on Linux with a virtual display:

```bash
xvfb-run -a bun run test:electron-sidebar-overlay
```

Set `SURFFISH_SCREENSHOT_DIR=/path/to/output` to have that test save full-window Electron captures for review.

## Architecture

Surffish is an Electron desktop browser with a React renderer. The main process owns the browser session, tabs, site permissions, network filtering, and persisted preferences. Trusted local UI surfaces use context isolation and a restricted preload API; remote pages run in separate `WebContentsView`s.

The browser page keeps full-window bounds when the glass sidebar is open. The sidebar is a separate native overlay with a width-controlled hit-test region. During a drag, its native view temporarily expands so pointer capture continues past the moving edge; after release, the view bounds return to the saved width. The integration smoke test checks click-through outside the panel, edge reveal/hide, actual mouse input, width persistence, and tab lifecycle.

## Browser engine and integrations

The desktop app embeds Chromium/Blink through Electron. Electron extension support is partial and loads unpacked extensions; consult the [official compatibility list](https://www.electronjs.org/docs/latest/api/extensions) before relying on a specific extension. Bramble is a tested integration for its existing password-fill flow, not a general extension store. Its custom-RP-ID passkey flow has additional runtime, relying-party, and host-permission requirements. Native macOS Touch ID for arbitrary website passkeys requires Apple's managed browser credential entitlement, app signing, and review; it is separate from an extension's own vault unlock.

Network filtering uses uBlock Origin filter lists through `@ghostery/adblocker-electron`, including network, cosmetic, and scriptlet rules. A dedicated persistent Chromium session can use an optional local SOCKS5 proxy; it affects this browser session only. The saved proxy choice is off for fresh profiles. Surffish is not an audited privacy browser and does not promise DNS or WebRTC leak protection.

## Further technical references

- [Architecture](architecture.md)
- [Browser, profile, and proxy notes](browser-and-proxy.md)
- [Browser UI and native overlay notes](browser-ui-overhaul.md)
- [Sidebar overlay limitation and alternatives](sidebar-overlay-limitation.md)
- [Downloads manager](downloads-manager.md)
- [Bramble integration](bramble-integration.md)
- [Extension compatibility roadmap](extensions-roadmap.md)
- [New Tab photo sources and cache](new-tab-photo-sources.md)
- [Quick Links background images](quick-links-backgrounds.md)
- [Third-party assets and licenses](third-party-assets.md)
- [Troubleshooting](troubleshooting.md)
- [macOS WebKit evaluation](native-webkit-evaluation.md)
