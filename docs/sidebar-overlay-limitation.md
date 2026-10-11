# Live-page glass sidebar overlay

**Status: implemented on `feat/sidebar-overlay-basewindow`; local production-build, typecheck, unit, and Electron integration checks pass. Do not merge until hosted CI is green for the exact pushed commit.**

## Architecture

The production app now uses a `BaseWindow` with the live page, full local React app, toolbar, and sidebar as distinct native `WebContentsView`s. Site tabs are inserted at the bottom of the native child-view order. The local toolbar and sidebar remain above them, while the full-window React renderer is hidden during live-site browsing so its transparent pixels cannot intercept page input.

The toolbar is measured and bounded to its actual height (plus any open toolbar popover). The sidebar is bounded to 320 px while pinned or hovered and to zero native width while hidden. Its existing backdrop blur and translucent glass styling are retained. The full-width site page receives the mouse-move events used for a 180 ms left-edge hover reveal, so a quick click at x=5 still reaches the page while hidden. The original React surface remains the active UI for the local New Tab and full settings, Network, site, and Downloads panels.

The host migration preserves the existing live-tab `persist:fish-browser` session and its cookies/storage, the configured SOCKS5 proxy, lazy/restored tab lifecycle, preload boundaries, context menus/dialog parentage, downloads, Bramble windows, Network Inspector, and platform titlebar options. Shared chrome state and app notifications are synchronized only among the three trusted local renderers; remote sites do not receive the Sockfish bridge.

## Production Electron integration results

The integration test launches the production Electron build using a fresh temporary profile and a local synthetic HTTP server. It does not access a user's profile, vault, or external website. Persisted pins and search-engine preferences are also sent to all three app renderers so UI state remains coherent after a native surface switch.

| State | Native page bounds (x, y, width) | Native shell state | Verified result |
|---|---:|---|---|
| Local New Tab active | No visible site page | Full React renderer visible; toolbar/sidebar overlay surfaces hidden | Original local start page remains usable. |
| Live page, sidebar hidden | `(0, toolbarHeight, full native content width, …)` | Toolbar visible; sidebar has zero native width | Page spans the full native content width, and a real click at x=5 still reaches the site. |
| Live page, sidebar visible | `(0, toolbarHeight, full native content width, …)` | Sidebar view overlays the page at 320 px | Page bounds do not move or shrink; synthetic site click, text entry, and mouse-wheel scroll work while the glass panel is open. |
| Hover at the live-page left edge | Same full-width page bounds | Sidebar expands above the page after a short delay | Physical pointer hover reveals the panel; moving away hides it after focus is released. |
| Switch live tab → New Tab → live tab | Existing live page view remains alive | Correct local/overlay renderer surfaces become visible at each state | The live tab, cookie, and full-width page state persist across tab switching. |

The native content width may measure 1279–1280 px inside a 1280 px Xvfb window depending on the window-frame allowance; the live page width is asserted against Electron's measured content width each run and begins at `x=0`. The test also verifies that the site view uses the existing `persist:fish-browser` Electron session.

## Reproduction

```bash
npm run typecheck
npm run build
npm test
xvfb-run -a npm run test:electron-sidebar-overlay
```

Hosted CI also runs the Electron Downloads manager smoke, extension probes, and host/frame bridge probe. To capture the overlay states locally, set `SOCKFISH_SCREENSHOT_DIR` when running the Xvfb smoke; the optional captures use a 1280×800 X server and are generated from this synthetic page only.

## Previous baseline

Before the migration, commit `66d28c7` used the app renderer as a single `BrowserWindow` surface. A 14 px reveal strip reduced hidden-state page bounds, the visible sidebar reserved 320 px beside the page, and a trial full-width site view painted over the sidebar. Those measurements explain why a bounds-only fix was insufficient; the `BaseWindow` view tree and input checks above supersede that baseline.
