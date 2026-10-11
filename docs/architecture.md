# Architecture

Sockfish uses a trusted Electron main process, a native `BaseWindow` view tree, three small local React renderer surfaces, and an isolated remote `WebContentsView` for each loaded tab. The active site page is a full-width native view underneath the app chrome. On live sites, transparent toolbar and glass-sidebar surfaces are placed above it; on the local New Tab and full-app panels, the original full React surface is shown instead. New background tabs remain URL-only until selected; restored tabs remain unloaded until explicitly resumed. Loaded tabs continue playing media when inactive, and optional hibernation releases inactive, non-audible views for reuse later.

```text
                     ┌── local full-app renderer (New Tab, settings, full panels)
BaseWindow view tree ├── transparent toolbar renderer (live-site overlay)
                     ├── glass sidebar renderer (zero-width hidden / 320px overlay)
                     └── per-tab remote WebContentsViews (full-width page, lower layer)
                                      │
                                      └── shared persistent SOCKS5 browser session
```

- `src/main/index.ts` — application startup; restores protected session cookies and configures the browser proxy before creating tabs.
- `src/main/window.ts` — native `BaseWindow` lifecycle, platform chrome, trusted local renderer views, and local renderer loading.
- `src/main/browser-shell.ts` — native view ordering/visibility, measured toolbar geometry, hover/pin state synchronization, and the local-renderer allowlist.
- Persisted browser preferences are read as one snapshot and broadcast to all three local surfaces, keeping pins and the selected search engine coherent when the visible renderer changes.
- `src/main/browser.ts` — lazy per-tab page views, configurable tab hibernation, active-tab switching, full-width page bounds, navigation, and restoration of the last open tabs.
- `src/main/network-inspector.ts` — per-tab Chromium DevTools Protocol Network capture, a 1,000-request in-memory ring, and on-demand request/response detail lookup.
- `src/main/browser-persistence.ts` — app-data persistence for open tab URLs, active tab, and browser preferences including the tab-sleep interval.
- `src/main/session-cookies.ts` — encrypted snapshot/restore of session-only cookies using Electron safeStorage when OS-backed encryption is available.
- `src/main/history.ts` — validated, bounded browsing history persisted in the app's user-data directory.
- `src/main/proxy.ts` — validates loopback-only SOCKS5 settings, persists them, and configures the persistent site session.
- `src/main/ipc.ts` — browser IPC guarded to the three trusted local renderer views; toolbar geometry reports are accepted only from the toolbar surface.
- `src/preload/index.ts` — narrow, typed browser API exposed through `contextBridge` to the local renderers only.
- `src/shared/navigation.ts` — HTTP(S)-only address parsing and selected-search-engine routing.
- `src/shared/types.ts` — browser, proxy, chrome-state, and toolbar-metrics contracts shared across processes.
- `src/renderer/` — shared React UI rendered as the full app, toolbar-only, or sidebar-only surface according to a trusted URL query parameter.

## Security and input boundaries

1. Remote content is never loaded into the React renderers. Site `WebContentsView`s use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`; they receive no Sockfish preload bridge.
2. Remote tabs continue to use the existing persistent `persist:fish-browser` session, so site cookies/storage, protected session-cookie restoration, and the configured SOCKS5 proxy remain on the same session.
3. Local UI IPC is accepted only from the content, toolbar, or sidebar WebContentsViews created by `window.ts`. Remote site pages cannot call those handlers.
4. Native stacking places the live page below the transparent local surfaces. The full React content surface is made invisible while a web page is active, so its full-window hit-test rectangle cannot intercept site clicks or scrolling. The toolbar and sidebar remain bounded overlays; while hidden, the sidebar has zero native width and the page's own mouse-move events reveal it after a short hover delay without reserving or blocking a pixel.
5. Non-HTTP(S) navigations, unapproved popups, and web permission requests retain their existing blocking policy. SOCKS settings accept loopback hosts only.

## Network inspector

The Network panel attaches Electron's DevTools Protocol debugger to each loaded tab before its page navigation. It records request/response metadata and failures without installing another session-level `webRequest` callback, so the ad blocker keeps its existing hook. The newest 1,000 requests are retained in process memory; request/response headers and bodies are fetched for the selected row, and response bodies are not retained unless requested. Clearing the panel drops the retained rows, and closing the app discards them. Since full DevTools headers can include cookies or authorization values, they are visible only in the local inspector and are not written to browser history or the profile.

## Overlay integration coverage

`test:electron-sidebar-overlay` launches the production build in an isolated temporary profile and navigates to a loopback-only synthetic page. It checks full-width page bounds, native page-under-chrome stacking, a zero-width hidden sidebar with real click-through at x=5, delayed edge hover reveal, pointer/keyboard/mouse-wheel delivery to the page while the sidebar is open, persistent-session use, cookie continuity, and switching between a live tab and the local New Tab. Optional full-window captures can be enabled with `SOCKFISH_SCREENSHOT_DIR`.
